package com.tradezoro.app.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tradezoro.app.BuildConfig
import com.tradezoro.app.MainActivity
import com.tradezoro.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * Phone push, the same path the website uses (assets/push.js + functions onNotificationCreated):
 * this device's FCM token is stored at pushTokens/{token} = {uid, token, userAgent, createdAt} (the rules' shape),
 * and every notifications doc for the member is pushed to it as a DATA-ONLY message {title, body, link, type, nid}.
 * Chart price alerts reach the phone this way when the server alert engine fires them.
 */
object PushTokens {
    private const val PREFS = "tz_push"
    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val ready get() = runCatching { FirebaseApp.getInstance() }.isSuccess

    /** Upserts this device's token for the signed-in member; drops this device's previous token doc on rotation. */
    suspend fun sync(c: Context, token: String? = null) {
        if (!ready) return
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        val t = token ?: FirebaseMessaging.getInstance().token.await()
        val db = FirebaseFirestore.getInstance()
        db.collection("pushTokens").document(t).set(mapOf(
            "uid" to uid, "token" to t,
            "userAgent" to "TradeZoro Android ${BuildConfig.VERSION_NAME} (API ${Build.VERSION.SDK_INT})",
            "createdAt" to FieldValue.serverTimestamp(),
        )).await()
        val prev = prefs(c).getString("token", null)
        prefs(c).edit { putString("token", t) }
        if (prev != null && prev != t) runCatching { db.collection("pushTokens").document(prev).delete().await() }
    }

    /** Before sign-out: this device stops getting the member's pushes. */
    suspend fun forget(c: Context) {
        if (!ready) return
        val t = prefs(c).getString("token", null) ?: return
        runCatching { FirebaseFirestore.getInstance().collection("pushTokens").document(t).delete().await() }
        prefs(c).edit { remove("token") }
    }

    fun canNotify(c: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}

/** Push type -> channel. Alert types (functions-src/pushRules.js ALERT_TYPES) get their own high-importance channel. */
fun channelFor(type: String?): String = if (type != null && (type.endsWith("_alert") || type == "test")) CH_ALERTS else CH_GENERAL

/** Same-origin path from the push's link ("/charts.html?symbol=NQ1!"), else null; never an outside URL. */
fun safeLink(link: String?): String? = link?.takeIf { it.startsWith("/") && !it.startsWith("//") && !it.contains('\\') }?.take(300)

const val CH_ALERTS = "alerts"
const val CH_GENERAL = "general"
const val EXTRA_LINK = "tz_link"

class TzMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // Fire-and-forget: a failed write is retried on the next app start (MainActivity syncs when signed in).
        if (FirebaseAuth.getInstance().currentUser == null) return
        CoroutineScope(Dispatchers.IO).launch { runCatching { PushTokens.sync(applicationContext, token) } }
    }

    override fun onMessageReceived(msg: RemoteMessage) {
        val d = msg.data
        val title = d["title"] ?: msg.notification?.title ?: "TradeZoro"
        val body = d["body"] ?: msg.notification?.body ?: return
        show(this, title, body, d["type"], safeLink(d["link"]), d["nid"])
    }

    companion object {
        fun ensureChannels(c: Context) {
            val nm = c.getSystemService(NotificationManager::class.java) ?: return
            nm.createNotificationChannel(NotificationChannel(CH_ALERTS, "Price alerts", NotificationManager.IMPORTANCE_HIGH).apply { description = "Your chart price alerts" })
            nm.createNotificationChannel(NotificationChannel(CH_GENERAL, "Account and community", NotificationManager.IMPORTANCE_DEFAULT))
        }

        fun show(c: Context, title: String, body: String, type: String?, link: String?, nid: String?) {
            if (!PushTokens.canNotify(c)) return
            ensureChannels(c)
            val open = Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP).putExtra(EXTRA_LINK, link)
            val id = (nid ?: "$title$body${System.currentTimeMillis()}").hashCode()
            val pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val n = NotificationCompat.Builder(c, channelFor(type))
                .setSmallIcon(R.drawable.ic_stat_tz)
                .setContentTitle(title).setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true).setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            try { NotificationManagerCompat.from(c).notify(id, n) } catch (_: SecurityException) { }
        }
    }
}
