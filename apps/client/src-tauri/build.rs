fn main() {
    // 能力文件里的 allow-* 只在这里登记命令后才会生成。
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "prepare_device",
            "store_session",
            "clear_session",
            "clear_device",
            "sign_request",
            "has_session",
        ]),
    );
    tauri_build::try_build(attributes).expect("生成客户端权限失败");
}
