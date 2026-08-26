/**
 * Stryker Trading Academy — contact form notifier
 *
 * Firestore trigger on contactMessages/{id}. Creates a notification for every
 * admin, which onNotificationCreated then turns into a push.
 *
 * DEPLOY from the delete-user-function project, which already holds
 * onNotificationCreated:
 *   firebase deploy --only functions:deleteUserAccount,
 *     functions:onNotificationCreated,functions:onContactMessageCreated
 *
 * WHY THIS RUNS SERVER-SIDE.
 * Every other notification in the product is written by the client that caused
 * it. This one cannot be: the contact form accepts anonymous visitors, and
 * notifications/{id} requires an authenticated, verified, non-banned author.
 * A logged-out visitor has no permission to notify anyone. Letting them would
 * mean opening notification writes to the world, which is an obvious spam
 * vector — anyone could push arbitrary text to every admin's phone.
 *
 * So the write happens with the Admin SDK, which bypasses rules, triggered by
 * a document the visitor IS allowed to create.
 *
 * WHY IT CHAINS RATHER THAN PUSHING DIRECTLY.
 * It would be simpler to send an FCM message here. Writing a notification doc
 * instead means the message also appears in the in-app bell, is marked read
 * with everything else, and survives a device that has push disabled. One
 * pipeline, one place to change how notifications behave.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

/** Trim for a notification line without cutting mid-word. */
function preview(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}

exports.onContactMessageCreated = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .firestore.document('contactMessages/{messageId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data() || {};
    const db = admin.firestore();

    const adminsSnap = await db.collection('admins').get();
    if (adminsSnap.empty) {
      // Not an error: a project with no admins is a valid, if unusual, state.
      // Logged rather than thrown, because throwing would retry forever.
      console.log('onContactMessageCreated: no admins to notify');
      return null;
    }

    const from = (msg.name || '').trim() || msg.email || 'Someone';
    // The message body goes in the notification text on purpose. An admin
    // reading "New contact message" on a phone has to open the panel to learn
    // whether it is urgent; a preview lets them judge without leaving the
    // lock screen.
    const body = preview(msg.message, 90);
    const text = `${preview(from, 40)}: ${body}`;

    const batch = db.batch();
    adminsSnap.forEach((doc) => {
      const ref = db.collection('notifications').doc();
      batch.set(ref, {
        recipientUid: doc.id,
        type: 'contact',
        message: text,
        // pages-admin.html is where contact messages are listed. Verified
        // against the actual markup rather than assumed — the first version of
        // this pointed at contact-admin.html, which does not exist, so every
        // notification would have been a dead link.
        link: 'pages-admin.html#contact-' + context.params.messageId,
        read: false,
        // Lets the admin panel jump straight to the message rather than
        // making someone scan a list for it.
        contactMessageId: context.params.messageId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    // One batch, so either every admin is notified or none is. Notifying a
    // subset would mean whoever checks first assumes it is handled while the
    // others never saw it.
    await batch.commit();

    console.log(`onContactMessageCreated: notified ${adminsSnap.size} admin(s)`);
    return null;
  });
