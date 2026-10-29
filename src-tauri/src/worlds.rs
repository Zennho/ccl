use crate::{backups, jobs, loaders, root, version_manager, ResultT};
use flate2::read::GzDecoder;
use serde::Serialize;
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::Command,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    folder: String,
    name: String,
    game_version: Option<String>,
    last_played: Option<i64>,
    metadata_error: bool,
}
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 200
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
}
fn saves_dir(runtime: &Path, create: bool) -> ResultT<PathBuf> {
    let p = runtime.join("saves");
    if create {
        fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }
    match fs::symlink_metadata(&p) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => Ok(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(p),
        _ => Err("存档目录不是安全的普通目录".into()),
    }
}
fn read_u8(r: &mut Cursor<Vec<u8>>) -> ResultT<u8> {
    let mut b = [0];
    r.read_exact(&mut b).map_err(|_| "存档数据不完整")?;
    Ok(b[0])
}
fn read_u16(r: &mut Cursor<Vec<u8>>) -> ResultT<u16> {
    let mut b = [0; 2];
    r.read_exact(&mut b).map_err(|_| "存档数据不完整")?;
    Ok(u16::from_be_bytes(b))
}
fn read_i32(r: &mut Cursor<Vec<u8>>) -> ResultT<i32> {
    let mut b = [0; 4];
    r.read_exact(&mut b).map_err(|_| "存档数据不完整")?;
    Ok(i32::from_be_bytes(b))
}
fn read_i64(r: &mut Cursor<Vec<u8>>) -> ResultT<i64> {
    let mut b = [0; 8];
    r.read_exact(&mut b).map_err(|_| "存档数据不完整")?;
    Ok(i64::from_be_bytes(b))
}
fn string(r: &mut Cursor<Vec<u8>>) -> ResultT<String> {
    let len = read_u16(r)? as usize;
    let mut b = vec![0; len];
    r.read_exact(&mut b).map_err(|_| "存档数据不完整")?;
    Ok(String::from_utf8_lossy(&b).into_owned())
}
fn skip(r: &mut Cursor<Vec<u8>>, n: usize) -> ResultT<()> {
    let pos = r.position() as usize;
    if n > r.get_ref().len().saturating_sub(pos) {
        return Err("存档数据不完整".into());
    }
    r.set_position((pos + n) as u64);
    Ok(())
}
#[derive(Default)]
struct Info {
    name: Option<String>,
    version: Option<String>,
    last: Option<i64>,
}
fn payload(
    r: &mut Cursor<Vec<u8>>,
    tag: u8,
    path: &str,
    info: &mut Info,
    depth: usize,
) -> ResultT<()> {
    if depth > 64 {
        return Err("存档数据层级过深".into());
    }
    match tag {
        1 => skip(r, 1)?,
        2 => skip(r, 2)?,
        3 | 5 => skip(r, 4)?,
        4 => {
            let v = read_i64(r)?;
            if path == "Data.LastPlayed" {
                info.last = Some(v);
            }
        }
        6 => skip(r, 8)?,
        7 | 11 | 12 => {
            let n = read_i32(r)?;
            if n < 0 {
                return Err("存档数组长度无效".into());
            }
            let item = if tag == 7 {
                1
            } else if tag == 11 {
                4
            } else {
                8
            };
            skip(r, (n as usize).checked_mul(item).ok_or("存档数组过大")?)?;
        }
        8 => {
            let v = string(r)?;
            if path == "Data.LevelName" {
                info.name = Some(v);
            } else if path == "Data.Version.Name" {
                info.version = Some(v);
            }
        }
        9 => {
            let sub = read_u8(r)?;
            let len = read_i32(r)?;
            if len < 0 || len > 1_000_000 {
                return Err("存档列表长度无效".into());
            }
            for _ in 0..len {
                payload(r, sub, "", info, depth + 1)?;
            }
        }
        10 => loop {
            let next = read_u8(r)?;
            if next == 0 {
                break;
            }
            let name = string(r)?;
            let child = if path.is_empty() {
                name
            } else {
                format!("{path}.{name}")
            };
            payload(r, next, &child, info, depth + 1)?;
        },
        _ => return Err("未知存档数据类型".into()),
    }
    Ok(())
}
fn metadata(path: &Path) -> ResultT<Info> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut decoded = Vec::new();
    GzDecoder::new(f)
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut decoded)
        .map_err(|_| "无法解压存档信息")?;
    if decoded.len() > 16 * 1024 * 1024 {
        return Err("存档信息过大".into());
    }
    let mut r = Cursor::new(decoded);
    if read_u8(&mut r)? != 10 {
        return Err("存档信息格式无效".into());
    }
    let _ = string(&mut r)?;
    let mut info = Info::default();
    payload(&mut r, 10, "", &mut info, 0)?;
    Ok(info)
}
fn list(runtime: &Path) -> ResultT<Vec<World>> {
    let dir = saves_dir(runtime, false)?;
    let entries = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut worlds = Vec::new();
    for entry in entries.flatten() {
        if !entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Some(folder) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !safe_name(&folder) {
            continue;
        }
        let file = entry.path().join("level.dat");
        if !fs::symlink_metadata(&file).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
            continue;
        }
        let meta = metadata(&file);
        let error = meta.is_err();
        let info = meta.unwrap_or_default();
        worlds.push(World {
            name: info
                .name
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| folder.clone()),
            folder,
            game_version: info.version,
            last_played: info.last,
            metadata_error: error,
        });
    }
    worlds.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then_with(|| a.folder.cmp(&b.folder))
    });
    Ok(worlds)
}
fn context(game_dir: &str, version: &str) -> ResultT<(PathBuf, PathBuf)> {
    let root = root(game_dir)?;
    let meta = loaders::version_json(&root, version)?;
    let runtime = loaders::runtime_dir(&root, version, &meta);
    Ok((root, runtime))
}
#[tauri::command]
pub async fn list_worlds(game_dir: String, version: String) -> ResultT<Vec<World>> {
    tokio::task::spawn_blocking(move || {
        let (_, runtime) = context(&game_dir, &version)?;
        list(&runtime)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn open_world_folder(game_dir: String, version: String, folder: Option<String>) -> ResultT<()> {
    let (_, runtime) = context(&game_dir, &version)?;
    let saves = saves_dir(&runtime, true)?;
    let path = if let Some(name) = folder {
        if !safe_name(&name) {
            return Err("存档名称无效".into());
        }
        let p = saves.join(name);
        let m = fs::symlink_metadata(&p).map_err(|_| "存档不存在")?;
        if !m.is_dir() || m.file_type().is_symlink() {
            return Err("存档目录无效".into());
        }
        p
    } else {
        saves
    };
    #[cfg(target_os = "windows")]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(path)
        .spawn()
        .map_err(|e| format!("无法打开文件夹：{e}"))?;
    Ok(())
}
#[tauri::command]
pub async fn delete_world(game_dir: String, version: String, folder: String) -> ResultT<String> {
    tokio::task::spawn_blocking(move || {
        if !safe_name(&folder) {
            return Err("存档名称无效".into());
        }
        let (root, runtime) = context(&game_dir, &version)?;
        let _guard = version_manager::reserve_directory(&root)?;
        jobs::while_idle(&game_dir, || {
            let path = saves_dir(&runtime, false)?.join(&folder);
            let meta = fs::symlink_metadata(&path).map_err(|_| "存档不存在")?;
            if !meta.is_dir() || meta.file_type().is_symlink() {
                return Err("存档目录无效".into());
            }
            let backup = backups::make_backup(&root, &runtime, &version, "world", Some(&folder))?;
            fs::remove_dir_all(&path)
                .map_err(|e| format!("删除失败：{e}；存档备份 {backup} 已保留"))?;
            Ok(backup)
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn name(out: &mut Vec<u8>, tag: u8, key: &str) {
        out.push(tag);
        out.extend_from_slice(&(key.len() as u16).to_be_bytes());
        out.extend_from_slice(key.as_bytes());
    }
    fn string_tag(out: &mut Vec<u8>, key: &str, value: &str) {
        name(out, 8, key);
        out.extend_from_slice(&(value.len() as u16).to_be_bytes());
        out.extend_from_slice(value.as_bytes());
    }
    #[test]
    fn reads_minecraft_level_data_and_handles_bad_files() {
        let dir = std::env::temp_dir().join(format!("ccl-world-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("saves/world")).unwrap();
        let mut nbt = vec![10, 0, 0];
        name(&mut nbt, 10, "Data");
        string_tag(&mut nbt, "LevelName", "My world");
        name(&mut nbt, 10, "Version");
        string_tag(&mut nbt, "Name", "1.20.1");
        nbt.push(0);
        name(&mut nbt, 4, "LastPlayed");
        nbt.extend_from_slice(&123456789i64.to_be_bytes());
        nbt.extend_from_slice(&[0, 0]);
        let file = File::create(dir.join("saves/world/level.dat")).unwrap();
        let mut gzip = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        gzip.write_all(&nbt).unwrap();
        gzip.finish().unwrap();
        let world = list(&dir).unwrap().remove(0);
        assert_eq!(world.name, "My world");
        assert_eq!(world.game_version.as_deref(), Some("1.20.1"));
        assert_eq!(world.last_played, Some(123456789));
        fs::write(dir.join("saves/world/level.dat"), b"bad").unwrap();
        assert!(list(&dir).unwrap()[0].metadata_error);
        fs::remove_dir_all(dir).unwrap();
    }
    use std::fs::File;
}
