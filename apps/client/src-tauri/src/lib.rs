//! Tauri 命令。页面只能拿到公钥、签名头和是否已有会话。

mod ai;
mod policy;
mod sign;
mod store;
mod transfer;

use sign::{PreparedDevice, SignedRequest};
use tauri::Manager;

fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "主窗口不可用".to_owned())?;
    if !trusted_main_url(window.label(), &url) {
        return Err("当前页面没有客户端权限".to_owned());
    }
    Ok(())
}

fn trusted_main_url(label: &str, url: &tauri::Url) -> bool {
    let local =
        (url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none())
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none())
            || (cfg!(debug_assertions)
                && url.scheme() == "http"
                && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
                && url.port() == Some(5173));
    label == "main" && local && url.username().is_empty() && url.password().is_none()
}

fn locked() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    store::operation_lock()
        .lock()
        .map_err(|_| "密钥库不可用".to_owned())
}

fn require_active_session(store: &dyn store::SecretStore) -> Result<(), String> {
    if !sign::has_session(store).map_err(|error| error.public_message())? {
        return Err("请先登录客户端".to_owned());
    }
    Ok(())
}

#[tauri::command]
fn prepare_device(window: tauri::WebviewWindow) -> Result<PreparedDevice, String> {
    require_main(&window)?;
    let _guard = locked()?;
    sign::prepare(store::global()).map_err(|error| error.public_message())
}

#[tauri::command]
fn store_session(
    window: tauri::WebviewWindow,
    session_token: String,
    device_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    let _guard = locked()?;
    sign::store_session(store::global(), &session_token, &device_id)
        .map_err(|error| error.public_message())
}

#[tauri::command]
async fn clear_session(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    let _guard = locked()?;
    transfer::revoke_all();
    let session = sign::clear_session(store::global()).map_err(|error| error.public_message());
    let ai = ai::close_ai_workspace(&app).map_err(str::to_owned);
    session.and(ai)
}

#[tauri::command]
async fn clear_device(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    let _guard = locked()?;
    transfer::revoke_all();
    let device = sign::clear_device(store::global()).map_err(|error| error.public_message());
    let ai = ai::close_ai_workspace(&app).map_err(str::to_owned);
    device.and(ai)
}

#[tauri::command]
fn sign_request(
    window: tauri::WebviewWindow,
    method: String,
    path: String,
    body: String,
    body_sha256: Option<String>,
) -> Result<Option<SignedRequest>, String> {
    require_main(&window)?;
    let _guard = locked()?;
    sign::sign_request(
        store::global(),
        &method,
        &path,
        &body,
        body_sha256.as_deref(),
    )
    .map_err(|error| error.public_message())
}

#[tauri::command]
async fn open_ai_workspace(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: String,
    user_agent: String,
) -> Result<(), String> {
    require_main(&window)?;
    {
        let _guard = locked()?;
        require_active_session(store::global())?;
    }
    ai::open_ai_workspace(&app, &url, &user_agent).map_err(str::to_owned)
}

#[tauri::command]
fn has_session(window: tauri::WebviewWindow) -> Result<bool, String> {
    require_main(&window)?;
    let _guard = locked()?;
    sign::has_session(store::global()).map_err(|error| error.public_message())
}

#[tauri::command]
async fn download_file(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    path: String,
    suggested_name: String,
    transfer_id: String,
) -> Result<transfer::DownloadResult, String> {
    require_main(&window)?;
    transfer::download_file(app, path, suggested_name, transfer_id)
        .await
        .map_err(str::to_owned)
}

#[tauri::command]
fn cancel_transfer(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    require_main(&window)?;
    transfer::cancel_transfer(&id).map_err(str::to_owned)
}

#[tauri::command]
async fn create_preview(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<transfer::PreviewResult, String> {
    require_main(&window)?;
    transfer::create_preview(path).await.map_err(str::to_owned)
}

#[tauri::command]
fn release_preview(window: tauri::WebviewWindow, id: String) -> Result<(), String> {
    require_main(&window)?;
    transfer::release_preview(&id).map_err(str::to_owned)
}

#[tauri::command]
async fn background_app(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    require_main(&window)?;
    #[cfg(target_os = "android")]
    app.state::<tauri_plugin_client_runtime::ClientRuntime>()
        .background()
        .map_err(|_| "无法返回后台".to_owned())?;
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_client_runtime::init())
        .on_page_load(|webview, payload| {
            // 固定本地主窗口即使被旧离线页接管，也能移除静态缓存；远端 AI 页面不执行迁移。
            if payload.event() == tauri::webview::PageLoadEvent::Finished
                && trusted_main_url(webview.label(), payload.url())
            {
                if webview.eval(include_str!("native-bootstrap.js")).is_err() {
                    eprintln!("客户端静态缓存迁移脚本不可用");
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                transfer::revoke_all();
                let _ = ai::close_ai_workspace(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            prepare_device,
            store_session,
            clear_session,
            clear_device,
            sign_request,
            has_session,
            open_ai_workspace,
            download_file,
            cancel_transfer,
            create_preview,
            release_preview,
            background_app
        ])
        .run(tauri::generate_context!())
        .expect("启动客户端失败");
}

#[cfg(test)]
mod tests {
    use super::{require_active_session, sign, store::MemoryStore, trusted_main_url};
    use tauri::Url;

    #[test]
    fn device_commands_reject_remote_origins_other_windows_and_localhost_ports() {
        let local = Url::parse("http://tauri.localhost/files").unwrap();
        assert!(trusted_main_url("main", &local));
        assert!(!trusted_main_url("ai", &local));
        for raw in [
            "https://ai.example.com/",
            "http://tauri.localhost:3000/",
            "https://user@tauri.localhost/",
            "http://localhost:3000/",
            "file:///tmp/main.html",
        ] {
            assert!(
                !trusted_main_url("main", &Url::parse(raw).unwrap()),
                "{raw}"
            );
        }
    }

    #[test]
    fn ai_open_requires_a_current_session_and_rejects_late_open_after_logout() {
        let store = MemoryStore::default();
        assert!(require_active_session(&store).is_err());
        sign::prepare(&store).unwrap();
        sign::store_session(&store, "fixture-session", "fixture-device").unwrap();
        assert!(require_active_session(&store).is_ok());
        sign::clear_session(&store).unwrap();
        assert!(require_active_session(&store).is_err());
    }
}
