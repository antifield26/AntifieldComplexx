//! AI 工作区只接受固定 AI 源的一次性 SSO 路径；远端容器没有主窗口能力。
//! 主页面实际 User-Agent 透传给新容器，保持服务端换票绑定一致。

use crate::policy;
#[cfg(any(not(target_os = "android"), test))]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Url};

#[cfg(not(target_os = "android"))]
const AI_WINDOW: &str = "ai";

pub(crate) fn validate_ai_workspace_url(raw: &str, expected: &Url) -> Result<Url, ()> {
    let url = Url::parse(raw).map_err(|_| ())?;
    if url.scheme() != "https"
        || url.origin() != expected.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(());
    }
    let Some(ticket) = url.path().strip_prefix("/__af/sso/") else {
        return Err(());
    };
    if !(20..=128).contains(&ticket.len())
        || !ticket
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(());
    }
    let query: Vec<_> = url.query_pairs().collect();
    if query.len() > 1
        || query
            .iter()
            .any(|(key, value)| key != "next" || !safe_next(value))
    {
        return Err(());
    }
    Ok(url)
}

fn safe_next(value: &str) -> bool {
    value.starts_with('/')
        && !value.starts_with("//")
        && !value.contains('\\')
        && !value.chars().any(|ch| ch.is_control())
}

#[cfg(any(not(target_os = "android"), test))]
fn allowed_navigation(url: &Url, ai: &Url, access: Option<&Url>) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && (url.origin() == ai.origin()
            || access.is_some_and(|allowed| url.origin() == allowed.origin()))
}

#[cfg(any(not(target_os = "android"), test))]
fn refresh_after_access(url: &Url, ai: &Url, access: Option<&Url>, visited: &AtomicBool) -> bool {
    if access.is_some_and(|origin| url.origin() == origin.origin()) {
        visited.store(true, Ordering::Release);
    }
    url.origin() == ai.origin()
        && url.path().starts_with("/__af/sso/")
        && visited.swap(false, Ordering::AcqRel)
}

pub(crate) fn open_ai_workspace(
    app: &tauri::AppHandle,
    url: &str,
    user_agent: &str,
) -> Result<(), &'static str> {
    let expected = policy::ai_origin()?;
    let access = policy::access_origin()?;
    let parsed = validate_ai_workspace_url(url, &expected).map_err(|_| "工作区地址不合法")?;
    if !policy::valid_user_agent(user_agent) {
        return Err("工作区浏览器标识不合法");
    }
    #[cfg(target_os = "android")]
    {
        let runtime = app.state::<tauri_plugin_client_runtime::ClientRuntime>();
        runtime
            .open_ai(
                parsed.as_str(),
                expected.as_str(),
                access.as_ref().map(Url::as_str),
                user_agent,
            )
            .map_err(|_| "无法打开工作区")
    }
    #[cfg(not(target_os = "android"))]
    {
        if let Some(window) = app.get_webview_window(AI_WINDOW) {
            window.navigate(parsed).map_err(|_| "无法打开工作区")?;
            window.show().map_err(|_| "无法打开工作区")?;
            window.set_focus().map_err(|_| "无法打开工作区")?;
            return Ok(());
        }
        let main = app.get_webview_window("main");
        let event_main = main.clone();
        let access_visited = AtomicBool::new(false);
        let window =
            tauri::WebviewWindowBuilder::new(app, AI_WINDOW, tauri::WebviewUrl::External(parsed))
                .title("AI 工作区")
                .user_agent(user_agent)
                .incognito(true)
                .on_navigation(move |url| {
                    if !allowed_navigation(url, &expected, access.as_ref()) {
                        return false;
                    }
                    if refresh_after_access(url, &expected, access.as_ref(), &access_visited) {
                        // 不向远端或事件载荷暴露票据；主壳收到固定事件后重新换票。
                        if let Some(main) = &event_main {
                            let _ = main.eval("window.dispatchEvent(new Event('af:ai-refresh'))");
                        }
                        return false;
                    }
                    true
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()
                .map_err(|_| "无法打开工作区")?;
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(main) = &main {
                    let _ = main.show();
                    let _ = main.set_focus();
                }
            }
        });
        window.show().map_err(|_| "无法打开工作区")?;
        window.set_focus().map_err(|_| "无法打开工作区")?;
        Ok(())
    }
}

