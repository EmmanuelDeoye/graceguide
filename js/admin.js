/* ============================================
   GraceGuide — js/admin.js
   Loaded after js/config.js (Firebase init + BIBLE_API_KEY/
   DEEPSEEK_API_KEY/FCM_VAPID_KEY constants — this file does NOT load
   core.js/community.js/features.js, so it's fully self-contained: its
   own $, escapeHtml, toast, and modal helpers below.

   ACCESS MODEL:
   - godledtech@gmail.com is the permanent "master" admin — hardcoded
     by email, cannot be revoked from this UI.
   - The master can grant other signed-up accounts admin access, stored
     at admins/{uid}. This UI only ever shows itself to permitted users;
     the actual enforcement lives in database.rules.json (deploy that
     for this to be a real security boundary, not just a locked door
     with no wall around it).
   ============================================ */

const MASTER_ADMIN_EMAIL = 'godledtech@gmail.com';

const AdminState = {
    user: null,
    isMaster: false,
    isAdmin: false,
    activeTab: 'overview',
    userDirectory: null,   // cached {uid: {...}} once loaded
    spacePosts: null,      // cached array once loaded
    quizData: null,        // cached quizCompetition/current once loaded
    generatedQuestions: [] // AI-generated questions staged before saving
};

/* ============================================
   TINY UTILITIES (self-contained — no core.js dependency)
   ============================================ */
