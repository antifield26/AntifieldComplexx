//! 本地 Android 插件由 Tauri 在生成工程时接入，源码不依赖 gen 目录。
fn main() {
    tauri_plugin::Builder::new(&[])
        .android_path("android")
        .build();
}
