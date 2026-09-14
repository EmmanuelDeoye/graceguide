/* ============================================
   GraceGuide — js/core.js
   Load AFTER config.js.
   Contains: app state, DOM refs, utilities, theme,
   authentication, routing, home page, Bible reader.
   ============================================ */

/* ============================================
   APPLICATION STATE
   ============================================ */
const AppState = {
    currentUser: null,
    userProfile: null,
    currentRoute: 'home',
    currentTheme: 'light',
    // Persisted so the last translation the user picked (KJV/NLT/MSG/AMP)
    // stays selected across reloads instead of always resetting to KJV.
    bibleVersion: localStorage.getItem('graceguide_bible_version') || 'KJV',
    currentChapter: null,
    currentBook: null,
    // Which level of the Bible tab is showing: 'books' (grid of 66 books),
    // 'chapters' (grid of chapter numbers for the chosen book), or
    // 'reader' (the actual chapter text). null = not yet decided.
    bibleView: null,
    // How many in-app navigations are "behind" the current screen in
    // browser history — lets the top-bar Back button (needed on iOS/
    // desktop installed PWAs, which have no browser chrome of their own)
    // know whether history.back() will land somewhere inside the app or
    // just do nothing/exit.
    appNavDepth: 0,
    selectedVerses: new Set(),
    plannerData: [],
    notifications: [],
    unreadMessages: 0,
    aiChatHistory: [],
    moderationQueue: [],
    cachedBibleVersions: ['KJV', 'NLT', 'MSG', 'AMP'],
    bibleIdMap: {},
    bibleIdsResolving: null,
    isOnline: navigator.onLine,
    isLoading: false,
    currentPlan: null,
    readingHistory: [],
    bookmarks: [],
    highlights: [],
    notes: [],
    communityPosts: [],
    userConnections: new Map(), // otherUid -> 'pending_sent' | 'pending_received' | 'brethren'
    eventData: [],
    modalOpen: false,
    sheetOpen: false,
    drawerOpen: false,
    suppressNextPopstateNav: false,
    aiConversations: [],
    currentConversationId: null,
    viewedProfileId: null,
    viewedProfileName: null,
    // Phase 3 — set by navigateToHash() just before navigating to each
    // corresponding shared-content route, mirroring how viewedProfileId
    // already works for view-profile.
    sharedSpacePostId: null,
    sharedPlanShareId: null,
    sharedQuizId: null,
    sharedDevotionalShareId: null,
    todayReflection: '',
    todayVerse: null,
    todayDevotional: null,
    selectedVoiceId: null,
    communityGroups: [],
    currentGroupId: null,
    dmConversations: [],
    currentDMUserId: null,
    currentDMUserName: null,
    spacePosts: [],
    interestProfile: null,
    spaceStreak: { count: 0, lastPostDate: null },
    scrollPositions: {},
    unreadChatsCount: 0,
    unreadForumGroupIds: new Set()
};

/* ============================================
   DOM ELEMENTS
   ============================================ */
const DOM = {
    splashScreen: document.getElementById('splash-screen'),
    mainContent: document.getElementById('main-content'),
    pageContainer: document.getElementById('page-container'),
    topBarTitle: document.getElementById('top-bar-title'),
    bottomNav: document.getElementById('bottom-nav'),
    drawer: document.getElementById('side-drawer'),
    drawerOverlay: document.getElementById('drawer-overlay'),
    toastContainer: document.getElementById('toast-container'),
    modalContainer: document.getElementById('modal-container'),
    sheetContainer: document.getElementById('sheet-container'),
    notifBadge: document.getElementById('notif-badge'),
    menuBtn: document.getElementById('menu-btn'),
    drawerClose: document.getElementById('drawer-close'),
    drawerLogout: document.getElementById('drawer-logout'),
    notifBtn: document.getElementById('notif-btn'),
    backBtn: document.getElementById('back-btn'),
    spaceAddBtn: document.getElementById('space-add-btn'),
    profileNavBtn: document.getElementById('profile-nav-btn'),
    profileNavAvatar: document.getElementById('profile-nav-avatar')
};

/* ============================================
   UTILITY FUNCTIONS
   ============================================ */
function $(selector, parent = document) {
    return parent.querySelector(selector);
}

