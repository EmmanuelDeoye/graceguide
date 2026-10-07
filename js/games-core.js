/* ============================================
   GraceGuide — js/games-core.js
   Play & Learn: the shared, PURE game engine (no Firebase, no DOM).

   The same file runs in the browser (window.GamesCore), in the Cloud
   Function referee (require('./games-core.js')) and in the test suite, and
   the Android app's GameCore.kt is a line-for-line port checked against
   vectors generated from this file. So a score, a rank or an XP award is
   computed identically everywhere — which is what lets every client derive
   results from the raw answers instead of trusting a number someone wrote.

   Protocol reference: graceguide-games-tests/DESIGN.md
   ============================================ */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.GamesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var COUNTDOWN_MS = 4000;
    var REVEAL_MS = 5000;
    var DAY_MS = 86400000;
    var XP_GAME_CAP = 200;
    var XP_DAY_CAP = 2000;
    var MAX_PLAYERS = { duel: 2, room: 8 };

    /** One entry per game. Everything game-specific the engine needs lives here. */
    var GAMES = {
        emoji:      { id: 'emoji',      name: 'Bible Emoji',   icon: 'fa-face-smile',  tagline: 'Decode the story from the emojis',     rounds: 8,  secs: 15,  base: 100, speed: 100, reveal: REVEAL_MS, type: 'choice' },
        wordle:     { id: 'wordle',     name: 'Bible Wordle',  icon: 'fa-table-cells', tagline: 'Six tries to find the Bible word',     rounds: 2,  secs: 120, base: 0,   speed: 0,   reveal: 7000,      type: 'wordle' },
        whoami:     { id: 'whoami',     name: 'Who Am I?',     icon: 'fa-user-secret', tagline: 'Name the person from three clues',     rounds: 6,  secs: 18,  base: 60,  speed: 140, reveal: REVEAL_MS, type: 'choice' },
        bibleornot: { id: 'bibleornot', name: 'Bible or Not?', icon: 'fa-scale-balanced', tagline: 'Is that really in the Bible?',      rounds: 10, secs: 10,  base: 100, speed: 50,  reveal: REVEAL_MS, type: 'choice' },
        battle:     { id: 'battle',     name: 'Bible Battle',  icon: 'fa-bolt',        tagline: 'Fast-fire Bible trivia, head to head', rounds: 10, secs: 12,  base: 100, speed: 100, reveal: REVEAL_MS, type: 'choice' }
    };
    var GAME_IDS = ['emoji', 'wordle', 'whoami', 'bibleornot', 'battle'];
    var WORDLE_MAX_GUESSES = 6;
    var WORDLE_UNITS = 3; // a solved word counts as 3 correct answers for XP

    var BADGES = [
        { id: 'first_steps', name: 'First Steps', icon: 'fa-shoe-prints', desc: 'Play your first game.', ref: 'Psalm 37:23' },
        { id: 'flawless', name: 'Flawless', icon: 'fa-gem', desc: 'Answer every question in a game correctly.', ref: '2 Timothy 2:15' },
        { id: 'word_hidden', name: 'Word Hidden in My Heart', icon: 'fa-heart', desc: 'Solve a Bible Wordle in three guesses or fewer.', ref: 'Psalm 119:11' },
        { id: 'faithful_3', name: 'Faithful Three', icon: 'fa-fire', desc: 'Play three days in a row.', ref: 'Luke 16:10' },
        { id: 'faithful_7', name: 'Seven-Day Faithful', icon: 'fa-fire-flame-curved', desc: 'Play seven days in a row.', ref: 'Lamentations 3:23' },
        { id: 'daily_bread', name: 'Daily Bread', icon: 'fa-bread-slice', desc: 'Complete a Daily Challenge.', ref: 'Matthew 6:11' },
        { id: 'daily_7', name: 'Manna Gatherer', icon: 'fa-calendar-check', desc: 'Complete seven Daily Challenges.', ref: 'Exodus 16:21' },
        { id: 'good_fight', name: 'The Good Fight', icon: 'fa-shield-halved', desc: 'Win five multiplayer games.', ref: '2 Timothy 4:7' },
        { id: 'conqueror', name: 'More Than Conqueror', icon: 'fa-crown', desc: 'Win twenty-five multiplayer games.', ref: 'Romans 8:37' },
        { id: 'all_rounder', name: 'All Things', icon: 'fa-star', desc: 'Play all five games.', ref: 'Philippians 4:13' },
        { id: 'berean', name: 'Berean', icon: 'fa-book-open', desc: 'Earn 1,000 XP.', ref: 'Acts 17:11' },
        { id: 'scribe', name: 'Ready Scribe', icon: 'fa-feather', desc: 'Earn 5,000 XP.', ref: 'Ezra 7:6' }
    ];

    var LEVEL_TITLES = [[1, 'Seeker'], [3, 'Disciple'], [6, 'Berean'], [10, 'Psalmist'], [15, 'Scribe'], [20, 'Watchman'], [30, 'Overcomer']];

    // ---------- small helpers ----------

    /** FNV-1a, 32-bit, over UTF-16 code units. Returns an unsigned integer. */
    function hash(str) {
        var h = 0x811c9dc5;
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    function floorDiv(a, b) { return Math.floor(a / b); }

    /** "YYYY-MM-DD" for the day before `day`. */
    function previousDay(day) {
        var p = String(day).split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - DAY_MS);
        var m = d.getUTCMonth() + 1, dd = d.getUTCDate();
        return d.getUTCFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
    }

    function isDayString(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

    /** Room codes: 5 characters, no look-alikes (0/O, 1/I/L). */
    var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    function makeCode(random) {
        var out = '';
        for (var i = 0; i < 5; i++) out += CODE_ALPHABET.charAt(Math.floor((random || Math.random)() * CODE_ALPHABET.length));
        return out;
    }
    /** What the user typed → a canonical code, or null. Only exact alphabet characters are accepted. */
    function parseCode(input) {
        var s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (s.length !== 5) return null;
        for (var i = 0; i < 5; i++) if (CODE_ALPHABET.indexOf(s.charAt(i)) < 0) return null;
        return s;
    }

    function cleanName(name) {
        var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        return (s || 'Player').slice(0, 24);
    }

    // ---------- bank ----------

    function questionById(bank, game, id) {
        var list = (bank && bank[game]) || [];
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    /** `n` random question ids for a game, avoiding `exclude` (recently seen) when it can. */
    function pickQuestions(bank, game, n, exclude, random) {
        var rnd = random || Math.random;
        var all = ((bank && bank[game]) || []).map(function (q) { return q.id; });
        var skip = {};
        (exclude || []).forEach(function (id) { skip[id] = true; });
        var fresh = all.filter(function (id) { return !skip[id]; });
        var pool = fresh.length >= n ? fresh : all.slice();
        for (var i = pool.length - 1; i > 0; i--) {
            var j = Math.floor(rnd() * (i + 1));
            var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }
        return pool.slice(0, n);
    }

    /** The Daily Challenge: the same five questions for everyone on a given day. */
    var DAILY_SLOTS = ['emoji', 'whoami', 'bibleornot', 'battle', 'battle'];
    var DAILY_LIMIT_MS = 100000;
    function dailyQuestions(bank, day) {
        var out = [], used = {};
        for (var s = 0; s < DAILY_SLOTS.length; s++) {
            var game = DAILY_SLOTS[s], list = bank[game] || [];
            if (!list.length) continue;
            var idx = hash(day + ':' + s + ':' + game) % list.length;
            while (used[list[idx].id]) idx = (idx + 1) % list.length;
            used[list[idx].id] = true;
            out.push({ game: game, id: list[idx].id });
        }
        return out;
    }

    // ---------- answers ----------

    function parseGuesses(a) {
        if (typeof a !== 'string' || !a) return [];
        return a.toUpperCase().split('|').filter(function (g) { return /^[A-Z]{5}$/.test(g); }).slice(0, WORDLE_MAX_GUESSES);
    }

    /** Standard Wordle colouring (handles repeated letters): 'g' right place, 'y' in the word, 'x' absent. */
    function wordleFeedback(guess, word) {
        var g = String(guess).toUpperCase(), w = String(word).toUpperCase();
        var res = ['x', 'x', 'x', 'x', 'x'], left = {};
        var i, ch;
        for (i = 0; i < 5; i++) {
            if (g.charAt(i) === w.charAt(i)) res[i] = 'g';
            else { ch = w.charAt(i); left[ch] = (left[ch] || 0) + 1; }
        }
        for (i = 0; i < 5; i++) {
            if (res[i] === 'g') continue;
            ch = g.charAt(i);
            if (left[ch] > 0) { res[i] = 'y'; left[ch]--; }
        }
        return res.join('');
    }

    /** { ok, guesses } — for choice games `guesses` is 0. */
    function judge(game, question, a) {
        if (!question) return { ok: false, guesses: 0 };
        if (GAMES[game].type === 'wordle') {
            var list = parseGuesses(a);
            var ok = list.length > 0 && list[list.length - 1] === question.w;
            return { ok: ok, guesses: list.length };
        }
        return { ok: typeof a === 'number' && a === question.c, guesses: 0 };
    }

    // ---------- timeline ----------

    /** The first `max` players by (joinedAt, uid) are in the game; anyone after that is ignored. */
    function seatedPlayers(players, kind) {
        var max = MAX_PLAYERS[kind] || MAX_PLAYERS.room;
        return Object.keys(players || {}).filter(function (uid) {
            var p = players[uid];
            return p && typeof p === 'object' && typeof p.joinedAt === 'number';
        }).sort(function (a, b) {
            return (players[a].joinedAt - players[b].joinedAt) || (a < b ? -1 : a > b ? 1 : 0);
        }).slice(0, max);
    }

    /**
     * When round `r` (starting at `start`, at most until `nominal`) really ends.
     *
     * A round ends early once nobody is left to wait for: every seated player has either
     * answered or has deliberately left the game (`leftAt`, stamped by the server). The end is
     * then the moment that became true — the latest of those answers / departures. Because it
     * is computed only from write-once, server-stamped data, every client arrives at the same
     * value, and no player can end a round for the others. A player who merely loses their
     * connection is still waited for (until the timer), so a brief drop costs them nothing.
     */
    function roundEnd(room, uids, r, start, nominal) {
        var answers = (room.answers && room.answers[r]) || {};
        var end = start, anyAnswer = false;
        for (var i = 0; i < uids.length; i++) {
            var p = room.players[uids[i]], ans = answers[uids[i]];
            var inTime = !!ans && typeof ans.t === 'number' && ans.t >= start && ans.t < nominal;
            if (inTime) { anyAnswer = true; if (ans.t > end) end = ans.t; continue; }
            var left = typeof p.leftAt === 'number' && p.leftAt < nominal;
            if (!left) return nominal; // still waiting for this player
            if (p.leftAt > end) end = p.leftAt;
        }
        return anyAnswer ? end : nominal;
    }

    /**
     * The whole game schedule in server time, derived from the plan the host wrote, the
     * seated players and the answers this client can see.
     */
    function timeline(game, room) {
        var cfg = GAMES[game], plan = room.plan;
        var n = plan.rounds, D = plan.secs * 1000, reveal = cfg.reveal;
        var uids = seatedPlayers(room.players, (room.meta || {}).kind);
        var rounds = [], start = plan.startedAt + COUNTDOWN_MS;
        for (var r = 0; r < n; r++) {
            var nominal = start + D;
            var end = uids.length ? roundEnd(room, uids, r, start, nominal) : nominal;
            rounds.push({ start: start, end: end, nominalEnd: nominal });
            start = end + reveal;
        }
        return { rounds: rounds, startsAt: plan.startedAt + COUNTDOWN_MS, finishedAt: start, duration: D, reveal: reveal };
    }
    /** What is on screen at server time `now`. */
    function phaseAt(tl, now) {
        if (now < tl.startsAt) return { phase: 'countdown', round: 0, msLeft: tl.startsAt - now };
        for (var r = 0; r < tl.rounds.length; r++) {
            var rd = tl.rounds[r];
            if (now < rd.end) return { phase: 'question', round: r, msLeft: rd.end - now, elapsed: now - rd.start };
            if (now < rd.end + tl.reveal) return { phase: 'reveal', round: r, msLeft: rd.end + tl.reveal - now };
        }
        return { phase: 'done', round: tl.rounds.length - 1, msLeft: 0 };
    }

    // ---------- scoring ----------

    function pointsFor(game, plan, round, t, streakBefore, judged) {
        if (!judged.ok) return 0;
        var cfg = GAMES[game], D = plan.secs * 1000;
        var remaining = Math.max(0, D - (t - round.start));
        if (cfg.type === 'wordle') return 300 - 40 * (judged.guesses - 1) + floorDiv(100 * remaining, D);
        return cfg.base + floorDiv(cfg.speed * remaining, D) + 10 * Math.min(streakBefore, 5);
    }

    /**
     * Derives every player's result from the raw, server-stamped answers.
     * `upToRound` (inclusive) limits scoring to finished rounds for a live scoreboard.
     */
    function scoreRoom(game, bank, room, upToRound) {
        var plan = room.plan, meta = room.meta || {};
        var tl = timeline(game, room);
        var uids = seatedPlayers(room.players, meta.kind);
        var last = typeof upToRound === 'number' ? Math.min(upToRound, plan.rounds - 1) : plan.rounds - 1;
        var answers = room.answers || {};
        var byUid = {};
        uids.forEach(function (uid) {
            var score = 0, correct = 0, units = 0, streak = 0, best = 0, rounds = [], minGuesses = 0;
            for (var r = 0; r <= last; r++) {
                var rd = tl.rounds[r], q = questionById(bank, game, plan.q[r]);
                var ans = answers[r] && answers[r][uid];
                var valid = !!ans && typeof ans.t === 'number' && ans.t >= rd.start && ans.t <= rd.end;
                var judged = valid ? judge(game, q, ans.a) : { ok: false, guesses: 0 };
                var pts = valid ? pointsFor(game, plan, rd, ans.t, streak, judged) : 0;
                if (judged.ok) {
                    correct++; streak++;
                    units += GAMES[game].type === 'wordle' ? WORDLE_UNITS : 1;
                    if (judged.guesses && (minGuesses === 0 || judged.guesses < minGuesses)) minGuesses = judged.guesses;
                } else streak = 0;
                if (streak > best) best = streak;
                score += pts;
                rounds.push({ a: ans ? ans.a : null, answered: !!ans && ans.a !== -1 && ans.a !== '', ok: judged.ok, pts: pts, guesses: judged.guesses, ms: valid ? ans.t - rd.start : null });
            }
            byUid[uid] = { uid: uid, name: cleanName(room.players[uid].name), score: score, correct: correct, units: units, streak: streak, bestStreak: best, minGuesses: minGuesses, rounds: rounds };
        });
        var ranking = uids.slice().sort(function (a, b) {
            return (byUid[b].score - byUid[a].score) || (byUid[b].correct - byUid[a].correct) ||
                (room.players[a].joinedAt - room.players[b].joinedAt) || (a < b ? -1 : a > b ? 1 : 0);
        });
        var top = ranking.length ? byUid[ranking[0]].score : 0;
        ranking.forEach(function (uid, i) {
            byUid[uid].rank = i + 1;
            byUid[uid].win = uids.length >= 2 && top > 0 && byUid[uid].score === top;
        });
        var totalUnits = plan.rounds * (GAMES[game].type === 'wordle' ? WORDLE_UNITS : 1);
        return { byUid: byUid, ranking: ranking, players: uids.length, totalUnits: totalUnits, timeline: tl };
    }

    /** Daily Challenge score: correctness plus a bonus for total time, both server-verifiable. */
    function scoreDaily(bank, day, run) {
        var qs = dailyQuestions(bank, day), correct = 0, a = (run && run.a) || [];
        for (var i = 0; i < qs.length; i++) {
            var q = questionById(bank, qs[i].game, qs[i].id);
            if (q && typeof a[i] === 'number' && a[i] === q.c) correct++;
        }
        var finished = !!run && typeof run.s === 'number' && typeof run.e === 'number' && run.e >= run.s;
        var elapsed = finished ? run.e - run.s : DAILY_LIMIT_MS;
        var bonus = finished && correct > 0 ? floorDiv(200 * Math.max(0, DAILY_LIMIT_MS - elapsed), DAILY_LIMIT_MS) : 0;
        return { correct: correct, total: qs.length, score: finished ? correct * 100 + bonus : 0, elapsed: elapsed, finished: finished };
    }

    // ---------- XP, levels, badges ----------

    function xpFor(r) {
        var xp = 5 + 10 * (r.units || 0);
        if (r.totalUnits > 0 && r.units >= r.totalUnits) xp += 20;
        if (r.win) xp += 25;
        if (r.daily) xp += 20;
        return Math.max(0, Math.min(XP_GAME_CAP, xp));
    }

    function level(xp) { return Math.floor((1 + Math.sqrt(1 + 8 * Math.max(0, xp) / 100)) / 2); }
    /** XP needed to reach `lvl` (level 1 = 0). */
    function xpForLevel(lvl) { return 100 * lvl * (lvl - 1) / 2; }
    function levelTitle(lvl) {
        var title = LEVEL_TITLES[0][1];
        for (var i = 0; i < LEVEL_TITLES.length; i++) if (lvl >= LEVEL_TITLES[i][0]) title = LEVEL_TITLES[i][1];
        return title;
    }

    function emptyProfile(name) {
        return { name: cleanName(name), xp: 0, played: 0, wins: 0, dailies: 0, streak: 0, bestStreak: 0, lastDay: '', dayNum: 0, dayXp: 0, badges: {}, games: {} };
    }

    /**
     * Folds one finished game into a profile. `result`:
     *   { game, units, totalUnits, win, multiplayer, daily, day:'YYYY-MM-DD', minGuesses, score, name }
     * Returns { profile, gained, newBadges } and never mutates its input.
     */
    function applyResult(profile, result, nowMs) {
        var p = profile && typeof profile === 'object' ? profile : {};
        var out = {
            name: cleanName(result.name || p.name), xp: +p.xp || 0, played: +p.played || 0, wins: +p.wins || 0, dailies: +p.dailies || 0,
            streak: +p.streak || 0, bestStreak: +p.bestStreak || 0, lastDay: typeof p.lastDay === 'string' ? p.lastDay : '',
            dayNum: +p.dayNum || 0, dayXp: +p.dayXp || 0, badges: {}, games: {}
        };
        var k;
        for (k in (p.badges || {})) if (Object.prototype.hasOwnProperty.call(p.badges, k)) out.badges[k] = p.badges[k];
        for (k in (p.games || {})) if (Object.prototype.hasOwnProperty.call(p.games, k)) {
            var g0 = p.games[k] || {};
            out.games[k] = { played: +g0.played || 0, wins: +g0.wins || 0, best: +g0.best || 0 };
        }

        // XP, inside the UTC-day cap.
        var dayNum = Math.floor(nowMs / DAY_MS);
        var dayXp = out.dayNum === dayNum ? out.dayXp : 0;
        var gained = Math.max(0, Math.min(xpFor(result), XP_DAY_CAP - dayXp));
        out.xp += gained; out.dayNum = dayNum; out.dayXp = dayXp + gained;

        // Stats.
        out.played += 1;
        if (result.win && result.multiplayer) out.wins += 1;
        if (result.daily) out.dailies += 1;
        var key = result.daily ? 'daily' : result.game;
        var gs = out.games[key] || { played: 0, wins: 0, best: 0 };
        gs.played += 1;
        if (result.win && result.multiplayer) gs.wins += 1;
        if ((+result.score || 0) > gs.best) gs.best = +result.score || 0;
        out.games[key] = gs;

        // Day streak (the player's local calendar day).
        if (isDayString(result.day) && result.day !== out.lastDay) {
            out.streak = out.lastDay === previousDay(result.day) ? out.streak + 1 : 1;
            out.lastDay = result.day;
        } else if (out.streak < 1) out.streak = 1;
        if (out.streak > out.bestStreak) out.bestStreak = out.streak;

        // Badges.
        var newBadges = [];
        function grant(id, cond) { if (cond && !out.badges[id]) { out.badges[id] = nowMs; newBadges.push(id); } }
        grant('first_steps', out.played >= 1);
        grant('flawless', result.totalUnits >= 5 && result.units >= result.totalUnits);
        grant('word_hidden', result.game === 'wordle' && result.minGuesses > 0 && result.minGuesses <= 3);
        grant('faithful_3', out.streak >= 3);
        grant('faithful_7', out.streak >= 7);
        grant('daily_bread', out.dailies >= 1);
        grant('daily_7', out.dailies >= 7);
        grant('good_fight', out.wins >= 5);
        grant('conqueror', out.wins >= 25);
        grant('all_rounder', GAME_IDS.every(function (id) { return out.games[id] && out.games[id].played > 0; }));
        grant('berean', out.xp >= 1000);
        grant('scribe', out.xp >= 5000);

        return { profile: out, gained: gained, newBadges: newBadges };
    }

    return {
        COUNTDOWN_MS: COUNTDOWN_MS, REVEAL_MS: REVEAL_MS, DAY_MS: DAY_MS, XP_GAME_CAP: XP_GAME_CAP, XP_DAY_CAP: XP_DAY_CAP,
        MAX_PLAYERS: MAX_PLAYERS, GAMES: GAMES, GAME_IDS: GAME_IDS, BADGES: BADGES, LEVEL_TITLES: LEVEL_TITLES,
        WORDLE_MAX_GUESSES: WORDLE_MAX_GUESSES, WORDLE_UNITS: WORDLE_UNITS, DAILY_SLOTS: DAILY_SLOTS, DAILY_LIMIT_MS: DAILY_LIMIT_MS,
        hash: hash, previousDay: previousDay, isDayString: isDayString, makeCode: makeCode, parseCode: parseCode, cleanName: cleanName,
        questionById: questionById, pickQuestions: pickQuestions, dailyQuestions: dailyQuestions,
        parseGuesses: parseGuesses, wordleFeedback: wordleFeedback, judge: judge,
        timeline: timeline, phaseAt: phaseAt, pointsFor: pointsFor, seatedPlayers: seatedPlayers, scoreRoom: scoreRoom, scoreDaily: scoreDaily,
        xpFor: xpFor, level: level, xpForLevel: xpForLevel, levelTitle: levelTitle, emptyProfile: emptyProfile, applyResult: applyResult
    };
});
