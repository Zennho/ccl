use serde::Serialize;
use std::{
    net::{IpAddr, Ipv6Addr, SocketAddr, SocketAddrV6},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ipv6Address {
    pub address: String,
    pub interface: String,
    pub scope: &'static str,
}

pub fn addresses() -> Result<Vec<Ipv6Address>, String> {
    let interfaces = if_addrs::get_if_addrs().map_err(|_| "无法读取本机网络接口")?;
    let mut result = Vec::new();
    for interface in interfaces {
        let IpAddr::V6(ip) = interface.ip() else {
            continue;
        };
        let first = ip.segments()[0];
        let scope = if first & 0xe000 == 0x2000 {
            "公网候选"
        } else if first & 0xfe00 == 0xfc00 {
            "内网"
        } else {
            continue;
        };
        result.push(Ipv6Address {
            address: ip.to_string(),
            interface: interface.name,
            scope,
        });
    }
    result.sort_by(|a, b| {
        a.scope
            .cmp(b.scope)
            .then(a.interface.cmp(&b.interface))
            .then(a.address.cmp(&b.address))
    });
    result.dedup_by(|a, b| a.address == b.address && a.interface == b.interface);
    Ok(result)
}

pub fn parse_target(value: &str) -> Result<SocketAddrV6, String> {
    let address: SocketAddr = value
        .trim()
        .parse()
        .map_err(|_| "请输入 [IPv6地址]:端口，例如 [2001:db8::1]:25565")?;
    match address {
        SocketAddr::V6(v6)
            if v6.port() != 0
                && !v6.ip().is_unspecified()
                && !v6.ip().is_multicast()
                && v6.ip().to_ipv4_mapped().is_none() =>
        {
            Ok(v6)
        }
        _ => Err("请输入有效的 IPv6 地址和 1–65535 的端口".into()),
    }
}

pub async fn probe(target: SocketAddrV6) -> Result<(), String> {
    match tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(target)).await {
        Ok(Ok(_)) => Ok(()),
        Ok(Err(_)) => Err("无法建立 TCP 连接，请检查地址、端口、房间状态和防火墙".into()),
        Err(_) => Err("连接超时，请检查双方 IPv6 网络和主机防火墙".into()),
    }
}

pub struct Room {
    pub port: u16,
    task: JoinHandle<()>,
}

impl Room {
    pub async fn start(game_port: u16) -> Result<Self, String> {
        if game_port == 0 {
            return Err("请输入游戏显示的局域网端口（1–65535）".into());
        }
        let upstream = SocketAddr::from(([127, 0, 0, 1], game_port));
        match tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(upstream)).await {
            Ok(Ok(_)) => (),
            _ => return Err("无法连接本机游戏端口，请先在游戏中开放局域网并检查端口".into()),
        }
        let socket = socket2::Socket::new(
            socket2::Domain::IPV6,
            socket2::Type::STREAM,
            Some(socket2::Protocol::TCP),
        )
        .map_err(|_| "无法开启 IPv6 监听，请检查系统 IPv6 设置")?;
        socket.set_only_v6(true).map_err(|_| "无法设置 IPv6 监听")?;
        socket
            .set_nonblocking(true)
            .map_err(|_| "无法设置联机监听")?;
        socket
            .bind(&SocketAddr::V6(SocketAddrV6::new(Ipv6Addr::UNSPECIFIED, 0, 0, 0)).into())
            .map_err(|_| "无法开启 IPv6 监听，请检查系统 IPv6 设置")?;
        socket.listen(64).map_err(|_| "无法启动联机监听")?;
        let listener = TcpListener::from_std(socket.into()).map_err(|_| "无法启动联机监听")?;
        let port = listener
            .local_addr()
            .map_err(|_| "无法获取联机端口")?
            .port();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            while let Ok((mut incoming, _)) = listener.accept().await {
                while connections.try_join_next().is_some() {}
                if connections.len() >= 32 {
                    continue;
                }
                connections.spawn(async move {
                    if let Ok(Ok(mut game)) =
                        tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(upstream))
                            .await
                    {
                        let _ = tokio::io::copy_bidirectional(&mut incoming, &mut game).await;
                    }
                });
            }
        });
        Ok(Self { port, task })
    }

    pub async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn validates_ipv6_targets() {
        assert!(parse_target("[2001:db8::1]:25565").is_ok());
        assert!(parse_target("2001:db8::1:25565").is_err());
        assert!(parse_target("127.0.0.1:25565").is_err());
        assert!(parse_target("[::]:1").is_err());
        assert!(parse_target("[::1]:0").is_err());
    }

    #[tokio::test]
    async fn relays_ipv6_to_local_game_and_closes_active_connections() {
        let game = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let game_port = game.local_addr().unwrap().port();
        let room = Room::start(game_port).await.unwrap();
        assert!(
            TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, room.port))
                .await
                .is_err()
        );
        let (first, _) = game.accept().await.unwrap();
        drop(first); // startup checks whether the game is accepting connections
        let mut friend = TcpStream::connect((Ipv6Addr::LOCALHOST, room.port))
            .await
            .unwrap();
        let (mut upstream, _) = tokio::time::timeout(Duration::from_secs(2), game.accept())
            .await
            .unwrap()
            .unwrap();
        friend.write_all(b"hello").await.unwrap();
        let mut buf = [0; 5];
        upstream.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello");
        upstream.write_all(b"world").await.unwrap();
        friend.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"world");
        let port = room.port;
        room.stop().await;
        assert!(TcpStream::connect((Ipv6Addr::LOCALHOST, port))
            .await
            .is_err());
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), friend.read(&mut buf))
                .await
                .unwrap()
                .unwrap(),
            0
        );
    }
}