function $$(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function generateId() {
    return `adl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
    });
}

function truncate(text, length = 100) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
}

function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i>
        <span>${escapeHtml(message)}</span>
    `;
    DOM.toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showModal(content, options = {}) {
    // Close any open sheet first to avoid stacked overlays
    if (AppState.sheetOpen) closeSheet();

    const modal = document.createElement('div');
    modal.className = 'modal-container';
    modal.innerHTML = `
        <div class="modal-content">
            ${content}
        </div>
    `;

    if (options.closeOnOverlay !== false) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    DOM.modalContainer.innerHTML = '';
    DOM.modalContainer.appendChild(modal);
    DOM.modalContainer.classList.remove('hidden');

    if (!AppState.modalOpen) {
        history.pushState({ overlay: 'modal' }, '');
    }
    AppState.modalOpen = true;

    return modal;
}

function closeModal(fromPopstate = false) {
    DOM.modalContainer.innerHTML = '';
    DOM.modalContainer.classList.add('hidden');

    const wasOpen = AppState.modalOpen;
    AppState.modalOpen = false;

    if (wasOpen && !fromPopstate && history.state && history.state.overlay === 'modal') {
        // This history.back() only exists to unwind the entry we pushed
        // when the modal opened — it must NOT trigger a route re-render.
        AppState.suppressNextPopstateNav = true;
        history.back();
    }
}

/**
 * Same reasoning as closeSheetThen(): closeModal()'s history.back() is
 * async, so anything that itself navigates or opens another
 * modal/sheet right afterward (e.g. openBibleChapter -> navigateTo,
 * which does its own history.pushState) can race it. Use this instead
 * of `onclick="closeModal(); next()"` whenever `next` navigates or
 * opens another overlay.
 */
function closeModalThen(next) {
    closeModal();
    setTimeout(next, 0);
}

function showSheet(content, options = {}) {
    // Close any open modal first to avoid stacked overlays
    if (AppState.modalOpen) closeModal();

    const sheet = document.createElement('div');
    sheet.className = 'sheet-container';
    sheet.innerHTML = `
        <div class="sheet-backdrop"></div>
        <div class="sheet-content">
            <div class="sheet-handle"></div>
            ${content}
        </div>
    `;

    if (options.closeOnOverlay !== false) {
        sheet.querySelector('.sheet-backdrop').addEventListener('click', () => closeSheet());
    }

    DOM.sheetContainer.innerHTML = '';
    DOM.sheetContainer.appendChild(sheet);
    DOM.sheetContainer.classList.remove('hidden');

    if (!AppState.sheetOpen) {
        history.pushState({ overlay: 'sheet' }, '');
    }
    AppState.sheetOpen = true;

    return sheet;
}

function closeSheet(fromPopstate = false) {
    DOM.sheetContainer.innerHTML = '';
    DOM.sheetContainer.classList.add('hidden');

    const wasOpen = AppState.sheetOpen;
    AppState.sheetOpen = false;

    if (wasOpen && !fromPopstate && history.state && history.state.overlay === 'sheet') {
        AppState.suppressNextPopstateNav = true;
        history.back();
    }
}

/**
 * Closes the current sheet, then opens whatever comes next (a modal, a
 * different sheet, navigation, etc). This exists because
 * `onclick="closeSheet(); doSomething()"` is racy: closeSheet()'s
 * history.back() resolves asynchronously, so a history.pushState() from
 * the very next line (e.g. showModal()) can fire before it — corrupting
 * the back/forward stack, which is why buttons using that old pattern
 * would sometimes silently do nothing. Deferring `next` by one tick lets
 * the back-navigation actually finish first.
 */
function closeSheetThen(next) {
    closeSheet();
    setTimeout(next, 0);
}

function setLoading(isLoading) {
    AppState.isLoading = isLoading;
    if (isLoading) {
        document.body.style.cursor = 'wait';
    } else {
        document.body.style.cursor = 'default';
    }
}

/* ============================================
   THEME MANAGEMENT
   ============================================ */
function initTheme() {
    const savedTheme = localStorage.getItem('graceguide_theme') || 'light';
    AppState.currentTheme = savedTheme;
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    AppState.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('graceguide_theme', theme);
}

function toggleTheme() {
    const newTheme = AppState.currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    showToast(`Theme switched to ${newTheme} mode`, 'success');
    if (AppState.currentRoute === 'settings') renderSettingsPage();
}

/* ============================================
   AUTHENTICATION
   ============================================ */
let authReady = false;

function initAuth() {
    // Safety net: no matter what happens with Firebase Auth (slow network,
    // blocked script, offline device, a thrown error inside the callback),
    // the splash screen must never be able to hang forever with no
    // feedback. If the very first auth check hasn't resolved within a few
    // seconds, drop the user into guest mode and let them retry signing in
    // normally — instead of staring at a stuck loader.
    const SPLASH_TIMEOUT_MS = 6000;
    let settled = false;

    // Known routes that can legitimately be deep-linked / restored on
    // launch. Anything else (or missing) falls back to the default tab
    // instead of forcing everyone onto Shepherd every time the app opens.
    // Phase 3: a hash that parses as one of the six shareable deep-link
    // patterns (#/profile/ID, #/bible/BOOK/CH/VS, etc) is valid too —
    // this is what makes those URLs work after a hard refresh, not just
    // when navigated to from inside the app.
    const VALID_INITIAL_ROUTES = ['home', 'bible', 'ask', 'space', 'community', 'planner', 'messages', 'profile', 'settings', 'talk-to-someone'];
    const DEEP_LINK_ROUTE_MARKERS = ['deep-profile', 'deep-space-post', 'deep-planner', 'deep-bible', 'deep-quiz', 'deep-devotional'];
    const hashRoute = window.location.hash.replace(/^#\//, '');
    const bootParsedRoute = parseAppRoute(window.location.hash);
    // hashRoute.length check preserves the original behavior for an
    // empty or bare "#/" hash exactly (falls back to 'ask' below) —
    // parseAppRoute() on its own would otherwise treat "no hash" as
    // {route:'home'}, which is the right default for a parser in
    // general but not what boot-time should do here.
    const isValidBootRoute = hashRoute.length > 0
        && (DEEP_LINK_ROUTE_MARKERS.includes(bootParsedRoute.route) || VALID_INITIAL_ROUTES.includes(bootParsedRoute.route));
    const initialHash = isValidBootRoute ? window.location.hash : null;

    const enterAppOnce = (isTimeout) => {
        if (settled) return;
        settled = true;
        authReady = true;
        updateProfileNavIcon();
        updateDrawerAuthButton();
        showMainApp();
        if (initialHash) {
            navigateToHash(initialHash, { replace: true });
        } else {
            navigateTo('ask', { replace: true });
        }
        if (isTimeout) {
            showToast("Taking longer than usual to connect — you're browsing as a guest for now.", 'warning');
        }
        // Give the initial page its own moment on screen before asking
        // about notifications — showing this immediately, mid-transition,
        // reads as a jarring interruption rather than a deliberate ask.
        // Skipped entirely if they're sitting at the verification gate —
        // asking about notifications before they can even use the app
        // is out of place.
        if (typeof maybeShowNotificationPermissionModal === 'function' && !shouldGateForEmailVerification(AppState.currentUser)) {
            setTimeout(maybeShowNotificationPermissionModal, 1500);
        }
    };

    const splashTimer = setTimeout(() => enterAppOnce(true), SPLASH_TIMEOUT_MS);

    try {
        auth.onAuthStateChanged(async (user) => {
            try {
                if (user) {
                    AppState.currentUser = user;
                    await loadUserProfile(user.uid);
                    await syncUserDirectoryAndActivity(user);
                    checkAndShowAdminLink(user);
                    await loadUserData();
                } else {
                    if (typeof stopRealtimeListeners === 'function') stopRealtimeListeners();
                    AppState.currentUser = null;
                    AppState.userProfile = null;
                    AppState.bookmarks = [];
                    AppState.highlights = [];
                    AppState.notes = [];
                    AppState.readingHistory = [];
                    AppState.plannerData = [];
                    AppState.userConnections = new Map();
                    AppState.aiConversations = [];
                    AppState.notifications = [];
                    AppState.dmConversations = [];
                    AppState.unreadChatsCount = 0;
                    AppState.unreadForumGroupIds = new Set();
                    if (typeof updateNotificationBadge === 'function') updateNotificationBadge();
                    if (typeof updateChatDrawerBadge === 'function') updateChatDrawerBadge();
                    if (typeof updateForumDrawerBadge === 'function') updateForumDrawerBadge();
                    if (typeof loadInterestProfile === 'function') await loadInterestProfile();
                    const adminLink = document.getElementById('drawer-link-admin');
                    if (adminLink) adminLink.classList.add('hidden');
                }

                updateProfileNavIcon();
                updateDrawerAuthButton();

                if (!settled) {
                    // First auth check resolved before the timeout — normal path.
                    clearTimeout(splashTimer);
                    enterAppOnce(false);
                } else {
                    // Auth state changed mid-session (user signed in/out from the
                    // modal) — refresh whatever page is currently showing.
                    navigateTo(AppState.currentRoute, { replace: true });
                }
            } catch (innerError) {
                console.error('Error handling auth state change:', innerError);
                clearTimeout(splashTimer);
                enterAppOnce(false);
                showToast('Something went wrong loading your account. You can try signing in again.', 'error');
            }
        }, (authError) => {
            // Firebase's own error callback for onAuthStateChanged.
            console.error('Firebase auth error:', authError);
            clearTimeout(splashTimer);
            enterAppOnce(true);
        });
    } catch (syncError) {
        // Firebase itself failed to initialize (e.g. SDK didn't load).
        console.error('Failed to start auth listener:', syncError);
        clearTimeout(splashTimer);
        enterAppOnce(true);
    }
}

async function loadUserProfile(uid) {
    try {
        const snapshot = await database.ref(`users/${uid}/profile`).once('value');
        AppState.userProfile = snapshot.val() || {
            username: AppState.currentUser.email?.split('@')[0] || 'User',
            bio: '',
            avatar: '',
            createdAt: Date.now()
        };
    } catch (error) {
        console.error('Error loading user profile:', error);
        AppState.userProfile = {
            username: 'User',
            bio: '',
            avatar: ''
        };
    }
}

/**
 * Keeps a lightweight, admin-readable directory in sync (username/email/
 * createdAt/lastActiveAt per uid) and records one cheap "active today"
 * marker per day. Neither of these exists anywhere else — this is what
 * lets the admin dashboard list users and chart traffic without pulling
 * every user's entire data tree just to see who signed up when.
 */
async function syncUserDirectoryAndActivity(user) {
    try {
        const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const updates = {};
        updates[`userDirectory/${user.uid}`] = {
            username: AppState.userProfile?.username || user.email?.split('@')[0] || 'User',
            email: user.email || null,
            createdAt: AppState.userProfile?.createdAt || Date.now(),
            lastActiveAt: Date.now()
        };
        updates[`analytics/activeDays/${todayKey}/${user.uid}`] = true;
        await database.ref().update(updates);
    } catch (error) {
        console.error('Error syncing user directory/activity:', error);
    }
}

/**
 * Shows the "Admin Dashboard" drawer link only for the master email or
 * an account granted access at admins/{uid} — everyone else never even
 * sees it. This is a convenience/discoverability affordance only;
 * admin.html enforces the real access check itself.
 */
async function checkAndShowAdminLink(user) {
    const link = document.getElementById('drawer-link-admin');
    if (!link) return;
    if (user.email === 'godledtech@gmail.com') {
        link.classList.remove('hidden');
        return;
    }
    try {
        const snap = await database.ref(`admins/${user.uid}`).once('value');
        link.classList.toggle('hidden', !snap.exists());
    } catch (error) {
        link.classList.add('hidden');
    }
}

async function loadUserData() {
    if (!AppState.currentUser) return;
    const uid = AppState.currentUser.uid;
    
    try {
        // Load bookmarks, highlights, notes, reading history
        const [bookmarksSnap, highlightsSnap, notesSnap, historySnap, plannerSnap, connectionsSnap, spaceStreakSnap] = await Promise.all([
            database.ref(`users/${uid}/bookmarks`).once('value'),
            database.ref(`users/${uid}/highlights`).once('value'),
            database.ref(`users/${uid}/notes`).once('value'),
            database.ref(`users/${uid}/readingHistory`).once('value'),
            database.ref(`users/${uid}/planner`).once('value'),
            database.ref(`users/${uid}/connections`).once('value'),
            database.ref(`users/${uid}/spaceStreak`).once('value')
        ]);
        
        AppState.bookmarks = bookmarksSnap.val() || [];
        AppState.highlights = highlightsSnap.val() || [];
        AppState.notes = notesSnap.val() || [];
        AppState.readingHistory = historySnap.val() || [];
        AppState.plannerData = plannerSnap.val() || [];
        AppState.currentPlan = AppState.plannerData[0] || null;
        AppState.spaceStreak = spaceStreakSnap.val() || { count: 0, lastPostDate: null };

        AppState.userConnections = new Map();
        const connections = connectionsSnap.val() || {};
        Object.entries(connections).forEach(([otherUid, info]) => {
            if (!info) return;
            if (info.status === 'accepted') {
                AppState.userConnections.set(otherUid, 'brethren');
            } else if (info.status === 'pending') {
                AppState.userConnections.set(otherUid, info.direction === 'incoming' ? 'pending_received' : 'pending_sent');
            }
        });
    } catch (error) {
        console.error('Error loading user data:', error);
    }
    
    // Start realtime listeners (notifications, chat unread, forum unread) —
    // these update live via Firebase's .on('value'), no refresh needed.
    if (typeof startRealtimeListeners === 'function') startRealtimeListeners();
    // Load the personalization profile (books/tags of interest)
    if (typeof loadInterestProfile === 'function') loadInterestProfile();
}

function showMainApp() {
    DOM.splashScreen.classList.add('hidden');
    DOM.mainContent.classList.remove('hidden');

    const topBarEl = document.getElementById('top-bar');
    if (topBarEl) topBarEl.style.display = 'flex';
    DOM.bottomNav.style.display = 'flex';
    DOM.drawer.style.display = 'flex';
}

/**
 * Gate an action behind sign-in without forcing a full-page login.
 * Guests can use the whole app; this only pops a modal at the moment
 * something needs to be saved to their account. Returns true if the
 * user is already signed in (so the caller can proceed immediately).
 */
function requireAuth(message, onAuthenticated) {
    if (AppState.currentUser) {
        return true;
    }
    showAuthModal({ message, onSuccess: onAuthenticated });
    return false;
}

function requireVerifiedEmail() {
    if (!AppState.currentUser) return true; // not signed in, will be caught by requireAuth
    if (AppState.currentUser.emailVerified) return true;
    
    showModal(`
        <div class="text-center" style="padding: 4px 0;">
            <i class="fas fa-envelope" style="font-size: 40px; opacity: 0.6; margin-bottom: 12px;"></i>
            <h3 style="margin-bottom: 8px;">Verify Your Email</h3>
            <p class="text-muted" style="margin-bottom: 20px;">Before you can participate in the quiz, please verify your email address.</p>
            <p style="font-size: 12px; color: var(--text-slate); margin-bottom: 12px;">A verification link was sent to <strong>${escapeHtml(AppState.currentUser.email)}</strong></p>
        </div>
        <button class="btn btn-primary btn-block" onclick="resendVerificationEmail()">
            <i class="fas fa-paper-plane"></i> Send Verification Link
        </button>
        <button class="btn btn-outline btn-block mt-2" onclick="closeModal()">
            Not Now
        </button>
    `);
    return false;
}

/** Firebase Auth has no concept of "pending" account creation — the
    account record unavoidably exists the instant createUserWithEmailAnd
    Password() resolves, which is what makes it possible to send the
    verification email in the first place. What we CAN do is make sure
    that account is functionally useless until verified: every route
    (see the early-return in navigateTo below) redirects to a full-screen
    gate instead of rendering the requested page, for as long as a
    password-based account remains unverified. Google/other OAuth sign-ins
    are exempt since those providers verify email ownership themselves. */
function shouldGateForEmailVerification(user) {
    if (!user) return false;
    if (user.emailVerified) return false;
    return !!(user.providerData && user.providerData.some(p => p.providerId === 'password'));
}

function renderEmailVerificationGate() {
    AppState.currentRoute = 'verify-email';
    if (DOM.bottomNav) DOM.bottomNav.style.display = 'none';
    DOM.pageContainer.innerHTML = `
        <div style="min-height: 65vh; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding: 32px 20px;">
            <div style="width:72px; height:72px; border-radius:50%; background: rgba(48,72,58,0.1); display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
                <i class="fas fa-envelope-circle-check" style="font-size:30px; color: var(--primary-deep-olive);"></i>
            </div>
            <h2 style="margin-bottom:8px;">Verify Your Email</h2>
            <p class="text-muted" style="max-width: 320px; margin-bottom: 4px; line-height:1.6;">
                We sent a verification link to<br><strong>${escapeHtml(AppState.currentUser?.email || '')}</strong>
            </p>
            <p class="text-muted" style="max-width: 320px; margin-bottom: 24px; line-height:1.6; font-size: 13px;">
                Click the link in that email, then tap Continue below. Check your spam folder if you don't see it.
            </p>
            <button class="btn btn-primary" style="width: 100%; max-width: 300px; margin-bottom: 10px;" onclick="checkEmailVerificationStatus()">
                <i class="fas fa-rotate"></i> I've Verified — Continue
            </button>
            <button class="btn btn-outline" style="width: 100%; max-width: 300px; margin-bottom: 10px;" onclick="resendVerificationEmail()">
                <i class="fas fa-paper-plane"></i> Resend Verification Email
            </button>
            <button class="btn" style="width: 100%; max-width: 300px; background:none; color: var(--text-slate);" onclick="handleLogout()">
                Sign Out
            </button>
        </div>
    `;
}

async function checkEmailVerificationStatus() {
    if (!AppState.currentUser) return;
    try {
        await AppState.currentUser.reload();
        if (AppState.currentUser.emailVerified) {
            showToast('Email verified! Welcome to GraceGuide.', 'success');
            if (DOM.bottomNav) DOM.bottomNav.style.display = 'flex';
            navigateTo('home', { replace: true });
        } else {
            showToast("Still not verified — check your inbox and click the link, then try again.", 'warning');
        }
    } catch (error) {
        console.error('Error checking verification status:', error);
        showToast('Could not check verification status. Please try again.', 'error');
    }
}

// Turns any Firebase Auth error into a short, plain-English sentence —
// no error codes, no jargon — shown right in the modal as it happens.
function describeAuthError(error) {
    switch (error?.code) {
        case 'auth/invalid-email':
            return "That email address doesn't look right. Double-check it and try again.";
        case 'auth/user-disabled':
            return 'This account has been disabled. Contact support if you think this is a mistake.';
        case 'auth/user-not-found':
            return "We couldn't find an account with that email. Check the spelling, or create a new account.";
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
        case 'auth/invalid-login-credentials':
            return "That password doesn't match this email. Try again, or reset your password below.";
        case 'auth/missing-password':
            return 'Please enter a password.';
        case 'auth/email-already-in-use':
            return 'An account already exists with this email. Try signing in instead.';
        case 'auth/weak-password':
            return 'Please choose a stronger password — at least 8 characters, with both letters and numbers.';
        case 'auth/too-many-requests':
            return "Too many attempts. Please wait a bit before trying again.";
        case 'auth/network-request-failed':
            return "We couldn't reach the server. Check your internet connection and try again.";
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
            return 'The Google sign-in window was closed before finishing.';
        case 'auth/popup-blocked':
            return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
        case 'auth/account-exists-with-different-credential':
            return 'An account already exists with this email using a different sign-in method.';
        default:
            return error?.message || 'Something went wrong. Please try again.';
    }
}

// Password rule: at least 8 characters, letters-and-numbers only, and must
// contain at least one letter and one number.
const PASSWORD_RULE_TEXT = 'Password must be at least 8 characters and contain both letters and numbers.';
function isPasswordValid(password) {
    return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{8,}$/.test(password || '');
}

function showAuthModal(options = {}) {
    const { message, onSuccess } = options;

    const authHTML = `
        <div class="auth-modal">
            <div class="auth-modal-icon">
                <i class="fas fa-dove"></i>
            </div>
            <h2 class="auth-title">Welcome to Grace<span class="brand-guide">Guide</span></h2>
            <p class="auth-subtitle">${message ? escapeHtml(message) : 'Your AI Christian Companion'}</p>

            <div id="auth-error-banner" class="auth-error-banner hidden">
                <i class="fas fa-circle-exclamation"></i>
                <span id="auth-error-text"></span>
            </div>

            <button id="auth-google-btn" class="btn btn-google btn-block">
                <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"/></svg>
                Continue with Google
            </button>

            <div class="auth-divider">or use your email</div>

            <div class="form-group">
                <label class="form-label">Email</label>
                <input type="email" id="auth-email" class="form-input" placeholder="Enter your email" autocomplete="email">
            </div>

            <div class="form-group">
                <label class="form-label">Password</label>
                <div class="password-field-wrap">
                    <input type="password" id="auth-password" class="form-input" placeholder="Enter your password" autocomplete="current-password">
                    <button type="button" class="password-toggle-btn" id="auth-password-toggle" aria-label="Show password">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
                <p class="password-hint" id="auth-password-hint">${PASSWORD_RULE_TEXT}</p>
            </div>

            <div class="form-group" id="auth-username-group" style="display: none;">
                <label class="form-label">Username</label>
                <input type="text" id="auth-username" class="form-input" placeholder="Choose a username" autocomplete="nickname">
            </div>

            <button id="auth-submit" class="btn btn-primary btn-block btn-lg mt-3">
                <span class="auth-submit-label">Sign In</span>
            </button>

            <div class="text-center mt-3">
                <button id="auth-toggle-mode" class="btn btn-outline btn-sm">Create Account</button>
            </div>

            <div class="text-center mt-2">
                <button id="auth-reset" class="btn btn-sm" style="color: var(--text-slate);">Forgot Password?</button>
            </div>
        </div>
    `;

    showModal(authHTML);

    let isSignUp = false;

    const errorBanner = $('#auth-error-banner');
    const errorText = $('#auth-error-text');
    const passwordInput = $('#auth-password');
    const passwordHint = $('#auth-password-hint');

    function showAuthError(text) {
        errorText.textContent = text;
        errorBanner.classList.remove('hidden');
    }
    function clearAuthError() {
        errorBanner.classList.add('hidden');
    }

    // Show/hide password toggle
    $('#auth-password-toggle').addEventListener('click', () => {
        const nowVisible = passwordInput.type === 'password';
        passwordInput.type = nowVisible ? 'text' : 'password';
        $('#auth-password-toggle i').className = nowVisible ? 'fas fa-eye-slash' : 'fas fa-eye';
    });

    // Live password validation feedback (sign-up mode only, where it matters)
    passwordInput.addEventListener('input', () => {
        if (!isSignUp) return;
        const valid = isPasswordValid(passwordInput.value);
        passwordHint.classList.toggle('invalid', passwordInput.value.length > 0 && !valid);
    });

    $('#auth-toggle-mode').addEventListener('click', () => {
        isSignUp = !isSignUp;
        clearAuthError();
        $('.auth-submit-label').textContent = isSignUp ? 'Create Account' : 'Sign In';
        $('#auth-toggle-mode').textContent = isSignUp ? 'Back to Sign In' : 'Create Account';
        $('#auth-username-group').style.display = isSignUp ? 'block' : 'none';
        $('.auth-subtitle').textContent = isSignUp ? 'Create your GraceGuide account' : (message || 'Your AI Christian Companion');
        passwordHint.classList.remove('invalid');
    });

    $('#auth-google-btn').addEventListener('click', async () => {
        clearAuthError();
        const googleBtn = $('#auth-google-btn');
        googleBtn.disabled = true;
        googleBtn.classList.add('btn-loading');

        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const result = await auth.signInWithPopup(provider);
            const user = result.user;

            // First-time Google sign-ins need a profile record, same as email sign-up.
            const existingProfile = await database.ref(`users/${user.uid}/profile`).once('value');
            if (!existingProfile.exists()) {
                await database.ref(`users/${user.uid}/profile`).set({
                    username: user.displayName || user.email?.split('@')[0] || 'User',
                    bio: '',
                    avatar: user.photoURL || '',
                    createdAt: Date.now()
                });
                // Seed the interest profile with BOTH buckets present. The Realtime
                // Database silently drops any key whose value is an empty object, so
                // writing { books: {}, tags: {} } here would only ever persist
                // "books" once a real signal lands there — "tags" would never appear
                // until a tag signal fires (Ask Shepherd / Space). The placeholder
                // key keeps both nodes alive from account creation onward; consumers
                // of interestProfile already ignore unknown tag/book keys.
                await database.ref(`users/${user.uid}/interestProfile`).set({
                    books: { _seed: 0 },
                    tags: { _seed: 0 },
                    updatedAt: Date.now()
                });
            }

            showToast(`Welcome, ${user.displayName || 'friend'}!`, 'success');
            closeModal();
            if (onSuccess) onSuccess();
        } catch (error) {
            showAuthError(describeAuthError(error));
            googleBtn.disabled = false;
            googleBtn.classList.remove('btn-loading');
        }
    });

    $('#auth-submit').addEventListener('click', async () => {
        clearAuthError();
        const email = $('#auth-email').value.trim();
        const password = $('#auth-password').value;
        const username = $('#auth-username')?.value.trim();

        if (!email) {
            showAuthError('Please enter your email address.');
            return;
        }
        if (!password) {
            showAuthError('Please enter your password.');
            return;
        }
        if (isSignUp && !username) {
            showAuthError('Please choose a username.');
            return;
        }
        if (isSignUp && !isPasswordValid(password)) {
            showAuthError(PASSWORD_RULE_TEXT);
            passwordHint.classList.add('invalid');
            return;
        }

        const submitBtn = $('#auth-submit');
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-loading');
        submitBtn.innerHTML = `<span class="btn-spinner"></span> ${isSignUp ? 'Creating account…' : 'Signing in…'}`;

        try {
            if (isSignUp) {
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                await database.ref(`users/${userCredential.user.uid}/profile`).set({
                    username: username,
                    bio: '',
                    avatar: '',
                    createdAt: Date.now()
                });
                // See the comment on the Google sign-in flow above — this keeps
                // both "books" and "tags" present under interestProfile from the
                // very start, instead of "tags" only appearing once a tag signal
                // happens to fire (which, for a brand-new user, may be a while).
                await database.ref(`users/${userCredential.user.uid}/interestProfile`).set({
                    books: { _seed: 0 },
                    tags: { _seed: 0 },
                    updatedAt: Date.now()
                });

                // Email verification — sent on every sign-up to cut down on fake accounts.
                try {
                    await userCredential.user.sendEmailVerification();
                    showToast("Account created! We've sent a verification link to your email.", 'success');
                } catch (verifyError) {
                    console.error('Error sending verification email:', verifyError);
                    showToast('Account created! (We could not send a verification email — you can resend it from Settings.)', 'warning');
                }
            } else {
                const userCredential = await auth.signInWithEmailAndPassword(email, password);
                if (userCredential.user && !userCredential.user.emailVerified) {
                    showToast("Welcome back! Reminder: your email isn't verified yet — check your inbox, or resend from Settings.", 'warning');
                } else {
                    showToast('Welcome back!', 'success');
                }
            }
            closeModal();
            if (onSuccess) onSuccess();
        } catch (error) {
            showAuthError(describeAuthError(error));
            submitBtn.disabled = false;
            submitBtn.classList.remove('btn-loading');
            submitBtn.innerHTML = `<span class="auth-submit-label">${isSignUp ? 'Create Account' : 'Sign In'}</span>`;
        }
    });

    $('#auth-reset').addEventListener('click', async () => {
        clearAuthError();
        const email = $('#auth-email').value.trim();
        if (!email) {
            showAuthError('Enter your email address above first, then tap "Forgot Password?" again.');
            return;
        }

        try {
            await auth.sendPasswordResetEmail(email);
            showToast(`Password reset email sent to ${email}. Check your inbox.`, 'success');
        } catch (error) {
            showAuthError(describeAuthError(error));
        }
    });
}

/**
 * Resends the verification email for the currently signed-in user.
 * Exposed for use from the Settings page.
 */
async function resendVerificationEmail() {
    if (!AppState.currentUser) {
        showToast('Sign in first.', 'warning');
        return;
    }
    if (AppState.currentUser.emailVerified) {
        showToast('Your email is already verified!', 'success');
        return;
    }
    try {
        await AppState.currentUser.sendEmailVerification();
        showToast('Verification email sent — check your inbox.', 'success');
    } catch (error) {
        showToast(describeAuthError(error), 'error');
    }
}

function updateProfileNavIcon() {
    const avatarEl = document.getElementById('profile-nav-avatar');
    if (!avatarEl) return;

    if (AppState.currentUser && AppState.userProfile?.avatar) {
        avatarEl.innerHTML = `<img src="${AppState.userProfile.avatar}" alt="Profile">`;
    } else if (AppState.currentUser) {
        const initial = (AppState.userProfile?.username || AppState.currentUser.email || 'U')[0].toUpperCase();
        avatarEl.innerHTML = `<span class="profile-nav-initial">${escapeHtml(initial)}</span>`;
    } else {
        avatarEl.innerHTML = `<i class="fas fa-user"></i>`;
    }
}

function handleProfileNavClick() {
    if (AppState.currentUser) {
        navigateTo('profile');
    } else {
        showAuthModal({ message: 'Sign in to view and set up your profile.' });
    }
}

/**
 * The drawer footer button doubles as "Sign In" for guests. Once signed in,
 * it's hidden entirely — signing out lives on the Settings page instead.
 */
function updateDrawerAuthButton() {
    if (!DOM.drawerLogout) return;

    if (AppState.currentUser) {
        DOM.drawerLogout.classList.add('hidden');
    } else {
        DOM.drawerLogout.classList.remove('hidden');
        DOM.drawerLogout.innerHTML = `<i class="fas fa-right-to-bracket"></i> Sign In`;
    }
}

function handleDrawerAuthButtonClick() {
    if (AppState.currentUser) return;
    // Deliberately NOT calling closeDrawer() here: closeDrawer() unwinds
    // its own history entry via history.back(), which is asynchronous.
    // Immediately pushing a new history entry for the auth modal right
    // after that (as showAuthModal/showModal does) races with the pending
    // back() navigation — the eventual back() lands on the freshly-pushed
    // modal entry instead of the drawer entry, closing the modal the
    // instant it opens. Closing the drawer visually without touching
    // history sidesteps the race; the modal's own pushState still gives
    // the hardware back button correct behavior.
    DOM.drawer.classList.remove('open');
    DOM.drawerOverlay.classList.remove('show');
    DOM.drawerOverlay.classList.add('hidden');
    AppState.drawerOpen = false;
    showAuthModal({ message: 'Sign in to your GraceGuide account.' });
}

function handleLogout() {
    auth.signOut().then(() => {
        if (typeof stopRealtimeListeners === 'function') stopRealtimeListeners();
        AppState.currentUser = null;
        AppState.userProfile = null;
        showToast('Signed out successfully', 'success');
    }).catch((error) => {
        showToast('Failed to sign out', 'error');
    });
}

/* ============================================
   ROUTING
   ============================================ */

/* ---- PHASE 3: DEEP LINKING ----
   A thin layer on top of the existing single-segment hash router
   (#/home, #/bible, #/quiz, ...), which is untouched below. This adds
   support for shareable, parameterized routes:
     #/profile/USER_ID
     #/space/post/POST_ID
     #/planner/SHARE_ID
     #/bible/BOOK/CHAPTER/VERSE
     #/quiz/QUIZ_ID
     #/devotional/SHARE_ID
   Anything that doesn't match one of these patterns falls straight
   through as a plain route name — identical to how the router already
   behaved before this was added. */

/** Parses a raw hash (e.g. "#/profile/abc123" or "#/bible/John/3/16")
    into { route, params, urlPath }. `route` is either one of the six
    'deep-*' markers below (for navigateToHash() to act on) or, for any
    non-matching hash, just the first path segment — exactly what the
    pre-Phase-3 router used as the route name. `urlPath` is the
    normalized path (no leading "#/") to keep in the address bar. */
function parseAppRoute(hash) {
    const path = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean).map(s => decodeURIComponent(s));

    if (segments.length === 0) return { route: 'home', params: {}, urlPath: null };

    const [first, second, third, fourth] = segments;

    if (first === 'profile' && second) {
        return { route: 'deep-profile', params: { userId: second }, urlPath: path };
    }
    if (first === 'space' && second === 'post' && third) {
        return { route: 'deep-space-post', params: { postId: third }, urlPath: path };
    }
    if (first === 'planner' && second) {
        return { route: 'deep-planner', params: { shareId: second }, urlPath: path };
    }
    if (first === 'bible' && second && third) {
        const chapter = parseInt(third, 10);
        const verse = fourth ? parseInt(fourth, 10) : null;
        return { route: 'deep-bible', params: { book: second, chapter, verse }, urlPath: path };
    }
    if (first === 'quiz' && second) {
        return { route: 'deep-quiz', params: { quizId: second }, urlPath: path };
    }
    if (first === 'devotional' && second) {
        return { route: 'deep-devotional', params: { shareId: second }, urlPath: path };
    }

    // Not a dynamic pattern — plain existing static route (#/home,
    // #/bible, #/quiz, #/profile alone, etc), same as always.
    return { route: first, params: {}, urlPath: null };
}

/** The actual entry point boot-time and popstate now go through instead
    of calling navigateTo() directly with a raw hash segment. Applies
    whatever AppState a deep link needs (mirroring how viewUserProfile()
    already sets AppState.viewedProfileId before navigating), then hands
    off to the ordinary navigateTo() using existing internal route names/
    renderers wherever one already exists. Safe to call with ANY hash —
    non-dynamic hashes just resolve to a normal navigateTo() call. */
function navigateToHash(hash, options = {}) {
    const parsed = parseAppRoute(hash);
    const navOptions = parsed.urlPath ? { ...options, urlPath: parsed.urlPath } : options;

    switch (parsed.route) {
        case 'deep-profile':
            // Reuses the existing view-profile flow verbatim, including
            // its own "that's actually you" redirect to the private
            // profile route — see viewUserProfile().
            AppState.viewedProfileId = parsed.params.userId;
            AppState.viewedProfileName = null;
            if (AppState.currentUser && parsed.params.userId === AppState.currentUser.uid) {
                navigateTo('profile', options); // no urlPath: this is the private, non-shareable "my profile" route
            } else {
                navigateTo('view-profile', navOptions);
            }
            return;

        case 'deep-space-post':
            AppState.sharedSpacePostId = parsed.params.postId;
            navigateTo('shared-space-post', navOptions);
            return;

        case 'deep-planner':
            AppState.sharedPlanShareId = parsed.params.shareId;
            navigateTo('shared-plan', navOptions);
            return;

        case 'deep-bible': {
            const maxChapter = BIBLE_BOOK_CHAPTERS[parsed.params.book];
            const chapterInRange = maxChapter && parsed.params.chapter >= 1 && parsed.params.chapter <= maxChapter;
            // openBibleChapter() keeps the URL in sync itself (see its
            // doc comment), so this doesn't go through navigateTo here.
            if (chapterInRange) {
                openBibleChapter(parsed.params.book, parsed.params.chapter, parsed.params.verse || undefined);
            } else {
                navigateTo('bible', options); // invalid book/chapter — fall back to the book list rather than a dead end
            }
            return;
        }

        case 'deep-quiz':
            AppState.sharedQuizId = parsed.params.quizId;
            navigateTo('shared-quiz', navOptions);
            return;

        case 'deep-devotional':
            AppState.sharedDevotionalShareId = parsed.params.shareId;
            navigateTo('shared-devotional', navOptions);
            return;

        default:
            navigateTo(parsed.route, options);
    }
}

function navigateTo(route, options = {}) {
    const { fromPopstate = false, replace = false, urlPath = null } = options;

    // Stop any Shepherd voice playback before leaving/changing pages
    if (typeof stopSpeaking === 'function') stopSpeaking();

    // Leaving the Bible tab (or re-navigating to a different route while a
    // verse multi-selection is active) should clear the floating
    // selection bar so it doesn't linger over an unrelated page.
    if (route !== 'bible' && AppState.selectedVerses.size > 0) {
        AppState.selectedVerses.clear();
        clearVerseSelectionBar();
    }

    // Leaving Home or the Quiz page: stop their live-updating countdown
    // ticker so it doesn't keep firing (and touching now-gone DOM nodes)
    // in the background. The quiz attempt timer is intentionally left
    // running even if the user navigates away mid-attempt, since an
    // in-progress attempt should still auto-submit on time.
    if (route !== 'home' && route !== 'quiz' && typeof stopQuizCountdownInterval === 'function') {
        stopQuizCountdownInterval();
    }

    // Close any open overlays first (they manage their own history entries)
    if (AppState.modalOpen) closeModal(true);
    if (AppState.sheetOpen) closeSheet(true);
    if (AppState.drawerOpen) closeDrawer(true);

    // Password-based accounts that haven't verified their email get
    // redirected to the verification gate instead of whatever page they
    // asked for — see shouldGateForEmailVerification()'s doc comment.
    if (typeof shouldGateForEmailVerification === 'function' && shouldGateForEmailVerification(AppState.currentUser)) {
        renderEmailVerificationGate();
        return;
    }

    // Remember where the user was scrolled to on the page they're leaving,
    // so coming back to it later (or a same-route refresh, e.g. after
    // signing in) doesn't yank them back up to the top.
    if (DOM.pageContainer && AppState.currentRoute) {
        AppState.scrollPositions[AppState.currentRoute] = DOM.pageContainer.scrollTop;
    }

    AppState.currentRoute = route;
    updateNavigation(route);

    // Update browser history / URL hash so the back button navigates
    // within the app instead of leaving it. `urlPath` (Phase 3) lets a
    // deep-linkable route (e.g. 'view-profile') show a richer, shareable
    // URL (e.g. "profile/abc123") while still dispatching to the exact
    // same internal route/renderer below — existing callers never pass
    // it, so this is a no-op for every pre-Phase-3 route.
    if (!fromPopstate) {
        const url = `#/${urlPath || route}`;
        if (replace) {
            history.replaceState({ route }, '', url);
        } else if (window.location.hash !== url) {
            history.pushState({ route }, '', url);
            AppState.appNavDepth++;
        }
    }

    let renderResult;
    switch(route) {
        case 'home':
            renderResult = renderHomePage();
            break;
        case 'bible':
            renderResult = renderBiblePage();
            break;
        case 'ask':
            renderResult = renderAskPage();
            break;
        case 'community':
            renderResult = renderCommunityPage();
            break;
        case 'planner':
            renderResult = renderPlannerPage();
            break;
        case 'space':
            renderResult = renderSpacePage();
            break;
        case 'messages':
            renderResult = renderMessagesPage();
            break;
        case 'group-chat':
            renderResult = renderGroupChatPage();
            break;
        case 'dm-thread':
            renderResult = renderDMThreadPage();
            break;
        case 'profile':
            renderResult = renderProfilePage();
            break;
        case 'settings':
            renderResult = renderSettingsPage();
            break;
        case 'talk-to-someone':
            renderResult = renderTalkToSomeonePage();
            break;
        case 'view-profile':
            renderResult = renderViewProfilePage();
            break;
        case 'quiz':
            renderResult = renderQuizPage();
            break;
        case 'devotional':
            renderResult = renderDevotionalPage();
            break;
        case 'shared-space-post':
            renderResult = renderSharedSpacePostPage();
            break;
        case 'shared-plan':
            renderResult = renderSharedPlanPage();
            break;
        case 'shared-quiz':
            renderResult = renderSharedQuizPage();
            break;
        case 'shared-devotional':
            renderResult = renderSharedDevotionalPage();
            break;
        default:
            renderResult = renderHomePage();
    }

    // Exposed so callers that just called navigateTo() (e.g.
    // openBibleChapter jumping to a chapter for the first time) can await
    // the page's own async render/fetch work if they need to.
    AppState.lastRenderPromise = Promise.resolve(renderResult);

    // Restore this page's last scroll position once its content has
    // actually finished rendering (many pages render a skeleton first,
    // then fill in real content after an async fetch — restoring too
    // early gets clamped back to 0 by the shorter skeleton). Brand-new
    // pages simply have no saved position yet, so they naturally open
    // at the top.
    Promise.resolve(renderResult).then(() => {
        requestAnimationFrame(() => {
            if (AppState.currentRoute === route && DOM.pageContainer) {
                DOM.pageContainer.scrollTop = AppState.scrollPositions[route] || 0;
            }
        });
    }).catch((error) => {
        // Safety net: a render function is async and threw/rejected
        // (a transient network hiccup, an unexpected data shape, etc)
        // partway through — before this fix, that left whatever the
        // PREVIOUS page was frozen on screen with no visible error,
        // which looked exactly like "nothing happens when I tap Home".
        // Only touch the DOM if we're still on the route that failed —
        // the user may have already navigated elsewhere while this was
        // in flight.
        console.error(`Error rendering "${route}":`, error);
        if (AppState.currentRoute === route && DOM.pageContainer) {
            DOM.pageContainer.innerHTML = `
                <div class="text-center" style="padding: 80px 24px;">
                    <i class="fas fa-triangle-exclamation" style="font-size: 40px; opacity: 0.35; margin-bottom: 16px;"></i>
                    <h3 style="margin-bottom: 8px;">Something went wrong loading this page</h3>
                    <p class="text-muted" style="margin-bottom: 16px;">Please try again.</p>
                    <button class="btn btn-primary" onclick="navigateTo('${route}', { replace: true })">
                        <i class="fas fa-rotate-right"></i> Retry
                    </button>
                </div>
            `;
        }
    });

    // The "add post" button only makes sense on the Space page.
    if (DOM.spaceAddBtn) DOM.spaceAddBtn.classList.toggle('hidden', route !== 'space');
}

function updateNavigation(route) {
    // Update drawer links
    $$('.drawer-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.route === route) {
            link.classList.add('active');
        }
    });
    
    // Update bottom nav
    $$('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.route === route) {
            item.classList.add('active');
        }
    });
    
    // Update top bar title
    const titles = {
        home: 'GraceGuide',
        bible: 'Bible',
        ask: 'Shepherd',
        space: 'Space',
        community: 'Forum',
        planner: 'Study Planner',
        messages: 'Chats',
        profile: 'My Profile',
        settings: 'Settings',
        'talk-to-someone': 'Talk to Someone',
        'view-profile': AppState.viewedProfileName || 'Profile',
        quiz: 'Weekly Quiz',
        devotional: 'Daily Devotional',
        'shared-space-post': 'Shared Post',
        'shared-plan': 'Shared Plan',
        'shared-quiz': 'Shared Quiz Result',
        'shared-devotional': 'Shared Devotional'
    };
    const titleText = titles[route] || 'GraceGuide';
    // The two-tone "Grace"/"Guide" treatment only makes sense for the
    // literal app name (shown on Home) — every other page title is a
    // plain label ("Bible", "Settings", etc.) and should stay plain text.
    if (titleText === 'GraceGuide') {
        DOM.topBarTitle.innerHTML = 'Grace<span class="brand-guide">Guide</span>';
    } else {
        DOM.topBarTitle.textContent = titleText;
    }

    // The Back button only makes sense away from the 3 primary tabs —
    // those are always one tap away via the bottom nav, so a Back
    // button there would be redundant. It's most needed on sub-screens
    // (Bible, Profile, Chats, Settings, viewing someone else's profile,
    // etc.) since installed PWAs on iOS/desktop have no browser chrome
    // of their own to go back with.
    if (DOM.backBtn) {
        const isMainTab = MAIN_TAB_ROUTES.includes(route);
        DOM.backBtn.classList.toggle('hidden', isMainTab);
    }
}

