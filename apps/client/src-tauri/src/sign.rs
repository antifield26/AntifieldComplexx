//! 设备密钥与请求签名。私钥不以任何形式返回给页面。

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::store::{SecretStore, StoreError, ACCOUNT_DEVICE, ACCOUNT_KEY, ACCOUNT_SESSION};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDevice {
    pub public_key: String,
    pub platform: String,
    pub suggested_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedRequest {
    pub authorization: String,
    pub device_id: String,
    pub timestamp: String,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug)]
pub(crate) enum SignError {
    Unavailable,
    Corrupt,
    BadInput,
    BadPath,
    Unsupported,
    Clock,
}

impl From<StoreError> for SignError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Unavailable => Self::Unavailable,
        }
    }
}

impl SignError {
    pub fn public_message(&self) -> String {
        match self {
            Self::Unavailable => "密钥库不可用".to_owned(),
            Self::Corrupt => "设备密钥不可用".to_owned(),
            Self::BadInput => "会话参数不合法".to_owned(),
            Self::BadPath => "接口路径不合法".to_owned(),
            Self::Unsupported => "当前系统不能登记设备".to_owned(),
            Self::Clock => "无法读取本机时间".to_owned(),
        }
    }
}

pub(crate) fn canonical_message(
    device_id: &str,
    timestamp: &str,
    nonce: &str,
    method: &str,
    path: &str,
    body: &[u8],
) -> String {
    let digest = Sha256::digest(body);
    format!(
        "v1\n{device_id}\n{timestamp}\n{nonce}\n{}\n{path}\n{}",
        method.to_ascii_uppercase(),
        hex_encode(&digest)
    )
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn has_control(value: &str) -> bool {
    value.chars().any(|ch| {
        let code = ch as u32;
        code <= 0x1f || code == 0x7f
    })
}

fn current_platform() -> Result<&'static str, SignError> {
    if cfg!(windows) {
        Ok("windows")
    } else if cfg!(target_os = "android") {
        Ok("android")
    } else {
        Err(SignError::Unsupported)
    }
}

fn suggested_name(platform: &str) -> &'static str {
    if platform == "android" {
        "这台 Android"
    } else {
        "这台 Windows"
    }
}

fn load_key(store: &dyn SecretStore) -> Result<Option<SigningKey>, SignError> {
    let Some(text) = store.get(ACCOUNT_KEY)? else {
        return Ok(None);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(text.trim())
        .map_err(|_| SignError::Corrupt)?;
    if bytes.len() != 32 {
        return Err(SignError::Corrupt);
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes);
    Ok(Some(SigningKey::from_bytes(&seed)))
}

fn save_key(store: &dyn SecretStore, key: &SigningKey) -> Result<(), SignError> {
    store.put(ACCOUNT_KEY, &URL_SAFE_NO_PAD.encode(key.to_bytes()))?;
    Ok(())
}

pub(crate) fn prepare(store: &dyn SecretStore) -> Result<PreparedDevice, SignError> {
    let platform = current_platform()?;
    let key = match load_key(store)? {
        Some(existing) => existing,
        None => {
            let created = SigningKey::generate(&mut OsRng);
            save_key(store, &created)?;
            created
        }
    };
    Ok(PreparedDevice {
        public_key: URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes()),
        platform: platform.to_owned(),
        suggested_name: suggested_name(platform).to_owned(),
    })
}

pub(crate) fn store_session(store: &dyn SecretStore, session_token: &str, device_id: &str) -> Result<(), SignError> {
    if session_token.is_empty()
        || session_token.len() > 200
        || session_token.trim() != session_token
        || has_control(session_token)
        || device_id.is_empty()
        || device_id.len() > 64
        || device_id.trim() != device_id
        || has_control(device_id)
    {
        return Err(SignError::BadInput);
    }
    store.put(ACCOUNT_SESSION, session_token)?;
    store.put(ACCOUNT_DEVICE, device_id)?;
    Ok(())
}

pub(crate) fn clear_session(store: &dyn SecretStore) -> Result<(), SignError> {
    store.remove(ACCOUNT_SESSION)?;
    Ok(())
}

pub(crate) fn clear_device(store: &dyn SecretStore) -> Result<(), SignError> {
    store.remove(ACCOUNT_KEY)?;
    store.remove(ACCOUNT_SESSION)?;
    store.remove(ACCOUNT_DEVICE)?;
    Ok(())
}

