//! 原生容器与系统保存选择器只供 Rust 调用，不注册可被网页调用的命令。

use tauri::plugin::{Builder, TauriPlugin};
#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

#[cfg(target_os = "android")]
pub struct ClientRuntime(PluginHandle<tauri::Wry>);

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
pub struct SaveDestination {
    pub fd: i32,
    pub id: String,
}

#[cfg(target_os = "android")]
impl ClientRuntime {
    pub fn open_ai(
        &self,
        url: &str,
        origin: &str,
        access_origin: Option<&str>,
        user_agent: &str,
    ) -> Result<(), ()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>(
                "openAi",
                serde_json::json!({ "url": url, "origin": origin, "accessOrigin": access_origin.unwrap_or(""), "userAgent": user_agent }),
            )
            .map(|_| ())
            .map_err(|_| ())
    }
    pub fn close_ai(&self) -> Result<(), ()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("closeAi", serde_json::json!({}))
            .map(|_| ())
            .map_err(|_| ())
    }
    pub fn background(&self) -> Result<(), ()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("background", serde_json::json!({}))
            .map(|_| ())
            .map_err(|_| ())
    }
    pub async fn choose_save(&self, name: &str) -> Result<Option<SaveDestination>, ()> {
        self.0
            .run_mobile_plugin_async("chooseSave", serde_json::json!({ "name": name }))
            .await
            .map_err(|_| ())
    }
    pub fn discard_save(&self, id: &str) -> Result<(), ()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("discardSave", serde_json::json!({ "id": id }))
            .map(|_| ())
            .map_err(|_| ())
    }
    pub fn finish_save(&self, id: &str) -> Result<(), ()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("finishSave", serde_json::json!({ "id": id }))
            .map(|_| ())
            .map_err(|_| ())
    }
}

pub fn init() -> TauriPlugin<tauri::Wry> {
    Builder::new("client-runtime")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                // 客户端固定使用 Wry；Android 插件不向网页提供独立 IPC 命令。
                let handle = _api.register_android_plugin(
                    "app.antifieldcomplexx.runtime",
                    "ClientRuntimePlugin",
                )?;
                _app.manage(ClientRuntime(handle));
            }
            Ok(())
        })
        .build()
}