const MAIN_TAB_ROUTES = ['home', 'ask', 'space'];

/**
 * Navigates one step back in the app's own history when there's
 * somewhere to go back to, otherwise falls back to Home. Used by the
 * top-bar Back button — plain history.back() alone isn't reliable here
 * since an installed/standalone PWA can have an empty or unusual
 * history stack (e.g. opened directly to a deep link).
 */
function goBack() {
    if (AppState.appNavDepth > 0) {
        history.back();
    } else {
        navigateTo('home');
    }
}

/* ---- PHASE 3: shared-content pages ----
   #/space/post/POST_ID  -> renderSharedSpacePostPage()  (features.js, reuses renderSpaceCard)
   #/planner/SHARE_ID    -> renderSharedPlanPage()        (below, reuses plannerShares public snapshots)
   #/quiz/QUIZ_ID         -> renderSharedQuizPage()        (quiz.js, reuses getSortedParticipants)
   #/devotional/SHARE_ID -> renderSharedDevotionalPage()  (below, reuses devotionalShares public snapshots)
   #/profile/USER_ID     -> reuses the existing renderViewProfilePage() directly, no new renderer needed. */

/** Shared "this link doesn't lead anywhere (anymore)" state, used by
    every one of the four new dedicated shared-content pages so invalid/
    deleted/expired links all get the same graceful, on-brand treatment
    instead of a blank page or a console error. */
