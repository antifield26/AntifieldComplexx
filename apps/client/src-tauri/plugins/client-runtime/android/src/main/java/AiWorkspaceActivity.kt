// 独立 AI 页面没有设备密钥和 Tauri 命令桥；主框架只允许编译期固定 AI 与 Access 源。
package app.antifieldcomplexx.runtime

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity
import java.lang.ref.WeakReference
import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicBoolean

internal object AiPolicy {
    fun validUserAgent(value: String): Boolean = value.isNotEmpty() && value.length <= 300 && value.all { it.code in 32..126 }
    fun sameOrigin(raw: String, expected: String): Boolean {
        val url = Uri.parse(raw)
        val origin = Uri.parse(expected)
        fun port(uri: Uri) = if (uri.port == -1) 443 else uri.port
        val fixed = Uri.parse(BuildConfig.AI_ORIGIN)
        return fixed.scheme == "https" && fixed.userInfo == null && fixed.path.orEmpty().trim('/') == "" &&
            fixed.query == null && fixed.fragment == null &&
            origin.scheme == fixed.scheme && origin.host == fixed.host && port(origin) == port(fixed) &&
            url.scheme == "https" && url.userInfo == null && url.host != null &&
            origin.scheme == "https" && origin.userInfo == null && origin.path.orEmpty().trim('/') == "" &&
            origin.query == null && origin.fragment == null && url.host == origin.host && port(url) == port(origin)
    }
    private fun secureOrigin(raw: String): Uri? {
        val uri = Uri.parse(raw)
        return if (uri.scheme == "https" && uri.host != null && uri.userInfo == null && uri.path.orEmpty().trim('/') == "" && uri.query == null && uri.fragment == null) uri else null
    }
    fun validAccessOrigin(raw: String): Boolean {
        if (raw.isEmpty()) return BuildConfig.ACCESS_ORIGIN.isEmpty()
        val fixed = secureOrigin(BuildConfig.ACCESS_ORIGIN) ?: return false
        val supplied = secureOrigin(raw) ?: return false
        fun port(uri: Uri) = if (uri.port == -1) 443 else uri.port
        return supplied.host == fixed.host && port(supplied) == port(fixed)
    }
    fun allowedNavigation(raw: String, expected: String, accessOrigin: String): Boolean {
        if (sameOrigin(raw, expected)) return true
        if (accessOrigin.isEmpty() || !validAccessOrigin(accessOrigin)) return false
        val url = Uri.parse(raw)
        val access = Uri.parse(accessOrigin)
        fun port(uri: Uri) = if (uri.port == -1) 443 else uri.port
        return url.scheme == "https" && url.userInfo == null && url.host == access.host && port(url) == port(access)
    }
    fun isAccessNavigation(raw: String, expected: String, accessOrigin: String): Boolean =
        !sameOrigin(raw, expected) && allowedNavigation(raw, expected, accessOrigin)
    fun validEntry(raw: String, expected: String): Boolean {
        if (!sameOrigin(raw, expected)) return false
        val uri = Uri.parse(raw)
        val ticket = uri.encodedPath?.removePrefix("/__af/sso/") ?: return false
        if (uri.fragment != null || uri.encodedPath != "/__af/sso/$ticket" || !ticket.matches(Regex("[A-Za-z0-9_-]{20,128}"))) return false
        if (uri.queryParameterNames.any { it != "next" } || uri.getQueryParameters("next").size > 1) return false
        val next = uri.getQueryParameter("next") ?: "/"
        return next.startsWith("/") && !next.startsWith("//") && !next.contains('\\') && next.none { it.code < 32 || it.code == 127 }
    }
}

class AiWorkspaceActivity : AppCompatActivity() {
    private var web: WebView? = null
    private var origin = ""
    private var accessOrigin = ""
    private val accessVisited = AtomicBoolean(false)
    private var closing = false
    private var storageCleared = false
    private val closedCallbacks = mutableListOf<() -> Unit>()

    private fun blockNavigation(raw: String): Boolean {
        if (!AiPolicy.allowedNavigation(raw, origin, accessOrigin)) return true
        if (AiPolicy.isAccessNavigation(raw, origin, accessOrigin)) accessVisited.set(true)
        val uri = Uri.parse(raw)
        if (AiPolicy.sameOrigin(raw, origin) && uri.path.orEmpty().startsWith("/__af/sso/") && accessVisited.compareAndSet(true, false)) {
            ClientRuntimePlugin.requestAiRefresh()
            return true
        }
        return false
    }

    companion object {
        private var active = WeakReference<AiWorkspaceActivity>(null)
        fun closeActive(done: () -> Unit) {
            val current = active.get()
            if (current == null) done() else current.closeWorkspace(done)
        }
    }

    private fun closeWorkspace(done: () -> Unit = {}) {
        if (storageCleared) { done(); finish(); return }
        closedCallbacks.add(done)
        if (closing) return
        closing = true
        web?.stopLoading()
        // 等待删除 Cookie 后才回应 Rust，避免登出与下一次打开工作区交错。
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            android.webkit.WebStorage.getInstance().deleteAllData()
            storageCleared = true
            finish()
            closedCallbacks.toList().forEach { it() }
            closedCallbacks.clear()
        }
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        active = WeakReference(this)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(16, 18, 20)) }
        val back = Button(this).apply { text = "返回 AntifieldComplexx"; setOnClickListener { closeWorkspace() } }
        layout.addView(back)
        val view = WebView(this)
        web = view
        layout.addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(layout)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.isForMainFrame && blockNavigation(request.url.toString())
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (request.isForMainFrame && blockNavigation(request.url.toString())) {
                    return WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream("该地址不属于工作区".toByteArray()))
                }
                return null
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (blockNavigation(url)) view.stopLoading()
            }
            override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) { handler.cancel() }
        }
        open(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); open(intent) }

    private fun open(intent: Intent) {
        val url = intent.getStringExtra("url") ?: ""
        val expected = intent.getStringExtra("origin") ?: ""
        val access = intent.getStringExtra("accessOrigin") ?: ""
        val ua = intent.getStringExtra("userAgent") ?: ""
        if (!AiPolicy.validEntry(url, expected) || !AiPolicy.validUserAgent(ua) || !AiPolicy.validAccessOrigin(access) || closing) { closeWorkspace(); return }
        origin = expected
        accessOrigin = access
        web?.settings?.userAgentString = ua
        web?.loadUrl(url)
    }

    @Deprecated("系统返回关闭独立工作区")
    override fun onBackPressed() { if (web?.canGoBack() == true) web?.goBack() else closeWorkspace() }

    override fun onDestroy() {
        web?.apply { stopLoading(); loadUrl("about:blank"); clearHistory(); clearCache(true); removeAllViews(); destroy() }
        web = null
        if (!storageCleared) {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            android.webkit.WebStorage.getInstance().deleteAllData()
        }
        if (active.get() === this) active.clear()
        super.onDestroy()
    }
}
