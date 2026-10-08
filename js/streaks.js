/* ============================================
   GraceGuide — js/streaks.js
   The devotion streak, and the Faithfulness score that brings the three
   daily habits together:

     Devotion  — days in a row the Daily Devotional was marked done
     Study     — days in a row a Study Planner entry was completed
     Play      — days in a row a Play & Learn game was played

   Faithfulness = the AVERAGE of those three current streaks. It earns
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

    var api = { FAITH_TITLES: FAITH_TITLES, previousDayKey: previousDayKey, liveStreak: liveStreak, extendStreak: extendStreak, faithScore: faithScore };
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

    /** Saves my streak records on my public profile so others see my title. Best-effort. */
    async function publishFaith() {
        if (!AppState.currentUser) return null;
        try {
            var rec = await myStreakRecords();
            rec.at = Date.now();
            AppState.faith = rec;
            if (AppState.userProfile) AppState.userProfile.faith = rec;
            database.ref('users/' + AppState.currentUser.uid + '/profile/faith').set(rec).catch(function () {});
            return scoreFromRecords(rec);
        } catch (e) { return null; }
    }
    root.publishFaith = publishFaith;

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
        card.innerHTML =
            '<div class="faith-head"><div class="faith-badge">' + score.level + '</div><div class="faith-head-main"><div class="faith-title">' + escapeHtml(score.title) + '</div>' +
            '<div class="faith-sub">' + score.points + ' faithfulness points · average streak ' + score.average + ' day' + (score.average === 1 ? '' : 's') + '</div></div>' +
            '<button class="icon-btn" onclick="showFaithTitles()" aria-label="How faithfulness works"><i class="fas fa-circle-info"></i></button></div>' +
            '<div class="faith-bar"><div style="width:' + pct + '%"></div></div>' +
            '<div class="faith-next">' + (score.next ? score.next.toGo + ' more day' + (score.next.toGo === 1 ? '' : 's') + ' of average streak to become <strong>' + escapeHtml(score.next.title) + '</strong>' : 'The highest title. Keep going!') + '</div>' +
            streakRow('fa-sun', 'Devotion', score.devotion, 'Mark the Daily Devotional done') +
            streakRow('fa-calendar-check', 'Study', score.study, 'Complete a Study Planner entry') +
            streakRow('fa-gamepad', 'Play &amp; Learn', score.games, 'Play any Bible game');
    };

    root.showFaithTitles = function () {
        var mine = AppState.faith ? scoreFromRecords(AppState.faith) : null;
        showSheet('<h3 style="margin-bottom:4px;">Faithfulness</h3>' +
            '<p class="text-muted" style="font-size:13px; margin-bottom:14px;">Your score is the <strong>average</strong> of three daily streaks — Devotion, Study and Play &amp; Learn — times ten. Keeping all three alive is what moves you up; a streak ends after a day is missed.</p>' +
            FAITH_TITLES.map(function (t, i) {
                var on = mine && mine.level === i + 1;
                return '<div class="faith-level' + (on ? ' faith-level-on' : '') + '"><span class="faith-level-num">' + (i + 1) + '</span><span class="faith-level-main"><strong>' + t[1] + '</strong><small>' + t[2] + '</small></span>' +
                    '<span class="faith-level-at">' + (t[0] === 0 ? 'Start' : t[0] + '+ days') + '</span></div>';
            }).join(''));
    };

    /** One line for someone else's profile: "Faithful · 142 pts". Empty if they have no score yet. */
    root.faithLineHTML = function (profile) {
        var score = root.faithFromProfile(profile);
        if (!score) return '';
        return '<div class="faith-line" onclick="showFaithTitles()"><i class="fas fa-fire"></i> ' + escapeHtml(score.title) + ' · ' + score.points + ' faithfulness points</div>';
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
