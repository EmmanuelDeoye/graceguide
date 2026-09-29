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

// Mirrors NotifCategory.fromServerType in the Android app, so a user who
// switched a category off in Settings → Notifications gets no push for it.
function channelForType(type) {
  switch (type) {
    case 'dm_message':
    case 'group_message': return 'messages';
    case 'space_amen':
    case 'space_comment': return 'community';
    case 'connection_request':
    case 'connection_accepted':
    case 'streak_milestone': return 'connections';
    case 'daily_reminder': return 'reading_reminders';
    case 'quiz_reminder': return 'quiz';
    case 'study_reminder': return 'study_planner';
    default: return 'announcements';
  }
}

function routeForNotification(notification) {
  if (notification.route && /^[a-z0-9\-\/]+$/i.test(notification.route)) {
    return `/#/${notification.route}`;
  }
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

/** FCM data values must all be strings. */
function stringData(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  });
  return out;
}

/** Sends, then returns the tokens FCM reports as dead. */
async function sendAndCollectDead(message, tokens) {
  if (tokens.length === 0) return [];
  const response = await admin.messaging().sendEachForMulticast({ ...message, tokens });
  const dead = [];
  response.responses.forEach((res, i) => {
    const code = res.error && res.error.code;
    if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

/** Splits users/{uid}/fcmTokens into Android (native app) and web tokens. */
function splitTokens(tokensObj) {
  const android = [];
  const web = [];
  Object.entries(tokensObj || {}).forEach(([token, meta]) => {
    if (meta && typeof meta === 'object' && meta.platform === 'android') android.push(token);
    else web.push(token);
  });
  return { android, web };
}

/**
 * Fires on every new entry under users/{uid}/notifications — i.e. every
 * time addNotification() runs client-side (connection sent/accepted,
 * Amen, comment, DM, group/forum message, streak milestone) or an admin
 * sends a broadcast. Delivers a real push to each of that user's devices.
 *
 * - Web tokens get a normal `notification` payload (shown by the browser /
 *   service worker, exactly as before).
 * - Android tokens get a high-priority DATA-only message, so the native
 *   app's GraceMessagingService runs even when the app has been swiped
 *   away, and applies the user's category toggles, quiet hours, chat
 *   grouping and de-duplication before showing it.
 */
exports.sendPushOnNotification = functions
  .region(REGION)
  .database.ref('/users/{uid}/notifications/{notifId}')
  .onCreate(async (snapshot, context) => {
    const { uid, notifId } = context.params;
    const notification = snapshot.val();
    if (!notification) return null;

    const [tokensSnap, prefsSnap] = await Promise.all([
      admin.database().ref(`/users/${uid}/fcmTokens`).once('value'),
      admin.database().ref(`/users/${uid}/notificationPrefs`).once('value')
    ]);
    const { android, web } = splitTokens(tokensSnap.val());
    if (android.length === 0 && web.length === 0) return null; // never enabled notifications

    // Respect the category switches the user set in the Android app.
    const prefs = prefsSnap.val() || {};
    if (prefs[channelForType(notification.type)] === false) return null;

    const title = notification.title || NOTIFICATION_TITLES[notification.type] || 'GraceGuide';
    const body = notification.message || 'You have a new notification';
    const url = routeForNotification(notification);

    const dead = [];
    dead.push(...await sendAndCollectDead({
      notification: { title, body },
      // Same tag as the admin page's direct push, so a browser shows it once.
      webpush: { notification: { tag: notifId } },
      data: stringData({ type: notification.type || '', fromUid: notification.fromUid || '', url })
    }, web));

    dead.push(...await sendAndCollectDead({
      data: stringData({
        notifKey: notifId,
        type: notification.type || 'admin_broadcast',
        title,
        body,
        route: url.replace(/^\/#\//, '').replace(/^\/$/, 'home'),
        fromUid: notification.fromUid,
        fromName: notification.fromName,
        postId: notification.postId,
        groupId: notification.groupId,
        conversationId: notification.conversationId,
        timestamp: notification.timestamp || Date.now()
      }),
      android: { priority: 'high', ttl: 24 * 60 * 60 * 1000 }
    }, android));

    // Prune tokens that are no longer valid (app uninstalled, token
    // expired, etc.) so future sends don't keep retrying dead devices.
    if (dead.length > 0) {
      const updates = {};
      dead.forEach((t) => { updates[`/users/${uid}/fcmTokens/${t}`] = null; });
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
      // Android devices schedule smarter reminders locally (they know what
      // you've read and when you're usually free), so only web gets this one.
      const tokens = splitTokens(userData.fcmTokens).web;
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
