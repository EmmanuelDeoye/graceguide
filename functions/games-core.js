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
        { id: 'scribe', name: 'Ready Scribe', icon: 'fa-feather', desc: 'Earn 5,000 XP.', ref: 'Ezra 7:6' },
        // --- added in v1.3 (40 in all) ---
        { id: 'first_win', name: 'First Victory', icon: 'fa-flag', desc: 'Win your first multiplayer game.', ref: '1 Corinthians 15:57' },
        { id: 'wins_10', name: 'Valiant', icon: 'fa-medal', desc: 'Win ten multiplayer games.', ref: 'Psalm 60:12' },
        { id: 'wins_50', name: 'Mighty in Battle', icon: 'fa-trophy', desc: 'Win fifty multiplayer games.', ref: 'Psalm 24:8' },
        { id: 'wins_100', name: 'Champion of the Word', icon: 'fa-chess-king', desc: 'Win one hundred multiplayer games.', ref: '1 John 5:4' },
        { id: 'played_10', name: 'Getting Started', icon: 'fa-seedling', desc: 'Play ten games.', ref: 'Zechariah 4:10' },
        { id: 'played_50', name: 'Regular', icon: 'fa-leaf', desc: 'Play fifty games.', ref: 'Galatians 6:9' },
        { id: 'played_100', name: 'Centurion', icon: 'fa-tree', desc: 'Play one hundred games.', ref: 'Matthew 8:10' },
        { id: 'played_250', name: 'Tireless', icon: 'fa-mountain', desc: 'Play two hundred and fifty games.', ref: 'Isaiah 40:31' },
        { id: 'faithful_14', name: 'Two Weeks Strong', icon: 'fa-calendar-week', desc: 'Play fourteen days in a row.', ref: 'Daniel 6:10' },
        { id: 'faithful_30', name: 'A Month of Days', icon: 'fa-calendar-days', desc: 'Play thirty days in a row.', ref: 'Psalm 1:2' },
        { id: 'faithful_60', name: 'Steadfast', icon: 'fa-anchor', desc: 'Play sixty days in a row.', ref: '1 Corinthians 15:58' },
        { id: 'faithful_100', name: 'Unmovable', icon: 'fa-landmark', desc: 'Play one hundred days in a row.', ref: 'Hebrews 10:23' },
        { id: 'daily_3', name: 'Daily Portion', icon: 'fa-wheat-awn', desc: 'Complete three Daily Challenges.', ref: 'Proverbs 30:8' },
        { id: 'daily_30', name: 'Bread for a Month', icon: 'fa-calendar-plus', desc: 'Complete thirty Daily Challenges.', ref: 'John 6:35' },
        { id: 'daily_100', name: 'Hundredfold', icon: 'fa-sun', desc: 'Complete one hundred Daily Challenges.', ref: 'Matthew 13:8' },
        { id: 'daily_perfect', name: 'Perfect Portion', icon: 'fa-bullseye', desc: 'Get every Daily Challenge question right.', ref: 'Psalm 119:105' },
        { id: 'xp_500', name: 'Growing', icon: 'fa-arrow-trend-up', desc: 'Earn 500 XP.', ref: '2 Peter 3:18' },
        { id: 'xp_2500', name: 'Rooted', icon: 'fa-wand-magic-sparkles', desc: 'Earn 2,500 XP.', ref: 'Colossians 2:7' },
        { id: 'xp_10000', name: 'Treasure of Wisdom', icon: 'fa-coins', desc: 'Earn 10,000 XP.', ref: 'Proverbs 2:4' },
        { id: 'xp_25000', name: 'Teacher of the Word', icon: 'fa-graduation-cap', desc: 'Earn 25,000 XP.', ref: 'Matthew 13:52' },
        { id: 'flawless_5', name: 'Sharp Sword', icon: 'fa-bolt', desc: 'Finish five games without a wrong answer.', ref: 'Hebrews 4:12' },
        { id: 'flawless_25', name: 'Rightly Dividing', icon: 'fa-scale-balanced', desc: 'Finish twenty-five games without a wrong answer.', ref: '2 Timothy 2:15' },
        { id: 'word_quick', name: 'Quick Understanding', icon: 'fa-lightbulb', desc: 'Solve a Bible Wordle in two guesses or fewer.', ref: 'Isaiah 11:3' },
        { id: 'emoji_10', name: 'Story Teller', icon: 'fa-face-smile', desc: 'Play Bible Emoji ten times.', ref: 'Psalm 78:4' },
        { id: 'wordle_10', name: 'Word Smith', icon: 'fa-table-cells', desc: 'Play Bible Wordle ten times.', ref: 'Proverbs 25:11' },
        { id: 'whoami_10', name: 'Cloud of Witnesses', icon: 'fa-user-secret', desc: 'Play Who Am I? ten times.', ref: 'Hebrews 12:1' },
        { id: 'bibleornot_10', name: 'Discerner', icon: 'fa-magnifying-glass', desc: 'Play Bible or Not? ten times.', ref: '1 John 4:1' },
        { id: 'battle_10', name: 'Soldier of Christ', icon: 'fa-shield', desc: 'Play Bible Battle ten times.', ref: '2 Timothy 2:3' }
    ];

    /**
     * Bonus XP a player may claim once for each badge. Earlier / easier badges give a little,
     * rare ones more (never above BADGE_XP_MAX, which the database rules also enforce).
     */
    var BADGE_XP = {
        first_steps: 25, flawless: 50, word_hidden: 50, faithful_3: 30, faithful_7: 60, daily_bread: 25, daily_7: 60, good_fight: 60,
        conqueror: 120, all_rounder: 50, berean: 75, scribe: 120, first_win: 30, wins_10: 80, wins_50: 130, wins_100: 150,
        played_10: 30, played_50: 75, played_100: 110, played_250: 150, faithful_14: 90, faithful_30: 130, faithful_60: 150, faithful_100: 150,
        daily_3: 30, daily_30: 110, daily_100: 150, daily_perfect: 60, xp_500: 40, xp_2500: 90, xp_10000: 140, xp_25000: 150,
        flawless_5: 80, flawless_25: 140, word_quick: 80, emoji_10: 40, wordle_10: 40, whoami_10: 40, bibleornot_10: 40, battle_10: 40
    };
    var BADGE_XP_MAX = 150;
    BADGES.forEach(function (b) { b.xp = BADGE_XP[b.id] || 25; });

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

    /**
     * The question with this id. Looked up through an index built once per game list (and
     * rebuilt if the list has grown), so it stays instant with a thousand questions a game.
     */
    function questionById(bank, game, id) {
        var list = (bank && bank[game]) || [];
        var index = list.__byId;
        if (!index || index.size !== list.length) {
            index = { size: list.length, map: {} };
            for (var i = 0; i < list.length; i++) if (list[i] && !index.map[list[i].id]) index.map[list[i].id] = list[i];
            try { Object.defineProperty(list, '__byId', { value: index, writable: true, configurable: true, enumerable: false }); } catch (e) { /* a frozen list: just not remembered */ }
        }
        return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(index.map, id)) ? index.map[id] : null;
    }

    // ---------- difficulty ----------
    // A bank question may carry `l`: 1 easy, 2 medium, 3 hard (no `l` = medium).
    var LEVELS = ['easy', 'medium', 'hard'];
    function levelOf(question) {
        var l = question ? question.l : 0;
        return l === 1 ? 'easy' : l === 3 ? 'hard' : 'medium';
    }
    function isLevel(level) { return level === 'easy' || level === 'medium' || level === 'hard'; }

    // ---------- custom (AI-written) questions ----------
    // A game may carry its own questions in plan.qs = { id: question } (written once by the host
    // with the plan). They are untrusted input from another player's device, so every client —
    // and the referee — passes them through cleanQuestion() and uses only the cleaned result.

    function text(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
    function list(v) {
        if (Array.isArray(v)) return v;
        if (!v || typeof v !== 'object') return [];
        var out = [];
        for (var i = 0; i < 8 && Object.prototype.hasOwnProperty.call(v, String(i)); i++) out.push(v[String(i)]);
        return out;
    }
    /** A well-formed question for `game` built from `raw`, or null. Never trusts `raw`. */
    function cleanQuestion(game, raw, id) {
        if (!raw || typeof raw !== 'object' || !GAMES[game]) return null;
        var q = { id: String(id), ref: text(raw.ref, 40), x: text(raw.x, 300) };
        if (!q.ref || !q.x) return null;
        if (GAMES[game].type === 'wordle') {
            var w = text(raw.w, 6).toUpperCase(); // 6: a longer word must fail, not be cut down to five letters
            if (!/^[A-Z]{5}$/.test(w)) return null;
            q.w = w; q.hint = text(raw.hint, 80);
            return q.hint ? q : null;
        }
        var c = raw.c;
        if (typeof c !== 'number' || c % 1 !== 0) return null;
        if (game === 'bibleornot') {
            q.q = text(raw.q, 220);
            if (!q.q || c < 0 || c > 1) return null;
            q.c = c;
            return q;
        }
        var o = list(raw.o).map(function (s) { return text(s, 80); });
        if (o.length !== 4 || c < 0 || c > 3) return null;
        for (var i = 0; i < 4; i++) { if (!o[i]) return null; for (var j = 0; j < i; j++) if (o[j] === o[i]) return null; }
        q.o = o; q.c = c;
        if (game === 'emoji') { q.e = text(raw.e, 40); if (!q.e) return null; }
        else if (game === 'whoami') {
            var clues = list(raw.clues).map(function (s) { return text(s, 160); });
            if (clues.length !== 3 || !clues[0] || !clues[1] || !clues[2]) return null;
            q.clues = clues;
        } else {
            q.q = text(raw.q, 220);
            if (!q.q) return null;
            var cat = text(raw.cat, 30);
            if (cat) q.cat = cat;
        }
        return q;
    }
    /** The question for round `r` of a game: the plan's own question if it carries one, else the bank's. */
    function roomQuestion(bank, game, plan, r) {
        var id = plan && plan.q ? plan.q[r] : null;
        var custom = plan && plan.qs && typeof plan.qs === 'object' ? plan.qs[id] : null;
        return custom ? cleanQuestion(game, custom, id) : questionById(bank, game, id);
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

    /**
     * Deals `n` question ids for a game — fairly, for everyone who is about to play it.
     *   opts.level   'easy' | 'medium' | 'hard' (anything else: every level)
     *   opts.seen    one { id: timesSeen } map per player in the game (their question history)
     *   opts.avoid   ids that must not come up again if it can be helped (the game just played)
     *   opts.random  () => [0, 1)
     * In order of importance: not in `avoid`; of the chosen level; seen by nobody; and once
     * fresh questions have run out, the ones seen least (all players' counts added together).
     * Whatever is still equal is decided at random. If the chosen level has too few questions
     * the rest come from the other levels, by the same rules.
     */
    function dealQuestions(bank, game, n, opts) {
        var o = opts || {}, rnd = o.random || Math.random, list = (bank && bank[game]) || [];
        var seen = o.seen || [], want = isLevel(o.level) ? o.level : null, avoid = {}, i;
        (o.avoid || []).forEach(function (id) { avoid[id] = true; });
        var rows = [];
        for (i = 0; i < list.length; i++) {
            var q = list[i], times = 0;
            for (var s = 0; s < seen.length; s++) {
                var c = seen[s] ? seen[s][q.id] : 0;
                if (typeof c === 'number' && c > 0) times += c;
            }
            rows.push({ id: q.id, avoid: avoid[q.id] ? 1 : 0, off: want && levelOf(q) !== want ? 1 : 0, times: times, order: 0 });
        }
        for (i = rows.length - 1; i > 0; i--) {
            var j = Math.floor(rnd() * (i + 1));
            var t = rows[i]; rows[i] = rows[j]; rows[j] = t;
        }
        for (i = 0; i < rows.length; i++) rows[i].order = i;
        rows.sort(function (a, b) { return (a.avoid - b.avoid) || (a.off - b.off) || (a.times - b.times) || (a.order - b.order); });
        return rows.slice(0, n).map(function (r) { return r.id; });
    }

    /** The Daily Challenge: the same five questions for everyone on a given day. */
    var DAILY_SLOTS = ['emoji', 'whoami', 'bibleornot', 'battle', 'battle'];
    var DAILY_LIMIT_MS = 100000;
    /**
     * The Daily Challenge draws from a FROZEN part of the bank: the first `size` questions of
     * each game. Adding questions to the bank therefore never changes a day's five questions
     * (on any device, or for the server that scores them). To let newer questions into the
     * Daily Challenge, add an entry with a start day in the future — never edit an old one.
     */
    var DAILY_POOLS = [
        { from: '', size: { emoji: 86, whoami: 81, bibleornot: 101, battle: 174 } }
    ];
    function dailyPool(day) {
        var pool = DAILY_POOLS[0];
        for (var i = 1; i < DAILY_POOLS.length; i++) if (String(day) >= DAILY_POOLS[i].from) pool = DAILY_POOLS[i];
        return pool.size;
    }
    function dailyQuestions(bank, day) {
        var out = [], used = {}, sizes = dailyPool(day);
        for (var s = 0; s < DAILY_SLOTS.length; s++) {
            var game = DAILY_SLOTS[s], all = bank[game] || [];
            var list = sizes[game] && all.length > sizes[game] ? all.slice(0, sizes[game]) : all;
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
        var P = pausesOf(room), pi = 0;
        var rounds = [], start = plan.startedAt + COUNTDOWN_MS;
        for (var r = 0; r < n; r++) {
            var nominal = start + D, held = [];
            // A pause freezes the question it was called in: the round's clock stops for
            // everyone and the time is added back. (One called outside a question does nothing.)
            while (pi < P.length && P[pi].s < start) pi++;
            while (pi < P.length && P[pi].s < nominal) { held.push(P[pi]); nominal += P[pi].e - P[pi].s; pi++; }
            var end = uids.length ? roundEnd(room, uids, r, start, nominal) : nominal;
            held = held.filter(function (p) { return p.s < end; }); // called after everyone had answered: too late to matter
            rounds.push({ start: start, end: end, nominalEnd: nominal, pauses: held });
            start = end + reveal;
        }
        return { rounds: rounds, startsAt: plan.startedAt + COUNTDOWN_MS, finishedAt: start, duration: D, reveal: reveal };
    }

    // ---------- pauses ----------
    // Any player may pause a game; it is then paused for everyone. A pause is a server-stamped
    // record { s, by } that gets its end stamp `e` when someone resumes — and ends by itself
    // after PAUSE_MAX_MS, so a game can never be left frozen. Every client derives the same
    // schedule from these records, exactly as it does from the answers.
    var PAUSE_MAX_MS = 60000, MAX_PAUSES = 6;
    /** The room's pauses in order: [{ s, e, by, open, index }] — `e` is when it ends (or will end by itself). */
    function pausesOf(room) {
        var raw = room && room.pauses, out = [], last = -Infinity;
        if (!raw || typeof raw !== 'object') return out;
        for (var i = 0; i < MAX_PAUSES; i++) {
            var p = raw[i] !== undefined ? raw[i] : raw[String(i)];
            if (!p || typeof p !== 'object' || typeof p.s !== 'number' || p.s < last) break;
            var cap = p.s + PAUSE_MAX_MS;
            var open = !(typeof p.e === 'number' && p.e >= p.s);
            var e = open ? cap : Math.min(p.e, cap);
            out.push({ s: p.s, e: e, by: typeof p.by === 'string' ? p.by : '', open: open, index: i });
            last = e;
        }
        return out;
    }
    /** Playing time used in a round by server time `t` (time spent paused does not count). */
    function activeMs(round, t) {
        var ms = t - round.start, held = round.pauses || [];
        for (var i = 0; i < held.length; i++) {
            var from = Math.max(held[i].s, round.start), to = Math.min(held[i].e, t);
            if (to > from) ms -= to - from;
        }
        return ms;
    }
    /** What is on screen at server time `now`. */
    function phaseAt(tl, now) {
        if (now < tl.startsAt) return { phase: 'countdown', round: 0, msLeft: tl.startsAt - now };
        for (var r = 0; r < tl.rounds.length; r++) {
            var rd = tl.rounds[r];
            if (now < rd.end) {
                var held = rd.pauses || [];
                for (var i = 0; i < held.length; i++) {
                    // Frozen: `msLeft` counts down to when it resumes by itself, `roundLeft` is the question time still to come.
                    if (now >= held[i].s && now < held[i].e) return { phase: 'paused', round: r, msLeft: held[i].e - now, roundLeft: Math.max(0, rd.end - held[i].e), elapsed: activeMs(rd, held[i].s), by: held[i].by, pauseIndex: held[i].index };
                }
                return { phase: 'question', round: r, msLeft: rd.end - now, elapsed: activeMs(rd, now) };
            }
            if (now < rd.end + tl.reveal) return { phase: 'reveal', round: r, msLeft: rd.end + tl.reveal - now };
        }
        return { phase: 'done', round: tl.rounds.length - 1, msLeft: 0 };
    }

    // ---------- scoring ----------

    function pointsFor(game, plan, round, t, streakBefore, judged) {
        if (!judged.ok) return 0;
        var cfg = GAMES[game], D = plan.secs * 1000;
        var remaining = Math.max(0, D - activeMs(round, t));
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
                var rd = tl.rounds[r], q = roomQuestion(bank, game, plan, r);
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
                rounds.push({ a: ans ? ans.a : null, answered: !!ans && ans.a !== -1 && ans.a !== '', ok: judged.ok, pts: pts, guesses: judged.guesses, ms: valid ? activeMs(rd, ans.t) : null });
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

    /**
     * XP needed to reach `lvl` (level 1 = 0). The steps grow with the level — quick at the
     * start, slower the higher you climb: level 2 at 100 XP, 3 at 400, 5 at 2,000, 10 at 16,500,
     * 20 at 133,000. (Whole numbers always: (l-1)·l·(l+1) is divisible by 6.)
     */
    function xpForLevel(lvl) { return 50 * (lvl - 1) * lvl * (lvl + 1) / 3; }
    function level(xp) {
        var x = Math.max(0, xp || 0), lvl = 1;
        while (lvl < 999 && xpForLevel(lvl + 1) <= x) lvl++;
        return lvl;
    }
    function levelTitle(lvl) {
        var title = LEVEL_TITLES[0][1];
        for (var i = 0; i < LEVEL_TITLES.length; i++) if (lvl >= LEVEL_TITLES[i][0]) title = LEVEL_TITLES[i][1];
        return title;
    }

    function emptyProfile(name) {
        return { name: cleanName(name), xp: 0, played: 0, wins: 0, dailies: 0, streak: 0, bestStreak: 0, lastDay: '', dayNum: 0, dayXp: 0, perfect: 0, claims: 0, badges: {}, claimed: {}, games: {} };
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
            dayNum: +p.dayNum || 0, dayXp: +p.dayXp || 0, perfect: +p.perfect || 0, claims: +p.claims || 0, badges: {}, claimed: {}, games: {}
        };
        var k;
        for (k in (p.badges || {})) if (Object.prototype.hasOwnProperty.call(p.badges, k)) out.badges[k] = p.badges[k];
        for (k in (p.claimed || {})) if (Object.prototype.hasOwnProperty.call(p.claimed, k)) out.claimed[k] = p.claimed[k];
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
        var allRight = result.totalUnits > 0 && result.units >= result.totalUnits;
        if (allRight && !result.daily && result.totalUnits >= 5) out.perfect += 1;
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
        grant('first_win', out.wins >= 1);
        grant('wins_10', out.wins >= 10);
        grant('wins_50', out.wins >= 50);
        grant('wins_100', out.wins >= 100);
        grant('played_10', out.played >= 10);
        grant('played_50', out.played >= 50);
        grant('played_100', out.played >= 100);
        grant('played_250', out.played >= 250);
        grant('faithful_14', out.streak >= 14);
        grant('faithful_30', out.streak >= 30);
        grant('faithful_60', out.streak >= 60);
        grant('faithful_100', out.streak >= 100);
        grant('daily_3', out.dailies >= 3);
        grant('daily_30', out.dailies >= 30);
        grant('daily_100', out.dailies >= 100);
        grant('daily_perfect', !!result.daily && allRight);
        grant('xp_500', out.xp >= 500);
        grant('xp_2500', out.xp >= 2500);
        grant('xp_10000', out.xp >= 10000);
        grant('xp_25000', out.xp >= 25000);
        grant('flawless_5', out.perfect >= 5);
        grant('flawless_25', out.perfect >= 25);
        grant('word_quick', result.game === 'wordle' && !result.daily && result.minGuesses > 0 && result.minGuesses <= 2);
        GAME_IDS.forEach(function (id) { grant(id + '_10', !!out.games[id] && out.games[id].played >= 10); });

        return { profile: out, gained: gained, newBadges: newBadges };
    }

    function badgeById(id) { for (var i = 0; i < BADGES.length; i++) if (BADGES[i].id === id) return BADGES[i]; return null; }
    /** Badges the player has earned but not yet claimed the bonus XP for (in the order they are listed). */
    function claimable(profile) {
        var p = profile || {}, badges = p.badges || {}, claimed = p.claimed || {};
        return BADGES.filter(function (b) { return badges[b.id] && !claimed[b.id]; }).map(function (b) { return b.id; });
    }
    /**
     * Claims one earned badge's bonus XP. Returns { profile, gained } — or null if the badge is
     * unknown, not earned, or already claimed. Badge XP is a gift: it does not count toward the
     * per-day game XP limit. Never mutates its input.
     */
    function claimBadge(profile, badgeId, nowMs) {
        var b = badgeById(badgeId), p = profile && typeof profile === 'object' ? profile : null;
        if (!b || !p || !(p.badges || {})[badgeId] || (p.claimed || {})[badgeId]) return null;
        var out = {}, k;
        for (k in p) if (Object.prototype.hasOwnProperty.call(p, k) && k !== 'updatedAt') out[k] = p[k];
        out.claimed = {};
        for (k in (p.claimed || {})) if (Object.prototype.hasOwnProperty.call(p.claimed, k)) out.claimed[k] = p.claimed[k];
        out.claimed[badgeId] = nowMs;
        var gained = Math.min(BADGE_XP_MAX, b.xp);
        out.xp = (+p.xp || 0) + gained;
        out.claims = (+p.claims || 0) + 1;
        return { profile: out, gained: gained };
    }

    return {
        COUNTDOWN_MS: COUNTDOWN_MS, REVEAL_MS: REVEAL_MS, DAY_MS: DAY_MS, XP_GAME_CAP: XP_GAME_CAP, XP_DAY_CAP: XP_DAY_CAP,
        MAX_PLAYERS: MAX_PLAYERS, GAMES: GAMES, GAME_IDS: GAME_IDS, BADGES: BADGES, LEVEL_TITLES: LEVEL_TITLES,
        WORDLE_MAX_GUESSES: WORDLE_MAX_GUESSES, WORDLE_UNITS: WORDLE_UNITS, DAILY_SLOTS: DAILY_SLOTS, DAILY_LIMIT_MS: DAILY_LIMIT_MS,
        hash: hash, previousDay: previousDay, isDayString: isDayString, makeCode: makeCode, parseCode: parseCode, cleanName: cleanName,
        questionById: questionById, cleanQuestion: cleanQuestion, roomQuestion: roomQuestion, pickQuestions: pickQuestions, dailyQuestions: dailyQuestions,
        LEVELS: LEVELS, levelOf: levelOf, isLevel: isLevel, dealQuestions: dealQuestions, DAILY_POOLS: DAILY_POOLS,
        parseGuesses: parseGuesses, wordleFeedback: wordleFeedback, judge: judge,
        timeline: timeline, phaseAt: phaseAt, pointsFor: pointsFor, seatedPlayers: seatedPlayers, scoreRoom: scoreRoom, scoreDaily: scoreDaily,
        xpFor: xpFor, level: level, xpForLevel: xpForLevel, levelTitle: levelTitle, emptyProfile: emptyProfile, applyResult: applyResult,
        BADGE_XP_MAX: BADGE_XP_MAX, badgeById: badgeById, claimable: claimable, claimBadge: claimBadge,
        PAUSE_MAX_MS: PAUSE_MAX_MS, MAX_PAUSES: MAX_PAUSES, pausesOf: pausesOf, activeMs: activeMs
    };
});
