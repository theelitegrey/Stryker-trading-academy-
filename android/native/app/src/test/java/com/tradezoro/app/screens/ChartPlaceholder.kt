package com.tradezoro.app.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import com.tradezoro.app.ui.theme.Tz

/**
 * Stands in for the chart WebView in JVM screenshot tests (Robolectric has no WebView renderer).
 * Draws a real capture of tradezoro.com/charts with the app bridge applied when one is present
 * (src/test/resources/chart-capture-<dark|light>.png), else a plain labelled box.
 */
@Composable
fun ChartPlaceholder(modifier: Modifier) {
    val dark = MaterialTheme.colorScheme.background.red < 0.5f
    val bmp = ChartCaptures::class.java.classLoader?.getResourceAsStream("chart-capture-${if (dark) "dark" else "light"}.png")?.use {
        android.graphics.BitmapFactory.decodeStream(it)
    }
    if (bmp != null) Image(bmp.asImageBitmap(), contentDescription = "Chart", contentScale = ContentScale.Crop, alignment = Alignment.TopStart, modifier = modifier)
    else Box(modifier.background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
        Text("ZoroCharts (web view)", color = Tz.colors.muted)
    }
}
private object ChartCaptures
