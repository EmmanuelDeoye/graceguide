/* ============================================
   ADULLAM — js/config.js
   Firebase + DeepSeek configuration, Firebase init.
   Load this file FIRST — everything else depends on it.
   ============================================ */

// Firebase Configuration
// Import the functions you need from the SDKs you need

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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


// DeepSeek AI Configuration
// ⚠️ REPLACE WITH YOUR DEEPSEEK API KEY
const DEEPSEEK_API_KEY = "sk-836241f5b4e749f097e2f09ca7f4a152";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";


// Shepherd Voice (Text-to-Speech) Configuration
// Uses the browser's built-in, free Web Speech API (SpeechSynthesis) — no
// API key or paid service required. Voice quality depends on the device,
// but every modern browser ships at least one male and one female voice.

// Bible API (scripture.api.bible) Configuration
const BIBLE_API_KEY = "-In0fpKKWPFAQj_Kjidnv";
const BIBLE_API_BASE = "https://api.scripture.api.bible/v1";
// Bible IDs on api.bible for the supported translations
const BIBLE_VERSIONS = {
  KJV: "de4e12af7f28f599-02",
  NLT: "d6e14a625393b4da-01",
  MSG: "6f11a7de016f942e-01",
  AMP: "a81b73293d3080c9-01"
};

// Firebase Cloud Messaging (push notifications) Configuration
// ⚠️ REPLACE WITH YOUR OWN VAPID KEY — Firebase Console → Project settings
// → Cloud Messaging → Web configuration → "Web Push certificates" → Generate
// key pair. Without a real key, getToken() will fail and the "Enable
// Notifications" button will show an error explaining this.
const FCM_VAPID_KEY = "BBhcDhI3cU0DhE-KyF5jUEwjPLwyOoHMMrb2R--VJjkdsc0fW7hdnYzAnpD6GzJNlJO5EDrZpjFK-khTTlTqOeI";

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
const storage = firebase.storage();

// Firebase Cloud Messaging — only available in secure (https/localhost)
// contexts that support service workers. Guarded so the app never breaks
// on browsers/environments (or non-https previews) that lack support.
let messaging = null;
if ('serviceWorker' in navigator && typeof firebase.messaging === 'function' && firebase.messaging.isSupported && firebase.messaging.isSupported()) {
  try {
    messaging = firebase.messaging();
  } catch (e) {
    console.warn('Firebase Messaging could not be initialized:', e);
  }
}
