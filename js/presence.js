/* ============================================
   GraceGuide — js/presence.js
   A person's status, shown on profiles and in Community → Users:

     Online  — the app is open in front of them right now
     Away    — the app is open, but they have stepped away (no touch for a few
               minutes, or the app is in the background)
     Active  — not here right now, but they used GraceGuide in the last day

   Nothing else is ever shown to other members: no "offline", no "last seen".
   (Only the admin page shows those.)

   Where it lives: publicProfiles/{uid}/presence = { s: 'online' | 'away' | 'off',
   at: server time }. The server itself writes 'off' when the connection goes
   (onDisconnect), so a closed tab or a dead battery never leaves someone
   "online". Rule block: community.rules.json.

   The pure function at the top is shared with the tests and mirrored in the
   Android app (data/Presence.kt — keep the two in step).
   Load after community.js.
   ============================================ */
(function (root) {
    'use strict';

    var DAY_MS = 86400000;
    /** A record still saying "online" this long after it was written is not believed (a server that never got to mark it off). */
    var TRUST_MS = 12 * 3600000;

    /**
     * What other members see: 'online' | 'away' | 'active' | null (show nothing).
     * presence = { s, at } from publicProfiles/{uid}/presence; lastActiveAt = the card's own stamp.
     */
    function userStatus(presence, lastActiveAt, now) {
        var p = presence && typeof presence === 'object' ? presence : null;
        var at = p && typeof p.at === 'number' ? p.at : 0;
        if (p && (p.s === 'online' || p.s === 'away') && now - at < TRUST_MS) return p.s;
        var last = Math.max(at, typeof lastActiveAt === 'number' ? lastActiveAt : 0);
        return last > 0 && now - last < DAY_MS ? 'active' : null;
    }

    /** What the ADMIN page shows: the same, plus Offline and when the person was last here. */
    function adminStatus(presence, lastActiveAt, now) {
        var s = userStatus(presence, lastActiveAt, now);
        var at = presence && typeof presence.at === 'number' ? presence.at : 0;
        var last = Math.max(at, typeof lastActiveAt === 'number' ? lastActiveAt : 0);
        if (s === 'online' || s === 'away') return { state: s, lastSeen: null };
        return { state: 'offline', lastSeen: last || null };
    }

    var LABELS = { online: 'Online', away: 'Away', active: 'Active' };
    var api = { userStatus: userStatus, adminStatus: adminStatus, LABELS: LABELS, DAY_MS: DAY_MS, TRUST_MS: TRUST_MS };
    if (typeof module === 'object' && module.exports) { module.exports = api; return; }
    root.Presence = api;

    // ---------- my own status (browser only) ----------

    var IDLE_MS = 5 * 60000;       // no touch, key or scroll for this long → Away
    var mine = { uid: null, ref: null, conn: null, onConn: null, state: null, idleTimer: null, lastInput: 0, bound: false };
    var TS = function () { return firebase.database.ServerValue.TIMESTAMP; };

    function wanted() {
        return document.visibilityState === 'hidden' || Date.now() - mine.lastInput >= IDLE_MS ? 'away' : 'online';
    }
    function publish(force) {
        if (!mine.ref) return;
        var s = wanted();
        if (s === mine.state && !force) return;
        mine.state = s;
        // Refused (older rules, or my public card is not written yet): nothing breaks, and the next check tries again.
        mine.ref.set({ s: s, at: TS() }).catch(function () { if (mine.state === s) mine.state = null; });
    }
    function onInput() {
        var was = Date.now() - mine.lastInput >= IDLE_MS;
        mine.lastInput = Date.now();
        if (was || mine.state !== 'online') publish();
    }

    /** Called once I am signed in: keeps my status true for as long as this tab lives. */
    root.startPresence = function () {
        var user = typeof AppState !== 'undefined' && AppState.currentUser;
        if (!user || typeof database === 'undefined') return;
        if (mine.uid === user.uid && mine.ref) return;
        root.stopPresence(false);
        mine.uid = user.uid;
        mine.ref = database.ref('publicProfiles/' + user.uid + '/presence');
        mine.lastInput = Date.now();
        mine.conn = database.ref('.info/connected');
        mine.onConn = mine.conn.on('value', function (snap) {
            if (snap.val() !== true || !mine.ref) return;
            // The server marks me off the moment this connection goes — then I say I am here.
            mine.ref.onDisconnect().set({ s: 'off', at: TS() }).then(function () { publish(true); }).catch(function () {});
        });
        if (!mine.bound) {
            mine.bound = true;
            ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (type) {
                window.addEventListener(type, onInput, { passive: true, capture: true });
            });
            document.addEventListener('visibilitychange', function () { if (document.visibilityState !== 'hidden') mine.lastInput = Date.now(); publish(); });
        }
        clearInterval(mine.idleTimer);
        mine.idleTimer = setInterval(function () { publish(); }, 30000); // notices "no touch for five minutes"
    };

    /** Signing out: say so first (while still signed in). Resolves when it has been written. */
    root.stopPresence = function (write) {
        clearInterval(mine.idleTimer);
        if (mine.conn && mine.onConn) mine.conn.off('value', mine.onConn);
        var ref = mine.ref, done = Promise.resolve();
        if (ref) {
            ref.onDisconnect().cancel().catch(function () {});
            if (write !== false) done = ref.set({ s: 'off', at: TS() }).catch(function () {});
        }
        mine.uid = null; mine.ref = null; mine.conn = null; mine.onConn = null; mine.state = null;
        return done;
    };

    // ---------- other people's status ----------

    /**
     * A placeholder that fills itself in and stays live: <span data-status-uid> → "● Online".
     * `big` = the profile-page size. With `card` (a public card already loaded, as in the Users
     * list) the status is written straight away from it and nothing is listened to.
     */
    root.userStatusHTML = function (uid, big, card) {
        if (!uid) return '';
        if (card) {
            var status = userStatus(card.presence, card.lastActiveAt, Date.now());
            return status ? '<span class="user-status user-status-' + status + (big ? ' user-status-lg' : '') + '" aria-label="' + LABELS[status] + '"><i></i>' + LABELS[status] + '</span>' : '';
        }
        setTimeout(root.hydrateUserStatus, 0);
        return '<span class="user-status' + (big ? ' user-status-lg' : '') + '" data-status-uid="' + String(uid).replace(/"/g, '') + '"></span>';
    };

    function paint(el, status) {
        el.className = el.className.replace(/\s*user-status-(online|away|active)/g, '') + (status ? ' user-status-' + status : '');
        el.innerHTML = status ? '<i></i>' + LABELS[status] : '';
        el.setAttribute('aria-label', status ? LABELS[status] : '');
    }

    var watched = {}; // uid → { ref, handler, card }
    /** Fills in every status placeholder on the page and keeps them live while they are on screen. */
    root.hydrateUserStatus = function () {
        if (typeof database === 'undefined' || typeof AppState === 'undefined' || !AppState.currentUser) return;
        var nodes = document.querySelectorAll('[data-status-uid]'), wantedUids = {};
        nodes.forEach(function (el) { wantedUids[el.getAttribute('data-status-uid')] = true; });
        // Stop watching people who are no longer on screen.
        Object.keys(watched).forEach(function (uid) {
            if (!wantedUids[uid]) { watched[uid].ref.off('value', watched[uid].handler); delete watched[uid]; }
        });
        Object.keys(wantedUids).forEach(function (uid) {
            var repaint = function () {
                var w = watched[uid];
                if (!w) return;
                var status = userStatus(w.card && w.card.presence, w.card && w.card.lastActiveAt, Date.now());
                var live = document.querySelectorAll('[data-status-uid="' + uid + '"]');
                if (!live.length) { w.ref.off('value', w.handler); delete watched[uid]; return; }
                live.forEach(function (el) { paint(el, status); });
            };
            if (watched[uid]) { repaint(); return; }
            var ref = database.ref('publicProfiles/' + uid);
            watched[uid] = { ref: ref, card: null, handler: null };
            watched[uid].handler = ref.on('value', function (snap) { if (watched[uid]) { watched[uid].card = snap.val(); repaint(); } }, function () {});
        });
    };
})(typeof window !== 'undefined' ? window : this);
