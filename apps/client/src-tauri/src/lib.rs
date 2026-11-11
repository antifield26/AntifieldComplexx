//! Tauri 命令。页面只能拿到公钥、签名头和是否已有会话。

mod sign;
mod store;

use sign::{PreparedDevice, SignedRequest};

#[tauri::command]
fn prepare_device() -> Result<PreparedDevice, String> {
    sign::prepare(store::global()).map_err(|error| error.public_message())
}

#[tauri::command]
fn store_session(session_token: String, device_id: String) -> Result<(), String> {
    sign::store_session(store::global(), &session_token, &device_id).map_err(|error| error.public_message())
}

#[tauri::command]
fn clear_session() -> Result<(), String> {
    sign::clear_session(store::global()).map_err(|error| error.public_message())
}

#[tauri::command]
fn clear_device() -> Result<(), String> {
    sign::clear_device(store::global()).map_err(|error| error.public_message())
}

#[tauri::command]
fn sign_request(method: String, path: String, body: String) -> Result<Option<SignedRequest>, String> {
    sign::sign_request(store::global(), &method, &path, &body).map_err(|error| error.public_message())
}

#[tauri::command]
fn has_session() -> Result<bool, String> {
    sign::has_session(store::global()).map_err(|error| error.public_message())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            prepare_device,
            store_session,
            clear_session,
            clear_device,
            sign_request,
            has_session
        ])
        .run(tauri::generate_context!())
        .expect("启动客户端失败");
}
