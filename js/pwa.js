/* ============================================
   GraceGuide — js/pwa.js
   Load LAST — depends on config.js (messaging, database, auth),
   core.js (AppState, showToast, showModal, $) and the drawer's
   #drawer-install-btn element.

   Handles:
   - Registering sw.js (app shell / offline caching)
   - Registering firebase-messaging-sw.js (push, its own scope so it
     doesn't collide with sw.js)
   - The one-tap "Install App" button in the drawer
   - Requesting notification permission + saving the FCM token
   - Foreground push messages (toast) 
   ============================================ */

/* ============================================
   SERVICE WORKER REGISTRATION
   ============================================ */
let fcmServiceWorkerRegistration = null;

async function registerServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;

    try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch (e) {
        console.warn('App service worker registration failed:', e);
    }

    // Registered at its own scope specifically so it can coexist with
    // sw.js above — otherwise the two would fight over which one
    // controls the page, and push events could silently stop firing.
    try {
        fcmServiceWorkerRegistration = await navigator.serviceWorker.register(
            '/firebase-messaging-sw.js',
            { scope: '/firebase-cloud-messaging-push-scope' }
        );
    } catch (e) {
        console.warn('FCM service worker registration failed:', e);
    }
}

/* ============================================
   INSTALL PROMPT
   ============================================ */
let deferredInstallPrompt = null;

function isRunningStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true; // iOS Safari
}

function isIOSDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function updateInstallButtonVisibility() {
    const btn = document.getElementById('drawer-install-btn');
    if (!btn) return;

    if (isRunningStandalone()) {
        btn.classList.add('hidden');
        return;
    }

    // Chrome/Edge/Android fired beforeinstallprompt — we can install
    // with a single tap. iOS never fires that event but still supports
    // "Add to Home Screen" manually, so we still surface the button
    // there and show instructions instead of a native prompt.
    if (deferredInstallPrompt || isIOSDevice()) {
        btn.classList.remove('hidden');
    } else {
        btn.classList.add('hidden');
    }
}

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtonVisibility();
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtonVisibility();
    showToast('GraceGuide installed! You can now open it like any other app.', 'success');
});

async function handleInstallButtonClick() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        updateInstallButtonVisibility();
        if (outcome !== 'accepted') {
            showToast('You can install GraceGuide any time from this menu.', 'info');
        }
        return;
    }

    if (isIOSDevice()) {
        showIOSInstallInstructions();
        return;
    }

    showToast("Your browser doesn't support one-tap install — look for \"Add to Home Screen\" in your browser menu.", 'info');
}

function showIOSInstallInstructions() {
    showModal(`
        <h3 style="margin-bottom: 16px;">Install GraceGuide</h3>
        <p style="margin-bottom: 12px; line-height: 1.6;">iOS doesn't allow apps to trigger installation directly, but it only takes a few taps:</p>
        <ol style="padding-left: 20px; line-height: 2;">
            <li>Tap the <i class="fas fa-arrow-up-from-bracket"></i> Share icon in Safari's toolbar</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
            <li>Tap <strong>Add</strong> in the top right</li>
        </ol>
        <button class="btn btn-primary btn-block mt-3" onclick="closeModal()">Got it</button>
    `);
}

/* ============================================
   FCM — PUSH NOTIFICATIONS
   ============================================ */

/**
 * Requests notification permission, gets this device's FCM token, and
 * saves it to the Realtime Database under the signed-in user so server
 * side logic (see functions/index.js) can deliver push notifications
 * to every device the user is signed into.
 */
async function enableNotifications() {
    if (!requireAuth('Sign in to enable notifications.')) return;

    if (!('Notification' in window)) {
        showToast("This browser doesn't support notifications.", 'warning');
        return;
    }

    if (!messaging) {
        showToast("Push notifications aren't supported in this browser/context.", 'warning');
        return;
    }

    if (FCM_VAPID_KEY === 'REPLACE_WITH_YOUR_VAPID_KEY') {
        showToast('Notifications are not fully configured yet (missing VAPID key). Contact the site owner.', 'warning');
        return;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('Notification permission was not granted.', 'warning');
            return;
        }

        if (!fcmServiceWorkerRegistration) {
            fcmServiceWorkerRegistration = await navigator.serviceWorker.register(
                '/firebase-messaging-sw.js',
                { scope: '/firebase-cloud-messaging-push-scope' }
            );
        }

        const token = await messaging.getToken({
            vapidKey: FCM_VAPID_KEY,
            serviceWorkerRegistration: fcmServiceWorkerRegistration
        });

        if (!token) {
            showToast('Could not generate a notification token. Please try again.', 'error');
            return;
        }

        const uid = AppState.currentUser.uid;
        // Keyed by token (not pushed) so re-enabling on the same device
        // updates the same entry rather than creating duplicates — and
        // multiple devices per user are all kept, each getting notified.
        await database.ref(`users/${uid}/fcmTokens/${token}`).set({
            createdAt: Date.now(),
            userAgent: navigator.userAgent
        });

        localStorage.setItem('graceguide_notifications_enabled', 'true');
        showToast('Notifications enabled! 🔔', 'success');
        refreshNotificationSettingsUI();
    } catch (error) {
        console.error('Error enabling notifications:', error);
        showToast('Failed to enable notifications. Please try again.', 'error');
    }
}

