use super::{
    excluded, portable_path, validate_manifest, ArchiveManifest, MAX_FILE, MAX_FILES, MAX_SIZE,
};
use crate::ResultT;
use futures_util::{stream, StreamExt, TryStreamExt};
use serde_json::Value;
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, Write},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use zip::ZipArchive;

#[derive(Clone, Debug)]
pub struct PackFile {
    pub path: String,
    pub urls: Vec<String>,
    pub sha1: Option<String>,
    pub sha512: Option<String>,
}
pub struct Pack {
    pub manifest: ArchiveManifest,
    pub prefix: String,
    pub files: Vec<PackFile>,
    pub unpacked_size: u64,
}
fn valid_url(s: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(s) else {
        return false;
    };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || s.len() > 4096
    {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return false;
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(ip)
                if ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_unspecified()
                    || ip.is_multicast() =>
            {
                return false
            }
            std::net::IpAddr::V6(ip)
                if ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
                    || ip.is_multicast()
                    || ip.to_ipv4_mapped().is_some() =>
            {
                return false
            }
            _ => {}
        }
    }
    true
}
fn parse_hash(v: &Value, name: &str, length: usize) -> ResultT<Option<String>> {
    match v[name].as_str() {
        Some(s) if s.len() == length && s.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Ok(Some(s.to_ascii_lowercase()))
        }
        Some(_) => Err(format!("整合包的 {name} 校验值无效")),
        None => Ok(None),
    }
}
pub fn inspect<R: Read + Seek>(zip: &mut ZipArchive<R>, job: Option<&str>) -> ResultT<Pack> {
    if zip.len() > MAX_FILES + 2 {
        return Err("整合包文件数量过多".into());
    }
    let indices: Vec<String> = zip
        .file_names()
        .filter(|n| {
            *n == "modrinth.index.json"
                || (n.ends_with("/modrinth.index.json") && n.matches('/').count() == 1)
        })
        .map(str::to_owned)
        .collect();
    if indices.len() != 1 {
        return Err("无法找到唯一的 Modrinth 整合包清单".into());
    }
    let index = &indices[0];
    let prefix = index
        .strip_suffix("modrinth.index.json")
        .unwrap()
        .to_string();
    let value: Value = {
        let mut file = zip.by_name(index).map_err(|e| e.to_string())?;
        if file.size() > 10_000_000 {
            return Err("整合包清单过大".into());
        }
        let mut data = Vec::new();
        file.read_to_end(&mut data).map_err(|e| e.to_string())?;
        serde_json::from_slice(&data).map_err(|e| format!("整合包清单无效：{e}"))?
    };
    if value["formatVersion"] != 1 || value["game"] != "minecraft" {
        return Err("不支持的 Modrinth 整合包格式".into());
    }
    let deps = value["dependencies"]
        .as_object()
        .ok_or("整合包缺少游戏依赖")?;
    let game = deps
        .get("minecraft")
        .and_then(Value::as_str)
        .ok_or("整合包缺少游戏版本")?;
    let mut loader = "vanilla";
    let mut loader_version = None;
    for (key, item) in deps {
        if key == "minecraft" {
            continue;
        }
        let kind = match key.as_str() {
            "fabric-loader" => "fabric",
            "quilt-loader" => "quilt",
            "forge" => "forge",
            "neoforge" | "neo-forge" => "neoforge",
            _ => return Err(format!("不支持的整合包依赖：{key}")),
        };
        if loader != "vanilla" {
            return Err("暂不支持含多个加载器的整合包".into());
        }
        loader = kind;
        loader_version = Some(item.as_str().ok_or("加载器版本无效")?.to_string());
    }
    let mut seen = HashSet::new();
    let mut total = 0u64;
    let mut include_saves = false;
    for i in 0..zip.len() {
        crate::jobs::check(job)?;
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name();
        if entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("整合包不能包含符号链接".into());
        }
        let path = if entry.is_dir() {
            name.trim_end_matches('/')
        } else {
            name
        };
        if !path.is_empty() {
            portable_path(path)?;
        }
        if entry.is_dir() {
            continue;
        }
        if !seen.insert(name.to_lowercase()) {
            return Err("整合包包含重复文件".into());
        }
        if entry.size() > MAX_FILE {
            return Err("整合包中的单个文件过大".into());
        }
        total = total.checked_add(entry.size()).ok_or("整合包过大")?;
        if total > MAX_SIZE {
            return Err("整合包解压后过大".into());
        }
        for sub in ["overrides/", "client-overrides/"] {
            if let Some(rel) = name.strip_prefix(&format!("{prefix}{sub}")) {
                if rel
                    .split('/')
                    .next()
                    .is_some_and(|part| part.eq_ignore_ascii_case("saves"))
                {
                    include_saves = true;
                }
            }
        }
    }
    let unpacked_size = total;
    let entries = value["files"].as_array().ok_or("整合包缺少文件列表")?;
    if entries.len() > MAX_FILES {
        return Err("整合包文件数量过多".into());
    }
    let mut file_seen = HashSet::new();
    let mut files = Vec::new();
    for item in entries {
        crate::jobs::check(job)?;
        if item["env"]["client"].as_str() == Some("unsupported") {
            continue;
        }
        let path = item["path"].as_str().ok_or("整合包文件缺少路径")?;
        portable_path(path)?;
        if path
            .split('/')
            .next()
            .is_some_and(|part| excluded(part, true))
        {
            return Err(format!("不支持的整合包文件路径：{path}"));
        }
        if !file_seen.insert(path.to_lowercase()) {
            return Err("整合包包含重复下载目标".into());
        }
        if path
            .split('/')
            .next()
            .is_some_and(|part| part.eq_ignore_ascii_case("saves"))
        {
            include_saves = true;
        }
        let size = item["fileSize"].as_u64().ok_or("整合包文件缺少大小")?;
        if size > MAX_FILE {
            return Err("整合包中的下载文件过大".into());
        }
        total = total.checked_add(size).ok_or("整合包过大")?;
        if total > MAX_SIZE {
            return Err("整合包解压后过大".into());
        }
        let sha1 = parse_hash(&item["hashes"], "sha1", 40)?;
        let sha512 = parse_hash(&item["hashes"], "sha512", 128)?;
        if sha1.is_none() && sha512.is_none() {
            return Err("整合包文件缺少校验值".into());
        }
        let urls: Vec<String> = item["downloads"]
            .as_array()
            .ok_or("整合包文件缺少下载地址")?
            .iter()
            .filter_map(Value::as_str)
            .filter(|s| valid_url(s))
            .map(str::to_string)
            .collect();
        if urls.is_empty() {
            return Err("整合包文件没有可用的 HTTPS 下载地址".into());
        }
        files.push(PackFile {
            path: path.to_string(),
            urls,
            sha1,
            sha512,
        });
    }
    let manifest = ArchiveManifest {
        format: "modrinth".into(),
        format_version: 1,
        name: value["name"].as_str().unwrap_or("导入的整合包").to_string(),
        game_version: game.to_string(),
        loader: loader.to_string(),
        loader_version,
        include_saves,
        launch_settings: None,
    };
    validate_manifest(&manifest)?;
    Ok(Pack {
        manifest,
        prefix,
        files,
        unpacked_size,
    })
}
pub fn encode_manifest(manifest: &ArchiveManifest) -> ResultT<Vec<u8>> {
    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), serde_json::json!(manifest.game_version));
    if manifest.loader != "vanilla" {
        let key = match manifest.loader.as_str() {
            "fabric" => "fabric-loader",
            "forge" => "forge",
            "neoforge" => "neoforge",
            "quilt" => return Err("PCL 不支持 Quilt，无法导出为 PCL 兼容格式".into()),
            _ => return Err("不支持的加载器".into()),
        };
        deps.insert(
            key.into(),
            serde_json::json!(manifest.loader_version.as_deref().ok_or("缺少加载器版本")?),
        );
    }
    serde_json::to_vec_pretty(&serde_json::json!({"game":"minecraft","formatVersion":1,"versionId":"1.0.0","name":manifest.name,"files":[],"dependencies":deps})).map_err(|e| e.to_string())
}
pub fn extract<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    pack: &Pack,
    staging: &Path,
    job: Option<&str>,
    mut progress: impl FnMut(&str, usize, usize),
) -> ResultT<()> {
    fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    let count = zip.len();
    for sub in ["overrides/", "client-overrides/"] {
        let prefix = format!("{}{sub}", pack.prefix);
        for i in 0..count {
            crate::jobs::check(job)?;
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            let Some(relative) = name.strip_prefix(&prefix) else {
                continue;
            };
            if relative.is_empty() || file.is_dir() {
                continue;
            }
            let target = staging.join(portable_path(relative)?);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = fs::File::create(target).map_err(|e| e.to_string())?;
            crate::jobs::copy_checked(&mut file, &mut output, job)?;
            progress(&name, i, count);
        }
    }
    Ok(())
}
struct DownloadBudget {
    used: Arc<AtomicU64>,
    reserved: u64,
    committed: bool,
}
impl DownloadBudget {
    #[allow(deprecated)]
    fn reserve(&mut self, bytes: u64) -> ResultT<()> {
        self.used
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |used| {
                used.checked_add(bytes).filter(|total| *total <= MAX_SIZE)
            })
            .map_err(|_| "整合包文件过大")?;
        self.reserved += bytes;
        Ok(())
    }
}
impl Drop for DownloadBudget {
    fn drop(&mut self) {
        if !self.committed {
            self.used.fetch_sub(self.reserved, Ordering::Relaxed);
        }
    }
}
async fn download_one(
    client: &reqwest::Client,
    file: &PackFile,
    staging: &Path,
    dest: &Path,
    used: Arc<AtomicU64>,
    job: Option<&str>,
) -> ResultT<u64> {
    let mut errors = Vec::new();
    for url in &file.urls {
        let temp = staging.join(format!(".ccl-pack-download-{}", super::unique()));
        let _cleanup = crate::jobs::CleanupPath::file(temp.clone());
        let result = crate::jobs::race(job, async {
            let _slot = crate::download_slot().await?;
            let mut response = client
                .get(url)
                .timeout(Duration::from_secs(300))
                .send()
                .await
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
            if response.content_length().is_some_and(|n| n > MAX_FILE) {
                return Err("文件过大".into());
            }
            let mut output = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            let mut sha1 = Sha1::new();
            let mut sha512 = Sha512::new();
            let mut size = 0u64;
            let mut budget = DownloadBudget {
                used: used.clone(),
                reserved: 0,
                committed: false,
            };
            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                crate::jobs::check(job)?;
                size = size.checked_add(chunk.len() as u64).ok_or("文件过大")?;
                if size > MAX_FILE {
                    return Err("整合包文件过大".into());
                }
                budget.reserve(chunk.len() as u64)?;
                sha1.update(&chunk);
                sha512.update(&chunk);
                output.write_all(&chunk).map_err(|e| e.to_string())?;
            }
            if file
                .sha1
                .as_ref()
                .is_some_and(|v| *v != format!("{:x}", sha1.finalize()))
                || file
                    .sha512
                    .as_ref()
                    .is_some_and(|v| *v != format!("{:x}", sha512.finalize()))
            {
                return Err("文件哈希校验失败".into());
            }
            drop(output);
            crate::jobs::check(job)?;
            fs::rename(&temp, dest).map_err(|e| e.to_string())?;
            budget.committed = true;
            Ok(size)
        })
        .await;
        match result {
            Ok(size) => return Ok(size),
            Err(e) => {
                crate::jobs::check(job)?;
                errors.push(e);
            }
        }
    }
    Err(format!("下载 {} 失败：{}", file.path, errors.join("；")))
}
pub async fn download(
    app: &tauri::AppHandle,
    files: &[PackFile],
    staging: &Path,
    unpacked_size: u64,
    job: Option<&str>,
) -> ResultT<()> {
    let client = crate::http_client_builder()?
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !valid_url(attempt.url().as_str()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let budget = Arc::new(AtomicU64::new(unpacked_size));
    let staging_path = staging.to_path_buf();
    let job_id = job.map(str::to_string);
    let mut downloads = stream::iter(files.to_vec().into_iter().map(|file| {
        let client = client.clone();
        let budget = budget.clone();
        let staging = staging_path.clone();
        let job_id = job_id.clone();
        async move {
            let job = job_id.as_deref();
            crate::jobs::check(job)?;
            let dest = staging.join(portable_path(&file.path)?);
            if dest.is_file() {
                return Ok::<(), String>(());
            } // Local overrides take precedence.
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            download_one(&client, &file, &staging, &dest, budget, job).await?;
            Ok(())
        }
    }))
    .buffer_unordered(8);
    let mut completed = 0;
    while downloads.try_next().await?.is_some() {
        completed += 1;
        crate::report(app, job, "正在下载整合包文件", completed, files.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn manifest(loader: &str) -> ArchiveManifest {
        ArchiveManifest {
            format: "ccl-instance".into(),
            format_version: 1,
            name: "Test pack".into(),
            game_version: "1.20.1".into(),
            loader: loader.into(),
            loader_version: if loader == "vanilla" {
                None
            } else {
                Some("0.16.0".into())
            },
            include_saves: true,
            launch_settings: None,
        }
    }
    fn make_zip(index: &Value, extra: &[(&str, &[u8])]) -> ZipArchive<Cursor<Vec<u8>>> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer.start_file("modrinth.index.json", options).unwrap();
        writer
            .write_all(&serde_json::to_vec(index).unwrap())
            .unwrap();
        for (name, bytes) in extra {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap()
    }
    fn index() -> Value {
        serde_json::json!({"game":"minecraft","formatVersion":1,"versionId":"1.0","name":"Test pack","files":[],"dependencies":{"minecraft":"1.20.1","fabric-loader":"0.16.0"}})
    }
    fn temp_dir() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("ccl-pcl-test-{}", super::super::unique()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn pcl_export_manifest_and_overrides_round_trip() {
        let encoded = encode_manifest(&manifest("fabric")).unwrap();
        let index: Value = serde_json::from_slice(&encoded).unwrap();
        assert_eq!(index["dependencies"]["fabric-loader"], "0.16.0");
        assert_eq!(index["files"].as_array().unwrap().len(), 0);
        let mut zip = make_zip(
            &index,
            &[
                ("overrides/mods/test.jar", b"mod"),
                ("overrides/config/test.txt", b"base"),
                ("client-overrides/config/test.txt", b"client"),
                ("overrides/saves/world/level.dat", b"world"),
            ],
        );
        let pack = inspect(&mut zip, None).unwrap();
        assert_eq!(pack.manifest.loader, "fabric");
        assert!(pack.manifest.include_saves);
        let dir = temp_dir();
        extract(&mut zip, &pack, &dir, None, |_, _, _| {}).unwrap();
        assert_eq!(fs::read(dir.join("mods/test.jar")).unwrap(), b"mod");
        assert_eq!(fs::read(dir.join("config/test.txt")).unwrap(), b"client");
        assert_eq!(
            fs::read(dir.join("saves/world/level.dat")).unwrap(),
            b"world"
        );
        assert!(encode_manifest(&manifest("quilt")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn validates_downloads_and_rejects_unsafe_archives() {
        let mut data = index();
        data["files"] = serde_json::json!([{ "path":"mods/example.jar", "fileSize":4, "hashes":{"sha1":"a94a8fe5ccb19ba61c4c0873d391e987982fbbd3"}, "downloads":["https://cdn.modrinth.com/example.jar"] },{"path":"mods/server.jar","env":{"client":"unsupported"}}]);
        let mut zip = make_zip(&data, &[]);
        let pack = inspect(&mut zip, None).unwrap();
        assert_eq!(pack.files.len(), 1);
        assert_eq!(pack.files[0].path, "mods/example.jar");
        let mut traversal = make_zip(&index(), &[("overrides/../../escape", b"bad")]);
        assert!(inspect(&mut traversal, None).is_err());
        data["files"][0]["path"] = serde_json::json!("../outside.jar");
        assert!(inspect(&mut make_zip(&data, &[]), None).is_err());
        data["files"][0]["path"] = serde_json::json!("mods/example.jar");
        data["files"][0]["downloads"] = serde_json::json!(["https://127.0.0.1/private"]);
        assert!(inspect(&mut make_zip(&data, &[]), None).is_err());
        let mut conflict = index();
        conflict["dependencies"]["forge"] = serde_json::json!("47.0");
        assert!(inspect(&mut make_zip(&conflict, &[]), None).is_err());
    }
    #[test]
    fn download_budget_releases_failed_attempts() {
        let used = Arc::new(AtomicU64::new(MAX_SIZE - 4));
        {
            let mut guard = DownloadBudget {
                used: used.clone(),
                reserved: 0,
                committed: false,
            };
            guard.reserve(4).unwrap();
            assert!(guard.reserve(1).is_err());
        }
        assert_eq!(used.load(Ordering::Relaxed), MAX_SIZE - 4);
        {
            let mut guard = DownloadBudget {
                used: used.clone(),
                reserved: 0,
                committed: false,
            };
            guard.reserve(4).unwrap();
            guard.committed = true;
        }
        assert_eq!(used.load(Ordering::Relaxed), MAX_SIZE);
    }
    #[test]
    fn accepts_single_wrapping_directory() {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default();
        writer
            .start_file("Pack/modrinth.index.json", options)
            .unwrap();
        writer
            .write_all(&serde_json::to_vec(&index()).unwrap())
            .unwrap();
        writer
            .start_file("Pack/overrides/config/options.txt", options)
            .unwrap();
        writer.write_all(b"option").unwrap();
        let mut zip = ZipArchive::new(Cursor::new(writer.finish().unwrap().into_inner())).unwrap();
        let pack = inspect(&mut zip, None).unwrap();
        assert_eq!(pack.prefix, "Pack/");
        let dir = temp_dir();
        extract(&mut zip, &pack, &dir, None, |_, _, _| {}).unwrap();
        assert_eq!(fs::read(dir.join("config/options.txt")).unwrap(), b"option");
        fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn download_verifies_hash_and_cleans_partial_file() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0u8; 1024];
                stream.read(&mut request).await.unwrap();
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest",
                    )
                    .await
                    .unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let dir = temp_dir();
        let dest = dir.join("test.jar");
        let mut file = PackFile {
            path: "test.jar".into(),
            urls: vec![url],
            sha1: Some(format!("{:x}", Sha1::digest(b"test"))),
            sha512: None,
        };
        assert_eq!(
            download_one(
                &client,
                &file,
                &dir,
                &dest,
                Arc::new(AtomicU64::new(0)),
                None
            )
            .await
            .unwrap(),
            4
        );
        assert_eq!(fs::read(&dest).unwrap(), b"test");
        fs::remove_file(&dest).unwrap();
        file.sha1 = Some("0000000000000000000000000000000000000000".into());
        assert!(download_one(
            &client,
            &file,
            &dir,
            &dest,
            Arc::new(AtomicU64::new(0)),
            None
        )
        .await
        .is_err());
        assert!(!dest.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        server.await.unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn cancellation_removes_partial_download() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let (started, ready) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            stream.read(&mut request).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial")
                .await
                .unwrap();
            started.send(()).unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });
        let dir = temp_dir();
        let dest = dir.join("test.jar");
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let file = PackFile {
            path: "test.jar".into(),
            urls: vec![url],
            sha1: Some("0000000000000000000000000000000000000000".into()),
            sha512: None,
        };
        crate::jobs::begin_job("pcl-cancel-test".into(), None).unwrap();
        let worker = {
            let dir = dir.clone();
            let dest = dest.clone();
            tokio::spawn(async move {
                download_one(
                    &client,
                    &file,
                    &dir,
                    &dest,
                    Arc::new(AtomicU64::new(0)),
                    Some("pcl-cancel-test"),
                )
                .await
            })
        };
        ready.await.unwrap();
        crate::jobs::cancel_job("pcl-cancel-test".into()).unwrap();
        assert!(worker.await.unwrap().is_err());
        assert!(!dest.exists());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        crate::jobs::end_job("pcl-cancel-test".into());
        server.abort();
        fs::remove_dir_all(dir).unwrap();
    }
}