pub(crate) fn close_ai_workspace(app: &tauri::AppHandle) -> Result<(), &'static str> {
    #[cfg(target_os = "android")]
    {
        if let Some(runtime) = app.try_state::<tauri_plugin_client_runtime::ClientRuntime>() {
            runtime.close_ai().map_err(|_| "无法关闭工作区")?;
        }
    }
    #[cfg(not(target_os = "android"))]
    if let Some(window) = app.get_webview_window(AI_WINDOW) {
        let cleared = window.clear_all_browsing_data();
        let closed = window.destroy();
        if cleared.is_err() || closed.is_err() {
            return Err("无法关闭工作区");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const TICKET: &str = "abcdefghijklmnopqrstuvwxyz012345";
    #[test]
    fn accepts_only_fixed_sso_origin_and_safe_next() {
        let origin = Url::parse("https://ai.example.com").unwrap();
        assert!(validate_ai_workspace_url(
            &format!("https://ai.example.com/__af/sso/{TICKET}?next=%2Fsession%2Fabc"),
            &origin
        )
        .is_ok());
        for value in [
            format!("https://ai.evil.com/__af/sso/{TICKET}"),
            format!("http://ai.example.com/__af/sso/{TICKET}"),
            format!("https://user:pass@ai.example.com/__af/sso/{TICKET}"),
            format!("https://ai.example.com/__af/sso/{TICKET}#x"),
            format!("https://ai.example.com:444/__af/sso/{TICKET}"),
            format!("https://ai.example.com/__af/sso/{TICKET}?next=%2F%2Fevil.com"),
            format!("https://ai.example.com/__af/sso/{TICKET}?next=%2F%5Cevil.com"),
            format!("https://ai.example.com/__af/sso/{TICKET}?next=%2F&next=%2F"),
            format!("https://ai.example.com/__af/sso/{TICKET}?x=1"),
            "https://ai.example.com/__af/sso/short".to_owned(),
        ] {
            assert!(
                validate_ai_workspace_url(&value, &origin).is_err(),
                "{value}"
            );
        }
        assert!(!policy::valid_user_agent("Mozilla\r\nx: y"));
        assert!(!policy::valid_user_agent(&"a".repeat(301)));
        assert!(policy::valid_user_agent("Mozilla/5.0 Android Mobile"));
    }

    #[test]
    fn navigation_only_allows_fixed_ai_and_access_origins() {
        let ai = Url::parse("https://ai.example.com").unwrap();
        let access = Url::parse("https://team.cloudflareaccess.com").unwrap();
        for raw in [
            "https://ai.example.com/session/abc",
            "https://team.cloudflareaccess.com/cdn-cgi/access/login/ai.example.com",
        ] {
            assert!(allowed_navigation(
                &Url::parse(raw).unwrap(),
                &ai,
                Some(&access)
            ));
        }
        for raw in [
            "http://team.cloudflareaccess.com/",
            "https://other.cloudflareaccess.com/",
            "https://team.cloudflareaccess.com.evil.example/",
            "https://team.cloudflareaccess.com:444/",
            "https://user@team.cloudflareaccess.com/",
            "https://app.example.com/",
            "javascript:alert(1)",
            "file:///etc/passwd",
        ] {
            assert!(
                !allowed_navigation(&Url::parse(raw).unwrap(), &ai, Some(&access)),
                "{raw}"
            );
        }
        assert!(!allowed_navigation(&access, &ai, None));
        assert!(validate_ai_workspace_url(
            &format!("https://team.cloudflareaccess.com/__af/sso/{TICKET}"),
            &ai
        )
        .is_err());
    }

    #[test]
    fn access_return_blocks_old_ticket_once_and_new_ticket_can_continue() {
        let ai = Url::parse("https://ai.example.com").unwrap();
        let access = Url::parse("https://team.cloudflareaccess.com").unwrap();
        let ticket = Url::parse(&format!("https://ai.example.com/__af/sso/{TICKET}")).unwrap();
        let visited = AtomicBool::new(false);
        assert!(!refresh_after_access(&ticket, &ai, Some(&access), &visited));
        assert!(!refresh_after_access(&access, &ai, Some(&access), &visited));
        assert!(refresh_after_access(&ticket, &ai, Some(&access), &visited));
        assert!(!refresh_after_access(&ticket, &ai, Some(&access), &visited));
        assert!(!visited.load(Ordering::Acquire));
    }
}