/** Lets the settings page reflect whether push is currently enabled. */
function refreshNotificationSettingsUI() {
    const btn = document.getElementById('enable-notifications-btn');
    if (!btn) return;
    const enabled = Notification.permission === 'granted' && localStorage.getItem('graceguide_notifications_enabled') === 'true';
    btn.innerHTML = enabled
        ? '<i class="fas fa-bell"></i> Notifications Enabled'
        : '<i class="fas fa-bell"></i> Enable Notifications';
    btn.disabled = enabled;
    btn.classList.toggle('btn-outline', !enabled);
    btn.classList.toggle('btn-primary', enabled);
}

/**
 * FCM only auto-shows a system notification for messages that arrive
 * while the app is backgrounded/closed (handled by
 * firebase-messaging-sw.js). While the tab is open and focused, "silent"
 * foreground delivery used to mean the only sign anything happened was
 * an in-app toast — invisible if the person wasn't looking at the tab,
 * and gone as soon as they were. Now foreground pushes ALSO raise a
 * real OS notification (so it lands in the system notification panel
 * exactly like a backgrounded one would), in addition to the in-app
 * toast and live badge refresh.
 */
/**
 * Foreground pushes render as a proper in-app popup banner (not a toast,
 * not an OS notification) — the person specifically wants foreground
 * delivery to feel like part of the app rather than a system-level
 * interruption. Backgrounded/closed-tab delivery is unaffected and still
 * shows a real OS notification via firebase-messaging-sw.js, since
 * there's no "in-app" to show it in at that point.
 */
function initForegroundMessageHandler() {
    if (!messaging) return;
    messaging.onMessage((payload) => {
        const title = payload?.notification?.title || 'GraceGuide';
        const body = payload?.notification?.body || '';
        const data = payload?.data || {};

        showInAppNotificationPopup(title, body, data);

        if (typeof AppState !== 'undefined' && AppState.currentUser && typeof loadNotifications === 'function') {
            loadNotifications();
        }
    });
}

/**
 * A slide-down in-app banner for foreground push notifications. Fully
 * self-contained (own DOM node appended to <body>, own styles inline so
 * it doesn't depend on css load order) — tapping it navigates using the
 * payload's data.url, same as tapping a background/system notification
 * would via firebase-messaging-sw.js's notificationclick handler.
 */
function showInAppNotificationPopup(title, body, data = {}) {
    document.getElementById('in-app-notif-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'in-app-notif-popup';
    popup.className = 'in-app-notif-popup';
    popup.innerHTML = `
        <div class="in-app-notif-icon"><i class="fas fa-dove"></i></div>
        <div class="in-app-notif-body">
            <div class="in-app-notif-title">${escapeHtml(title)}</div>
            ${body ? `<div class="in-app-notif-text">${escapeHtml(body)}</div>` : ''}
        </div>
        <button class="in-app-notif-close" aria-label="Dismiss"><i class="fas fa-xmark"></i></button>
    `;
    document.body.appendChild(popup);

    requestAnimationFrame(() => popup.classList.add('in-app-notif-popup-visible'));

    const dismiss = () => {
        popup.classList.remove('in-app-notif-popup-visible');
        setTimeout(() => popup.remove(), 250);
    };

    const autoDismissTimer = setTimeout(dismiss, 6000);

    popup.querySelector('.in-app-notif-close').addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(autoDismissTimer);
        dismiss();
    });

    popup.addEventListener('click', () => {
        clearTimeout(autoDismissTimer);
        dismiss();
        if (data.url && typeof navigateTo === 'function') {
            navigateTo(data.url.replace('/#/', '').replace(/^\//, '') || 'home');
        }
    });
}

// Tapping a background notification (handled in firebase-messaging-sw.js)
// posts a message back to whichever tab it focused/opened so we can
// route straight to the relevant screen instead of just landing on Home.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'notification-click' && event.data.url) {
            const route = event.data.url.replace('/#/', '').replace(/^\//, '') || 'home';
            navigateTo(route);
        }
    });
}

