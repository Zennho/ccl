//! Refresh tokens use the system credential store, or a private local file on macOS.
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
struct SystemStore<'a> {
    service: &'a str,
}

// macOS users can encounter repeated Keychain prompts with ad-hoc signed builds.
// Store the existing transactional vault locally without consulting Keychain.
#[cfg(any(target_os = "macos", all(test, unix)))]
struct LocalStore {
    dir: std::path::PathBuf,
}

#[cfg(any(target_os = "macos", all(test, unix)))]
impl LocalStore {
    #[cfg(target_os = "macos")]
    fn new() -> ResultT<Self> {
        Ok(Self {
            dir: dirs::data_dir()
                .ok_or("无法确定应用数据目录")?
                .join("ccl")
                .join("account-credentials"),
        })
    }

    fn path(&self, key: &str) -> ResultT<std::path::PathBuf> {
        if key != INDEX && !(0..=1).any(|slot| (0..MAX_CHUNKS).any(|i| key == chunk_key(slot, i))) {
            return Err("无效的账户数据文件名".into());
        }
        Ok(self.dir.join(key))
    }

    fn prepare(&self) -> ResultT<()> {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.dir)
            .map_err(|_| "无法创建本地账户数据目录")?;
        std::fs::set_permissions(&self.dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护本地账户数据目录")?;
        Ok(())
    }
}

#[cfg(any(target_os = "macos", all(test, unix)))]
impl Store for LocalStore {
    fn get(&self, key: &str) -> ResultT<Option<Vec<u8>>> {
        let path = self.path(key)?;
        match std::fs::read(path) {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("无法读取本地账户数据".into()),
        }
    }

    fn set(&self, key: &str, value: &[u8]) -> ResultT<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        self.prepare()?;
        let path = self.path(key)?;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| "无法创建本地账户数据")?;
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let temp = self.dir.join(format!(".account-{suffix}.tmp"));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp)
                .map_err(|_| "无法创建本地账户数据")?;
            file.write_all(value)
                .and_then(|_| file.sync_all())
                .map_err(|_| "无法写入本地账户数据")?;
            std::fs::rename(&temp, &path).map_err(|_| "无法保存本地账户数据")?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }

    fn delete(&self, key: &str) -> ResultT<()> {
        match std::fs::remove_file(self.path(key)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("无法删除本地账户数据".into()),
        }
    }
}
impl Default for SystemStore<'static> {
    fn default() -> Self {
        Self { service: SERVICE }
    }
}
fn keyring_error(operation: &str, error: keyring::Error) -> String {
    #[cfg(target_os = "macos")]
    if let keyring::Error::PlatformFailure(ref source)
    | keyring::Error::NoStorageAccess(ref source) = error
    {
        if let Some(error) = source.downcast_ref::<security_framework::base::Error>() {
            let code = error.code();
            let hint = match code {
                -25308 => "钥匙串无法显示授权窗口；请解锁登录钥匙串并在桌面会话中重试",
                -25293 => "钥匙串认证失败，请解锁登录钥匙串后重试",
                -128 => "钥匙串授权已取消，请重新授权后重试",
                -34018 => "应用缺少访问钥匙串所需的签名权限",
                -25291 | -25294 | -25295 => "登录钥匙串不可用，请检查钥匙串状态",
                _ => "请检查登录钥匙串是否解锁以及是否允许 CCL 访问",
            };
            return format!("{operation}系统钥匙串失败（macOS 错误 {code}）：{hint}");
        }
    }
    let hint = match error {
        keyring::Error::NoStorageAccess(_) => "系统凭据库不可用或已锁定",
        keyring::Error::PlatformFailure(_) => "系统凭据服务拒绝操作或发生错误",
        keyring::Error::TooLong(_, _) => "系统凭据库不接受该大小的数据",
        keyring::Error::Ambiguous(_) => "系统凭据库中存在重复条目",
        keyring::Error::Invalid(_, _) => "系统凭据条目的参数无效",
        _ => "系统凭据库操作失败",
    };
    format!("{operation}系统凭据库失败：{hint}")
}
impl Store for SystemStore<'_> {
    fn get(&self, key: &str) -> ResultT<Option<Vec<u8>>> {
        let entry = keyring::Entry::new(self.service, key).map_err(|e| keyring_error("访问", e))?;
        match entry.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring_error("读取", e)),
        }
    }
    fn set(&self, key: &str, value: &[u8]) -> ResultT<()> {
        keyring::Entry::new(self.service, key)
            .map_err(|e| keyring_error("访问", e))?
            .set_secret(value)
            .map_err(|e| keyring_error("写入", e))
    }
    fn delete(&self, key: &str) -> ResultT<()> {
        let entry = keyring::Entry::new(self.service, key).map_err(|e| keyring_error("访问", e))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error("删除", e)),
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
    // Writing each chunk replaces that item. Do not require deletion of unrelated
    // abandoned chunks before the new slot can be saved (notably on macOS, where
    // a stale item may require separate Keychain authorisation). The active slot
    // stays untouched until the index is committed.
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
    for number in chunks..MAX_CHUNKS {
        let _ = store.delete(&chunk_key(slot, number));
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
fn clear_account_from(store: &impl Store, uuid: Option<&str>) -> ResultT<()> {
    let mut vault = load_vault(store)?;
    let target = uuid.unwrap_or(&vault.selected).to_string();
    if !vault.accounts.iter().any(|a| a.uuid == target) {
        return Ok(());
    }
    vault.accounts.retain(|a| a.uuid != target);
    if vault.accounts.is_empty() {
        return clear_from(store);
    }
    if vault.selected == target {
        vault.selected = vault.accounts[0].uuid.clone();
    }
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
#[cfg(target_os = "macos")]
type ActiveStore = LocalStore;
#[cfg(not(target_os = "macos"))]
type ActiveStore = SystemStore<'static>;

fn with_store<T>(f: impl FnOnce(&ActiveStore) -> ResultT<T>) -> ResultT<T> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|_| "无法访问账户数据")?;
    #[cfg(target_os = "macos")]
    let store = LocalStore::new()?;
    #[cfg(not(target_os = "macos"))]
    let store = SystemStore::default();
    f(&store)
}

