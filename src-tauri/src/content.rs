use crate::{http_client, loaders, root, version_id, ResultT};
use futures_util::{stream, StreamExt, TryStreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
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
    icon_url: Option<String>,
    project_url: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPage {
    hits: Vec<ContentHit>,
    has_more: bool,
}
fn content_sort(source: &str, sort: &str) -> ResultT<&'static str> {
    match (source, sort) {
        ("modrinth", "recommended") => Ok("relevance"),
        ("modrinth", "downloads") => Ok("downloads"),
        ("modrinth", "updated") => Ok("updated"),
        ("modrinth", "newest") => Ok("newest"),
        ("curseforge", "recommended") => Ok("2"),
        ("curseforge", "downloads") => Ok("6"),
        ("curseforge", "updated") => Ok("3"),
        ("curseforge", "newest") => Ok("11"),
        _ => Err("未知排序方式".into()),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMod {
    name: String,
    enabled: bool,
}
fn content_icon(value: &Value, source: &str) -> Option<String> {
    if source == "modrinth" {
        value["icon_url"].as_str()
    } else {
        value["logo"]["thumbnailUrl"]
            .as_str()
            .or_else(|| value["logo"]["url"].as_str())
    }
    .map(str::to_string)
}

fn project_url(value: &Value, source: &str, kind: &str, id: &str) -> Option<String> {
    let slug = value["slug"].as_str().filter(|slug| valid_id(slug).is_ok());
    match (source, kind) {
        ("modrinth", "mod" | "modpack" | "resourcepack" | "shader") => {
            let part = slug.unwrap_or(id);
            valid_id(part).ok()?;
            Some(format!("https://modrinth.com/{kind}/{part}"))
        }
        ("curseforge", "mod" | "modpack" | "resourcepack" | "shader") => {
            let section = match kind {
                "mod" => "mc-mods",
                "modpack" => "modpacks",
                "resourcepack" => "texture-packs",
                "shader" => "shaders",
                _ => unreachable!(),
            };
            Some(format!(
                "https://www.curseforge.com/minecraft/{section}/{}",
                slug?
            ))
        }
        _ => None,
    }
}
#[derive(Serialize)]
pub struct ProjectLink {
    label: String,
    url: String,
}
fn public_link(value: &str) -> Option<String> {
    if value.len() > 2048 {
        return None;
    }
    let url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host = url.host_str()?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return None;
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
                return None
            }
            std::net::IpAddr::V6(ip)
                if ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_unique_local()
                    || ip.is_unicast_link_local()
                    || ip.is_multicast()
                    || ip.to_ipv4_mapped().is_some() =>
            {
                return None
            }
            _ => {}
        }
    }
    Some(url.to_string())
}
fn project_links(value: &Value, source: &str) -> Vec<ProjectLink> {
    let mut result: Vec<ProjectLink> = Vec::new();
    let mut add = |label: &str, value: Option<&str>| {
        if let Some(url) = value.and_then(public_link) {
            if !result.iter().any(|link| link.url == url) {
                let label = if reqwest::Url::parse(&url).ok().is_some_and(|u| {
                    u.host_str()
                        .is_some_and(|host| host == "mcmod.cn" || host.ends_with(".mcmod.cn"))
                        && (u.path().starts_with("/class/") || u.path().starts_with("/modpack/"))
                }) {
                    "MC 百科"
                } else {
                    label
                };
                result.push(ProjectLink {
                    label: label.into(),
                    url,
                });
            }
        }
    };
    if source == "modrinth" {
        for (label, field) in [
            ("项目 Wiki", "wiki_url"),
            ("源代码", "source_url"),
            ("问题反馈", "issues_url"),
            ("社区", "discord_url"),
        ] {
            add(label, value[field].as_str());
        }
        if let Some(donations) = value["donation_urls"].as_array() {
            for donation in donations {
                add("赞助", donation["url"].as_str());
            }
        }
    } else if source == "curseforge" {
        for (label, field) in [
            ("项目网站", "websiteUrl"),
            ("项目 Wiki", "wikiUrl"),
            ("源代码", "sourceUrl"),
            ("问题反馈", "issuesUrl"),
        ] {
            add(label, value["links"][field].as_str());
        }
    }
    result
}
#[derive(Serialize)]
pub struct ContentInfo {
    links: Vec<ProjectLink>,
    description: Option<String>,
}
#[tauri::command]
pub async fn content_links(
    source: String,
    project_id: String,
    api_key: String,
) -> ResultT<ContentInfo> {
    valid_id(&project_id)?;
    let client = http_client()?;
    let base = source_url(&source)?;
    let path = if source == "modrinth" {
        format!("{base}/project/{project_id}")
    } else {
        format!("{base}/mods/{project_id}")
    };
    let data = query_json(request(&client, &path, &source, &api_key)?).await?;
    let project = if source == "curseforge" {
        &data["data"]
    } else {
        &data
    };
    Ok(ContentInfo {
        links: project_links(project, &source),
        description: if source == "modrinth" {
            project["body"].as_str().map(str::to_string)
        } else {
            None
        },
    })
}
#[tauri::command]
pub async fn curseforge_description(
    project_id: String,
    api_key: String,
) -> ResultT<Option<String>> {
    valid_id(&project_id)?;
    let client = http_client()?;
    let source = "curseforge";
    let base = source_url(source)?;
    let data = query_json(request(
        &client,
        &format!("{base}/mods/{project_id}/description"),
        source,
        &api_key,
    )?)
    .await?;
    Ok(data["data"].as_str().map(str::to_string))
}
#[tauri::command]
pub fn open_content_page(url: String) -> ResultT<()> {
    let parsed = public_link(&url).ok_or("项目网址无效或不受支持")?;
    crate::auth::open_browser(&parsed)
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
fn pack_directory(kind: &str) -> ResultT<&'static str> {
    match kind {
        "resourcepack" => Ok("resourcepacks"),
        "shader" => Ok("shaderpacks"),
        _ => Err("未知资源包类型".into()),
    }
}

type CurseClassCache = HashMap<(String, String), (Instant, u64)>;
static CURSE_CLASS_CACHE: OnceLock<Mutex<CurseClassCache>> = OnceLock::new();
async fn curse_pack_class(client: &reqwest::Client, key: &str, kind: &str) -> ResultT<u64> {
    let slug = match kind {
        "resourcepack" => "texture-packs",
        "shader" => "shaders",
        _ => return Err("未知资源包类型".into()),
    };
    let cache_key = (
        format!("{:x}", Sha1::digest(key.as_bytes())),
        kind.to_string(),
    );
    let cache = CURSE_CLASS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((time, id)) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&cache_key)
    {
        if time.elapsed() < Duration::from_secs(3600) {
            return Ok(*id);
        }
    }
    let result = query_json(
        request(
            client,
            "https://api.curseforge.com/v1/categories",
            "curseforge",
            key,
        )?
        .query(&[("gameId", "432"), ("classesOnly", "true")]),
    )
    .await?;
    let id = result["data"]
        .as_array()
        .ok_or("CurseForge 分类数据格式无效")?
        .iter()
        .find(|item| item["slug"].as_str() == Some(slug) && item["isClass"].as_bool() == Some(true))
        .and_then(|item| item["id"].as_u64())
        .ok_or("CurseForge 暂未提供该内容分类")?;
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= 32 {
        cache.clear();
    }
    cache.insert(cache_key, (Instant::now(), id));
    Ok(id)
}

