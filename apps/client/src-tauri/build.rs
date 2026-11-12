//! 固定原生服务源并生成主窗口命令权限；不读取本地凭据文件。
fn main() {
    // 原生传输只使用构建期固定源；不读取工作区的凭据文件。
    for key in ["VITE_API_ORIGIN", "VITE_AI_ORIGIN", "VITE_ACCESS_ORIGIN"] {
        println!("cargo:rerun-if-env-changed={key}");
        let fallback = match key {
            "VITE_API_ORIGIN" => "https://app.example.com",
            "VITE_AI_ORIGIN" => "https://ai.example.com",
            _ => "",
        };
        let value = std::env::var(key).unwrap_or_else(|_| fallback.to_owned());
        println!("cargo:rustc-env={key}={value}");
    }
    // 能力文件里的 allow-* 只在这里登记命令后才会生成。
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "prepare_device",
            "store_session",
            "clear_session",
            "clear_device",
            "sign_request",
            "has_session",
            "open_ai_workspace",
            "download_file",
            "cancel_transfer",
            "create_preview",
            "release_preview",
            "background_app",
        ]));
    tauri_build::try_build(attributes).expect("生成客户端权限失败");
}