function $(selector, root = document) { return root.querySelector(selector); }
function $$(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function truncate(text, len) {
    if (!text) return '';
    return text.length > len ? text.slice(0, len).trim() + '…' : text;
}

function formatDate(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

function showAdminToast(message, type = 'info') {
    const container = document.getElementById('admin-toast-container');
    const toast = document.createElement('div');
    toast.className = `admin-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showAdminModal(html) {
    const container = document.getElementById('admin-modal-container');
    container.innerHTML = `<div class="admin-modal">${html}</div>`;
    container.classList.remove('hidden');
    container.onclick = (e) => { if (e.target === container) closeAdminModal(); };
}

function closeAdminModal() {
    const container = document.getElementById('admin-modal-container');
    container.classList.add('hidden');
    container.innerHTML = '';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const container = document.getElementById('admin-modal-container');
        if (container && !container.classList.contains('hidden')) closeAdminModal();
    }
});

/* ============================================
   ACCESS GATE
   ============================================ */
function showGateMessage(message) {
    $('#admin-gate-message').textContent = message;
}

function showGateSignIn() {
    $('#admin-gate-signin').classList.remove('hidden');
    $('#admin-gate-denied').classList.add('hidden');
}

function showGateDenied(email) {
    showGateMessage(`${email || 'This account'} does not have admin access. Sign in with a permitted account, or ask an existing admin to grant you access.`);
    $('#admin-gate-signin').classList.add('hidden');
    $('#admin-gate-denied').classList.remove('hidden');
}

async function checkAdminAccess(user) {
    if (!user) return { isAdmin: false, isMaster: false };
    if (user.email === MASTER_ADMIN_EMAIL) return { isAdmin: true, isMaster: true };
    try {
        const snap = await database.ref(`admins/${user.uid}`).once('value');
        return { isAdmin: snap.exists(), isMaster: false };
    } catch (error) {
        console.error('Error checking admin access:', error);
        return { isAdmin: false, isMaster: false };
    }
}

function initAccessGate() {
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            AdminState.user = null;
            showGateMessage('Sign in with an admin account to continue.');
            showGateSignIn();
            $('#admin-dashboard').classList.add('hidden');
            $('#admin-gate').classList.remove('hidden');
            return;
        }

        showGateMessage('Checking your access…');
        const { isAdmin, isMaster } = await checkAdminAccess(user);

        if (!isAdmin) {
            AdminState.user = user;
            showGateDenied(user.email);
            $('#admin-dashboard').classList.add('hidden');
            $('#admin-gate').classList.remove('hidden');
            return;
        }

        AdminState.user = user;
        AdminState.isAdmin = true;
        AdminState.isMaster = isMaster;
        enterDashboard(user, isMaster);
    }, (error) => {
        console.error('Auth error:', error);
        showGateMessage('Something went wrong checking your sign-in. Please try again.');
        showGateSignIn();
    });
}

function enterDashboard(user, isMaster) {
    $('#admin-gate').classList.add('hidden');
    $('#admin-dashboard').classList.remove('hidden');

    $('#admin-current-user-name').textContent = user.displayName || user.email;
    $('#admin-current-user-avatar').textContent = (user.displayName || user.email || 'A')[0].toUpperCase();
    $('#admin-current-user-role').textContent = isMaster ? 'Master Admin' : 'Admin';
    $('#admin-nav-admins').classList.toggle('hidden', !isMaster);

    renderTab('overview');
}

/* ============================================
   SIGN-IN FORM (email/password + Google)
   ============================================ */
function initGateForm() {
    $('#admin-signin-btn').addEventListener('click', async () => {
        const email = $('#admin-email').value.trim();
        const password = $('#admin-password').value;
        const errorEl = $('#admin-gate-error');
        errorEl.classList.add('hidden');

        if (!email || !password) {
            errorEl.textContent = 'Please enter both email and password.';
            errorEl.classList.remove('hidden');
            return;
        }

        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            errorEl.textContent = error.message || 'Sign-in failed.';
            errorEl.classList.remove('hidden');
        }
    });

    $('#admin-google-btn').addEventListener('click', async () => {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await auth.signInWithPopup(provider);
        } catch (error) {
            const errorEl = $('#admin-gate-error');
            errorEl.textContent = error.message || 'Sign-in failed.';
            errorEl.classList.remove('hidden');
        }
    });

    $('#admin-denied-signout-btn').addEventListener('click', () => auth.signOut());
    $('#admin-signout-btn').addEventListener('click', () => auth.signOut());
}

/* ============================================
   SIDEBAR / TAB NAVIGATION
   ============================================ */
function initSidebarNav() {
    $$('.admin-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            renderTab(btn.dataset.tab);
            $('#admin-sidebar').classList.remove('open');
            $('#admin-sidebar-backdrop').classList.remove('visible');
        });
    });

    $('#admin-menu-toggle').addEventListener('click', () => {
        $('#admin-sidebar').classList.toggle('open');
        $('#admin-sidebar-backdrop').classList.toggle('visible');
    });
    $('#admin-sidebar-backdrop').addEventListener('click', () => {
        $('#admin-sidebar').classList.remove('open');
        $('#admin-sidebar-backdrop').classList.remove('visible');
    });
}

const TAB_TITLES = {
    overview: 'Overview',
    users: 'Users',
    notifications: 'Notifications',
    quiz: 'Weekly Quiz',
    space: 'Space Moderation',
    admins: 'Admin Access'
};

function renderTab(tab) {
    AdminState.activeTab = tab;
    $$('.admin-nav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $('#admin-page-title').textContent = TAB_TITLES[tab] || 'Overview';

    const content = $('#admin-content');
    content.innerHTML = `<div class="admin-loading-row"><i class="fas fa-circle-notch fa-spin"></i> Loading…</div>`;

    const renderers = {
        overview: renderOverviewTab,
        users: renderUsersTab,
        notifications: renderNotificationsTab,
        quiz: renderQuizTab,
        space: renderSpaceTab,
        admins: renderAdminsTab
    };

    (renderers[tab] || renderOverviewTab)().catch(error => {
        console.error(`Error rendering ${tab} tab:`, error);
        const isPermissionError = /permission/i.test(error?.message || error?.code || '');
        content.innerHTML = `
            <div class="admin-empty-state">
                <i class="fas fa-triangle-exclamation"></i>
                <p>Something went wrong loading this tab.</p>
                ${isPermissionError ? `<p style="font-size:12px; max-width:360px; margin:8px auto 0;">This looks like a database permissions error — make sure <code>database.rules.json</code> has been deployed (<code>firebase deploy --only database</code>).</p>` : ''}
                <button class="btn btn-outline btn-sm mt-2" onclick="renderTab('${tab}')">Retry</button>
            </div>
        `;
    });
}

/* ============================================
   DATA FETCH HELPERS (cached per session, refreshable)
   ============================================ */
async function fetchUserDirectory(force = false) {
    if (AdminState.userDirectory && !force) return AdminState.userDirectory;
    const snap = await database.ref('userDirectory').once('value');
    AdminState.userDirectory = snap.val() || {};
    return AdminState.userDirectory;
}

async function fetchAllSpacePosts(force = false) {
    if (AdminState.spacePosts && !force) return AdminState.spacePosts;
    const snap = await database.ref('spacePosts').once('value');
    const raw = snap.val() || {};
    AdminState.spacePosts = Object.entries(raw).map(([id, post]) => ({ id, ...post }));
    return AdminState.spacePosts;
}

async function fetchQuizData(force = false) {
    if (AdminState.quizData && !force) return AdminState.quizData;
    const snap = await database.ref('quizCompetition/current').once('value');
    AdminState.quizData = snap.val() || {};
    return AdminState.quizData;
}

async function fetchActiveDays(daysBack = 30) {
    const snap = await database.ref('analytics/activeDays').once('value');
    const raw = snap.val() || {};
    const result = [];
    const today = new Date();
    for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        result.push({ date: key, count: raw[key] ? Object.keys(raw[key]).length : 0 });
    }
    return result;
}

function bucketSignupsByDay(userDirectory, daysBack = 30) {
    const counts = {};
    Object.values(userDirectory).forEach(u => {
        if (!u.createdAt) return;
        const key = dayKey(u.createdAt);
        counts[key] = (counts[key] || 0) + 1;
    });
    const result = [];
    const today = new Date();
    for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        result.push({ date: key, count: counts[key] || 0 });
    }
    return result;
}

/* ============================================
   OVERVIEW TAB
   ============================================ */
let overviewChartInstance = null;

async function renderOverviewTab() {
    const results = await Promise.allSettled([
        fetchUserDirectory(),
        fetchAllSpacePosts(),
        fetchActiveDays(30)
    ]);

    const [userDirResult, postsResult, activeDaysResult] = results;
    const userDirectory = userDirResult.status === 'fulfilled' ? userDirResult.value : {};
    const spacePosts = postsResult.status === 'fulfilled' ? postsResult.value : [];
    const activeDays = activeDaysResult.status === 'fulfilled' ? activeDaysResult.value : [];

    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
        failures.forEach(f => console.error('Overview data fetch failed:', f.reason));
    }

    const signups = bucketSignupsByDay(userDirectory, 30);
    const totalUsers = Object.keys(userDirectory).length;
    const todayKey = dayKey(Date.now());
    const activeToday = activeDays.find(d => d.date === todayKey)?.count || 0;
    const weekAgo = Date.now() - 7 * 86400000;
    const newThisWeek = Object.values(userDirectory).filter(u => u.createdAt && u.createdAt >= weekAgo).length;

    $('#admin-content').innerHTML = `
        ${failures.length > 0 ? `
            <div class="admin-empty-state" style="background:#fff3f0; border-radius:12px; padding:16px; margin-bottom:16px; text-align:left;">
                <p style="color:#a8562f; font-weight:600; margin-bottom:4px;"><i class="fas fa-triangle-exclamation"></i> Some data couldn't load</p>
                <p style="font-size:13px; color:var(--text-slate);">This usually means the database rules haven't been deployed yet (<code>firebase deploy --only database</code>) — see SETUP_NOTES.md. Showing whatever loaded successfully below.</p>
            </div>
        ` : ''}
        <div class="admin-stats-grid">
            <div class="admin-stat-card"><div class="value">${totalUsers}</div><div class="label">Total Users</div></div>
            <div class="admin-stat-card"><div class="value">${activeToday}</div><div class="label">Active Today</div></div>
            <div class="admin-stat-card"><div class="value">${newThisWeek}</div><div class="label">New This Week</div></div>
            <div class="admin-stat-card"><div class="value">${spacePosts.length}</div><div class="label">Space Posts</div></div>
        </div>

        <div class="admin-chart-card">
            <h3>Daily Active Users (last 30 days)</h3>
            <div class="admin-chart-wrap"><canvas id="chart-active-users"></canvas></div>
        </div>

        <div class="admin-chart-card">
            <h3>New Signups (last 30 days)</h3>
            <div class="admin-chart-wrap"><canvas id="chart-signups"></canvas></div>
        </div>
    `;

    const labels = signups.map(d => d.date.slice(5)); // MM-DD

    if (overviewChartInstance) { overviewChartInstance.forEach(c => c.destroy()); }
    overviewChartInstance = [];
    try {
        if (typeof Chart === 'undefined') throw new Error('Chart.js did not load');
        overviewChartInstance = [
            new Chart($('#chart-active-users'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Active Users',
                        data: activeDays.map(d => d.count),
                        borderColor: '#30483A',
                        backgroundColor: 'rgba(48,72,58,0.12)',
                        fill: true,
                        tension: 0.3
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            }),
            new Chart($('#chart-signups'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'New Signups',
                        data: signups.map(d => d.count),
                        backgroundColor: '#C7A65A'
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            })
        ];
    } catch (error) {
        // Stat cards above are already rendered — a chart library hiccup
        // (CDN blocked, ad-blocker, etc.) should never take those down
        // with it. Just show a small inline note where the charts would be.
        console.error('Error rendering charts:', error);
        $$('.admin-chart-wrap').forEach(wrap => {
            wrap.innerHTML = `<p class="text-muted" style="padding-top:20px;">Charts couldn't load.</p>`;
        });
    }
}