fn installed_pack_projects(dir: &Path, kind: &str, source: &str) -> HashMap<String, String> {
    let Ok(folder) = pack_directory(kind) else {
        return HashMap::new();
    };
    let records: Value = fs::read(dir.join(".ccl-packs.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(json!({}));
    records[kind][source]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(id, value)| {
            let name = value.as_str()?;
            if valid_id(id).is_err() || valid_pack_filename(name).is_err() {
                return None;
            }
            if !fs::symlink_metadata(dir.join(folder).join(name))
                .is_ok_and(|meta| meta.file_type().is_file())
            {
                return None;
            }
            Some((id.clone(), name.to_string()))
        })
        .collect()
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
fn valid_category(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+'))
}

#[derive(Serialize)]
pub struct ContentCategory {
    id: String,
    name: String,
}

#[tauri::command]
pub async fn content_categories(
    source: String,
    kind: String,
    api_key: String,
) -> ResultT<Vec<ContentCategory>> {
    if !["mod", "modpack", "resourcepack", "shader"].contains(&kind.as_str()) {
        return Err("未知内容类型".into());
    }
    let client = http_client()?;
    let base = source_url(&source)?;
    let result = if source == "modrinth" {
        query_json(request(
            &client,
            &format!("{base}/tag/category"),
            &source,
            &api_key,
        )?)
        .await?
    } else {
        let class = match kind.as_str() {
            "mod" => 6,
            "modpack" => 4471,
            _ => curse_pack_class(&client, &api_key, &kind).await?,
        };
        let response = query_json(
            request(&client, &format!("{base}/categories"), &source, &api_key)?
                .query(&[("gameId", "432"), ("classId", &class.to_string())]),
        )
        .await?;
        response["data"].clone()
    };
    let mut categories: Vec<_> = result
        .as_array()
        .ok_or("分类数据格式无效")?
        .iter()
        .filter_map(|v| {
            if source == "modrinth" {
                if v["project_type"].as_str() != Some(&kind)
                    || v["header"].as_str() == Some("loaders")
                {
                    return None;
                }
                let name = v["name"].as_str()?;
                if !valid_category(name) {
                    return None;
                }
                Some(ContentCategory {
                    id: name.into(),
                    name: name.into(),
                })
            } else {
                if v["isClass"].as_bool() == Some(true) {
                    return None;
                }
                Some(ContentCategory {
                    id: v["id"].as_u64()?.to_string(),
                    name: v["name"].as_str()?.to_string(),
                })
            }
        })
        .collect();
    categories.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    categories.dedup_by(|a, b| a.id == b.id);
    Ok(categories)
}

#[tauri::command]
pub async fn search_content(
    source: String,
    kind: String,
    query: String,
    api_key: String,
    game_dir: String,
    version: String,
    page: u32,
    sort: String,
    category: Option<String>,
    game_filter: Option<String>,
    loader_filter: Option<String>,
    environment: Option<String>,
) -> ResultT<ContentPage> {
    let base = source_url(&source)?;
    let sort_index = content_sort(&source, &sort)?;
    if page > 332 {
        return Err("已达到浏览页数上限".into());
    }
    let offset = (page * 30).to_string();
    if !["mod", "modpack", "resourcepack", "shader"].contains(&kind.as_str()) {
        return Err("未知内容类型".into());
    }
    let category = category.filter(|v| !v.is_empty());
    if let Some(value) = &category {
        if source == "modrinth" {
            if !valid_category(value) {
                return Err("分类无效".into());
            }
        } else if !value.chars().all(|c| c.is_ascii_digit()) || value.len() > 12 {
            return Err("分类无效".into());
        }
    }
    let game_filter = game_filter.filter(|v| !v.is_empty());
    if let Some(value) = &game_filter {
        version_id(value)?;
    }
    let loader_filter = loader_filter.filter(|v| !v.is_empty());
    if let Some(value) = &loader_filter {
        if !["fabric", "quilt", "forge", "neoforge"].contains(&value.as_str()) {
            return Err("加载器筛选无效".into());
        }
    }
    let environment = environment.filter(|v| !v.is_empty());
    if let Some(value) = &environment {
        if source != "modrinth" || !["client_only", "client_and_server"].contains(&value.as_str()) {
            return Err("环境筛选无效".into());
        }
    }
    let client = http_client()?;
    let target = if kind != "modpack" {
        let (dir, game, loader) = current_instance(&game_dir, &version)?;
        if kind == "mod" && loader == "vanilla" {
            return Err("请选择已安装模组加载器的游戏版本".into());
        }
        Some((dir, game, loader))
    } else {
        None
    };
    let search = async {
        let data = if source == "modrinth" {
            let mut filters = vec![vec![format!("project_type:{kind}")]];
            if let Some((_, game, loader)) = &target {
                filters.push(vec![format!("versions:{game}")]);
                if kind == "mod" {
                    filters.push(vec![format!("categories:{loader}")]);
                }
            }
            if let Some(category) = &category {
                filters.push(vec![format!("categories:{category}")]);
            }
            if kind == "modpack" {
                if let Some(game) = &game_filter {
                    filters.push(vec![format!("versions:{game}")]);
                }
                if let Some(loader) = &loader_filter {
                    filters.push(vec![format!("categories:{loader}")]);
                }
            }
            if let Some(environment) = &environment {
                filters.push(vec![format!("environment:{environment}")]);
            }
            let facets = json!(filters).to_string();
            query_json(
                request(&client, &format!("{base}/search"), &source, &api_key)?.query(&[
                    ("query", query.as_str()),
                    ("limit", "30"),
                    ("offset", offset.as_str()),
                    ("index", sort_index),
                    ("facets", facets.as_str()),
                ]),
            )
            .await?
        } else {
            let class = match kind.as_str() {
                "mod" => "6".to_string(),
                "modpack" => "4471".to_string(),
                _ => curse_pack_class(&client, &api_key, &kind)
                    .await?
                    .to_string(),
            };
            let mut req = request(&client, &format!("{base}/mods/search"), &source, &api_key)?
                .query(&[
                    ("gameId", "432"),
                    ("classId", class.as_str()),
                    ("pageSize", "30"),
                    ("index", offset.as_str()),
                    ("sortField", sort_index),
                    ("sortOrder", "desc"),
                    ("searchFilter", query.as_str()),
                ]);
            if let Some((_, game, loader)) = &target {
                req = req.query(&[("gameVersion", game.as_str())]);
                if kind == "mod" {
                    req = req.query(&[(
                        "modLoaderType",
                        curse_loader(loader).ok_or("不支持的模组加载器")?,
                    )]);
                }
            }
            if let Some(category) = &category {
                req = req.query(&[("categoryId", category)]);
            }
            if kind == "modpack" {
                if let Some(game) = &game_filter {
                    req = req.query(&[("gameVersion", game)]);
                }
                if let Some(loader) = &loader_filter {
                    req = req.query(&[(
                        "modLoaderType",
                        curse_loader(loader).ok_or("不支持的加载器")?,
                    )]);
                }
            }
            query_json(req).await?
        };
        let entries = if source == "modrinth" {
            &data["hits"]
        } else {
            &data["data"]
        };
        let raw_count = entries.as_array().ok_or("搜索结果格式无效")?.len() as u64;
        let total = if source == "modrinth" {
            data["total_hits"].as_u64()
        } else {
            data["pagination"]["totalCount"].as_u64()
        };
        let has_more = page < 332
            && raw_count > 0
            && total
                .map(|n| u64::from(page) * 30 + raw_count < n)
                .unwrap_or(raw_count == 30);
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
                    installed: false,
                    source: source.clone(),
                    icon_url: content_icon(v, &source),
                    project_url: project_url(v, &source, &kind, &id),
                })
            })
            .collect();
        if let Some((_, game, loader)) = target.as_ref().filter(|_| kind == "mod") {
            let results = stream::iter(hits.into_iter().map(|hit| {
                let client = &client;
                let source = &source;
                let api_key = &api_key;
                let game = &game;
                let loader = &loader;
                async move {
                    // Search facets can match game and loader on different releases; confirm one release matches both.
                    match compatible_project(client, source, &hit.id, game, loader, api_key).await {
                        Ok(true) => Ok(Some(hit)),
                        Ok(false) => Ok(None),
                        Err(e) => Err(e),
                    }
                }
            }))
            .buffered(12)
            .try_collect::<Vec<_>>()
            .await?;
            Ok(ContentPage {
                hits: results.into_iter().flatten().collect(),
                has_more,
            })
        } else {
            Ok(ContentPage { hits, has_more })
        }
    };
    let installed = async {
        if let Some((dir, _, _)) = &target {
            if kind == "mod" {
                installed_projects(&client, dir, &source).await
            } else {
                Ok(installed_pack_projects(dir, &kind, &source))
            }
        } else {
            Ok(HashMap::new())
        }
    };
    let (mut page, installed) = tokio::try_join!(search, installed)?;
    for hit in &mut page.hits {
        hit.installed = installed.contains_key(&hit.id);
    }
    Ok(page)
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
        let hashes = tokio::task::spawn_blocking(move || hash_mod_files(&mods))
            .await
            .map_err(|e| format!("读取已安装模组失败: {e}"))?;
        if !hashes.is_empty() {
            let mapping = identify_mod_hashes(client, &hashes).await;
            for (hash, id) in mapping {
                if let Some(name) = hashes.get(&hash) {
                    ids.insert(id, name.clone());
                }
            }
        }
    }
    Ok(ids)
}
type ModFileCache = HashMap<PathBuf, (u64, std::time::SystemTime, String)>;
static MOD_FILE_HASHES: OnceLock<Mutex<ModFileCache>> = OnceLock::new();
static MOD_IDENTITIES: OnceLock<Mutex<HashMap<String, (Instant, HashMap<String, String>)>>> =
    OnceLock::new();
