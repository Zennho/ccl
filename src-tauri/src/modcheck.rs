use crate::{loaders, root, ResultT};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Read,
    path::Path,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModIssue {
    kind: &'static str,
    message: String,
    files: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModCheck {
    checked: usize,
    unknown: usize,
    issues: Vec<ModIssue>,
}
#[derive(Default)]
struct ModInfo {
    file: String,
    ids: Vec<String>,
    depends: Vec<(String, String)>,
    breaks: Vec<(String, String)>,
    version: String,
    incomplete: bool,
}
fn read_entry(zip: &mut zip::ZipArchive<fs::File>, name: &str) -> ResultT<Option<String>> {
    let mut entry = match zip.by_name(name) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if entry.size() > 512 * 1024 {
        return Err("模组元数据过大".into());
    }
    let mut text = String::new();
    entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
    Ok(Some(text))
}
fn parse_mod(path: &Path, loader: &str) -> ResultT<ModInfo> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let file = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("模组文件名无效")?
        .to_string();
    let mut info = ModInfo {
        file,
        ..Default::default()
    };
    if ["fabric", "quilt"].contains(&loader) {
        let (name, quilt) = if loader == "quilt" && zip.by_name("quilt.mod.json").is_ok() {
            ("quilt.mod.json", true)
        } else {
            ("fabric.mod.json", false)
        };
        let text = read_entry(&mut zip, name)?.ok_or("缺少所选加载器的模组元数据")?;
        let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        // Nested jars may supply additional mod IDs; do not claim a complete scan.
        info.incomplete = value["jars"]
            .as_array()
            .is_some_and(|jars| !jars.is_empty())
            || value["quilt_loader"]["jars"]
                .as_array()
                .is_some_and(|jars| !jars.is_empty());
        if quilt {
            let q = &value["quilt_loader"];
            info.version = q["version"].as_str().unwrap_or("").into();
            info.ids.push(q["id"].as_str().ok_or("缺少模组 ID")?.into());
            for dep in q["depends"].as_array().into_iter().flatten() {
                if dep["optional"].as_bool() == Some(true) {
                    continue;
                }
                if let Some(id) = dep["id"].as_str() {
                    info.depends.push((
                        id.to_string(),
                        dep["versions"].as_str().unwrap_or("").into(),
                    ));
                }
            }
        } else {
            info.version = value["version"].as_str().unwrap_or("").into();
            info.ids
                .push(value["id"].as_str().ok_or("缺少模组 ID")?.into());
            for alias in value["provides"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                info.ids.push(alias.into());
            }
            for (id, rule) in value["depends"].as_object().into_iter().flatten() {
                info.depends
                    .push((id.clone(), rule.as_str().unwrap_or("").into()));
            }
            for (id, rule) in value["breaks"].as_object().into_iter().flatten() {
                if let Some(rule) = rule.as_str() {
                    info.breaks.push((id.clone(), rule.into()));
                }
            }
        }
    } else if ["forge", "neoforge"].contains(&loader) {
        let mut text = None;
        for name in if loader == "neoforge" {
            vec!["META-INF/neoforge.mods.toml", "META-INF/mods.toml"]
        } else {
            vec!["META-INF/mods.toml"]
        } {
            if let Some(v) = read_entry(&mut zip, name)? {
                text = Some(v);
                break;
            }
        }
        let meta: toml::Value = toml::from_str(&text.ok_or("缺少所选加载器的模组元数据")?)
            .map_err(|e| e.to_string())?;
        for m in meta
            .get("mods")
            .and_then(toml::Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(id) = m.get("modId").and_then(toml::Value::as_str) {
                info.ids.push(id.into());
            }
        }
        let dependencies = meta.get("dependencies").and_then(toml::Value::as_table);
        for list in dependencies.into_iter().flat_map(|table| table.values()) {
            for dep in list.as_array().into_iter().flatten() {
                let mandatory = dep
                    .get("mandatory")
                    .and_then(toml::Value::as_bool)
                    .unwrap_or_else(|| {
                        dep.get("type").and_then(toml::Value::as_str) == Some("required")
                    });
                if mandatory {
                    if let Some(id) = dep.get("modId").and_then(toml::Value::as_str) {
                        info.depends.push((
                            id.into(),
                            dep.get("versionRange")
                                .and_then(toml::Value::as_str)
                                .unwrap_or("")
                                .into(),
                        ));
                    }
                }
            }
        }
    } else {
        return Err("原版没有模组加载器".into());
    }
    if info.ids.is_empty() {
        return Err("缺少模组 ID".into());
    }
    let mut seen = std::collections::HashSet::new();
    info.ids.retain(|id| seen.insert(id.to_ascii_lowercase()));
    Ok(info)
}
fn diagnose(mods: &Path, loader: &str, game: &str) -> ResultT<ModCheck> {
    let mut infos = Vec::new();
    let mut unknown = 0;
    let entries = match fs::read_dir(mods) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ModCheck {
                checked: 0,
                unknown: 0,
                issues: vec![],
            })
        }
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_ok_and(|t| t.is_file())
            || !entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".jar")
        {
            continue;
        }
        match parse_mod(&entry.path(), loader) {
            Ok(info) => {
                if info.incomplete {
                    unknown += 1;
                }
                infos.push(info);
            }
            Err(_) => unknown += 1,
        }
    }
    let mut ids: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for info in &infos {
        for id in &info.ids {
            ids.entry(id.to_lowercase())
                .or_default()
                .push(info.file.clone());
        }
    }
    let mut issues = Vec::new();
    for (id, files) in &ids {
        if files.len() > 1 {
            issues.push(ModIssue {
                kind: "duplicate",
                message: format!("模组 ID {id} 出现多次，可能导致加载冲突。"),
                files: files.clone(),
            });
        }
    }
    let mut builtins: HashMap<&str, &str> =
        [("minecraft", game), ("java", "")].into_iter().collect();
    match loader {
        "fabric" => {
            builtins.insert("fabricloader", "");
        }
        "quilt" => {
            builtins.insert("quilt_loader", "");
            builtins.insert("fabricloader", "");
        }
        "forge" => {
            builtins.insert("forge", "");
        }
        "neoforge" => {
            builtins.insert("neoforge", "");
        }
        _ => {}
    }
    for info in &infos {
        for (id, rule) in &info.depends {
            let name = id.to_lowercase();
            if !ids.contains_key(&name) && !builtins.contains_key(name.as_str()) {
                issues.push(ModIssue {
                    kind: "missing",
                    message: format!("{0} 需要依赖 {id}，当前目录中未识别到该依赖。", info.file),
                    files: vec![info.file.clone()],
                });
            }
            if name == "minecraft" && !rule.is_empty() && !version_matches(game, rule) {
                if semver::VersionReq::parse(rule).is_ok() && parse_version(game).is_some() {
                    issues.push(ModIssue {
                        kind: "game_version",
                        message: format!(
                            "{} 要求 Minecraft {}，当前为 {}。",
                            info.file, rule, game
                        ),
                        files: vec![info.file.clone()],
                    });
                }
            }
        }
        for (id, rule) in &info.breaks {
            for other in &infos {
                if info.file == other.file
                    || !other
                        .ids
                        .iter()
                        .any(|candidate| candidate.eq_ignore_ascii_case(id))
                {
                    continue;
                }
                let matches = rule == "*"
                    || (parse_version(&other.version).is_some()
                        && semver::VersionReq::parse(rule).is_ok()
                        && version_matches(&other.version, rule));
                if matches {
                    issues.push(ModIssue {
                        kind: "incompatible",
                        message: format!("{} 声明与 {}（{}）不兼容。", info.file, other.file, rule),
                        files: vec![info.file.clone(), other.file.clone()],
                    });
                }
            }
        }
    }
    issues.truncate(200);
    Ok(ModCheck {
        checked: infos.len(),
        unknown,
        issues,
    })
}
fn parse_version(value: &str) -> Option<semver::Version> {
    semver::Version::parse(value).ok().or_else(|| {
        if value.matches('.').count() == 1 {
            semver::Version::parse(&format!("{value}.0")).ok()
        } else {
            None
        }
    })
}
fn version_matches(game: &str, rule: &str) -> bool {
    if !rule.is_empty() && rule.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return match (parse_version(game), parse_version(rule)) {
            (Some(actual), Some(expected)) => actual == expected,
            _ => true,
        };
    }
    match (parse_version(game), semver::VersionReq::parse(rule)) {
        (Some(v), Ok(req)) => req.matches(&v),
        _ => true,
    }
}
#[tauri::command]
pub async fn check_mod_conflicts(game_dir: String, version: String) -> ResultT<ModCheck> {
    tokio::task::spawn_blocking(move || {
        let dir = root(&game_dir)?;
        let meta = loaders::version_json(&dir, &version)?;
        let loader = meta["cclLoader"].as_str().unwrap_or("vanilla");
        let game = meta["cclBaseVersion"].as_str().unwrap_or(&version);
        let runtime = loaders::runtime_dir(&dir, &version, &meta);
        diagnose(&runtime.join("mods"), loader, game)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn jar(path: std::path::PathBuf, json: &str) {
        let mut z = zip::ZipWriter::new(fs::File::create(path).unwrap());
        z.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(json.as_bytes()).unwrap();
        z.finish().unwrap();
    }
    #[test]
    fn finds_duplicates_and_missing_dependencies_without_false_breaks() {
        let dir = std::env::temp_dir().join(format!("ccl-modcheck-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        jar(
            dir.join("a.jar"),
            r#"{"id":"foo","depends":{"fabricloader":">=0.15","missingmod":"*","minecraft":">=1.21.0"},"breaks":{"bar":"<1"}}"#,
        );
        jar(dir.join("b.jar"), r#"{"id":"foo"}"#);
        jar(dir.join("bar.jar"), r#"{"id":"bar","version":"0.5.0"}"#);
        jar(dir.join("off.jar.disabled"), r#"{"id":"missingmod"}"#);
        let result = diagnose(&dir, "fabric", "1.20.1").unwrap();
        assert!(result.issues.iter().any(|i| i.kind == "duplicate"));
        assert!(result.issues.iter().any(|i| i.kind == "missing"));
        assert!(result.issues.iter().any(|i| i.kind == "game_version"));
        assert!(result.issues.iter().any(|i| i.kind == "incompatible"));
        assert_eq!(result.checked, 3);
        fs::remove_dir_all(dir).unwrap();
    }
}
