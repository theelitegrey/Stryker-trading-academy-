package com.tradezoro.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.CacheControl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** The android half of the site's public /app-version.json (docs/app-updates.md). */
@Serializable
data class AndroidRelease(
    val versionCode: Int,
    val versionName: String = "",
    val url: String = "",
    val notes: List<String> = emptyList(),
    val minVersionCode: Int = 0,
)

@Serializable
data class AppVersionManifest(val android: AndroidRelease? = null)

enum class UpdateKind { NONE, BANNER, BLOCKING }

/** What the app shows for a manifest. Blocking ignores the dismissed version: below the minimum there is no X. */
fun updateKind(r: AndroidRelease?, installed: Int, dismissed: Int): UpdateKind = when {
    r == null || r.url.isBlank() -> UpdateKind.NONE
    installed < r.minVersionCode && r.versionCode > installed -> UpdateKind.BLOCKING
    r.versionCode > installed && r.versionCode > dismissed -> UpdateKind.BANNER
    else -> UpdateKind.NONE
}

private val manifestJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Null on any malformed manifest: a broken file must never block or crash the app. */
fun parseAppManifest(text: String): AndroidRelease? =
    runCatching { manifestJson.decodeFromString<AppVersionManifest>(text).android }.getOrNull()?.takeIf { it.versionCode > 0 }

/** A ZIP local-file header ("PK\u0003\u0004"); every APK starts with one. */
fun looksLikeApk(f: File): Boolean = f.length() > 4 && f.inputStream().use { s ->
    val b = ByteArray(4); s.read(b) == 4 && b[0] == 0x50.toByte() && b[1] == 0x4B.toByte() && b[2] == 3.toByte() && b[3] == 4.toByte()
}

sealed interface Dl {
    data object Idle : Dl
    data class Running(val done: Long, val total: Long) : Dl { val fraction get() = if (total > 0) done.toFloat() / total else 0f }
    data class Ready(val file: File) : Dl
    data class Failed(val message: String) : Dl
}

data class UpdateUiState(val release: AndroidRelease? = null, val kind: UpdateKind = UpdateKind.NONE, val dl: Dl = Dl.Idle, val needsPermission: Boolean = false)

/**
 * App-shell updates for the sideloaded APK (no Play Store auto-update). Checks the site manifest on start, on resume
 * (at most once an hour) and every 6 h; downloads the APK into the app cache, checks it, and hands it to the system
 * installer. The installer itself refuses an APK signed with another key, so the signature needs no check here.
 */
class AppUpdater(
    private val ctx: Context,
    private val installed: Int,
    private val manifestUrl: String = MANIFEST_URL,
    private val http: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val prefs = ctx.getSharedPreferences("app_update", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(UpdateUiState())
    val state: StateFlow<UpdateUiState> = _state.asStateFlow()
    private var lastCheck = 0L

    /** [minGapMs] = 0 forces a check (start, 6-hour timer); resume passes [HOUR]. */
    suspend fun check(minGapMs: Long = 0) {
        if (now() - lastCheck < minGapMs || _state.value.dl is Dl.Running) return
        lastCheck = now()
        val text = withContext(Dispatchers.IO) {
            runCatching {
                http.newCall(Request.Builder().url(manifestUrl).cacheControl(CacheControl.FORCE_NETWORK).build()).execute()
                    .use { if (it.isSuccessful) it.body?.string() else null }
            }.getOrNull()
        } ?: return   // offline / server error: keep whatever we showed before
        val r = parseAppManifest(text)
        _state.value = _state.value.copy(release = r, kind = updateKind(r, installed, prefs.getInt(DISMISSED, 0)))
    }

    /** X on the banner: hidden until a newer versionCode is published. */
    fun dismiss() {
        val r = _state.value.release ?: return
        if (_state.value.kind != UpdateKind.BANNER) return
        prefs.edit().putInt(DISMISSED, r.versionCode).apply()
        _state.value = _state.value.copy(kind = UpdateKind.NONE)
    }

    /** Update pill: download (or reuse a finished download), then install. */
    suspend fun update() {
        val r = _state.value.release ?: return
        when (val d = _state.value.dl) {
            is Dl.Running -> return
            is Dl.Ready -> if (d.file.exists()) { install(d.file); return }
            else -> {}
        }
        val f = download(r) ?: return
        install(f)
    }

    /** Called on resume: the member may be back from the "install unknown apps" screen. */
    fun resumeInstall() {
        val d = _state.value.dl
        if (_state.value.needsPermission && d is Dl.Ready && canInstall()) install(d.file)
    }

    private fun resolve(url: String): String = manifestUrl.toHttpUrl().resolve(url)?.toString() ?: url

    internal suspend fun download(r: AndroidRelease): File? = withContext(Dispatchers.IO) {
        val dir = File(ctx.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }   // old versions and half downloads
        val out = File(dir, "tradezoro-${r.versionCode}.apk")
        _state.value = _state.value.copy(dl = Dl.Running(0, 0))
        val fail = { m: String -> out.delete(); _state.value = _state.value.copy(dl = Dl.Failed(m)); null }
        try {
            http.newCall(Request.Builder().url(resolve(r.url)).cacheControl(CacheControl.FORCE_NETWORK).build()).execute().use { res ->
                val body = res.body
                if (!res.isSuccessful || body == null) return@withContext fail("Download failed (${res.code}). Try again.")
                val total = body.contentLength()
                var done = 0L
                var lastEmit = 0L
                body.byteStream().use { input ->
                    out.outputStream().use { o ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf); if (n < 0) break
                            o.write(buf, 0, n); done += n
                            if (done - lastEmit > 128 * 1024) { lastEmit = done; _state.value = _state.value.copy(dl = Dl.Running(done, total)) }
                        }
                    }
                }
                if (total > 0 && out.length() != total) return@withContext fail("Download incomplete. Try again.")
                if (!looksLikeApk(out)) return@withContext fail("The download is not an app file. Try again later.")
                val info = runCatching { ctx.packageManager.getPackageArchiveInfo(out.path, 0) }.getOrNull()
                if (info != null && info.packageName != ctx.packageName) return@withContext fail("The download is not TradeZoro. Try again later.")
                _state.value = _state.value.copy(dl = Dl.Ready(out))
                out
            }
        } catch (e: Exception) {
            fail("Download failed. Check your connection and try again.")
        }
    }

    private fun canInstall() = Build.VERSION.SDK_INT < 26 || ctx.packageManager.canRequestPackageInstalls()

    private fun install(f: File) {
        if (!canInstall()) {
            _state.value = _state.value.copy(needsPermission = true)
            runCatching {
                ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            return
        }
        _state.value = _state.value.copy(needsPermission = false)
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", f)
        runCatching {
            ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
        }.onFailure { _state.value = _state.value.copy(dl = Dl.Failed("Could not open the installer.")) }
    }

    companion object {
        const val MANIFEST_URL = "https://tradezoro.com/app-version.json"
        const val HOUR = 60 * 60 * 1000L
        const val SIX_HOURS = 6 * HOUR
        private const val DISMISSED = "dismissed_code"
    }
}
