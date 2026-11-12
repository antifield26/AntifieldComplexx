//! 文件内容经固定 API 源和本机密钥签名传输；保存目标只来自系统选择器。
//! 预览监听仅绑定 loopback，以短期随机资源句柄转发内容与 Range，不暴露设备凭据。

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{Stream, StreamExt};
use rand::RngCore;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::{policy, sign, store};

const MAX_DOWNLOAD: u64 = 10 * 1024 * 1024 * 1024;
const PREVIEW_LIFETIME: Duration = Duration::from_secs(2 * 60 * 60);

#[derive(Clone)]
struct Preview {
    path: String,
    created: Instant,
    cancel: CancellationToken,
}

#[derive(Default)]
struct Resources {
    generation: u64,
    previews: HashMap<String, Preview>,
    transfers: HashMap<String, CancellationToken>,
}

fn prune_previews(previews: &mut HashMap<String, Preview>) {
    previews.retain(|_, preview| {
        let keep = !preview.cancel.is_cancelled() && preview.created.elapsed() < PREVIEW_LIFETIME;
        if !keep {
            preview.cancel.cancel();
        }
        keep
    });
}

fn resources() -> &'static Mutex<Resources> {
    static STATE: OnceLock<Mutex<Resources>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Resources::default()))
}

pub(crate) fn revoke_all() {
    if let Ok(mut state) = resources().lock() {
        state.generation = state.generation.wrapping_add(1);
        for (_, preview) in state.previews.drain() {
            preview.cancel.cancel();
        }
        for (_, cancel) in state.transfers.drain() {
            cancel.cancel();
        }
    }
}

pub(crate) fn cancel_transfer(id: &str) -> Result<(), &'static str> {
    let state = resources().lock().map_err(|_| "传输不可用")?;
    if let Some(cancel) = state.transfers.get(id) {
        cancel.cancel();
    }
    Ok(())
}

pub(crate) fn release_preview(id: &str) -> Result<(), &'static str> {
    if let Some(preview) = resources()
        .lock()
        .map_err(|_| "预览不可用")?
        .previews
        .remove(id)
    {
        preview.cancel.cancel();
    }
    Ok(())
}

fn random_id() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn client() -> Result<reqwest::Client, &'static str> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .user_agent(policy::USER_AGENT)
        .build()
        .map_err(|_| "原生传输不可用")
}

fn request(path: &str, range: Option<&str>) -> Result<reqwest::RequestBuilder, &'static str> {
    policy::content_path(path)?;
    let origin = policy::api_origin()?;
    let url = origin.join(path).map_err(|_| "文件接口路径不合法")?;
    if url.origin() != origin.origin() {
        return Err("文件接口路径不合法");
    }
    let _guard = store::operation_lock().lock().map_err(|_| "密钥库不可用")?;
    let signed = sign::sign_request(store::global(), "GET", path, "", None)
        .map_err(|_| "设备认证不可用")?
        .ok_or("请先登录客户端")?;
    let mut request = client()?
        .get(url)
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", signed.authorization),
        )
        .header("x-device-id", signed.device_id)
        .header("x-device-timestamp", signed.timestamp)
        .header("x-device-nonce", signed.nonce)
        .header("x-device-signature", signed.signature);
    if let Some(range) = range {
        request = request.header(header::RANGE, range);
    }
    Ok(request)
}

fn valid_range(value: &str) -> bool {
    value.len() <= 100
        && value.strip_prefix("bytes=").is_some_and(|range| {
            range.split_once('-').is_some_and(|(start, end)| {
                (!start.is_empty() || !end.is_empty())
                    && start.bytes().all(|b| b.is_ascii_digit())
                    && end.bytes().all(|b| b.is_ascii_digit())
            })
        })
}

fn preview_mime(value: &str) -> bool {
    let mime = value
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    matches!(
        mime.as_str(),
        "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/avif"
            | "image/x-icon"
            | "application/pdf"
            | "audio/mpeg"
            | "audio/mp4"
            | "audio/ogg"
            | "audio/wav"
            | "audio/x-wav"
            | "audio/webm"
            | "audio/flac"
            | "video/mp4"
            | "video/webm"
            | "video/ogg"
            | "video/quicktime"
    )
}

fn allowed_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost"
    ) || (cfg!(debug_assertions)
        && matches!(origin, "http://127.0.0.1:5173" | "http://localhost:5173"))
}

#[derive(Clone)]
struct ServerState {
    host: String,
}

