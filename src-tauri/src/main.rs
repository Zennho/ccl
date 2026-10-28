#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod archive;
mod auth;
mod content;
mod java;
mod jobs;
mod lan;
mod lan_core;
mod loaders;
mod server_catalog;
mod source_probe;
mod thumbnails;
mod version_manager;
mod window_detect;
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest, Sha1};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock, RwLock, Weak,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};

const MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
type ResultT<T> = Result<T, String>;

#[derive(Serialize)]
struct Version {
    id: String,
    name: String,
    kind: String,
    released: String,
    installed: bool,
    isolated: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    job_id: Option<String>,
    message: String,
    current: usize,
    total: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchOptions {
    version: String,
    username: String,
    java_path: String,
    game_dir: String,
    memory: u32,
    #[serde(default)]
    optimize: bool,
    #[serde(default)]
    jvm_args: String,
    #[serde(default)]
    game_args: String,
    #[serde(default)]
    account_mode: String,
    #[serde(default)]
    launch_id: Option<String>,
}

fn root(path: &str) -> ResultT<PathBuf> {
    if path.trim().is_empty() {
        return Err("游戏目录不能为空".into());
    }
    Ok(PathBuf::from(path))
}
fn version_id(id: &str) -> ResultT<()> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        || id == "."
        || id == ".."
    {
        return Err("无效的版本名称".into());
    }
    Ok(())
}
fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}
fn allowed(item: &Value) -> bool {
    let Some(rules) = item.get("rules").and_then(Value::as_array) else {
        return true;
    };
    let mut allow = false;
    for rule in rules {
        let os = &rule["os"];
        if let Some(name) = os["name"].as_str() {
            if name != os_name() {
                continue;
            }
        }
        if let Some(arch) = os["arch"].as_str() {
            let actual = std::env::consts::ARCH;
            let matches = match arch {
                "x86" => actual == "x86",
                "x86_64" => actual == "x86_64",
                "arm64" | "aarch64" => actual == "aarch64",
                _ => false,
            };
            if !matches {
                continue;
            }
        }
        // Feature-gated arguments require features this launcher does not enable.
        if rule
            .get("features")
            .and_then(Value::as_object)
            .is_some_and(|f| f.values().any(|v| v.as_bool() == Some(true)))
        {
            continue;
        }
        allow = rule["action"].as_str() == Some("allow");
    }
    allow
}
const MIRROR: &str = "https://bmclapi2.bangbang93.com";

fn mirror_url(url: &str) -> Option<String> {
    for (origin, prefix) in [
        ("https://piston-meta.mojang.com/", ""),
        ("https://launchermeta.mojang.com/", ""),
        ("https://piston-data.mojang.com/", ""),
        ("https://launcher.mojang.com/", ""),
        ("https://libraries.minecraft.net/", "maven/"),
        ("https://resources.download.minecraft.net/", "assets/"),
    ] {
        if let Some(path) = url.strip_prefix(origin) {
            return Some(format!("{MIRROR}/{prefix}{path}"));
        }
    }
    None
}
static MANUAL_PROXY: RwLock<Option<String>> = RwLock::new(None);

