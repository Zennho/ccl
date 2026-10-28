use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

use crate::{http_client, ResultT};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    path: String,
    version: String,
    major: Option<u32>,
    managed: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct JavaProgress {
    job_id: Option<String>,
    message: String,
    current: u64,
    total: u64,
}
fn progress(app: &tauri::AppHandle, job_id: Option<&str>, message: &str, current: u64, total: u64) {
    let _ = app.emit(
        "java-progress",
        JavaProgress {
            job_id: job_id.map(str::to_string),
            message: message.into(),
            current,
            total,
        },
    );
}
fn runtimes_dir() -> ResultT<PathBuf> {
    Ok(dirs::data_dir()
        .ok_or("无法确定应用数据目录")?
        .join("ccl")
        .join("runtimes"))
}
fn validate_major(major: u32) -> ResultT<()> {
    if [8, 17, 21, 25].contains(&major) {
        Ok(())
    } else {
        Err("不支持的 Java 版本".into())
    }
}
fn java_exe() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}
fn java_in_home(home: &Path) -> PathBuf {
    home.join("bin").join(java_exe())
}
fn locate_java(dir: &Path, depth: u8) -> Option<PathBuf> {
    let java = java_in_home(dir);
    if java.is_file() {
        return Some(java);
    }
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(dir).ok()?.flatten() {
        if entry.file_type().ok()?.is_dir() {
            if let Some(found) = locate_java(&entry.path(), depth - 1) {
                return Some(found);
            }
        }
    }
    None
}
fn inspect(path: &Path, managed: bool) -> Option<JavaRuntime> {
    let mut cmd = Command::new(path);
    cmd.arg("-version");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd.output().ok()?;
    runtime_from_output(path, managed, &output)
}
fn runtime_from_output(
    path: &Path,
    managed: bool,
    output: &std::process::Output,
) -> Option<JavaRuntime> {
    if !output.status.success() {
        return None;
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let version = text
        .lines()
        .find(|line| line.contains("version"))?
        .split('"')
        .nth(1)?
        .to_string();
    let first = version.split('.').next()?.parse::<u32>().ok();
    let major = if first == Some(1) {
        version.split('.').nth(1).and_then(|s| s.parse().ok())
    } else {
        first
    };
    Some(JavaRuntime {
        path: path.to_string_lossy().to_string(),
        version,
        major,
        managed,
    })
}
fn scan_java() -> ResultT<Vec<JavaRuntime>> {
    let mut candidates = Vec::new();
    let root = runtimes_dir()?;
    for major in [8, 17, 21, 25] {
        if let Some(path) = locate_java(&root.join(format!("java-{major}")), 4) {
            candidates.push((path, true));
        }
    }
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        candidates.push((java_in_home(Path::new(&home)), false));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push((dir.join(java_exe()), false));
        }
    }
    let mut roots = Vec::new();
    #[cfg(target_os = "windows")]
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(variable) {
            for name in ["Java", "Eclipse Adoptium", "Microsoft", "Amazon Corretto"] {
                roots.push(PathBuf::from(&dir).join(name));
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        roots.push(PathBuf::from("/usr/lib/jvm"));
        roots.push(PathBuf::from("/usr/java"));
    }
    #[cfg(target_os = "macos")]
    {
        roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    }
    for root in roots {
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                if let Some(path) = locate_java(&entry.path(), 3) {
                    candidates.push((path, false));
                }
            }
        }
    }
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for (path, managed) in candidates {
        if !path.is_file() {
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.insert(canonical) {
            continue;
        }
        if let Some(java) = inspect(&path, managed) {
            results.push(java);
        }
    }
    Ok(results)
}
#[tauri::command]
pub async fn list_java() -> ResultT<Vec<JavaRuntime>> {
    tokio::task::spawn_blocking(scan_java)
        .await
        .map_err(|e| e.to_string())?
}

