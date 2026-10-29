use crate::ResultT;
use std::{path::Path, time::Duration};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

// The caller owns the temporary file and must verify a trusted digest before
// publishing it. A partial file is reused only within this invocation.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    mut progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .map_err(|e| format!("无法创建临时文件：{e}"))?;
    let mut current = 0u64;
    let mut expected_total = None;
    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(300 * attempt)).await;
        }
        let mut request = client.get(url).timeout(Duration::from_secs(300));
        if current > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={current}-"));
        }
        let mut response = match request.send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = crate::network_error(e);
                continue;
            }
        };
        let status = response.status();
        if current > 0 && status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            file.set_len(0).await.map_err(|e| e.to_string())?;
            file.seek(std::io::SeekFrom::Start(0))
                .await
                .map_err(|e| e.to_string())?;
            current = 0;
            expected_total = None;
            last_error = "服务器无法续传，正在重新下载".into();
            continue;
        }
        if !status.is_success() {
            last_error = format!("服务器返回 HTTP {status}");
            if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                continue;
            }
            return Err(last_error);
        }
        let total = if status == reqwest::StatusCode::PARTIAL_CONTENT {
            let header = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|h| h.to_str().ok())
                .unwrap_or("");
            let Some((range, total)) = header
                .strip_prefix("bytes ")
                .and_then(|v| v.split_once('/'))
            else {
                return Err("服务器返回了无效的续传范围".into());
            };
            let Some((start, end)) = range
                .split_once('-')
                .and_then(|(a, b)| Some((a.parse::<u64>().ok()?, b.parse::<u64>().ok()?)))
            else {
                return Err("服务器返回了无效的续传范围".into());
            };
            let total = total
                .parse::<u64>()
                .map_err(|_| "服务器未提供有效的续传文件大小")?;
            if start != current
                || end < start
                || end >= total
                || expected_total.is_some_and(|n| n != total)
            {
                return Err("服务器返回了不匹配的续传范围".into());
            }
            Some(total)
        } else {
            if current > 0 {
                file.set_len(0).await.map_err(|e| e.to_string())?;
                file.seek(std::io::SeekFrom::Start(0))
                    .await
                    .map_err(|e| e.to_string())?;
                current = 0;
            }
            response.content_length()
        };
        if total.is_some_and(|n| n > max_bytes) {
            return Err("下载文件超过大小限制".into());
        }
        expected_total = total;
        progress(current, total.unwrap_or(0));
        let mut last = std::time::Instant::now();
        let mut failed = false;
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    current = current
                        .checked_add(chunk.len() as u64)
                        .ok_or("下载文件过大")?;
                    if current > max_bytes || total.is_some_and(|t| current > t) {
                        return Err("下载文件超过大小限制或声明长度".into());
                    }
                    file.write_all(&chunk)
                        .await
                        .map_err(|e| format!("保存下载文件失败：{e}"))?;
                    if last.elapsed() >= Duration::from_millis(200) {
                        progress(current, total.unwrap_or(0));
                        last = std::time::Instant::now();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    last_error = crate::network_error(e);
                    failed = true;
                    break;
                }
            }
        }
        if !failed && total.is_some_and(|n| n != current) {
            last_error = "下载数据不完整".into();
            failed = true;
        }
        if !failed {
            file.flush().await.map_err(|e| e.to_string())?;
            progress(current, total.unwrap_or(0));
            return Ok(());
        }
    }
    Err(format!("下载中断，重试后仍未完成：{last_error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[tokio::test]
    async fn resumes_interrupted_download_and_restarts_when_range_ignored() {
        for support_range in [true, false] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let mut seen = Vec::new();
                for n in 0..2 {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut buf = [0; 2048];
                    let size = socket.read(&mut buf).await.unwrap();
                    seen.push(String::from_utf8_lossy(&buf[..size]).to_string());
                    if n == 0 {
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n12345").await.unwrap();
                    } else if support_range {
                        socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 5-9/10\r\nConnection: close\r\n\r\n67890").await.unwrap();
                    } else {
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n1234567890").await.unwrap();
                    }
                }
                seen
            });
            let path = std::env::temp_dir().join(format!(
                "ccl-transfer-{}-{support_range}",
                std::process::id()
            ));
            let _ = fs::remove_file(&path);
            download(
                &reqwest::Client::builder().no_proxy().build().unwrap(),
                &format!("http://{address}/file"),
                &path,
                100,
                |_, _| {},
            )
            .await
            .unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"1234567890");
            let seen = server.await.unwrap();
            assert!(seen[1].to_ascii_lowercase().contains("range: bytes=5-"));
            fs::remove_file(path).unwrap();
        }
    }
    #[tokio::test]
    async fn rejects_invalid_partial_response_and_oversized_file() {
        for oversized in [false, true] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut b = [0u8; 1024];
                let _ = socket.read(&mut b).await.unwrap();
                if oversized {
                    socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 101\r\nConnection: close\r\n\r\n",
                        )
                        .await
                        .unwrap();
                } else {
                    socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 4-8/10\r\nConnection: close\r\n\r\n56789").await.unwrap();
                }
            });
            let path = std::env::temp_dir().join(format!(
                "ccl-transfer-invalid-{}-{oversized}",
                std::process::id()
            ));
            let _ = fs::remove_file(&path);
            let result = download(
                &reqwest::Client::builder().no_proxy().build().unwrap(),
                &format!("http://{address}/file"),
                &path,
                100,
                |_, _| {},
            )
            .await;
            assert!(result.is_err());
            assert_eq!(fs::metadata(&path).unwrap().len(), 0);
            server.await.unwrap();
            fs::remove_file(path).unwrap();
        }
    }
    use std::fs;
}
