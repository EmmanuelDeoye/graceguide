/* ============================================
   GraceGuide — js/streaks.js
   The devotion streak, and the Faithfulness score that brings the three
   daily habits together:

     Devotion  — days in a row the Daily Devotional was marked done
     Study     — days in a row a Study Planner entry was completed
     Play      — days in a row a Play & Learn game was played

   Spirit Life (shown to users under that name) = the AVERAGE of those three current streaks. It earns
   points (average × 10) and one of ten titles. Averaging on purpose: one
   long streak cannot carry the score — the way up is to keep all three.

   The pure functions at the top are shared with the tests (and mirrored in
   the Android app's Faithfulness.kt — keep the two in step).
   Load after features.js.
   ============================================ */
(function (root) {
    'use strict';

    /** [minimum average streak in days, title, what it means] — ten levels. */
    var FAITH_TITLES = [
        [0, 'Seeker', 'Just beginning — start any streak today.'],
        [1, 'Starter', 'You have begun the habit.'],
        [3, 'Steady', 'Three days and counting across your habits.'],
        [5, 'Committed', 'Most of a week, kept together.'],
        [7, 'Devoted', 'A full week of daily faithfulness.'],
        [14, 'Faithful', 'Two weeks without letting go.'],
        [21, 'Steadfast', 'Three weeks — it is becoming who you are.'],
        [30, 'Disciplined', 'A whole month, day after day.'],
        [60, 'Pillar', 'Two months of unbroken devotion.'],
        [100, 'Unshakeable', 'A hundred days. Well done, good and faithful servant.']
    ];

    function previousDayKey(key) {
        var p = String(key).split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - 86400000);
        return d.toISOString().slice(0, 10);
    }

    /**
     * A stored streak { c: count, last: 'YYYY-MM-DD' } only still counts if its last day is
     * today or yesterday — after a missed day it is over, whatever number was saved.
     */
    function liveStreak(streak, todayKey) {
        if (!streak || !(streak.c > 0) || typeof streak.last !== 'string') return 0;
        return streak.last === todayKey || streak.last === previousDayKey(todayKey) ? Math.floor(streak.c) : 0;
    }

    /** The streak after doing the thing on `todayKey`. Doing it twice in a day changes nothing. */
    function extendStreak(streak, todayKey) {
        var s = streak || {};
        var count = s.last === todayKey ? (s.c || 1) : (s.last === previousDayKey(todayKey) ? (s.c || 0) + 1 : 1);
        return { c: count, last: todayKey, best: Math.max(s.best || 0, count) };
    }

    /** { average, points, level (1–10), title, about, next: { title, at, toGo } | null } */
    function faithScore(devotion, study, games) {
        var d = Math.max(0, devotion || 0), s = Math.max(0, study || 0), g = Math.max(0, games || 0);
        var average = Math.round(((d + s + g) / 3) * 10) / 10;
        var level = 0;
        for (var i = 0; i < FAITH_TITLES.length; i++) if (average >= FAITH_TITLES[i][0]) level = i;
        var next = FAITH_TITLES[level + 1];
        return {
            devotion: d, study: s, games: g, average: average, points: Math.round(average * 10),
            level: level + 1, title: FAITH_TITLES[level][1], about: FAITH_TITLES[level][2],
            next: next ? { title: next[1], at: next[0], toGo: Math.round((next[0] - average) * 10) / 10 } : null
        };
    }

    /** Each Spirit Life level has its own sticker (shown on the profile picture). Level 1 → 10. */
    var SPIRIT_STICKERS = ['🌱', '🕯️', '🌿', '🔥', '🙏', '🛡️', '⚓', '⛰️', '🏛️', '👑'];

    var api = { SPIRIT_STICKERS: SPIRIT_STICKERS, FAITH_TITLES: FAITH_TITLES, previousDayKey: previousDayKey, liveStreak: liveStreak, extendStreak: extendStreak, faithScore: faithScore };
    if (typeof module === 'object' && module.exports) { module.exports = api; return; }
    root.Streaks = api;

    // ---------- app glue (browser only) ----------

    var utcToday = function () { return new Date().toISOString().slice(0, 10); };
    var localToday = function () { return typeof localDateKey === 'function' ? localDateKey() : utcToday(); };

    /** Marks today's devotional in the streak. Called when a devotional is marked done. */
    root.recordDevotionStreak = async function () {
        if (!AppState.currentUser) return null;
        var ref = database.ref('users/' + AppState.currentUser.uid + '/devotionStreak');
        try {
            var current = (await ref.once('value')).val();
            var next = extendStreak(current, utcToday()); // devotionals are keyed by UTC day
            await ref.set(next);
            AppState.devotionStreak = next;
            publishFaith();
            return next;
        } catch (e) { console.error('Error saving devotion streak:', e); return null; }
    };

    /** My three streaks as stored records ({ c, last }), freshly read. */
    async function myStreakRecords() {
        var uid = AppState.currentUser.uid;
        var study = typeof computeStudyStreak === 'function' ? computeStudyStreak() : { count: 0, doneToday: false };
        var studyLast = study.count > 0 ? (study.doneToday ? localToday() : previousDayKey(localToday())) : '';
        var results = await Promise.all([
            database.ref('users/' + uid + '/devotionStreak').once('value').then(function (s) { return s.val(); }, function () { return null; }),
            database.ref('games/profiles/' + uid).once('value').then(function (s) { return s.val(); }, function () { return null; })
        ]);
        AppState.devotionStreak = results[0];
        var game = results[1] || {};
        return {
            dev: results[0] ? { c: results[0].c || 0, last: results[0].last || '', best: results[0].best || 0 } : { c: 0, last: '' },
            study: { c: study.count, last: studyLast },
            games: { c: game.streak || 0, last: game.lastDay || '' }
        };
    }

    /** Faithfulness from stored records. Devotion days are UTC; study and games use the local day. */
    function scoreFromRecords(rec) {
        rec = rec || {};
        return faithScore(liveStreak(rec.dev, utcToday()), liveStreak(rec.study, localToday()), liveStreak(rec.games, localToday()));
    }
    root.faithFromProfile = function (profile) { return profile && profile.faith ? scoreFromRecords(profile.faith) : null; };

    /** May the signed-in person see this profile's Spirit Life? (Its owner can limit it to Brethren.) */
    function spiritVisible(uid, profile) {
        if (!profile || !profile.spiritPrivate) return true;
        var me = AppState.currentUser && AppState.currentUser.uid;
        return uid === me || (AppState.userConnections && AppState.userConnections.get(uid) === 'brethren');
    }
    /** The level sticker: a small round badge, unique to each of the ten levels. */
    function stickerHTML(score, extraClass) {
        return '<span class="spirit-sticker spirit-l' + score.level + (extraClass ? ' ' + extraClass : '') + '" title="Spirit Life ' + score.points + ' · ' + escapeHtml(score.title) + '">' + SPIRIT_STICKERS[score.level - 1] + '</span>';
    }
    root.spiritStickerFor = function (uid, profile, extraClass) {
        var score = root.faithFromProfile(profile);
        return score && spiritVisible(uid, profile) ? stickerHTML(score, extraClass) : '';
    };
    /**
     * Wherever a person's avatar appears (posts, comments, chats, lists) their level sticker
     * sits on its corner. Called by hydrateUserNames() with the avatar-initial nodes it resolved.
     */
    root.applySpiritStickers = function (nodes) {
        if (typeof UserNameCache === 'undefined' || !UserNameCache.profiles) return;
        nodes.forEach(function (node) {
            var uid = node.dataset.userInitial, holder = node.parentElement;
            if (!uid || !holder) return;
            var old = holder.querySelector(':scope > .spirit-sticker');
            var html = root.spiritStickerFor(uid, UserNameCache.profiles.get(uid), 'spirit-on-avatar');
            if (old) old.remove();
            if (!html) return;
            holder.classList.add('has-spirit');
            holder.insertAdjacentHTML('beforeend', html);
        });
    };
    /** Settings: show my level to Brethren only. */
    root.setSpiritPrivate = function (on) {
        if (!AppState.currentUser) return;
        database.ref('users/' + AppState.currentUser.uid + '/profile/spiritPrivate').set(!!on).then(function () {
            if (AppState.userProfile) AppState.userProfile.spiritPrivate = !!on;
            showToast(on ? 'Only your Brethren can see your Spirit Life level now.' : 'Everyone can see your Spirit Life level.', 'success');
        }, function () { showToast('Could not save — please try again.', 'error'); });
    };

    /** Saves my streak records on my public profile so others see my title. Best-effort. */
    async function publishFaith() {
        if (!AppState.currentUser) return null;
        try {
            var rec = await myStreakRecords();
            rec.at = Date.now();
            AppState.faith = rec;
            if (AppState.userProfile) AppState.userProfile.faith = rec;
            database.ref('users/' + AppState.currentUser.uid + '/profile/faith').set(rec).catch(function () {});
            var score = scoreFromRecords(rec);
            noteSpiritLevel(AppState.currentUser.uid, score);
            if (typeof updateProfileNavIcon === 'function') updateProfileNavIcon();
            return score;
        } catch (e) { return null; }
    }
    root.publishFaith = publishFaith;

    // ---------- rising to a higher Spirit Life ----------

    /**
     * Remembers the level this device last saw for me and celebrates when it has gone up.
     * (The first time — nothing remembered yet — is only noted: no pop-up for a level I
     * already had. A level that drops is noted too, so climbing back is celebrated again.)
     */
    function noteSpiritLevel(uid, score) {
        if (!score) return;
        var key = 'gg_spirit_level_' + uid, before = null;
        try { var v = localStorage.getItem(key); before = v == null ? null : parseInt(v, 10); } catch (e) { return; }
        if (before !== score.level) { try { localStorage.setItem(key, String(score.level)); } catch (e) { /* private mode */ } }
        if (before != null && !isNaN(before) && score.level > before) showSpiritLevelUp(score);
    }

    /** A short rising fanfare, made on the spot (no sound files). */
    function fanfare() {
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            var ctx = new Ctx(), t0 = ctx.currentTime + 0.02;
            [[392, 0], [523.25, 0.14], [659.25, 0.28], [783.99, 0.42], [1046.5, 0.6], [1318.5, 0.6], [1568, 0.6]].forEach(function (n) {
                var osc = ctx.createOscillator(), gain = ctx.createGain(), at = t0 + n[1], long = n[1] >= 0.6;
                osc.type = 'triangle'; osc.frequency.value = n[0];
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(long ? 0.13 : 0.16, at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + (long ? 1.4 : 0.5));
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(at); osc.stop(at + (long ? 1.5 : 0.6));
            });
            setTimeout(function () { try { ctx.close(); } catch (e) { /* already closed */ } }, 2600);
        } catch (e) { /* no sound is fine */ }
    }

    /**
     * The celebration for reaching a higher Spirit Life level — shown over whatever page is
     * open. Grander than a game badge: a full-screen glow, turning rays, falling light, the new
     * level's sticker, and a button to share it on the branded GraceGuide card.
     */
    function showSpiritLevelUp(score) {
        if (typeof document === 'undefined' || document.getElementById('spirit-pop')) return;
        var sparks = '';
        for (var i = 0; i < 34; i++) {
            sparks += '<i style="left:' + Math.round(Math.random() * 100) + '%; animation-delay:' + (Math.random() * 2.4).toFixed(2) + 's; animation-duration:' + (2.6 + Math.random() * 2.4).toFixed(2) + 's; --s:' + (0.5 + Math.random()).toFixed(2) + ';"></i>';
        }
        var el = document.createElement('div');
        el.id = 'spirit-pop';
        el.className = 'spirit-pop';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'You reached a higher Spirit Life');
        el.innerHTML =
            '<div class="spirit-pop-sparks">' + sparks + '</div>' +
            '<div class="spirit-pop-card">' +
            '<div class="spirit-pop-halo"><div class="spirit-pop-rays"></div><div class="spirit-pop-rays spirit-pop-rays-2"></div>' +
            '<div class="spirit-pop-ring"></div><div class="spirit-pop-sticker">' + SPIRIT_STICKERS[score.level - 1] + '</div></div>' +
            '<div class="spirit-pop-eyebrow">Spirit Life · Level ' + score.level + ' of 10</div>' +
            '<h2 class="spirit-pop-title">' + escapeHtml(score.title) + '</h2>' +
            '<p class="spirit-pop-about">' + escapeHtml(score.about) + '</p>' +
            '<div class="spirit-pop-points"><strong>' + score.points + '</strong><span>Spirit Life</span></div>' +
            '<p class="spirit-pop-verse">“Well done, good and faithful servant.” <small>Matthew 25:23</small></p>' +
            '<div class="spirit-pop-actions">' +
            '<button class="btn btn-gold btn-block" id="spirit-pop-share"><i class="fas fa-share-nodes"></i> Share</button>' +
            '<button class="btn btn-block spirit-pop-continue" id="spirit-pop-close">Continue</button></div></div>';
        document.body.appendChild(el);
        setTimeout(function () { el.classList.add('on'); }, 30); // (a timer, not an animation frame: frames can be held back while the tab is not in front)
        fanfare();
        var close = function () { el.classList.remove('on'); setTimeout(function () { el.remove(); }, 320); };
        document.getElementById('spirit-pop-close').onclick = close;
        document.getElementById('spirit-pop-share').onclick = function () {
            close();
            if (typeof shareSpiritLifeCard === 'function') shareSpiritLifeCard(score);
        };
        // My avatar's sticker changes with the level.
        var mySticker = document.getElementById('my-spirit-sticker');
        if (mySticker) mySticker.innerHTML = stickerHTML(score);
    }
    root.showSpiritLevelUp = showSpiritLevelUp;
    root.playFanfare = fanfare;

    function streakRow(icon, label, days, hint) {
        return '<div class="faith-row"><span class="faith-row-icon"><i class="fas ' + icon + '"></i></span><span class="faith-row-label">' + label +
            '<small>' + hint + '</small></span><span class="faith-row-value"><i class="fas fa-fire"></i> ' + days + '</span></div>';
    }

    /** The Faithfulness card on My Profile. Renders a placeholder, then fills itself in. */
    root.faithCardHTML = function () { setTimeout(root.loadFaithCard, 0); return '<div class="card mb-3 faith-card" id="faith-card"><div class="skeleton" style="height: 120px; border-radius: 12px;"></div></div>'; };
    root.loadFaithCard = async function () {
        var score = await publishFaith();
        var card = document.getElementById('faith-card');
        if (!card || !score) return;
        var pct = score.next ? Math.max(4, Math.min(100, Math.round(100 * (score.average - FAITH_TITLES[score.level - 1][0]) / (score.next.at - FAITH_TITLES[score.level - 1][0])))) : 100;
        // My profile picture carries my level sticker (where the camera icon used to be).
        var mySticker = document.getElementById('my-spirit-sticker');
        if (mySticker) mySticker.innerHTML = stickerHTML(score);
        card.innerHTML =
            '<div class="faith-head"><div class="faith-badge">' + SPIRIT_STICKERS[score.level - 1] + '</div><div class="faith-head-main"><div class="faith-eyebrow">Spirit Life</div><div class="faith-title">' + score.points + ' <span>· ' + escapeHtml(score.title) + '</span></div>' +
            '<div class="faith-sub">Level ' + score.level + ' of 10 · average streak ' + score.average + ' day' + (score.average === 1 ? '' : 's') + '</div></div>' +
            '<button class="icon-btn" onclick="shareMySpiritLife()" aria-label="Share my Spirit Life"><i class="fas fa-share-nodes"></i></button>' +
            '<button class="icon-btn" onclick="showFaithTitles()" aria-label="How Spirit Life works"><i class="fas fa-circle-info"></i></button></div>' +
            '<div class="faith-bar"><div style="width:' + pct + '%"></div></div>' +
            '<div class="faith-next">' + (score.next ? score.next.toGo + ' more day' + (score.next.toGo === 1 ? '' : 's') + ' of average streak to reach <strong>' + escapeHtml(score.next.title) + '</strong>' : 'The highest title. Keep going!') + '</div>' +
            streakRow('fa-sun', 'Devotion', score.devotion, 'Mark the Daily Devotional done') +
            streakRow('fa-calendar-check', 'Study', score.study, 'Complete a Study Planner entry') +
            streakRow('fa-gamepad', 'Play &amp; Learn', score.games, 'Play any Bible game');
    };

    /** Share my Spirit Life on the branded card (the short format). */
    root.shareMySpiritLife = function () {
        var score = AppState.faith ? scoreFromRecords(AppState.faith) : null;
        if (score && typeof shareSpiritLifeCard === 'function') shareSpiritLifeCard(score);
    };

    root.showFaithTitles = function () {
        var mine = AppState.faith ? scoreFromRecords(AppState.faith) : null;
        showSheet('<h3 style="margin-bottom:4px;">Spirit Life</h3>' +
            '<p class="text-muted" style="font-size:13px; margin-bottom:14px;">Your Spirit Life is the <strong>average</strong> of three daily streaks — Devotion, Study and Play &amp; Learn — times ten. Keeping all three alive is what moves you up; a streak ends after a day is missed. Each level has its own badge, shown on your profile picture.</p>' +
            FAITH_TITLES.map(function (t, i) {
                var on = mine && mine.level === i + 1;
                return '<div class="faith-level' + (on ? ' faith-level-on' : '') + '"><span class="faith-level-num">' + SPIRIT_STICKERS[i] + '</span><span class="faith-level-main"><strong>' + t[1] + '</strong><small>' + t[2] + '</small></span>' +
                    '<span class="faith-level-at">' + (t[0] === 0 ? 'Start' : t[0] + '+ days') + '</span></div>';
            }).join(''));
    };

    /** One line for someone else's profile: "Faithful · 142 pts". Empty if they have no score yet. */
    root.faithLineHTML = function (profile, uid) {
        var score = root.faithFromProfile(profile);
        if (!score || !spiritVisible(uid, profile)) return '';
        return '<div class="faith-line" onclick="showFaithTitles()">' + SPIRIT_STICKERS[score.level - 1] + ' Spirit Life ' + score.points + ' · ' + escapeHtml(score.title) + '</div>';
    };

    /** "🔥 5-day devotion streak" for the devotional page; empty when there is no streak. */
    root.devotionStreakHTML = function () {
        var rec = AppState.devotionStreak;
        var days = liveStreak(rec, utcToday());
        if (!days) return '<div class="devotion-streak devotion-streak-none"><i class="fas fa-fire"></i> Mark today done to start a devotion streak</div>';
        var doneToday = rec.last === utcToday();
        return '<div class="devotion-streak"><i class="fas fa-fire"></i> ' + days + '-day devotion streak' +
            (doneToday ? '' : ' — mark today done to keep it') + (rec.best > days ? ' <small>· best ' + rec.best + '</small>' : '') + '</div>';
    };
    root.loadDevotionStreak = async function () {
        if (!AppState.currentUser) return null;
        try { AppState.devotionStreak = (await database.ref('users/' + AppState.currentUser.uid + '/devotionStreak').once('value')).val(); } catch (e) { /* offline */ }
        return AppState.devotionStreak;
    };
})(typeof window !== 'undefined' ? window : this);