/* ============================================
   USERS TAB
   ============================================ */
async function renderUsersTab() {
    const userDirectory = await fetchUserDirectory();
    const users = Object.entries(userDirectory).map(([uid, u]) => ({ uid, ...u }));
    users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    $('#admin-content').innerHTML = `
        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2>Users (${users.length})</h2>
                <input type="text" id="user-search-input" class="admin-search-input" placeholder="Search by name or email...">
            </div>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead>
                        <tr><th>Username</th><th>Email</th><th>Joined</th><th>Last Active</th><th></th></tr>
                    </thead>
                    <tbody id="users-table-body">
                        ${usersTableRowsHTML(users)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    $('#user-search-input').addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        const filtered = !q ? users : users.filter(u =>
            (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
        );
        $('#users-table-body').innerHTML = usersTableRowsHTML(filtered);
    });
}

function usersTableRowsHTML(users) {
    if (users.length === 0) return `<tr><td colspan="5" class="admin-loading-row">No users found.</td></tr>`;
    return users.map(u => `
        <tr>
            <td>${escapeHtml(u.username || 'User')}</td>
            <td>${escapeHtml(u.email || '—')}</td>
            <td>${formatDate(u.createdAt)}</td>
            <td>${formatDate(u.lastActiveAt)}</td>
            <td><button class="admin-icon-btn" title="Send notification" onclick="jumpToNotifyUser('${u.uid}', '${escapeHtml((u.username || 'User').replace(/'/g, "\\'"))}')"><i class="fas fa-bell"></i></button></td>
        </tr>
    `).join('');
}

function jumpToNotifyUser(uid, username) {
    renderTab('notifications');
    setTimeout(() => openComposeNotificationModal(uid, username), 50);
}

/* ============================================
   NOTIFICATIONS TAB
   ============================================ */
async function renderNotificationsTab() {
    $('#admin-content').innerHTML = `
        <div class="admin-panel">
            <h2>Send Notification</h2>
            <p class="text-muted" style="margin-bottom:16px;">Delivered as an in-app notification to each recipient immediately, and as a push notification to any device where they've enabled notifications (once the Cloud Function in <code>functions/index.js</code> is deployed).</p>
            <button id="compose-notif-btn" class="btn btn-primary"><i class="fas fa-paper-plane"></i> Compose Notification</button>
        </div>
    `;

    $('#compose-notif-btn').addEventListener('click', () => openComposeNotificationModal());
}

/** Opens the notification composer as an actual cancelable modal
    (reusing the shared admin-modal-container) instead of an inline
    form with no way to back out. Pass a uid/username to pre-target a
    specific user (used by the Users tab's quick "notify" action). */
async function openComposeNotificationModal(presetUid = null, presetUsername = null) {
    const userDirectory = await fetchUserDirectory();
    const users = Object.entries(userDirectory).map(([uid, u]) => ({ uid, ...u }))
        .sort((a, b) => (a.username || '').localeCompare(b.username || ''));

    showAdminModal(`
        <h3 style="margin-bottom: 16px;">Compose Notification</h3>
        <div class="admin-form-row">
            <label>Send to</label>
            <select id="notif-target-type" class="form-select">
                <option value="all" ${!presetUid ? 'selected' : ''}>Everyone (general broadcast)</option>
                <option value="specific" ${presetUid ? 'selected' : ''}>A specific user</option>
            </select>
        </div>
        <div class="admin-form-row ${presetUid ? '' : 'hidden'}" id="notif-target-user-row">
            <label>User</label>
            <select id="notif-target-user" class="form-select">
                ${users.map(u => `<option value="${u.uid}" ${u.uid === presetUid ? 'selected' : ''}>${escapeHtml(u.username || 'User')} (${escapeHtml(u.email || '')})</option>`).join('')}
            </select>
        </div>
        <div class="admin-form-row">
            <label>Message</label>
            <textarea id="notif-message" class="form-textarea" rows="3" placeholder="e.g. New study plan just dropped — check it out!"></textarea>
        </div>
        <div class="flex gap-2" style="display:flex; gap:8px;">
            <button id="notif-cancel-btn" class="btn btn-outline" style="flex:1;">Cancel</button>
            <button id="notif-send-btn" class="btn btn-primary" style="flex:1;"><i class="fas fa-paper-plane"></i> Send</button>
        </div>
    `);

    $('#notif-target-type').addEventListener('change', (e) => {
        $('#notif-target-user-row').classList.toggle('hidden', e.target.value !== 'specific');
    });

    $('#notif-cancel-btn').addEventListener('click', () => closeAdminModal());

    $('#notif-send-btn').addEventListener('click', async () => {
        const message = $('#notif-message').value.trim();
        if (!message) { showAdminToast('Please write a message first.', 'error'); return; }

        const targetType = $('#notif-target-type').value;
        const btn = $('#notif-send-btn');
        btn.disabled = true;
        btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Sending…`;

        try {
            if (targetType === 'specific') {
                const uid = $('#notif-target-user').value;
                await sendAdminNotification(uid, message);
                showAdminToast('Notification sent.', 'success');
            } else {
                const uids = Object.keys(userDirectory);
                await Promise.all(uids.map(uid => sendAdminNotification(uid, message)));
                showAdminToast(`Notification sent to ${uids.length} users.`, 'success');
            }
            closeAdminModal();
        } catch (error) {
            console.error('Error sending notification:', error);
            showAdminToast('Failed to send notification.', 'error');
            btn.disabled = false;
            btn.innerHTML = `<i class="fas fa-paper-plane"></i> Send`;
        }
    });
}