function renderDeepLinkNotFound({ icon, title, message, ctaRoute, ctaLabel }) {
    return `
        <div class="text-center" style="padding: 80px 24px;">
            <i class="fas ${icon || 'fa-circle-question'}" style="font-size: 40px; opacity: 0.35; margin-bottom: 16px;"></i>
            <h3 style="margin-bottom: 8px;">${escapeHtml(title || "This link isn't available")}</h3>
            <p class="text-muted" style="margin-bottom: 20px;">${escapeHtml(message || 'It may have been removed, or the link might be incorrect.')}</p>
            <button class="btn btn-primary" onclick="navigateTo('${ctaRoute || 'home'}', { replace: true })">
                ${ctaLabel || 'Go to GraceGuide'}
            </button>
        </div>
    `;
}

/** #/planner/SHARE_ID — reads the PUBLIC plannerShares/{shareId} snapshot
    written by sharePlanCard() (js/sharecards.js), never the owner's
    private users/{uid}/planner data. Only ever shows the safe summary
    fields that snapshot contains (name, progress, streak, today's single
    passage) — there is no full day-by-day itinerary to expose here in
    the first place. */
async function renderSharedPlanPage() {
    const shareId = AppState.sharedPlanShareId;
    if (!shareId) { navigateTo('planner', { replace: true }); return; }

    DOM.pageContainer.innerHTML = `
        <div class="planner-container">
            <div class="skeleton" style="height: 240px; border-radius: 16px;"></div>
        </div>
    `;

    let share = null;
    try {
        const snap = await database.ref(`plannerShares/${shareId}`).once('value');
        share = snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error('Error loading shared plan:', error);
    }

    if (AppState.currentRoute !== 'shared-plan' || AppState.sharedPlanShareId !== shareId) return;

    if (!share) {
        DOM.pageContainer.innerHTML = renderDeepLinkNotFound({
            icon: 'fa-calendar-check',
            title: "This plan isn't available",
            message: 'The share link may be incorrect, or the plan may have been removed.',
            ctaRoute: 'planner',
            ctaLabel: 'Go to My Study Planner'
        });
        return;
    }

    DOM.pageContainer.innerHTML = `
        <div class="planner-container">
            <div class="card mb-3">
                <h3 style="font-weight: 700; margin-bottom: 4px;">${escapeHtml(share.name || 'Study Plan')}</h3>
                <p class="text-muted" style="font-size: 13px; margin-bottom: 16px;">Shared by ${escapeHtml(share.ownerName || 'a GraceGuide user')}</p>
                <div class="planner-stats">
                    <div class="stat-card">
                        <div class="stat-value">${share.progress || 0}%</div>
                        <div class="stat-label">Progress</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${share.streak || 0}</div>
                        <div class="stat-label">Day Streak</div>
                    </div>
                </div>
                ${share.currentPassage ? `
                    <div class="devotional-verse-block mt-3" ${share.currentPassage ? `onclick="openPassageReference('${escapeHtml(share.currentPassage).replace(/'/g, "\\'")}')"` : ''}>
                        <i class="fas fa-book-bible"></i>
                        <div>
                            <p class="devotional-verse-ref">Currently reading: ${escapeHtml(share.currentPassage)}</p>
                            ${share.currentTopic ? `<p style="font-size: 13px; color: var(--text-slate); margin-top: 4px;">${escapeHtml(share.currentTopic)}</p>` : ''}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="shared-content-cta">
                <p>Build your own personalized Bible reading plan on GraceGuide.</p>
                <button class="btn btn-primary btn-block" onclick="navigateTo('planner', { replace: true })">
                    <i class="fas fa-calendar-check"></i> Start Your Own Plan
                </button>
            </div>
        </div>
    `;
}

/** #/devotional/SHARE_ID — reads the PUBLIC devotionalShares/{shareId}
    snapshot written by shareDevotionalCard() (js/sharecards.js). That
    snapshot deliberately only ever contains title/verseReference/
    verseText/prayerPrompt — never the AI-personalized `body`, which can
    reference the owner's own reading/quiz/Ask activity (see
    buildDevotionalPersonalizationContext). There is no private data to
    accidentally expose here because the private version was never
    written to this public node in the first place. */
async function renderSharedDevotionalPage() {
    const shareId = AppState.sharedDevotionalShareId;
    if (!shareId) { navigateTo('home', { replace: true }); return; }

    DOM.pageContainer.innerHTML = `
        <div class="devotional-page-container">
            <div class="skeleton" style="height: 200px; border-radius: 16px; margin-bottom: 16px;"></div>
            <div class="skeleton" style="height: 140px; border-radius: 16px;"></div>
        </div>
    `;

    let share = null;
    try {
        const snap = await database.ref(`devotionalShares/${shareId}`).once('value');
        share = snap.exists() ? snap.val() : null;
    } catch (error) {
        console.error('Error loading shared devotional:', error);
    }

    if (AppState.currentRoute !== 'shared-devotional' || AppState.sharedDevotionalShareId !== shareId) return;

    if (!share) {
        DOM.pageContainer.innerHTML = renderDeepLinkNotFound({
            icon: 'fa-sun',
            title: "This devotional isn't available",
            message: 'The share link may be incorrect, or it may no longer be available.',
            ctaRoute: 'home',
            ctaLabel: 'Go to GraceGuide'
        });
        return;
    }

    const verseLink = typeof resolveVerseReferenceLink === 'function' ? resolveVerseReferenceLink(share.verseReference) : null;
    const safeBook = verseLink ? verseLink.book.replace(/'/g, "\\'") : '';

    DOM.pageContainer.innerHTML = `
        <div class="devotional-page-container">
            <div class="card devotional-hero">
                <div class="devotional-hero-icon"><i class="fas fa-sun"></i></div>
                <div class="devotional-hero-label">Daily Devotional</div>
                <h2 class="devotional-hero-title">${escapeHtml(share.title || "Today's Devotional")}</h2>
                <div class="devotional-hero-date">Shared by ${escapeHtml(share.ownerName || 'a GraceGuide user')}</div>
            </div>

            <div class="card mb-3">
                ${share.verseReference ? `
                    <div class="devotional-verse-block" ${verseLink ? `onclick="openBibleChapter('${safeBook}', ${verseLink.chapter})"` : ''}>
                        <i class="fas fa-book-bible"></i>
                        <div>
                            ${share.verseText ? `<p class="devotional-verse-text">"${escapeHtml(share.verseText)}"</p>` : ''}
                            <p class="devotional-verse-ref">${escapeHtml(share.verseReference)}${verseLink ? ' <i class="fas fa-chevron-right"></i>' : ''}</p>
                        </div>
                    </div>
                ` : ''}
                ${share.prayerPrompt ? `
                    <div class="devotional-prayer-block">
                        <i class="fas fa-hands-praying"></i>
                        <p>${escapeHtml(share.prayerPrompt)}</p>
                    </div>
                ` : ''}
            </div>

            <div class="shared-content-cta">
                <p>Get your own personalized daily devotional on GraceGuide.</p>
                <button class="btn btn-primary btn-block" onclick="navigateTo('home', { replace: true })">
                    <i class="fas fa-sun"></i> Get My Daily Devotional
                </button>
            </div>
        </div>
    `;
}

function openDrawer() {
    DOM.drawer.classList.add('open');
    DOM.drawerOverlay.classList.add('show');
    DOM.drawerOverlay.classList.remove('hidden');

    if (!AppState.drawerOpen) {
        history.pushState({ overlay: 'drawer' }, '');
    }
    AppState.drawerOpen = true;
}

function closeDrawer(fromPopstate = false) {
    DOM.drawer.classList.remove('open');
    DOM.drawerOverlay.classList.remove('show');
    DOM.drawerOverlay.classList.add('hidden');

    const wasOpen = AppState.drawerOpen;
    AppState.drawerOpen = false;

    if (wasOpen && !fromPopstate && history.state && history.state.overlay === 'drawer') {
        AppState.suppressNextPopstateNav = true;
        history.back();
    }
}

/* ============================================
   HOME PAGE
   ============================================ */
async function renderHomePage() {
    DOM.bottomNav.style.display = 'flex';
    DOM.drawer.style.display = 'flex';

    // Each of these hits the network/DB — wrapped individually so a
    // transient failure on ONE (e.g. the quiz competition read) can't
    // abort the whole page before it ever reaches the innerHTML
    // assignment below, which previously left the page looking blank/
    // frozen on whatever was showing before.
    let reflection;
    try {
        reflection = await getDailyReflection();
    } catch (error) {
        console.error('Error loading daily reflection:', error);
        reflection = "Take a moment today to pause and reflect on God's faithfulness in your life.";
    }
    AppState.todayReflection = reflection;

    let verse = null;
    try {
        verse = await getDailyVerse();
        AppState.todayVerse = verse;
    } catch (error) {
        console.error('Error loading daily verse:', error);
        verse = null;
    }

    let quizCardHTML;
    try {
        quizCardHTML = await renderHomeQuizCard();
    } catch (error) {
        console.error('Error loading quiz competition card:', error);
        quizCardHTML = '';
    }

    let devotional = null;
    try {
        devotional = await getTodayDevotional();
        AppState.todayDevotional = devotional;
    } catch (error) {
        console.error('Error loading daily devotional:', error);
        devotional = null;
    }
    const devotionalCardHTML = renderDailyDevotionalCard(devotional);

    let recommendationsHTML;
    try {
        recommendationsHTML = getPersonalizedRecommendations().map(rec => `
            <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06); cursor: pointer;" onclick="openBibleChapter('${rec.book}', ${rec.chapter})">
                <div>
                    <div style="font-weight: 600;">${rec.title}</div>
                    <div style="font-size: 12px; color: var(--text-slate);">${rec.reference} • ${rec.duration} min read</div>
                </div>
                <i class="fas fa-chevron-right" style="color: var(--text-slate);"></i>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error building recommendations:', error);
        recommendationsHTML = '';
    }

    // Bail out if the user navigated away while the above was loading —
    // otherwise we'd render Home's content into a container the user has
    // since moved on from.
    if (AppState.currentRoute !== 'home') return;

    DOM.pageContainer.innerHTML = `
        <div class="home-container" style="max-width: 768px; margin: 0 auto; padding: 16px;">
            <!-- Daily Devotional (before the quiz card until marked done) -->
            ${devotional && !devotional.completed ? devotionalCardHTML : ''}

            <!-- Weekly Bible Quiz: countdown / live / leaderboard -->
            ${quizCardHTML}
            
            <!-- Quick Actions -->
            <div class="flex gap-2 mb-4" style="overflow-x: auto; padding-bottom: 8px;">
                <button class="btn btn-secondary btn-sm" onclick="navigateTo('bible')">
                    <i class="fas fa-book-bible"></i> Read Bible
                </button>
                
                <button class="btn btn-gold btn-sm" onclick="navigateTo('planner')">
                    <i class="fas fa-calendar-check"></i> Study Planner
                </button>
                
            </div>

            <!-- Meet Shepherd -->
            <div class="card mb-4 shepherd-promo-card" onclick="navigateTo('ask')" style="cursor: pointer; display: flex; align-items: center; gap: 16px; background: linear-gradient(135deg, rgba(199,166,90,0.16), rgba(48,72,58,0.08)); border: 1px solid rgba(199,166,90,0.35);">
                <div style="width: 52px; height: 52px; flex-shrink: 0; border-radius: 50%; background: var(--primary-deep-olive); display: flex; align-items: center; justify-content: center;">
                    <i class="fas fa-dove" style="color: var(--bg-warm-ivory); font-size: 22px;"></i>
                </div>
                <div style="flex: 1;">
                    <h3 style="font-weight: 700; font-size: 16px; margin-bottom: 2px;">Talk with Shepherd</h3>
                    <p style="font-size: 13px; color: var(--text-slate); line-height: 1.4;">Your companion for questions, prayer, and study — ask anything, anytime.</p>
                </div>
                <i class="fas fa-chevron-right" style="color: var(--text-slate);"></i>
            </div>

            <!-- Reflection -->
            <div class="card mb-4">
                <div class="flex items-center gap-2 mb-3" style="justify-content: space-between;">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-lightbulb" style="color: var(--accent-muted-gold);"></i>
                        <h3 style="font-weight: 700; font-size: 18px;">Today's Reflection</h3>
                    </div>
                    ${verse ? `
                        <button class="icon-btn" onclick="shareDailyVerseCard(AppState.todayVerse)" aria-label="Share today's verse" title="Share today's verse">
                            <i class="fas fa-share"></i>
                        </button>
                    ` : ''}
                </div>
                <p style="color: var(--text-slate); line-height: 1.7;">${reflection}</p>
                <button class="btn btn-outline btn-sm mt-3" onclick="discussReflectionWithShepherd()">
                    <i class="fas fa-dove"></i> Discuss with Shepherd
                </button>
            </div>

            <!-- Daily Devotional (moved here once marked done) -->
            ${devotional && devotional.completed ? devotionalCardHTML : ''}
            
            <!-- Recommended Reading -->
            <div class="card">
                <h3 style="font-weight: 700; margin-bottom: 16px;">Recommended for You</h3>
                <div id="recommendations-list">
                    ${recommendationsHTML}
                </div>
            </div>
        </div>
    `;

    startQuizCountdownTicker(() => renderHomePage());
    if (typeof initLeaderboardCarouselSwipe === 'function') initLeaderboardCarouselSwipe();
}

async function getDailyVerse() {
    const verses = [
        { text: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.", reference: "Jeremiah 29:11" },
        { text: "Trust in the Lord with all your heart and lean not on your own understanding.", reference: "Proverbs 3:5" },
        { text: "I can do all things through Christ who strengthens me.", reference: "Philippians 4:13" },
        { text: "The Lord is my shepherd; I shall not want.", reference: "Psalm 23:1" },
        { text: "Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.", reference: "Joshua 1:9" },
        { text: "Come to me, all you who are weary and burdened, and I will give you rest.", reference: "Matthew 11:28" }
    ];
    
    // Use day of year for consistency
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 0);
    const diff = now - start;
    const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    return verses[dayOfYear % verses.length];
}

