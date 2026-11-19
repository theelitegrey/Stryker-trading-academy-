package com.tradezoro.app.data

import org.robolectric.RuntimeEnvironment
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppUpdateTest {
    // Same shape as the site's /app-version.json (docs/app-updates.md); the windows half is ignored here.
    private val manifest = """{"android":{"versionCode":11,"versionName":"2.2.0","url":"/downloads/tradezoro-android-beta.apk",
        "notes":["Faster charts","Fixes"],"minVersionCode":8},"windows":{"version":"1.1.0","url":"x","notes":[],"minVersion":"1.0.0"},"extra":1}"""

    @Test fun parse() {
        val r = parseAppManifest(manifest)!!
        assertEquals(11, r.versionCode); assertEquals("2.2.0", r.versionName); assertEquals(listOf("Faster charts", "Fixes"), r.notes); assertEquals(8, r.minVersionCode)
        assertNull(parseAppManifest("not json"))
        assertNull(parseAppManifest("""{"windows":{"version":"1.1.0"}}"""))
        assertNull(parseAppManifest("""{"android":{"versionCode":0}}"""))
        assertEquals(0, parseAppManifest("""{"android":{"versionCode":12,"url":"/a.apk"}}""")!!.minVersionCode)
    }

    @Test fun compare() {
        val r = AndroidRelease(11, "2.2.0", "/a.apk", minVersionCode = 8)
        assertEquals(UpdateKind.BANNER, updateKind(r, installed = 10, dismissed = 0))
        assertEquals(UpdateKind.NONE, updateKind(r, installed = 11, dismissed = 0))
        assertEquals(UpdateKind.NONE, updateKind(r, installed = 12, dismissed = 0))
        assertEquals(UpdateKind.NONE, updateKind(r, installed = 10, dismissed = 11))      // X on this version
        assertEquals(UpdateKind.BANNER, updateKind(r.copy(versionCode = 12), 10, 11))     // a newer one shows again
        assertEquals(UpdateKind.BLOCKING, updateKind(r, installed = 7, dismissed = 11))   // below min: no way out
        assertEquals(UpdateKind.NONE, updateKind(r.copy(url = ""), 7, 0))
        assertEquals(UpdateKind.NONE, updateKind(null, 7, 0))
    }

    @Test fun checkDismissAndDownload() = runBlocking {
        val apk = Buffer().write(byteArrayOf(0x50, 0x4B, 3, 4) + ByteArray(300_000) { 7 })
        MockWebServer().use { srv ->
            srv.enqueue(MockResponse().setBody(manifest))
            srv.enqueue(MockResponse().setBody(apk))
            srv.enqueue(MockResponse().setBody("<html>not an apk</html>"))
            val u = AppUpdater(RuntimeEnvironment.getApplication(), installed = 10, manifestUrl = srv.url("/app-version.json").toString())
            u.check()
            assertEquals(UpdateKind.BANNER, u.state.value.kind)
            val r = u.state.value.release!!
            srv.takeRequest()
            val f = u.download(r)!!
            assertEquals("/downloads/tradezoro-android-beta.apk", srv.takeRequest().path)   // relative url resolved against the manifest
            assertEquals(300_004L, f.length()); assertTrue(looksLikeApk(f))
            assertTrue(u.state.value.dl is Dl.Ready)
            assertNull(u.download(r))                                                      // HTML instead of an APK is refused
            assertTrue(u.state.value.dl is Dl.Failed)
            u.dismiss()
            assertEquals(UpdateKind.NONE, u.state.value.kind)
            u.check(AppUpdater.HOUR)                                                      // within the hour: no request
            assertEquals(3, srv.requestCount)
        }
        // Dismissed version is remembered across restarts.
        MockWebServer().use { srv ->
            srv.enqueue(MockResponse().setBody(manifest))
            val u = AppUpdater(RuntimeEnvironment.getApplication(), installed = 10, manifestUrl = srv.url("/app-version.json").toString())
            u.check(); assertEquals(UpdateKind.NONE, u.state.value.kind)
        }
    }
}
