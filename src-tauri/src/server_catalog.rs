use crate::{http_client, ResultT};
use serde_json::Value;
use std::time::Duration;

const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Zennho/ccl-server-catalog/master/data/servers.json";

#[tauri::command]
pub async fn public_servers() -> ResultT<Value> {
    let mut response = http_client()?
        .get(CATALOG_URL)
        .timeout(Duration::from_secs(35))
        .send()
        .await
        .map_err(|_| "无法连接服务器目录，请检查网络或代理")?
        .error_for_status()
        .map_err(|error| {
            format!(
                "服务器目录不可用（HTTP {}）",
                error.status().map(|s| s.as_u16()).unwrap_or(0)
            )
        })?;
    if response
        .content_length()
        .is_some_and(|length| length > 32_000_000)
    {
        return Err("服务器目录过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取服务器目录失败")? {
        if bytes.len().saturating_add(chunk.len()) > 32_000_000 {
            return Err("服务器目录过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| "服务器目录格式无效")?;
    if data["schemaVersion"].as_u64() != Some(1)
        || !data["servers"].is_array()
        || !data["updatedAt"].is_string()
    {
        return Err("服务器目录格式不受支持".into());
    }
    Ok(data)
}