fn hash_mod_files(mods: &Path) -> HashMap<String, String> {
    let mut hashes = HashMap::new();
    let cache = MOD_FILE_HASHES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = fs::read_dir(mods) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !(name.ends_with(".jar") || name.ends_with(".jar.disabled"))
                || !entry.file_type().map(|t| t.is_file()).unwrap_or(false)
            {
                continue;
            }
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let modified = meta.modified().ok();
            let cached = modified.and_then(|time| {
                cache
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&path)
                    .filter(|(size, saved_time, _)| *size == meta.len() && *saved_time == time)
                    .map(|(_, _, hash)| hash.clone())
            });
            if let Some(hash) = cached {
                hashes.insert(hash, name);
                continue;
            }
            let Ok(mut file) = fs::File::open(&path) else {
                continue;
            };
            let mut hash = Sha1::new();
            let mut buf = [0u8; 65536];
            let success = loop {
                match file.read(&mut buf) {
                    Ok(0) => break true,
                    Ok(n) => hash.update(&buf[..n]),
                    Err(_) => break false,
                }
            };
            if success {
                let hash = format!("{:x}", hash.finalize());
                if let (Some(time), Ok(after)) = (modified, fs::metadata(&path)) {
                    if after.len() == meta.len() && after.modified().ok() == Some(time) {
                        let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
                        if cache.len() >= 5000 {
                            cache.clear();
                        }
                        cache.insert(path, (meta.len(), time, hash.clone()));
                    }
                }
                hashes.insert(hash, name);
            }
        }
    }
    hashes
}
async fn identify_mod_hashes(
    client: &reqwest::Client,
    hashes: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut keys: Vec<_> = hashes.keys().collect();
    keys.sort();
    let mut digest = Sha1::new();
    for key in &keys {
        digest.update(key.as_bytes());
    }
    let cache_key = format!("{:x}", digest.finalize());
    let cache = MOD_IDENTITIES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((at, value)) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&cache_key)
    {
        if at.elapsed() < Duration::from_secs(300) {
            return value.clone();
        }
    }
    // Identifying files copied from another launcher is best-effort; CCL's own records remain available.
    let Ok(data) = query_json(
        client
            .post("https://api.modrinth.com/v2/version_files")
            .timeout(Duration::from_secs(8))
            .json(&json!({"hashes":keys,"algorithm":"sha1"})),
    )
    .await
    else {
        return HashMap::new();
    };
    let Some(entries) = data.as_object() else {
        return HashMap::new();
    };
    let mapping = entries
        .iter()
        .filter_map(|(hash, value)| {
            value["project_id"]
                .as_str()
                .map(|id| (hash.clone(), id.to_string()))
        })
        .collect::<HashMap<_, _>>();
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= 128 {
        cache.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(300));
        if cache.len() >= 128 {
            cache.clear();
        }
    }
    cache.insert(cache_key, (Instant::now(), mapping.clone()));
    mapping
}
type CompatibilityKey = (String, String, String, String, String);
static COMPATIBILITY_CACHE: OnceLock<Mutex<HashMap<CompatibilityKey, (Instant, bool)>>> =
    OnceLock::new();
const COMPATIBILITY_TTL: Duration = Duration::from_secs(300);
async fn compatible_project(
    client: &reqwest::Client,
    source: &str,
    id: &str,
    game: &str,
    loader: &str,
    key: &str,
) -> ResultT<bool> {
    let base = source_url(source)?;
    compatible_project_from(client, base, source, id, game, loader, key).await
}
async fn compatible_project_from(
    client: &reqwest::Client,
    base: &str,
    source: &str,
    id: &str,
    game: &str,
    loader: &str,
    key: &str,
) -> ResultT<bool> {
    let cache_key = (
        source.to_string(),
        id.to_string(),
        game.to_string(),
        loader.to_string(),
        format!("{:x}", Sha1::digest(key.as_bytes())),
    );
    let cache = COMPATIBILITY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some((at, compatible)) = cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&cache_key)
    {
        if at.elapsed() < COMPATIBILITY_TTL {
            return Ok(*compatible);
        }
    }
    valid_id(id)?;
    let compatible = if source == "modrinth" {
        let games = json!([game]).to_string();
        let loaders = json!([loader]).to_string();
        let data = query_json(
            request(client, &format!("{base}/project/{id}/version"), source, key)?.query(&[
                ("game_versions", games.as_str()),
                ("loaders", loaders.as_str()),
            ]),
        )
        .await?;
        !data.as_array().ok_or("模组版本数据格式无效")?.is_empty()
    } else {
        let lt = curse_loader(loader).ok_or("请选择已安装加载器的游戏版本")?;
        let data = query_json(
            request(client, &format!("{base}/mods/{id}/files"), source, key)?.query(&[
                ("gameVersion", game),
                ("modLoaderType", lt),
                ("pageSize", "1"),
                ("index", "0"),
            ]),
        )
        .await?;
        !data["data"]
            .as_array()
            .ok_or("模组版本数据格式无效")?
            .is_empty()
    };
    let mut cache = cache.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= 2000 {
        cache.retain(|_, (at, _)| at.elapsed() < COMPATIBILITY_TTL);
        if cache.len() >= 2000 {
            cache.clear();
        }
    }
    cache.insert(cache_key, (Instant::now(), compatible));
    Ok(compatible)
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

async fn pack_versions_raw(
    client: &reqwest::Client,
    source: &str,
    id: &str,
    game: &str,
    key: &str,
) -> ResultT<Vec<Value>> {
    valid_id(id)?;
    let base = source_url(source)?;
    if source == "modrinth" {
        let games = json!([game]).to_string();
        let data = query_json(
            request(client, &format!("{base}/project/{id}/version"), source, key)?
                .query(&[("game_versions", games.as_str())]),
        )
        .await?;
        Ok(data.as_array().ok_or("资源包版本数据格式无效")?.clone())
    } else {
        let mut versions = Vec::new();
        for index in (0..1000).step_by(50) {
            let data = query_json(
                request(client, &format!("{base}/mods/{id}/files"), source, key)?.query(&[
                    ("gameVersion", game),
                    ("pageSize", "50"),
                    ("index", &index.to_string()),
                ]),
            )
            .await?;
            let files = data["data"].as_array().ok_or("资源包版本数据格式无效")?;
            versions.extend(files.iter().cloned());
            if files.len() < 50 {
                break;
            }
        }
        Ok(versions)
    }
}

