use crate::ResultT;
use std::{path::Path, time::Duration};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

// Callers must verify a trusted digest before publishing any resumed file.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    download_inner(client, url, path, max_bytes, false, progress).await
}

pub async fn download_resume(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    download_inner(client, url, path, max_bytes, true, progress).await
}

// Split only large, verified downloads. Partial segment files are never published
// and are cleaned up on cancellation; existing partials use normal resume.
pub async fn download_parallel_resume(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    mut progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    const MIN_SIZE: u64 = 8 * 1024 * 1024;
    const SEGMENTS: u64 = 4;
    match tokio::fs::symlink_metadata(path).await {
        Ok(meta) if !meta.file_type().is_file() || meta.len() > max_bytes => {
            return Err("续传文件无效或超过大小限制".into())
        }
        Ok(meta) if meta.len() > 0 => {
            return download_resume(client, url, path, max_bytes, progress).await
        }
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("无法读取续传文件：{e}")),
    }
    let head = client
        .head(url)
        .timeout(Duration::from_secs(8))
        .send()
        .await;
    let size = head.ok().filter(|r| r.status().is_success()).and_then(|r| {
        let supports_range = r
            .headers()
            .get(reqwest::header::ACCEPT_RANGES)
            .and_then(|h| h.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("bytes"));
        let size = r
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|h| h.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        size.filter(|n| supports_range && *n >= MIN_SIZE && *n <= max_bytes)
    });
    let Some(total) = size else {
        return download_resume(client, url, path, max_bytes, progress).await;
    };
    match parallel_segments(client, url, path, total, SEGMENTS, &mut progress).await {
        Ok(()) => Ok(()),
        Err(_) => download_resume(client, url, path, max_bytes, progress).await,
    }
}

pub async fn download_parallel(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    // Reserve a fresh path atomically before handing it to the resume-capable downloader.
    let file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .map_err(|e| format!("无法创建临时文件：{e}"))?;
    drop(file);
    download_parallel_resume(client, url, path, max_bytes, progress).await
}

async fn parallel_segments(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    total: u64,
    segments: u64,
    progress: &mut impl FnMut(u64, u64),
) -> ResultT<()> {
    use futures_util::{stream, StreamExt};
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEGMENT_ID: AtomicU64 = AtomicU64::new(0);
    let id = SEGMENT_ID.fetch_add(1, Ordering::Relaxed);
    let paths: Vec<_> = (0..segments)
        .map(|i| {
            let mut name = path.as_os_str().to_os_string();
            name.push(format!(".segment-{}-{id}-{i}", std::process::id()));
            std::path::PathBuf::from(name)
        })
        .collect();
    let _cleanup: Vec<_> = paths
        .iter()
        .cloned()
        .map(crate::jobs::CleanupPath::file)
        .collect();
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel::<(usize, u64)>();
    let mut downloads = stream::iter(paths.clone().into_iter().enumerate().map(|(index, part)| {
        let sender = sender.clone();
        async move {
            let start = total * index as u64 / segments;
            let end = total * (index as u64 + 1) / segments - 1;
            let mut response = client
                .get(url)
                .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
                .timeout(Duration::from_secs(300))
                .send()
                .await
                .map_err(crate::network_error)?;
            let expected = format!("bytes {start}-{end}/{total}");
            if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
                || response
                    .headers()
                    .get(reqwest::header::CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    != Some(expected.as_str())
            {
                return Err("服务器不支持可靠的分段下载".to_string());
            }
            let mut file = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&part)
                .await
                .map_err(|e| e.to_string())?;
            let mut received = 0;
            while let Some(chunk) = response.chunk().await.map_err(crate::network_error)? {
                received += chunk.len() as u64;
                if received > end - start + 1 {
                    return Err("分段数据超出声明范围".to_string());
                }
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                let _ = sender.send((index, received));
            }
            if received != end - start + 1 {
                return Err("分段数据不完整".to_string());
            }
            file.flush().await.map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        }
    }))
    .buffer_unordered(segments as usize);
    let mut amounts = vec![0; segments as usize];
    let mut complete = 0;
    let mut last = std::time::Instant::now();
    progress(0, total);
    while complete < segments {
        tokio::select! {
            result = downloads.next() => match result { Some(Ok(())) => complete += 1, Some(Err(e)) => return Err(e), None => break },
            Some((index, amount)) = receiver.recv() => {
                amounts[index] = amount;
                if last.elapsed() >= Duration::from_millis(200) { progress(amounts.iter().sum(), total); last = std::time::Instant::now(); }
            }
        }
    }
    drop(downloads);
    let mut output = tokio::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .await
        .map_err(|e| e.to_string())?;
    for part in &paths {
        let mut input = tokio::fs::File::open(part)
            .await
            .map_err(|e| e.to_string())?;
        tokio::io::copy(&mut input, &mut output)
            .await
            .map_err(|e| e.to_string())?;
    }
    output.flush().await.map_err(|e| e.to_string())?;
    progress(total, total);
    Ok(())
}

