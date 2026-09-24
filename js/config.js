/* ============================================
   ADULLAM — js/config.js
   Firebase + DeepSeek configuration, Firebase init.
   Load this file FIRST — everything else depends on it.
   ============================================ */

// Your web app's Firebase configuration (safe to expose — this is normal)
const firebaseConfig = {
  apiKey: "AIzaSyAYyIEAlJD8FgeE2bv73fWwKbpsDPuiB84",
  authDomain: "graceguide-8d9f5.firebaseapp.com",
  databaseURL: "https://graceguide-8d9f5-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "graceguide-8d9f5",
  storageBucket: "graceguide-8d9f5.firebasestorage.app",
  messagingSenderId: "859988308746",
  appId: "1:859988308746:web:f68879be9f0d967b9040f3",
  measurementId: "G-2QKQHE2TBW"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
const storage = firebase.storage();

// --- Secrets pulled from Realtime Database at /tokens ---
// These start undefined and are populated once loadSecrets() resolves.
// Any script that needs them must `await window.configReady` first.
let DEEPSEEK_API_KEY = null;
let DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"; // not secret, keep as const-like
let BIBLE_API_KEY = null;
let BIBLE_API_BASE = "https://api.scripture.api.bible/v1";
let BIBLE_VERSIONS = {
  KJV: "de4e12af7f28f599-02",
  NLT: "d6e14a625393b4da-01",
  MSG: "6f11a7de016f942e-01",
  AMP: "a81b73293d3080c9-01"
};
let FCM_VAPID_KEY = null;

async function loadSecrets() {
  try {
    const snap = await database.ref('tokens').once('value');
    const tokens = snap.val() || {};

    DEEPSEEK_API_KEY = tokens.deepseekApiKey || null;
    BIBLE_API_KEY = tokens.bibleApiKey || null;
    FCM_VAPID_KEY = tokens.fcmVapidKey || null;

    if (!DEEPSEEK_API_KEY) console.warn('DEEPSEEK_API_KEY missing from /tokens in Realtime Database.');
    if (!BIBLE_API_KEY) console.warn('BIBLE_API_KEY missing from /tokens in Realtime Database.');
    if (!FCM_VAPID_KEY) console.warn('FCM_VAPID_KEY missing from /tokens in Realtime Database.');
  } catch (e) {
    console.error('Failed to load secrets from /tokens:', e);
  }
}

// Other scripts can `await window.configReady` before using the keys above.
window.configReady = loadSecrets();

// Firebase Cloud Messaging — only in secure contexts that support service workers
let messaging = null;
if ('serviceWorker' in navigator && typeof firebase.messaging === 'function' && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
  try {
    messaging = firebase.messaging();
  } catch (e) {
    console.warn('Firebase Messaging could not be initialized:', e);
  }
}
