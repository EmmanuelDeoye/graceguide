/* ============================================
   GraceGuide — js/games-ai.js
   Play & Learn: fresh, AI-written questions at the level the host chose
   (easy / medium / hard) — so games stop repeating the same set.

   Accuracy comes first. An AI can be wrong about Scripture, so nothing it
   writes reaches a player until it has passed ALL of these:

     1. Shape     — the engine's own cleanQuestion() (right fields, 4 distinct
                    options, a 5-letter word, …).
     2. Reference — must be one real verse ("John 3:16"): a real book, a
                    chapter that exists, a verse that exists.
     3. The text  — that verse is fetched from the Bible service (KJV) and
                    checked by code, not by the AI: a Wordle word must be in
                    the verse; an "in the Bible" quote must be that verse; a
                    "not in the Bible" saying must not be in it.
     4. Fact-check — a second, strict AI pass sees each question next to the
                    real verse text and must confirm the answer is certain and
                    the other options are wrong. Anything doubtful is dropped.
     5. The verse shown to players after the question is the real verse text,
        never the AI's paraphrase.

   Whatever fails is simply thrown away. If there are not enough verified
   questions (or the AI / Bible service is unavailable), the game uses the
   built-in question bank — which is never removed.

   Questions are prepared in the background and kept in a small pool on the
   device, so starting a game never waits on the AI.
   Load after games-core.js (uses fetchBibleChapter + the DeepSeek key from config.js).
   ============================================ */