async fn download_inner(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    max_bytes: u64,
    resume: bool,
    mut progress: impl FnMut(u64, u64),
) -> ResultT<()> {
    if resume {
        match tokio::fs::symlink_metadata(path).await {
            Ok(meta) if !meta.file_type().is_file() || meta.len() > max_bytes => {
                return Err("续传文件无效或超过大小限制".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("无法读取续传文件：{e}")),
        }
    }
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(!resume)
        .create(resume)
        .open(path)
        .await
        .map_err(|e| format!("无法创建临时文件：{e}"))?;
    let mut current = if resume {
        file.metadata().await.map_err(|e| e.to_string())?.len()
    } else {
        0
    };
    if current > 0 {
        file.seek(std::io::SeekFrom::Start(current))
            .await
            .map_err(|e| e.to_string())?;
    }
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
    async fn resumes_existing_partial_after_restart() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0; 2048];
            let size = socket.read(&mut buf).await.unwrap();
            let request = String::from_utf8_lossy(&buf[..size]).to_ascii_lowercase();
            assert!(request.contains("range: bytes=5-"));
            socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 5\r\nContent-Range: bytes 5-9/10\r\nConnection: close\r\n\r\n67890").await.unwrap();
        });
        let path =
            std::env::temp_dir().join(format!("ccl-transfer-existing-{}", std::process::id()));
        fs::write(&path, b"12345").unwrap();
        download_resume(
            &reqwest::Client::builder().no_proxy().build().unwrap(),
            &format!("http://{address}/file"),
            &path,
            100,
            |_, _| {},
        )
        .await
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"1234567890");
        server.await.unwrap();
        fs::remove_file(path).unwrap();
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
    #[tokio::test]
    async fn large_range_download_uses_multiple_connections_and_preserves_bytes() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let ranges = Arc::new(AtomicUsize::new(0));
        let count = ranges.clone();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let count = count.clone();
                tokio::spawn(async move {
                    let mut request = [0; 2048];
                    let size = socket.read(&mut request).await.unwrap();
                    let request = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
                    if request.starts_with("head ") {
                        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8388608\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n").await.unwrap();
                    } else {
                        let range = request
                            .lines()
                            .find_map(|line| line.strip_prefix("range: bytes="))
                            .unwrap();
                        let (start, end) = range.split_once('-').unwrap();
                        let start: usize = start.parse().unwrap();
                        let end: usize = end.parse().unwrap();
                        count.fetch_add(1, Ordering::SeqCst);
                        let header = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/8388608\r\nConnection: close\r\n\r\n", end-start+1,start,end);
                        socket.write_all(header.as_bytes()).await.unwrap();
                        socket.write_all(&vec![42; end - start + 1]).await.unwrap();
                    }
                });
            }
        });
        let path = std::env::temp_dir().join(format!("ccl-parallel-{}", std::process::id()));
        let _ = fs::remove_file(&path);
        download_parallel_resume(
            &reqwest::Client::builder().no_proxy().build().unwrap(),
            &format!("http://{address}/file"),
            &path,
            10_000_000,
            |_, _| {},
        )
        .await
        .unwrap();
        assert!(ranges.load(Ordering::SeqCst) >= 2);
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes.len(), 8388608);
        assert!(bytes.iter().all(|b| *b == 42));
        fs::remove_file(path).unwrap();
        server.abort();
    }
    #[tokio::test]
    async fn range_ignored_by_server_falls_back_to_normal_download() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let count = count.clone();
                tokio::spawn(async move {
                    let mut request = [0; 2048];
                    let size = socket.read(&mut request).await.unwrap();
                    let request = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
                    if request.starts_with("head ") {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8388608\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n").await;
                    } else if request.contains("range: bytes=") {
                        count.fetch_add(1, Ordering::SeqCst);
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n1234567890").await;
                    } else {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\n1234567890").await;
                    }
                });
            }
        });
        let path =
            std::env::temp_dir().join(format!("ccl-parallel-fallback-{}", std::process::id()));
        let _ = fs::remove_file(&path);
        download_parallel_resume(
            &reqwest::Client::builder().no_proxy().build().unwrap(),
            &format!("http://{address}/file"),
            &path,
            10_000_000,
            |_, _| {},
        )
        .await
        .unwrap();
        assert!(requests.load(Ordering::SeqCst) > 0);
        assert_eq!(fs::read(&path).unwrap(), b"1234567890");
        fs::remove_file(path).unwrap();
        server.abort();
    }
    #[tokio::test]
    async fn cancelling_parallel_transfer_removes_segment_files() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut request = [0; 2048];
                    let size = socket.read(&mut request).await.unwrap();
                    let request = String::from_utf8_lossy(&request[..size]).to_ascii_lowercase();
                    if request.starts_with("head ") {
                        let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8388608\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n").await;
                    } else if let Some(range) = request
                        .lines()
                        .find_map(|line| line.strip_prefix("range: bytes="))
                    {
                        let (start, end) = range.split_once('-').unwrap();
                        let start: usize = start.parse().unwrap();
                        let end: usize = end.parse().unwrap();
                        let response = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/8388608\r\nConnection: close\r\n\r\n1234",end-start+1,start,end);
                        let _ = socket.write_all(response.as_bytes()).await;
                        tokio::time::sleep(Duration::from_secs(10)).await;
                    }
                });
            }
        });
        let dir = std::env::temp_dir().join(format!("ccl-cancel-segments-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir(&dir).unwrap();
        let path = dir.join("download.part");
        let download = tokio::spawn(async move {
            download_parallel_resume(
                &reqwest::Client::builder().no_proxy().build().unwrap(),
                &format!("http://{address}/file"),
                &path,
                10_000_000,
                |_, _| {},
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), async {
            while fs::read_dir(&dir).unwrap().next().is_none() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        download.abort();
        let _ = download.await;
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(dir).unwrap();
        server.abort();
    }
    use std::fs;
}
