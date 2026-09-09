/* ============================================
   GraceGuide — functions/index.js

   Why this exists: the client can request notification permission and
   save its own FCM token, but it can NOT securely send a push message —
   that requires the Firebase Admin SDK and service-account credentials,
   which must never live in browser code. This is the (small) server
   side that actually delivers the notifications the app asks for:

   1. sendPushOnNotification — fires automatically every time the app
      writes to users/{uid}/notifications/{id} (which it already does
      for connection requests/accepts, "Amen"s, comments, DMs, and group
      messages — see addNotification() in js/community.js). Reads that
      user's saved FCM tokens and pushes to every device they're signed
      into.

   2. dailyReadingReminder — a scheduled job that nudges anyone who
      hasn't read anything yet today, to protect their streak.

   Deploy with the Firebase CLI (requires the Blaze/pay-as-you-go plan,
   since scheduled functions and outbound network calls aren't available
   on the free Spark plan):

       npm install -g firebase-tools
       firebase login
       firebase init functions   (choose this existing functions/ folder)
       cd functions && npm install
       firebase deploy --only functions
   ============================================ */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

// Match your Realtime Database's region (see databaseURL in js/config.js).
const REGION = 'europe-west1';

const NOTIFICATION_TITLES = {
  connection_request: 'New Connection Request',
  connection_accepted: 'Connection Accepted 🤝',
  streak_milestone: 'Streak Milestone 🔥',
  space_amen: 'Someone said Amen 🙏',
  space_comment: 'New Comment',
  dm_message: 'New Message',
  group_message: 'New Group Message',
  daily_reminder: 'Time to read 📖',
  admin_broadcast: 'GraceGuide'
};

function routeForNotification(notification) {
  switch (notification.type) {
    case 'connection_request':
    case 'connection_accepted':
      return '/#/profile';
    case 'space_amen':
    case 'space_comment':
      return notification.postId ? `/#/space/${notification.postId}` : '/#/space';
    case 'dm_message':
      return notification.conversationId ? `/#/chats/${notification.conversationId}` : '/#/chats';
    case 'group_message':
      return notification.groupId ? `/#/groups/${notification.groupId}` : '/#/community';
    case 'admin_broadcast':
      return '/#/home';
    default:
      return '/';
  }
}

/**
 * Fires on every new entry under users/{uid}/notifications — i.e. every
 * time addNotification() runs client-side (connection sent/accepted,
 * Amen, comment, DM, group/forum message, streak milestone). Delivers a
 * real push to each of that user's registered devices.
 */
exports.sendPushOnNotification = functions
  .region(REGION)
  .database.ref('/users/{uid}/notifications/{notifId}')
  .onCreate(async (snapshot, context) => {
    const { uid } = context.params;
    const notification = snapshot.val();
    if (!notification) return null;

    const tokensSnap = await admin.database().ref(`/users/${uid}/fcmTokens`).once('value');
    const tokensObj = tokensSnap.val();
    if (!tokensObj) return null; // user has never enabled notifications

    const tokens = Object.keys(tokensObj);
    if (tokens.length === 0) return null;

    const title = NOTIFICATION_TITLES[notification.type] || 'GraceGuide';
    const body = notification.message || 'You have a new notification';

    const response = await admin.messaging().sendEachForMulticast({
      notification: { title, body },
      data: {
        type: notification.type || '',
        fromUid: notification.fromUid || '',
        url: routeForNotification(notification)
      },
      tokens
    });

    // Prune tokens that are no longer valid (app uninstalled, token
    // expired, etc.) so future sends don't keep retrying dead devices.
    const deadTokens = [];
    response.responses.forEach((res, i) => {
      const code = res.error && res.error.code;
      if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
        deadTokens.push(tokens[i]);
      }
    });
    if (deadTokens.length > 0) {
      const updates = {};
      deadTokens.forEach((t) => { updates[`/users/${uid}/fcmTokens/${t}`] = null; });
      await admin.database().ref().update(updates);
    }

    return null;
  });

/**
 * Runs once a day. Anyone with notifications enabled who hasn't logged
 * any Bible reading yet today gets a gentle nudge so they don't lose
 * their streak. Adjust the cron schedule/timeZone to taste.
 */
exports.dailyReadingReminder = functions
  .region(REGION)
  .pubsub.schedule('0 19 * * *') // 7:00 PM daily
  .timeZone('UTC')
  .onRun(async () => {
    const usersSnap = await admin.database().ref('/users').once('value');
    const users = usersSnap.val() || {};
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const sends = Object.entries(users).map(async ([uid, userData]) => {
      const tokens = userData.fcmTokens ? Object.keys(userData.fcmTokens) : [];
      if (tokens.length === 0) return;

      const history = Array.isArray(userData.readingHistory) ? userData.readingHistory : [];
      const readToday = history.some((entry) => {
        if (!entry || !entry.timestamp) return false;
        return new Date(entry.timestamp).toISOString().slice(0, 10) === todayKey;
      });
      if (readToday) return;

      try {
        await admin.messaging().sendEachForMulticast({
          notification: {
            title: "Don't lose your streak 🔥",
            body: "You haven't opened the Word today — a few verses keeps it alive."
          },
          data: { type: 'daily_reminder', url: '/#/bible' },
          tokens
        });
      } catch (e) {
        console.error(`Failed to send daily reminder to ${uid}:`, e);
      }
    });

    await Promise.all(sends);
    return null;
  });