async function sendAdminNotification(uid, message) {
    await database.ref(`users/${uid}/notifications`).push({
        type: 'admin_broadcast',
        message,
        fromUid: AdminState.user.uid,
        read: false,
        timestamp: Date.now()
    });
}

/* ============================================
   QUIZ TAB
   ============================================ */
async function renderQuizTab() {
    const data = await fetchQuizData();
    const startTime = data.startTime || null;
    const timerMinutes = data.timerMinutes || 25;
    const concentration = data.concentration || [];
    const questions = data.questions || [];
    const participants = Object.entries(data.participants || {}).map(([uid, p]) => ({ uid, ...p }))
        .sort((a, b) => (b.score - a.score) || ((a.timeTakenSeconds ?? 9e9) - (b.timeTakenSeconds ?? 9e9)));

    const startTimeLocal = startTime ? new Date(startTime - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';

    $('#admin-content').innerHTML = `
        <div class="admin-panel">
            <h2>Quiz Schedule</h2>
            <div class="admin-form-grid">
                <div class="admin-form-row">
                    <label>Start date &amp; time (D-Day)</label>
                    <input type="datetime-local" id="quiz-start-time" class="form-input" value="${startTimeLocal}">
                </div>
                <div class="admin-form-row">
                    <label>Per-attempt timer (minutes)</label>
                    <input type="number" id="quiz-timer-minutes" class="form-input" value="${timerMinutes}" min="1" max="180">
                </div>
            </div>
            <p class="text-muted" style="font-size:12px; margin-bottom:12px;">Saving a NEW date automatically archives the current round's participants and starts a fresh leaderboard.</p>
            <button id="quiz-save-schedule-btn" class="btn btn-primary"><i class="fas fa-floppy-disk"></i> Save Schedule</button>
        </div>

        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2>Area of Concentration</h2>
                <button class="btn btn-outline btn-sm" onclick="addConcentrationRow()"><i class="fas fa-plus"></i> Add</button>
            </div>
            <div id="concentration-list">
                ${concentration.map((c, i) => concentrationRowHTML(c, i)).join('') || '<p class="text-muted">No prep items yet.</p>'}
            </div>
            <button id="quiz-save-concentration-btn" class="btn btn-outline btn-sm mt-2">Save Concentration List</button>
        </div>

        <div class="admin-panel">
            <h2>Generate Questions with AI</h2>
            <div class="admin-form-grid">
                <div class="admin-form-row">
                    <label>Difficulty</label>
                    <select id="ai-difficulty" class="form-select">
                        <option value="easy">Easy</option>
                        <option value="medium" selected>Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </div>
                <div class="admin-form-row">
                    <label>Number of questions</label>
                    <input type="number" id="ai-question-count" class="form-input" value="10" min="1" max="30">
                </div>
            </div>
            <div class="admin-form-row">
                <label>Topic / scope (optional — defaults to the Area of Concentration above)</label>
                <input type="text" id="ai-topic" class="form-input" placeholder="e.g. The Exodus story, Moses' life">
            </div>
            <button id="ai-generate-btn" class="btn btn-gold"><i class="fas fa-wand-magic-sparkles"></i> Generate</button>
            <div id="ai-generated-preview" class="mt-3"></div>
        </div>

        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2>Questions (${questions.length})</h2>
                <button class="btn btn-outline btn-sm" onclick="addManualQuestion()"><i class="fas fa-plus"></i> Add Manually</button>
            </div>
            <div id="questions-list">
                ${questions.map((q, i) => questionCardHTML(q, i)).join('') || '<p class="text-muted">No questions yet.</p>'}
            </div>
            <button id="quiz-save-questions-btn" class="btn btn-primary mt-2"><i class="fas fa-floppy-disk"></i> Save Questions</button>
        </div>

        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2>Leaderboard (${participants.length})</h2>
                <button class="btn btn-outline btn-sm" onclick="clearLeaderboard()"><i class="fas fa-broom"></i> Clear</button>
            </div>
            <div class="admin-table-wrap">
                <table class="admin-table">
                    <thead><tr><th>#</th><th>Name</th><th>Score</th><th>Time Taken</th></tr></thead>
                    <tbody>
                        ${participants.length > 0 ? participants.map((p, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${escapeHtml(p.name || 'Anonymous')}</td>
                                <td>${p.score}/${p.total}</td>
                                <td>${p.timeTakenSeconds ? Math.round(p.timeTakenSeconds / 60) + ' min' : '—'}</td>
                            </tr>
                        `).join('') : `<tr><td colspan="4" class="admin-loading-row">No participants yet.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    $('#quiz-save-schedule-btn').addEventListener('click', saveQuizSchedule);
    $('#quiz-save-concentration-btn').addEventListener('click', saveConcentrationList);
    $('#quiz-save-questions-btn').addEventListener('click', saveQuestionsList);
    $('#ai-generate-btn').addEventListener('click', generateQuestionsWithAI);

    AdminState.generatedQuestions = [];
    workingQuestions = null;
}

function concentrationRowHTML(c, i) {
    return `
        <div class="admin-form-grid mb-2" data-concentration-row="${i}" style="align-items:center;">
            <input type="text" class="form-input concentration-character" placeholder="Character (e.g. Moses)" value="${escapeHtml(c.character || '')}">
            <input type="text" class="form-input concentration-book" placeholder="Book (e.g. Exodus)" value="${escapeHtml(c.book || '')}">
            <input type="number" class="form-input concentration-chapter" placeholder="Chapter" value="${c.chapter || ''}">
            <input type="text" class="form-input concentration-reference" placeholder="Reference label (e.g. Exodus 1-14)" value="${escapeHtml(c.reference || '')}">
            <button class="admin-icon-btn danger" onclick="this.closest('[data-concentration-row]').remove()"><i class="fas fa-trash"></i></button>
        </div>
    `;
}

function addConcentrationRow() {
    const list = $('#concentration-list');
    if (list.querySelector('.text-muted')) list.innerHTML = '';
    const i = $$('[data-concentration-row]', list).length;
    list.insertAdjacentHTML('beforeend', concentrationRowHTML({}, i));
}

async function saveConcentrationList() {
    const rows = $$('[data-concentration-row]');
    const concentration = rows.map(row => ({
        character: $('.concentration-character', row).value.trim(),
        book: $('.concentration-book', row).value.trim(),
        chapter: parseInt($('.concentration-chapter', row).value) || 1,
        reference: $('.concentration-reference', row).value.trim()
    })).filter(c => c.character || c.reference);

    try {
        await database.ref('quizCompetition/current/concentration').set(concentration);
        AdminState.quizData.concentration = concentration;
        showAdminToast('Concentration list saved.', 'success');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to save.', 'error');
    }
}

function questionCardHTML(q, i) {
    return `
        <div class="admin-question-card" data-question-index="${i}">
            <div class="q-text">${i + 1}. ${escapeHtml(q.question)}</div>
            <div class="admin-question-options">
                ${(q.options || []).map((opt, oi) => `
                    <div class="admin-question-option ${oi === q.correctIndex ? 'correct' : ''}">${escapeHtml(opt)}</div>
                `).join('')}
            </div>
            <div class="admin-question-actions">
                <button class="admin-icon-btn danger" onclick="removeQuestion(${i})"><i class="fas fa-trash"></i></button>
            </div>
        </div>
    `;
}

let workingQuestions = null;

async function ensureWorkingQuestions() {
    if (!workingQuestions) {
        const data = await fetchQuizData();
        workingQuestions = [...(data.questions || [])];
    }
    return workingQuestions;
}

async function removeQuestion(index) {
    const questions = await ensureWorkingQuestions();
    questions.splice(index, 1);
    refreshQuestionsList(questions);
}

function refreshQuestionsList(questions) {
    const list = $('#questions-list');
    const header = $('h2', list.closest('.admin-panel'));
    if (header) header.textContent = `Questions (${questions.length})`;
    list.innerHTML = questions.map((q, i) => questionCardHTML(q, i)).join('') || '<p class="text-muted">No questions yet.</p>';
}

async function addManualQuestion() {
    const question = prompt('Question text:');
    if (!question) return;
    const options = [];
    for (let i = 1; i <= 4; i++) {
        const opt = prompt(`Option ${i}:`);
        if (!opt) { showAdminToast('All 4 options are required — cancelled.', 'warning'); return; }
        options.push(opt);
    }
    const correctInput = prompt('Which option is correct? Enter 1-4:', '1');
    const correctIndex = Math.min(3, Math.max(0, (parseInt(correctInput) || 1) - 1));

    const questions = await ensureWorkingQuestions();
    questions.push({ question, options, correctIndex });
    refreshQuestionsList(questions);
}

async function saveQuestionsList() {
    const questions = workingQuestions || (await fetchQuizData()).questions || [];
    try {
        await database.ref('quizCompetition/current/questions').set(questions);
        AdminState.quizData.questions = questions;
        workingQuestions = null;
        showAdminToast('Questions saved.', 'success');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to save questions.', 'error');
    }
}

async function saveQuizSchedule() {
    const localValue = $('#quiz-start-time').value;
    const timerMinutes = parseInt($('#quiz-timer-minutes').value) || 25;
    if (!localValue) { showAdminToast('Please pick a start date and time.', 'error'); return; }

    const newStartTime = new Date(localValue).getTime();
    const oldData = await fetchQuizData(true);
    const oldStartTime = oldData.startTime;

    try {
        // A genuinely new round (different start time with existing
        // participants) gets its old participants archived first, so
        // last round's scores don't bleed into the new leaderboard.
        if (oldStartTime && oldStartTime !== newStartTime && oldData.participants) {
            await database.ref(`quizCompetition/history/${oldStartTime}`).set({
                startTime: oldStartTime,
                questions: oldData.questions || [],
                participants: oldData.participants
            });
            await database.ref('quizCompetition/current/participants').remove();
        }

        await database.ref('quizCompetition/current').update({
            startTime: newStartTime,
            timerMinutes
        });
        AdminState.quizData = null;
        showAdminToast('Quiz schedule saved.', 'success');
        renderTab('quiz');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to save schedule.', 'error');
    }
}

async function clearLeaderboard() {
    if (!confirm('Clear all participants for the current round? This cannot be undone.')) return;
    try {
        await database.ref('quizCompetition/current/participants').remove();
        AdminState.quizData = null;
        showAdminToast('Leaderboard cleared.', 'success');
        renderTab('quiz');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to clear leaderboard.', 'error');
    }
}

/** Calls DeepSeek to generate MCQ questions at the chosen difficulty,
    scoped to the topic field or (if blank) the current Area of
    Concentration list, and stages them in a preview the admin can
    review/edit before appending to the real question bank. */
async function generateQuestionsWithAI() {
    const difficulty = $('#ai-difficulty').value;
    const count = Math.min(30, Math.max(1, parseInt($('#ai-question-count').value) || 10));
    let topic = $('#ai-topic').value.trim();

    if (!topic) {
        const rows = $$('[data-concentration-row]');
        const fromConcentration = rows.map(row => $('.concentration-reference', row).value.trim() || $('.concentration-character', row).value.trim()).filter(Boolean);
        topic = fromConcentration.length > 0 ? fromConcentration.join(', ') : 'general Bible knowledge (Old and New Testament)';
    }

    const btn = $('#ai-generate-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Generating…`;

    const promptText = `Create ${count} multiple-choice Bible quiz questions at ${difficulty} difficulty, focused on: ${topic}.
Respond with ONLY a JSON array (no markdown, no code fences, no commentary) of exactly ${count} objects, each with these exact fields:
- "question": the question text
- "options": an array of exactly 4 short answer strings
- "correctIndex": the 0-based index (0-3) of the correct option in "options"
Vary which index is correct across questions — do not always make it 0.`;

    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You generate structured Bible quiz questions. You always respond with strictly valid JSON only — no markdown formatting, no code fences, no extra text before or after the JSON array.' },
                    { role: 'user', content: promptText }
                ],
                temperature: 0.8,
                max_tokens: Math.min(4000, count * 120)
            })
        });

        if (!response.ok) throw new Error('AI request failed');
        const data = await response.json();
        let raw = data.choices[0].message.content.trim();
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : raw);

        const clean = parsed
            .filter(q => q && q.question && Array.isArray(q.options) && q.options.length === 4 && typeof q.correctIndex === 'number')
            .slice(0, count);

        AdminState.generatedQuestions = clean;
        renderGeneratedPreview(clean);
        showAdminToast(`Generated ${clean.length} questions — review below before adding.`, 'success');
    } catch (error) {
        console.error('Error generating questions:', error);
        showAdminToast('Failed to generate questions. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i> Generate`;
    }
}

