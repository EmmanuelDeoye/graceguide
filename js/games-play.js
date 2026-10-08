/* ============================================
   GraceGuide — js/games-play.js
   Play & Learn: the in-game screen.

   One stage for all five games (countdown → question → reveal), driven
   by a "session" — either a live multiplayer room (GamesNet RoomSession)
   or a LocalSession for solo play. Both expose the same small interface:
     session.game, session.uid, session.room
     session.onUpdate = fn(view)      view = { phase, round, msLeft, timeline, … }
     session.submit(answer), session.progress(n), session.myAnswer(round)
     session.results(upToRound), session.close()
   so each game is written once and works in solo, 1v1 and rooms.

   Load after games-core.js / games-bank.js (uses escapeHtml from core.js).
   ============================================ */
(function () {
    'use strict';
    var Core = window.GamesCore, BANK = window.GAMES_BANK;

    // ---------- solo play: the same engine, on a local clock ----------

    /**
     * A one-player "room" that lives in memory. Because it reuses the multiplayer
     * timeline and scoring, solo scores mean exactly what online scores mean.
     */
    function LocalSession(game, uid, name, questionIds, custom) {
        var cfg = Core.GAMES[game];
        this.game = game;
        this.uid = uid;
        this.solo = true;
        this._offset = 0;
        this._mine = {};
        this.room = {
            meta: { game: game, kind: 'room' },
            // Solo skips most of the "get ready" countdown.
            plan: { startedAt: Date.now() - Core.COUNTDOWN_MS + 1200, q: questionIds, secs: cfg.secs, rounds: questionIds.length },
            players: {}, answers: {}, answered: {}
        };
        if (custom) this.room.plan.qs = custom; // AI-written questions (js/games-ai.js)
        this.room.players[uid] = { name: name, joinedAt: 1, online: true };
        this.onUpdate = null;
    }
    LocalSession.prototype.now = function () { return Date.now() + this._offset; };
    LocalSession.prototype.open = function () {
        var self = this;
        this._timer = setInterval(function () { self._tick(); }, 200);
        this._tick();
        return this;
    };
    LocalSession.prototype.close = function () { clearInterval(this._timer); this._closed = true; };
    LocalSession.prototype.seated = function () { return [this.uid]; };
    LocalSession.prototype.myAnswer = function (r) { return this._mine[r]; };
    LocalSession.prototype.progress = function () {};
    LocalSession.prototype.resultsReady = function () { return true; };
    LocalSession.prototype.results = function (upTo) { return Core.scoreRoom(this.game, BANK, this.room, upTo); };
    LocalSession.prototype._put = function (r, a) {
        this._mine[r] = a;
        this.room.answers[r] = {};
        this.room.answers[r][this.uid] = { a: a, t: this.now() };
    };
    LocalSession.prototype.submit = function (answer) {
        var v = this._view;
        if (!v || v.phase !== 'question' || this._mine[v.round] !== undefined) return Promise.resolve(false);
        this._put(v.round, answer);
        this._tick();
        return Promise.resolve(true);
    };
    /** Solo only: jump past the reveal screen ("Next"). */
    LocalSession.prototype.skipReveal = function () {
        var v = this._view;
        if (v && v.phase === 'reveal') { this._offset += v.msLeft; this._tick(); }
    };
    LocalSession.prototype._tick = function () {
        if (this._closed) return;
        var tl = Core.timeline(this.game, this.room), view = Core.phaseAt(tl, this.now());
        // Timed out without answering: record a pass so the round has a result.
        if ((view.phase === 'reveal' || view.phase === 'done') && this._mine[view.round] === undefined) {
            this._mine[view.round] = Core.GAMES[this.game].type === 'wordle' ? '' : -1;
            this.room.answers[view.round] = {};
            this.room.answers[view.round][this.uid] = { a: this._mine[view.round], t: tl.rounds[view.round].nominalEnd + 1 };
        }
        view.timeline = tl; view.room = this.room; view.game = this.game; view.seated = [this.uid]; view.syncing = false; view.solo = true;
        this._view = view;
        if (this.onUpdate) this.onUpdate(view);
    };

    // ---------- shared stage ----------

    var esc = function (s) { return window.escapeHtml(String(s == null ? '' : s)); };
    function question(view) { return Core.roomQuestion(BANK, view.game, view.room.plan, view.round); }
    function refChip(ref) {
        return '<span class="pl-ref"><i class="fas fa-book-bible"></i> ' + esc(ref) + '</span>';
    }

    /**
     * Mounts the play stage into `container`. opts:
     *   names(uid) -> display name, onNext() (solo "Next" on the reveal screen)
     * Returns { update(view), destroy() }.
     */
    function mount(container, session, opts) {
        var key = null, wordle = null, destroyed = false, lastScores = null;
        opts = opts || {};
        var me = session.uid, cfg = Core.GAMES[session.game];

        function nameOf(uid) { return uid === me ? 'You' : (opts.names ? opts.names(uid) : 'Player'); }

        function scoreboardHtml(view, upTo) {
            if (view.seated.length < 2) return '';
            var res = upTo >= 0 ? session.results(upTo) : null;
            lastScores = res || lastScores;
            var answered = (view.room.answered && view.room.answered[view.round]) || {};
            var order = res ? res.ranking : view.seated;
            return '<div class="pl-scores">' + order.map(function (uid, i) {
                var s = res ? res.byUid[uid].score : 0;
                var p = view.room.players[uid] || {};
                var state = typeof p.leftAt === 'number' ? ' pl-score-left' : (p.online === false ? ' pl-score-away' : '');
                var tick = view.phase === 'question' && answered[uid] != null
                    ? (cfg.type === 'wordle' ? '<span class="pl-score-tick">' + answered[uid] + '/6</span>' : '<i class="fas fa-check pl-score-tick"></i>') : '';
                return '<div class="pl-score' + (uid === me ? ' pl-score-me' : '') + state + '">' +
                    '<span class="pl-score-rank">' + (res ? i + 1 : '•') + '</span>' +
                    '<span class="pl-score-name">' + esc(nameOf(uid)) + '</span>' + tick +
                    '<span class="pl-score-pts">' + s + '</span></div>';
            }).join('') + '</div>';
        }

        /** 1v1 Bible Battle: a tug-of-war bar that follows the two scores. */
        function duelBarHtml(view, upTo) {
            if (session.game !== 'battle' || view.seated.length !== 2 || upTo < 0) return '';
            var res = session.results(upTo), other = view.seated[0] === me ? view.seated[1] : view.seated[0];
            var mine = res.byUid[me] ? res.byUid[me].score : 0, theirs = res.byUid[other].score, total = mine + theirs;
            var pct = total ? Math.round(100 * mine / total) : 50;
            return '<div class="pl-duel"><span>You</span><div class="pl-duel-bar"><div class="pl-duel-fill" style="width:' + pct + '%"></div></div><span>' + esc(nameOf(other)) + '</span></div>';
        }

        function headerHtml(view) {
            var total = view.room.plan.rounds;
            return '<div class="pl-head">' +
                '<span class="pl-head-game"><i class="fas ' + cfg.icon + '"></i> ' + esc(cfg.name) + '</span>' +
                '<span class="pl-head-round">' + esc(opts.roundLabel || ((view.round + 1) + ' / ' + total)) + '</span></div>' +
                '<div class="pl-timer"><div class="pl-timer-fill" id="pl-timer-fill"></div></div>';
        }

        function optionsHtml(q, view, revealed) {
            var mine = session.myAnswer(view.round);
            var labels = session.game === 'bibleornot' ? ['In the Bible', 'Not in the Bible'] : q.o;
            var icons = session.game === 'bibleornot' ? ['fa-book-bible', 'fa-ban'] : null;
            return '<div class="pl-options' + (session.game === 'bibleornot' ? ' pl-options-two' : '') + '">' + labels.map(function (label, i) {
                var cls = 'pl-option';
                if (revealed) {
                    if (i === q.c) cls += ' pl-option-right';
                    else if (i === mine) cls += ' pl-option-wrong';
                    else cls += ' pl-option-dim';
                } else if (mine !== undefined) cls += i === mine ? ' pl-option-picked' : ' pl-option-dim';
                var locked = revealed || mine !== undefined;
                return '<button class="' + cls + '" ' + (locked ? 'disabled' : 'data-pick="' + i + '"') + '>' +
                    (icons ? '<i class="fas ' + icons[i] + '"></i> ' : '<span class="pl-option-key">' + 'ABCD'.charAt(i) + '</span>') +
                    '<span class="pl-option-text">' + esc(label) + '</span>' +
                    (revealed && i === q.c ? '<i class="fas fa-check pl-option-mark"></i>' : '') +
                    (revealed && i === mine && i !== q.c ? '<i class="fas fa-xmark pl-option-mark"></i>' : '') + '</button>';
            }).join('') + '</div>';
        }

        function promptHtml(q, view, revealed) {
            switch (session.game) {
                case 'emoji':
                    return '<div class="pl-emoji">' + esc(q.e) + '</div><p class="pl-prompt">Which Bible story is this?</p>';
                case 'whoami':
                    return '<p class="pl-prompt">Who am I?</p><ol class="pl-clues" id="pl-clues">' + q.clues.map(function (c, i) {
                        return '<li class="pl-clue' + (revealed ? '' : ' pl-clue-hidden') + '" data-clue="' + i + '"><span class="pl-clue-text">' + esc(c) + '</span><span class="pl-clue-lock"><i class="fas fa-lock"></i> Clue ' + (i + 1) + '</span></li>';
                    }).join('') + '</ol>';
                case 'bibleornot':
                    return '<p class="pl-prompt">Is this in the Bible?</p><blockquote class="pl-quote">“' + esc(q.q) + '”</blockquote>';
                default:
                    return (q.cat ? '<span class="pl-cat">' + esc(q.cat) + '</span>' : '') + '<h3 class="pl-question">' + esc(q.q) + '</h3>';
            }
        }

        /** What the reveal screen teaches: the answer's Scripture, always. */
        function learnHtml(q, view) {
            var res = session.results(view.round), mine = res.byUid[me];
            var round = mine ? mine.rounds[view.round] : null;
            var verdict;
            if (!round) verdict = '';
            else if (round.ok) verdict = '<div class="pl-verdict pl-verdict-right"><i class="fas fa-circle-check"></i> Correct <strong>+' + round.pts + '</strong></div>';
            else if (!round.answered) verdict = '<div class="pl-verdict pl-verdict-miss"><i class="fas fa-hourglass-end"></i> Time’s up</div>';
            else verdict = '<div class="pl-verdict pl-verdict-wrong"><i class="fas fa-circle-xmark"></i> Not quite</div>';
            var answer = session.game === 'wordle' ? '<p class="pl-learn-answer">The word was <strong>' + esc(q.w) + '</strong></p>' : '';
            return verdict + '<div class="pl-learn">' + answer + '<p class="pl-learn-text">' + esc(q.x) + '</p>' + refChip(q.ref) + '</div>';
        }

        // ----- Wordle -----
        var KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];
        function wordleState(view) {
            if (!wordle || wordle.round !== view.round) {
                var saved = session.myAnswer(view.round);
                wordle = { round: view.round, guesses: typeof saved === 'string' ? Core.parseGuesses(saved) : [], current: '', done: typeof saved === 'string' && saved !== '' };
            }
            return wordle;
        }
        function wordleHtml(q, view, revealed) {
            var st = wordleState(view), rows = '';
            for (var r = 0; r < Core.WORDLE_MAX_GUESSES; r++) {
                var guess = st.guesses[r], fb = guess ? Core.wordleFeedback(guess, q.w) : null;
                var text = guess || (r === st.guesses.length && !revealed ? st.current : '');
                rows += '<div class="pl-w-row">';
                for (var c = 0; c < 5; c++) {
                    var ch = text.charAt(c);
                    rows += '<div class="pl-w-cell' + (fb ? ' pl-w-' + fb.charAt(c) : (ch ? ' pl-w-typed' : '')) + '">' + esc(ch) + '</div>';
                }
                rows += '</div>';
            }
            var keyState = {};
            st.guesses.forEach(function (g) {
                var fb = Core.wordleFeedback(g, q.w);
                for (var i = 0; i < 5; i++) {
                    var k = g.charAt(i), f = fb.charAt(i);
                    if (f === 'g' || (f === 'y' && keyState[k] !== 'g') || (f === 'x' && !keyState[k])) keyState[k] = f;
                }
            });
            var keys = revealed ? '' : '<div class="pl-w-keys">' + KEY_ROWS.map(function (row) {
                return '<div class="pl-w-keyrow">' + row.split('').map(function (k) {
                    var wide = k === '⏎' || k === '⌫';
                    return '<button class="pl-w-key' + (wide ? ' pl-w-key-wide' : '') + (keyState[k] ? ' pl-w-' + keyState[k] : '') + '" data-key="' + k + '"' + (st.done ? ' disabled' : '') + '>' +
                        (k === '⏎' ? 'Enter' : k === '⌫' ? '<i class="fas fa-delete-left"></i>' : k) + '</button>';
                }).join('') + '</div>';
            }).join('') + '</div>';
            var hint = st.guesses.length >= 2 || revealed ? '<p class="pl-w-hint"><i class="fas fa-lightbulb"></i> ' + esc(q.hint) + '</p>'
                : '<p class="pl-w-hint pl-w-hint-off">A hint appears after two guesses</p>';
            return '<p class="pl-prompt">Find the five-letter Bible word</p><div class="pl-w-grid" id="pl-w-grid">' + rows + '</div>' + hint +
                (st.done && !revealed ? '<p class="pl-waiting"><i class="fas fa-hourglass-half"></i> Locked in — waiting for the round to end</p>' : '') + keys;
        }
        function wordleKey(k, view) {
            var st = wordleState(view), q = question(view);
            if (st.done || view.phase !== 'question') return;
            if (k === '⌫' || k === 'BACKSPACE') st.current = st.current.slice(0, -1);
            else if (k === '⏎' || k === 'ENTER') {
                if (st.current.length < 5) { shake(); return; }
                st.guesses.push(st.current);
                st.current = '';
                var solved = st.guesses[st.guesses.length - 1] === q.w;
                if (solved || st.guesses.length >= Core.WORDLE_MAX_GUESSES) { st.done = true; session.submit(st.guesses.join('|')); }
                else session.progress(st.guesses.length);
            } else if (/^[A-Z]$/.test(k) && st.current.length < 5) st.current += k;
            else return;
            render(view, true);
        }
        function shake() {
            var grid = container.querySelector('#pl-w-grid');
            if (!grid) return;
            grid.classList.remove('pl-shake'); void grid.offsetWidth; grid.classList.add('pl-shake');
        }
        function onKeydown(e) {
            if (destroyed || !lastView || session.game !== 'wordle' || lastView.phase !== 'question') return;
            if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
            var k = e.key.toUpperCase();
            if (k === 'ENTER' || k === 'BACKSPACE' || /^[A-Z]$/.test(k)) { e.preventDefault(); wordleKey(k, lastView); }
        }

        // ----- render -----
        var lastView = null;
        function render(view, force) {
            // Re-render only when something visible changed: phase/round, my answer, the answers
            // that have arrived for the reveal, or who has locked in (the scoreboard ticks).
            var k = view.syncing ? 'sync' : [view.phase, view.round, session.myAnswer(view.round) === undefined ? 0 : 1,
                (view.room.answers[view.round] && view.phase !== 'question') ? Object.keys(view.room.answers[view.round]).length : 0,
                view.seated.length > 1 ? JSON.stringify((view.room.answered && view.room.answered[view.round]) || {}) : '',
                opts.roundLabel || ''].join(':');
            if (k === key && !force) return;
            key = k;
            if (view.syncing) {
                container.innerHTML = '<div class="pl-stage pl-center"><div class="pl-spinner"></div><p class="pl-waiting">Catching up with the game…</p></div>';
                return;
            }
            if (view.phase === 'countdown') {
                container.innerHTML = '<div class="pl-stage pl-center"><p class="pl-prompt">' + esc(cfg.name) + '</p><div class="pl-count" id="pl-count">3</div><p class="pl-waiting">' + esc(cfg.tagline) + '</p></div>';
                return;
            }
            if (view.phase === 'done') { container.innerHTML = '<div class="pl-stage pl-center"><div class="pl-spinner"></div><p class="pl-waiting">Adding up the scores…</p></div>'; return; }
            var q = question(view), revealed = view.phase === 'reveal';
            if (!q) { container.innerHTML = '<div class="pl-stage pl-center"><p class="pl-waiting">This question isn’t available in your version of the app.</p></div>'; return; }
            var body = cfg.type === 'wordle' ? wordleHtml(q, view, revealed) : promptHtml(q, view, revealed) + optionsHtml(q, view, revealed);
            var waiting = !revealed && cfg.type !== 'wordle' && session.myAnswer(view.round) !== undefined && view.seated.length > 1
                ? '<p class="pl-waiting"><i class="fas fa-hourglass-half"></i> Locked in — waiting for the others</p>' : '';
            container.innerHTML = '<div class="pl-stage pl-game-' + session.game + (revealed ? ' pl-revealed' : '') + '">' +
                headerHtml(view) + duelBarHtml(view, revealed ? view.round : view.round - 1) +
                '<div class="pl-body">' + body + waiting + (revealed ? learnHtml(q, view) : '') + '</div>' +
                (revealed && view.solo ? '<button class="btn btn-primary btn-block pl-next" id="pl-next">' + esc(opts.nextLabel || (view.round + 1 >= view.room.plan.rounds ? 'See results' : 'Next')) + ' <i class="fas fa-arrow-right"></i></button>' : '') +
                scoreboardHtml(view, revealed ? view.round : view.round - 1) + '</div>';
            tickDom(view);
        }

        /** Cheap per-tick updates (timer bar, countdown number, clue unlocks) without re-rendering. */
        function tickDom(view) {
            var fill = container.querySelector('#pl-timer-fill');
            if (fill) {
                var total = view.phase === 'question' ? view.timeline.duration : view.timeline.reveal;
                var pct = Math.max(0, Math.min(100, 100 * view.msLeft / total));
                fill.style.width = pct + '%';
                fill.classList.toggle('pl-timer-low', view.phase === 'question' && view.msLeft < 4000);
                fill.classList.toggle('pl-timer-reveal', view.phase === 'reveal');
            }
            var count = container.querySelector('#pl-count');
            if (count) count.textContent = String(Math.max(1, Math.ceil(view.msLeft / 1000)));
            if (session.game === 'whoami' && view.phase === 'question') {
                var shown = 1 + Math.floor((view.elapsed || 0) / (view.timeline.duration / 3));
                container.querySelectorAll('.pl-clue').forEach(function (li) {
                    if (+li.getAttribute('data-clue') < shown) li.classList.remove('pl-clue-hidden');
                });
            }
        }

        function onClick(e) {
            if (!lastView) return;
            var pick = e.target.closest('[data-pick]');
            if (pick && lastView.phase === 'question') { session.submit(+pick.getAttribute('data-pick')); return; }
            var keyBtn = e.target.closest('[data-key]');
            if (keyBtn) { wordleKey(keyBtn.getAttribute('data-key'), lastView); return; }
            if (e.target.closest('#pl-next') && opts.onNext) opts.onNext();
        }
        container.addEventListener('click', onClick);
        document.addEventListener('keydown', onKeydown);

        return {
            update: function (view) {
                if (destroyed) return;
                lastView = view;
                // Wordle: time is nearly up and guesses were made → hand them in before the round closes.
                if (session.game === 'wordle' && view.phase === 'question' && view.msLeft < 900 && !view.syncing) {
                    var st = wordleState(view);
                    if (!st.done && st.guesses.length) { st.done = true; session.submit(st.guesses.join('|')); }
                }
                render(view, false);
                if (!view.syncing) tickDom(view);
            },
            destroy: function () {
                destroyed = true;
                container.removeEventListener('click', onClick);
                document.removeEventListener('keydown', onKeydown);
            }
        };
    }

    window.GamesPlay = { LocalSession: LocalSession, mount: mount, refChip: refChip };
})();