async fn serve_preview(
    State(server): State<Arc<ServerState>>,
    Path(id): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    if headers.get(header::HOST).and_then(|h| h.to_str().ok()) != Some(server.host.as_str()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let origin = headers.get(header::ORIGIN).and_then(|h| h.to_str().ok());
    if origin.is_some_and(|value| !allowed_origin(value)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let preview = {
        let Ok(mut state) = resources().lock() else {
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        };
        prune_previews(&mut state.previews);
        state.previews.get(&id).cloned()
    };
    let Some(preview) = preview else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let range = headers.get(header::RANGE).and_then(|h| h.to_str().ok());
    if range.is_some_and(|value| !valid_range(value)) {
        return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
    }
    let upstream = match request(&preview.path, range) {
        Ok(request) => {
            tokio::select! { biased; _ = preview.cancel.cancelled() => return StatusCode::GONE.into_response(), result = request.send() => result }
        }
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let Ok(upstream) = upstream else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    if !matches!(upstream.status().as_u16(), 200 | 206) {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    let mime = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !preview_mime(mime) {
        return StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response();
    }
    let mut builder = Response::builder()
        .status(upstream.status())
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_DISPOSITION, "inline")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("referrer-policy", "no-referrer");
    for name in [
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            builder = builder.header(name, value);
        }
    }
    if let Some(origin) = origin {
        builder = builder
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::VARY, "Origin");
    }
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(
            upstream
                .bytes_stream()
                .take_until(preview.cancel.cancelled_owned()),
        )
    };
    builder
        .body(body)
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn preview_port() -> Result<u16, &'static str> {
    static PORT: tokio::sync::OnceCell<u16> = tokio::sync::OnceCell::const_new();
    PORT.get_or_try_init(|| async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "预览不可用")?;
        let port = listener.local_addr().map_err(|_| "预览不可用")?.port();
        let state = Arc::new(ServerState {
            host: format!("127.0.0.1:{port}"),
        });
        let router = Router::new()
            .route("/preview/{id}", get(serve_preview))
            .with_state(state);
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Ok(port)
    })
    .await
    .copied()
}

#[derive(Serialize)]
pub(crate) struct PreviewResult {
    id: String,
    url: String,
}

pub(crate) async fn create_preview(path: String) -> Result<PreviewResult, &'static str> {
    policy::content_path(&path)?;
    let generation = resources().lock().map_err(|_| "预览不可用")?.generation;
    // 建立句柄前确认已登录，但凭据仅在每次实际请求时从密钥库读取。
    let _ = request(&path, None)?;
    let port = preview_port().await?;
    let mut state = resources().lock().map_err(|_| "预览不可用")?;
    if generation != state.generation {
        return Err("登录状态已改变，请重试");
    }
    prune_previews(&mut state.previews);
    if state.previews.len() >= 128 {
        return Err("打开的预览过多");
    }
    let id = random_id();
    state.previews.insert(
        id.clone(),
        Preview {
            path,
            created: Instant::now(),
            cancel: CancellationToken::new(),
        },
    );
    Ok(PreviewResult {
        url: format!("http://127.0.0.1:{port}/preview/{id}"),
        id,
    })
}

#[derive(Serialize)]
pub(crate) struct DownloadResult {
    status: &'static str,
}

struct TransferGuard {
    id: String,
}
impl Drop for TransferGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = resources().lock() {
            state.transfers.remove(&self.id);
        }
    }
}

async fn stream_download(
    path: &str,
    output: std::fs::File,
    cancel: &CancellationToken,
) -> Result<(), &'static str> {
    let request = request(path, None)?;
    let response = tokio::select! { biased; _ = cancel.cancelled() => return Err("下载已取消"), value = request.send() => value.map_err(|_| "下载连接失败")? };
    if response.status() != StatusCode::OK {
        return Err("下载失败，请重新登录后重试");
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_DOWNLOAD)
    {
        return Err("文件超过客户端支持大小");
    }
    let expected = response.content_length();
    let mut file = tokio::fs::File::from_std(output);
    copy_chunks(response.bytes_stream(), &mut file, expected, cancel).await?;
    file.flush().await.map_err(|_| "无法保存文件")?;
    // SAF 提供方可返回写入管道；常规文件落盘确认，管道由提供方在关闭描述符时提交。
    if file
        .metadata()
        .await
        .map_err(|_| "无法确认所选文件")?
        .is_file()
    {
        file.sync_all().await.map_err(|_| "无法保存文件")?;
    }
    if cancel.is_cancelled() {
        return Err("下载已取消");
    }
    Ok(())
}

