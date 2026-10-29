use crate::{loaders, root, ResultT};
use serde::Serialize;
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    game_version: String,
    loader: String,
    isolated: bool,
    mods: usize,
    resource_packs: usize,
    shader_packs: usize,
    size_bytes: u64,
    size_incomplete: bool,
    last_launched: Option<u64>,
}

fn count_files(path: &Path, kind: &str) -> usize {
    fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            let Ok(file_type) = entry.file_type() else {
                return false;
            };
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            match kind {
                "mods" => {
                    file_type.is_file()
                        && (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
                }
                "resourcepacks" => {
                    (file_type.is_file() && name.ends_with(".zip"))
                        || (file_type.is_dir() && entry.path().join("pack.mcmeta").is_file())
                }
                "shaderpacks" => {
                    (file_type.is_file() && name.ends_with(".zip"))
                        || (file_type.is_dir() && entry.path().join("shaders").is_dir())
                }
                _ => false,
            }
        })
        .count()
}

fn tree_size(root: &Path) -> (u64, bool) {
    const MAX_ENTRIES: usize = 300_000;
    if fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) {
        return (0, true);
    }
    let mut pending = vec![root.to_path_buf()];
    let mut total = 0u64;
    let mut scanned = 0usize;
    let mut incomplete = false;
    while let Some(dir) = pending.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && dir == root => continue,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        for entry in entries {
            scanned += 1;
            if scanned > MAX_ENTRIES {
                return (total, true);
            }
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            let meta = match fs::symlink_metadata(entry.path()) {
                Ok(m) => m,
                Err(_) => {
                    incomplete = true;
                    continue;
                }
            };
            if meta.file_type().is_symlink() {
                incomplete = true;
            } else if meta.is_dir() {
                pending.push(entry.path());
            } else if meta.is_file() {
                total = total.saturating_add(meta.len());
            }
        }
    }
    (total, incomplete)
}

pub fn record_launch(dir: &Path, version: &str) {
    if let Ok(now) = SystemTime::now().duration_since(UNIX_EPOCH) {
        let _ = fs::write(
            dir.join("versions").join(version).join("ccl-last-launch"),
            now.as_secs().to_string(),
        );
    }
}

fn collect(game_dir: &str, version: &str) -> ResultT<Overview> {
    let root = root(game_dir)?;
    let meta = loaders::version_json(&root, version)?;
    let isolated = loaders::is_isolated(&root, version, &meta);
    let instance = loaders::runtime_dir(&root, version, &meta);
    let (size_bytes, size_incomplete) = tree_size(&instance);
    let last_launched =
        fs::read_to_string(root.join("versions").join(version).join("ccl-last-launch"))
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok());
    Ok(Overview {
        game_version: meta["cclBaseVersion"].as_str().unwrap_or(version).into(),
        loader: meta["cclLoader"].as_str().unwrap_or("vanilla").into(),
        isolated,
        mods: count_files(&instance.join("mods"), "mods"),
        resource_packs: count_files(&instance.join("resourcepacks"), "resourcepacks"),
        shader_packs: count_files(&instance.join("shaderpacks"), "shaderpacks"),
        size_bytes,
        size_incomplete,
        last_launched,
    })
}

#[tauri::command]
pub async fn instance_overview(game_dir: String, version: String) -> ResultT<Overview> {
    tokio::task::spawn_blocking(move || collect(&game_dir, &version))
        .await
        .map_err(|e| format!("读取实例概览失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_files_and_does_not_follow_symlinks() {
        let root = std::env::temp_dir().join(format!("ccl-overview-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("resourcepacks/folder")).unwrap();
        fs::write(root.join("mods/a.jar"), b"123").unwrap();
        fs::write(root.join("mods/b.jar.disabled"), b"12345").unwrap();
        fs::write(root.join("resourcepacks/folder/pack.mcmeta"), b"{}").unwrap();
        assert_eq!(count_files(&root.join("mods"), "mods"), 2);
        assert_eq!(count_files(&root.join("resourcepacks"), "resourcepacks"), 1);
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("mods"), root.join("linked")).unwrap();
        let (size, incomplete) = tree_size(&root);
        assert_eq!(size, 10);
        #[cfg(unix)]
        assert!(incomplete);
        #[cfg(not(unix))]
        assert!(!incomplete);
        fs::remove_dir_all(root).unwrap();
    }
}