fn pack_version_supports_game(version: &Value, source: &str, game: &str) -> bool {
    let key = if source == "modrinth" {
        "game_versions"
    } else {
        "gameVersions"
    };
    version[key]
        .as_array()
        .is_some_and(|versions| versions.iter().any(|v| v.as_str() == Some(game)))
}

#[tauri::command]
pub async fn list_pack_versions(
    game_dir: String,
    version: String,
    source: String,
    kind: String,
    project_id: String,
    api_key: String,
) -> ResultT<Vec<ModVersion>> {
    pack_directory(&kind)?;
    let (_, game, _) = current_instance(&game_dir, &version)?;
    let client = http_client()?;
    let versions = pack_versions_raw(&client, &source, &project_id, &game, &api_key).await?;
    Ok(versions
        .iter()
        .filter_map(|v| {
            if !pack_version_supports_game(v, &source, &game) {
                return None;
            }
            let name = if source == "modrinth" {
                primary_file(v)?.get("filename")?.as_str()?
            } else {
                v["fileName"].as_str()?
            };
            if valid_pack_filename(name).is_err() {
                return None;
            }
            let id = if source == "modrinth" {
                v["id"].as_str()?.to_string()
            } else {
                v["id"].as_u64()?.to_string()
            };
            let (name, number, date) = if source == "modrinth" {
                ("name", "version_number", "date_published")
            } else {
                ("displayName", "fileName", "fileDate")
            };
            Some(ModVersion {
                id,
                name: v[name].as_str().unwrap_or("未命名版本").to_string(),
                number: v[number].as_str().unwrap_or("").to_string(),
                date: v[date].as_str().unwrap_or("").chars().take(10).collect(),
            })
        })
        .collect())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPack {
    name: String,
    directory: bool,
    source: Option<String>,
    project_id: Option<String>,
}

fn safe_pack_folder(dir: &Path, kind: &str, create: bool) -> ResultT<PathBuf> {
    let folder = dir.join(pack_directory(kind)?);
    if create {
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    }
    match fs::symlink_metadata(&folder) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(folder),
        Ok(_) => Err("资源包目录不是安全的普通目录".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(folder),
        Err(e) => Err(e.to_string()),
    }
}

fn local_pack_files(dir: &Path, kind: &str) -> ResultT<Vec<LocalPack>> {
    let folder = safe_pack_folder(dir, kind, false)?;
    let entries = match fs::read_dir(&folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut projects = HashMap::new();
    for source in ["modrinth", "curseforge"] {
        for (id, name) in installed_pack_projects(dir, kind, source) {
            projects.entry(name).or_insert((source.to_string(), id));
        }
    }
    let mut packs = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if safe_name(&name).is_err() {
            continue;
        }
        let meta = entry.file_type().map_err(|e| e.to_string())?;
        let directory = meta.is_dir();
        if !((meta.is_file() && name.to_ascii_lowercase().ends_with(".zip"))
            || (directory
                && match kind {
                    "resourcepack" => entry.path().join("pack.mcmeta").is_file(),
                    "shader" => entry.path().join("shaders").is_dir(),
                    _ => false,
                }))
        {
            continue;
        }
        let (source, project_id) = projects
            .get(&name)
            .map(|(s, i)| (Some(s.clone()), Some(i.clone())))
            .unwrap_or((None, None));
        packs.push(LocalPack {
            name,
            directory,
            source,
            project_id,
        });
    }
    packs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(packs)
}

#[tauri::command]
pub fn list_local_packs(
    game_dir: String,
    version: String,
    kind: String,
) -> ResultT<Vec<LocalPack>> {
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    local_pack_files(&dir, &kind)
}

#[tauri::command]
pub async fn remove_local_pack(
    game_dir: String,
    version: String,
    kind: String,
    name: String,
) -> ResultT<()> {
    safe_name(&name)?;
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    let _lock = crate::resource_lock(format!("packs:{}", dir.display()))
        .lock_owned()
        .await;
    let folder = safe_pack_folder(&dir, &kind, false)?;
    if !local_pack_files(&dir, &kind)?
        .iter()
        .any(|p| p.name == name)
    {
        return Err("资源包不存在或不是可管理的资源包".into());
    }
    let target = folder.join(name);
    let meta = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if meta.is_file() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    } else if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())?;
    } else {
        return Err("资源包文件类型无效".into());
    }
    Ok(())
}

