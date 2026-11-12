// 主 Tauri 容器的原生适配；AI Activity 不安装 Tauri 或任何 JavaScript 命令桥。
package app.antifieldcomplexx.runtime

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.lang.ref.WeakReference

@InvokeArg
class AiOptions {
    lateinit var url: String
    lateinit var origin: String
    var accessOrigin: String = ""
    lateinit var userAgent: String
}
@InvokeArg
class SaveOptions { lateinit var name: String }
@InvokeArg
class SaveHandle { lateinit var id: String }

@TauriPlugin
class ClientRuntimePlugin(private val activity: Activity) : Plugin(activity) {
    private val destinations = ConcurrentHashMap<String, Uri>()
    companion object {
        private var mainWebView = WeakReference<WebView>(null)
        fun requestAiRefresh() {
            mainWebView.get()?.let { view -> view.post { view.evaluateJavascript("window.dispatchEvent(new Event('af:ai-refresh'))", null) } }
        }
    }

    override fun load(webView: WebView) {
        // WebView 的整体拉伸会带动 CSS 固定导航；保留内容惯性滚动，关闭原生容器回弹。
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        mainWebView = WeakReference(webView)
        val host = activity as? AppCompatActivity ?: return
        host.onBackPressedDispatcher.addCallback(host, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 只向主壳派发固定事件；独立 AI Activity 不使用该 WebView。
                webView.evaluateJavascript("window.dispatchEvent(new Event('af:native-back'))", null)
            }
        })
    }

    @Command
    fun background(invoke: Invoke) {
        activity.runOnUiThread { activity.moveTaskToBack(true); invoke.resolve() }
    }

    @Command
    fun openAi(invoke: Invoke) {
        val args = invoke.parseArgs(AiOptions::class.java)
        if (!AiPolicy.validEntry(args.url, args.origin) || !AiPolicy.validUserAgent(args.userAgent) || !AiPolicy.validAccessOrigin(args.accessOrigin)) {
            invoke.reject("工作区地址不合法")
            return
        }
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, AiWorkspaceActivity::class.java)
                .putExtra("url", args.url).putExtra("origin", args.origin).putExtra("accessOrigin", args.accessOrigin).putExtra("userAgent", args.userAgent)
                .addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
            invoke.resolve()
        }
    }

    @Command
    fun closeAi(invoke: Invoke) {
        activity.runOnUiThread {
            AiWorkspaceActivity.closeActive { invoke.resolve() }
        }
    }

    @Command
    fun chooseSave(invoke: Invoke) {
        val args = invoke.parseArgs(SaveOptions::class.java)
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_TITLE, args.name)
        startActivityForResult(invoke, intent, "saveResult")
    }

    @ActivityCallback
    fun saveResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolve()
            return
        }
        val uri = result.data?.data
        if (uri == null || uri.scheme != "content") {
            invoke.reject("无法使用所选文件")
            return
        }
        try {
            val descriptor = activity.contentResolver.openFileDescriptor(uri, "rwt")
                ?: throw IllegalStateException()
            val id = UUID.randomUUID().toString()
            destinations[id] = uri
            invoke.resolve(JSObject().put("fd", descriptor.detachFd()).put("id", id))
        } catch (_: Exception) {
            try { android.provider.DocumentsContract.deleteDocument(activity.contentResolver, uri) } catch (_: Exception) { }
            invoke.reject("无法写入所选文件")
        }
    }

    @Command
    fun discardSave(invoke: Invoke) {
        val id = invoke.parseArgs(SaveHandle::class.java).id
        val uri = destinations.remove(id)
        try {
            if (uri != null && !android.provider.DocumentsContract.deleteDocument(activity.contentResolver, uri)) {
                invoke.reject("无法清理未完成的下载")
                return
            }
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("无法清理未完成的下载") }
    }

    @Command
    fun finishSave(invoke: Invoke) {
        destinations.remove(invoke.parseArgs(SaveHandle::class.java).id)
        invoke.resolve()
    }
}