#[tauri::command]
fn configure_proxy(proxy_url: String) -> ResultT<()> {
    let value = proxy_url.trim();
    let proxy = if value.is_empty() {
        None
    } else {
        let url = reqwest::Url::parse(value)
            .map_err(|_| "代理地址格式无效，例如 http://127.0.0.1:7890")?;
        if !["http", "https", "socks5", "socks5h"].contains(&url.scheme())
            || url.host_str().is_none()
            || url.port_or_known_default().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || !(url.path().is_empty() || url.path() == "/")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("请输入不含账号、密码或路径的代理地址，例如 http://127.0.0.1:7890".into());
        }
        reqwest::Proxy::all(value).map_err(|_| "代理地址无效")?;
        Some(value.to_string())
    };
    *MANUAL_PROXY.write().map_err(|_| "无法保存代理设置")? = proxy;
    Ok(())
}
fn http_client() -> ResultT<reqwest::Client> {
    http_client_builder()?
        .build()
        .map_err(|e| format!("无法初始化网络请求: {e:#}"))
}
fn http_client_builder() -> ResultT<reqwest::ClientBuilder> {
    let proxy = MANUAL_PROXY.read().map_err(|_| "无法读取代理设置")?.clone();
    let mut builder = reqwest::Client::builder()
        .user_agent("CCL/0.1.9")
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60));
    if let Some(proxy) = proxy {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效")?);
    }
    Ok(builder)
}
fn network_error(error: reqwest::Error) -> String {
    use std::error::Error;
    let prefix = if error.is_timeout() {
        "连接或读取超时"
    } else if error.is_connect() {
        "连接服务器失败"
    } else if error.is_status() {
        "服务器返回错误"
    } else {
        "网络请求失败"
    };
    let error = error.without_url();
    let mut causes = Vec::new();
    let mut source = error.source();
    while let Some(cause) = source {
        causes.push(cause.to_string());
        source = cause.source();
    }
    if causes.is_empty() {
        format!("{prefix}: {error}")
    } else {
        format!("{prefix}: {}", causes.join(": "))
    }
}
async fn fetch_bytes(
    client: &reqwest::Client,
    url: &str,
    prefer_mirror: bool,
    timeout: Duration,
    sha: Option<&str>,
) -> ResultT<(Vec<u8>, bool)> {
    let mirror = mirror_url(url);
    let mut candidates = vec![(url.to_string(), false)];
    if let Some(mirror) = mirror {
        candidates.push((mirror, true));
    }
    if prefer_mirror {
        candidates.reverse();
    }
    let mut errors = Vec::new();
    for (candidate, is_mirror) in candidates {
        let label = if is_mirror { "镜像" } else { "官方" };
        for attempt in 0..2 {
            let result = async {
                let bytes = client
                    .get(&candidate)
                    .timeout(timeout)
                    .send()
                    .await?
                    .error_for_status()?
                    .bytes()
                    .await?;
                Ok::<_, reqwest::Error>(bytes)
            }
            .await;
            match result {
                Ok(bytes) => {
                    if sha.is_some_and(|expected| format!("{:x}", Sha1::digest(&bytes)) != expected)
                    {
                        errors.push(format!("{label}: 文件校验失败"));
                        break;
                    }
                    return Ok((bytes.to_vec(), is_mirror));
                }
                Err(e) => {
                    let retryable = e.is_connect()
                        || e.is_timeout()
                        || e.is_body()
                        || e.status().is_some_and(|s| s.is_server_error());
                    let detail = network_error(e);
                    if attempt == 0 && retryable {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        continue;
                    }
                    errors.push(format!("{label}: {detail}"));
                    break;
                }
            }
        }
    }
    Err(errors.join("；"))
}
async fn get_manifest(client: &reqwest::Client) -> ResultT<(Value, bool)> {
    let candidates = [
        (MANIFEST.to_string(), false),
        (mirror_url(MANIFEST).ok_or("版本镜像地址无效")?, true),
    ];
    let mut requests = stream::iter(candidates.into_iter().map(|(url, mirrored)| async move {
        let bytes = client
            .get(&url)
            .timeout(Duration::from_secs(12))
            .send()
            .await
            .map_err(network_error)?
            .error_for_status()
            .map_err(network_error)?
            .bytes()
            .await
            .map_err(network_error)?;
        let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if !value["versions"].is_array() {
            return Err("版本清单格式错误".to_string());
        }
        Ok::<_, String>((value, mirrored))
    }))
    .buffer_unordered(2);
    while let Some(result) = requests.next().await {
        if let Ok(manifest) = result {
            return Ok(manifest);
        }
    }
    let (bytes, mirrored) = fetch_bytes(client, MANIFEST, false, Duration::from_secs(12), None)
        .await
        .map_err(|e| format!("无法连接版本服务（{e}）"))?;
    let manifest: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("版本清单解析失败: {e}"))?;
    if !manifest["versions"].is_array() {
        return Err("版本清单格式错误".into());
    }
    Ok((manifest, mirrored))
}
static RESOURCE_LOCKS: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();
static DOWNLOAD_SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);
fn resource_lock(key: String) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = RESOURCE_LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
        return lock;
    }
    if locks.len() > 1024 {
        locks.retain(|_, value| value.strong_count() > 0);
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(key, Arc::downgrade(&lock));
    lock
}
async fn download_slot() -> ResultT<tokio::sync::OwnedSemaphorePermit> {
    DOWNLOAD_SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(16)))
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| e.to_string())
}
async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    sha: Option<&str>,
    prefer_mirror: bool,
) -> ResultT<bool> {
    let _file_lock = resource_lock(format!("file:{}", dest.display()))
        .lock_owned()
        .await;
    if dest.exists() {
        if let Some(expected) = sha {
            if let Ok(bytes) = tokio::fs::read(dest).await {
                if format!("{:x}", Sha1::digest(&bytes)) == expected {
                    return Ok(prefer_mirror);
                }
            }
        } else {
            return Ok(prefer_mirror);
        }
    }
    let _slot = download_slot().await?;
    let (bytes, mirrored) = fetch_bytes(client, url, prefer_mirror, Duration::from_secs(300), sha)
        .await
        .map_err(|e| format!("下载失败 {url}: {e}"))?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let name = dest.file_name().ok_or("下载目标无效")?.to_string_lossy();
    let temporary = dest.with_file_name(format!(
        ".{name}.ccl-{}-{}.part",
        std::process::id(),
        TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let _cleanup = jobs::CleanupPath::file(temporary.clone());
    if let Err(e) = fs::write(&temporary, bytes) {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(e.to_string());
    }
    if let Err(e) = fs::rename(&temporary, dest) {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(e.to_string());
    }
    Ok(mirrored)
}
fn report(
    app: &tauri::AppHandle,
    job_id: Option<&str>,
    message: &str,
    current: usize,
    total: usize,
) {
    let _ = app.emit(
        "install-progress",
        Progress {
            job_id: job_id.map(str::to_string),
            message: message.into(),
            current,
            total,
        },
    );
}
fn native_download<'a>(lib: &'a Value) -> Option<&'a Value> {
    let classifier = lib["natives"][os_name()].as_str()?.replace(
        "${arch}",
        if cfg!(target_pointer_width = "64") {
            "64"
        } else {
            "32"
        },
    );
    lib["downloads"]["classifiers"].get(&classifier)
}
fn extract_native(archive: &Path, dest: &Path, job: Option<&str>) -> ResultT<()> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        jobs::check(job)?;
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() || name.starts_with("META-INF") {
            continue;
        }
        let target = dest.join(name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(target).map_err(|e| e.to_string())?;
        jobs::copy_checked(&mut entry, &mut out, job)?;
    }
    Ok(())
}
#[tauri::command]
fn default_game_dir() -> ResultT<String> {
    Ok(dirs::data_dir()
        .ok_or("无法确定应用数据目录")?
        .join("ccl")
        .join("minecraft")
        .to_string_lossy()
        .to_string())
}
#[tauri::command]
async fn list_versions(game_dir: String) -> ResultT<Vec<Version>> {
    let client = http_client()?;
    let (manifest, _) = get_manifest(&client).await?;
    let dir = root(&game_dir)?;
    let mut result: Vec<Version> = manifest["versions"]
        .as_array()
        .ok_or("版本清单格式错误")?
        .iter()
        .filter(|v| v["type"] == "release")
        .filter_map(|v| {
            let id = v["id"].as_str()?;
            if version_id(id).is_err() {
                return None;
            }
            Some(Version {
                id: id.into(),
                name: id.into(),
                kind: "正式版".into(),
                released: v["releaseTime"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(10)
                    .collect(),
                installed: dir
                    .join("versions")
                    .join(id)
                    .join(format!("{id}.json"))
                    .exists(),
                isolated: false,
            })
        })
        .collect();
    let extra = installed_versions(game_dir)?;
    for v in extra {
        if !result.iter().any(|known| known.id == v.id) {
            result.insert(0, v);
        }
    }
    Ok(result)
}
#[tauri::command]
fn installed_versions(game_dir: String) -> ResultT<Vec<Version>> {
    let dir = root(&game_dir)?.join("versions");
    let mut versions = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().to_string();
            if version_id(&id).is_ok() && entry.path().join(format!("{id}.json")).exists() {
                let meta = loaders::version_json(
                    &entry
                        .path()
                        .parent()
                        .and_then(|p| p.parent())
                        .unwrap_or(Path::new(".")),
                    &id,
                )
                .unwrap_or(Value::Null);
                // Third-party installer profiles inherit their parent and are not directly launchable by CCL.
                if meta["inheritsFrom"].is_string() {
                    continue;
                }
                let kind = if meta["cclPackName"].is_string() {
                    "整合包"
                } else {
                    match meta["cclLoader"].as_str() {
                        Some("fabric") => "Fabric",
                        Some("quilt") => "Quilt",
                        Some("forge") => "Forge",
                        Some("neoforge") => "NeoForge",
                        _ => "正式版",
                    }
                };
                let name = meta["cclPackName"].as_str().unwrap_or(&id).to_string();
                versions.push(Version {
                    id,
                    name,
                    kind: kind.into(),
                    released: String::new(),
                    installed: true,
                    isolated: meta["cclInstance"].as_bool() == Some(true),
                });
            }
        }
    }
    versions.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(versions)
}
#[tauri::command]
async fn install_version(
    app: tauri::AppHandle,
    version: String,
    game_dir: String,
    job_id: Option<String>,
) -> ResultT<()> {
    let id = job_id.clone();
    jobs::race(
        id.as_deref(),
        install_version_impl(app, version, game_dir, job_id),
    )
    .await
}
async fn install_version_impl(
    app: tauri::AppHandle,
    version: String,
    game_dir: String,
    job_id: Option<String>,
) -> ResultT<()> {
    version_id(&version)?;
    let dir = root(&game_dir)?;
    report(&app, job_id.as_deref(), "正在准备游戏文件", 0, 0);
    let _version_lock = resource_lock(format!("version:{}:{version}", dir.display()))
        .lock_owned()
        .await;
    if dir
        .join("versions")
        .join(&version)
        .join(format!("{version}.json"))
        .is_file()
    {
        return Ok(());
    }
    let client = http_client()?;
    report(&app, job_id.as_deref(), "正在获取版本信息", 0, 0);
    let (manifest, mut prefer_mirror) = get_manifest(&client).await?;
    let entry = manifest["versions"]
        .as_array()
        .ok_or("版本清单格式错误")?
        .iter()
        .find(|v| v["id"] == version && v["type"] == "release")
        .ok_or("未找到该正式版")?;
    let (meta_bytes, meta_mirrored) = fetch_bytes(
        &client,
        entry["url"].as_str().ok_or("缺少版本地址")?,
        prefer_mirror,
        Duration::from_secs(30),
        entry["sha1"].as_str(),
    )
    .await?;
    prefer_mirror = meta_mirrored;
    let meta: Value =
        serde_json::from_slice(&meta_bytes).map_err(|e| format!("版本信息解析失败: {e}"))?;
    if let Some(client_url) = meta["downloads"]["client"]["url"].as_str() {
        if let Some(mirror) = mirror_url(client_url) {
            report(&app, job_id.as_deref(), "正在选择较快的下载线路", 0, 0);
            if let Some(fastest) = source_probe::fastest(&client, client_url, &mirror).await {
                prefer_mirror = fastest;
                report(
                    &app,
                    job_id.as_deref(),
                    if fastest {
                        "已选择镜像线路"
                    } else {
                        "已选择官方线路"
                    },
                    0,
                    0,
                );
            }
        }
    }
    let version_dir = dir.join("versions").join(&version);
    let mut files: Vec<(String, PathBuf, Option<String>, bool)> = Vec::new();
    let mut add = |item: &Value, path: PathBuf, native: bool| {
        if let Some(url) = item["url"].as_str() {
            files.push((
                url.into(),
                path,
                item["sha1"].as_str().map(str::to_string),
                native,
            ));
        }
    };
    add(
        &meta["downloads"]["client"],
        version_dir.join(format!("{version}.jar")),
        false,
    );
    for lib in meta["libraries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|l| allowed(l))
    {
        let art = &lib["downloads"]["artifact"];
        if let Some(path) = art["path"].as_str() {
            add(art, dir.join("libraries").join(path), false);
        }
        if let Some(native) = native_download(lib) {
            if let Some(path) = native["path"].as_str() {
                add(native, dir.join("libraries").join(path), true);
            }
        }
    }
    let index = &meta["assetIndex"];
    let index_id = index["id"].as_str().ok_or("缺少资源索引")?;
    let index_path = dir.join("assets/indexes").join(format!("{index_id}.json"));
    prefer_mirror = download(
        &client,
        index["url"].as_str().ok_or("缺少资源索引地址")?,
        &index_path,
        index["sha1"].as_str(),
        prefer_mirror,
    )
    .await?;
    let assets: Value = serde_json::from_slice(&fs::read(&index_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    for object in assets["objects"]
        .as_object()
        .ok_or("资源索引格式错误")?
        .values()
    {
        if let Some(hash) = object["hash"].as_str() {
            if hash.len() == 40 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
                files.push((
                    format!(
                        "https://resources.download.minecraft.net/{}/{}",
                        &hash[..2],
                        hash
                    ),
                    dir.join("assets/objects").join(&hash[..2]).join(hash),
                    Some(hash.into()),
                    false,
                ));
            }
        }
    }
    let total = files.len();
    let mirror = AtomicBool::new(prefer_mirror);
    let mut completed = 0usize;
    let mut last_report = std::time::Instant::now();
    let mut natives = Vec::new();
    let mut downloads = stream::iter(files.into_iter().map(|(url, path, sha, native)| {
        let client = &client;
        let mirror = &mirror;
        async move {
            let used = download(
                client,
                &url,
                &path,
                sha.as_deref(),
                mirror.load(Ordering::Relaxed),
            )
            .await?;
            mirror.store(used, Ordering::Relaxed);
            Ok::<_, String>((path, native))
        }
    }))
    .buffer_unordered(12);
    while let Some((path, native)) = downloads.try_next().await? {
        completed += 1;
        if native {
            natives.push(path);
        }
        if completed == total || last_report.elapsed() >= Duration::from_millis(150) {
            report(
                &app,
                job_id.as_deref(),
                "正在下载游戏文件",
                completed,
                total,
            );
            last_report = std::time::Instant::now();
        }
    }
    drop(downloads);
    report(&app, job_id.as_deref(), "正在解压运行库", total, total);
    for path in natives {
        extract_native(&path, &version_dir.join("natives"), job_id.as_deref())?;
    }
    jobs::check(job_id.as_deref())?;
    fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
    fs::write(
        version_dir.join(format!("{version}.json")),
        serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    report(&app, job_id.as_deref(), "安装完成", total, total);
    Ok(())
}
fn expand(s: &str, replacements: &[(&str, String)]) -> String {
    let mut result = s.to_string();
    for (key, value) in replacements {
        result = result.replace(&format!("${{{key}}}"), value);
    }
    result
}
fn arguments(value: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for item in value.as_array().into_iter().flatten() {
        if let Some(s) = item.as_str() {
            out.push(s.into());
        } else if allowed(item) {
            if let Some(s) = item["value"].as_str() {
                out.push(s.into());
            } else if let Some(arr) = item["value"].as_array() {
                out.extend(arr.iter().filter_map(Value::as_str).map(str::to_string));
            }
        }
    }
    out
}
fn parse_extra_args(input: &str) -> ResultT<Vec<String>> {
    let mut result = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut started = false;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars
                .peek()
                .is_some_and(|next| *next == '\\' || *next == '"' || *next == '\'') =>
            {
                token.push(chars.next().unwrap());
                started = true;
            }
            '"' | '\'' if quote.is_none() => {
                quote = Some(c);
                started = true;
            }
            c if quote == Some(c) => quote = None,
            c if c.is_whitespace() && quote.is_none() => {
                if started {
                    result.push(std::mem::take(&mut token));
                    started = false;
                }
            }
            c => {
                token.push(c);
                started = true;
            }
        }
    }
    if quote.is_some() {
        return Err("自定义参数中的引号未闭合".into());
    }
    if started {
        result.push(token);
    }
    Ok(result)
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameExit {
    launch_id: Option<String>,
    version: String,
    success: bool,
    code: Option<i32>,
    log_path: String,
    game_dir: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GameWindowEvent {
    launch_id: Option<String>,
    version: String,
    status: &'static str,
}
#[tauri::command]
fn open_version_folder(game_dir: String, version: String) -> ResultT<()> {
    let dir = root(&game_dir)?;
    // Validate both the version ID and its metadata before opening its directory.
    let metadata = loaders::version_json(&dir, &version)?;
    let folder = loaders::runtime_dir(&dir, &version, &metadata);
    fs::create_dir_all(&folder).map_err(|e| format!("无法创建游戏目录：{e}"))?;
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(folder)
        .spawn()
        .map_err(|e| format!("无法打开版本文件夹：{e}"))?;
    Ok(())
}

#[tauri::command]
fn open_game_log(game_dir: String, version: String, log_name: Option<String>) -> ResultT<()> {
    let dir = root(&game_dir)?;
    let meta = loaders::version_json(&dir, &version)?;
    let logs = loaders::runtime_dir(&dir, &version, &meta)
        .join("logs")
        .join("ccl");
    let path = if let Some(name) = log_name {
        if !name.starts_with("launch-")
            || !name.ends_with(".log")
            || name.contains(['/', '\\'])
            || name.contains("..")
        {
            return Err("日志文件名无效".into());
        }
        let path = logs.join(name);
        if !path.is_file() {
            return Err("日志文件不存在".into());
        }
        path
    } else {
        fs::read_dir(&logs)
            .map_err(|_| "该版本还没有 CCL 启动日志")?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "log"))
            .max_by_key(|p| fs::metadata(p).and_then(|m| m.modified()).ok())
            .ok_or("该版本还没有 CCL 启动日志")?
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32.exe");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(path)
        .spawn()
        .map_err(|e| format!("无法打开日志：{e}"))?;
    Ok(())
}
#[tauri::command]
async fn launch_game(app: tauri::AppHandle, options: LaunchOptions) -> ResultT<String> {
    version_id(&options.version)?;
    if options.username.is_empty()
        || options.username.len() > 16
        || !options
            .username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        return Err("玩家名须为 1–16 位英文字母、数字或下划线".into());
    }
    if !(512..=32768).contains(&options.memory) {
        return Err("内存须在 512–32768 MB 之间".into());
    }
    let online = if options.account_mode == "microsoft" {
        Some(auth::launch_identity().await?)
    } else if options.account_mode.is_empty() || options.account_mode == "offline" {
        None
    } else {
        return Err("未知账户类型".into());
    };
    let extra_jvm = parse_extra_args(&options.jvm_args)?;
    let extra_game = parse_extra_args(&options.game_args)?;
    let dir = root(&options.game_dir)?;
    let running_version = version_manager::track_launch(&dir, &options.version)?;
    let version_dir = dir.join("versions").join(&options.version);
    let meta: Value = serde_json::from_slice(
        &fs::read(version_dir.join(format!("{}.json", options.version)))
            .map_err(|_| "版本尚未安装")?,
    )
    .map_err(|e| e.to_string())?;
    let base_id = meta["cclBaseVersion"].as_str().unwrap_or(&options.version);
    version_id(base_id)?;
    let base_dir = dir.join("versions").join(base_id);
    let runtime_dir = loaders::runtime_dir(&dir, &options.version, &meta);
    fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;
    let mut cp = Vec::new();
    for lib in meta["libraries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|l| allowed(l))
    {
        if let Some(path) = lib["downloads"]["artifact"]["path"].as_str() {
            cp.push(
                dir.join("libraries")
                    .join(path)
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    cp.push(
        base_dir
            .join(format!("{base_id}.jar"))
            .to_string_lossy()
            .to_string(),
    );
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    // Minecraft's offline UUID is a name-based UUID with no namespace prefix.
    let digest = online
        .as_ref()
        .map(|a| a.uuid.clone())
        .unwrap_or_else(|| md5_offline_uuid(&options.username));
    let player_name = online
        .as_ref()
        .map(|a| a.name.clone())
        .unwrap_or_else(|| options.username.clone());
    let access_token = online
        .as_ref()
        .map(|a| a.access_token.clone())
        .unwrap_or_else(|| "0".into());
    let replacements = [
        ("auth_player_name", player_name),
        ("version_name", options.version.clone()),
        ("game_directory", runtime_dir.to_string_lossy().to_string()),
        (
            "assets_root",
            dir.join("assets").to_string_lossy().to_string(),
        ),
        (
            "assets_index_name",
            meta["assetIndex"]["id"].as_str().unwrap_or("legacy").into(),
        ),
        ("auth_uuid", digest),
        ("auth_access_token", access_token),
        (
            "user_type",
            if online.is_some() {
                "msa".into()
            } else {
                "legacy".into()
            },
        ),
        ("version_type", "CCL 0.1.9".into()),
        (
            "natives_directory",
            base_dir.join("natives").to_string_lossy().to_string(),
        ),
        ("launcher_name", "CCL".into()),
        ("launcher_version", "0.1.9".into()),
        ("classpath", cp.join(sep)),
        ("classpath_separator", sep.into()),
        (
            "library_directory",
            dir.join("libraries").to_string_lossy().to_string(),
        ),
        ("user_properties", "{}".into()),
        (
            "auth_xuid",
            online
                .as_ref()
                .map(|a| a.xuid.clone())
                .unwrap_or_else(|| "0".into()),
        ),
        ("clientid", "0".into()),
    ];
    let mut cmd = Command::new(if options.java_path.trim().is_empty() {
        "java"
    } else {
        &options.java_path
    });
    cmd.current_dir(&runtime_dir)
        .arg(format!("-Xmx{}M", options.memory));
    if options.optimize {
        cmd.arg("-XX:+UseG1GC");
    }
    cmd.args(extra_jvm);
    let jvm = arguments(&meta["arguments"]["jvm"]);
    if jvm.is_empty() {
        cmd.arg(format!(
            "-Djava.library.path={}",
            base_dir.join("natives").display()
        ))
        .arg("-cp")
        .arg(cp.join(sep));
    } else {
        for arg in jvm {
            cmd.arg(expand(&arg, &replacements));
        }
    }
    cmd.arg(meta["mainClass"].as_str().ok_or("版本缺少主类")?);
    let mut game = arguments(&meta["arguments"]["game"]);
    if game.is_empty() {
        game = meta["minecraftArguments"]
            .as_str()
            .unwrap_or("")
            .split_whitespace()
            .map(str::to_string)
            .collect();
    }
    for arg in game {
        cmd.arg(expand(&arg, &replacements));
    }
    cmd.args(extra_game);
    let log_dir = runtime_dir.join("logs").join("ccl");
    fs::create_dir_all(&log_dir).map_err(|e| format!("无法创建日志目录：{e}"))?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    static LOG_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let log_path = log_dir.join(format!(
        "launch-{stamp}-{}.log",
        LOG_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut log = fs::File::create(&log_path).map_err(|e| format!("无法创建启动日志：{e}"))?;
    use std::io::Write;
    writeln!(
        log,
        "CCL 0.1.9 | 游戏版本 {} | 启动时间 {}",
        options.version, stamp
    )
    .map_err(|e| e.to_string())?;
    cmd.stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 Java：{e}。请检查 Java 路径和版本。"))?;
    let path_text = log_path.to_string_lossy().to_string();
    let event_path = path_text.clone();
    let version = options.version;
    let game_dir = options.game_dir;
    let launch_id = options.launch_id;
    let pid = child.id();
    std::thread::spawn(move || {
        let _running_version = running_version;
        let start = std::time::Instant::now();
        let mut monitor = window_detect::Monitor::default();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Err(error) => break Err(error),
                Ok(None) => {}
            }
            if let Some(notice) = monitor.observe(window_detect::probe(pid), start.elapsed()) {
                match notice {
                    window_detect::Notice::Visible => {
                        match child.try_wait() {
                            Ok(Some(status)) => break Ok(status),
                            Err(error) => break Err(error),
                            Ok(None) => {}
                        }
                        let _ = app.emit(
                            "game-window-ready",
                            GameWindowEvent {
                                launch_id: launch_id.clone(),
                                version: version.clone(),
                                status: "visible",
                            },
                        );
                        break child.wait();
                    }
                    window_detect::Notice::Unavailable | window_detect::Notice::Slow => {
                        let status = if notice == window_detect::Notice::Unavailable {
                            "unavailable"
                        } else {
                            "slow"
                        };
                        let _ = app.emit(
                            "game-window-status",
                            GameWindowEvent {
                                launch_id: launch_id.clone(),
                                version: version.clone(),
                                status,
                            },
                        );
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(800));
        };
        let (success, code) = match status {
            Ok(s) => (s.success(), s.code()),
            Err(_) => (false, None),
        };
        if let Ok(mut file) = fs::OpenOptions::new().append(true).open(&log_path) {
            let _ = writeln!(file, "\nCCL: 进程退出状态 {:?}", code);
        }
        let _ = app.emit(
            "game-exit",
            GameExit {
                launch_id,
                version,
                success,
                code,
                log_path: event_path,
                game_dir,
            },
        );
    });
    Ok(path_text)
}
fn md5_offline_uuid(name: &str) -> String {
    let digest = md5::compute(format!("OfflinePlayer:{name}"));
    let mut b = digest.0;
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lan::ipv6_addresses,
            lan::start_ipv6_room,
            lan::stop_ipv6_room,
            lan::test_ipv6_connection,
            server_catalog::public_servers,
            thumbnails::fetch_thumbnail,
            jobs::begin_job,
            jobs::cancel_job,
            jobs::end_job,
            version_manager::delete_version,
            default_game_dir,
            configure_proxy,
            list_versions,
            installed_versions,
            install_version,
            launch_game,
            open_game_log,
            open_version_folder,
            auth::begin_microsoft_login,
            auth::open_microsoft_login,
            auth::complete_microsoft_login,
            auth::cancel_microsoft_login,
            auth::logout_microsoft,
            auth::microsoft_account,
            auth::get_appearance,
            auth::preview_texture,
            auth::upload_account_skin,
            auth::reset_account_skin,
            auth::set_account_cape,
            archive::inspect_game_archive,
            archive::export_game,
            archive::import_game,
            java::list_java,
            java::install_java,
            java::remove_java,
            loaders::install_loader,
            content::search_content,
            content::open_content_page,
            content::content_links,
            content::curseforge_description,
            content::list_mod_versions,
            content::list_mods,
            content::set_mod_enabled,
            content::remove_mod,
            content::install_mod,
            content::install_modpack
        ])
        .run(tauri::generate_context!())
        .expect("error while running CCL");
}

#[cfg(test)]
mod download_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn cancelling_a_download_releases_shared_file_for_another_job() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (started, ready) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 512];
            first.read(&mut buffer).await.unwrap();
            let _ = started.send(());
            let (mut second, _) = listener.accept().await.unwrap();
            second.read(&mut buffer).await.unwrap();
            second
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest")
                .await
                .unwrap();
        });
        let path = std::env::temp_dir().join(format!("ccl-cancel-download-{}", std::process::id()));
        let _ = fs::remove_file(&path);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://{address}/file");
        jobs::begin_job("download-cancel-a".into(), None).unwrap();
        let worker = {
            let client = client.clone();
            let path = path.clone();
            let url = url.clone();
            tokio::spawn(async move {
                jobs::race(
                    Some("download-cancel-a"),
                    download(&client, &url, &path, None, false),
                )
                .await
            })
        };
        ready.await.unwrap();
        jobs::cancel_job("download-cancel-a".into()).unwrap();
        assert_eq!(worker.await.unwrap().unwrap_err(), jobs::CANCELLED);
        assert!(!path.exists());
        tokio::time::timeout(
            Duration::from_secs(3),
            download(&client, &url, &path, None, false),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"test");
        jobs::end_job("download-cancel-a".into());
        server.await.unwrap();
        fs::remove_file(path).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn downloads_in_parallel_and_deduplicates_targets() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let active = Arc::new(AtomicUsize::new(0));
        let maximum = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(AtomicUsize::new(0));
        let server = {
            let (active, maximum, requests) = (active.clone(), maximum.clone(), requests.clone());
            tokio::spawn(async move {
                let mut handlers = Vec::new();
                for _ in 0..11 {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let (active, maximum, requests) =
                        (active.clone(), maximum.clone(), requests.clone());
                    handlers.push(tokio::spawn(async move {
                        let mut buf = [0u8; 2048];
                        socket.read(&mut buf).await.unwrap();
                        requests.fetch_add(1, Ordering::SeqCst);
                        let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(current, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest").await.unwrap();
                        active.fetch_sub(1, Ordering::SeqCst);
                    }));
                }
                for handler in handlers {
                    handler.await.unwrap();
                }
            })
        };
        let root = std::env::temp_dir().join(format!("ccl-download-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut jobs = Vec::new();
        for i in 0..13 {
            let path = root.join(if i < 3 {
                "shared".to_string()
            } else {
                format!("file-{i}")
            });
            let url = format!("http://{address}/file-{i}");
            let client = client.clone();
            jobs.push(tokio::spawn(async move {
                download(
                    &client,
                    &url,
                    &path,
                    Some("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"),
                    false,
                )
                .await
                .unwrap();
            }));
        }
        tokio::time::timeout(Duration::from_secs(10), async {
            for job in jobs {
                job.await.unwrap();
            }
            server.await.unwrap();
        })
        .await
        .expect("download test timed out");
        assert_eq!(requests.load(Ordering::SeqCst), 11);
        assert!((4..=16).contains(&maximum.load(Ordering::SeqCst)));
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod launch_options_tests {
    use super::parse_extra_args;

    #[test]
    fn extra_arguments_preserve_quoted_values_and_reject_unclosed_quotes() {
        assert_eq!(
            parse_extra_args(r#"-Dmode=fast "-Dpath=C:\\My Games" --width 1200"#).unwrap(),
            vec!["-Dmode=fast", r"-Dpath=C:\My Games", "--width", "1200"]
        );
        assert!(parse_extra_args("--name \"unterminated").is_err());
    }
}
