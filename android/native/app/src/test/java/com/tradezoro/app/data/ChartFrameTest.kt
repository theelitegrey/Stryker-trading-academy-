package com.tradezoro.app.data

import com.tradezoro.app.ui.chart.ChartViewport
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** M5: the frame protocol (real frames captured from tradezoro.com/charts with the bridge) and the viewport maths. */
class ChartFrameTest {
    private fun res(name: String) = javaClass.classLoader!!.getResource(name)!!.readText()

    @Test fun fullFrameParses() {
        val st = FrameStore()
        assertTrue(st.needFull)
        val d = st.apply(res("frame-btc.json"))!!
        assertFalse(st.needFull)
        assertEquals(2000, d.n)
        assertEquals("binance:BTCUSDT", d.sym)
        assertEquals("15", d.tf)
        assertEquals(2, d.decimals)
        assertTrue(d.volume)
        // ema, vwap, bb, fractal, rsi, macd and a Pine script with bgcolor/line/box/label/table
        assertEquals(7, d.models.size)
        val ema = d.models.first { it.title.startsWith("Exponential") }
        assertEquals(2000, ema.series[0].values.size)
        assertTrue(ema.inPrice)
        val rsi = d.models.first { it.title.startsWith("Relative Strength") }
        assertFalse(rsi.inPrice)
        assertEquals(3, rsi.fills.size)
        assertEquals(3, rsi.priceLines.size)
        assertTrue(rsi.series.drop(1).all { it.hidden })        // the transparent anchor series stay hidden
        val macd = d.models.first { it.title == "MACD" }
        assertEquals("columns", macd.series[0].kind)
        assertNotNull(macd.series[0].colors)                    // per-bar histogram colours
        val fr = d.models.first { it.title == "Williams Fractal" }
        assertTrue(fr.series[0].markers.isNotEmpty())
        assertTrue(fr.series[0].markers.all { it.i in 0 until 2000 })
        val pine = d.models.first { it.title == "Zones" }
        assertTrue(pine.backgrounds.isNotEmpty())
        assertEquals(1, pine.lines.size); assertEquals("right", pine.lines[0].extend)
        assertEquals(1, pine.boxes.size); assertEquals("Range", pine.boxes[0].text)
        assertEquals("Swing high", pine.labels[0].text)
        assertTrue(pine.tables.isNotEmpty())
        assertEquals(2, d.drawings.size)
        assertEquals("trendline", d.drawings[0].type)
        // bars are sane
        for (i in 0 until d.n) assertTrue(d.bars.h[i] >= d.bars.l[i])
        for (i in 1 until d.n) assertTrue(d.bars.t[i] > d.bars.t[i - 1])
    }

    @Test fun tailFramePatchesOnlyTheEnd() {
        val st = FrameStore()
        val d0 = st.apply(res("frame-btc.json"))!!
        val d1 = st.apply(res("frame-btc-tail.json"))!!
        assertEquals(d0.n, d1.n)
        assertEquals(d0.bars.c[100], d1.bars.c[100], 0.0)
        assertEquals(64409.21, d1.bars.c[1999], 1e-9)
        val e0 = d0.models[0].series[0].values; val e1 = d1.models[0].series[0].values
        assertEquals(e0[1000], e1[1000], 0.0)
        assertEquals(64569.56704, e1[1999], 1e-6)
        // object lists not in the tail are kept
        val p0 = d0.models.first { it.title == "Zones" }; val p1 = d1.models.first { it.title == "Zones" }
        assertSame(p0.boxes, p1.boxes)
        assertSame(d0.drawings, d1.drawings)
    }

    @Test fun tailWithoutBaseAsksForFull() {
        val st = FrameStore()
        assertEquals(null, st.apply(res("frame-btc-tail.json")))
        assertTrue(st.needFull)
        st.apply(res("frame-btc.json"))
        assertFalse(st.needFull)
        // a tail for another symbol/key is refused too
        val other = res("frame-btc-tail.json").replace("binance:BTCUSDT|15", "binance:ETHUSDT|15")
        val before = st.data
        assertSame(before, st.apply(other))
        assertTrue(st.needFull)
    }