(function () {
    'use strict';
    var Core = window.GamesCore;
    var LEVELS = {
        easy: { label: 'Easy', about: 'Well-known stories and people', prompt: 'EASY: only the most famous stories, people and verses that a new believer or a child in Sunday school would know.' },
        medium: { label: 'Medium', about: 'For regular Bible readers', prompt: 'MEDIUM: for someone who reads the Bible regularly — familiar books, but details that need real reading to know.' },
        hard: { label: 'Hard', about: 'Deep cuts for serious students', prompt: 'HARD: for serious Bible students — less familiar people, places, numbers and events, still stated plainly in the text.' }
    };
    var POOL_MAX = 30;
    var busy = {};

    function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full / private mode */ } }
    function load(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; } }
    function poolKey(game, level) { return 'gg_ai_pool_v1_' + game + '_' + level; }
    function getLevel() { var l = load('gg_games_level', 'medium'); return LEVELS[l] ? l : 'medium'; }
    function setLevel(l) { if (LEVELS[l]) store('gg_games_level', l); }

    /** What identifies a question, to avoid asking the same thing again. */
    function keyOf(game, q) { return (game === 'wordle' ? q.w : game === 'bibleornot' ? q.q : game === 'whoami' ? q.o[q.c] : (q.q || q.o[q.c])).toLowerCase().slice(0, 60); }

    // ---------- Scripture ----------

    var BOOK_ALIASES = { 'Psalm': 'Psalms', 'Song of Songs': 'Song of Solomon', 'Revelations': 'Revelation' };
    /** "1 Samuel 17:50" → { book, chapter, verse } for a verse that can exist, else null. */
    function parseRef(ref) {
        var m = /^((?:[1-3] )?[A-Za-z]+(?: [A-Za-z]+){0,2}) (\d{1,3}):(\d{1,3})$/.exec(String(ref || '').trim());
        if (!m || typeof BIBLE_BOOK_CHAPTERS === 'undefined') return null;
        var book = BIBLE_BOOK_CHAPTERS[m[1]] ? m[1] : BOOK_ALIASES[m[1]];
        var chapter = +m[2], verse = +m[3];
        if (!book || !BIBLE_BOOK_CHAPTERS[book] || chapter < 1 || chapter > BIBLE_BOOK_CHAPTERS[book] || verse < 1) return null;
        return { book: book, chapter: chapter, verse: verse };
    }
    /** The actual KJV text of one verse, or null if it does not exist / cannot be fetched. */
    async function verseText(ref) {
        var p = parseRef(ref);
        if (!p) return null;
        try {
            var verses = await fetchBibleChapter(p.book, p.chapter, 'KJV');
            var hit = (verses || []).filter(function (v) { return +v.verse === p.verse; })[0];
            return hit && hit.text ? String(hit.text).replace(/\s+/g, ' ').trim() : null;
        } catch (e) { return null; }
    }
    function words(s) { return String(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean); }
    /** How much of `quote` is found, in order, in `verse` (0–1). */
    function quoteMatch(quote, verse) {
        var q = words(quote), v = words(verse), i = 0, hit = 0;
        q.forEach(function (w) { var at = v.indexOf(w, i); if (at >= 0) { hit++; i = at + 1; } });
        return q.length ? hit / q.length : 0;
    }

    // ---------- the AI ----------

    async function ask(system, user, temperature) {
        if (typeof DEEPSEEK_API_KEY === 'undefined' || !DEEPSEEK_API_KEY) throw new Error('no-ai');
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 45000);
        try {
            var res = await fetch(DEEPSEEK_API_URL, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
                body: JSON.stringify({ model: 'deepseek-chat', temperature: temperature, max_tokens: 3500, response_format: { type: 'json_object' },
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
            });
            if (!res.ok) throw new Error('ai-' + res.status);
            var data = await res.json();
            return JSON.parse(data.choices[0].message.content);
        } finally { clearTimeout(timer); }
    }

    var SHAPES = {
        emoji: '{"e":"2 to 4 emojis that picture ONE Bible story","o":["4 short story names, only one fits"],"c":index of the right one (0-3),"ref":"Book C:V","x":"one sentence"}',
        whoami: '{"clues":["3 first-person clues, hardest first, easiest last, none naming the person"],"o":["4 Bible people"],"c":0-3,"ref":"Book C:V","x":"one sentence"}',
        bibleornot: '{"q":"a short saying","c":0 if it is a real Bible verse (quote the King James Version word for word, at most 18 words) or 1 if it is a popular saying that is NOT in the Bible,"ref":"Book C:V (the verse quoted; for a saying not in the Bible, a verse on the same subject)","x":"one sentence"}',
        battle: '{"cat":"Old Testament|Gospels|Acts & Letters|People|Places|Numbers","q":"a trivia question with ONE certain answer","o":["4 short options"],"c":0-3,"ref":"Book C:V","x":"one sentence"}',
        wordle: '{"w":"a FIVE-letter English word that appears in the King James Bible (A-Z only)","hint":"a short clue that does not contain the word","ref":"Book C:V (a KJV verse that contains that exact word)","x":"one sentence"}'
    };
    var RULES = 'You write Bible quiz content for a Christian app. Accuracy is everything.\n' +
        '- Use ONLY facts stated plainly in the Bible text itself. Nothing from tradition, commentary, church history or films.\n' +
        '- Avoid anything Christians disagree about (doctrine, dates, authorship, interpretation of prophecy) and anything where two accounts differ.\n' +
        '- Every item must have exactly ONE correct answer; the wrong options must be clearly wrong, not arguable.\n' +
        '- "ref" is ONE verse in the form "Book Chapter:Verse" (e.g. "1 Samuel 17:50") using standard English book names, and that verse must itself state the answer.\n' +
        '- If you are not completely certain of an item, leave it out.\n' +
        'Reply with JSON only: {"items":[ ... ]}.';

    async function writeCandidates(game, level, count, avoid) {
        var user = 'Game: ' + Core.GAMES[game].name + ' — ' + Core.GAMES[game].tagline + '.\nLevel: ' + LEVELS[level].prompt + '\n' +
            'Write ' + count + ' different items, spread across the whole Bible (Old and New Testament). Each item has this shape:\n' + SHAPES[game] + '\n' +
            (game === 'bibleornot' ? 'Make about half real verses (c=0) and half sayings that are not in the Bible (c=1).\n' : '') +
            (game !== 'wordle' && game !== 'bibleornot' ? 'Put the correct option at a random position.\n' : '') +
            (avoid.length ? 'Do NOT use any of these, they were used recently: ' + avoid.slice(-40).join('; ') + '\n' : '');
        var out = await ask(RULES, user, 0.9);
        return Array.isArray(out && out.items) ? out.items : [];
    }

    /** The strict second opinion: sees each question beside the real verse. Returns the ids it vouches for. */
    async function factCheck(game, items) {
        var system = 'You are a strict Bible fact-checker. You are given quiz items, each with the ACTUAL text of the verse it cites (King James Version).\n' +
            'Approve an item ONLY if ALL of these hold: (1) the marked answer is certainly correct according to the Bible text; (2) every other option is certainly wrong; ' +
            '(3) the cited verse itself supports the answer; (4) the wording contains no factual or scriptural error; (5) nothing in it is doctrinally disputed or ambiguous.\n' +
            'When in any doubt, do not approve. Reply with JSON only: {"approved":[ids]}.';
        var user = 'Game: ' + Core.GAMES[game].name + '\n' + items.map(function (it) {
            var q = it.q, body;
            if (game === 'wordle') body = 'Word: ' + q.w + ' | Hint: ' + q.hint;
            else if (game === 'bibleornot') body = 'Saying: "' + q.q + '" | Marked as: ' + (q.c === 0 ? 'IN the Bible (this verse)' : 'NOT in the Bible');
            else body = (game === 'emoji' ? 'Emojis: ' + q.e : game === 'whoami' ? 'Clues: ' + q.clues.join(' / ') : 'Question: ' + q.q) + ' | Options: ' + q.o.join(' ; ') + ' | Marked answer: ' + q.o[q.c];
            return 'id ' + it.id + ' — ' + body + ' | Cited: ' + q.ref + ' — "' + it.verse + '"';
        }).join('\n');
        var out = await ask(system, user, 0);
        return Array.isArray(out && out.approved) ? out.approved.map(Number) : [];
    }

    /** Writes, checks and returns verified questions for a game (possibly fewer than asked, possibly none). */
    async function generate(game, level, count, report) {
        report = report || function () {};
        var used = load('gg_ai_used_' + game, []);
        report('writing');
        var raw = await writeCandidates(game, level, count, used);
        var seen = {};
        var bankKeys = {};
        (window.GAMES_BANK[game] || []).forEach(function (q) { bankKeys[keyOf(game, q)] = true; });
        var candidates = [];
        for (var i = 0; i < raw.length; i++) {
            report('checking', i + 1, raw.length);
            var q = Core.cleanQuestion(game, raw[i], 'x' + i);                       // 1. shape
            if (!q) continue;
            var k = keyOf(game, q);
            if (seen[k] || bankKeys[k] || used.indexOf(k) >= 0) continue;            // no repeats
            var p = parseRef(q.ref);                                                 // 2. a real reference
            if (!p) continue;
            q.ref = p.book.replace(/^Psalms$/, 'Psalm') + ' ' + p.chapter + ':' + p.verse;
            var verse = await verseText(q.ref);                                      // 3. the real text
            if (!verse) continue;
            if (game === 'wordle' && words(verse).indexOf(q.w.toLowerCase()) < 0) continue;
            if (game === 'bibleornot') {
                var match = quoteMatch(q.q, verse);
                if (q.c === 0 && match < 0.85) continue;   // claimed to be this verse, but is not
                if (q.c === 1 && match > 0.6) continue;    // claimed not in the Bible, but it is
            }
            seen[k] = true;
            candidates.push({ id: i, q: q, verse: verse, key: k });
        }
        if (!candidates.length) return [];
        report('verifying', candidates.length);
        var approved = await factCheck(game, candidates);                            // 4. strict fact-check
        return candidates.filter(function (c) { return approved.indexOf(c.id) >= 0; }).map(function (c) {
            var shown = c.verse.length > 230 ? c.verse.slice(0, 227) + '…' : c.verse;  // 5. show the real verse
            c.q.x = game === 'bibleornot' && c.q.c === 1 ? 'Not a Bible verse. What Scripture does say: “' + shown + '”' : '“' + shown + '”';
            c.q.x = c.q.x.slice(0, 300);
            c.q.k = c.key;
            delete c.q.id;
            return c.q;
        });
    }

    // ---------- the pool ----------

    function count(game, level) { return load(poolKey(game, level), []).length; }
    function ready(game, level) { return count(game, level) >= Core.GAMES[game].rounds; }

    var MAX_ATTEMPTS = 3; // full write → check → verify rounds before a game gives up on fresh questions
    var progress = {};    // "game_level" → { stage, attempt, attempts, have, need, at, of }

    /** Can fresh questions be made at all right now? (No AI key, or no connection → no.) */
    function available() { return typeof DEEPSEEK_API_KEY !== 'undefined' && !!DEEPSEEK_API_KEY && navigator.onLine !== false; }
    function emit(game, level, info) {
        var key = game + '_' + level;
        if (info) progress[key] = info; else delete progress[key];
        document.dispatchEvent(new CustomEvent('gg-ai-progress', { detail: { game: game, level: level, info: info || null } }));
    }
    /** What Shepherd is doing for this game right now (null when idle). */
    function status(game, level) { return progress[game + '_' + level] || null; }

    /**
     * Makes sure a verified set of questions exists for this game and level, working in rounds
     * (write → look up every verse → fact-check) until there are enough, up to MAX_ATTEMPTS
     * rounds. Safe to call often (one run at a time per game+level). Resolves true when a full
     * set is ready, false only after every attempt has failed. Never rejects.
     */
    function refill(game, level) {
        var key = game + '_' + level, need = Core.GAMES[game].rounds;
        if (busy[key]) return busy[key];
        if (count(game, level) >= need * 2) return Promise.resolve(true);
        if (!available()) return Promise.resolve(ready(game, level));
        var wasReady = ready(game, level);
        busy[key] = (async function () {
            for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                var base = { attempt: attempt, attempts: MAX_ATTEMPTS, need: need, have: count(game, level) };
                try {
                    var fresh = await generate(game, level, Math.min(16, need + 6), function (stage, at, of) {
                        emit(game, level, Object.assign({ stage: stage, at: at || 0, of: of || 0 }, base));
                    });
                    var pool = load(poolKey(game, level), []), have = {};
                    pool.forEach(function (q) { have[q.k] = true; });
                    fresh.forEach(function (q) { if (!have[q.k]) pool.push(q); });
                    store(poolKey(game, level), pool.slice(-POOL_MAX));
                } catch (e) { /* a failed round: try again below */ }
                document.dispatchEvent(new CustomEvent('gg-ai-pool', { detail: { game: game, level: level } }));
                // One full set is the goal when a player is waiting; when topping up in the background, one round is enough.
                if (ready(game, level) || wasReady) break;
                if (attempt < MAX_ATTEMPTS) { emit(game, level, Object.assign({ stage: 'retrying' }, base, { have: count(game, level) })); await new Promise(function (r) { setTimeout(r, 1200); }); }
            }
            return ready(game, level);
        })().catch(function () { return false; }).then(function (ok) {
            delete busy[key];
            emit(game, level, null);
            document.dispatchEvent(new CustomEvent('gg-ai-pool', { detail: { game: game, level: level } }));
            return ok;
        });
        return busy[key];
    }
    /**
     * Takes one game's worth of verified questions out of the pool, or null if there are not
     * enough (the caller then uses the built-in bank). Returns { ids: [...], qs: { id: question } }.
     */
    function take(game, level) {
        var need = Core.GAMES[game].rounds, pool = load(poolKey(game, level), []);
        var good = pool.map(function (q, i) { return Core.cleanQuestion(game, q, 'a' + i) ? q : null; }).filter(Boolean);
        if (good.length < need) { store(poolKey(game, level), good); return null; }
        // Random picks, so two games from the same pool differ even before it is refilled.
        for (var i = good.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = good[i]; good[i] = good[j]; good[j] = t; }
        var picked = good.slice(0, need), rest = good.slice(need);
        store(poolKey(game, level), rest);
        var used = load('gg_ai_used_' + game, []);
        store('gg_ai_used_' + game, used.concat(picked.map(function (q) { return q.k; })).slice(-150));
        var ids = [], qs = {};
        picked.forEach(function (q, n) {
            var copy = {};
            Object.keys(q).forEach(function (f) { if (f !== 'k') copy[f] = q[f]; });
            ids.push('a' + n); qs['a' + n] = copy;
        });
        setTimeout(function () { refill(game, level); }, 1500); // get the next game's questions ready
        return { ids: ids, qs: qs };
    }

    window.GamesAI = { LEVELS: LEVELS, getLevel: getLevel, setLevel: setLevel, ready: ready, busy: function (g, l) { return !!busy[g + '_' + l]; },
        refill: refill, ensure: refill, available: available, status: status, take: take, _parseRef: parseRef, _quoteMatch: quoteMatch };
})();