async function getDailyReflection() {
    const todayKey = dayKey(Date.now());

    // Reuse today's reflection if we've already generated one — for
    // signed-in users that's stored in Firebase (stable across their
    // devices), for guests it's just localStorage. Either way, this
    // keeps the AI call to once per day per person rather than once per
    // page load.
    try {
        const cached = AppState.currentUser
            ? (await database.ref(`users/${AppState.currentUser.uid}/dailyReflection`).once('value')).val()
            : JSON.parse(localStorage.getItem('graceguide_daily_reflection') || 'null');
        if (cached && cached.date === todayKey && cached.text) {
            return cached.text;
        }
    } catch (error) {
        console.error('Error reading cached daily reflection:', error);
    }

    let text;
    try {
        text = await generateDailyReflectionWithAI();
    } catch (error) {
        console.error('Error generating daily reflection, using fallback pool:', error);
        text = pickFallbackReflection(todayKey);
    }

    const entry = { date: todayKey, text };
    try {
        if (AppState.currentUser) {
            await database.ref(`users/${AppState.currentUser.uid}/dailyReflection`).set(entry);
        } else {
            localStorage.setItem('graceguide_daily_reflection', JSON.stringify(entry));
        }
    } catch (error) {
        console.error('Error caching daily reflection:', error);
    }

    return text;
}

async function generateDailyReflectionWithAI() {
    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: "You write short daily devotional reflections for a Christian Bible app. Warm, encouraging, biblically grounded tone. 3-4 sentences. Ground it in a specific biblical truth, story, or principle — vary which one each time rather than defaulting to generic encouragement. End with a brief, concrete invitation to pray, reflect, or act. Plain text only: no greeting, no sign-off, no markdown, no surrounding quotation marks."
                },
                { role: 'user', content: "Write today's devotional reflection." }
            ],
            temperature: 1.0,
            max_tokens: 220
        })
    });
    if (!response.ok) throw new Error(`AI request failed (${response.status})`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content?.trim().replace(/^["']+|["']+$/g, '');
    if (!text) throw new Error('Empty AI response');
    return text;
}

// Only reached if the AI call itself fails (offline, API error, etc.) —
// a much larger pool than before so even this fallback path takes weeks,
// not days, to repeat. Picked by a stable hash of the date rather than
// day-of-year % length, so the sequence doesn't reset every Jan 1st.
function pickFallbackReflection(dateKey) {
    const reflections = [
        "Take a moment today to pause and reflect on God's faithfulness in your life. Even in the midst of challenges, He is working all things together for your good. Consider journaling three things you're grateful for.",
        "God's love for you is not based on your performance. Rest in the truth that you are deeply loved and fully known. Let this assurance free you to live boldly and love others well.",
        "In a world full of noise, find time to be still and know that He is God. Your soul needs rest. Schedule intentional quiet time today, even if it's just five minutes.",
        "Consider the areas of your life where you need God's wisdom. He promises to give wisdom generously to those who ask. Bring your decisions before Him in prayer today.",
        "Your identity is found in Christ, not in what you do or what others think of you. Meditate on who God says you are: loved, chosen, forgiven, and called for a purpose.",
        "Joseph waited years between the dream and its fulfillment, betrayed and forgotten along the way — yet God was quietly positioning him the whole time. If your season feels delayed, it may not be denied. Ask God to help you trust His timing today.",
        "The widow at Zarephath gave from her last handful of flour before she saw the miracle. Faith often means obeying before the provision is visible. Where is God asking you to take a step before you can see the outcome?",
        "Peter walked on water only as long as his eyes stayed on Jesus rather than the waves. The storm around you may be real, but so is the One who's still with you in it. Name one 'wave' you've been staring at, and consciously turn your attention back to Him.",
        "David danced before the Lord without worrying who was watching. Worship isn't a performance — it's a response to who God is. Let today have one unguarded moment of gratitude toward Him.",
        "Elijah expected God in the earthquake and fire, but found Him in a still, small voice. Sometimes we miss God because we're listening for something loud. Spend a few quiet minutes today simply listening.",
        "The prodigal's father ran to meet him while he was still a long way off. Grace moves toward us before we've finished explaining ourselves. If shame has kept you at a distance from God, today is a good day to stop rehearsing your case and just come home.",
        "Nehemiah rebuilt a wall while holding a trowel in one hand and a weapon in the other — steady work alongside real opposition. Progress rarely means the resistance disappears; it means you keep building anyway. What's one thing you can keep working at today despite the friction?",
        "Ruth chose loyalty to Naomi when she had every reason to go back to what was familiar and comfortable. Faithfulness often looks like staying committed when leaving would be easier. Is there a relationship or commitment God is asking you to stay faithful to?",
        "Gideon's army was cut down to 300 so it would be obvious the victory wasn't about numbers. When your resources feel too small for the task, that's often exactly where God does His clearest work. Bring your 'not enough' to Him today instead of hiding it.",
        "Paul learned to be content whether he had plenty or little — contentment was something he learned, not something he was simply born with. It's a skill built through practice, not a personality trait some people luck into. What's one thing you have today that you can choose to be grateful for, regardless of circumstance?",
        "Hannah prayed so fervently that Eli mistook her for drunk — she brought her raw, wordless grief straight to God rather than polishing it first. He can handle your unfiltered prayers. Don't wait until you know how to say it right; just bring it as it is.",
        "Thomas needed to see before he'd believe, and Jesus met him there instead of shaming him for it. Doubt honestly brought to God isn't the opposite of faith — it's often the doorway into a deeper one. If you have questions today, bring them to Him rather than burying them.",
        "The Israelites had to actually step into the Jordan before the water parted. Sometimes obedience has to come before the breakthrough, not after it. What's one step of obedience you've been waiting to take until you feel more certain?",
        "Mary chose to sit and listen while Martha stayed busy with preparations — and Jesus said Mary had chosen what was better. Productivity isn't always the same as presence. Where could you trade a task today for a few unhurried minutes with God?",
        "Job never got the explanation he demanded, but he did get God Himself — and that turned out to be enough. Not every hard season resolves with a tidy answer. If you're in a season without answers, ask God for His presence even more than His explanations.",
        "The Good Samaritan stopped for someone his culture told him to walk past. Love that only shows up for people like us isn't yet the love the Bible describes. Who is one person outside your usual circle you could show kindness to today?",
        "Moses argued with God about his own inadequacy right up until he finally agreed to go. God rarely calls the qualified — He qualifies the called. Where have you been holding back because you don't feel ready enough?",
        "Daniel kept praying with his windows open even after it became illegal to do so. Consistency in private devotion is what steadies you when public pressure arrives. Is there a small daily practice with God worth protecting, even when it's inconvenient?",
        "The woman who touched Jesus' robe in a crowd believed a small act of reaching out was enough. You don't need a dramatic gesture of faith — a quiet, honest reach toward God today is enough to be noticed by Him.",
        "Esther was told she may have come to her position 'for such a time as this.' The specific place you're in today — however ordinary — may be exactly where God intends to use you. Ask Him to show you one way to be useful right where you are."
    ];

    let hash = 0;
    for (let i = 0; i < dateKey.length; i++) hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
    return reflections[hash % reflections.length];
}

/* ============================================
   DAILY DEVOTIONAL (personalized, signed-in users only)
   ============================================
   One AI-generated devotional per signed-in user per calendar day,
   saved to users/{uid}/devotionals/{YYYY-MM-DD} (private to that user —
   it falls under the general users/$uid rule, no other user can read
   it). Cache-first: once today's entry exists, every re-render reads it
   straight from Firebase instead of calling the AI again. Guests never
   get one — this is an explicitly personalized feature, there's nothing
   meaningful to personalize without a signed-in profile.
   ============================================ */

/** Returns today's devotional for the signed-in user, generating and
    saving one via AI on the first load of the day. Returns null for
    guests, or (rarely) if even the fallback path throws — callers must
    treat null as "don't show the card/page" and never let this break
    the rest of the app. */
async function getTodayDevotional() {
    if (!AppState.currentUser) return null;
    const uid = AppState.currentUser.uid;
    const todayKey = dayKey(Date.now());

    try {
        const snap = await database.ref(`users/${uid}/devotionals/${todayKey}`).once('value');
        const existing = snap.val();
        if (existing) return existing;
    } catch (error) {
        console.error("Error reading today's devotional:", error);
        // Fall through and try to generate one anyway — worst case this
        // regenerates once more than necessary this session.
    }

    let devotional;
    try {
        const [personalContext, continuityEntries] = await Promise.all([
            buildDevotionalPersonalizationContext(),
            fetchDevotionalContinuityContext(uid, todayKey)
        ]);
        devotional = await generateDevotionalWithAI(personalContext, continuityEntries, todayKey);
        devotional.source = 'ai';
    } catch (error) {
        console.error('Error generating devotional via AI, using fallback:', error);
        devotional = pickFallbackDevotional(todayKey);
        devotional.source = 'fallback';
    }

    devotional.date = todayKey;
    devotional.completed = false;
    devotional.completedAt = null;
    devotional.generatedAt = Date.now();

    try {
        await database.ref(`users/${uid}/devotionals/${todayKey}`).set(devotional);
    } catch (error) {
        console.error("Error saving today's devotional:", error);
        // Still hand back what we generated so this session's card/page
        // has something to show, even though a save failure means
        // it'll likely regenerate again on the next load.
    }

    return devotional;
}

/** A compact list of the last few days' devotional titles/themes (not
    full bodies — keeps the prompt small) so the AI can naturally build
    on a recent thread if one fits, without repeating itself. */
async function fetchDevotionalContinuityContext(uid, excludeDateKey) {
    try {
        const snap = await database.ref(`users/${uid}/devotionals`).orderByKey().limitToLast(4).once('value');
        const raw = snap.val() || {};
        return Object.values(raw)
            .filter(d => d.date !== excludeDateKey)
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 3)
            .map(d => ({ date: d.date, title: d.title, themes: d.themes || [] }));
    } catch (error) {
        console.error('Error fetching devotional continuity context:', error);
        return [];
    }
}

/** Compiles what the AI should know about this specific user to
    personalize today's devotional. Reuses Shepherd's own
    buildShepherdUserContext() (features.js) for the bulk of it — reading
    history, study plan, Space activity, Brethren/forum counts, etc. —
    and adds the handful of signals that builder doesn't include: actual
    Ask/Shepherd conversation topics (not just a count), recent quiz
    performance, and top interest tags/books. */
async function buildDevotionalPersonalizationContext() {
    const base = typeof buildShepherdUserContext === 'function' ? await buildShepherdUserContext() : '';
    const lines = [];

    const recentTopics = (AppState.aiConversations || [])
        .slice(-5)
        .map(c => c.title)
        .filter(Boolean);
    if (recentTopics.length > 0) {
        lines.push(`Recent topics they've asked Shepherd about: ${recentTopics.join('; ')}.`);
    }

    try {
        const uid = AppState.currentUser.uid;
        const [historySnap, allTimeSnap] = await Promise.all([
            database.ref(`users/${uid}/quizHistory`).orderByKey().limitToLast(1).once('value'),
            database.ref(`quizLeaderboardAllTime/${uid}`).once('value')
        ]);
        const lastRound = Object.values(historySnap.val() || {})[0];
        const allTime = allTimeSnap.val();
        if (lastRound) lines.push(`Most recent Weekly Bible Quiz result: ${lastRound.score}/${lastRound.total} (${lastRound.percentage}%).`);
        if (allTime) lines.push(`Overall quiz participation: ${allTime.totalQuizzes} quiz(zes) taken, ${allTime.accumulatedPercentage}% accumulated score.`);
    } catch (error) {
        console.error('Error adding quiz context to devotional:', error);
    }

    const profile = AppState.interestProfile;
    if (profile) {
        const topOf = (bucket) => Object.entries(bucket || {})
            .filter(([key]) => key !== '_seed')
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([key]) => key);
        const topTags = topOf(profile.tags);
        const topBooks = topOf(profile.books);
        if (topTags.length > 0) lines.push(`Topics they engage with most: ${topTags.join(', ')}.`);
        if (topBooks.length > 0) lines.push(`Books of the Bible they read most: ${topBooks.join(', ')}.`);
    }

    return [base, ...lines].filter(Boolean).join('\n');
}

async function generateDevotionalWithAI(personalContext, continuityEntries, dateKey) {
    const continuityText = continuityEntries.length > 0
        ? `Their recent devotionals, for natural continuity (don't repeat these — build on one only if it genuinely fits, otherwise ignore):\n${continuityEntries.map(e => `- ${e.date}: "${e.title}" (themes: ${(e.themes || []).join(', ') || 'none recorded'})`).join('\n')}`
        : 'No previous devotionals on record yet.';

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `You are Shepherd, writing a short, warm, biblically grounded daily devotional for a specific user of the GraceGuide Bible app. Personalize it using the context given, but weave it in naturally and only where it genuinely fits — don't recite their stats back at them or force a connection to every detail. If a previous devotional's theme naturally continues today, you may build on it briefly without repeating it. If nothing personal fits well, still write a solid, grounded devotional.

Respond with ONLY valid JSON — no markdown, no code fences, no commentary — matching exactly this shape:
{"title": "3-6 word title", "body": "2-4 short paragraphs of devotional content separated by \\n\\n", "verseReference": "e.g. Philippians 4:6-7", "verseText": "short quote or close paraphrase of that passage, under 30 words", "prayerPrompt": "one short, concrete prayer or action prompt, 1-2 sentences", "themes": ["2-4 short lowercase theme words"]}`
                },
                {
                    role: 'user',
                    content: `Today's date: ${dateKey}\n\n${personalContext}\n\n${continuityText}\n\nWrite today's devotional.`
                }
            ],
            temperature: 0.9,
            max_tokens: 500
        })
    });

    if (!response.ok) throw new Error(`AI request failed (${response.status})`);
    const data = await response.json();
    let raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error('Empty AI response');
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(objectMatch ? objectMatch[0] : raw);
    if (!parsed.title || !parsed.body) throw new Error('Malformed devotional response');

    return {
        title: String(parsed.title).trim(),
        body: String(parsed.body).trim(),
        verseReference: parsed.verseReference ? String(parsed.verseReference).trim() : '',
        verseText: parsed.verseText ? String(parsed.verseText).trim() : '',
        prayerPrompt: parsed.prayerPrompt ? String(parsed.prayerPrompt).trim() : '',
        themes: Array.isArray(parsed.themes) ? parsed.themes.slice(0, 4).map(t => String(t).trim().toLowerCase()).filter(Boolean) : []
    };
}