#[tauri::command]
pub fn open_pack_folder(game_dir: String, version: String, kind: String) -> ResultT<()> {
    let (dir, _, _) = current_instance(&game_dir, &version)?;
    let folder = safe_pack_folder(&dir, &kind, true)?;
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(folder)
        .spawn()
        .map_err(|e| format!("无法打开资源包目录：{e}"))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackUpdate {
    name: String,
    latest: String,
    project_url: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackUpdateCheck {
    updates: Vec<PackUpdate>,
    checked: usize,
    unknown: usize,
    failed: usize,
}

#[tauri::command]
pub async fn check_pack_updates(
    game_dir: String,
    version: String,
    kind: String,
    api_key: String,
) -> ResultT<PackUpdateCheck> {
    let (dir, game, _) = current_instance(&game_dir, &version)?;
    let packs = local_pack_files(&dir, &kind)?;
    let client = http_client()?;
    let results = stream::iter(packs.into_iter().map(|pack| {
        let client = &client;
        let game = &game;
        let api_key = &api_key;
        let kind = &kind;
        async move {
            let (Some(source), Some(id)) = (pack.source.as_deref(), pack.project_id.as_deref())
            else {
                return (0, 1, 0, None);
            };
            if source == "curseforge" && api_key.trim().is_empty() {
                return (0, 1, 0, None);
            }
            let versions = match pack_versions_raw(client, source, id, game, api_key).await {
                Ok(v) => v,
                Err(_) => return (0, 0, 1, None),
            };
            let compatible: Vec<_> = versions
                .iter()
                .filter(|v| {
                    pack_version_supports_game(v, source, game)
                        && file_parts(source, v)
                            .is_ok_and(|(name, _, _, _)| valid_pack_filename(name).is_ok())
                })
                .collect();
            let date = |v: &Value| -> String {
                v[if source == "modrinth" {
                    "date_published"
                } else {
                    "fileDate"
                }]
                .as_str()
                .unwrap_or("")
                .to_string()
            };
            let current = compatible
                .iter()
                .find(|v| file_parts(source, v).is_ok_and(|(name, _, _, _)| name == pack.name));
            let latest = compatible.iter().max_by_key(|v| date(v));
            let (Some(current), Some(latest)) = (current, latest) else {
                return (0, 1, 0, None);
            };
            if date(current).is_empty() || date(latest).is_empty() {
                return (0, 1, 0, None);
            }
            let update = if date(latest) > date(current) {
                let latest_name = file_parts(source, latest)
                    .map(|p| p.0.to_string())
                    .unwrap_or_default();
                let url = if source == "modrinth" {
                    Some(format!("https://modrinth.com/{kind}/{id}"))
                } else {
                    match request(
                        client,
                        &format!("https://api.curseforge.com/v1/mods/{id}"),
                        source,
                        api_key,
                    ) {
                        Ok(req) => query_json(req)
                            .await
                            .ok()
                            .and_then(|v| project_url(&v["data"], source, kind, id)),
                        Err(_) => None,
                    }
                };
                Some(PackUpdate {
                    name: pack.name.clone(),
                    latest: latest_name,
                    project_url: url,
                })
            } else {
                None
            };
            (1, 0, 0, update)
        }
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    Ok(PackUpdateCheck {
        checked: results.iter().map(|r| r.0).sum(),
        unknown: results.iter().map(|r| r.1).sum(),
        failed: results.iter().map(|r| r.2).sum(),
        updates: results.into_iter().filter_map(|r| r.3).collect(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderEnvironment {
    loader: String,
    detected: Vec<String>,
    uncertain: bool,
}

fn shader_mod_id(path: &Path, loader: &str) -> ResultT<Vec<String>> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for name in [
        "fabric.mod.json",
        "quilt.mod.json",
        "META-INF/mods.toml",
        "META-INF/neoforge.mods.toml",
    ] {
        let usable = match loader {
            "fabric" => name == "fabric.mod.json",
            "quilt" => name == "fabric.mod.json" || name == "quilt.mod.json",
            "forge" => name == "META-INF/mods.toml",
            "neoforge" => name == "META-INF/neoforge.mods.toml" || name == "META-INF/mods.toml",
            _ => false,
        };
        if !usable {
            continue;
        }
        if let Ok(entry) = zip.by_name(name) {
            if entry.size() > 256 * 1024 {
                continue;
            }
            let mut text = String::new();
            entry
                .take(256 * 1024)
                .read_to_string(&mut text)
                .map_err(|e| e.to_string())?;
            if name.ends_with(".json") {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if let Some(id) = v["id"]
                        .as_str()
                        .or_else(|| v["quilt_loader"]["id"].as_str())
                    {
                        ids.push(id.to_ascii_lowercase());
                    }
                }
            } else {
                for line in text.lines() {
                    if let Some((key, value)) = line.split_once('=') {
                        if key.trim() == "modId" {
                            ids.push(
                                value
                                    .split('#')
                                    .next()
                                    .unwrap_or("")
                                    .trim()
                                    .trim_matches(['\'', '"'])
                                    .to_ascii_lowercase(),
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
pub async fn shader_environment(game_dir: String, version: String) -> ResultT<ShaderEnvironment> {
    tokio::task::spawn_blocking(move || shader_environment_impl(game_dir, version))
        .await
        .map_err(|e| format!("光影环境检测失败：{e}"))?
}

fn shader_environment_impl(game_dir: String, version: String) -> ResultT<ShaderEnvironment> {
    let root_dir = root(&game_dir)?;
    let meta = loaders::version_json(&root_dir, &version)?;
    let (dir, _, loader) = current_instance(&game_dir, &version)?;
    let mut detected = Vec::new();
    let mut uncertain = false;
    let optifine = meta["id"]
        .as_str()
        .is_some_and(|v| v.to_ascii_lowercase().contains("optifine"))
        || meta["libraries"].as_array().is_some_and(|libs| {
            libs.iter().any(|lib| {
                lib["name"]
                    .as_str()
                    .is_some_and(|n| n.to_ascii_lowercase().starts_with("optifine:optifine:"))
            })
        });
    if optifine {
        detected.push("OptiFine".to_string());
    }
    if loader != "vanilla" {
        match fs::read_dir(dir.join("mods")) {
            Ok(entries) => {
                for entry in entries {
                    let entry = match entry {
                        Ok(e) => e,
                        Err(_) => {
                            uncertain = true;
                            continue;
                        }
                    };
                    if !entry.file_type().is_ok_and(|t| t.is_file())
                        || !entry
                            .file_name()
                            .to_string_lossy()
                            .to_ascii_lowercase()
                            .ends_with(".jar")
                    {
                        continue;
                    }
                    match shader_mod_id(&entry.path(), &loader) {
                        Ok(ids) if ids.is_empty() => uncertain = true,
                        Ok(ids) => {
                            for (id, label) in [
                                ("iris", "Iris"),
                                ("oculus", "Oculus"),
                                ("optifine", "OptiFine"),
                            ] {
                                if ids.iter().any(|v| v == id)
                                    && !detected.iter().any(|v| v == label)
                                {
                                    detected.push(label.to_string());
                                }
                            }
                        }
                        Err(_) => uncertain = true,
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => uncertain = true,
        }
    }
    Ok(ShaderEnvironment {
        loader,
        detected,
        uncertain,
    })
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    name: String,
    project_id: String,
    current: String,
    latest: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdateCheck {
    updates: Vec<ModUpdate>,
    checked: usize,
    unknown: usize,
    failed: usize,
}
fn modrinth_update(name: &str, versions: &[Value]) -> Option<(String, String)> {
    let filename = name.strip_suffix(".disabled").unwrap_or(name);
    let installed = versions.iter().find(|v| {
        v["files"].as_array().is_some_and(|files| {
            files
                .iter()
                .any(|f| f["filename"].as_str() == Some(filename))
        })
    })?;
    let installed_date = installed["date_published"].as_str()?;
    let latest = versions
        .iter()
        .filter(|v| v["date_published"].as_str().is_some())
        .max_by_key(|v| v["date_published"].as_str().unwrap_or(""))?;
    if latest["date_published"].as_str()? <= installed_date {
        return None;
    }
    Some((
        installed["version_number"]
            .as_str()
            .unwrap_or(filename)
            .to_string(),
        latest["version_number"]
            .as_str()
            .unwrap_or("新版本")
            .to_string(),
    ))
}
/// Updates are informational: installation still performs the normal dependency checks.
#[tauri::command]
pub async fn check_mod_updates(game_dir: String, version: String) -> ResultT<ModUpdateCheck> {
    let (dir, game, loader) = current_instance(&game_dir, &version)?;
    if loader == "vanilla" {
        return Err("请选择已安装加载器的游戏版本".into());
    }
    let client = http_client()?;
    let installed = installed_projects(&client, &dir, "modrinth").await?;
    let total = list_mods(game_dir, version)?.len();
    let count = installed.len();
    let results = stream::iter(installed.into_iter().map(|(id, name)| {
        let client = client.clone();
        let game = game.clone();
        let loader = loader.clone();
        async move {
            match mod_versions_raw(&client, "modrinth", &id, &game, &loader, "").await {
                Ok(versions) => {
                    let filename = name.strip_suffix(".disabled").unwrap_or(&name);
                    let known = versions.iter().any(|v| {
                        v["files"].as_array().is_some_and(|files| {
                            files
                                .iter()
                                .any(|f| f["filename"].as_str() == Some(filename))
                        }) && v["date_published"].as_str().is_some()
                    });
                    (
                        known,
                        false,
                        modrinth_update(&name, &versions).map(|(current, latest)| ModUpdate {
                            name,
                            project_id: id,
                            current,
                            latest,
                        }),
                    )
                }
                Err(_) => (false, true, None),
            }
        }
    }))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    let checked = results.iter().filter(|(known, _, _)| *known).count();
    let failed = results.iter().filter(|(_, failed, _)| *failed).count();
    let unknown = total.saturating_sub(count) + results.len().saturating_sub(checked + failed);
    let mut updates: Vec<_> = results
        .into_iter()
        .filter_map(|(_, _, update)| update)
        .collect();
    updates.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(ModUpdateCheck {
        updates,
        checked,
        unknown,
        failed,
    })
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

fn valid_pack_filename(name: &str) -> ResultT<()> {
    safe_name(name)?;
    if !name.to_ascii_lowercase().ends_with(".zip")
        || name.len() > 255
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || name.ends_with(['.', ' '])
    {
        return Err("资源包文件名无效或不是 ZIP 文件".into());
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return Err("资源包文件名无效".into());
    }
    Ok(())
}

async fn fetch_pack_file(
    app: &tauri::AppHandle,
    job_id: Option<&str>,
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    sha1: Option<&str>,
    sha512: Option<&str>,
    md5: Option<&str>,
) -> ResultT<()> {
    const MAX_BYTES: u64 = 512 * 1024 * 1024;
    if !url.starts_with("https://") {
        return Err("下载地址必须使用 HTTPS".into());
    }
    if sha1.is_none() && sha512.is_none() && md5.is_none() {
        return Err("来源未提供可用的文件校验值".into());
    }
    let _slot = crate::download_slot().await?;
    for attempt in 0..2 {
        if attempt > 0 {
            let _ = tokio::fs::remove_file(path).await;
            crate::report(app, job_id, "校验失败，正在重新下载", 0, 0);
        }
        crate::transfer::download(client, url, path, MAX_BYTES, |current, total| {
            crate::report(
                app,
                job_id,
                "正在下载资源包",
                current as usize,
                total as usize,
            )
        })
        .await?;
        crate::report(app, job_id, "正在校验资源包", 0, 0);
        match verify_pack_file(path, sha1, sha512, md5, job_id) {
            Ok(()) => return Ok(()),
            Err(e) if attempt == 0 && e == "文件哈希校验失败" => continue,
            Err(e) => return Err(e),
        }
    }
    Err("文件哈希校验失败".into())
}

fn verify_pack_file(
    path: &Path,
    sha1: Option<&str>,
    sha512: Option<&str>,
    md5: Option<&str>,
    job_id: Option<&str>,
) -> ResultT<()> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h1 = Sha1::new();
    let mut h512 = Sha512::new();
    let mut hmd5 = md5::Context::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        crate::jobs::check(job_id)?;
        let size = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if size == 0 {
            break;
        }
        let chunk = &buffer[..size];
        if sha1.is_some() {
            h1.update(chunk);
        }
        if sha512.is_some() {
            h512.update(chunk);
        }
        if md5.is_some() {
            hmd5.consume(chunk);
        }
    }
    if sha1.is_some_and(|v| format!("{:x}", h1.finalize()) != v.to_ascii_lowercase())
        || sha512.is_some_and(|v| format!("{:x}", h512.finalize()) != v.to_ascii_lowercase())
        || md5.is_some_and(|v| format!("{:x}", hmd5.compute()) != v.to_ascii_lowercase())
    {
        return Err("文件哈希校验失败".into());
    }
    Ok(())
}

fn validate_pack_archive(reader: impl Read + std::io::Seek, kind: &str) -> ResultT<()> {
    pack_directory(kind)?;
    let archive = zip::ZipArchive::new(reader).map_err(|_| "资源包不是有效的 ZIP 文件")?;
    if archive.len() > 100_000 {
        return Err("资源包包含过多文件".into());
    }
    let valid = archive.file_names().any(|name| match kind {
        "resourcepack" => name == "pack.mcmeta",
        "shader" => name.starts_with("shaders/") && !name.ends_with('/'),
        _ => false,
    });
    if !valid {
        return Err(if kind == "shader" {
            "光影包缺少 shaders 目录"
        } else {
            "材质包缺少 pack.mcmeta"
        }
        .into());
    }
    Ok(())
}
#[cfg(test)]
fn validate_pack_zip(bytes: &[u8], kind: &str) -> ResultT<()> {
    validate_pack_archive(std::io::Cursor::new(bytes), kind)
}

fn save_pack_reader(
    dir: &Path,
    kind: &str,
    source: &str,
    canonical: &str,
    name: &str,
    reader: &mut impl Read,
    job_id: Option<&str>,
) -> ResultT<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    let folder = pack_directory(kind)?;
    source_url(source)?;
    valid_id(canonical)?;
    valid_pack_filename(name)?;
    if installed_pack_projects(dir, kind, source).contains_key(canonical) {
        return Err("该项目已安装到目标游戏目录".into());
    }
    let target = dir.join(folder);
    fs::create_dir_all(&target).map_err(|e| format!("无法创建资源包目录：{e}"))?;
    let metadata = fs::symlink_metadata(&target).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("资源包目录不是安全的普通目录".into());
    }
    let registry = dir.join(".ccl-packs.json");
    let mut records: Value = match fs::read(&registry) {
        Ok(data) => serde_json::from_slice(&data).map_err(|_| "资源包安装记录已损坏")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(e.to_string()),
    };
    if !records.is_object() {
        return Err("资源包安装记录已损坏".into());
    }
    if !records[kind].is_object() {
        records[kind] = json!({});
    }
    if !records[kind][source].is_object() {
        records[kind][source] = json!({});
    }
    records[kind][source][canonical] = json!(name);
    let record_bytes = serde_json::to_vec_pretty(&records).map_err(|e| e.to_string())?;
    let destination = target.join(name);
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
        .map_err(|e| format!("无法保存资源包（文件可能已存在）：{e}"))?;
    if let Err(e) = crate::jobs::copy_checked(reader, &mut output, job_id) {
        drop(output);
        let _ = fs::remove_file(&destination);
        return Err(format!("无法保存资源包：{e}"));
    }
    drop(output);
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let temp = dir.join(format!(
        ".ccl-packs-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let write_record = (|| -> ResultT<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        f.write_all(&record_bytes).map_err(|e| e.to_string())?;
        drop(f);
        fs::rename(&temp, &registry).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = write_record {
        let _ = fs::remove_file(&temp);
        let _ = fs::remove_file(&destination);
        return Err(format!("无法保存资源包安装记录：{e}"));
    }
    Ok(())
}

#[cfg(test)]
fn save_pack(
    dir: &Path,
    kind: &str,
    source: &str,
    canonical: &str,
    name: &str,
    bytes: &[u8],
) -> ResultT<()> {
    validate_pack_zip(bytes, kind)?;
    save_pack_reader(
        dir,
        kind,
        source,
        canonical,
        name,
        &mut std::io::Cursor::new(bytes),
        None,
    )
}

#[tauri::command]
pub async fn install_pack(
    app: tauri::AppHandle,
    game_dir: String,
    version: String,
    source: String,
    kind: String,
    project_id: String,
    api_key: String,
    pack_version_id: String,
    job_id: Option<String>,
) -> ResultT<()> {
    let id = job_id.clone();
    crate::jobs::race(
        id.as_deref(),
        install_pack_impl(
            app,
            game_dir,
            version,
            source,
            kind,
            project_id,
            api_key,
            pack_version_id,
            job_id,
        ),
    )
    .await
}

async fn install_pack_impl(
    app: tauri::AppHandle,
    game_dir: String,
    version: String,
    source: String,
    kind: String,
    project_id: String,
    api_key: String,
    pack_version_id: String,
    job_id: Option<String>,
) -> ResultT<()> {
    pack_directory(&kind)?;
    let (dir, game, _) = current_instance(&game_dir, &version)?;
    let _lock = crate::resource_lock(format!("packs:{}", dir.display()))
        .lock_owned()
        .await;
    valid_id(&project_id)?;
    valid_id(&pack_version_id)?;
    let base = source_url(&source)?;
    let client = http_client()?;
    let path = if source == "modrinth" {
        format!("{base}/project/{project_id}")
    } else {
        format!("{base}/mods/{project_id}")
    };
    let response = query_json(request(&client, &path, &source, &api_key)?).await?;
    let project = if source == "modrinth" {
        &response
    } else {
        &response["data"]
    };
    let canonical = if source == "modrinth" {
        if project["project_type"].as_str() != Some(kind.as_str()) {
            return Err("项目类型与所选资源包类型不匹配".into());
        }
        project["id"].as_str().ok_or("项目缺少 ID")?.to_string()
    } else {
        let class = curse_pack_class(&client, &api_key, &kind).await?;
        if project["classId"].as_u64() != Some(class) {
            return Err("项目类型与所选资源包类型不匹配".into());
        }
        let id = project["id"].as_u64().ok_or("项目缺少 ID")?.to_string();
        if id != project_id {
            return Err("项目 ID 不匹配".into());
        }
        id
    };
    valid_id(&canonical)?;
    if installed_pack_projects(&dir, &kind, &source).contains_key(&canonical) {
        return Err("该项目已安装到目标游戏目录".into());
    }
    let versions = pack_versions_raw(&client, &source, &canonical, &game, &api_key).await?;
    let selected = versions
        .iter()
        .find(|v| {
            if source == "modrinth" {
                v["id"].as_str() == Some(pack_version_id.as_str())
            } else {
                v["id"]
                    .as_u64()
                    .is_some_and(|id| id.to_string() == pack_version_id)
            }
        })
        .ok_or("所选版本与目标游戏不兼容")?;
    if !pack_version_supports_game(selected, &source, &game) {
        return Err("所选版本与目标游戏不兼容".into());
    }
    if source == "modrinth" && selected["project_id"].as_str() != Some(canonical.as_str()) {
        return Err("资源包版本不属于所选项目".into());
    }
    if source == "curseforge"
        && selected["modId"]
            .as_u64()
            .is_some_and(|id| id.to_string() != canonical)
    {
        return Err("资源包版本不属于所选项目".into());
    }
    let (name, url, sha1, sha512) = file_parts(&source, selected)?;
    let md5 = if source == "curseforge" {
        selected["hashes"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|hash| hash["algo"] == 2)
            .and_then(|hash| hash["value"].as_str())
    } else {
        None
    };
    valid_pack_filename(name)?;
    crate::report(&app, job_id.as_deref(), "正在下载资源包", 0, 0);
    let folder = safe_pack_folder(&dir, &kind, true)?;
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temp = folder.join(format!(
        ".ccl-download-{}-{}.part",
        std::process::id(),
        SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _cleanup = crate::jobs::CleanupPath::file(temp.clone());
    fetch_pack_file(
        &app,
        job_id.as_deref(),
        &client,
        url,
        &temp,
        sha1,
        sha512,
        md5,
    )
    .await?;
    crate::jobs::check(job_id.as_deref())?;
    validate_pack_archive(fs::File::open(&temp).map_err(|e| e.to_string())?, &kind)?;
    let mut input = fs::File::open(&temp).map_err(|e| e.to_string())?;
    save_pack_reader(
        &dir,
        &kind,
        &source,
        &canonical,
        name,
        &mut input,
        job_id.as_deref(),
    )
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
    let id = job_id.clone();
    crate::jobs::race(
        id.as_deref(),
        install_mod_impl(
            app,
            game_dir,
            version,
            source,
            project_id,
            api_key,
            mod_version_id,
            job_id,
        ),
    )
    .await
}
async fn install_mod_impl(
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
    crate::jobs::check(job_id.as_deref())?;
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
fn apply_overrides(
    bytes: &[u8],
    target: &Path,
    source: &str,
    manifest: &Value,
    job: Option<&str>,
) -> ResultT<()> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let cf_override = manifest["overrides"].as_str().unwrap_or("overrides");
    safe_relative(cf_override)?;
    let prefixes: Vec<String> = if source == "modrinth" {
        vec!["overrides/".into(), "client-overrides/".into()]
    } else {
        vec![format!("{cf_override}/")]
    };
    for prefix in prefixes {
        crate::jobs::check(job)?;
        for i in 0..zip.len() {
            crate::jobs::check(job)?;
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
            crate::jobs::copy_checked(&mut file, &mut output, job)?;
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
    let id = job_id.clone();
    crate::jobs::race(
        id.as_deref(),
        install_modpack_impl(
            app, game_dir, source, project_id, api_key, java_path, job_id,
        ),
    )
    .await
}
async fn install_modpack_impl(
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
    let _cleanup = crate::jobs::CleanupPath::dir(staging.clone());
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
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::write(path, data).map_err(|e| e.to_string())?;
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
        apply_overrides(&package, &staging, &source, &manifest, job_id.as_deref())?;
        crate::jobs::check(job_id.as_deref())?;
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

    fn pack_archive(path: &str) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(path, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(b"test").unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn local_packs_include_manual_files_and_ignore_symlinks() {
        let dir = std::env::temp_dir().join(format!("ccl-local-packs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("resourcepacks/folder-pack")).unwrap();
        fs::write(dir.join("resourcepacks/folder-pack/pack.mcmeta"), b"{}").unwrap();
        fs::write(dir.join("resourcepacks/manual.ZIP"), b"manual").unwrap();
        fs::write(dir.join("resourcepacks/unrelated.txt"), b"text").unwrap();
        save_pack(
            &dir,
            "resourcepack",
            "modrinth",
            "project1",
            "managed.zip",
            &pack_archive("pack.mcmeta"),
        )
        .unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            dir.join("resourcepacks/manual.ZIP"),
            dir.join("resourcepacks/link.zip"),
        )
        .unwrap();
        let packs = local_pack_files(&dir, "resourcepack").unwrap();
        assert_eq!(packs.len(), 3);
        assert!(packs.iter().any(|p| p.name == "folder-pack" && p.directory));
        assert!(packs
            .iter()
            .any(|p| p.name == "manual.ZIP" && p.source.is_none()));
        assert!(packs
            .iter()
            .any(|p| p.name == "managed.zip" && p.project_id.as_deref() == Some("project1")));
        #[cfg(unix)]
        {
            fs::create_dir_all(dir.join("outside")).unwrap();
            std::os::unix::fs::symlink(dir.join("outside"), dir.join("shaderpacks")).unwrap();
            assert!(local_pack_files(&dir, "shader").is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn shader_mod_detection_reads_metadata_not_filename() {
        let dir = std::env::temp_dir().join(format!("ccl-shader-detect-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("versions/test")).unwrap();
        fs::create_dir_all(dir.join("instances/test/mods")).unwrap();
        fs::write(
            dir.join("versions/test/test.json"),
            br#"{"id":"test","cclLoader":"fabric","cclInstance":true}"#,
        )
        .unwrap();
        let make_jar = |path: &Path, entry: &str, contents: &[u8]| {
            let mut writer = zip::ZipWriter::new(fs::File::create(path).unwrap());
            writer
                .start_file(entry, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(contents).unwrap();
            writer.finish().unwrap();
        };
        make_jar(
            &dir.join("instances/test/mods/renamed.jar"),
            "fabric.mod.json",
            br#"{"id":"iris"}"#,
        );
        make_jar(
            &dir.join("instances/test/mods/oculus.jar.disabled"),
            "META-INF/mods.toml",
            b"modId = \"oculus\"",
        );
        let status =
            shader_environment_impl(dir.to_string_lossy().into_owned(), "test".into()).unwrap();
        assert_eq!(status.detected, vec!["Iris"]);
        assert!(!status.uncertain);
        make_jar(
            &dir.join("instances/test/mods/wrong-loader.jar"),
            "META-INF/mods.toml",
            b"modId = \"oculus\"",
        );
        let mismatch =
            shader_environment_impl(dir.to_string_lossy().into_owned(), "test".into()).unwrap();
        assert_eq!(mismatch.detected, vec!["Iris"]);
        assert!(mismatch.uncertain);
        fs::write(dir.join("instances/test/mods/broken.jar"), b"bad").unwrap();
        assert!(
            shader_environment_impl(dir.to_string_lossy().into_owned(), "test".into())
                .unwrap()
                .uncertain
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn packs_validate_files_and_preserve_existing_data() {
        let dir = std::env::temp_dir().join(format!("ccl-pack-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let resource = pack_archive("pack.mcmeta");
        let shader = pack_archive("shaders/final.fsh");
        assert!(validate_pack_zip(&resource, "resourcepack").is_ok());
        assert!(validate_pack_zip(&shader, "shader").is_ok());
        assert!(validate_pack_zip(&resource, "shader").is_err());
        assert!(validate_pack_zip(b"not a zip", "resourcepack").is_err());
        for filename in ["../evil.zip", "CON.zip", "test.jar", "test?.zip"] {
            assert!(valid_pack_filename(filename).is_err(), "{filename}");
        }
        assert!(valid_pack_filename("Pack.ZIP").is_ok());
        save_pack(
            &dir,
            "resourcepack",
            "modrinth",
            "project1",
            "pack.zip",
            &resource,
        )
        .unwrap();
        assert!(installed_pack_projects(&dir, "resourcepack", "modrinth").contains_key("project1"));
        assert!(save_pack(
            &dir,
            "resourcepack",
            "modrinth",
            "project1",
            "new.zip",
            &resource
        )
        .is_err());
        assert!(save_pack(
            &dir,
            "resourcepack",
            "modrinth",
            "project2",
            "pack.zip",
            &resource
        )
        .is_err());
        assert_eq!(
            fs::read(dir.join("resourcepacks/pack.zip")).unwrap(),
            resource
        );
        let expected = format!("{:x}", Sha1::digest(&resource));
        assert!(verify_pack_file(
            &dir.join("resourcepacks/pack.zip"),
            Some(&expected),
            None,
            None,
            None
        )
        .is_ok());
        assert!(verify_pack_file(
            &dir.join("resourcepacks/pack.zip"),
            Some("0000000000000000000000000000000000000000"),
            None,
            None,
            None
        )
        .is_err());
        save_pack(&dir, "shader", "curseforge", "123", "shader.zip", &shader).unwrap();
        assert!(installed_pack_projects(&dir, "shader", "curseforge").contains_key("123"));
        assert!(installed_pack_projects(&dir, "resourcepack", "modrinth").contains_key("project1"));
        fs::remove_file(dir.join("resourcepacks/pack.zip")).unwrap();
        assert!(installed_pack_projects(&dir, "resourcepack", "modrinth").is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn pack_versions_require_exact_game_compatibility() {
        assert!(pack_version_supports_game(
            &json!({"game_versions":["1.20.1"]}),
            "modrinth",
            "1.20.1"
        ));
        assert!(!pack_version_supports_game(
            &json!({"game_versions":["1.20.2"]}),
            "modrinth",
            "1.20.1"
        ));
        assert!(pack_version_supports_game(
            &json!({"gameVersions":["1.20.1"]}),
            "curseforge",
            "1.20.1"
        ));
        assert!(!pack_version_supports_game(
            &json!({"gameVersions":[]}),
            "curseforge",
            "1.20.1"
        ));
    }

    #[test]
    fn only_reports_a_newer_compatible_version_when_installed_file_is_known() {
        let versions = vec![
            json!({"version_number":"2","date_published":"2025-02-01T00:00:00Z","files":[{"filename":"mod-2.jar"}]}),
            json!({"version_number":"1","date_published":"2025-01-01T00:00:00Z","files":[{"filename":"mod-1.jar"}]}),
        ];
        assert_eq!(
            modrinth_update("mod-1.jar.disabled", &versions),
            Some(("1".into(), "2".into()))
        );
        assert_eq!(modrinth_update("mod-2.jar", &versions), None);
        assert_eq!(modrinth_update("renamed.jar", &versions), None);
    }
    #[test]
    fn reads_thumbnail_urls_from_both_providers() {
        assert_eq!(
            content_icon(
                &json!({"icon_url":"https://cdn.modrinth.com/icon.png"}),
                "modrinth"
            )
            .as_deref(),
            Some("https://cdn.modrinth.com/icon.png")
        );
        assert_eq!(content_icon(&json!({"logo":{"thumbnailUrl":"https://media.forgecdn.net/a.png","url":"https://media.forgecdn.net/b.png"}}), "curseforge").as_deref(), Some("https://media.forgecdn.net/a.png"));
        assert_eq!(content_icon(&json!({"logo":null}), "curseforge"), None);
    }

    #[test]
    fn builds_project_links_from_safe_provider_slugs() {
        assert_eq!(
            project_url(&json!({"slug":"sodium"}), "modrinth", "mod", "AANobbMI").as_deref(),
            Some("https://modrinth.com/mod/sodium")
        );
        assert_eq!(
            project_url(&json!({"slug":"better-mc"}), "curseforge", "modpack", "123").as_deref(),
            Some("https://www.curseforge.com/minecraft/modpacks/better-mc")
        );
        assert_eq!(
            project_url(&json!({"slug":"../../evil"}), "curseforge", "mod", "123"),
            None
        );
        assert_eq!(
            project_url(&json!({}), "modrinth", "mod", "AANobbMI").as_deref(),
            Some("https://modrinth.com/mod/AANobbMI")
        );
        assert!(public_link("http://127.0.0.1/private").is_none());
    }

    #[test]
    fn cached_mod_hashes_follow_file_changes() {
        let dir = std::env::temp_dir().join(format!("ccl-mod-hashes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("example.jar"), b"first").unwrap();
        let first = hash_mod_files(&dir);
        assert_eq!(first.len(), 1);
        assert_eq!(hash_mod_files(&dir), first);
        fs::write(dir.join("example.jar"), b"second and changed").unwrap();
        let second = hash_mod_files(&dir);
        assert_eq!(second.len(), 1);
        assert_ne!(first, second);
        fs::remove_file(dir.join("example.jar")).unwrap();
        assert!(hash_mod_files(&dir).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn compatibility_checks_one_file_and_caches_by_game_version() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).await.unwrap();
                requests.push(String::from_utf8_lossy(&buf[..n]).to_string());
                let body = r#"{"data":[{"id":1}]}"#;
                stream
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
            }
            requests
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        assert!(compatible_project_from(
            &client,
            &base,
            "curseforge",
            "987654321",
            "1.20.1",
            "fabric",
            "test-key"
        )
        .await
        .unwrap());
        assert!(compatible_project_from(
            &client,
            &base,
            "curseforge",
            "987654321",
            "1.20.1",
            "fabric",
            "test-key"
        )
        .await
        .unwrap());
        assert!(compatible_project_from(
            &client,
            &base,
            "curseforge",
            "987654321",
            "1.21",
            "fabric",
            "test-key"
        )
        .await
        .unwrap());
        let requests = tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests
            .iter()
            .all(|request| request.contains("pageSize=1")));
    }

    #[test]
    fn project_links_only_include_safe_available_urls() {
        let links = project_links(
            &json!({"wiki_url":"https://www.mcmod.cn/class/123.html", "source_url":"https://github.com/example/mod", "issues_url":"http://127.0.0.1/admin", "donation_urls":[{"url":"https://patreon.com/example"}]}),
            "modrinth",
        );
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].label, "MC 百科");
        assert_eq!(links[1].label, "源代码");
        assert_eq!(links[2].label, "赞助");
        let curse = project_links(
            &json!({"links":{"websiteUrl":"https://www.curseforge.com/minecraft/mc-mods/example","wikiUrl":"https://example.org/wiki"}}),
            "curseforge",
        );
        assert_eq!(curse.len(), 2);
        assert!(public_link("javascript:alert(1)").is_none());
        assert!(public_link("https://user:password@example.com").is_none());
        assert!(public_link("http://[::1]/").is_none());
    }

    #[test]
    fn maps_sorting_to_provider_fields() {
        assert_eq!(content_sort("modrinth", "downloads").unwrap(), "downloads");
        assert_eq!(content_sort("curseforge", "downloads").unwrap(), "6");
        assert_eq!(content_sort("curseforge", "updated").unwrap(), "3");
        assert!(content_sort("modrinth", "unknown").is_err());
    }

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
        apply_overrides(&data, &root, "modrinth", &manifest, None).unwrap();
        assert_eq!(fs::read(root.join("config/test.txt")).unwrap(), b"test");
        assert!(apply_overrides(
            &archive("overrides/../../escape.txt"),
            &root,
            "modrinth",
            &manifest,
            None
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
