use crate::{http_client, loaders, root, version_id, ResultT};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    id: String,
    title: String,
    description: String,
    author: String,
    downloads: u64,
    source: String,
    installed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMod {
    name: String,
    enabled: bool,
}

fn valid_id(id: &str) -> ResultT<()> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        Err("无效的项目 ID".into())
    } else {
        Ok(())
    }
}
fn safe_name(name: &str) -> ResultT<()> {
    let mut components = Path::new(name).components();
    if name.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || name.contains(['/', '\\'])
    {
        return Err("文件名称无效".into());
    }
    Ok(())
}
fn source_url(source: &str) -> ResultT<&'static str> {
    match source {
        "modrinth" => Ok("https://api.modrinth.com/v2"),
        "curseforge" => Ok("https://api.curseforge.com/v1"),
        _ => Err("未知内容来源".into()),
    }
}
fn request<'a>(
    client: &'a reqwest::Client,
    url: &str,
    source: &str,
    key: &str,
) -> ResultT<reqwest::RequestBuilder> {
    let builder = client.get(url).timeout(Duration::from_secs(30));
    if source == "curseforge" {
        if key.trim().is_empty() {
            return Err("请先在模组页面填写 CurseForge API Key".into());
        }
        Ok(builder.header("x-api-key", key.trim()))
    } else {
        Ok(builder)
    }
}
async fn query_json(builder: reqwest::RequestBuilder) -> ResultT<Value> {
    let response = builder
        .send()
        .await
        .map_err(|e| format!("内容服务连接失败: {e:#}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("内容服务拒绝访问，请检查 API Key 或文件的下载权限".into());
    }
    response
        .error_for_status()
        .map_err(|e| format!("内容服务返回错误: {e}"))?
        .json()
        .await
        .map_err(|e| format!("内容数据解析失败: {e}"))
}
#[tauri::command]
pub async fn search_content(
    source: String,
    kind: String,
    query: String,
    api_key: String,
    game_dir: String,
    version: String,
) -> ResultT<Vec<ContentHit>> {
    let base = source_url(&source)?;
    if kind != "mod" && kind != "modpack" {
        return Err("未知内容类型".into());
    }
    let client = http_client()?;
    let target = if kind == "mod" {
        let (dir, game, loader) = current_instance(&game_dir, &version)?;
        if loader == "vanilla" {
            return Err("请选择已安装模组加载器的游戏版本".into());
        }
        Some((dir, game, loader))
    } else {
        None
    };
    let data = if source == "modrinth" {
        let mut filters = vec![vec![format!("project_type:{kind}")]];
        if let Some((_, game, loader)) = &target {
            filters.push(vec![format!("versions:{game}")]);
            filters.push(vec![format!("categories:{loader}")]);
        }
        let facets = json!(filters).to_string();
        query_json(
            request(&client, &format!("{base}/search"), &source, &api_key)?.query(&[
                ("query", query.as_str()),
                ("limit", "30"),
                ("facets", facets.as_str()),
            ]),
        )
        .await?
    } else {
        let class = if kind == "mod" { "6" } else { "4471" };
        let mut req =
            request(&client, &format!("{base}/mods/search"), &source, &api_key)?.query(&[
                ("gameId", "432"),
                ("classId", class),
                ("pageSize", "30"),
                ("searchFilter", query.as_str()),
            ]);
        if let Some((_, game, loader)) = &target {
            req = req.query(&[
                ("gameVersion", game.as_str()),
                (
                    "modLoaderType",
                    curse_loader(loader).ok_or("不支持的模组加载器")?,
                ),
            ]);
        }
        query_json(req).await?
    };
    let entries = if source == "modrinth" {
        &data["hits"]
    } else {
        &data["data"]
    };
    let installed = if let Some((dir, _, _)) = &target {
        installed_projects(&client, dir, &source).await?
    } else {
        HashMap::new()
    };
    let hits: Vec<ContentHit> = entries
        .as_array()
        .ok_or("搜索结果格式无效")?
        .iter()
        .filter_map(|v| {
            let id = if source == "modrinth" {
                v["project_id"].as_str()?.to_string()
            } else {
                v["id"].as_u64()?.to_string()
            };
            let title = if source == "modrinth" {
                v["title"].as_str()?
            } else {
                v["name"].as_str()?
            };
            Some(ContentHit {
                id: id.clone(),
                title: title.into(),
                description: v[if source == "modrinth" {
                    "description"
                } else {
                    "summary"
                }]
                .as_str()
                .unwrap_or("")
                .into(),
                author: if source == "modrinth" {
                    v["author"].as_str().unwrap_or("").to_string()
                } else {
                    v["authors"]
                        .as_array()
                        .and_then(|a| a.first())
                        .and_then(|a| a["name"].as_str())
                        .unwrap_or("")
                        .into()
                },
                downloads: v[if source == "modrinth" {
                    "downloads"
                } else {
                    "downloadCount"
                }]
                .as_u64()
                .unwrap_or(0),
                installed: installed.contains_key(&id),
                source: source.clone(),
            })
        })
        .collect();
    if let Some((_, game, loader)) = target {
        let results = stream::iter(hits.into_iter().map(|hit| {
            let client = &client;
            let source = &source;
            let api_key = &api_key;
            let game = &game;
            let loader = &loader;
            async move {
                // Search facets can match game and loader on different releases; confirm one release matches both.
                match mod_versions_raw(client, source, &hit.id, game, loader, api_key).await {
                    Ok(v) if !v.is_empty() => Ok(Some(hit)),
                    Ok(_) => Ok(None),
                    Err(e) => Err(e),
                }
            }
        }))
        .buffered(6)
        .try_collect::<Vec<_>>()
        .await?;
        Ok(results.into_iter().flatten().collect())
    } else {
        Ok(hits)
    }
}
fn current_instance(game_dir: &str, version: &str) -> ResultT<(PathBuf, String, String)> {
    let dir = root(game_dir)?;
    let meta = loaders::version_json(&dir, version)?;
    let loader = meta["cclLoader"].as_str().unwrap_or("vanilla").to_string();
    let game = meta["cclBaseVersion"]
        .as_str()
        .unwrap_or(version)
        .to_string();
    Ok((loaders::runtime_dir(&dir, version, &meta), game, loader))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModVersion {
    id: String,
    name: String,
    number: String,
    date: String,
}

// Records cover CurseForge and offline installations; Modrinth hashes also recognize
// files installed before CCL started keeping records or copied from another launcher.
async fn installed_projects(
    client: &reqwest::Client,
    dir: &Path,
    source: &str,
) -> ResultT<HashMap<String, String>> {
    let mods = dir.join("mods");
    let records: Value = fs::read(dir.join(".ccl-mods.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(json!({}));
    let mut ids = HashMap::new();
    if let Some(entries) = records[source].as_object() {
        for (id, filename) in entries {
            if let Some(name) = filename.as_str() {
                if safe_name(name).is_ok()
                    && (mods.join(name).is_file()
                        || mods.join(format!("{name}.disabled")).is_file())
                {
                    let actual = if mods.join(name).is_file() {
                        name.to_string()
                    } else {
                        format!("{name}.disabled")
                    };
                    ids.insert(id.clone(), actual);
                }
            }
        }
    }
    if source == "modrinth" {
        let mut hashes = HashMap::new();
        if let Ok(entries) = fs::read_dir(&mods) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if (name.ends_with(".jar") || name.ends_with(".jar.disabled"))
                    && entry.file_type().map(|t| t.is_file()).unwrap_or(false)
                {
                    if let Ok(bytes) = fs::read(entry.path()) {
                        hashes.insert(format!("{:x}", Sha1::digest(bytes)), name);
                    }
                }
            }
        }
        if !hashes.is_empty() {
            // Identification is best-effort: local records remain useful when this optional lookup fails.
            if let Ok(data) = query_json(
                client
                    .post("https://api.modrinth.com/v2/version_files")
                    .timeout(Duration::from_secs(30))
                    .json(
                        &json!({"hashes": hashes.keys().collect::<Vec<_>>(), "algorithm":"sha1"}),
                    ),
            )
            .await
            {
                if let Some(map) = data.as_object() {
                    for (hash, value) in map {
                        if let (Some(id), Some(name)) =
                            (value["project_id"].as_str(), hashes.get(hash))
                        {
                            ids.insert(id.to_string(), name.clone());
                        }
                    }
                }
            }
        }
    }
    Ok(ids)
}
async fn mod_versions_raw(
    client: &reqwest::Client,
    source: &str,
    id: &str,
    game: &str,
    loader: &str,
    key: &str,
) -> ResultT<Vec<Value>> {
    valid_id(id)?;
    let base = source_url(source)?;
    if source == "modrinth" {
        let games = json!([game]).to_string();
        let loaders = json!([loader]).to_string();
        let data = query_json(
            request(client, &format!("{base}/project/{id}/version"), source, key)?.query(&[
                ("game_versions", games.as_str()),
                ("loaders", loaders.as_str()),
            ]),
        )
        .await?;
        Ok(data.as_array().ok_or("模组版本数据格式无效")?.clone())
    } else {
        let lt = curse_loader(loader).ok_or("请选择已安装加载器的游戏版本")?;
        let mut versions = Vec::new();
        for index in (0..1000).step_by(50) {
            let data = query_json(
                request(client, &format!("{base}/mods/{id}/files"), source, key)?.query(&[
                    ("gameVersion", game),
                    ("modLoaderType", lt),
                    ("pageSize", "50"),
                    ("index", &index.to_string()),
                ]),
            )
            .await?;
            let files = data["data"].as_array().ok_or("模组版本数据格式无效")?;
            versions.extend(files.iter().cloned());
            if files.len() < 50 {
                break;
            }
        }
        Ok(versions)
    }
}
#[tauri::command]
pub async fn list_mod_versions(
    game_dir: String,
    version: String,
    source: String,
    project_id: String,
    api_key: String,
) -> ResultT<Vec<ModVersion>> {
    let (_, game, loader) = current_instance(&game_dir, &version)?;
    if loader == "vanilla" {
        return Err("请选择已安装模组加载器的游戏版本".into());
    }
    let client = http_client()?;
    let versions =
        mod_versions_raw(&client, &source, &project_id, &game, &loader, &api_key).await?;
    Ok(versions
        .iter()
        .filter_map(|v| {
            let id = if source == "modrinth" {
                v["id"].as_str()?.to_string()
            } else {
                v["id"].as_u64()?.to_string()
            };
            Some(ModVersion {
                id,
                name: v[if source == "modrinth" {
                    "name"
                } else {
                    "displayName"
                }]
                .as_str()
                .unwrap_or("未命名版本")
                .to_string(),
                number: v[if source == "modrinth" {
                    "version_number"
                } else {
                    "fileName"
                }]
                .as_str()
                .unwrap_or("")
                .to_string(),
                date: v[if source == "modrinth" {
                    "date_published"
                } else {
                    "fileDate"
                }]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(10)
                .collect(),
            })
        })
        .collect())
}
#[tauri::command]
pub fn list_mods(game_dir: String, version: String) -> ResultT<Vec<LocalMod>> {
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    let mut mods = Vec::new();
    if let Ok(entries) = fs::read_dir(dir.join("mods")) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".jar") || name.ends_with(".jar.disabled") {
                mods.push(LocalMod {
                    enabled: name.ends_with(".jar"),
                    name,
                });
            }
        }
    }
    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(mods)
}
#[tauri::command]
pub async fn set_mod_enabled(
    game_dir: String,
    version: String,
    name: String,
    enabled: bool,
) -> ResultT<()> {
    safe_name(&name)?;
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    let _lock = crate::resource_lock(format!("mods:{}", dir.display()))
        .lock_owned()
        .await;
    let next = if enabled {
        name.strip_suffix(".jar.disabled")
            .map(|s| format!("{s}.jar"))
    } else {
        name.strip_suffix(".jar")
            .map(|s| format!("{s}.jar.disabled"))
    }
    .ok_or("模组文件状态无效")?;
    let from = dir.join("mods").join(&name);
    let to = dir.join("mods").join(next);
    if to.exists() {
        return Err("目标文件已存在".into());
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn remove_mod(game_dir: String, version: String, name: String) -> ResultT<()> {
    safe_name(&name)?;
    if !name.ends_with(".jar") && !name.ends_with(".jar.disabled") {
        return Err("不是模组文件".into());
    }
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    let _lock = crate::resource_lock(format!("mods:{}", dir.display()))
        .lock_owned()
        .await;
    fs::remove_file(dir.join("mods").join(name)).map_err(|e| e.to_string())
}
fn primary_file(version: &Value) -> Option<&Value> {
    let files = version["files"].as_array()?;
    files
        .iter()
        .find(|v| v["primary"].as_bool() == Some(true))
        .or_else(|| files.first())
}
async fn fetch_file(
    client: &reqwest::Client,
    url: &str,
    sha1: Option<&str>,
    sha512: Option<&str>,
) -> ResultT<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err("下载地址必须使用 HTTPS".into());
    }
    let _slot = crate::download_slot().await?;
    let bytes = client
        .get(url)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| format!("文件下载失败: {e:#}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    if sha512.is_some_and(|expected| {
        format!("{:x}", Sha512::digest(&bytes)) != expected.to_ascii_lowercase()
    }) || sha1.is_some_and(|expected| {
        format!("{:x}", Sha1::digest(&bytes)) != expected.to_ascii_lowercase()
    }) {
        return Err("文件哈希校验失败".into());
    }
    Ok(bytes.to_vec())
}
fn curse_loader(loader: &str) -> Option<&'static str> {
    match loader {
        "forge" => Some("1"),
        "fabric" => Some("4"),
        "quilt" => Some("5"),
        "neoforge" => Some("6"),
        _ => None,
    }
}
async fn version_for_mod(
    client: &reqwest::Client,
    source: &str,
    id: &str,
    pin: Option<&str>,
    game: &str,
    loader: &str,
    key: &str,
) -> ResultT<Value> {
    valid_id(id)?;
    let base = source_url(source)?;
    if source == "modrinth" {
        if let Some(pin) = pin {
            valid_id(pin)?;
            return query_json(request(
                client,
                &format!("{base}/version/{pin}"),
                source,
                key,
            )?)
            .await;
        }
        let games = json!([game]).to_string();
        let loaders = json!([loader]).to_string();
        let data = query_json(
            request(client, &format!("{base}/project/{id}/version"), source, key)?.query(&[
                ("game_versions", games.as_str()),
                ("loaders", loaders.as_str()),
            ]),
        )
        .await?;
        data.as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| format!("未找到兼容 {game} / {loader} 的模组版本：{id}"))
    } else {
        if let Some(pin) = pin {
            valid_id(pin)?;
            return Ok(query_json(request(
                client,
                &format!("{base}/mods/{id}/files/{pin}"),
                source,
                key,
            )?)
            .await?["data"]
                .clone());
        }
        let lt = curse_loader(loader).ok_or("请选择已安装加载器的游戏版本")?;
        let data = query_json(
            request(client, &format!("{base}/mods/{id}/files"), source, key)?.query(&[
                ("gameVersion", game),
                ("modLoaderType", lt),
                ("pageSize", "50"),
            ]),
        )
        .await?;
        data["data"]
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| format!("未找到兼容 {game} / {loader} 的模组版本：{id}"))
    }
}
fn file_parts<'a>(
    source: &str,
    version: &'a Value,
) -> ResultT<(&'a str, &'a str, Option<&'a str>, Option<&'a str>)> {
    if source == "modrinth" {
        let file = primary_file(version).ok_or("项目没有可下载文件")?;
        Ok((
            file["filename"].as_str().ok_or("缺少文件名")?,
            file["url"].as_str().ok_or("缺少下载地址")?,
            file["hashes"]["sha1"].as_str(),
            file["hashes"]["sha512"].as_str(),
        ))
    } else {
        let sha = version["hashes"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|h| h["algo"] == 1)
            .and_then(|h| h["value"].as_str());
        Ok((
            version["fileName"].as_str().ok_or("缺少文件名")?,
            version["downloadUrl"]
                .as_str()
                .ok_or("作者未允许第三方启动器下载此文件")?,
            sha,
            None,
        ))
    }
}
#[tauri::command]
pub async fn install_mod(
    app: tauri::AppHandle,
    game_dir: String,
    version: String,
    source: String,
    project_id: String,
    api_key: String,
    mod_version_id: Option<String>,
    job_id: Option<String>,
) -> ResultT<usize> {
    let (dir, game, loader) = current_instance(&game_dir, &version)?;
    let _instance_lock = crate::resource_lock(format!("mods:{}", dir.display()))
        .lock_owned()
        .await;
    if loader == "vanilla" {
        return Err("请先安装并选择带模组加载器的游戏版本".into());
    }
    source_url(&source)?;
    let client = http_client()?;
    valid_id(&project_id)?;
    let project_id = if source == "modrinth" {
        let project = query_json(request(
            &client,
            &format!("{}/project/{project_id}", source_url(&source)?),
            &source,
            &api_key,
        )?)
        .await?;
        project["id"].as_str().ok_or("模组项目缺少 ID")?.to_string()
    } else {
        project_id
    };
    let installed = installed_projects(&client, &dir, &source).await?;
    if installed.contains_key(&project_id) {
        return Err("该模组已安装到目标实例；请先删除旧版本再安装其他版本".into());
    }
    if let Some(pin) = &mod_version_id {
        let compatible =
            mod_versions_raw(&client, &source, &project_id, &game, &loader, &api_key).await?;
        if !compatible.iter().any(|v| {
            if source == "modrinth" {
                v["id"].as_str() == Some(pin.as_str())
            } else {
                v["id"].as_u64().is_some_and(|id| id.to_string() == *pin)
            }
        }) {
            return Err("所选模组版本与目标游戏或加载器不兼容".into());
        }
    }
    let mut queue = VecDeque::from([(project_id.clone(), mod_version_id)]);
    let mut seen: HashMap<String, String> = HashMap::new();
    let mut downloads = HashMap::new();
    let mut project_files = HashMap::new();
    while let Some((id, pin)) = queue.pop_front() {
        if let Some(existing) = seen.get(&id) {
            if pin.as_ref().is_some_and(|v| v != existing) {
                return Err(format!("模组依赖版本冲突：{id}"));
            }
            continue;
        }
        if seen.len() >= 100 {
            return Err("依赖数量过多，已停止安装".into());
        }
        crate::report(
            &app,
            job_id.as_deref(),
            &format!("正在下载模组及依赖（已处理 {} 项）", seen.len()),
            0,
            0,
        );
        // Reuse an already installed compatible dependency instead of adding a second JAR.
        let pin = if pin.is_none() {
            if let Some(existing) = installed.get(&id) {
                if existing.ends_with(".disabled") {
                    return Err(format!("必需依赖 {existing} 已停用，请先启用"));
                }
                let versions =
                    mod_versions_raw(&client, &source, &id, &game, &loader, &api_key).await?;
                let matched = versions
                    .iter()
                    .find(|v| {
                        if source == "modrinth" {
                            primary_file(v).and_then(|f| f["filename"].as_str())
                                == Some(existing.as_str())
                        } else {
                            v["fileName"].as_str() == Some(existing.as_str())
                        }
                    })
                    .ok_or_else(|| format!("必需依赖 {existing} 与目标游戏或加载器不兼容"))?;
                Some(if source == "modrinth" {
                    matched["id"]
                        .as_str()
                        .ok_or("依赖版本 ID 无效")?
                        .to_string()
                } else {
                    matched["id"]
                        .as_u64()
                        .ok_or("依赖版本 ID 无效")?
                        .to_string()
                })
            } else {
                None
            }
        } else {
            pin
        };
        let version = version_for_mod(
            &client,
            &source,
            &id,
            pin.as_deref(),
            &game,
            &loader,
            &api_key,
        )
        .await?;
        let resolved_id = if source == "modrinth" {
            if pin.is_some() && version["project_id"].as_str() != Some(id.as_str()) {
                return Err("模组依赖的项目 ID 不匹配".into());
            }
            let supports_game = version["game_versions"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(game.as_str())));
            let supports_loader = version["loaders"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(loader.as_str())));
            if !supports_game || !supports_loader {
                return Err(format!("依赖 {id} 与 {game} / {loader} 不兼容"));
            }
            version["id"].as_str().ok_or("模组版本缺少 ID")?.to_string()
        } else {
            version["id"].as_u64().ok_or("模组版本缺少 ID")?.to_string()
        };
        seen.insert(id.clone(), resolved_id);
        let (name, url, sha1, sha512) = file_parts(&source, &version)?;
        safe_name(name)?;
        if !name.ends_with(".jar") {
            return Err("该项目文件不是模组 JAR".into());
        }
        if let Some(existing) = installed.get(&id) {
            if existing.ends_with(".disabled") {
                return Err(format!("必需依赖 {existing} 已停用，请先启用"));
            }
            if existing != name {
                return Err(format!(
                    "必需依赖 {id} 已安装其他版本（{existing}），请先处理版本冲突"
                ));
            }
        }
        project_files.insert(id.clone(), name.to_string());
        let bytes = fetch_file(&client, url, sha1, sha512).await?;
        if let Some(old) = downloads.insert(name.to_string(), bytes.clone()) {
            if old != bytes {
                return Err(format!("依赖文件名冲突：{name}"));
            }
        }
        for dep in version["dependencies"].as_array().into_iter().flatten() {
            if source == "modrinth" && dep["dependency_type"] == "required" {
                if let Some(project) = dep["project_id"].as_str() {
                    queue.push_back((
                        project.into(),
                        dep["version_id"].as_str().map(str::to_string),
                    ));
                } else if let Some(pin) = dep["version_id"].as_str() {
                    valid_id(pin)?;
                    let pinned = query_json(request(
                        &client,
                        &format!("{}/version/{pin}", source_url(&source)?),
                        &source,
                        &api_key,
                    )?)
                    .await?;
                    let project = pinned["project_id"].as_str().ok_or("模组依赖缺少项目 ID")?;
                    queue.push_back((project.to_string(), Some(pin.to_string())));
                }
            }
            if source == "curseforge" && dep["relationType"] == 3 {
                if let Some(project) = dep["modId"].as_u64() {
                    queue.push_back((project.to_string(), None));
                }
            }
        }
    }
    let target = dir.join("mods");
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    for (name, bytes) in &downloads {
        let p = target.join(name);
        if p.exists() && fs::read(&p).map_err(|e| e.to_string())? != *bytes {
            return Err(format!("模组文件已存在且内容不同：{name}"));
        }
    }
    let count = downloads.len();
    for (name, bytes) in downloads {
        fs::write(target.join(name), bytes).map_err(|e| e.to_string())?;
    }
    let registry = dir.join(".ccl-mods.json");
    let mut records: Value = fs::read(&registry)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(json!({}));
    if !records.is_object() {
        records = json!({});
    }
    if !records[&source].is_object() {
        records[&source] = json!({});
    }
    for (id, name) in project_files {
        records[&source][id] = json!(name);
    }
    fs::write(
        registry,
        serde_json::to_vec_pretty(&records).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(count)
}