    @Test fun badInputIsIgnored() {
        val st = FrameStore()
        assertEquals(null, st.apply("not json"))
        assertEquals(null, st.apply("""{"t":"frame","ready":false,"modal":true}"""))
        assertTrue(st.modal)
    }

    @Test fun colours() {
        assertEquals(0xFF5B9CF6.toInt(), ChartColors.parse("#5b9cf6"))
        assertEquals(0x14F23645, ChartColors.parse("#f2364514"))
        assertEquals(0xFFFFFFFF.toInt(), ChartColors.parse("#fff"))
        assertEquals(0x80FF0000.toInt(), ChartColors.parse("rgba(255, 0, 0, 0.5)"))
        assertEquals(0xFF0A0B0C.toInt(), ChartColors.parse("rgb(10,11,12)"))
        assertEquals(0, ChartColors.parse(null)); assertEquals(0, ChartColors.parse("bogus"))
    }

    @Test fun barTimeIndexRoundTrip() {
        val b = Bars(3, longArrayOf(0, 60_000, 120_000), DoubleArray(3), DoubleArray(3), DoubleArray(3), DoubleArray(3), DoubleArray(3))
        assertEquals(1.5, b.indexOf(90_000), 1e-9)
        assertEquals(4.0, b.indexOf(240_000), 1e-9)          // past the last bar
        assertEquals(240_000L, b.timeAt(4.0))
        assertEquals(90_000L, b.timeAt(1.5))
    }

    @Test fun viewportZoomKeepsTheBarUnderTheFingerAndClamps() {
        val st = FrameStore(); val d = st.apply(res("frame-btc.json"))!!
        val vp = ChartViewport(); vp.plotW = 1000f
        vp.onData(d, 10f)
        assertEquals(1999 + ChartViewport.RIGHT_MARGIN, vp.right, 1e-9)
        val x = 400f
        val before = vp.right - (vp.plotW - x) / vp.spacing
        vp.minSpacing = 2f; vp.maxSpacing = 60f
        vp.zoom(2f, x)
        val after = vp.right - (vp.plotW - x) / vp.spacing
        assertEquals(before, after, 1e-6)
        assertEquals(20f, vp.spacing, 0f)
        vp.zoom(100f, x); assertEquals(60f, vp.spacing, 0f)    // max
        vp.pan(-1e7f); assertTrue(vp.right <= 1999 + vp.plotW / vp.spacing * 0.5 + 1e-9)   // cannot run off the live edge
        vp.pan(1e7f); assertTrue(vp.right >= 4.0 - 1e-9)       // nor past the first bar
        vp.live(); assertEquals(1999 + ChartViewport.RIGHT_MARGIN, vp.right, 1e-9)
    }

    @Test fun newBarFollowsTheLiveEdgeButNotWhenScrolledBack() {
        val st = FrameStore(); val d = st.apply(res("frame-btc.json"))!!
        val vp = ChartViewport(); vp.plotW = 1000f; vp.onData(d, 10f)
        val grown = ChartData(d.key + "x", d.sym, d.tf, d.tz, d.tick, Bars(d.n + 1, d.bars.t + (d.bars.t.last() + 900_000), d.bars.o + 1.0, d.bars.h + 1.0, d.bars.l + 1.0, d.bars.c + 1.0, d.bars.v + 1.0), d.volume, d.models, d.drawings)
        val r0 = vp.right; vp.onData(grown, 10f); assertEquals(r0 + 1, vp.right, 1e-9)
        vp.pan(3000f); val r1 = vp.right
        val grown2 = ChartData(d.key + "y", d.sym, d.tf, d.tz, d.tick, Bars(grown.n + 1, grown.bars.t + (grown.bars.t.last() + 900_000), grown.bars.o + 1.0, grown.bars.h + 1.0, grown.bars.l + 1.0, grown.bars.c + 1.0, grown.bars.v + 1.0), d.volume, d.models, d.drawings)
        vp.onData(grown2, 10f); assertEquals(r1, vp.right, 1e-9)
    }
}
