use crate::{allowed, download, http_client, report, root, version_id, ResultT};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

fn maven_path(name: &str) -> ResultT<String> {
    let (coords, extension) = name.split_once('@').unwrap_or((name, "jar"));
    let parts: Vec<_> = coords.split(':').collect();
    if !(3..=4).contains(&parts.len())
        || !parts.iter().all(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        })
        || !extension.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err("加载器依赖名称无效".into());
    }
    let classifier = if parts.len() == 4 {
        format!("-{}", parts[3])
    } else {
        String::new()
    };
    Ok(format!(
        "{}/{}/{}/{}-{}{}.{}",
        parts[0].replace('.', "/"),
        parts[1],
        parts[2],
        parts[1],
        parts[2],
        classifier,
        extension
    ))
}
async fn json_request(client: &reqwest::Client, url: &str) -> ResultT<Value> {
    client
        .get(url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("加载器服务连接失败: {e:#}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}
fn numeric_version(value: &str) -> Vec<u32> {
    value
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse::<u32>().unwrap_or(0))
        .collect()
}
fn loader_root(loader: &str) -> ResultT<&'static str> {
    match loader {
        "fabric" => Ok("https://meta.fabricmc.net/v2"),
        "quilt" => Ok("https://meta.quiltmc.org/v3"),
        _ => Err("不支持该加载器".into()),
    }
}
fn make_id(game: &str, loader: &str, version: &str) -> ResultT<String> {
    version_id(game)?;
    if !version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        || version.is_empty()
    {
        return Err("无效的加载器版本".into());
    }
    let id = format!("ccl-{loader}-{game}-{}", version.replace('+', "_"));
    version_id(&id)?;
    Ok(id)
}
pub fn version_json(dir: &Path, version: &str) -> ResultT<Value> {
    version_id(version)?;
    let path = dir
        .join("versions")
        .join(version)
        .join(format!("{version}.json"));
    serde_json::from_slice(&fs::read(path).map_err(|_| format!("游戏版本 {version} 尚未安装"))?)
        .map_err(|e| e.to_string())
}
pub fn runtime_dir(dir: &Path, version: &str, metadata: &Value) -> PathBuf {
    if metadata["cclInstance"].as_bool() == Some(true) {
        dir.join("instances").join(version)
    } else {
        dir.to_path_buf()
    }
}
#[tauri::command]
pub async fn install_loader(
    app: tauri::AppHandle,
    game_dir: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    java_path: Option<String>,
    job_id: Option<String>,
) -> ResultT<String> {
    let id = job_id.clone();
    crate::jobs::race(
        id.as_deref(),
        install_loader_impl(
            app,
            game_dir,
            game_version,
            loader,
            loader_version,
            java_path,
            job_id,
        ),
    )
    .await
}
async fn install_loader_impl(
    app: tauri::AppHandle,
    game_dir: String,
    game_version: String,
    loader: String,
    loader_version: Option<String>,
    java_path: Option<String>,
    job_id: Option<String>,
) -> ResultT<String> {
    let dir = root(&game_dir)?;
    version_id(&game_version)?;
    let _loader_lock =
        crate::resource_lock(format!("loader:{}:{game_version}:{loader}", dir.display()))
            .lock_owned()
            .await;
    let base = version_json(&dir, &game_version)?;
    if base.get("cclBaseVersion").is_some() {
        return Err("请选择原版游戏安装加载器".into());
    }
    let client = http_client()?;
    report(&app, job_id.as_deref(), "正在获取加载器信息", 0, 0);
    let (chosen, profile) = if loader == "fabric" || loader == "quilt" {
        let endpoint = loader_root(&loader)?;
        let versions = json_request(
            &client,
            &format!("{endpoint}/versions/loader/{game_version}"),
        )
        .await?;
        let chosen = if let Some(v) = loader_version {
            v
        } else {
            versions
                .as_array()
                .and_then(|items| {
                    items
                        .iter()
                        .filter_map(|x| {
                            let version = x["loader"]["version"].as_str()?;
                            let stable = x["loader"]["stable"]
                                .as_bool()
                                .unwrap_or(!version.contains('-'));
                            if stable {
                                Some(version)
                            } else {
                                None
                            }
                        })
                        .max_by_key(|version| numeric_version(version))
                        .or_else(|| items.first().and_then(|x| x["loader"]["version"].as_str()))
                })
                .ok_or("此游戏版本没有可用的加载器")?
                .to_string()
        };
        make_id(&game_version, &loader, &chosen)?;
        let profile = json_request(
            &client,
            &format!("{endpoint}/versions/loader/{game_version}/{chosen}/profile/json"),
        )
        .await?;
        (chosen, profile)
    } else if loader == "forge" || loader == "neoforge" {
        let (repository, artifact, prefix) = if loader == "forge" {
            (
                "https://maven.minecraftforge.net",
                "net/minecraftforge/forge",
                format!("{game_version}-"),
            )
        } else {
            let parts: Vec<_> = game_version.split('.').collect();
            if parts.first() != Some(&"1") || parts.len() < 2 {
                return Err("无法确定此版本的 NeoForge 版本号".into());
            }
            let minor = parts[1];
            let patch = parts.get(2).copied().unwrap_or("0");
            (
                "https://maven.neoforged.net/releases",
                "net/neoforged/neoforge",
                format!("{minor}.{patch}."),
            )
        };
        let chosen = if let Some(v) = loader_version {
            v
        } else {
            let text = client
                .get(format!("{repository}/{artifact}/maven-metadata.xml"))
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("加载器版本查询失败: {e:#}"))?
                .error_for_status()
                .map_err(|e| e.to_string())?
                .text()
                .await
                .map_err(|e| e.to_string())?;
            let candidate = text
                .split("<version>")
                .skip(1)
                .filter_map(|s| s.split("</version>").next())
                .filter(|s| s.starts_with(&prefix) && !s.contains("beta") && !s.contains("alpha"))
                .max_by_key(|s| numeric_version(s))
                .ok_or("没有找到兼容的加载器版本")?;
            if loader == "forge" {
                candidate
                    .strip_prefix(&prefix)
                    .unwrap_or(candidate)
                    .to_string()
            } else {
                candidate.to_string()
            }
        };
        let id = make_id(&game_version, &loader, &chosen)?;
        let path = dir.join("versions").join(&id).join(format!("{id}.json"));
        if path.exists() {
            return Ok(id);
        }
        let full = if loader == "forge" {
            format!("{game_version}-{chosen}")
        } else {
            chosen.clone()
        };
        let name = if loader == "forge" {
            "forge"
        } else {
            "neoforge"
        };
        let url = format!("{repository}/{artifact}/{full}/{name}-{full}-installer.jar");
        let sha = client
            .get(format!("{url}.sha1"))
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("加载器校验信息获取失败: {e:#}"))?
            .error_for_status()
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let sha = sha
            .trim()
            .split_whitespace()
            .next()
            .filter(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or("加载器缺少有效校验值")?;
        let installer = dir.join("ccl-cache").join(format!("{id}-installer.jar"));
        report(&app, job_id.as_deref(), "正在下载加载器安装程序", 0, 0);
        download(&client, &url, &installer, Some(sha), false).await?;
        let profile: Value = {
            use std::io::Read;
            let mut zip =
                zip::ZipArchive::new(fs::File::open(&installer).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let mut entry = zip
                .by_name("version.json")
                .map_err(|_| "安装程序缺少版本信息")?;
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        };
        if profile["inheritsFrom"].as_str() != Some(game_version.as_str()) {
            return Err("安装程序与游戏版本不匹配".into());
        }
        let profiles = dir.join("launcher_profiles.json");
        if !profiles.exists() {
            fs::write(&profiles, b"{\"profiles\":{}}").map_err(|e| e.to_string())?;
        }
        report(
            &app,
            job_id.as_deref(),
            "正在运行加载器安装程序，请稍候",
            0,
            0,
        );
        let java = java_path
            .filter(|p| !p.trim().is_empty())
            .unwrap_or_else(|| "java".into());
        let _forge_lock = crate::resource_lock(format!("forge-installer:{}", dir.display()))
            .lock_owned()
            .await;
        let mut command = tokio::process::Command::new(java);
        command.kill_on_drop(true);
        command
            .arg("-jar")
            .arg(&installer)
            .arg("--installClient")
            .arg(&dir);
        #[cfg(windows)]
        {
            command.creation_flags(0x08000000);
        }
        let output = command
            .output()
            .await
            .map_err(|e| format!("无法运行加载器安装程序：{e}"))?;
        if !output.status.success() {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let tail: String = text
                .chars()
                .rev()
                .take(1200)
                .collect::<String>()
                .chars()
                .rev()
                .collect();
            return Err(format!("加载器安装失败：{tail}"));
        }
        (chosen, profile)
    } else {
        return Err("不支持该加载器".into());
    };
    let id = make_id(&game_version, &loader, &chosen)?;
    let path = dir.join("versions").join(&id).join(format!("{id}.json"));
    if path.exists() {
        return Ok(id);
    }
    if profile["inheritsFrom"].as_str() != Some(game_version.as_str()) {
        return Err("加载器与游戏版本不匹配".into());
    }
    let mut merged = base.clone();
    let mut libraries = Vec::new();
    for lib in profile["libraries"]
        .as_array()
        .ok_or("加载器缺少依赖")?
        .iter()
        .filter(|lib| allowed(lib))
    {
        let rel = lib["downloads"]["artifact"]["path"]
            .as_str()
            .map(str::to_string)
            .unwrap_or(maven_path(
                lib["name"].as_str().ok_or("加载器依赖缺少名称")?,
            )?);
        if Path::new(&rel).is_absolute()
            || Path::new(&rel).components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::Prefix(_)
                )
            })
        {
            return Err("加载器依赖路径无效".into());
        }
        let url = if let Some(url) = lib["downloads"]["artifact"]["url"].as_str() {
            url.to_string()
        } else {
            let base_url = lib["url"]
                .as_str()
                .unwrap_or("https://libraries.minecraft.net/");
            format!(
                "{}{rel}",
                if base_url.ends_with('/') {
                    base_url.to_string()
                } else {
                    format!("{base_url}/")
                }
            )
        };
        if !url.starts_with("https://") {
            return Err("加载器依赖地址无效".into());
        }
        report(
            &app,
            job_id.as_deref(),
            "正在安装加载器依赖",
            libraries.len(),
            profile["libraries"].as_array().unwrap().len(),
        );
        let sha = lib["downloads"]["artifact"]["sha1"]
            .as_str()
            .or_else(|| lib["sha1"].as_str());
        // Forge may generate libraries locally with no remote URL.
        if !dir.join("libraries").join(&rel).exists() || sha.is_some() {
            download(&client, &url, &dir.join("libraries").join(&rel), sha, false).await?;
        }
        let mut lib = lib.clone();
        lib["downloads"]["artifact"] = json!({"path":rel,"url":url,"sha1":sha});
        libraries.push(lib);
    }
    let keys: std::collections::HashSet<String> = libraries
        .iter()
        .filter_map(|v| v["name"].as_str())
        .map(|name| name.split(':').take(2).collect::<Vec<_>>().join(":"))
        .collect();
    libraries.extend(
        base["libraries"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| {
                !v["name"].as_str().is_some_and(|name| {
                    keys.contains(&name.split(':').take(2).collect::<Vec<_>>().join(":"))
                })
            })
            .cloned(),
    );
    merged["libraries"] = json!(libraries);
    for key in ["game", "jvm"] {
        let mut args = base["arguments"][key]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if key == "jvm" && args.is_empty() {
            args.extend([
                json!("-Djava.library.path=${natives_directory}"),
                json!("-cp"),
                json!("${classpath}"),
            ]);
        }
        args.extend(
            profile["arguments"][key]
                .as_array()
                .cloned()
                .unwrap_or_default(),
        );
        merged["arguments"][key] = json!(args);
    }
    merged["id"] = json!(id);
    merged["mainClass"] = profile["mainClass"].clone();
    merged["cclBaseVersion"] = json!(game_version);
    merged["cclLoader"] = json!(loader);
    merged["cclLoaderVersion"] = json!(chosen);
    merged["cclInstance"] = json!(true);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maven_paths_are_confined_and_support_classifiers() {
        assert_eq!(
            maven_path("org.example:thing:1.2:client").unwrap(),
            "org/example/thing/1.2/thing-1.2-client.jar"
        );
        assert!(maven_path("org.example:../../escape:1").is_err());
    }
}