// Only ever reached if the AI call itself fails (offline, API error,
// malformed response, etc). A modest pool keyed off a stable hash of
// the date, same approach as pickFallbackReflection above — not
// personalized (there's no AI call to personalize it with), but enough
// to keep the homepage/devotional page working through an outage.
function pickFallbackDevotional(dateKey) {
    const pool = [
        {
            title: 'Steady in the Waiting',
            body: "Some seasons ask you to move; others ask you to wait well. Waiting isn't wasted time when your heart stays anchored in trust rather than anxiety.\n\nGod is rarely as slow as it feels — He's often doing quiet work in you before He does visible work through you.",
            verseReference: 'Isaiah 40:31',
            verseText: 'Those who hope in the Lord will renew their strength; they will soar on wings like eagles.',
            prayerPrompt: "Bring one thing you're waiting on to God today, and ask Him for patience rather than a timeline.",
            themes: ['patience', 'trust']
        },
        {
            title: 'Known Before Performance',
            body: "It's easy to treat God's love like a wage — something earned by getting it right. But His love reached you before you'd done anything to deserve it, and it doesn't fluctuate with your performance.\n\nLet that settle your striving today. You're not working to be loved; you're working from a place of already being loved.",
            verseReference: 'Romans 5:8',
            verseText: 'While we were still sinners, Christ died for us.',
            prayerPrompt: 'Thank God today for one specific way He has loved you that you did nothing to earn.',
            themes: ['grace', 'identity']
        },
        {
            title: 'A Quiet Place',
            body: "Noise has a way of crowding out the still, small voice. Not because God stops speaking, but because we stop listening.\n\nA few unhurried minutes of quiet aren't a luxury for the spiritually advanced — they're an ordinary, available doorway into hearing Him more clearly.",
            verseReference: 'Psalm 46:10',
            verseText: 'Be still, and know that I am God.',
            prayerPrompt: 'Set aside five uninterrupted minutes today with no agenda except being still before God.',
            themes: ['stillness', 'prayer']
        },
        {
            title: 'Wisdom for the Decision',
            body: "Whatever decision is sitting in front of you right now, you don't have to make it in your own strength alone. Wisdom is something God gives generously, not grudgingly, to anyone who genuinely asks.\n\nBring the specific decision to Him, not just a vague request for guidance in general.",
            verseReference: 'James 1:5',
            verseText: 'If any of you lacks wisdom, let him ask God, who gives generously to all without reproach.',
            prayerPrompt: 'Name one real decision you\'re facing and specifically ask God for wisdom about it today.',
            themes: ['wisdom', 'guidance']
        },
        {
            title: 'Enough for Today',
            body: "Manna in the wilderness only kept for a day — God provided exactly enough, not a stockpile for the future. It's a strange kind of provision that asks you to trust Him again tomorrow rather than settle in on today's supply.\n\nWhatever you need today, ask for today's portion. Tomorrow will have its own.",
            verseReference: 'Matthew 6:34',
            verseText: 'Do not worry about tomorrow, for tomorrow will worry about itself.',
            prayerPrompt: 'Name one worry about the future you can consciously hand over to God today, just for today.',
            themes: ['trust', 'provision']
        },
        {
            title: 'Strength in Weakness',
            body: "Paul asked three times for his weakness to be removed, and the answer wasn't removal — it was a promise that grace would be enough for it. Sometimes God's power shows up most clearly precisely where we're not strong enough on our own.\n\nWhatever weakness you're tempted to hide today, it may be exactly where His strength wants to meet you.",
            verseReference: '2 Corinthians 12:9',
            verseText: 'My grace is sufficient for you, for my power is made perfect in weakness.',
            prayerPrompt: 'Name one area of weakness honestly before God today instead of trying to hide or fix it alone.',
            themes: ['weakness', 'grace']
        }
    ];

    let hash = 0;
    for (let i = 0; i < dateKey.length; i++) hash = (hash * 31 + dateKey.charCodeAt(i)) >>> 0;
    return { ...pool[hash % pool.length] };
}

/** Home page card — position handled by the caller (renderHomePage):
    shown just before the quiz card while incomplete, and moved to just
    after Today's Reflection once marked done. Clicking anywhere on it
    opens the full devotional page. */
function renderDailyDevotionalCard(devotional) {
    if (!devotional) return '';
    const preview = truncate((devotional.body || '').replace(/\s*\n+\s*/g, ' ').trim(), 100);
    return `
        <div class="card mb-4 devotional-card ${devotional.completed ? 'devotional-card-done' : ''}" onclick="navigateTo('devotional')">
            <div class="devotional-card-header">
                <div class="devotional-card-icon"><i class="fas fa-sun"></i></div>
                <div class="devotional-card-heading">
                    <div class="devotional-card-label">Daily Devotional</div>
                    <div class="devotional-card-title">${escapeHtml(devotional.title || "Today's Devotional")}</div>
                </div>
                ${devotional.completed
                    ? `<span class="devotional-card-done-badge" title="Completed"><i class="fas fa-check"></i></span>`
                    : `<i class="fas fa-chevron-right devotional-card-chevron"></i>`
                }
            </div>
            <p class="devotional-card-preview">${escapeHtml(preview)}</p>
        </div>
    `;
}

