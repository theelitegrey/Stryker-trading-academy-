package com.tradezoro.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import com.tradezoro.app.data.FrameStore
import com.tradezoro.app.ui.chart.ChartPainter
import com.tradezoro.app.ui.chart.ChartPalette
import com.tradezoro.app.ui.chart.ChartViewport
import com.tradezoro.app.ui.chart.PriceStyle
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * M5 budget: the painter must not allocate per frame in steady state (pan/crosshair redraws) and must stay well inside
 * a 16 ms frame. Measured on the JVM with the real BTC frame (bars + every indicator the site sent). The JVM numbers
 * are a guard against regressions, not a phone benchmark.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ChartPainterPerfTest {
    @Test fun steadyStateFramesAreCheapAndAllocationFree() {
        val frame = FrameStore().apply(javaClass.classLoader!!.getResource("frame-btc.json")!!.readText())!!
        val w = 1236; val h = 1800
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); val cv = Canvas(bmp)
        val painter = ChartPainter(3f, 1f)
        val pal = ChartPalette(0xFF0A0A0B.toInt(), 0xFF1C1C1F.toInt(), 0xFF8E8E93.toInt(), 0xFF03C988.toInt(), 0xFFFF4D5E.toInt(),
            0xFF9AA0AD.toInt(), 0xFFECECEE.toInt(), 0xFF0A0A0B.toInt(), 0xFFFFFFFF.toInt())
        val vp = ChartViewport().apply { onData(frame, 21f); crossX = 600f; crossY = 700f }
        // Warm up: fills the label caches for every price/time this pan range shows (a real chart does it on first show).
        repeat(3) { for (k in 0 until 60) { vp.pan(if (k < 30) 4f else -4f); painter.draw(cv, w.toFloat(), h.toFloat(), frame, vp, PriceStyle.CANDLES, pal) } }
        // java.lang.management is not on the Android compile classpath; the test JVM has it, so reach it by reflection.
        val mx = Class.forName("java.lang.management.ManagementFactory").getMethod("getThreadMXBean").invoke(null)!!
        val allocM = Class.forName("com.sun.management.ThreadMXBean").getMethod("getThreadAllocatedBytes", Long::class.javaPrimitiveType)
        val tid = Thread.currentThread().id
        fun alloc() = allocM.invoke(mx, tid) as Long
        val frames = 120
        val a0 = alloc(); val t0 = System.nanoTime()
        for (k in 0 until frames) { vp.pan(if (k % 60 < 30) 4f else -4f); painter.draw(cv, w.toFloat(), h.toFloat(), frame, vp, PriceStyle.CANDLES, pal) }
        val ms = (System.nanoTime() - t0) / 1e6 / frames
        val bytes = (alloc() - a0) / frames
        File("build/m5-perf.txt").writeText("frames=$frames bars=${frame.n} avg_ms=%.2f alloc_bytes_per_frame=$bytes\n".format(ms))
        // Robolectric's native-canvas shim itself allocates a little per draw call; the painter's own code must not
        // add per-bar garbage. 64 KB/frame is far below one per-bar allocation over ~180 visible bars x indicators.
        assertTrue("allocates $bytes bytes per frame", bytes < 64 * 1024)
        assertTrue("avg $ms ms per frame", ms < 16.0)
    }
}
