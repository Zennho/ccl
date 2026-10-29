//! Check the public GitHub Release feed without installing unverified binaries.
use crate::{auth, http_client, ResultT};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{cmp::Ordering, time::Duration};

const LATEST_URL: &str = "https://api.github.com/repos/Zennho/ccl/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/Zennho/ccl/releases/latest";
const MAX_RESPONSE: usize = 1_048_576;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    current_version: String,
    latest_version: String,
    available: bool,
}
fn evaluate(release: Release, current: &str) -> ResultT<UpdateStatus> {
    if release.draft || release.prerelease {
        return Err("更新信息不是正式版本".into());
    }
    let tag = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let latest = Version::parse(tag).map_err(|_| "更新版本号无效")?;
    let current = Version::parse(current).map_err(|_| "当前版本号无效")?;
    if !latest.pre.is_empty() {
        return Err("更新信息不是正式版本".into());
    }
    Ok(UpdateStatus {
        available: latest.cmp_precedence(&current) == Ordering::Greater,
        current_version: current.to_string(),
        latest_version: latest.to_string(),
    })
}
async fn fetch_latest(client: &reqwest::Client, url: &str, current: &str) -> ResultT<UpdateStatus> {
    let mut response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(Duration::from_secs(12))
        .send()
        .await
        .map_err(|_| "无法连接 GitHub，请检查网络或代理")?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub 更新服务返回 HTTP {}",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err("更新信息过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取更新信息失败")? {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err("更新信息过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let release = serde_json::from_slice(&bytes).map_err(|_| "更新信息格式无效")?;
    evaluate(release, current)
}
#[tauri::command]
pub async fn check_launcher_update() -> ResultT<UpdateStatus> {
    fetch_latest(&http_client()?, LATEST_URL, env!("CARGO_PKG_VERSION")).await
}
#[tauri::command]
pub fn open_launcher_releases() -> ResultT<()> {
    auth::open_browser(RELEASES_PAGE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            draft: false,
            prerelease: false,
        }
    }
    #[test]
    fn compares_stable_semantic_versions_without_downgrades() {
        assert!(evaluate(release("v0.1.12"), "0.1.9").unwrap().available);
        assert!(!evaluate(release("v0.1.9"), "0.1.11").unwrap().available);
        assert!(
            !evaluate(release("v0.1.11+build.9"), "0.1.11")
                .unwrap()
                .available
        );
        assert!(evaluate(release("v0.2.0-rc.1"), "0.1.11").is_err());
        assert!(evaluate(
            Release {
                prerelease: true,
                ..release("v0.2.0")
            },
            "0.1.11"
        )
        .is_err());
        assert!(evaluate(release("v0.2"), "0.1.11").is_err());
    }
    #[tokio::test]
    async fn reads_the_latest_release_and_reports_http_errors() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for status in ["200 OK", "403 Forbidden"] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0; 4096];
                let n = socket.read(&mut buf).await.unwrap();
                assert!(String::from_utf8_lossy(&buf[..n])
                    .to_ascii_lowercase()
                    .contains("application/vnd.github+json"));
                let body = r#"{"tag_name":"v0.1.12","draft":false,"prerelease":false}"#;
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("http://{address}/latest");
        assert!(
            fetch_latest(&client, &url, "0.1.11")
                .await
                .unwrap()
                .available
        );
        assert!(fetch_latest(&client, &url, "0.1.11")
            .await
            .unwrap_err()
            .contains("403"));
        server.await.unwrap();
    }
}