fn safe_relative(value: &str) -> ResultT<PathBuf> {
    if value.is_empty() || value.contains('\\') || value.contains(':') {
        return Err("整合包路径无效".into());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("整合包包含不安全路径".into());
    }
    Ok(path.to_path_buf())
}
fn read_pack_manifest(bytes: &[u8], source: &str) -> ResultT<Value> {
    use std::io::Read;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("整合包格式无效: {e}"))?;
    let name = if source == "modrinth" {
        "modrinth.index.json"
    } else {
        "manifest.json"
    };
    let mut file = zip
        .by_name(name)
        .map_err(|_| format!("整合包缺少 {name}"))?;
    if file.size() > 10_000_000 {
        return Err("整合包清单过大".into());
    }
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    serde_json::from_slice(&data).map_err(|e| format!("整合包清单解析失败: {e}"))
}
fn apply_overrides(bytes: &[u8], target: &Path, source: &str, manifest: &Value) -> ResultT<()> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let cf_override = manifest["overrides"].as_str().unwrap_or("overrides");
    safe_relative(cf_override)?;
    let prefixes: Vec<String> = if source == "modrinth" {
        vec!["overrides/".into(), "client-overrides/".into()]
    } else {
        vec![format!("{cf_override}/")]
    };
    for prefix in prefixes {
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = file.name().to_string();
            let Some(relative) = name.strip_prefix(&prefix) else {
                continue;
            };
            if relative.is_empty() || file.is_dir() {
                continue;
            }
            if file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
                return Err("整合包包含不支持的符号链接".into());
            }
            let path = target.join(safe_relative(relative)?);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = fs::File::create(path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn install_modpack(
    app: tauri::AppHandle,
    game_dir: String,
    source: String,
    project_id: String,
    api_key: String,
    java_path: String,
    job_id: Option<String>,
) -> ResultT<String> {
    source_url(&source)?;
    valid_id(&project_id)?;
    let client = http_client()?;
    let base = source_url(&source)?;
    crate::report(&app, job_id.as_deref(), "正在获取整合包信息", 0, 0);
    let version = if source == "modrinth" {
        let data = query_json(request(
            &client,
            &format!("{base}/project/{project_id}/version"),
            &source,
            &api_key,
        )?)
        .await?;
        data.as_array()
            .and_then(|v| {
                v.iter().find(|v| {
                    v["files"].as_array().is_some_and(|f| {
                        f.iter().any(|f| {
                            f["filename"]
                                .as_str()
                                .is_some_and(|name| name.ends_with(".mrpack"))
                        })
                    })
                })
            })
            .cloned()
            .ok_or("没有找到可下载的整合包版本")?
    } else {
        let data = query_json(
            request(
                &client,
                &format!("{base}/mods/{project_id}/files"),
                &source,
                &api_key,
            )?
            .query(&[("pageSize", "50")]),
        )
        .await?;
        data["data"]
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or("没有找到可下载的整合包版本")?
    };
    let version_id_str = if source == "modrinth" {
        version["id"]
            .as_str()
            .ok_or("缺少整合包版本 ID")?
            .to_string()
    } else {
        version["id"]
            .as_u64()
            .ok_or("缺少整合包版本 ID")?
            .to_string()
    };
    valid_id(&version_id_str)?;
    let package = if source == "modrinth" {
        let file = version["files"]
            .as_array()
            .and_then(|f| {
                f.iter()
                    .find(|f| {
                        f["filename"]
                            .as_str()
                            .is_some_and(|n| n.ends_with(".mrpack"))
                            && f["primary"] == true
                    })
                    .or_else(|| {
                        f.iter().find(|f| {
                            f["filename"]
                                .as_str()
                                .is_some_and(|n| n.ends_with(".mrpack"))
                        })
                    })
            })
            .ok_or("整合包文件不存在")?;
        fetch_file(
            &client,
            file["url"].as_str().ok_or("缺少整合包地址")?,
            file["hashes"]["sha1"].as_str(),
            file["hashes"]["sha512"].as_str(),
        )
        .await?
    } else {
        let (_, url, sha1, sha512) = file_parts(&source, &version)?;
        fetch_file(&client, url, sha1, sha512).await?
    };
    let manifest = read_pack_manifest(&package, &source)?;
    if source == "modrinth" && (manifest["formatVersion"] != 1 || manifest["game"] != "minecraft") {
        return Err("不支持的 Modrinth 整合包格式".into());
    }
    if source == "curseforge" && manifest["manifestType"] != "minecraftModpack" {
        return Err("不支持的 CurseForge 整合包格式".into());
    }
    let game = if source == "modrinth" {
        manifest["dependencies"]["minecraft"].as_str()
    } else {
        manifest["minecraft"]["version"].as_str()
    }
    .ok_or("整合包缺少游戏版本")?
    .to_string();
    version_id(&game)?;
    let (loader, loader_version) = if source == "modrinth" {
        let dependencies = &manifest["dependencies"];
        [
            ("fabric", "fabric-loader"),
            ("quilt", "quilt-loader"),
            ("forge", "forge"),
            ("neoforge", "neoforge"),
        ]
        .into_iter()
        .find_map(|(loader, key)| {
            dependencies[key]
                .as_str()
                .map(|v| (loader.to_string(), v.to_string()))
        })
        .unwrap_or_else(|| ("vanilla".into(), String::new()))
    } else {
        let loaders = manifest["minecraft"]["modLoaders"]
            .as_array()
            .ok_or("整合包缺少加载器")?;
        let value = loaders
            .iter()
            .find(|v| v["primary"] == true)
            .or_else(|| loaders.first())
            .and_then(|v| v["id"].as_str())
            .ok_or("整合包缺少加载器版本")?;
        let (name, v) = value.split_once('-').ok_or("整合包加载器格式无效")?;
        (name.to_ascii_lowercase(), v.to_string())
    };
    if !["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&loader.as_str()) {
        return Err(format!("不支持的加载器：{loader}"));
    }
    let dir = root(&game_dir)?;
    let pack_id = format!("ccl-pack-{source}-{project_id}-{version_id_str}");
    version_id(&pack_id)?;
    let _pack_lock = crate::resource_lock(format!("pack:{}:{pack_id}", dir.display()))
        .lock_owned()
        .await;
    let target = dir.join("instances").join(&pack_id);
    let version_dir = dir.join("versions").join(&pack_id);
    if target.exists() || version_dir.exists() {
        return Err("该整合包已安装；为保护已有存档，请勿重复安装".into());
    }
    if loaders::version_json(&dir, &game).is_err() {
        crate::install_version(app.clone(), game.clone(), game_dir.clone(), job_id.clone()).await?;
    }
    let base_version = if loader == "vanilla" {
        game.clone()
    } else {
        loaders::install_loader(
            app.clone(),
            game_dir.clone(),
            game.clone(),
            loader.clone(),
            Some(loader_version),
            Some(java_path),
            job_id.clone(),
        )
        .await?
    };
    let mut meta = loaders::version_json(&dir, &base_version)?;
    meta["id"] = json!(pack_id);
    meta["cclBaseVersion"] = json!(game);
    meta["cclLoader"] = json!(loader);
    meta["cclInstance"] = json!(true);
    meta["cclPackName"] = json!(manifest["name"].as_str().unwrap_or("整合包"));
    let staging = dir.join("instances").join(format!(".{pack_id}.installing"));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let outcome: ResultT<()> = async {
        let files = manifest["files"].as_array().ok_or("整合包缺少文件清单")?;
        let mut downloads = stream::iter(files.clone().into_iter().map(|file| {
            let client = &client;
            let source = &source;
            let game = &game;
            let loader = &loader;
            let api_key = &api_key;
            async move {
                if source == "modrinth" {
                    if file["env"]["client"].as_str() == Some("unsupported") {
                        return Ok(None);
                    }
                    let relative =
                        safe_relative(file["path"].as_str().ok_or("整合包文件缺少路径")?)?;
                    let sha512 = file["hashes"]["sha512"].as_str();
                    let sha1 = file["hashes"]["sha1"].as_str();
                    if sha512.is_none() && sha1.is_none() {
                        return Err("整合包文件缺少哈希值".into());
                    }
                    let mut errors = Vec::new();
                    for url in file["downloads"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                    {
                        match fetch_file(client, url, sha1, sha512).await {
                            Ok(bytes) => return Ok(Some((relative, bytes))),
                            Err(e) => errors.push(e),
                        }
                    }
                    Err(format!("整合包文件下载失败：{}", errors.join("；")))
                } else {
                    if file["required"] == false {
                        return Ok(None);
                    }
                    let id = file["projectID"]
                        .as_u64()
                        .ok_or("整合包缺少项目 ID")?
                        .to_string();
                    let pin = file["fileID"]
                        .as_u64()
                        .ok_or("整合包缺少文件 ID")?
                        .to_string();
                    let file =
                        version_for_mod(client, source, &id, Some(&pin), game, loader, api_key)
                            .await?;
                    let (name, url, sha1, sha512) = file_parts(source, &file)?;
                    safe_name(name)?;
                    let bytes = fetch_file(client, url, sha1, sha512).await?;
                    Ok(Some((PathBuf::from("mods").join(name), bytes)))
                }
            }
        }))
        .buffer_unordered(8);
        let mut completed = 0;
        let mut seen = std::collections::HashSet::new();
        let mut last_report = std::time::Instant::now();
        while let Some(item) = downloads.try_next().await? {
            if let Some((relative, data)) = item {
                if !seen.insert(relative.clone()) {
                    return Err(format!("整合包存在重复文件：{}", relative.display()));
                }
                let path = staging.join(relative);
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                tokio::fs::write(path, data)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            completed += 1;
            if completed == files.len() || last_report.elapsed() >= Duration::from_millis(150) {
                crate::report(
                    &app,
                    job_id.as_deref(),
                    "正在下载整合包文件",
                    completed,
                    files.len(),
                );
                last_report = std::time::Instant::now();
            }
        }
        drop(downloads);
        apply_overrides(&package, &staging, &source, &manifest)?;
        fs::rename(&staging, &target).map_err(|e| e.to_string())?;
        let publish = (|| -> ResultT<()> {
            fs::create_dir_all(&version_dir).map_err(|e| e.to_string())?;
            fs::write(
                version_dir.join(format!("{pack_id}.json")),
                serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if publish.is_err() {
            let _ = fs::remove_dir_all(&target);
            let _ = fs::remove_dir_all(&version_dir);
        }
        publish
    }
    .await;
    if outcome.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    outcome?;
    Ok(pack_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn archive(path: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            "modrinth.index.json",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.20.1"}}"#).unwrap();
        zip.start_file(path, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"test").unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn pack_overrides_cannot_escape_the_instance() {
        let root = std::env::temp_dir().join(format!("ccl-pack-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let data = archive("overrides/config/test.txt");
        let manifest = read_pack_manifest(&data, "modrinth").unwrap();
        apply_overrides(&data, &root, "modrinth", &manifest).unwrap();
        assert_eq!(fs::read(root.join("config/test.txt")).unwrap(), b"test");
        assert!(apply_overrides(
            &archive("overrides/../../escape.txt"),
            &root,
            "modrinth",
            &manifest
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