function renderGeneratedPreview(questions) {
    const container = $('#ai-generated-preview');
    if (questions.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = `
        <div class="admin-panel" style="background: rgba(199,166,90,0.08); box-shadow:none; border:1px dashed rgba(199,166,90,0.4);">
            <div class="admin-panel-header">
                <h3 style="margin:0;">Preview (${questions.length})</h3>
                <button class="btn btn-primary btn-sm" onclick="addGeneratedToQuestionBank()"><i class="fas fa-check"></i> Add All to Question Bank</button>
            </div>
            ${questions.map((q, i) => questionCardHTML(q, i)).join('')}
        </div>
    `;
}

async function addGeneratedToQuestionBank() {
    const questions = await ensureWorkingQuestions();
    questions.push(...AdminState.generatedQuestions);
    refreshQuestionsList(questions);
    AdminState.generatedQuestions = [];
    $('#ai-generated-preview').innerHTML = '';
    showAdminToast('Added to question bank below — remember to Save Questions.', 'success');
}

/* ============================================
   SPACE MODERATION TAB
   ============================================ */
async function renderSpaceTab() {
    const posts = await fetchAllSpacePosts();
    posts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    $('#admin-content').innerHTML = `
        <div class="admin-panel">
            <div class="admin-panel-header">
                <h2>Space Posts (${posts.length})</h2>
                <div class="admin-pill-group" id="space-mod-filters">
                    <button class="admin-pill active" data-type="all">All</button>
                    <button class="admin-pill" data-type="text">Reflections</button>
                    <button class="admin-pill" data-type="note">Notes</button>
                    <button class="admin-pill" data-type="plan">Study Plans</button>
                    <button class="admin-pill" data-type="video">Videos</button>
                </div>
            </div>
            <div id="space-mod-list">${spaceModListHTML(posts)}</div>
        </div>
    `;

    $$('#space-mod-filters .admin-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            $$('#space-mod-filters .admin-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const type = pill.dataset.type;
            const filtered = type === 'all' ? posts : posts.filter(p => (p.type || 'text') === type);
            $('#space-mod-list').innerHTML = spaceModListHTML(filtered);
        });
    });
}

