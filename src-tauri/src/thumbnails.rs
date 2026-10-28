use crate::{http_client_builder, ResultT};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{sync::OnceLock, time::Duration};
use tokio::sync::{Mutex, Semaphore};
use tokio::time::Instant;

static SLOTS: OnceLock<Semaphore> = OnceLock::new();
static SERVER_RATE: OnceLock<Mutex<Instant>> = OnceLock::new();
const MAX_IMAGE: usize = 1_048_576;

fn thumbnail_url(kind: &str, value: &str) -> ResultT<reqwest::Url> {
    if kind == "server" {
        if value.is_empty()
            || value.len() > 255
            || !value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c))
        {
            return Err("服务器地址无效".into());
        }
        let mut url =
            reqwest::Url::parse("https://api.mcstatus.io/v2/icon/").map_err(|_| "图片地址无效")?;
        url.path_segments_mut()
            .map_err(|_| "图片地址无效")?
            .pop_if_empty()
            .push(value);
        return Ok(url);
    }
    if kind != "content" || value.len() > 2048 {
        return Err("图片来源无效".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "图片地址无效")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(
            url.host_str(),
            Some("cdn.modrinth.com" | "media.forgecdn.net" | "mediafilez.forgecdn.net")
        )
    {
        return Err("图片来源不受支持".into());
    }
    Ok(url)
}

fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

#[tauri::command]
pub async fn fetch_thumbnail(kind: String, value: String) -> ResultT<String> {
    let url = thumbnail_url(&kind, &value)?;
    let _slot = SLOTS
        .get_or_init(|| Semaphore::new(4))
        .acquire()
        .await
        .map_err(|_| "图片加载已停止")?;
    if kind == "server" {
        let mut next = SERVER_RATE
            .get_or_init(|| Mutex::new(Instant::now()))
            .lock()
            .await;
        tokio::time::sleep_until(*next).await;
        *next = Instant::now() + Duration::from_millis(300);
    }
    let client = http_client_builder()?
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化图片请求")?;
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "图片连接失败")?
        .error_for_status()
        .map_err(|_| "图片不可用")?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE as u64)
    {
        return Err("图片过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "图片读取失败")? {
        if bytes.len() + chunk.len() > MAX_IMAGE {
            return Err("图片过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mime = image_type(&bytes).ok_or("图片格式不受支持")?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_sources_and_image_formats() {
        assert!(thumbnail_url("content", "https://cdn.modrinth.com/data/test/icon.webp").is_ok());
        assert!(thumbnail_url("content", "https://media.forgecdn.net/avatars/a.png").is_ok());
        assert!(
            thumbnail_url("content", "https://cdn.modrinth.com.evil.invalid/icon.png").is_err()
        );
        assert!(thumbnail_url("content", "http://cdn.modrinth.com/icon.png").is_err());
        assert!(thumbnail_url("server", "[2001:db8::1]:25565").is_ok());
        assert_eq!(
            thumbnail_url("server", "mc.hypixel.net").unwrap().as_str(),
            "https://api.mcstatus.io/v2/icon/mc.hypixel.net"
        );
        assert!(thumbnail_url("server", "../../bad").is_err());
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\nhello"), Some("image/png"));
        assert!(image_type(b"<svg onload='bad'/>").is_none());
    }
}
