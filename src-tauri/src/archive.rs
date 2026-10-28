use crate::{install_version, loaders, report, resource_lock, root, version_id, ResultT};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_FILES: usize = 100_000;
const MAX_SIZE: u64 = 64 * 1024 * 1024 * 1024;
const MAX_FILE: u64 = 8 * 1024 * 1024 * 1024;
static SERIAL: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSettings {
    memory: u32,
    optimize: bool,
    jvm_args: String,
    game_args: String,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveManifest {
    format: String,
    format_version: u32,
    name: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    include_saves: bool,
    launch_settings: Option<LaunchSettings>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    version: String,
    launch_settings: Option<LaunchSettings>,
}
fn validate_manifest(manifest: &ArchiveManifest) -> ResultT<()> {
    if manifest.format != "ccl-instance" || manifest.format_version != 1 {
        return Err("不是受支持的 CCL 游戏导出包".into());
    }
    version_id(&manifest.game_version)?;
    if manifest.game_version.len() > 100 {
        return Err("游戏版本名称过长".into());
    }
    if !["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&manifest.loader.as_str()) {
        return Err("导出包中的加载器不受支持".into());
    }
    if manifest.name.trim().is_empty() || manifest.name.len() > 256 {
        return Err("导出包中的游戏名称无效".into());
    }
    if let Some(settings) = &manifest.launch_settings {
        if !(512..=32768).contains(&settings.memory)
            || settings.jvm_args.len() > 16_384
            || settings.game_args.len() > 16_384
        {
            return Err("导出包中的启动设置无效".into());
        }
    }
    if manifest.loader != "vanilla"
        && manifest
            .loader_version
            .as_deref()
            .is_none_or(|v| v.is_empty() || v.len() > 128)
    {
        return Err("导出包缺少加载器版本".into());
    }
    Ok(())
}
fn excluded(name: &str, include_saves: bool) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "assets"
            | "libraries"
            | "versions"
            | "instances"
            | "ccl-cache"
            | "logs"
            | "crash-reports"
            | "screenshots"
            | "natives"
            | "launcher_accounts.json"
            | "launcher_profiles.json"
            | "usercache.json"
            | "session.lock"
    ) || (!include_saves && name.eq_ignore_ascii_case("saves"))
}
fn portable_path(value: &str) -> ResultT<PathBuf> {
    if value.is_empty()
        || value.contains(['\\', ':', '\0'])
        || value.starts_with('/')
        || value.ends_with('/')
    {
        return Err("导出包包含不安全路径".into());
    }
    let path = Path::new(value);
    for part in path.components() {
        let Component::Normal(name) = part else {
            return Err("导出包包含不安全路径".into());
        };
        let text = name.to_str().ok_or("导出包含非 UTF-8 文件名")?;
        if text.ends_with(['.', ' '])
            || text
                .chars()
                .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err(format!("文件名在部分系统中不可用：{text}"));
        }
        let stem = text.split('.').next().unwrap_or("").to_ascii_uppercase();
        if [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&stem.as_str())
        {
            return Err(format!("文件名在 Windows 中不可用：{text}"));
        }
    }
    Ok(path.to_path_buf())
}
fn collect_files(
    dir: &Path,
    relative: &Path,
    include_saves: bool,
    files: &mut Vec<(PathBuf, String)>,
) -> ResultT<()> {
    let entries = fs::read_dir(dir.join(relative)).map_err(|e| format!("读取游戏文件失败：{e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let text = name.to_str().ok_or("存在无法导出的文件名")?;
        if relative.as_os_str().is_empty() && excluded(text, include_saves) {
            continue;
        }
        if text.eq_ignore_ascii_case("session.lock") {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            return Err(format!("无法导出符号链接：{}", entry.path().display()));
        }
        let child = relative.join(name);
        if file_type.is_dir() {
            collect_files(dir, &child, include_saves, files)?;
        } else if file_type.is_file() {
            let path = child
                .to_str()
                .ok_or("存在无法导出的文件名")?
                .replace(std::path::MAIN_SEPARATOR, "/");
            portable_path(&path)?;
            files.push((entry.path(), path));
            if files.len() > MAX_FILES {
                return Err("游戏文件数量过多".into());
            }
        }
    }
    Ok(())
}
fn manifest_from_zip<R: Read + io::Seek>(zip: &mut ZipArchive<R>) -> ResultT<ArchiveManifest> {
    let mut file = zip
        .by_name("ccl-instance.json")
        .map_err(|_| "不是 CCL 游戏导出包")?;
    if file.size() > 1024 * 1024 {
        return Err("导出包清单过大".into());
    }
    let mut data = String::new();
    file.read_to_string(&mut data)
        .map_err(|e| format!("读取导出包失败：{e}"))?;
    let manifest: ArchiveManifest =
        serde_json::from_str(&data).map_err(|e| format!("导出包清单无效：{e}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
fn validate_zip<R: Read + io::Seek>(zip: &mut ZipArchive<R>, include_saves: bool) -> ResultT<()> {
    if zip.len() > MAX_FILES + 1 {
        return Err("导出包文件数量过多".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name();
        if file.is_dir() {
            return Err("导出包包含不支持的目录条目".into());
        }
        if file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("导出包不能包含符号链接".into());
        }
        if name == "ccl-instance.json" {
            if !seen.insert(name.to_ascii_lowercase()) {
                return Err("导出包含重复文件".into());
            }
            continue;
        }
        let rel = name.strip_prefix("instance/").ok_or("导出包含未知文件")?;
        portable_path(rel)?;
        if rel
            .split('/')
            .next()
            .is_some_and(|v| excluded(v, include_saves))
        {
            return Err("导出包包含不允许的游戏目录".into());
        }
        if !seen.insert(name.to_lowercase()) {
            return Err("导出包含重复文件".into());
        }
        if file.size() > MAX_FILE {
            return Err("导出包中的单个文件过大".into());
        }
        total = total.checked_add(file.size()).ok_or("导出包过大")?;
        if total > MAX_SIZE {
            return Err("导出包解压后过大".into());
        }
    }
    Ok(())
}
fn unique() -> String {
    format!(
        "{}-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}
fn read_archive(path: &str) -> ResultT<(ZipArchive<File>, ArchiveManifest)> {
    let file = File::open(path).map_err(|e| format!("无法打开导入文件：{e}"))?;
    let mut zip = ZipArchive::new(file).map_err(|e| format!("导入文件不是有效的 ZIP：{e}"))?;
    let manifest = manifest_from_zip(&mut zip)?;
    validate_zip(&mut zip, manifest.include_saves)?;
    Ok((zip, manifest))
}
#[tauri::command]
pub async fn inspect_game_archive(path: String) -> ResultT<ArchiveManifest> {
    tauri::async_runtime::spawn_blocking(move || read_archive(&path).map(|(_, m)| m))
        .await
        .map_err(|e| e.to_string())?
}
fn export_archive(
    app: &tauri::AppHandle,
    source: &Path,
    dest: &Path,
    manifest: &ArchiveManifest,
    job: Option<&str>,
) -> ResultT<()> {
    let mut files = Vec::new();
    if source.exists() {
        collect_files(source, Path::new(""), manifest.include_saves, &mut files)?;
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for (path, name) in &files {
        if !seen.insert(name.to_lowercase()) {
            return Err(format!("文件名大小写冲突：{name}"));
        }
        let len = fs::metadata(path).map_err(|e| e.to_string())?.len();
        if len > MAX_FILE {
            return Err(format!("文件过大：{name}"));
        }
        total = total.checked_add(len).ok_or("游戏文件过大")?;
        if total > MAX_SIZE {
            return Err("游戏文件过大".into());
        }
    }
    let parent = dest
        .parent()
        .filter(|p| p.is_dir())
        .ok_or("导出目标目录不存在")?;
    if source.exists() {
        let source = fs::canonicalize(source).map_err(|e| e.to_string())?;
        let target_dir = fs::canonicalize(parent).map_err(|e| e.to_string())?;
        if target_dir.starts_with(source) {
            return Err("请将导出包保存到游戏目录之外".into());
        }
    }
    let tmp = parent.join(format!(".ccl-export-{}.tmp", unique()));
    let backup = parent.join(format!(".ccl-export-{}.bak", unique()));
    let outcome = (|| -> ResultT<()> {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(true);
        zip.start_file("ccl-instance.json", options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        for (i, (path, name)) in files.iter().enumerate() {
            report(app, job, &format!("正在打包 {name}"), i, files.len());
            zip.start_file(format!("instance/{name}"), options)
                .map_err(|e| e.to_string())?;
            io::copy(&mut File::open(path).map_err(|e| e.to_string())?, &mut zip)
                .map_err(|e| format!("打包文件失败：{e}"))?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        let exists = dest.exists();
        if exists {
            if !dest.is_file() {
                return Err("导出目标不是文件".into());
            }
            fs::rename(dest, &backup).map_err(|e| format!("无法替换已有文件：{e}"))?;
        }
        if let Err(e) = fs::rename(&tmp, dest) {
            if exists {
                let _ = fs::rename(&backup, dest);
            }
            return Err(format!("保存导出包失败：{e}"));
        }
        if exists {
            let _ = fs::remove_file(&backup);
        }
        report(app, job, "导出完成", files.len(), files.len());
        Ok(())
    })();
    if outcome.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    outcome
}
#[tauri::command]
pub async fn export_game(
    app: tauri::AppHandle,
    game_dir: String,
    version: String,
    path: String,
    include_saves: bool,
    launch_settings: Option<LaunchSettings>,
    job_id: Option<String>,
) -> ResultT<()> {
    let dir = root(&game_dir)?;
    let meta = loaders::version_json(&dir, &version)?;
    let loader = meta["cclLoader"].as_str().unwrap_or("vanilla").to_string();
    let manifest = ArchiveManifest {
        format: "ccl-instance".into(),
        format_version: 1,
        name: meta["cclPackName"].as_str().unwrap_or(&version).into(),
        game_version: meta["cclBaseVersion"].as_str().unwrap_or(&version).into(),
        loader_version: meta["cclLoaderVersion"].as_str().map(str::to_string),
        loader,
        include_saves,
        launch_settings,
    };
    validate_manifest(&manifest)?;
    let source = loaders::runtime_dir(&dir, &version, &meta);
    let dest = PathBuf::from(path);
    let _lock = resource_lock(format!("mods:{}", source.display()))
        .lock_owned()
        .await;
    tauri::async_runtime::spawn_blocking(move || {
        export_archive(&app, &source, &dest, &manifest, job_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn extract_archive(
    app: &tauri::AppHandle,
    path: &str,
    staging: &Path,
    job: Option<&str>,
) -> ResultT<ArchiveManifest> {
    let (mut zip, manifest) = read_archive(path)?;
    fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    let count = zip.len();
    for i in 0..count {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name == "ccl-instance.json" {
            continue;
        }
        let relative = portable_path(name.strip_prefix("instance/").ok_or("导出包包含未知文件")?)?;
        let target = staging.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        io::copy(&mut file, &mut output).map_err(|e| format!("解压文件失败：{e}"))?;
        report(app, job, &format!("正在导入 {name}"), i, count);
    }
    Ok(manifest)
}
#[tauri::command]
pub async fn import_game(
    app: tauri::AppHandle,
    game_dir: String,
    path: String,
    java_path: String,
    job_id: Option<String>,
) -> ResultT<ImportResult> {
    let dir = root(&game_dir)?;
    let id = format!("ccl-import-{}", unique());
    version_id(&id)?;
    let staging = dir.join("instances").join(format!(".{id}.importing"));
    let extracted = {
        let app = app.clone();
        let path = path.clone();
        let staging = staging.clone();
        let job = job_id.clone();
        tauri::async_runtime::spawn_blocking(move || {
            extract_archive(&app, &path, &staging, job.as_deref())
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let manifest = match extracted {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };
    let outcome: ResultT<ImportResult> = async {
        report(&app, job_id.as_deref(), "正在准备游戏本体", 0, 0);
        install_version(
            app.clone(),
            manifest.game_version.clone(),
            game_dir.clone(),
            job_id.clone(),
        )
        .await?;
        let source_version = if manifest.loader == "vanilla" {
            manifest.game_version.clone()
        } else {
            loaders::install_loader(
                app.clone(),
                game_dir.clone(),
                manifest.game_version.clone(),
                manifest.loader.clone(),
                manifest.loader_version.clone(),
                Some(java_path),
                job_id.clone(),
            )
            .await?
        };
        let mut meta = loaders::version_json(&dir, &source_version)?;
        meta["id"] = json!(id);
        meta["cclBaseVersion"] = json!(manifest.game_version);
        meta["cclLoader"] = json!(manifest.loader);
        meta["cclInstance"] = json!(true);
        meta["cclPackName"] = json!(manifest.name);
        let target = dir.join("instances").join(&id);
        let version_dir = dir.join("versions").join(&id);
        if target.exists() || version_dir.exists() {
            return Err("导入目标已存在，请重试".into());
        }
        fs::rename(&staging, &target).map_err(|e| format!("无法保存游戏目录：{e}"))?;
        let save = (|| -> ResultT<()> {
            fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
            fs::write(
                version_dir.join(format!("{id}.json")),
                serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(e) = save {
            let _ = fs::remove_dir_all(&version_dir);
            let _ = fs::remove_dir_all(&target);
            return Err(e);
        }
        Ok(ImportResult {
            version: id,
            launch_settings: manifest.launch_settings,
        })
    }
    .await;
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn rejects_unsafe_paths_and_unexpected_saves() {
        for path in [
            "../outside",
            "foo/../../outside",
            "mods\\escape",
            "C:drive",
            "CON.txt",
            "trailing.",
        ] {
            assert!(portable_path(path).is_err(), "{path}");
        }
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer
            .start_file("instance/saves/world.dat", options)
            .unwrap();
        writer.write_all(b"world").unwrap();
        let archive = writer.finish().unwrap();
        let mut zip = ZipArchive::new(Cursor::new(archive.into_inner())).unwrap();
        assert!(validate_zip(&mut zip, false).is_err());
        assert!(validate_zip(&mut zip, true).is_ok());
    }
}
