use crate::{loaders, root, version_id, ResultT};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
static STATS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayStats {
    launches: u64,
    seconds: u64,
    last_started: Option<u64>,
    last_duration: Option<u64>,
    last_success: Option<bool>,
}
fn path(dir: &Path, version: &str) -> PathBuf {
    dir.join("versions")
        .join(version)
        .join("ccl-play-stats.json")
}
fn read_stats(dir: &Path, version: &str) -> ResultT<PlayStats> {
    let file = path(dir, version);
    match fs::symlink_metadata(&file) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(PlayStats::default()),
        _ => return Err("游戏记录文件无效".into()),
    };
    let data = fs::read(file).map_err(|e| e.to_string())?;
    if data.len() > 16384 {
        return Err("游戏记录文件过大".into());
    }
    serde_json::from_slice(&data).map_err(|_| "游戏记录格式无效".into())
}
fn write_stats(dir: &Path, version: &str, stats: &PlayStats) -> ResultT<()> {
    let path = path(dir, version);
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut f = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    use std::io::Write;
    if let Err(e) = f.write_all(&serde_json::to_vec(stats).map_err(|e| e.to_string())?) {
        drop(f);
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    drop(f);
    if let Err(e) = fs::rename(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}
fn update(dir: &Path, version: &str, change: impl FnOnce(&mut PlayStats)) -> ResultT<()> {
    version_id(version)?;
    let _guard = STATS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "游戏记录不可用")?;
    let mut stats = read_stats(dir, version)?;
    change(&mut stats);
    write_stats(dir, version, &stats)
}
pub fn started(dir: &Path, version: &str) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let _ = update(dir, version, |stats| {
        stats.launches = stats.launches.saturating_add(1);
        stats.last_started = Some(now);
    });
}
pub fn finished(dir: &Path, version: &str, seconds: u64, success: bool) {
    let _ = update(dir, version, |stats| {
        stats.seconds = stats.seconds.saturating_add(seconds);
        stats.last_duration = Some(seconds);
        stats.last_success = Some(success);
    });
}
#[tauri::command]
pub async fn play_stats(game_dir: String, version: String) -> ResultT<PlayStats> {
    tokio::task::spawn_blocking(move || {
        let dir = root(&game_dir)?;
        loaders::version_json(&dir, &version)?;
        let _guard = STATS_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "游戏记录不可用")?;
        read_stats(&dir, &version)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    name: String,
    modified: Option<u64>,
    size: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPage {
    items: Vec<Screenshot>,
    has_more: bool,
    isolated: bool,
}
fn runtime(game_dir: &str, version: &str) -> ResultT<(PathBuf, bool)> {
    let dir = root(game_dir)?;
    let meta = loaders::version_json(&dir, version)?;
    Ok((
        loaders::runtime_dir(&dir, version, &meta),
        loaders::is_isolated(&dir, version, &meta),
    ))
}
fn screenshot_dir(runtime: &Path, create: bool) -> ResultT<PathBuf> {
    let p = runtime.join("screenshots");
    if create {
        fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    match fs::symlink_metadata(&p) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(p),
        _ => Err("截图目录不是安全的普通目录".into()),
    }
}
fn safe_screenshot_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
        && name.to_ascii_lowercase().ends_with(".png")
        && name != ".."
}
fn list(runtime: &Path, isolated: bool, page: u32) -> ResultT<ScreenshotPage> {
    if page > 10000 {
        return Err("截图页码无效".into());
    }
    let path = screenshot_dir(runtime, false)?;
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ScreenshotPage {
                items: vec![],
                has_more: false,
                isolated,
            })
        }
        Err(e) => return Err(e.to_string()),
    };
    let mut items = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !safe_screenshot_name(&name) {
            continue;
        }
        let Ok(m) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !m.is_file() || m.file_type().is_symlink() {
            continue;
        }
        items.push(Screenshot {
            name,
            modified: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            size: m.len(),
        });
        if items.len() > 100_000 {
            return Err("截图数量过多".into());
        }
    }
    items.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| b.name.cmp(&a.name))
    });
    let offset = page as usize * 9;
    let has_more = items.len() > offset + 9;
    Ok(ScreenshotPage {
        items: items.into_iter().skip(offset).take(9).collect(),
        has_more,
        isolated,
    })
}
#[tauri::command]
pub async fn list_game_screenshots(
    game_dir: String,
    version: String,
    page: u32,
) -> ResultT<ScreenshotPage> {
    tokio::task::spawn_blocking(move || {
        let (dir, isolated) = runtime(&game_dir, &version)?;
        list(&dir, isolated, page)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn game_screenshot(game_dir: String, version: String, name: String) -> ResultT<String> {
    tokio::task::spawn_blocking(move || {
        if !safe_screenshot_name(&name) {
            return Err("截图名称无效".into());
        }
        let (dir, _) = runtime(&game_dir, &version)?;
        let path = screenshot_dir(&dir, false)?.join(name);
        let meta = fs::symlink_metadata(&path).map_err(|_| "截图不存在")?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 12 * 1024 * 1024 {
            return Err("截图文件无效或超过 12 MB".into());
        }
        let mut bytes = Vec::new();
        fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(12 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 12 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("截图格式无效或过大".into());
        }
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn open_screenshot_folder(game_dir: String, version: String) -> ResultT<()> {
    let (dir, _) = runtime(&game_dir, &version)?;
    let folder = screenshot_dir(&dir, true)?;
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(folder)
        .spawn()
        .map_err(|e| format!("无法打开截图目录：{e}"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_multiple_sessions_and_ignores_unsafe_screenshots() {
        let dir = std::env::temp_dir().join(format!("ccl-profile-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("versions/v")).unwrap();
        fs::create_dir_all(dir.join("screenshots")).unwrap();
        started(&dir, "v");
        started(&dir, "v");
        finished(&dir, "v", 60, true);
        finished(&dir, "v", 90, false);
        let stats = read_stats(&dir, "v").unwrap();
        assert_eq!(stats.launches, 2);
        assert_eq!(stats.seconds, 150);
        assert_eq!(stats.last_success, Some(false));
        fs::write(dir.join("screenshots/a.png"), b"x").unwrap();
        fs::write(dir.join("screenshots/b.txt"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            dir.join("screenshots/a.png"),
            dir.join("screenshots/link.png"),
        )
        .unwrap();
        assert_eq!(list(&dir, true, 0).unwrap().items.len(), 1);
        assert!(!safe_screenshot_name("../secret.png"));
        fs::remove_dir_all(dir).unwrap();
    }
}
#[cfg(test)]
mod more_tests {
    use super::*;
    #[test]
    fn concurrent_sessions_accumulate_without_losing_updates() {
        let dir =
            std::env::temp_dir().join(format!("ccl-profile-concurrent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("versions/v")).unwrap();
        std::thread::scope(|scope| {
            for _ in 0..16 {
                let dir = &dir;
                scope.spawn(move || {
                    started(dir, "v");
                    finished(dir, "v", 60, true);
                });
            }
        });
        let stats = read_stats(&dir, "v").unwrap();
        assert_eq!(stats.launches, 16);
        assert_eq!(stats.seconds, 960);
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn screenshot_reader_rejects_traversal_and_invalid_bytes() {
        let dir = std::env::temp_dir().join(format!("ccl-profile-reader-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("versions/v")).unwrap();
        fs::create_dir_all(dir.join("screenshots")).unwrap();
        fs::write(dir.join("versions/v/v.json"), br#"{"id":"v"}"#).unwrap();
        fs::write(dir.join("screenshots/valid.png"), b"\x89PNG\r\n\x1a\nimage").unwrap();
        fs::write(dir.join("screenshots/invalid.png"), b"text").unwrap();
        let root = dir.to_string_lossy().to_string();
        assert!(
            game_screenshot(root.clone(), "v".into(), "valid.png".into())
                .await
                .unwrap()
                .starts_with("data:image/png;base64,")
        );
        assert!(
            game_screenshot(root.clone(), "v".into(), "../valid.png".into())
                .await
                .is_err()
        );
        assert!(game_screenshot(root, "v".into(), "invalid.png".into())
            .await
            .is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn screenshots_are_paginated_and_reject_linked_directories() {
        let dir = std::env::temp_dir().join(format!("ccl-profile-pages-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("screenshots")).unwrap();
        for i in 0..11 {
            fs::write(dir.join("screenshots").join(format!("{i}.png")), b"test").unwrap();
        }
        let first = list(&dir, false, 0).unwrap();
        let second = list(&dir, false, 1).unwrap();
        assert_eq!(first.items.len(), 9);
        assert!(first.has_more);
        assert_eq!(second.items.len(), 2);
        assert!(!second.has_more);
        assert!(!first.isolated);
        #[cfg(unix)]
        {
            fs::remove_dir_all(dir.join("screenshots")).unwrap();
            fs::create_dir(dir.join("other")).unwrap();
            std::os::unix::fs::symlink(dir.join("other"), dir.join("screenshots")).unwrap();
            assert!(list(&dir, false, 0).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
