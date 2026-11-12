//! 桌面进程入口只启动受限原生壳，不直接接触设备密钥或远端页面。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    client_lib::run()
}
