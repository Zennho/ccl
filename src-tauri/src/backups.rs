use crate::{jobs, loaders, root, version_id, version_manager, ResultT};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const ROOTS: &[&str] = &[
    "mods",
    "config",
    "defaultconfigs",
    "kubejs",
    "scripts",
    "global_packs",
    "patchouli_books",
    "journeymap",
    "schematics",
    "saves",
    "resourcepacks",
    "shaderpacks",
    "options.txt",
    "optionsof.txt",
    "optionsshaders.txt",
    "servers.dat",
    "servers.dat_old",
    ".ccl-mods.json",
    ".ccl-packs.json",
];
const MAX_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 100_000;
static SERIAL: AtomicU64 = AtomicU64::new(0);
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format: String,
    version: String,
    scope: String,
    world: Option<String>,
    created: u64,
    targets: Vec<String>,
    present: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    id: String,
    created: u64,
    scope: String,
    world: Option<String>,
    size: u64,
}
fn id() -> String {
    format!(
        "b-{}-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}
fn name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
}
fn backup_dir(root: &Path, version: &str, create: bool) -> ResultT<PathBuf> {
    version_id(version)?;
    let mut path = root.to_path_buf();
    for part in ["ccl-backups", "instances", version] {
        path.push(part);
        if create {
            match fs::create_dir(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        match fs::symlink_metadata(&path) {
            Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
            Err(e) if !create && e.kind() == std::io::ErrorKind::NotFound => return Ok(path),
            _ => return Err("备份目录不是安全的普通目录".into()),
        }
    }
    Ok(path)
}
fn target_list(scope: &str, world: Option<&str>) -> ResultT<Vec<String>> {
    match scope {
        "instance" => Ok(ROOTS.iter().map(|v| v.to_string()).collect()),
        "world" => {
            let w = world.ok_or("缺少存档名称")?;
            if !name_ok(w) {
                return Err("存档名称无效".into());
            }
            Ok(vec![format!("saves/{w}")])
        }
        _ => Err("未知备份类型".into()),
    }
}
fn unique_backup(root: &Path, version: &str) -> ResultT<(String, PathBuf)> {
    let dir = backup_dir(root, version, true)?;
    let id = id();
    Ok((id.clone(), dir.join(format!("{id}.zip"))))
}
fn append(
    zip: &mut ZipWriter<File>,
    runtime: &Path,
    relative: &Path,
    count: &mut usize,
    size: &mut u64,
) -> ResultT<()> {
    let path = runtime.join(relative);
    let meta = match fs::symlink_metadata(&path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if meta.file_type().is_symlink() {
        return Err(format!("备份不支持符号链接：{}", relative.display()));
    }
    *count += 1;
    if *count > MAX_FILES {
        return Err("备份文件数量超过限制".into());
    }
    let raw = relative
        .to_str()
        .ok_or("文件名不是 UTF-8")?
        .replace('\\', "/");
    if raw.split('/').any(|v| !name_ok(v) || v.contains(':')) {
        return Err("备份包含不安全的文件名".into());
    }
    let entry = format!("data/{raw}");
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    if meta.is_dir() {
        zip.add_directory(format!("{entry}/"), options)
            .map_err(|e| e.to_string())?;
        for child in fs::read_dir(&path).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?;
            if child.file_name() == "session.lock" {
                continue;
            }
            append(zip, runtime, &relative.join(child.file_name()), count, size)?;
        }
    } else if meta.is_file() {
        *size = size.checked_add(meta.len()).ok_or("备份过大")?;
        if *size > MAX_BYTES {
            return Err("备份超过大小限制".into());
        }
        zip.start_file(entry, options).map_err(|e| e.to_string())?;
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, zip).map_err(|e| e.to_string())?;
    } else {
        return Err("备份包含不支持的文件类型".into());
    }
    Ok(())
}
pub(crate) fn make_backup(
    root: &Path,
    runtime: &Path,
    version: &str,
    scope: &str,
    world: Option<&str>,
) -> ResultT<String> {
    let targets = target_list(scope, world)?;
    if scope == "world" {
        let saves = fs::symlink_metadata(runtime.join("saves")).map_err(|_| "存档目录不存在")?;
        if saves.file_type().is_symlink() || !saves.is_dir() {
            return Err("存档目录不是安全的普通目录".into());
        }
    }
    if scope == "world" && !runtime.join(&targets[0]).is_dir() {
        return Err("存档不存在".into());
    }
    let (id, dest) = unique_backup(root, version)?;
    let temp = dest.with_extension("tmp");
    let _cleanup = jobs::CleanupPath::file(temp.clone());
    let out = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(out);
    let present: Vec<String> = targets
        .iter()
        .filter(|name| fs::symlink_metadata(runtime.join(name)).is_ok())
        .cloned()
        .collect();
    let manifest = Manifest {
        format: "ccl-backup-1".into(),
        version: version.into(),
        scope: scope.into(),
        world: world.map(str::to_string),
        created: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        targets,
        present,
    };
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec(&manifest).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let (mut count, mut size) = (0, 0);
    for target in &manifest.targets {
        append(&mut zip, runtime, Path::new(target), &mut count, &mut size)?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
    Ok(id)
}
fn backup_path(root: &Path, version: &str, id: &str) -> ResultT<PathBuf> {
    if !id.starts_with("b-")
        || !id
            .chars()
            .all(|c| c.is_ascii_digit() || c == 'b' || c == '-')
        || id.len() > 100
    {
        return Err("备份标识无效".into());
    }
    let path = backup_dir(root, version, false)?.join(format!("{id}.zip"));
    let m = fs::symlink_metadata(&path).map_err(|_| "备份不存在")?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err("备份文件无效".into());
    }
    Ok(path)
}
fn manifest(zip: &mut ZipArchive<File>, version: &str) -> ResultT<Manifest> {
    let f = zip.by_name("manifest.json").map_err(|_| "缺少备份清单")?;
    if f.size() > 16384 {
        return Err("备份清单过大".into());
    }
    let m: Manifest = serde_json::from_reader(f).map_err(|_| "备份清单无效")?;
    let allowed = target_list(&m.scope, m.world.as_deref())?;
    if m.format != "ccl-backup-1"
        || m.version != version
        || m.targets.is_empty()
        || m.targets.iter().any(|p| !allowed.contains(p))
        || m.targets.iter().collect::<HashSet<_>>().len() != m.targets.len()
        || (m.scope == "world" && m.targets != allowed)
        || m.present.iter().any(|p| !m.targets.contains(p))
        || m.present.iter().collect::<HashSet<_>>().len() != m.present.len()
        || (m.scope == "world" && m.present != m.targets)
    {
        return Err("备份不属于该游戏版本或内容无效".into());
    }
    Ok(m)
}
fn list(root: &Path, version: &str) -> ResultT<Vec<BackupInfo>> {
    let path = backup_dir(root, version, false)?;
    let entries = match fs::read_dir(path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut all = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(id) = name.strip_suffix(".zip") else {
            continue;
        };
        let Ok(path) = backup_path(root, version, id) else {
            continue;
        };
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let Ok(mut zip) = ZipArchive::new(file) else {
            continue;
        };
        let Ok(m) = manifest(&mut zip, version) else {
            continue;
        };
        all.push(BackupInfo {
            id: id.into(),
            created: m.created,
            scope: m.scope,
            world: m.world,
            size: e.metadata().map(|v| v.len()).unwrap_or(0),
        });
    }
    all.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| b.id.cmp(&a.id)));
    Ok(all)
}
fn extract(zip: &mut ZipArchive<File>, m: &Manifest, stage: &Path) -> ResultT<()> {
    if zip.len() > MAX_FILES + 1 {
        return Err("备份文件数量超过限制".into());
    }
    let mut total = 0u64;
    let mut seen = HashSet::new();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = f.name().to_string();
        if name == "manifest.json" {
            continue;
        }
        let name = name
            .strip_prefix("data/")
            .ok_or("备份包含未知文件")?
            .trim_end_matches('/');
        let rel = Path::new(name);
        if name.is_empty()
            || name.contains(['\\', ':'])
            || !rel.components().all(|c| matches!(c, Component::Normal(_)))
            || !m
                .targets
                .iter()
                .any(|t| name == t || name.strip_prefix(t).is_some_and(|v| v.starts_with('/')))
            || f.unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("备份包含不安全路径".into());
        }
        if !seen.insert(name.to_ascii_lowercase()) {
            return Err("备份包含重复路径".into());
        }
        total = total.checked_add(f.size()).ok_or("备份过大")?;
        if total > MAX_BYTES {
            return Err("备份超过大小限制".into());
        }
        let target = stage.join(rel);
        if f.is_dir() {
            fs::create_dir_all(target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(target)
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
fn restore(root: &Path, runtime: &Path, version: &str, backup_id: &str) -> ResultT<String> {
    let path = backup_path(root, version, backup_id)?;
    let mut zip =
        ZipArchive::new(File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let m = manifest(&mut zip, version)?;
    let stage = root.join(format!(".ccl-restore-{}", id()));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let _cleanup = jobs::CleanupPath::dir(stage.clone());
    let extracted = stage.join("new");
    fs::create_dir(&extracted).map_err(|e| e.to_string())?;
    extract(&mut zip, &m, &extracted)?;
    for target in &m.targets {
        if extracted.join(target).exists() != m.present.contains(target) {
            return Err("备份数据不完整或与清单不符".into());
        }
    }
    // Always retain a pre-restore snapshot, even if the target was modified since selection.
    let pre = make_backup(root, runtime, version, "instance", None)?;
    let rollback = stage.join("old");
    fs::create_dir(&rollback).map_err(|e| e.to_string())?;
    let mut moved = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> ResultT<()> {
        for target in &m.targets {
            let dest = runtime.join(target);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                let parent_meta = fs::symlink_metadata(parent).map_err(|e| e.to_string())?;
                if parent_meta.file_type().is_symlink() {
                    return Err("目标目录包含符号链接".into());
                }
            }
            let old = rollback.join(target);
            if fs::symlink_metadata(&dest).is_ok() {
                if fs::symlink_metadata(&dest)
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
                {
                    return Err("目标是符号链接，无法恢复".into());
                }
                if let Some(p) = old.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                fs::rename(&dest, &old).map_err(|e| e.to_string())?;
                moved.push(target.clone());
            }
            let new = extracted.join(target);
            if new.exists() {
                fs::rename(&new, &dest).map_err(|e| e.to_string())?;
                installed.push(target.clone());
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        for target in installed.iter().rev() {
            let p = runtime.join(target);
            if p.is_dir() {
                let _ = fs::remove_dir_all(p);
            } else {
                let _ = fs::remove_file(p);
            }
        }
        let mut failed = false;
        for target in moved.iter().rev() {
            if fs::rename(rollback.join(target), runtime.join(target)).is_err() {
                failed = true;
            }
        }
        if failed {
            std::mem::forget(_cleanup);
            return Err(format!(
                "恢复失败：{e}；自动回退未完成，原文件保留在 {}，也可使用预恢复备份 {pre}",
                stage.display()
            ));
        }
        return Err(format!("恢复失败，已回退：{e}；预恢复备份 {pre}"));
    }
    Ok(pre)
}
fn context(game_dir: &str, version: &str) -> ResultT<(PathBuf, PathBuf)> {
    let root = root(game_dir)?;
    let meta = loaders::version_json(&root, version)?;
    let runtime = loaders::runtime_dir(&root, version, &meta);
    fs::create_dir_all(&runtime).map_err(|e| e.to_string())?;
    let metadata = fs::symlink_metadata(&runtime).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("游戏目录不是安全的普通目录".into());
    }
    Ok((root, runtime))
}
#[tauri::command]
pub async fn list_backups(game_dir: String, version: String) -> ResultT<Vec<BackupInfo>> {
    tokio::task::spawn_blocking(move || {
        let (root, _) = context(&game_dir, &version)?;
        list(&root, &version)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn create_backup(
    game_dir: String,
    version: String,
    scope: String,
    world: Option<String>,
) -> ResultT<String> {
    tokio::task::spawn_blocking(move || {
        let (root, runtime) = context(&game_dir, &version)?;
        let _guard = version_manager::reserve_directory(&root)?;
        jobs::while_idle(&game_dir, || {
            make_backup(&root, &runtime, &version, &scope, world.as_deref())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn restore_backup(
    game_dir: String,
    version: String,
    backup_id: String,
) -> ResultT<String> {
    tokio::task::spawn_blocking(move || {
        let (root, runtime) = context(&game_dir, &version)?;
        let _guard = version_manager::reserve_directory(&root)?;
        jobs::while_idle(&game_dir, || restore(&root, &runtime, &version, &backup_id))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_backup(game_dir: String, version: String, backup_id: String) -> ResultT<()> {
    tokio::task::spawn_blocking(move || {
        let (root, _) = context(&game_dir, &version)?;
        let _guard = version_manager::reserve_directory(&root)?;
        jobs::while_idle(&game_dir, || {
            fs::remove_file(backup_path(&root, &version, &backup_id)?).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("ccl-backup-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("mods")).unwrap();
        fs::create_dir_all(root.join("saves/world")).unwrap();
        fs::write(root.join("mods/a.jar"), b"old mod").unwrap();
        fs::write(root.join("saves/world/level.dat"), b"old world").unwrap();
        root
    }
    #[test]
    fn restores_and_saves_current_instance_before_replacement() {
        let root = fixture("restore");
        let backup = make_backup(&root, &root, "test", "instance", None).unwrap();
        fs::write(root.join("mods/a.jar"), b"new mod").unwrap();
        fs::write(root.join("saves/world/level.dat"), b"new world").unwrap();
        fs::create_dir_all(root.join("shaderpacks")).unwrap();
        fs::write(root.join("shaderpacks/new.zip"), b"x").unwrap();
        let pre = restore(&root, &root, "test", &backup).unwrap();
        assert_eq!(fs::read(root.join("mods/a.jar")).unwrap(), b"old mod");
        assert_eq!(
            fs::read(root.join("saves/world/level.dat")).unwrap(),
            b"old world"
        );
        assert!(!root.join("shaderpacks").exists());
        assert_ne!(backup, pre);
        restore(&root, &root, "test", &pre).unwrap();
        assert_eq!(fs::read(root.join("mods/a.jar")).unwrap(), b"new mod");
        assert!(root.join("shaderpacks/new.zip").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn world_restore_preserves_other_worlds() {
        let root = fixture("world");
        let backup = make_backup(&root, &root, "test", "world", Some("world")).unwrap();
        fs::write(root.join("saves/world/level.dat"), b"changed").unwrap();
        fs::create_dir_all(root.join("saves/other")).unwrap();
        fs::write(root.join("saves/other/level.dat"), b"other").unwrap();
        restore(&root, &root, "test", &backup).unwrap();
        assert_eq!(
            fs::read(root.join("saves/world/level.dat")).unwrap(),
            b"old world"
        );
        assert_eq!(
            fs::read(root.join("saves/other/level.dat")).unwrap(),
            b"other"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_unsafe_and_incomplete_backups_without_modifying_data() {
        let root = fixture("invalid");
        let (id, path) = unique_backup(&root, "test").unwrap();
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        let m = Manifest {
            format: "ccl-backup-1".into(),
            version: "test".into(),
            scope: "world".into(),
            world: Some("world".into()),
            created: 0,
            targets: vec!["saves/world".into()],
            present: vec!["saves/world".into()],
        };
        zip.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&serde_json::to_vec(&m).unwrap()).unwrap();
        zip.start_file("data/saves/world/../../evil", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"evil").unwrap();
        zip.finish().unwrap();
        assert!(restore(&root, &root, "test", &id).is_err());
        assert_eq!(
            fs::read(root.join("saves/world/level.dat")).unwrap(),
            b"old world"
        );
        assert!(!root.join("evil").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_linked_saves() {
        let root = fixture("link");
        fs::remove_dir_all(root.join("saves")).unwrap();
        fs::create_dir_all(root.join("outside/world")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), root.join("saves")).unwrap();
        assert!(make_backup(&root, &root, "test", "world", Some("world")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