async function renderDevotionalPage() {
    if (!AppState.currentUser) {
        DOM.pageContainer.innerHTML = `
            <div class="text-center" style="padding: 80px 24px;">
                <i class="fas fa-sun" style="font-size: 40px; opacity: 0.35; margin-bottom: 16px;"></i>
                <h3 style="margin-bottom: 8px;">Sign in for your daily devotional</h3>
                <p class="text-muted" style="margin-bottom: 16px;">Devotionals are personalized to you, so they're only available when you're signed in.</p>
                <button class="btn btn-primary" onclick="showAuthModal({message: 'Sign in to get your daily devotional.'})">Sign In</button>
            </div>
        `;
        return;
    }

    const todayKey = dayKey(Date.now());
    if (!AppState.todayDevotional || AppState.todayDevotional.date !== todayKey) {
        DOM.pageContainer.innerHTML = `
            <div class="devotional-page-container">
                <div class="skeleton" style="height: 200px; border-radius: 16px; margin-bottom: 16px;"></div>
                <div class="skeleton" style="height: 140px; border-radius: 16px;"></div>
            </div>
        `;
        try {
            AppState.todayDevotional = await getTodayDevotional();
        } catch (error) {
            console.error('Error loading devotional page:', error);
            AppState.todayDevotional = null;
        }
    }

    if (AppState.currentRoute !== 'devotional') return; // navigated away while loading

    const devotional = AppState.todayDevotional;
    if (!devotional) {
        DOM.pageContainer.innerHTML = `
            <div class="text-center" style="padding: 80px 24px;">
                <i class="fas fa-triangle-exclamation" style="font-size: 40px; opacity: 0.35; margin-bottom: 16px;"></i>
                <h3 style="margin-bottom: 8px;">Couldn't load today's devotional</h3>
                <p class="text-muted" style="margin-bottom: 16px;">Please try again in a moment.</p>
                <button class="btn btn-primary" onclick="navigateTo('devotional', { replace: true })"><i class="fas fa-rotate-right"></i> Retry</button>
            </div>
        `;
        return;
    }

    const paragraphs = (devotional.body || '').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
    const verseLink = typeof resolveVerseReferenceLink === 'function' ? resolveVerseReferenceLink(devotional.verseReference) : null;
    const safeBook = verseLink ? verseLink.book.replace(/'/g, "\\'") : '';

    DOM.pageContainer.innerHTML = `
        <div class="devotional-page-container">
            <div class="card devotional-hero">
                <div class="devotional-hero-icon"><i class="fas fa-sun"></i></div>
                <div class="devotional-hero-label">Daily Devotional</div>
                <h2 class="devotional-hero-title">${escapeHtml(devotional.title || "Today's Devotional")}</h2>
                <div class="devotional-hero-date">${formatDate(devotional.generatedAt || Date.now())}</div>
            </div>

            <div class="card mb-3">
                ${paragraphs.map(p => `<p class="devotional-paragraph">${escapeHtml(p)}</p>`).join('')}
                ${devotional.verseReference ? `
                    <div class="devotional-verse-block" ${verseLink ? `onclick="openBibleChapter('${safeBook}', ${verseLink.chapter})"` : ''}>
                        <i class="fas fa-book-bible"></i>
                        <div>
                            ${devotional.verseText ? `<p class="devotional-verse-text">"${escapeHtml(devotional.verseText)}"</p>` : ''}
                            <p class="devotional-verse-ref">${escapeHtml(devotional.verseReference)}${verseLink ? ' <i class="fas fa-chevron-right"></i>' : ''}</p>
                        </div>
                    </div>
                ` : ''}
                ${devotional.prayerPrompt ? `
                    <div class="devotional-prayer-block">
                        <i class="fas fa-hands-praying"></i>
                        <p>${escapeHtml(devotional.prayerPrompt)}</p>
                    </div>
                ` : ''}
            </div>

            <div class="flex gap-2 mb-4">
                <button class="btn ${devotional.completed ? 'btn-outline' : 'btn-primary'}" style="flex: 1;" ${devotional.completed ? 'disabled' : ''} onclick="markDevotionalDone()">
                    <i class="fas ${devotional.completed ? 'fa-check' : 'fa-circle-check'}"></i> ${devotional.completed ? 'Completed' : 'Mark as Done'}
                </button>
                <button class="btn btn-outline" style="flex: 1;" onclick="discussDevotionalWithShepherd()">
                    <i class="fas fa-dove"></i> Discuss with Shepherd
                </button>
            </div>
            <button class="btn btn-outline btn-block mb-4" onclick="shareDevotionalCard(AppState.todayDevotional)">
                <i class="fas fa-share"></i> Share Devotional
            </button>
        </div>
    `;
}

async function markDevotionalDone() {
    if (!AppState.currentUser || !AppState.todayDevotional || AppState.todayDevotional.completed) return;
    const uid = AppState.currentUser.uid;
    const todayKey = dayKey(Date.now());
    const completedAt = Date.now();

    AppState.todayDevotional.completed = true;
    AppState.todayDevotional.completedAt = completedAt;

    try {
        await database.ref(`users/${uid}/devotionals/${todayKey}`).update({ completed: true, completedAt });
        showToast('Devotional marked as done', 'success');
    } catch (error) {
        console.error('Error marking devotional done:', error);
        showToast('Could not save — please try again.', 'error');
        AppState.todayDevotional.completed = false;
        AppState.todayDevotional.completedAt = null;
        return;
    }

    // Re-render whichever of the two places that show it is currently
    // on screen, so its state/position updates immediately.
    if (AppState.currentRoute === 'devotional') renderDevotionalPage();
    else if (AppState.currentRoute === 'home') renderHomePage();
}

/* ============================================
   BIBLE PAGE
   ============================================ */
const BIBLE_VERSION_LABELS = {
    KJV: 'King James Version',
    NLT: 'New Living Translation',
    MSG: 'The Message',
    AMP: 'Amplified Bible'
};

// api.bible identifies books by USFM codes rather than full names.
const USFM_BOOK_IDS = {
    'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM', 'Deuteronomy': 'DEU',
    'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT', '1 Samuel': '1SA', '2 Samuel': '2SA',
    '1 Kings': '1KI', '2 Kings': '2KI', '1 Chronicles': '1CH', '2 Chronicles': '2CH', 'Ezra': 'EZR',
    'Nehemiah': 'NEH', 'Esther': 'EST', 'Job': 'JOB', 'Psalm': 'PSA', 'Proverbs': 'PRO',
    'Ecclesiastes': 'ECC', 'Song of Solomon': 'SNG', 'Isaiah': 'ISA', 'Jeremiah': 'JER', 'Lamentations': 'LAM',
    'Ezekiel': 'EZK', 'Daniel': 'DAN', 'Hosea': 'HOS', 'Joel': 'JOL', 'Amos': 'AMO',
    'Obadiah': 'OBA', 'Jonah': 'JON', 'Micah': 'MIC', 'Nahum': 'NAM', 'Habakkuk': 'HAB',
    'Zephaniah': 'ZEP', 'Haggai': 'HAG', 'Zechariah': 'ZEC', 'Malachi': 'MAL',
    'Matthew': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK', 'John': 'JHN', 'Acts': 'ACT',
    'Romans': 'ROM', '1 Corinthians': '1CO', '2 Corinthians': '2CO', 'Galatians': 'GAL', 'Ephesians': 'EPH',
    'Philippians': 'PHP', 'Colossians': 'COL', '1 Thessalonians': '1TH', '2 Thessalonians': '2TH',
    '1 Timothy': '1TI', '2 Timothy': '2TI', 'Titus': 'TIT', 'Philemon': 'PHM', 'Hebrews': 'HEB',
    'James': 'JAS', '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JN', '2 John': '2JN',
    '3 John': '3JN', 'Jude': 'JUD', 'Revelation': 'REV'
};

function getUSFMBookId(book) {
    return USFM_BOOK_IDS[book] || null;
}

const BIBLE_BOOK_CHAPTERS = {
    'Genesis': 50, 'Exodus': 40, 'Leviticus': 27, 'Numbers': 36, 'Deuteronomy': 34,
    'Joshua': 24, 'Judges': 21, 'Ruth': 4, '1 Samuel': 31, '2 Samuel': 24,
    '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, 'Ezra': 10,
    'Nehemiah': 13, 'Esther': 10, 'Job': 42, 'Psalm': 150, 'Proverbs': 31,
    'Ecclesiastes': 12, 'Song of Solomon': 8, 'Isaiah': 66, 'Jeremiah': 52, 'Lamentations': 5,
    'Ezekiel': 48, 'Daniel': 12, 'Hosea': 14, 'Joel': 3, 'Amos': 9,
    'Obadiah': 1, 'Jonah': 4, 'Micah': 7, 'Nahum': 3, 'Habakkuk': 3,
    'Zephaniah': 3, 'Haggai': 2, 'Zechariah': 14, 'Malachi': 4,
    'Matthew': 28, 'Mark': 16, 'Luke': 24, 'John': 21, 'Acts': 28,
    'Romans': 16, '1 Corinthians': 16, '2 Corinthians': 13, 'Galatians': 6, 'Ephesians': 6,
    'Philippians': 4, 'Colossians': 4, '1 Thessalonians': 5, '2 Thessalonians': 3,
    '1 Timothy': 6, '2 Timothy': 4, 'Titus': 3, 'Philemon': 1, 'Hebrews': 13,
    'James': 5, '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1,
    '3 John': 1, 'Jude': 1, 'Revelation': 22
};

function getBookChapterCount(book) {
    return BIBLE_BOOK_CHAPTERS[book] || 1;
}

/**
 * Parse a free-form Bible reference like "Romans 8:28-39", "Psalm 23",
 * "1 Corinthians 13:4-7", or "John 3:16" into { book, chapter, verse }.
 * Returns null if no known book name can be matched.
 */
function parsePassageReference(passage) {
    if (!passage || typeof passage !== 'string') return null;

    const match = passage.trim().match(/^((?:[1-3]\s+)?[A-Za-z][A-Za-z ]*?)\s+(\d+)(?::(\d+))?/);
    if (!match) return null;

    const rawBook = match[1].trim();
    const chapter = parseInt(match[2], 10) || 1;
    const verse = match[3] ? parseInt(match[3], 10) : null;

    // Match case-insensitively against the known list of books.
    const books = getBibleBooks();
    const book = books.find(b => b.toLowerCase() === rawBook.toLowerCase())
        || books.find(b => b.toLowerCase().startsWith(rawBook.toLowerCase()));

    if (!book) return null;
    return { book, chapter, verse };
}

/**
 * Entry point registered by the router for the "bible" route. Decides
 * which of the three navigation levels to show:
 *   1. Books  — grid of all 66 books (Old + New Testament)
 *   2. Chapters — grid of chapter numbers for the chosen book
 *   3. Reader — the actual chapter text
 * This replaces the old dropdown-based navigation with a tap-through
 * flow (book → chapter → reader), and it deliberately does NOT fetch
 * anything from api.bible until the user picks an exact chapter — every
 * screen before that is free, which is the whole point: it stops the
 * app from pulling data it doesn't need yet and burning API calls.
 */
function renderBiblePage() {
    clearVerseSelectionBar();
    if (AppState.bibleView === 'reader' && AppState.currentBook && AppState.currentChapter) {
        return renderBibleReaderView(AppState.currentBook, AppState.currentChapter);
    } else if (AppState.bibleView === 'chapters' && AppState.currentBook) {
        renderBibleChapterListView(AppState.currentBook);
    } else if (AppState.bibleView === null && AppState.readingHistory.length > 0) {
        // First time opening the Bible tab this session — resume exactly
        // where the user left off instead of forcing them back through
        // the book list every time.
        const lastRead = AppState.readingHistory[AppState.readingHistory.length - 1];
        if (lastRead && lastRead.book && lastRead.chapter) {
            return renderBibleReaderView(lastRead.book, lastRead.chapter);
        }
        renderBibleBookListView();
    } else {
        renderBibleBookListView();
    }
}

/**
 * Shared header used at all three navigation levels: translation
 * picker, search, and (in the reader) bookmark/font controls, plus a
 * back button whenever we're not at the top level.
 */
function bibleTopBarHTML(context) {
    let backBtn = '';
    if (context === 'chapters') {
        backBtn = `<button class="icon-btn bible-back-btn" onclick="renderBibleBookListView()" aria-label="Back to books"><i class="fas fa-chevron-left"></i></button>`;
    } else if (context === 'reader') {
        const book = (AppState.currentBook || '').replace(/'/g, "\\'");
        backBtn = `<button class="icon-btn bible-back-btn" onclick="renderBibleChapterListView('${book}')" aria-label="Back to chapters"><i class="fas fa-chevron-left"></i></button>`;
    }

    return `
        <div class="bible-header">
            <div style="display: flex; gap: 8px; align-items: center;">
                ${backBtn}
                <select id="bible-version-select" class="form-select" style="min-width: 110px;">
                    ${AppState.cachedBibleVersions.map(v => `<option value="${v}" ${v === AppState.bibleVersion ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
                <button id="search-bible-btn" class="btn btn-outline btn-sm" aria-label="Search">
                    <i class="fas fa-search"></i>
                </button>
            </div>
            <div style="display: flex; gap: 8px;">
                ${context === 'reader' ? `
                    <button id="bookmark-chapter-btn" class="btn btn-outline btn-sm" aria-label="Bookmark chapter">
                        <i class="fas fa-bookmark"></i>
                    </button>
                ` : ''}
                <button id="font-size-btn" class="btn btn-outline btn-sm" aria-label="Font size">
                    <i class="fas fa-font"></i>
                </button>
            </div>
        </div>
    `;
}

function bindBibleTopBarEvents(context) {
    $('#bible-version-select').addEventListener('change', (e) => {
        AppState.bibleVersion = e.target.value;
        // Persist so the choice survives a reload instead of resetting to KJV.
        localStorage.setItem('graceguide_bible_version', e.target.value);
        showToast(`Bible version set to ${e.target.value}`, 'success');
        if (context === 'reader' && AppState.currentBook && AppState.currentChapter) {
            loadBibleChapter(AppState.currentBook, AppState.currentChapter);
        }
    });

    $('#search-bible-btn').addEventListener('click', showSearchModal);
    $('#font-size-btn').addEventListener('click', showFontSizeOptions);

    const bookmarkBtn = $('#bookmark-chapter-btn');
    if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', () => {
            if (AppState.currentBook && AppState.currentChapter) {
                bookmarkChapter(AppState.currentBook, AppState.currentChapter);
            }
        });
    }
}

/* ---- Level 1: Book grid ---- */
function renderBibleBookListView() {
    AppState.bibleView = 'books';
    AppState.currentBook = null;
    AppState.currentChapter = null;

    const books = getBibleBooks();
    const oldTestament = books.slice(0, 39);
    const newTestament = books.slice(39);

    const bookCard = (book) => `<button class="bible-book-card" onclick="openBibleBook('${book.replace(/'/g, "\\'")}')">${book}</button>`;

    DOM.pageContainer.innerHTML = `
        <div class="bible-reader">
            ${bibleTopBarHTML('books')}
            <h4 class="bible-section-title">Old Testament</h4>
            <div class="bible-book-grid">${oldTestament.map(bookCard).join('')}</div>
            <h4 class="bible-section-title">New Testament</h4>
            <div class="bible-book-grid">${newTestament.map(bookCard).join('')}</div>
        </div>
    `;
    bindBibleTopBarEvents('books');
}

function openBibleBook(book) {
    renderBibleChapterListView(book);
}

/* ---- Level 2: Chapter grid ---- */
function renderBibleChapterListView(book) {
    AppState.bibleView = 'chapters';
    AppState.currentBook = book;
    AppState.currentChapter = null;

    const total = getBookChapterCount(book);
    const chapterCard = (n) => `<button class="bible-chapter-card" onclick="openBibleChapterFromGrid('${book.replace(/'/g, "\\'")}', ${n})">${n}</button>`;

    DOM.pageContainer.innerHTML = `
        <div class="bible-reader">
            ${bibleTopBarHTML('chapters')}
            <h3 class="bible-chapter-list-title">${escapeHtml(book)}</h3>
            <div class="bible-chapter-grid">
                ${Array.from({ length: total }, (_, i) => i + 1).map(chapterCard).join('')}
            </div>
        </div>
    `;
    bindBibleTopBarEvents('chapters');
}

function openBibleChapterFromGrid(book, chapter) {
    renderBibleReaderView(book, chapter);
}

/* ---- Level 3: Chapter reader ---- */
function renderBibleReaderView(book, chapter) {
    AppState.bibleView = 'reader';
    AppState.currentBook = book;
    AppState.currentChapter = chapter;

    const total = getBookChapterCount(book);
    const safeBook = book.replace(/'/g, "\\'");

    DOM.pageContainer.innerHTML = `
        <div class="bible-reader">
            ${bibleTopBarHTML('reader')}
            <div class="bible-breadcrumb">
                <button onclick="renderBibleBookListView()">Books</button>
                <i class="fas fa-chevron-right"></i>
                <button onclick="renderBibleChapterListView('${safeBook}')">${escapeHtml(book)}</button>
                <i class="fas fa-chevron-right"></i>
                <span>${chapter}</span>
            </div>
            <div class="verse-jump-inline">
                <input type="number" id="bible-verse-jump" min="1" placeholder="Go to verse">
                <button id="verse-jump-btn" class="btn btn-outline btn-sm">Go</button>
            </div>

            <div id="bible-content" style="min-height: 400px;">
                <div class="skeleton" style="height: 40px; margin-bottom: 16px;"></div>
                <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
                <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
                <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
            </div>

            <div id="chapter-navigation" class="flex justify-between mt-3">
                <button id="prev-chapter-btn" class="btn btn-outline btn-sm" ${chapter <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i> Previous
                </button>
                <span id="chapter-indicator" style="font-weight: 600;">${escapeHtml(book)} ${chapter}</span>
                <button id="next-chapter-btn" class="btn btn-outline btn-sm" ${chapter >= total ? 'disabled' : ''}>
                    Next <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        </div>
    `;

    bindBibleTopBarEvents('reader');

    $('#prev-chapter-btn').addEventListener('click', () => {
        if (AppState.currentChapter > 1) renderBibleReaderView(AppState.currentBook, AppState.currentChapter - 1);
    });
    $('#next-chapter-btn').addEventListener('click', () => {
        const totalChapters = getBookChapterCount(AppState.currentBook);
        if (AppState.currentChapter < totalChapters) renderBibleReaderView(AppState.currentBook, AppState.currentChapter + 1);
    });

    function jumpToVerse() {
        const verseInput = $('#bible-verse-jump');
        const verseNum = parseInt(verseInput.value);
        if (!verseNum) return;
        const verseEl = $(`.bible-verse[data-verse="${verseNum}"]`);
        if (verseEl) {
            verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            verseEl.classList.add('verse-flash');
            setTimeout(() => verseEl.classList.remove('verse-flash'), 1500);
        } else {
            showToast(`Verse ${verseNum} not found in this chapter`, 'warning');
        }
    }
    $('#verse-jump-btn').addEventListener('click', jumpToVerse);
    $('#bible-verse-jump').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') jumpToVerse();
    });

    return loadBibleChapter(book, chapter);
}

function getBibleBooks() {
    return [
        'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
        'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
        '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
        'Nehemiah', 'Esther', 'Job', 'Psalm', 'Proverbs',
        'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
        'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
        'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
        'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
        'Matthew', 'Mark', 'Luke', 'John', 'Acts',
        'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
        'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
        '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews',
        'James', '1 Peter', '2 Peter', '1 John', '2 John',
        '3 John', 'Jude', 'Revelation'
    ];
}

async function loadBibleChapter(book, chapter) {
    AppState.currentBook = book;
    AppState.currentChapter = chapter;
    AppState.selectedVerses.clear();
    clearVerseSelectionBar();

    const contentEl = $('#bible-content');
    if (contentEl) {
        contentEl.innerHTML = `
            <div class="skeleton" style="height: 40px; margin-bottom: 16px;"></div>
            <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
            <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
            <div class="skeleton" style="height: 24px; margin-bottom: 12px;"></div>
        `;
    }

    let verses = [];
    let loadError = null;
    try {
        verses = await fetchBibleChapter(book, chapter, AppState.bibleVersion);
    } catch (error) {
        console.error('Error loading Bible chapter:', error);
        loadError = error;
    }

    // Bail out quietly if the user has since navigated to a different
    // book/chapter/page while this was loading.
    if (AppState.currentBook !== book || AppState.currentChapter !== chapter || AppState.currentRoute !== 'bible') return;

    if (loadError || verses.length === 0) {
        $('#bible-content').innerHTML = `
            <div class="text-center text-muted" style="padding: 60px 20px;">
                <i class="fas fa-triangle-exclamation" style="font-size: 40px; opacity: 0.4; margin-bottom: 16px;"></i>
                <h3 style="margin-bottom: 8px;">Couldn't load ${escapeHtml(book)} ${chapter}</h3>
                <p style="margin-bottom: 16px;">${loadError ? escapeHtml(loadError.message || 'Something went wrong reaching the Bible service.') : 'No verses were returned.'}</p>
                <button class="btn btn-outline btn-sm" onclick="loadBibleChapter('${book.replace(/'/g, "\\'")}', ${chapter})">
                    <i class="fas fa-rotate-right"></i> Try Again
                </button>
            </div>
        `;
        return;
    }

    // Render verses, marking any that are already highlighted/bookmarked
    // by the user so those states are visible as soon as the chapter opens.
    $('#bible-content').innerHTML = `
        <h3 style="font-size: 20px; margin-bottom: 20px; font-weight: 700;">${escapeHtml(book)} ${chapter}</h3>
        ${verses.map(verse => {
            const classes = ['bible-verse'];
            if (isVerseHighlighted(book, chapter, verse.verse)) classes.push('highlighted');
            if (isVerseBookmarked(book, chapter, verse.verse)) classes.push('bookmarked');
            return `
            <div class="${classes.join(' ')}" data-verse="${verse.verse}" onclick="toggleVerseSelection(${verse.verse})">
                <span class="verse-number">${verse.verse}</span>
                <span class="bible-text">${escapeHtml(verse.text)}</span>
                ${classes.includes('bookmarked') ? '<i class="fas fa-bookmark bible-verse-bookmark-icon"></i>' : ''}
            </div>
        `;
        }).join('')}
    `;

    // Save to reading history
    if (AppState.currentUser) {
        const uid = AppState.currentUser.uid;
        const historyEntry = {
            book,
            chapter,
            timestamp: Date.now()
        };
        
        // Avoid duplicate consecutive entries
        const lastEntry = AppState.readingHistory[AppState.readingHistory.length - 1];
        if (!lastEntry || lastEntry.book !== book || lastEntry.chapter !== chapter) {
            AppState.readingHistory.push(historyEntry);
            await database.ref(`users/${uid}/readingHistory`).set(AppState.readingHistory);
        }

        // Feed the personalization engine (see features.js) — reading a
        // book is a strong signal of interest in it.
        if (typeof recordInterestSignal === 'function') recordInterestSignal('book', book, 1);
    }
}

/* ============================================
   BIBLE TEXT — api.bible integration
   ============================================
   Replaces the old mockBibleAPI() placeholder with real scripture text
   from https://scripture.api.bible, restricted to the four translations
   configured in config.js (KJV, NLT, MSG, AMP). Bible IDs are resolved
   dynamically from the account's available Bibles (rather than hard-coded)
   so this keeps working even if the exact IDs on api.bible change. */
async function resolveBibleIds() {
    if (Object.keys(AppState.bibleIdMap).length > 0) return AppState.bibleIdMap;
    if (AppState.bibleIdsResolving) return AppState.bibleIdsResolving;

    AppState.bibleIdsResolving = (async () => {
        // Cache in localStorage so we don't re-fetch the full Bible list
        // (which can be large) on every reload.
        const cached = localStorage.getItem('graceguide_bible_id_map');
        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && Object.keys(parsed).length > 0) {
                    AppState.bibleIdMap = parsed;
                    return parsed;
                }
            } catch (e) { /* fall through to re-fetch */ }
        }

        const response = await fetch(`${BIBLE_API_BASE}/bibles?language=eng`, {
            headers: { 'api-key': BIBLE_API_KEY }
        });
        if (!response.ok) throw new Error(`Bible list request failed (${response.status})`);
        const json = await response.json();
        const bibles = json.data || [];

        const map = {};
        Object.keys(BIBLE_VERSIONS).forEach(code => {
            // Prefer an exact abbreviation match, then fall back to a
            // known bibleId hint from config.js, then a name match.
            const byAbbr = bibles.find(b => (b.abbreviation || '').toUpperCase() === code);
            const byHint = bibles.find(b => b.id === BIBLE_VERSIONS[code]);
            const byName = bibles.find(b => (b.abbreviationLocal || '').toUpperCase() === code);
            const found = byAbbr || byHint || byName;
            if (found) map[code] = found.id;
        });

        if (Object.keys(map).length === 0) throw new Error('None of the configured Bible versions were found for this API key.');

        AppState.bibleIdMap = map;
        localStorage.setItem('graceguide_bible_id_map', JSON.stringify(map));
        AppState.cachedBibleVersions = Object.keys(map);
        return map;
    })().catch(error => {
        AppState.bibleIdsResolving = null;
        throw error;
    });

    return AppState.bibleIdsResolving;
}

/**
 * Parses the HTML content api.bible returns for a chapter (with
 * include-verse-spans=true) into a flat [{ verse, text }] array, since the
 * rest of the app renders one row per verse.
 */
function parseVerseSpansFromHTML(html) {
    const container = document.createElement('div');
    container.innerHTML = html;

    const verses = [];
    let currentVerse = null;
    let buffer = '';

    const flush = () => {
        if (currentVerse !== null) {
            const text = buffer.replace(/\s+/g, ' ').trim();
            if (text) verses.push({ verse: currentVerse, text });
        }
        buffer = '';
    };

    const walk = (node) => {
        node.childNodes.forEach(child => {
            if (child.nodeType === Node.TEXT_NODE) {
                buffer += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.classList && child.classList.contains('v') && child.dataset.number) {
                    flush();
                    currentVerse = parseInt(child.dataset.number, 10);
                } else {
                    walk(child);
                }
            }
        });
    };

    walk(container);
    flush();

    return verses;
}

/* ---- Chapter cache (localStorage) ----
   Scripture text never changes, so once a book/chapter/version has been
   fetched from api.bible it's cached indefinitely. This is the main
   lever for managing the api.bible token budget: re-opening a chapter,
   or re-opening the app, never re-hits the API for something already
   read before. Bump BIBLE_CACHE_VERSION if the cached shape ever changes. */
const BIBLE_CACHE_VERSION = 'v1';
const BIBLE_CACHE_PREFIX = `graceguide_bible_cache_${BIBLE_CACHE_VERSION}_`;

function bibleCacheKey(bibleId, bookId, chapter) {
    return `${BIBLE_CACHE_PREFIX}${bibleId}_${bookId}_${chapter}`;
}

function getCachedChapter(bibleId, bookId, chapter) {
    try {
        const raw = localStorage.getItem(bibleCacheKey(bibleId, bookId, chapter));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.verses) ? parsed.verses : null;
    } catch (e) {
        return null;
    }
}

function setCachedChapter(bibleId, bookId, chapter, verses) {
    try {
        localStorage.setItem(bibleCacheKey(bibleId, bookId, chapter), JSON.stringify({ verses, ts: Date.now() }));
    } catch (e) {
        // Storage full/blocked (e.g. private browsing) — non-fatal, the
        // chapter simply won't be cached this time.
        console.warn('Could not cache Bible chapter locally:', e);
    }
}

