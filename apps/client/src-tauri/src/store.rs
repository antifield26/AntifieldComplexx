//! 操作系统密钥库。缺失条目视为空，其它失败不带出系统路径。
//! Windows 使用系统凭据管理器。Android 在首次读写前接入系统密钥库，接入失败则拒绝访问。

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

pub const SERVICE: &str = "AntifieldComplexx";
pub const ACCOUNT_KEY: &str = "private-key";
pub const ACCOUNT_SESSION: &str = "session-token";
pub const ACCOUNT_DEVICE: &str = "device-id";

#[derive(Debug)]
pub enum StoreError {
    Unavailable,
}

pub trait SecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError>;
    fn put(&self, account: &str, value: &str) -> Result<(), StoreError>;
    fn remove(&self, account: &str) -> Result<(), StoreError>;
}

pub struct KeyringStore;

/// 登记、写会话、签名与清理串行，避免密钥和会话归属交错。
pub(crate) fn operation_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    &LOCK
}

/// Android 必须先注册系统密钥库。失败时不创建条目，避免落到内存模拟库。
#[cfg(target_os = "android")]
fn ensure_platform_store() -> Result<(), StoreError> {
    use std::sync::OnceLock;
    static READY: OnceLock<()> = OnceLock::new();
    if READY.get().is_some() {
        return Ok(());
    }
    match android_keyring::set_android_keyring_credential_builder() {
        Ok(()) => {
            let _ = READY.set(());
            Ok(())
        }
        Err(_) => Err(StoreError::Unavailable),
    }
}

#[cfg(not(target_os = "android"))]
fn ensure_platform_store() -> Result<(), StoreError> {
    Ok(())
}

fn missing(error: &keyring::Error) -> bool {
    matches!(error, keyring::Error::NoEntry)
}

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        ensure_platform_store()?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| StoreError::Unavailable)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(error) if missing(&error) => Ok(None),
            Err(_) => Err(StoreError::Unavailable),
        }
    }

    fn put(&self, account: &str, value: &str) -> Result<(), StoreError> {
        ensure_platform_store()?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| StoreError::Unavailable)?;
        entry
            .set_password(value)
            .map_err(|_| StoreError::Unavailable)
    }

    fn remove(&self, account: &str) -> Result<(), StoreError> {
        ensure_platform_store()?;
        let entry = keyring::Entry::new(SERVICE, account).map_err(|_| StoreError::Unavailable)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(error) if missing(&error) => Ok(()),
            Err(_) => Err(StoreError::Unavailable),
        }
    }
}

#[cfg(all(test, windows))]
#[test]
fn windows_uses_credential_manager() {
    // 当前 Windows 构建使用系统凭据管理器。
    let _builder = keyring::windows::default_credential_builder();
}

pub fn global() -> &'static KeyringStore {
    use std::sync::OnceLock;
    static STORE: OnceLock<KeyringStore> = OnceLock::new();
    STORE.get_or_init(|| KeyringStore)
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore {
    values: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, StoreError> {
        let values = self.values.lock().map_err(|_| StoreError::Unavailable)?;
        Ok(values.get(account).cloned())
    }

    fn put(&self, account: &str, value: &str) -> Result<(), StoreError> {
        let mut values = self.values.lock().map_err(|_| StoreError::Unavailable)?;
        values.insert(account.to_owned(), value.to_owned());
        Ok(())
    }

    fn remove(&self, account: &str) -> Result<(), StoreError> {
        let mut values = self.values.lock().map_err(|_| StoreError::Unavailable)?;
        values.remove(account);
        Ok(())
    }
}
