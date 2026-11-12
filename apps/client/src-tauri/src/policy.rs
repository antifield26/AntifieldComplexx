//! 原生边界只信任编译期固定源与精确接口；页面不能提供远端源或本机路径。

use tauri::Url;

pub(crate) const USER_AGENT: &str = "AntifieldComplexx/1";

pub(crate) fn valid_user_agent(value: &str) -> bool {
    !value.is_empty() && value.len() <= 300 && value.bytes().all(|byte| matches!(byte, 0x20..=0x7e))
}

pub(crate) fn configured_origin(raw: &str) -> Result<Url, &'static str> {
    let url = Url::parse(raw).map_err(|_| "客户端服务地址未正确配置")?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if !(url.scheme() == "https" || (cfg!(debug_assertions) && url.scheme() == "http" && loopback))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("客户端服务地址未正确配置");
    }
    Ok(url)
}

pub(crate) fn api_origin() -> Result<Url, &'static str> {
    configured_origin(env!("VITE_API_ORIGIN"))
}

pub(crate) fn ai_origin() -> Result<Url, &'static str> {
    configured_origin(env!("VITE_AI_ORIGIN"))
}

pub(crate) fn access_origin() -> Result<Option<Url>, &'static str> {
    let value = env!("VITE_ACCESS_ORIGIN");
    if value.is_empty() {
        return Ok(None);
    }
    let url = configured_origin(value)?;
    if url.scheme() != "https" {
        return Err("客户端 Access 地址未正确配置");
    }
    Ok(Some(url))
}

pub(crate) fn content_path(path: &str) -> Result<(), &'static str> {
    let (base, query) = path
        .split_once('?')
        .map_or((path, None), |(base, query)| (base, Some(query)));
    let id = base
        .strip_prefix("/api/files/")
        .and_then(|value| value.strip_suffix("/content"));
    if !id.is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 128
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    }) || !matches!(query, None | Some("inline=1" | "download=1"))
    {
        return Err("文件接口路径不合法");
    }
    Ok(())
}

pub(crate) fn safe_name(name: &str) -> String {
    let value: String = name
        .chars()
        .filter(|ch| {
            !ch.is_control() && !matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        .take(180)
        .collect();
    let value = value.trim_matches(|ch| ch == ' ' || ch == '.');
    if value.is_empty() {
        "下载文件".to_owned()
    } else {
        value.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_endpoints_are_exact_and_origin_free() {
        for path in [
            "/api/files/abc-123/content",
            "/api/files/abc/content?inline=1",
            "/api/files/id/content?download=1",
        ] {
            assert!(content_path(path).is_ok(), "{path}");
        }
        for path in [
            "https://evil.example/api/files/id/content",
            "//evil.example/api/files/id/content",
            "/api/files/../content",
            "/api/files/%2e%2e/content",
            "/api/files/id/content#x",
            "/api/files/id/content?inline=1&url=x",
            "/api/files/id/content?download=1&inline=1",
            "/api/files/id%2fabc/content",
            "/api/files/id\\abc/content",
            "/api/auth/me",
        ] {
            assert!(content_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn origin_and_picker_name_are_restricted() {
        for value in [
            "https://user@ai.example.com",
            "https://ai.example.com/path",
            "https://ai.example.com?x",
            "https://ai.example.com#x",
            "http://evil.example.com",
        ] {
            assert!(configured_origin(value).is_err());
        }
        assert!(configured_origin("https://ai.example.com").is_ok());
        assert_eq!(safe_name("../\\x\r\n:test.txt"), "xtest.txt");
        assert_eq!(safe_name("..."), "下载文件");
    }
}