async function fetchBibleChapter(book, chapter, version) {
    const bookId = getUSFMBookId(book);
    if (!bookId) throw new Error(`Unknown Bible book: ${book}`);

    const idMap = await resolveBibleIds();
    const bibleId = idMap[version] || idMap[AppState.cachedBibleVersions[0]];
    if (!bibleId) throw new Error(`The ${version} translation isn't available with this API key.`);

    // Cache-first: only ever call api.bible once per book/chapter/version.
    const cached = getCachedChapter(bibleId, bookId, chapter);
    if (cached) return cached;

    const url = `${BIBLE_API_BASE}/bibles/${bibleId}/chapters/${bookId}.${chapter}?content-type=html&include-verse-spans=true&include-notes=false&include-titles=false`;
    const response = await fetch(url, { headers: { 'api-key': BIBLE_API_KEY } });

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error('The Bible API key was rejected. Check BIBLE_API_KEY in config.js.');
        throw new Error(`Bible service returned an error (${response.status}).`);
    }

    const json = await response.json();
    const html = json?.data?.content;
    if (!html) throw new Error('No content returned for this chapter.');

    const verses = parseVerseSpansFromHTML(html);
    setCachedChapter(bibleId, bookId, chapter, verses);
    return verses;
}

function isVerseHighlighted(book, chapter, verse) {
    return AppState.highlights.some(h => h.book === book && h.chapter === chapter && h.verse === verse);
}

function isVerseBookmarked(book, chapter, verse) {
    return AppState.bookmarks.some(b => b.book === book && b.chapter === chapter && b.verse === verse);
}

/**
 * Toggles one verse in/out of the current multi-selection. Deliberately
 * does NOT open any modal/sheet here — a full-screen sheet or modal would
 * sit on top of the verse list and block further taps, which is exactly
 * why multi-verse selection didn't work before. Instead, a small
 * non-blocking bar (see renderVerseSelectionBar) floats above the bottom
 * nav so the user can keep tapping additional verses freely.
 */
function toggleVerseSelection(verseNumber) {
    const verseElement = $(`.bible-verse[data-verse="${verseNumber}"]`);

    if (AppState.selectedVerses.has(verseNumber)) {
        AppState.selectedVerses.delete(verseNumber);
        if (verseElement) verseElement.classList.remove('selected');
    } else {
        AppState.selectedVerses.add(verseNumber);
        if (verseElement) verseElement.classList.add('selected');
    }

    renderVerseSelectionBar();
}

/**
 * Renders (or removes) the floating verse-selection action bar. It's
 * appended to <body> — not the page container — so it stays fixed above
 * the bottom nav and never intercepts taps on the verses above it.
 */
function renderVerseSelectionBar() {
    let bar = document.getElementById('verse-select-bar');

    if (AppState.selectedVerses.size === 0) {
        if (bar) bar.remove();
        return;
    }

    const count = AppState.selectedVerses.size;
    const nums = Array.from(AppState.selectedVerses).sort((a, b) => a - b).join(', ');

    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'verse-select-bar';
        bar.className = 'verse-select-bar';
        document.body.appendChild(bar);
    }

    bar.innerHTML = `
        <div class="verse-select-info">
            <strong>${count}</strong> selected
            <span class="verse-select-ref">${escapeHtml(AppState.currentBook || '')} ${AppState.currentChapter || ''}:${nums}</span>
        </div>
        <div class="verse-select-actions">
            <button class="vsb-btn" onclick="highlightSelectedVerses()" aria-label="Highlight"><i class="fas fa-highlighter"></i></button>
            <button class="vsb-btn" onclick="bookmarkSelectedVerses()" aria-label="Bookmark"><i class="fas fa-bookmark"></i></button>
            <button class="vsb-btn" onclick="addNoteToSelectedVerses()" aria-label="Add note"><i class="fas fa-sticky-note"></i></button>
            <button class="vsb-btn" onclick="shareSelectedVerses()" aria-label="Share"><i class="fas fa-share"></i></button>
            <button class="vsb-btn" onclick="postSelectedVersesToSpace()" aria-label="Post to Space"><i class="fas fa-layer-group"></i></button>
            <button class="vsb-btn" onclick="askAIAboutSelectedVerses()" aria-label="Ask Shepherd"><i class="fas fa-dove"></i></button>
            <button class="vsb-btn vsb-close" onclick="clearVerseSelection()" aria-label="Clear selection"><i class="fas fa-times"></i></button>
        </div>
    `;
}

/** Deselects all verses and removes the selection bar (without closing/saving anything). */
function clearVerseSelection() {
    AppState.selectedVerses.forEach(v => {
        const el = $(`.bible-verse[data-verse="${v}"]`);
        if (el) el.classList.remove('selected');
    });
    AppState.selectedVerses.clear();
    clearVerseSelectionBar();
}

/** Just removes the bar element from the DOM (used on navigation/re-render). */
function clearVerseSelectionBar() {
    const bar = document.getElementById('verse-select-bar');
    if (bar) bar.remove();
}

function postSelectedVersesToSpace() {
    if (AppState.selectedVerses.size === 0) return;

    const verses = Array.from(AppState.selectedVerses).sort((a, b) => a - b).map(v => {
        const el = $(`.bible-verse[data-verse="${v}"] .bible-text`);
        return {
            book: AppState.currentBook,
            chapter: AppState.currentChapter,
            verse: v,
            text: el ? el.textContent.trim() : '',
            version: AppState.bibleVersion
        };
    });

    clearVerseSelection();
    showCreateSpacePostModal({
        verses,
        sourceBook: AppState.currentBook,
        sourceChapter: AppState.currentChapter
    });
}

function highlightSelectedVerses() {
    if (AppState.selectedVerses.size === 0) return;
    if (!requireAuth('Sign in to highlight verses.')) return;

    const uid = AppState.currentUser.uid;
    const book = AppState.currentBook;
    const chapter = AppState.currentChapter;
    const verses = Array.from(AppState.selectedVerses).map(v => ({
        book, chapter, verse: v, timestamp: Date.now()
    }));

    AppState.highlights.push(...verses);
    database.ref(`users/${uid}/highlights`).set(AppState.highlights)
        .then(() => {
            showToast('Verses highlighted!', 'success');
            clearVerseSelection();
            // Re-render so the highlight is visible immediately.
            if (AppState.bibleView === 'reader') renderBibleReaderView(book, chapter);
        })
        .catch(() => showToast('Failed to highlight. Please try again.', 'error'));
}

function bookmarkSelectedVerses() {
    if (AppState.selectedVerses.size === 0) return;
    if (!requireAuth('Sign in to bookmark verses.')) return;

    const uid = AppState.currentUser.uid;
    const book = AppState.currentBook;
    const chapter = AppState.currentChapter;
    const verses = Array.from(AppState.selectedVerses).map(v => ({
        book, chapter, verse: v,
        reference: `${book} ${chapter}:${v}`,
        timestamp: Date.now()
    }));

    AppState.bookmarks.push(...verses);
    database.ref(`users/${uid}/bookmarks`).set(AppState.bookmarks)
        .then(() => {
            showToast('Verses bookmarked!', 'success');
            clearVerseSelection();
            if (AppState.bibleView === 'reader') renderBibleReaderView(book, chapter);
        })
        .catch(() => showToast('Failed to bookmark. Please try again.', 'error'));
}

function addNoteToSelectedVerses() {
    if (AppState.selectedVerses.size === 0) return;
    if (!requireAuth('Sign in to add notes.')) return;

    const book = AppState.currentBook;
    const chapter = AppState.currentChapter;
    const verseNumbers = Array.from(AppState.selectedVerses).sort((a, b) => a - b).join(', ');

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Add Note</h3>
        <p style="font-size: 14px; color: var(--text-slate); margin-bottom: 16px;">${escapeHtml(book)} ${chapter}:${verseNumbers}</p>
        <textarea id="note-text" class="form-textarea" placeholder="Write your note..." rows="4"></textarea>
        <button id="save-note-btn" class="btn btn-primary btn-block mt-3">Save Note</button>
    `;

    showModal(modalContent);

    $('#save-note-btn').addEventListener('click', async () => {
        const noteText = $('#note-text').value.trim();
        if (!noteText) {
            showToast('Please write a note', 'warning');
            return;
        }

        if (!AppState.currentUser) return;

        const uid = AppState.currentUser.uid;
        const note = {
            text: noteText,
            reference: `${book} ${chapter}:${verseNumbers}`,
            book, chapter,
            verses: Array.from(AppState.selectedVerses),
            timestamp: Date.now()
        };

        try {
            AppState.notes.push(note);
            await database.ref(`users/${uid}/notes`).set(AppState.notes);
            showToast('Note saved!', 'success');
        } catch (e) {
            AppState.notes.pop();
            showToast('Failed to save note. Please try again.', 'error');
            return;
        }

        closeModal();
        clearVerseSelection();
    });
}

function shareSelectedVerses() {
    const verseNumbers = Array.from(AppState.selectedVerses).sort((a, b) => a - b);
    const reference = `${AppState.currentBook} ${AppState.currentChapter}:${verseNumbers.join(', ')}`;
    // Look up the actual rendered text for the selected verse(s) — same
    // DOM pattern used by postSelectedVersesToSpace() — so the share
    // card/text has real content instead of just a bare reference.
    const text = verseNumbers
        .map(v => $(`.bible-verse[data-verse="${v}"] .bible-text`)?.textContent.trim())
        .filter(Boolean)
        .join(' ');
    shareVerse(reference, text);
}

function askAIAboutSelectedVerses() {
    const verseNumbers = Array.from(AppState.selectedVerses).sort((a, b) => a - b).join(', ');
    const reference = `${AppState.currentBook} ${AppState.currentChapter}:${verseNumbers}`;

    clearVerseSelection();
    navigateTo('ask');
    
    setTimeout(() => {
        const chatInput = $('#chat-input');
        if (chatInput) {
            chatInput.value = `Explain ${reference} to me`;
            sendChatMessage();
        }
    }, 500);
}

function shareVerse(reference, text = '') {
    // shareVerseCard() (js/sharecards.js) is the Phase 2 share-card
    // engine — offers a branded image alongside the plain text/link.
    // Falls back to the original plain-text share if that file somehow
    // isn't loaded, so this never breaks even in a partial deploy.
    if (typeof shareVerseCard === 'function') {
        shareVerseCard(reference, text);
        return;
    }

    const shareText = text ? `"${text}" - ${reference}` : reference;
    if (navigator.share) {
        navigator.share({
            title: 'Bible Verse',
            text: shareText
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            showToast('Verse copied to clipboard!', 'success');
        });
    }
}

function saveVerse(reference, text) {
    if (!requireAuth('Sign in to save your history/progress.')) return;
    
    const uid = AppState.currentUser.uid;
    const bookmark = {
        reference,
        text,
        timestamp: Date.now()
    };
    
    AppState.bookmarks.push(bookmark);
    database.ref(`users/${uid}/bookmarks`).set(AppState.bookmarks)
        .then(() => showToast('Verse saved!', 'success'))
        .catch(() => showToast('Failed to save', 'error'));
}

function bookmarkChapter(book, chapter) {
    if (!requireAuth('Sign in to save your history/progress.')) return;
    
    const uid = AppState.currentUser.uid;
    const bookmark = {
        reference: `${book} ${chapter}`,
        book,
        chapter,
        type: 'chapter',
        timestamp: Date.now()
    };
    
    AppState.bookmarks.push(bookmark);
    database.ref(`users/${uid}/bookmarks`).set(AppState.bookmarks)
        .then(() => showToast('Chapter bookmarked!', 'success'))
        .catch(() => showToast('Failed to bookmark', 'error'));
}

/**
 * Jumps straight to a chapter's reader view — used by deep links (search
 * results, bookmarks, notifications, "Read Bible" shortcuts, etc). This
 * intentionally skips the book/chapter grids since the caller already
 * knows exactly which chapter is wanted.
 */
function openBibleChapter(book, chapter, verse) {
    // Set the target view before navigating so that if we're not already
    // on the Bible tab, navigateTo()'s own call to renderBiblePage() goes
    // straight to the right chapter instead of rendering an intermediate
    // view that would immediately get replaced.
    AppState.bibleView = 'reader';
    AppState.currentBook = book;
    AppState.currentChapter = chapter;

    // Phase 3: keep the address bar in sync with whatever chapter is
    // actually showing, so it's always refreshable/shareable as
    // #/bible/BOOK/CHAPTER[/VERSE] — not just when arriving via a deep
    // link.
    const urlPath = `bible/${encodeURIComponent(book)}/${chapter}${verse ? '/' + verse : ''}`;

    let loadPromise;
    if (AppState.currentRoute !== 'bible') {
        // Goes through the full navigateTo() (closes overlays, honors
        // the email-verification gate, stops Shepherd voice playback,
        // etc.) exactly as before — just now with a urlPath so the
        // pushed URL reflects the actual chapter instead of a bare
        // "#/bible".
        navigateTo('bible', { urlPath });
        loadPromise = AppState.lastRenderPromise;
    } else {
        // Already on the Bible tab: bypass navigateTo (as before this
        // change too) so paging between chapters/cross-references
        // doesn't re-run its full dispatch or restore a stale scroll
        // position from the chapter being left. replaceState (never
        // push) so this doesn't flood the back button with a stop for
        // every single chapter/verse link followed while reading.
        history.replaceState({ route: 'bible' }, '', `#/${urlPath}`);
        loadPromise = renderBibleReaderView(book, chapter);
    }
    if (verse && loadPromise && typeof loadPromise.then === 'function') {
        loadPromise.then(() => {
            setTimeout(() => {
                const verseEl = $(`.bible-verse[data-verse="${verse}"]`);
                if (verseEl) {
                    verseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    verseEl.classList.add('verse-flash');
                    setTimeout(() => verseEl.classList.remove('verse-flash'), 1500);
                }
            }, 100);
        });
    }
}

/**
 * Open a passage referenced by a plain string such as "Romans 8:28-39".
 * Falls back gracefully if the reference can't be parsed.
 */
function openPassageReference(passage) {
    const parsed = parsePassageReference(passage);
    if (!parsed) {
        showToast("Couldn't open that passage — try browsing the Bible tab instead.", 'warning');
        return;
    }
    openBibleChapter(parsed.book, parsed.chapter, parsed.verse);
}

function showSearchModal() {
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Search Bible</h3>
        <input type="text" id="bible-search-input" class="form-input" placeholder="Search by book, chapter, verse, or keyword...">
        <div id="bible-search-results" style="margin-top: 16px; max-height: 400px; overflow-y: auto;"></div>
    `;
    
    showModal(modalContent);
    
    const searchInput = $('#bible-search-input');
    searchInput.focus();
    
    const debouncedSearch = debounce((query) => {
        if (query.length < 2) {
            $('#bible-search-results').innerHTML = '';
            return;
        }
        
        // Search through books
        const results = getBibleBooks().filter(book => 
            book.toLowerCase().includes(query.toLowerCase())
        ).map(book => ({
            type: 'book',
            title: book,
            subtitle: 'Book of the Bible',
            action: () => {
                closeModal();
                openBibleChapter(book, 1);
            }
        })).slice(0, 10);
        
        if (results.length > 0) {
            $('#bible-search-results').innerHTML = results.map(result => `
                <div class="p-2" style="cursor: pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeModalThen(() => openBibleChapter('${result.title}', 1))">
                    <div style="font-weight: 600;">${result.title}</div>
                    <div style="font-size: 12px; color: var(--text-slate);">${result.subtitle}</div>
                </div>
            `).join('');
        } else {
            $('#bible-search-results').innerHTML = `
                <p class="text-center text-muted">No results found for "${query}"</p>
            `;
        }
    }, 300);
    
    searchInput.addEventListener('input', (e) => {
        debouncedSearch(e.target.value);
    });
}

function showFontSizeOptions() {
    const sizes = [14, 16, 18, 20, 22, 24];
    
    const sheetContent = `
        <h3 style="margin-bottom: 16px;">Font Size</h3>
        <div style="display: grid; gap: 8px;">
            ${sizes.map(size => `
                <button class="btn btn-outline btn-block" onclick="setBibleFontSize(${size})">
                    ${size}px
                </button>
            `).join('')}
        </div>
    `;
    
    showSheet(sheetContent);
}

function setBibleFontSize(size) {
    $$('.bible-text').forEach(el => {
        el.style.fontSize = `${size}px`;
    });
    closeSheet();
    showToast(`Font size set to ${size}px`, 'success');
}

