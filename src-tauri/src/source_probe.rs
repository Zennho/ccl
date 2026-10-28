use std::time::Duration;
use tokio::time::Instant;

async fn sample(client: &reqwest::Client, url: &str) -> Option<f64> {
    let start = Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(4), async {
        let mut response = client
            .get(url)
            .header(reqwest::header::RANGE, "bytes=0-131071")
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        let mut bytes = 0usize;
        while let Some(chunk) = response.chunk().await.ok()? {
            bytes += chunk.len();
            if bytes >= 131_072 {
                break;
            }
        }
        if bytes == 0 {
            None
        } else {
            Some(bytes as f64 / start.elapsed().as_secs_f64().max(0.001))
        }
    })
    .await;
    result.ok().flatten()
}
pub async fn fastest(client: &reqwest::Client, official: &str, mirror: &str) -> Option<bool> {
    let (a, b) = tokio::join!(sample(client, official), sample(client, mirror));
    match (a, b) {
        (Some(a), Some(b)) => Some(b > a),
        (Some(_), None) => Some(false),
        (None, Some(_)) => Some(true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn server(delay: u64) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            socket.read(&mut request).await.unwrap();
            tokio::time::sleep(Duration::from_millis(delay)).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest")
                .await
                .unwrap();
        });
        (format!("http://{addr}"), task)
    }
    #[tokio::test]
    async fn selects_faster_source_and_handles_failure() {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let (a, ta) = server(160).await;
        let (b, tb) = server(10).await;
        assert_eq!(fastest(&client, &a, &b).await, Some(true));
        ta.await.unwrap();
        tb.await.unwrap();
        let (good, tg) = server(10).await;
        assert_eq!(
            fastest(&client, "http://127.0.0.1:1", &good).await,
            Some(true)
        );
        tg.await.unwrap();
    }
}
