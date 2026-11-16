package com.tradezoro.app.data

import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

sealed interface AlertsState {
    data object SignedOut : AlertsState
    data object Loading : AlertsState
    data class Ready(val alerts: List<PriceAlert>) : AlertsState
    data class Failed(val message: String) : AlertsState
}

/** The member's own chart price alerts (owner-only rules). Edits keep the rules' shape: only active + updatedAt change. */
class AlertsRepository {
    private val ok get() = runCatching { FirebaseApp.getInstance() }.isSuccess
    private fun col(uid: String) = FirebaseFirestore.getInstance().collection("students").document(uid).collection("chartAlerts")

    fun alerts(uid: String?): Flow<AlertsState> {
        if (uid == null || !ok) return flowOf(AlertsState.SignedOut)
        return callbackFlow {
            trySend(AlertsState.Loading)
            val reg = col(uid).addSnapshotListener { snap, err ->
                if (err != null) { trySend(AlertsState.Failed("Alerts could not load. Check your connection.")); return@addSnapshotListener }
                val list = snap?.documents.orEmpty().mapNotNull { d -> alertFrom(d.id, d.data.orEmpty()) }
                    .sortedWith(compareByDescending<PriceAlert> { it.active }.thenBy { it.ticker })
                trySend(AlertsState.Ready(list))
            }
            awaitClose { reg.remove() }
        }
    }

    suspend fun setActive(id: String, active: Boolean) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        col(uid).document(id).update(mapOf("active" to active, "updatedAt" to FieldValue.serverTimestamp())).await()
    }

    /** The site's "Send test notification" (assets/push.js): a self-addressed type 'test' doc; the server caps it at 3/hour. */
    suspend fun sendTest() {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        FirebaseFirestore.getInstance().collection("notifications").add(mapOf(
            "recipientUid" to uid, "senderUid" to uid, "type" to "test", "read" to false, "link" to "settings.html",
            "message" to "Test notification. If you can see this, TradeZoro alerts reach this device.",
            "createdAt" to FieldValue.serverTimestamp(),
        )).await()
    }

    suspend fun delete(id: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        col(uid).document(id).delete().await()
    }
}
