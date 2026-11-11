//! AI 工作区窗口。只接受服务端签发的 https SSO 地址，不记录地址本身。
//! 该窗口不在主窗口能力内，不能调用设备命令。

use tauri::{Manager, Url};

const AI_WINDOW: &str = "ai";

pub(crate) fn validate_ai_workspace_url(raw: &str) -> Result<Url, ()> {
    let url = Url::parse(raw).map_err(|_| ())?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(());
    }
    if url.fragment().is_some() || url.host_str().is_none() {
        return Err(());
    }
    let Some(ticket) = url.path().strip_prefix("/__af/sso/") else {
        return Err(());
    };
    if ticket.len() < 20
        || ticket.len() > 128
        || ticket.contains('/')
        || !ticket
            .bytes()
            .all(|byte| matches!(byte, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'_' | b'-'))
    {
        return Err(());
    }
    Ok(url)
}

pub(crate) fn open_ai_workspace(app: &tauri::AppHandle, url: &str) -> Result<(), &'static str> {
    let parsed = validate_ai_workspace_url(url).map_err(|_| "工作区地址不合法")?;
    if let Some(window) = app.get_webview_window(AI_WINDOW) {
        window.navigate(parsed).map_err(|_| "无法打开工作区")?;
        window.show().map_err(|_| "无法打开工作区")?;
        window.set_focus().map_err(|_| "无法打开工作区")?;
        return Ok(());
    }
    let window = tauri::WebviewWindowBuilder::new(app, AI_WINDOW, tauri::WebviewUrl::External(parsed))
        .title("AI 工作区")
        .build()
        .map_err(|_| "无法打开工作区")?;
    window.show().map_err(|_| "无法打开工作区")?;
    let _ = window.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_ai_workspace_url;

    const TICKET: &str = "abcdefghijklmnopqrstuvwxyz012345";

    #[test]
    fn accepts_sso_url_with_query() {
        let url = format!("https://ai.example.com/__af/sso/{TICKET}?next=%2Fsession%2Fabc");
        assert!(validate_ai_workspace_url(&url).is_ok());
    }

    #[test]
    fn rejects_insecure_userinfo_fragment_and_short_ticket() {
        assert!(validate_ai_workspace_url(&format!("http://ai.example.com/__af/sso/{TICKET}")).is_err());
        assert!(validate_ai_workspace_url(&format!("https://user:pass@ai.example.com/__af/sso/{TICKET}")).is_err());
        assert!(validate_ai_workspace_url(&format!("https://ai.example.com/__af/sso/{TICKET}#x")).is_err());
        assert!(validate_ai_workspace_url("https://ai.example.com/__af/sso/short").is_err());
        assert!(validate_ai_workspace_url(&format!("https://ai.example.com/__af/sso/{TICKET}/extra")).is_err());
        assert!(validate_ai_workspace_url(&format!("https://ai.evil.com/__af/sso/{TICKET}")).is_ok());
    }
}