fn platform() -> ResultT<(&'static str, &'static str)> {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        return Err("当前操作系统不受支持".into());
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        _ => return Err("当前处理器架构不受支持".into()),
    };
    Ok((os, arch))
}
fn extract_zip(archive: &Path, target: &Path, job: Option<&str>) -> ResultT<()> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        crate::jobs::check(job)?;
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.enclosed_name().ok_or("压缩包包含不安全的路径")?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("ZIP 中的符号链接不受支持".into());
        }
        let path = target.join(name);
        if entry.is_dir() {
            fs::create_dir_all(path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = fs::File::create(path).map_err(|e| e.to_string())?;
            crate::jobs::copy_checked(&mut entry, &mut output, job)?;
        }
    }
    Ok(())
}
fn extract_tar(archive: &Path, target: &Path, job: Option<&str>) -> ResultT<()> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let checked = crate::jobs::CheckedReader {
        inner: file,
        job: job.map(str::to_owned),
    };
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(checked));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        crate::jobs::check(job)?;
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        if path.is_absolute()
            || path.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::Prefix(_)
                )
            })
        {
            return Err("压缩包包含不安全的路径".into());
        }
        if entry.header().entry_type().is_symlink() || entry.header().entry_type().is_hard_link() {
            let link = entry
                .link_name()
                .map_err(|e| e.to_string())?
                .ok_or("链接目标无效")?
                .into_owned();
            if link.is_absolute() {
                return Err("压缩包包含不安全的链接".into());
            }
            let mut depth = if entry.header().entry_type().is_symlink() {
                path.parent().map_or(0, |p| p.components().count())
            } else {
                0
            };
            for component in link.components() {
                match component {
                    std::path::Component::ParentDir => {
                        if depth == 0 {
                            return Err("压缩包包含不安全的链接".into());
                        }
                        depth -= 1;
                    }
                    std::path::Component::Normal(_) => depth += 1,
                    std::path::Component::CurDir => (),
                    _ => return Err("压缩包包含不安全的链接".into()),
                }
            }
        }
        if !entry.unpack_in(target).map_err(|e| e.to_string())? {
            return Err("无法安全解压 Java 文件".into());
        }
    }
    Ok(())
}
async fn install_impl(
    app: &tauri::AppHandle,
    major: u32,
    job_id: Option<&str>,
) -> ResultT<JavaRuntime> {
    validate_major(major)?;
    let (os, arch) = platform()?;
    let root = runtimes_dir()?;
    let final_dir = root.join(format!("java-{major}"));
    if final_dir.exists() {
        return Err(format!("Java {major} 已安装，请先在管理页面删除后再安装"));
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let staging = root.join(format!(".java-{major}-download"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let _cleanup = crate::jobs::CleanupPath::dir(staging.clone());
    let result = async {
        crate::jobs::check(job_id)?;
        progress(app, job_id, "正在获取 Java 版本信息", 0, 0);
        let client = http_client()?;
        let url = format!("https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jre&os={os}&vendor=eclipse");
        let data: Value = crate::jobs::race(job_id, async { client.get(url).timeout(Duration::from_secs(30)).send().await.map_err(|e| format!("无法获取 Java 下载信息: {e:#}"))?.error_for_status().map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string()) }).await?;
        let package = &data.as_array().and_then(|a| a.first()).ok_or("该平台没有可用的 Java 版本")?["binary"]["package"];
        let link = package["link"].as_str().ok_or("缺少 Java 下载地址")?;
        let checksum = package["checksum"].as_str().filter(|s| s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())).ok_or("缺少有效的 Java SHA-256 校验值")?;
        if !link.starts_with("https://") { return Err("Java 下载地址无效".into()); }
        let archive_path = staging.join("download.archive");
        let slot = crate::jobs::race(job_id, crate::download_slot()).await?;
        let mut response = crate::jobs::race(job_id, async { client.get(link).timeout(Duration::from_secs(900)).send().await.map_err(|e| format!("Java 下载失败: {e:#}"))?.error_for_status().map_err(|e| e.to_string()) }).await?;
        let total = response.content_length().or_else(|| package["size"].as_u64()).unwrap_or(0);
        let mut file = tokio::fs::File::create(&archive_path).await.map_err(|e| e.to_string())?;
        let mut hash = Sha256::new(); let mut current = 0u64; let mut last_progress = std::time::Instant::now();
        while let Some(chunk) = crate::jobs::race(job_id, async { response.chunk().await.map_err(|e| format!("Java 下载中断: {e:#}")) }).await? { hash.update(&chunk); file.write_all(&chunk).await.map_err(|e| e.to_string())?; current += chunk.len() as u64; if last_progress.elapsed() >= Duration::from_millis(250) { progress(app, job_id, "正在下载 Java", current, total); last_progress = std::time::Instant::now(); } }
        file.flush().await.map_err(|e| e.to_string())?; drop(file); drop(slot);
        if format!("{:x}", hash.finalize()) != checksum.to_ascii_lowercase() { return Err("Java 文件 SHA-256 校验失败".into()); }
        progress(app, job_id, "正在解压并验证 Java", 0, 0);
        let unpack_dir = staging.join("runtime"); fs::create_dir_all(&unpack_dir).map_err(|e| e.to_string())?;
        let archive = archive_path.clone(); let extract = unpack_dir.clone();
        let extraction_job = job_id.map(str::to_owned);
        tokio::task::spawn_blocking(move || if os == "windows" { extract_zip(&archive, &extract, extraction_job.as_deref()) } else { extract_tar(&archive, &extract, extraction_job.as_deref()) }).await.map_err(|e| e.to_string())??;
        crate::jobs::check(job_id)?;
        let java = locate_java(&unpack_dir, 4).ok_or("Java 安装包中未找到可执行文件")?;
        let relative = java.strip_prefix(&unpack_dir).map_err(|e| e.to_string())?.to_path_buf();
        let mut command=tokio::process::Command::new(&java);
        command.arg("-version").kill_on_drop(true);
        #[cfg(windows)]
        { command.creation_flags(0x08000000); }
        let output=crate::jobs::race(job_id,async {tokio::time::timeout(Duration::from_secs(15),command.output()).await.map_err(|_|"Java 验证超时".to_string())?.map_err(|e|format!("Java 验证失败：{e}"))}).await?;
        let checked = runtime_from_output(&java,true,&output).ok_or("下载的 Java 无法运行")?;
        crate::jobs::check(job_id)?;
        if checked.major != Some(major) { return Err("下载的 Java 版本与请求不匹配".into()); }
        fs::rename(&unpack_dir, &final_dir).map_err(|e| e.to_string())?;
        Ok(JavaRuntime { path: final_dir.join(relative).to_string_lossy().to_string(), ..checked })
    }.await;
    let _ = fs::remove_dir_all(&staging);
    result
}
#[tauri::command]
pub async fn install_java(
    app: tauri::AppHandle,
    major: u32,
    job_id: Option<String>,
) -> ResultT<JavaRuntime> {
    validate_major(major)?;
    let _lock = crate::jobs::race(job_id.as_deref(), async {
        Ok(crate::resource_lock(format!("java:{major}"))
            .lock_owned()
            .await)
    })
    .await?;
    install_impl(&app, major, job_id.as_deref()).await
}
#[tauri::command]
pub async fn remove_java(major: u32) -> ResultT<()> {
    validate_major(major)?;
    let lock = crate::resource_lock(format!("java:{major}"));
    let _guard = lock
        .try_lock()
        .map_err(|_| "此 Java 环境正在安装，请稍后再删除")?;
    let dir = runtimes_dir()?.join(format!("java-{major}"));
    if !dir.is_dir() {
        return Err("未找到由 CCL 管理的 Java 环境".into());
    }
    fs::remove_dir_all(dir).map_err(|e| format!("删除失败: {e}"))
}