function spaceModListHTML(posts) {
    if (posts.length === 0) return `<p class="admin-loading-row">No posts.</p>`;
    return posts.map(post => {
        const preview = post.content || post.text || post.title || post.caption || '(no text content)';
        return `
            <div class="admin-space-post" data-post-id="${post.id}">
                <div class="admin-space-post-body">
                    <div class="admin-space-post-meta">${escapeHtml(post.type || 'text')} • ${escapeHtml(post.authorName || post.authorId || 'Unknown author')} • ${formatDate(post.timestamp)}</div>
                    <div class="admin-space-post-content">${escapeHtml(preview)}</div>
                    <div style="font-size:11px; color: var(--text-slate); margin-top:4px;">
                        <i class="fas fa-hands-praying"></i> ${Object.keys(post.amens || {}).length} &nbsp;
                        <i class="fas fa-comment"></i> ${Object.keys(post.comments || {}).length}
                    </div>
                </div>
                <button class="admin-icon-btn danger" title="Delete post" onclick="deleteSpacePost('${post.id}')"><i class="fas fa-trash"></i></button>
            </div>
        `;
    }).join('');
}

async function deleteSpacePost(postId) {
    if (!confirm('Delete this Space post permanently?')) return;
    try {
        await database.ref(`spacePosts/${postId}`).remove();
        AdminState.spacePosts = (AdminState.spacePosts || []).filter(p => p.id !== postId);
        const el = document.querySelector(`[data-post-id="${postId}"]`);
        if (el) el.remove();
        showAdminToast('Post deleted.', 'success');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to delete post.', 'error');
    }
}