pub async fn load() -> ResultT<Option<StoredAccount>> {
    tokio::task::spawn_blocking(|| with_store(load_from))
        .await
        .map_err(|_| "无法读取系统凭据库")?
}
pub async fn save(account: StoredAccount) -> ResultT<()> {
    tokio::task::spawn_blocking(move || with_store(|store| save_to(store, &account)))
        .await
        .map_err(|_| "无法写入系统凭据库")?
}
pub async fn clear(uuid: Option<String>) -> ResultT<()> {
    tokio::task::spawn_blocking(move || {
        with_store(|store| clear_account_from(store, uuid.as_deref()))
    })
    .await
    .map_err(|_| "无法删除系统凭据库中的账户")?
}

pub async fn list() -> ResultT<Vec<AccountSummary>> {
    tokio::task::spawn_blocking(|| with_store(summaries_from))
        .await
        .map_err(|_| "无法读取系统凭据库")?
}
pub async fn select(uuid: String) -> ResultT<()> {
    tokio::task::spawn_blocking(move || with_store(|store| select_from(store, &uuid)))
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
        fail_delete: Mutex<Option<String>>,
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
            if self.fail_delete.lock().unwrap().as_deref() == Some(key) {
                return Err("delete failed".into());
            }
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
        clear_account_from(&store, None).unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "old-token"
        );
        clear_account_from(&store, None).unwrap();
        assert!(load_from(&store).unwrap().is_none());
    }
    #[test]
    fn abandoned_unrelated_credential_does_not_prevent_saving() {
        let store = MemoryStore::default();
        store.set(&chunk_key(0, 15), b"abandoned").unwrap();
        *store.fail_delete.lock().unwrap() = Some(chunk_key(0, 15));
        save_to(&store, &account("new-token")).unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "new-token"
        );
    }
    #[test]
    fn logout_does_not_remove_a_different_saved_account() {
        let store = MemoryStore::default();
        save_to(&store, &account("original")).unwrap();
        clear_account_from(&store, Some("other-account")).unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "original"
        );
    }
    #[test]
    fn storage_errors_never_expose_platform_error_details() {
        let error =
            keyring::Error::PlatformFailure(Box::new(std::io::Error::other("secret-token-value")));
        let message = keyring_error("写入", error);
        assert!(!message.contains("secret-token-value"));
        assert!(message.contains("凭据"));
    }
    #[cfg(unix)]
    #[test]
    fn local_credentials_are_private_and_support_account_management() {
        use std::os::unix::fs::PermissionsExt;
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).unwrap();
        let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let store = LocalStore {
            dir: std::env::temp_dir().join(format!("ccl-local-vault-{suffix}")),
        };
        let mut second = account("another-token");
        second.uuid = "another".into();
        save_to(&store, &account(&"x".repeat(4000))).unwrap();
        save_to(&store, &second).unwrap();
        assert_eq!(summaries_from(&store).unwrap().len(), 2);
        select_from(&store, "uuid").unwrap();
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "x".repeat(4000)
        );
        assert_eq!(
            std::fs::metadata(&store.dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        for entry in std::fs::read_dir(&store.dir).unwrap() {
            assert_eq!(
                entry.unwrap().metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        clear_account_from(&store, Some("uuid")).unwrap();
        assert_eq!(load_from(&store).unwrap().unwrap().uuid, "another");
        clear_account_from(&store, Some("another")).unwrap();
        assert!(load_from(&store).unwrap().is_none());
        assert_eq!(std::fs::read_dir(&store.dir).unwrap().count(), 0);
        std::fs::remove_dir(&store.dir).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "runs an independent child process"]
    fn macos_local_credentials_survive_process_restart() {
        let dir = std::env::var_os("CCL_TEST_LOCAL_VAULT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!("ccl-local-test-{}", std::process::id()))
            });
        let store = LocalStore { dir: dir.clone() };
        if std::env::var_os("CCL_TEST_LOCAL_CHILD").is_some() {
            assert_eq!(
                load_from(&store).unwrap().unwrap().refresh_token,
                "fake-token-".repeat(250)
            );
            save_to(&store, &account("rotated-fake-token")).unwrap();
            return;
        }
        save_to(&store, &account(&"fake-token-".repeat(250))).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "credentials::tests::macos_local_credentials_survive_process_restart",
                "--ignored",
            ])
            .env("CCL_TEST_LOCAL_VAULT", &dir)
            .env("CCL_TEST_LOCAL_CHILD", "1")
            .status()
            .unwrap();
        assert!(
            status.success(),
            "child could not restore the test credential"
        );
        assert_eq!(
            load_from(&store).unwrap().unwrap().refresh_token,
            "rotated-fake-token"
        );
        clear_from(&store).unwrap();
        std::fs::remove_dir(dir).unwrap();
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
