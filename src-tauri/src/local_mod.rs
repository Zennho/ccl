use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::{Read, Seek},
    path::Path,
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMod {
    pub name: String,
    pub enabled: bool,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub mod_id: Option<String>,
    pub version: Option<String>,
    pub icon: Option<String>,
    pub website: Option<String>,
}

fn entry<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, name: &str, limit: u64) -> Option<Vec<u8>> {
    let file = zip.by_name(name).ok()?;
    if file.size() > limit {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).ok()?;
    (bytes.len() as u64 <= limit).then_some(bytes)
}

fn text(value: &Value, field: &str, max: usize) -> Option<String> {
    let text = value[field].as_str()?.trim();
    (!text.is_empty()).then(|| text.chars().take(max).collect())
}

fn parse<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, info: &mut LocalMod) {
    let mut icon = None;
    if let Some(bytes) = entry(zip, "fabric.mod.json", 512 * 1024) {
        if let Ok(meta) = serde_json::from_slice::<Value>(&bytes) {
            info.display_name = text(&meta, "name", 256);
            info.description = text(&meta, "description", 16000);
            info.mod_id = text(&meta, "id", 256);
            info.version = text(&meta, "version", 256);
            info.website = text(&meta["contact"], "homepage", 2048);
            icon = meta["icon"].as_str().map(str::to_owned).or_else(|| {
                meta["icon"].as_object().and_then(|icons| {
                    icons
                        .values()
                        .filter_map(Value::as_str)
                        .next()
                        .map(str::to_owned)
                })
            });
        }
    } else if let Some(bytes) = entry(zip, "quilt.mod.json", 512 * 1024) {
        if let Ok(meta) = serde_json::from_slice::<Value>(&bytes) {
            let loader = &meta["quilt_loader"];
            let fields = &loader["metadata"];
            info.display_name = text(fields, "name", 256);
            info.description = text(fields, "description", 16000);
            info.mod_id = text(loader, "id", 256);
            info.version = text(loader, "version", 256);
            info.website = text(&fields["contact"], "homepage", 2048);
            icon = fields["icon"].as_str().map(str::to_owned);
        }
    } else {
        let bytes = entry(zip, "META-INF/neoforge.mods.toml", 512 * 1024)
            .or_else(|| entry(zip, "META-INF/mods.toml", 512 * 1024));
        if let Some(meta) = bytes
            .and_then(|b| String::from_utf8(b).ok())
            .and_then(|s| toml::from_str::<toml::Value>(&s).ok())
        {
            if let Some(mod_info) = meta
                .get("mods")
                .and_then(toml::Value::as_array)
                .and_then(|m| m.first())
            {
                let get = |key: &str, max: usize| {
                    mod_info
                        .get(key)
                        .and_then(toml::Value::as_str)
                        .map(|s| s.chars().take(max).collect())
                };
                info.display_name = get("displayName", 256);
                info.description = get("description", 16000);
                info.mod_id = get("modId", 256);
                info.version = get("version", 256);
                info.website = get("displayURL", 2048);
                icon = get("logoFile", 512);
            }
        }
    }
    if info.mod_id.is_none() && info.display_name.is_none() {
        if let Some(meta) = entry(zip, "mcmod.info", 512 * 1024)
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        {
            let fields = meta
                .as_array()
                .and_then(|items| items.first())
                .or_else(|| meta["modList"].as_array().and_then(|items| items.first()));
            if let Some(fields) = fields {
                info.display_name = text(fields, "name", 256);
                info.description = text(fields, "description", 16000);
                info.mod_id = text(fields, "modid", 256);
                info.version = text(fields, "version", 256);
                info.website = text(fields, "url", 2048);
                icon = text(fields, "logoFile", 512);
            }
        }
    }
    if let Some(name) = icon.filter(|s| s.to_ascii_lowercase().ends_with(".png")) {
        if let Some(bytes) = entry(zip, &name, 256 * 1024) {
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                info.icon = Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
            }
        }
    }
}

pub fn read(path: &Path, name: String) -> LocalMod {
    let mut info = LocalMod {
        enabled: name.ends_with(".jar"),
        name,
        ..Default::default()
    };
    if let Ok(file) = fs::File::open(path) {
        if let Ok(mut archive) = zip::ZipArchive::new(file) {
            parse(&mut archive, &mut info);
        }
    }
    info
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    fn archive(entries: &[(&str, &[u8])]) -> zip::ZipArchive<Cursor<Vec<u8>>> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        zip::ZipArchive::new(writer.finish().unwrap()).unwrap()
    }
    #[test]
    fn fabric_and_forge_metadata_and_png_icons_are_read() {
        let mut zip = archive(&[("fabric.mod.json", br#"{"id":"example","name":"Example","description":"A mod","version":"1","icon":"icon.png"}"#), ("icon.png", b"\x89PNG\r\n\x1a\nrest")]);
        let mut info = LocalMod::default();
        parse(&mut zip, &mut info);
        assert_eq!(info.display_name.as_deref(), Some("Example"));
        assert_eq!(info.description.as_deref(), Some("A mod"));
        assert!(info.icon.unwrap().starts_with("data:image/png;base64,"));
        let mut zip = archive(&[(
            "META-INF/mods.toml",
            b"[[mods]]\nmodId='forge_mod'\ndisplayName='Forge mod'\ndescription='Details'\n",
        )]);
        let mut info = LocalMod::default();
        parse(&mut zip, &mut info);
        assert_eq!(info.mod_id.as_deref(), Some("forge_mod"));
        assert_eq!(info.description.as_deref(), Some("Details"));
    }
    #[test]
    fn legacy_forge_metadata_is_read() {
        let mut zip = archive(&[(
            "mcmod.info",
            br#"[{"modid":"legacy","name":"Old mod","description":"Older mod"}]"#,
        )]);
        let mut info = LocalMod::default();
        parse(&mut zip, &mut info);
        assert_eq!(info.mod_id.as_deref(), Some("legacy"));
        assert_eq!(info.description.as_deref(), Some("Older mod"));
    }
    #[test]
    fn invalid_and_oversized_icons_are_ignored() {
        let mut zip = archive(&[
            ("fabric.mod.json", br#"{"icon":"icon.png"}"#),
            ("icon.png", b"not png"),
        ]);
        let mut info = LocalMod::default();
        parse(&mut zip, &mut info);
        assert!(info.icon.is_none());
        let mut oversized = vec![0u8; 256 * 1024 + 1];
        oversized[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let mut zip = archive(&[
            ("fabric.mod.json", br#"{"icon":"icon.png"}"#),
            ("icon.png", &oversized),
        ]);
        let mut info = LocalMod::default();
        parse(&mut zip, &mut info);
        assert!(info.icon.is_none());
    }
}
