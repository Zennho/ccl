use crate::{jobs, loaders, resource_lock, root, version_id, ResultT};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

#[derive(Default)]
struct RunState {
    games: HashMap<(PathBuf, String), usize>,
    deleting: HashSet<PathBuf>,
}
static RUNNING: OnceLock<Mutex<RunState>> = OnceLock::new();
fn running() -> &'static Mutex<RunState> {
    RUNNING.get_or_init(|| Mutex::new(RunState::default()))
}
fn normalized(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}
pub struct RunningVersion((PathBuf, String));
pub fn track_launch(dir: &Path, version: &str) -> ResultT<RunningVersion> {
    let key = (normalized(dir), version.to_owned());
    let mut all = running().lock().map_err(|_| "游戏状态不可用")?;
    if all.deleting.contains(&key.0) {
        return Err("正在删除此游戏目录的版本，请稍后重试".into());
    }
    *all.games.entry(key.clone()).or_default() += 1;
    Ok(RunningVersion(key))
}
impl Drop for RunningVersion {
    fn drop(&mut self) {
        if let Ok(mut all) = running().lock() {
            if let Some(n) = all.games.get_mut(&self.0) {
                *n -= 1;
                if *n == 0 {
                    all.games.remove(&self.0);
                }
            }
        }
    }
}
fn safe_dir(parent: &Path, name: &str) -> ResultT<PathBuf> {
    let root_meta = fs::symlink_metadata(parent).map_err(|_| "游戏版本目录不存在")?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err("不支持删除符号链接目录中的版本".into());
    }
    let path = parent.join(name);
    let metadata = fs::symlink_metadata(&path).map_err(|_| "版本目录不存在")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("版本目录不是安全的普通目录".into());
    }
    Ok(path)
}
fn remove(dir: &Path, version: &str, remove_instance: bool) -> ResultT<()> {
    let path = normalized(dir);
    {
        let mut guard = running().lock().map_err(|_| "游戏状态不可用")?;
        if guard
            .games
            .contains_key(&(path.clone(), version.to_string()))
        {
            return Err("该版本正在运行，请先退出游戏".into());
        }
        if !guard.deleting.insert(path.clone()) {
            return Err("正在删除此游戏目录的版本".into());
        }
    }
    struct Reservation(PathBuf);
    impl Drop for Reservation {
        fn drop(&mut self) {
            if let Ok(mut guard) = running().lock() {
                guard.deleting.remove(&self.0);
            }
        }
    }
    let _reservation = Reservation(path);
    let versions = dir.join("versions");
    let version_dir = safe_dir(&versions, version)?;
    let meta = loaders::version_json(dir, version)?;
    for entry in fs::read_dir(&versions)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let id = entry.file_name().to_string_lossy().to_string();
        if id == version || version_id(&id).is_err() {
            continue;
        }
        if let Ok(other) = loaders::version_json(dir, &id) {
            if other["cclBaseVersion"].as_str() == Some(version)
                || other["inheritsFrom"].as_str() == Some(version)
            {
                return Err(format!("版本 {id} 依赖该游戏本体，请先删除依赖版本"));
            }
        }
    }
    let instance = if remove_instance && meta["cclInstance"].as_bool() == Some(true) {
        let parent = dir.join("instances");
        if parent.join(version).exists() {
            Some(safe_dir(&parent, version)?)
        } else {
            None
        }
    } else {
        None
    };
    if let Some(instance) = instance {
        fs::remove_dir_all(instance).map_err(|e| format!("无法删除实例数据：{e}"))?;
    }
    fs::remove_dir_all(version_dir).map_err(|e| format!("无法删除版本文件：{e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn delete_version(
    game_dir: String,
    version: String,
    remove_instance: bool,
) -> ResultT<()> {
    version_id(&version)?;
    let dir = root(&game_dir)?;
    let lock = resource_lock(format!("version:{}:{version}", dir.display()));
    let _guard = lock
        .try_lock()
        .map_err(|_| "该版本正在安装，请稍后再删除")?;
    jobs::while_idle(&game_dir, || remove(&dir, &version, remove_instance))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ccl-version-manager-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("versions")).unwrap();
        path
    }
    fn version(dir: &Path, id: &str, metadata: serde_json::Value) {
        let path = dir.join("versions").join(id);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join(format!("{id}.json")),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
    }
    #[tokio::test]
    async fn protects_shared_data_dependencies_and_running_games() {
        let dir = fixture();
        let game = dir.to_string_lossy().to_string();
        version(&dir, "1.20.1", serde_json::json!({"id":"1.20.1"}));
        version(
            &dir,
            "fabric",
            serde_json::json!({"id":"fabric","cclBaseVersion":"1.20.1"}),
        );
        assert!(delete_version(game.clone(), "1.20.1".into(), false)
            .await
            .unwrap_err()
            .contains("依赖"));
        let running = track_launch(&dir, "fabric").unwrap();
        assert!(delete_version(game.clone(), "fabric".into(), false)
            .await
            .unwrap_err()
            .contains("正在运行"));
        drop(running);
        jobs::begin_job("version-test-job".into(), Some(game.clone())).unwrap();
        assert!(delete_version(game.clone(), "fabric".into(), false)
            .await
            .unwrap_err()
            .contains("任务"));
        jobs::end_job("version-test-job".into());
        fs::create_dir_all(dir.join("saves")).unwrap();
        fs::write(dir.join("saves/world"), b"keep").unwrap();
        delete_version(game.clone(), "fabric".into(), false)
            .await
            .unwrap();
        delete_version(game.clone(), "1.20.1".into(), false)
            .await
            .unwrap();
        assert_eq!(fs::read(dir.join("saves/world")).unwrap(), b"keep");
        version(
            &dir,
            "pack",
            serde_json::json!({"id":"pack","cclInstance":true}),
        );
        fs::create_dir_all(dir.join("instances/pack/saves")).unwrap();
        fs::write(dir.join("instances/pack/saves/world"), b"keep").unwrap();
        delete_version(game.clone(), "pack".into(), false)
            .await
            .unwrap();
        assert!(dir.join("instances/pack/saves/world").exists());
        version(
            &dir,
            "pack",
            serde_json::json!({"id":"pack","cclInstance":true}),
        );
        delete_version(game, "pack".into(), true).await.unwrap();
        assert!(!dir.join("instances/pack").exists());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_symlinked_version_directories() {
        let dir = fixture();
        let outside = fixture();
        std::os::unix::fs::symlink(&outside, dir.join("versions/link")).unwrap();
        assert!(
            delete_version(dir.to_string_lossy().into(), "link".into(), false)
                .await
                .is_err()
        );
        assert!(outside.exists());
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