/* ============================================
   FIRST-OPEN NOTIFICATION PERMISSION PROMPT
   ============================================
   A one-time (well — "until dismissed for good") modal asking the
   person to enable push notifications, shown shortly after the app
   finishes loading. Skipped entirely if:
     - the browser doesn't support Notification/messaging at all
     - permission is already 'granted' or already 'denied' (nothing
       useful a modal can do in either case — 'denied' can only be
       undone from the browser's own site settings)
     - the person previously ticked "Don't show this again"
   ============================================ */
const NOTIF_PROMPT_DISMISSED_KEY = 'graceguide_notif_prompt_dismissed';

function shouldShowNotificationPermissionPrompt() {
    if (!('Notification' in window)) return false;
    if (!messaging) return false;
    if (FCM_VAPID_KEY === 'REPLACE_WITH_YOUR_VAPID_KEY') return false;
    if (Notification.permission !== 'default') return false; // already granted or denied
    if (localStorage.getItem(NOTIF_PROMPT_DISMISSED_KEY) === 'true') return false;
    return true;
}

function maybeShowNotificationPermissionModal() {
    if (!shouldShowNotificationPermissionPrompt()) return;

    // Don't stack on top of the auth modal, or on top of itself if this
    // somehow gets called twice — and don't interrupt someone who's
    // already mid-interaction with another modal/sheet.
    if (document.querySelector('#modal-container:not(.hidden)') || document.querySelector('#sheet-container:not(.hidden)')) return;

    showModal(`
        <div class="text-center" style="padding: 4px 0 0;">
            <div class="in-app-notif-icon" style="width:56px; height:56px; font-size:22px; margin:0 auto 16px;"><i class="fas fa-bell"></i></div>
            <h3 style="margin-bottom: 8px;">Stay in the loop</h3>
            <p class="text-muted" style="margin-bottom: 20px; line-height: 1.6;">
                Turn on notifications for your daily verse, quiz reminders, and replies from Brethren — you can change this anytime in Settings.
            </p>
        </div>
        <button class="btn btn-primary btn-block" onclick="handleNotificationPromptEnable()">
            <i class="fas fa-bell"></i> Enable Notifications
        </button>
        <button class="btn btn-outline btn-block mt-2" onclick="handleNotificationPromptDismiss()">
            Not Now
        </button>
        <label style="display:flex; align-items:center; gap:8px; justify-content:center; margin-top:16px; font-size:13px; color: var(--text-slate); cursor:pointer;">
            <input type="checkbox" id="notif-prompt-dont-show" style="width:16px; height:16px;">
            Don't show this again
        </label>
    `);
}

function persistNotifPromptDismissalIfChecked() {
    const checkbox = document.getElementById('notif-prompt-dont-show');
    if (checkbox && checkbox.checked) {
        localStorage.setItem(NOTIF_PROMPT_DISMISSED_KEY, 'true');
    }
}

function handleNotificationPromptDismiss() {
    persistNotifPromptDismissalIfChecked();
    closeModal();
}

async function handleNotificationPromptEnable() {
    // Respect the checkbox even on the "enable" path — someone might tick
    // it and then still tap Enable, meaning "stop asking me, I've got it."
    persistNotifPromptDismissalIfChecked();
    // enableNotifications() itself handles the guest case via requireAuth,
    // which opens the auth modal — closeModal()'s history.back() is async,
    // so opening another modal right after it (rather than via
    // closeModalThen) can race and immediately close the new one. See the
    // closeModalThen() doc comment in core.js for the same pattern.
    closeModalThen(() => enableNotifications());
}

window.handleNotificationPromptEnable = handleNotificationPromptEnable;
window.handleNotificationPromptDismiss = handleNotificationPromptDismiss;

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorkers();
    updateInstallButtonVisibility();
    initForegroundMessageHandler();

    const installBtn = document.getElementById('drawer-install-btn');
    if (installBtn) installBtn.addEventListener('click', handleInstallButtonClick);

    window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButtonVisibility);
});

window.enableNotifications = enableNotifications;
window.handleInstallButtonClick = handleInstallButtonClick;