pub(crate) fn has_session(store: &dyn SecretStore) -> Result<bool, SignError> {
    Ok(store.get(ACCOUNT_SESSION)?.is_some_and(|value| !value.is_empty()))
}

fn valid_path(path: &str) -> bool {
    path.starts_with('/') && !path.contains("://") && !path.contains('\n') && !path.contains('\r')
}

pub(crate) fn sign_request(
    store: &dyn SecretStore,
    method: &str,
    path: &str,
    body: &str,
) -> Result<Option<SignedRequest>, SignError> {
    let Some(session) = store.get(ACCOUNT_SESSION)? else {
        return Ok(None);
    };
    if session.is_empty() {
        return Ok(None);
    }
    if !valid_path(path) {
        return Err(SignError::BadPath);
    }
    let Some(device_id) = store.get(ACCOUNT_DEVICE)? else {
        return Err(SignError::Corrupt);
    };
    let Some(key) = load_key(store)? else {
        return Err(SignError::Corrupt);
    };
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| SignError::Clock)?
        .as_secs()
        .to_string();
    let mut nonce_raw = [0u8; 18];
    OsRng.fill_bytes(&mut nonce_raw);
    let nonce = URL_SAFE_NO_PAD.encode(nonce_raw);
    let message = canonical_message(&device_id, &timestamp, &nonce, method, path, body.as_bytes());
    let signature = key.sign(message.as_bytes());
    Ok(Some(SignedRequest {
        authorization: session,
        device_id,
        timestamp,
        nonce,
        signature: URL_SAFE_NO_PAD.encode(signature.to_bytes()),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MemoryStore;
    use ed25519_dalek::Verifier;

    #[test]
    fn canonical_matches_empty_body_hash() {
        let text = canonical_message(
            "11111111-1111-1111-1111-111111111111",
            "1700000000",
            "abcdefghij123456",
            "get",
            "/api/auth/me",
            b"",
        );
        assert_eq!(
            text,
            "v1\n11111111-1111-1111-1111-111111111111\n1700000000\nabcdefghij123456\nGET\n/api/auth/me\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn signature_round_trip_uses_canonical_bytes() {
        let key = SigningKey::generate(&mut OsRng);
        let message = canonical_message("device", "1700000000", "nonce-value-0123456789", "post", "/api/devices/heartbeat", b"{}");
        let signature = key.sign(message.as_bytes());
        key.verifying_key().verify(message.as_bytes(), &signature).unwrap();
        assert_eq!(URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes()).len(), 43);
        assert_eq!(URL_SAFE_NO_PAD.encode(signature.to_bytes()).len(), 86);
    }

    #[test]
    fn prepare_reuses_key_and_logout_keeps_it() {
        let store = MemoryStore::default();
        let first = prepare(&store).unwrap();
        let second = prepare(&store).unwrap();
        assert_eq!(first.public_key, second.public_key);
        assert_eq!(first.platform, "windows");
        assert_eq!(first.suggested_name, "这台 Windows");
        store_session(&store, "session-1", "device-1").unwrap();
        assert!(has_session(&store).unwrap());
        clear_session(&store).unwrap();
        assert!(!has_session(&store).unwrap());
        let third = prepare(&store).unwrap();
        assert_eq!(third.public_key, first.public_key);
    }

    #[test]
    fn sign_requires_session_and_rejects_origin_in_path() {
        let store = MemoryStore::default();
        assert!(sign_request(&store, "GET", "/api/auth/me", "").unwrap().is_none());
        let prepared = prepare(&store).unwrap();
        store_session(&store, "session-1", "device-1").unwrap();
        let signed = sign_request(&store, "POST", "/api/devices/heartbeat", "{}")
            .unwrap()
            .unwrap();
        assert_eq!(signed.authorization, "session-1");
        assert_eq!(signed.device_id, "device-1");
        assert_eq!(signed.nonce.len(), 24);
        assert!(sign_request(&store, "GET", "https://app.example.com/api/auth/me", "").is_err());
        assert!(store_session(&store, " bad", "device-1").is_err());
        clear_device(&store).unwrap();
        assert_ne!(prepare(&store).unwrap().public_key, prepared.public_key);
    }
}