async fn copy_chunks<S, E, W>(
    mut chunks: S,
    file: &mut W,
    expected: Option<u64>,
    cancel: &CancellationToken,
) -> Result<u64, &'static str>
where
    S: Stream<Item = Result<axum::body::Bytes, E>> + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut count = 0u64;
    loop {
        let chunk = tokio::select! { biased; _ = cancel.cancelled() => return Err("下载已取消"), value = chunks.next() => value };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|_| "下载中断")?;
        count = count
            .checked_add(chunk.len() as u64)
            .filter(|size| *size <= MAX_DOWNLOAD)
            .ok_or("文件超过客户端支持大小")?;
        file.write_all(&chunk)
            .await
            .map_err(|_| "无法写入所选文件")?;
    }
    if expected.is_some_and(|expected| expected != count) {
        return Err("下载内容不完整");
    }
    Ok(count)
}

pub(crate) async fn download_file(
    app: tauri::AppHandle,
    path: String,
    suggested_name: String,
    transfer_id: String,
) -> Result<DownloadResult, &'static str> {
    policy::content_path(&path)?;
    if transfer_id.is_empty()
        || transfer_id.len() > 128
        || !transfer_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err("传输标识不合法");
    }
    let cancel = CancellationToken::new();
    {
        let mut state = resources().lock().map_err(|_| "传输不可用")?;
        if state.transfers.len() >= 4 || state.transfers.contains_key(&transfer_id) {
            return Err("同时下载的文件过多");
        }
        state.transfers.insert(transfer_id.clone(), cancel.clone());
    }
    let _guard = TransferGuard {
        id: transfer_id.clone(),
    };
    let name = policy::safe_name(&suggested_name);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let destination = rfd::AsyncFileDialog::new()
            .set_file_name(&name)
            .save_file()
            .await;
        let Some(destination) = destination else {
            return Ok(DownloadResult {
                status: "cancelled",
            });
        };
        if cancel.is_cancelled() {
            return Ok(DownloadResult {
                status: "cancelled",
            });
        }
        let parent = destination.path().parent().ok_or("无法使用所选位置")?;
        let temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建下载临时文件")?;
        let result = stream_download(
            &path,
            temporary.reopen().map_err(|_| "无法创建下载临时文件")?,
            &cancel,
        )
        .await;
        if cancel.is_cancelled() {
            return Ok(DownloadResult {
                status: "cancelled",
            });
        }
        result?;
        temporary
            .persist(destination.path())
            .map_err(|_| "无法保存所选文件")?;
    }
    #[cfg(target_os = "android")]
    {
        use std::os::fd::FromRawFd;
        use tauri::Manager;
        let runtime = app.state::<tauri_plugin_client_runtime::ClientRuntime>();
        let selected = runtime
            .choose_save(&name)
            .await
            .map_err(|_| "无法打开保存选择器")?;
        let Some(selected) = selected else {
            return Ok(DownloadResult {
                status: "cancelled",
            });
        };
        if selected.fd < 0 {
            return Err("无法使用所选文件");
        }
        // 文件描述符仅由系统选择器产生，页面无法传入描述符或 content URI。
        let output = unsafe { std::fs::File::from_raw_fd(selected.fd) };
        let result = stream_download(&path, output, &cancel).await;
        if result.is_err() || cancel.is_cancelled() {
            runtime
                .discard_save(&selected.id)
                .map_err(|_| "下载未完成，无法清理所选文件")?;
        } else {
            runtime
                .finish_save(&selected.id)
                .map_err(|_| "无法确认文件保存")?;
        }
        if cancel.is_cancelled() {
            return Ok(DownloadResult {
                status: "cancelled",
            });
        }
        result?;
    }
    Ok(DownloadResult { status: "saved" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_types_and_web_origins_are_restricted() {
        for range in ["bytes=0-", "bytes=0-99", "bytes=-1024"] {
            assert!(valid_range(range));
        }
        for range in [
            "bytes=",
            "bytes=-",
            "bytes=0-1,2-3",
            "items=0-2",
            "bytes=1-2\r\nX:X",
        ] {
            assert!(!valid_range(range));
        }
        for mime in [
            "text/html",
            "image/svg+xml",
            "application/xml",
            "application/octet-stream",
        ] {
            assert!(!preview_mime(mime));
        }
        assert!(preview_mime("image/png"));
        assert!(preview_mime("video/mp4; charset=binary"));
        assert!(!allowed_origin("https://ai.example.com"));
        assert!(!allowed_origin("http://tauri.localhost.evil"));
    }
    #[test]
    fn revocation_cancels_active_resources() {
        let preview_cancel = CancellationToken::new();
        let transfer_cancel = CancellationToken::new();
        {
            let mut state = resources().lock().unwrap();
            state.previews.insert(
                "test".to_owned(),
                Preview {
                    path: "/api/files/a/content".to_owned(),
                    created: Instant::now(),
                    cancel: preview_cancel.clone(),
                },
            );
            state
                .transfers
                .insert("test".to_owned(), transfer_cancel.clone());
        }
        revoke_all();
        assert!(preview_cancel.is_cancelled());
        assert!(transfer_cancel.is_cancelled());
        assert!(resources().lock().unwrap().previews.is_empty());
    }

    #[test]
    fn expiry_cancels_active_stream_before_removing_handle() {
        let cancel = CancellationToken::new();
        let mut previews = HashMap::new();
        previews.insert(
            "expired".to_owned(),
            Preview {
                path: "/api/files/a/content".to_owned(),
                created: Instant::now() - PREVIEW_LIFETIME,
                cancel: cancel.clone(),
            },
        );
        prune_previews(&mut previews);
        assert!(previews.is_empty());
        assert!(cancel.is_cancelled());
    }

    #[test]
    fn authenticated_transport_does_not_follow_redirects() {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
            use tokio::io::AsyncReadExt;
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = tokio::spawn(async move {
                let (mut connection, _) = listener.accept().await.unwrap();
                let mut input = vec![0u8; 4096];
                let _ = connection.read(&mut input).await.unwrap();
                connection.write_all(format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/other\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            });
            let response = client().unwrap().get(format!("http://127.0.0.1:{port}/file")).header(header::AUTHORIZATION, "Bearer fixture-token").send().await.unwrap();
            assert_eq!(response.status(), StatusCode::FOUND);
            server.await.unwrap();
        });
    }

    #[test]
    fn streams_more_than_five_gib_with_one_reused_chunk() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                // 共享一个 64 KiB 块并写入计数接收器，证明长度使用 u64 且不聚合整个文件。
                let chunk = axum::body::Bytes::from(vec![7u8; 64 * 1024]);
                let chunks =
                    futures_util::stream::iter((0..81921).map(|_| Ok::<_, ()>(chunk.clone())));
                let expected = 5 * 1024 * 1024 * 1024u64 + 64 * 1024;
                let copied = copy_chunks(
                    chunks,
                    &mut tokio::io::sink(),
                    Some(expected),
                    &CancellationToken::new(),
                )
                .await
                .unwrap();
                assert_eq!(copied, expected);
            });
    }

    #[test]
    fn cancellation_truncation_and_stream_errors_fail_closed() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let cancel = CancellationToken::new();
                cancel.cancel();
                let pending = futures_util::stream::pending::<Result<axum::body::Bytes, ()>>();
                assert_eq!(
                    copy_chunks(pending, &mut tokio::io::sink(), None, &cancel)
                        .await
                        .unwrap_err(),
                    "下载已取消"
                );
                let short = futures_util::stream::iter([Ok::<_, ()>(
                    axum::body::Bytes::from_static(b"abc"),
                )]);
                assert_eq!(
                    copy_chunks(
                        short,
                        &mut tokio::io::sink(),
                        Some(4),
                        &CancellationToken::new()
                    )
                    .await
                    .unwrap_err(),
                    "下载内容不完整"
                );
                let broken = futures_util::stream::iter([Err::<axum::body::Bytes, ()>(())]);
                assert_eq!(
                    copy_chunks(
                        broken,
                        &mut tokio::io::sink(),
                        None,
                        &CancellationToken::new()
                    )
                    .await
                    .unwrap_err(),
                    "下载中断"
                );
            });
    }

    #[test]
    fn preview_rejects_dns_rebinding_and_remote_origins_before_lookup() {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let state = Arc::new(ServerState {
                    host: "127.0.0.1:12345".to_owned(),
                });
                let mut headers = HeaderMap::new();
                headers.insert(header::HOST, "evil.example:12345".parse().unwrap());
                assert_eq!(
                    serve_preview(
                        State(state.clone()),
                        Path("unknown".to_owned()),
                        Method::GET,
                        headers.clone()
                    )
                    .await
                    .status(),
                    StatusCode::FORBIDDEN
                );
                headers.insert(header::HOST, "127.0.0.1:12345".parse().unwrap());
                headers.insert(header::ORIGIN, "https://ai.example.com".parse().unwrap());
                assert_eq!(
                    serve_preview(
                        State(state),
                        Path("unknown".to_owned()),
                        Method::GET,
                        headers
                    )
                    .await
                    .status(),
                    StatusCode::FORBIDDEN
                );
            });
    }
}