/* ============================================
   ADMINS TAB (master only)
   ============================================ */
async function renderAdminsTab() {
    if (!AdminState.isMaster) {
        $('#admin-content').innerHTML = `<div class="admin-empty-state"><i class="fas fa-lock"></i><p>Only the master admin can manage admin access.</p></div>`;
        return;
    }

    const [adminsSnap, userDirectory] = await Promise.all([
        database.ref('admins').once('value'),
        fetchUserDirectory()
    ]);
    const admins = adminsSnap.val() || {};

    $('#admin-content').innerHTML = `
        <div class="admin-panel">
            <h2>Master Admin</h2>
            <p><span class="admin-badge admin-badge-gold"><i class="fas fa-crown"></i> ${MASTER_ADMIN_EMAIL}</span> — permanent, cannot be revoked here.</p>
        </div>

        <div class="admin-panel">
            <h2>Grant Access</h2>
            <div class="admin-form-row">
                <label>User email (must already have a GraceGuide account)</label>
                <input type="email" id="grant-admin-email" class="form-input" placeholder="someone@example.com">
            </div>
            <button id="grant-admin-btn" class="btn btn-primary"><i class="fas fa-user-plus"></i> Grant Admin Access</button>
        </div>

        <div class="admin-panel">
            <h2>Granted Admins (${Object.keys(admins).length})</h2>
            <div id="granted-admins-list">
                ${grantedAdminsHTML(admins, userDirectory)}
            </div>
        </div>
    `;

    $('#grant-admin-btn').addEventListener('click', async () => {
        const email = $('#grant-admin-email').value.trim().toLowerCase();
        if (!email) { showAdminToast('Please enter an email.', 'error'); return; }

        const dir = await fetchUserDirectory(true);
        const match = Object.entries(dir).find(([, u]) => (u.email || '').toLowerCase() === email);
        if (!match) {
            showAdminToast('No GraceGuide account found with that email. They need to sign up first.', 'error');
            return;
        }

        const [uid, u] = match;
        try {
            await database.ref(`admins/${uid}`).set({
                email: u.email,
                grantedBy: AdminState.user.email,
                grantedAt: Date.now()
            });
            showAdminToast(`Admin access granted to ${u.email}.`, 'success');
            renderTab('admins');
        } catch (error) {
            console.error(error);
            showAdminToast('Failed to grant access.', 'error');
        }
    });
}

function grantedAdminsHTML(admins, userDirectory) {
    const entries = Object.entries(admins);
    if (entries.length === 0) return `<p class="text-muted">No additional admins yet.</p>`;
    return entries.map(([uid, info]) => `
        <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06); display:flex; align-items:center; justify-content:space-between;">
            <div>
                <div style="font-weight:600;">${escapeHtml((userDirectory[uid] && userDirectory[uid].username) || info.email || uid)}</div>
                <div style="font-size:12px; color:var(--text-slate);">${escapeHtml(info.email || '')} • granted ${formatDate(info.grantedAt)}</div>
            </div>
            <button class="admin-icon-btn danger" title="Revoke" onclick="revokeAdmin('${uid}')"><i class="fas fa-user-minus"></i></button>
        </div>
    `).join('');
}

async function revokeAdmin(uid) {
    if (!confirm('Revoke admin access for this user?')) return;
    try {
        await database.ref(`admins/${uid}`).remove();
        showAdminToast('Access revoked.', 'success');
        renderTab('admins');
    } catch (error) {
        console.error(error);
        showAdminToast('Failed to revoke access.', 'error');
    }
}

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
    initGateForm();
    initSidebarNav();
    initAccessGate();
});
