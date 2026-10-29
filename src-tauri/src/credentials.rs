//! Refresh tokens are stored only in the operating system's credential store.
use crate::ResultT;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.ccl.launcher";
const INDEX: &str = "microsoft-index";
// Windows Credential Manager limits an individual secret to 2560 bytes.
const CHUNK_SIZE: usize = 1800;
const MAX_CHUNKS: usize = 16;

#[derive(Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub client_id: String,
    pub refresh_token: String,
    pub name: String,
    pub uuid: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
struct Vault {
    version: u8,
    selected: String,
    accounts: Vec<StoredAccount>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    name: String,
    uuid: String,
    selected: bool,
}
#[derive(Serialize, Deserialize)]
struct Index {
    version: u8,
    slot: u8,
    chunks: usize,
}
trait Store {
    fn get(&self, key: &str) -> ResultT<Option<Vec<u8>>>;
    fn set(&self, key: &str, value: &[u8]) -> ResultT<()>;
    fn delete(&self, key: &str) -> ResultT<()>;
}
struct SystemStore;
impl Store for SystemStore {
    fn get(&self, key: &str) -> ResultT<Option<Vec<u8>>> {
        let entry = keyring::Entry::new(SERVICE, key).map_err(|_| "无法访问系统凭据库")?;
        match entry.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统凭据库，请确认它已解锁".into()),
        }
    }
    fn set(&self, key: &str, value: &[u8]) -> ResultT<()> {
        keyring::Entry::new(SERVICE, key)
            .map_err(|_| "无法访问系统凭据库")?
            .set_secret(value)
            .map_err(|_| "无法写入系统凭据库，请确认它已解锁".into())
    }
    fn delete(&self, key: &str) -> ResultT<()> {
        let entry = keyring::Entry::new(SERVICE, key).map_err(|_| "无法访问系统凭据库")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("无法删除系统凭据库中的账户，请确认它已解锁".into()),
        }
    }
}
fn chunk_key(slot: u8, index: usize) -> String {
    format!("microsoft-{slot}-{index}")
}
fn read_index(store: &impl Store) -> ResultT<Option<Index>> {
    let Some(bytes) = store.get(INDEX)? else {
        return Ok(None);
    };
    let index: Index =
        serde_json::from_slice(&bytes).map_err(|_| "保存的账户数据损坏，请重新登录")?;
    if index.version != 1 || index.slot > 1 || index.chunks == 0 || index.chunks > MAX_CHUNKS {
        return Err("保存的账户数据无效，请重新登录".into());
    }
    Ok(Some(index))
}
fn load_vault(store: &impl Store) -> ResultT<Vault> {
    let Some(index) = read_index(store)? else {
        return Ok(Vault {
            version: 1,
            ..Default::default()
        });
    };
    let mut bytes = Vec::new();
    for number in 0..index.chunks {
        let chunk = store
            .get(&chunk_key(index.slot, number))?
            .ok_or("保存的账户数据不完整，请重新登录")?;
        if chunk.len() > CHUNK_SIZE {
            return Err("保存的账户数据无效，请重新登录".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let vault = match serde_json::from_slice::<Vault>(&bytes) {
        Ok(vault) => vault,
        Err(_) => {
            let account: StoredAccount =
                serde_json::from_slice(&bytes).map_err(|_| "保存的账户数据损坏，请重新登录")?;
            Vault {
                version: 1,
                selected: account.uuid.clone(),
                accounts: vec![account],
            }
        }
    };
    if vault.version != 1
        || vault.accounts.len() > 16
        || vault.accounts.iter().any(|account| {
            account.refresh_token.is_empty()
                || account.client_id.is_empty()
                || account.name.is_empty()
                || account.uuid.is_empty()
        })
        || (!vault.accounts.is_empty() && !vault.accounts.iter().any(|a| a.uuid == vault.selected))
    {
        return Err("保存的账户数据无效，请重新登录".into());
    }
    Ok(vault)
}
fn load_from(store: &impl Store) -> ResultT<Option<StoredAccount>> {
    let vault = load_vault(store)?;
    Ok(vault
        .accounts
        .into_iter()
        .find(|a| a.uuid == vault.selected))
}
fn clear_slot(store: &impl Store, slot: u8, count: usize) -> ResultT<()> {
    let mut failed = false;
    for number in 0..count {
        if store.delete(&chunk_key(slot, number)).is_err() {
            failed = true;
        }
    }
    if failed {
        Err("无法删除系统凭据库中的账户，请确认它已解锁".into())
    } else {
        Ok(())
    }
}
fn save_vault(store: &impl Store, vault: &Vault) -> ResultT<()> {
    let bytes = serde_json::to_vec(vault).map_err(|_| "无法保存账户数据")?;
    let chunks = bytes.len().div_ceil(CHUNK_SIZE);
    if chunks == 0 || chunks > MAX_CHUNKS {
        return Err("账户数据过大，无法保存到系统凭据库".into());
    }
    let previous = read_index(store)?;
    let slot = previous.as_ref().map_or(0, |index| 1 - index.slot);
    // A separate slot keeps the previous credential usable if an update is interrupted.
    clear_slot(store, slot, MAX_CHUNKS)?;
    for (number, chunk) in bytes.chunks(CHUNK_SIZE).enumerate() {
        if let Err(error) = store.set(&chunk_key(slot, number), chunk) {
            let _ = clear_slot(store, slot, MAX_CHUNKS);
            return Err(error);
        }
    }
    let index = serde_json::to_vec(&Index {
        version: 1,
        slot,
        chunks,
    })
    .map_err(|_| "无法保存账户数据")?;
    if let Err(error) = store.set(INDEX, &index) {
        let _ = clear_slot(store, slot, MAX_CHUNKS);
        return Err(error);
    }
    if let Some(old) = previous {
        let _ = clear_slot(store, old.slot, old.chunks);
    }
    Ok(())
}
fn save_to(store: &impl Store, account: &StoredAccount) -> ResultT<()> {
    let mut vault = load_vault(store)?;
    if let Some(existing) = vault.accounts.iter_mut().find(|a| a.uuid == account.uuid) {
        *existing = account.clone();
    } else {
        if vault.accounts.len() >= 16 {
            return Err("最多保存 16 个正版账户".into());
        }
        vault.accounts.push(account.clone());
    }
    vault.selected = account.uuid.clone();
    save_vault(store, &vault)
}
fn select_from(store: &impl Store, uuid: &str) -> ResultT<()> {
    let mut vault = load_vault(store)?;
    if !vault.accounts.iter().any(|a| a.uuid == uuid) {
        return Err("未找到保存的账户".into());
    }
    vault.selected = uuid.to_string();
    save_vault(store, &vault)
}
fn summaries_from(store: &impl Store) -> ResultT<Vec<AccountSummary>> {
    let vault = load_vault(store)?;
    Ok(vault
        .accounts
        .into_iter()
        .map(|a| AccountSummary {
            selected: a.uuid == vault.selected,
            name: a.name,
            uuid: a.uuid,
        })
        .collect())
}
fn clear_selected_from(store: &impl Store) -> ResultT<()> {
    let mut vault = load_vault(store)?;
    vault.accounts.retain(|a| a.uuid != vault.selected);
    if vault.accounts.is_empty() {
        return clear_from(store);
    }
    vault.selected = vault.accounts[0].uuid.clone();
    save_vault(store, &vault)
}
fn clear_from(store: &impl Store) -> ResultT<()> {
    // Fail promptly if the credential service cannot be reached.
    let _ = store.get(INDEX)?;
    // Remove both slots, including chunks left by an interrupted save.
    let a = clear_slot(store, 0, MAX_CHUNKS);
    let b = clear_slot(store, 1, MAX_CHUNKS);
    if a.is_err() || b.is_err() {
        return Err("无法删除系统凭据库中的账户，请确认它已解锁".into());
    }
    store.delete(INDEX)
}
pub async fn load() -> ResultT<Option<StoredAccount>> {
    tokio::task::spawn_blocking(|| load_from(&SystemStore))
        .await
        .map_err(|_| "无法读取系统凭据库")?
}
pub async fn save(account: StoredAccount) -> ResultT<()> {
    tokio::task::spawn_blocking(move || save_to(&SystemStore, &account))
        .await
        .map_err(|_| "无法写入系统凭据库")?
}
pub async fn clear() -> ResultT<()> {
    tokio::task::spawn_blocking(|| clear_selected_from(&SystemStore))
        .await
        .map_err(|_| "无法删除系统凭据库中的账户")?
}

pub async fn list() -> ResultT<Vec<AccountSummary>> {
    tokio::task::spawn_blocking(|| summaries_from(&SystemStore))
        .await
        .map_err(|_| "无法读取系统凭据库")?
}
pub async fn select(uuid: String) -> ResultT<()> {
    tokio::task::spawn_blocking(move || select_from(&SystemStore, &uuid))
        .await
        .map_err(|_| "无法切换保存的账户")?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    struct MemoryStore {
        values: Mutex<HashMap<String, Vec<u8>>>,
        fail: Mutex<Option<String>>,
    }
    impl Store for MemoryStore {
        fn get(&self, key: &str) -> ResultT<Option<Vec<u8>>> {
            Ok(self.values.lock().unwrap().get(key).cloned())
        }
        fn set(&self, key: &str, data: &[u8]) -> ResultT<()> {
            if self.fail.lock().unwrap().as_deref() == Some(key) {
                return Err("write failed".into());
            }
            self.values
                .lock()
                .unwrap()
                .insert(key.into(), data.to_vec());
            Ok(())
        }
        fn delete(&self, key: &str) -> ResultT<()> {
            self.values.lock().unwrap().remove(key);
            Ok(())
        }
    }
    fn account(token: &str) -> StoredAccount {
        StoredAccount {
            client_id: "client".into(),
            refresh_token: token.into(),
            name: "Player".into(),
            uuid: "uuid".into(),
        }
    }
    #[test]
    fn stores_large_tokens_rotates_and_deletes_both_slots() {
        let store = MemoryStore::default();
        let first = "a".repeat(4000);
        save_to(&store, &account(&first)).unwrap();
        assert_eq!(load_from(&store).unwrap().unwrap().refresh_token, first);
        save_to(&store, &account("rotated")).unwrap();
        assert_eq!(load_from(&store).unwrap().unwrap().refresh_token, "rotated");
        clear_from(&store).unwrap();
        assert!(load_from(&store).unwrap().is_none());
        assert!(store.values.lock().unwrap().is_empty());
    }
    #[test]
    fn supports_multiple_accounts_and_keeps_credentials_out_of_summaries() {
        let store = MemoryStore::default();
        let one = account("secret-one");
        let mut two = account("secret-two");
        two.uuid = "uuid-two".into();
        two.name = "Second".into();
        save_to(&store, &one).unwrap();
        save_to(&store, &two).unwrap();
        assert_eq!(load_from(&store).unwrap().unwrap().uuid, "uuid-two");
        let summaries = summaries_from(&store).unwrap();
        assert_eq!(summaries.len(), 2);
        assert!(!serde_json::to_string(&summaries)
            .unwrap()
            .contains("secret"));
        select_from(&store, "uuid").unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "secret-one"
        );
        assert!(select_from(&store, "unknown").is_err());
    }
    #[test]
    fn migrates_legacy_account_and_only_removes_selected_account() {
        let store = MemoryStore::default();
        let old = account("old-token");
        let bytes = serde_json::to_vec(&old).unwrap();
        store.set(&chunk_key(0, 0), &bytes).unwrap();
        store
            .set(
                INDEX,
                &serde_json::to_vec(&Index {
                    version: 1,
                    slot: 0,
                    chunks: 1,
                })
                .unwrap(),
            )
            .unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "old-token"
        );
        let mut second = account("second-token");
        second.uuid = "second".into();
        save_to(&store, &second).unwrap();
        clear_selected_from(&store).unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "old-token"
        );
        clear_selected_from(&store).unwrap();
        assert!(load_from(&store).unwrap().is_none());
    }
    #[test]
    fn failed_rotation_keeps_previous_token() {
        let store = MemoryStore::default();
        save_to(&store, &account("original")).unwrap();
        *store.fail.lock().unwrap() = Some(INDEX.into());
        assert!(save_to(&store, &account("new")).is_err());
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "original"
        );
    }
}
