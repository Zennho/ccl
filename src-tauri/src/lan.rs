use crate::lan_core::{self, Ipv6Address, Room};
use std::sync::OnceLock;
use tokio::sync::Mutex;

static ROOM: OnceLock<Mutex<Option<Room>>> = OnceLock::new();
fn room() -> &'static Mutex<Option<Room>> {
    ROOM.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
pub fn ipv6_addresses() -> Result<Vec<Ipv6Address>, String> {
    lan_core::addresses()
}

#[tauri::command]
pub async fn start_ipv6_room(game_port: u16) -> Result<u16, String> {
    let mut current = room().lock().await;
    if current.is_some() {
        return Err("已有联机房间，请先关闭房间".into());
    }
    let new_room = Room::start(game_port).await?;
    let port = new_room.port;
    *current = Some(new_room);
    Ok(port)
}

#[tauri::command]
pub async fn stop_ipv6_room() {
    let mut current = room().lock().await;
    if let Some(old) = current.take() {
        old.stop().await;
    }
}

#[tauri::command]
pub async fn test_ipv6_connection(address: String) -> Result<(), String> {
    lan_core::probe(lan_core::parse_target(&address)?).await
}
