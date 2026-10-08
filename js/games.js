/* ============================================
   GraceGuide — js/games.js
   Play & Learn: the screens around the games.

   Hub (#/play), a page per game (#/play/battle), lobbies and live games
   (#/play/room/ID), joining by code (#/play/join/CODE), solo play
   (#/play/solo/GAME), the Daily Challenge (#/play/daily), leaderboards
   (#/play/leaderboard), badges, results, and game invitations.

   The games themselves are an engagement layer on top of the Bible: every
   reveal shows the Scripture behind the answer, and every results screen
   ends with the passages to go and read.

   Load order: games-bank.js, games-core.js, games-net.js, games-play.js,
   then this file (all after core.js / community.js).
   ============================================ */
(function () {
    'use strict';
    var Core = window.GamesCore, BANK = window.GAMES_BANK, Play = window.GamesPlay, AI = window.GamesAI || null;
    var net = null;
    var live = { session: null, stage: null, roomId: null, finished: false, results: null, award: null };
    var invites = { stop: null, cards: {} };
    var profileCache = null;
    var rematchAuto = null; // { roomId, need }: the rematch room this screen created; it starts once that many players are in
    var openTicket = 0; // only the latest openRoom() call may attach its session

    var esc = function (s) { return escapeHtml(String(s == null ? '' : s)); };
    function $id(id) { return document.getElementById(id); }
    function user() {
        return AppState.currentUser ? { uid: AppState.currentUser.uid, name: (AppState.userProfile && AppState.userProfile.username) || 'Player' } : null;
    }
    function getNet() {
        if (!net) {
            net = window.GamesNet.create({
                db: database, ServerValue: firebase.database.ServerValue, core: Core, bank: BANK, user: user,
                storage: {
                    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
                },
                notify: function (toUid, n) { if (typeof addNotification === 'function') addNotification(toUid, n); },
                customQuestions: function (game, level) { return prepareQuestions(game, level, false); }
            });
        }
        return net;
    }
    function today() {
        var d = new Date(), m = d.getMonth() + 1, day = d.getDate();
        return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
    function go(sub, arg, replace) {
        navigateToHash('#/play' + (sub ? '/' + sub : '') + (arg ? '/' + encodeURIComponent(arg) : ''), replace ? { replace: true } : {});
    }
    function nameOf(uid, fallback) { return typeof getDisplayName === 'function' ? getDisplayName(uid, fallback || 'Player') : (fallback || 'Player'); }
    function playUrl(path) { return window.location.origin + window.location.pathname + '#/play' + (path ? '/' + path : ''); }
    function errorText(err) {
        if (err && err.code === 'signed-out') return 'Sign in to play with others.';
        if (err && err.message && err.code && err.code !== 'PERMISSION_DENIED') return err.message;
        return navigator.onLine === false ? 'You’re offline — check your connection.' : 'Something went wrong. Please try again.';
    }
    function page(html) { DOM.pageContainer.innerHTML = '<div class="pl-page">' + html + '</div>'; }
    function loading(text) { page('<div class="pl-stage pl-center"><div class="pl-spinner"></div><p class="pl-waiting">' + esc(text || 'Loading…') + '</p></div>'); }

    function share(text, url) {
        var full = url ? text + '\n' + url : text;
        showSheet(
            '<h3 style="margin-bottom:16px;">Share</h3>' +
            '<div class="pl-share-preview">' + esc(full).replace(/\n/g, '<br>') + '</div>' +
            '<div style="display:grid; gap:8px; margin-top:16px;">' +
            '<a class="btn btn-block pl-btn-whatsapp" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(full) + '"><i class="fab fa-whatsapp"></i> Share on WhatsApp</a>' +
            (navigator.share ? '<button class="btn btn-outline btn-block" id="pl-share-native"><i class="fas fa-share-nodes"></i> More options</button>' : '') +
            '<button class="btn btn-outline btn-block" id="pl-share-copy"><i class="fas fa-copy"></i> Copy</button></div>');
        var nat = $id('pl-share-native');
        if (nat) nat.onclick = function () { navigator.share(url ? { text: text, url: url } : { text: text }).catch(function () {}); };
        $id('pl-share-copy').onclick = function () {
            (navigator.clipboard ? navigator.clipboard.writeText(full) : Promise.reject()).then(function () { showToast('Copied', 'success'); }, function () { showToast('Couldn’t copy — long-press the text instead.', 'warning'); });
        };
    }

    // ---------- leaving / keeping a game alive ----------

    function closeLive(leave) {
        if (live.stage) live.stage.destroy();
        if (live.session) live.session.close();
        if (leave && live.roomId) { getNet().stopWaiting(); getNet().leaveRoom(live.roomId); }
        live = { session: null, stage: null, roomId: null, finished: false, results: null, award: null };
        hidePill();
    }
    function liveGameRunning() {
        var v = live.session && live.session._view;
        return !!v && !live.session.solo && v.phase !== 'lobby' && !live.finished;
    }
    /** An online room I am in — lobby or game — that is not over yet. It is never left by accident. */
    function liveRoomOpen() { return !!live.session && !live.session.solo && !live.finished; }
    /** Looking at another page: the room stays mine (seat, game clock) and a pill leads back to it. */
    function keepRoomInBackground() {
        if (live.stage) { live.stage.destroy(); live.stage = null; }
        live.session.onUpdate = function (view) { updatePill(); backgroundUpdate(view); };
        showPill();
    }
    /**
     * One room at a time. If I am already in a room (lobby or game), anything that would start
     * another one sends me back to it instead — it is only ever left with Leave / Cancel.
     */
    function busyWithRoom(replace) {
        if (!liveRoomOpen()) return false;
        showToast(liveGameRunning() ? 'Finish your current game first.' : 'You already have a room open — leave or cancel it first.', 'info');
        go('room', live.roomId, replace);
        return true;
    }
    /** Called by navigateTo() for every navigation. */
    function onNavigate(route) {
        stopBoards();
        if (route === 'play') { hidePill(); return; }
        if (!live.session) return;
        // Only the Leave / Cancel buttons ever take a player out of a room. Wandering to
        // another page (or the phone redrawing this one) must not.
        if (liveRoomOpen()) keepRoomInBackground();
        else closeLive(false); // a finished game or a solo game: nothing to keep
    }
    /** While the room is in the background: a rematch host still starts it when everyone is back. */
    function backgroundUpdate(view) {
        if (view.phase === 'lobby') maybeAutoStart(view);
    }
    function showPill() {
        if ($id('pl-return-pill')) return;
        var pill = document.createElement('button');
        pill.id = 'pl-return-pill';
        pill.className = 'pl-return-pill';
        pill.onclick = function () { go('room', live.roomId); };
        document.body.appendChild(pill);
        updatePill();
    }
    function updatePill() {
        var pill = $id('pl-return-pill'), v = live.session && live.session._view;
        if (!pill || !v) return;
        pill.innerHTML = v.phase === 'done' ? '<i class="fas fa-flag-checkered"></i> Game finished — see results'
            : v.phase === 'lobby' ? '<i class="fas fa-door-open"></i> Your room is open (' + v.seated.length + ' in) — tap to return'
            : '<i class="fas fa-bolt"></i> Your game is live — tap to return';
    }
    function hidePill() { var p = $id('pl-return-pill'); if (p) p.remove(); }

    // ---------- hub ----------

    function levelCard(profile) {
        var u = user();
        if (!u) {
            return '<div class="pl-level pl-level-guest"><div><h3>Play &amp; Learn</h3><p>Sign in to save your XP, earn badges and play with Brethren.</p></div>' +
                '<button class="btn btn-gold btn-sm" onclick="showAuthModal({ message: \'Sign in to save your progress.\' })">Sign in</button></div>';
        }
        var p = profile || Core.emptyProfile(u.name), lvl = Core.level(p.xp || 0);
        var from = Core.xpForLevel(lvl), to = Core.xpForLevel(lvl + 1);
        var pct = Math.round(100 * ((p.xp || 0) - from) / (to - from));
        return '<div class="pl-level"><div class="pl-level-badge">' + lvl + '</div><div class="pl-level-main">' +
            '<div class="pl-level-title">' + esc(Core.levelTitle(lvl)) + ' <span>Level ' + lvl + '</span></div>' +
            '<div class="pl-xpbar"><div class="pl-xpbar-fill" style="width:' + pct + '%"></div></div>' +
            '<div class="pl-level-sub">' + (p.xp || 0) + ' XP · ' + (to - (p.xp || 0)) + ' to level ' + (lvl + 1) + '</div></div>' +
            '<div class="pl-streak" title="Days played in a row"><i class="fas fa-fire"></i><strong>' + (p.streak || 0) + '</strong></div></div>';
    }

    function renderHub() {
        var u = user();
        page(
            '<div id="pl-level-slot">' + levelCard(profileCache) + '</div>' +
            // Bible first: the games sit under an invitation to read.
            '<div class="pl-word-first"><i class="fas fa-book-bible"></i><span>The Word comes first. <a href="#/bible">Read today</a> · <a href="#/devotional">Devotional</a></span></div>' +
            '<div class="pl-daily" id="pl-daily-card" onclick="GamesUI.go(\'daily\')"><div class="pl-daily-icon"><i class="fas fa-calendar-day"></i></div>' +
            '<div class="pl-daily-main"><h3>Daily Challenge</h3><p id="pl-daily-sub">Five questions, one try, the same for everyone today.</p></div><i class="fas fa-chevron-right"></i></div>' +
            '<div class="pl-join"><input id="pl-code-input" class="form-input" maxlength="5" autocapitalize="characters" autocomplete="off" placeholder="Room code">' +
            '<button class="btn btn-primary" onclick="GamesUI.joinTyped()"><i class="fas fa-right-to-bracket"></i> Join</button></div>' +
            '<h3 class="pl-section">Games</h3><div class="pl-games">' + Core.GAME_IDS.map(function (id) {
                var g = Core.GAMES[id];
                return '<button class="pl-game pl-game-card-' + id + '" onclick="GamesUI.go(\'' + id + '\')"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span>' +
                    '<span class="pl-game-name">' + esc(g.name) + '</span><span class="pl-game-tag">' + esc(g.tagline) + '</span></button>';
            }).join('') + '</div>' +
            '<div class="pl-row-links"><button class="btn btn-outline btn-sm" onclick="GamesUI.go(\'leaderboard\')"><i class="fas fa-ranking-star"></i> Leaderboard</button>' +
            '<button class="btn btn-outline btn-sm" onclick="GamesUI.showBadges()"><i class="fas fa-award"></i> Badges</button>' +
            '<button class="btn btn-outline btn-sm" onclick="GamesUI.showTour()"><i class="fas fa-circle-question"></i> How to play</button></div>' +
            '<div id="pl-mine-slot"></div><div id="pl-top-slot"></div>');
        maybeShowTour();
        var input = $id('pl-code-input');
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') joinTyped(); });
        if (!u) return;
        var n = getNet();
        n.loadProfile(u.uid).then(function (p) {
            profileCache = p;
            var slot = $id('pl-level-slot'); if (slot) slot.innerHTML = levelCard(p);
        }).catch(function () {});
        n.dailyStatus(today()).then(function (run) {
            var sub = $id('pl-daily-sub'), card = $id('pl-daily-card');
            if (!sub || !run || typeof run.e !== 'number') return;
            var s = Core.scoreDaily(BANK, today(), run);
            sub.textContent = 'Done today — ' + s.correct + '/' + s.total + ' correct, ' + s.score + ' points. See how others did.';
            card.classList.add('pl-daily-done');
        }).catch(function () {});
        boards.stops.push(n.watchLeaderboard(5, function (rows) {
            var slot = $id('pl-top-slot');
            if (!slot || !rows || !rows.length) return;
            slot.innerHTML = '<h3 class="pl-section">Top players <span class="pl-live"><span></span> Live</span></h3><div class="card pl-board">' + boardRows(rows, u.uid) + '</div>';
        }));
        loadMyGames();
    }

    /** "My games": rooms I created or joined in the last three days — waiting rooms to go back to, results to look at again. */
    function loadMyGames() {
        getNet().myGames().then(function (list) {
            var slot = $id('pl-mine-slot');
            if (!slot || !list.length) return;
            slot.innerHTML = '<h3 class="pl-section">My games <span>kept for 3 days</span></h3><div class="card pl-players">' + list.slice(0, 8).map(function (g) {
                var cfg = Core.GAMES[g.game];
                if (!cfg) return '';
                var left = Math.max(0, getNet().KEEP_MS - (getNet().now() - g.t)), hours = Math.ceil(left / 3600000);
                return '<button class="pl-player pl-player-btn" onclick="GamesUI.go(\'room\', \'' + esc(g.roomId) + '\')"><span class="pl-mode-icon"><i class="fas ' + cfg.icon + '"></i></span>' +
                    '<span class="pl-player-name">' + esc(cfg.name) + ' <small>' + (g.kind === 'duel' ? '1v1' : 'Room') + (g.code ? ' · ' + esc(g.code) : '') + '</small></span>' +
                    '<span class="pl-tag pl-tag-away">' + (hours >= 24 ? Math.ceil(hours / 24) + 'd left' : hours + 'h left') + '</span></button>';
            }).join('') + '</div>';
        }).catch(function () {});
    }

    // ---------- first visit: a short tour (skippable) ----------

    var TOUR = [
        ['fa-gamepad', 'Welcome to Play & Learn', 'Five Bible games that send you back to the Word. Every answer shows its Scripture — tap the reference to read it.'],
        ['fa-compass', 'Finding your way', 'Pick a game, then how to play: <strong>Solo</strong>, <strong>Quick Match</strong> (1v1 with whoever is online), <strong>Challenge a Brethren</strong>, or <strong>Create a Room</strong> for up to 8 with a code. Have a code? Type it under the games and tap Join.'],
        ['fa-stopwatch', 'The rules', 'Everyone gets the same question and the same timer. Right answers score; faster answers and streaks score more. You can’t change an answer once it is locked in. In Bible Wordle you have six guesses.'],
        ['fa-sliders', 'Levels and fresh questions', 'Choose Easy, Medium or Hard on a game’s page. New questions are written for that level and checked against the Bible text before you see them.'],
        ['fa-fire', 'Come back daily', 'The Daily Challenge is five questions, one try. Playing each day keeps your streak, earns XP and badges, and counts toward your Spirit Life.']
    ];
    function showTour(step) {
        step = step || 0;
        var s = TOUR[step], last = step === TOUR.length - 1;
        // Counted as seen once the player acts on it (Skip / Next) — not merely when it opens,
        // because the page can redraw underneath it (e.g. while sign-in completes) and close it.
        var seen = function () { try { localStorage.setItem('gg_games_tour_seen', '1'); } catch (e) { /* private mode */ } };
        showModal('<div class="pl-tour"><div class="pl-tour-icon"><i class="fas ' + s[0] + '"></i></div><h3>' + s[1] + '</h3><p>' + s[2] + '</p>' +
            '<div class="pl-tour-dots">' + TOUR.map(function (x, i) { return '<span' + (i === step ? ' class="on"' : '') + '></span>'; }).join('') + '</div>' +
            '<div class="pl-tour-actions">' + (last ? '' : '<button class="btn btn-outline" id="pl-tour-skip">Skip</button>') +
            '<button class="btn btn-primary" id="pl-tour-next">' + (last ? 'Start playing' : 'Next') + '</button></div></div>');
        if ($id('pl-tour-skip')) $id('pl-tour-skip').onclick = function () { seen(); closeModal(); };
        $id('pl-tour-next').onclick = function () { seen(); if (last) closeModal(); else showTour(step + 1); };
    }
    function maybeShowTour() {
        var seen = false;
        try { seen = !!localStorage.getItem('gg_games_tour_seen'); } catch (e) { seen = true; }
        if (!seen) setTimeout(function () { if (AppState.currentRoute === 'play' && !AppState.modalOpen) showTour(0); }, 500);
    }

    function boardRows(rows, myUid, valueOf, firstIndex) {
        return rows.map(function (r, i) {
            i += firstIndex || 0;
            var lvl = Core.level(r.xp || 0);
            return '<div class="pl-board-row' + (r.uid === myUid ? ' pl-board-me' : '') + '" onclick="viewUserProfile(\'' + esc(r.uid) + '\')">' +
                '<span class="pl-board-rank' + (i < 3 ? ' pl-board-top' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
                '<span class="pl-board-name">' + esc(nameOf(r.uid, r.name)) + (valueOf ? '' : ' <small>Lv ' + lvl + '</small>') + '</span>' +
                '<span class="pl-board-value">' + (valueOf ? valueOf(r) : (r.xp + ' XP')) + '</span></div>';
        }).join('');
    }

    function joinTyped() {
        var input = $id('pl-code-input'), code = Core.parseCode(input && input.value);
        if (!code) { showToast('Room codes are 5 letters and numbers.', 'warning'); return; }
        go('join', code);
    }

    // ---------- a game's page: choose how to play ----------

    function renderGamePage(id) {
        var g = Core.GAMES[id];
        page(
            '<div class="pl-hero pl-game-card-' + id + '"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span><h2>' + esc(g.name) + '</h2><p>' + esc(g.tagline) + '</p>' +
            '<small>' + g.rounds + ' round' + (g.rounds === 1 ? '' : 's') + ' · ' + g.secs + ' seconds each</small></div>' +
            (AI ? '<div class="pl-levels"><div class="pl-levels-head"><strong>Level</strong><small id="pl-level-note"></small></div><div class="pl-level-pick">' +
                Object.keys(AI.LEVELS).map(function (l) { return '<button data-level="' + l + '"><strong>' + AI.LEVELS[l].label + '</strong><small>' + AI.LEVELS[l].about + '</small></button>'; }).join('') + '</div></div>' : '') +
            '<div class="pl-modes">' +
            mode('solo', 'fa-user', 'Solo', 'Practise at your own pace') +
            mode('quick', 'fa-bolt', 'Quick Match', '1v1 against whoever is online') +
            mode('duel', 'fa-user-group', 'Challenge a Brethren', 'A private 1v1 — invite or share the code') +
            mode('room', 'fa-people-group', 'Create a Room', 'Up to 8 players with a room code') +
            '</div><p class="pl-foot">Every answer comes with its Scripture — read it after you play.</p>');
        DOM.pageContainer.querySelectorAll('[data-mode]').forEach(function (b) {
            b.onclick = function () { startMode(id, b.getAttribute('data-mode')); };
        });
        if (!AI) return;
        // The level the host picks decides how hard the AI-written questions are.
        function drawLevel() {
            var level = AI.getLevel(), note = $id('pl-level-note');
            DOM.pageContainer.querySelectorAll('[data-level]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-level') === level); });
            if (note) note.innerHTML = AI.ready(id, level) ? '<i class="fas fa-circle-check"></i> Fresh questions ready' : '<i class="fas fa-wand-magic-sparkles"></i> Shepherd is preparing questions…';
        }
        DOM.pageContainer.querySelectorAll('[data-level]').forEach(function (b) {
            b.onclick = function () { AI.setLevel(b.getAttribute('data-level')); AI.refill(id, AI.getLevel()); drawLevel(); };
        });
        AI.refill(id, AI.getLevel());
        drawLevel();
        var onPool = function (e) { if (!$id('pl-level-note')) { document.removeEventListener('gg-ai-pool', onPool); return; } if (e.detail.game === id) drawLevel(); };
        document.addEventListener('gg-ai-pool', onPool);
    }
    function mode(key, icon, title, sub) {
        return '<button class="pl-mode" data-mode="' + key + '"><span class="pl-mode-icon"><i class="fas ' + icon + '"></i></span><span><strong>' + title + '</strong><small>' + sub + '</small></span><i class="fas fa-chevron-right"></i></button>';
    }
    function startMode(game, how) {
        if (how === 'solo') { go('solo', game); return; }
        if (!requireAuth('Sign in to play with others.', function () { startMode(game, how); })) return;
        if (busyWithRoom()) return;
        var n = getNet();
        loading(how === 'quick' ? 'Looking for an opponent…' : 'Setting up your room…');
        var p = how === 'quick' ? n.quickMatch(game, AI ? AI.getLevel() : null) : n.createRoom(game, how === 'duel' ? 'duel' : 'room', false, AI ? AI.getLevel() : null);
        p.then(function (r) { go('room', r.roomId, true); }, function (err) { showToast(errorText(err), 'error'); go(game, null, true); });
    }

    // ---------- rooms: lobby → game → results ----------

    function openRoom(roomId) {
        if (!requireAuth('Sign in to join this game.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to join this game.</p></div>'); return; }
        if (live.session && live.roomId === roomId && !live.session.solo) { attachRoom(); return; } // coming back via the pill
        // Opening another room never pulls me out of a game that is being played.
        if (busyWithRoom(true)) return;
        closeLive(false);
        loading('Joining…');
        var n = getNet(), ticket = ++openTicket;
        n.joinRoom(roomId).then(function () { return n.openRoom(roomId); }).then(function (session) {
            if (ticket !== openTicket || AppState.currentRoute !== 'play' || !AppState.playRoute || AppState.playRoute.arg !== roomId) { session.close(); return; }
            live.session = session; live.roomId = roomId;
            attachRoom();
        }).catch(function (err) { roomError(err); });
    }
    function roomError(err) {
        // A room that is gone (cancelled by its host, or past its three days) leaves "my games".
        if (err && err.code === 'not-found' && AppState.playRoute && AppState.playRoute.sub === 'room' && AppState.playRoute.arg) { try { getNet().forgetGame(AppState.playRoute.arg); } catch (e) { /* signed out */ } }
        var msg = { 'not-found': 'That room no longer exists. It may have been cancelled by its host, or its three days are up.', started: 'That game has already started.', full: 'That room is full.', left: 'You left this game.' }[err && err.code] || errorText(err);
        page('<div class="pl-stage pl-center"><i class="fas fa-door-closed pl-big-icon"></i><h3>' + esc(msg) + '</h3>' +
            '<button class="btn btn-primary" onclick="GamesUI.go()">Back to Play &amp; Learn</button></div>');
    }
    function joinCode(code) {
        if (!requireAuth('Sign in to join this game.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to join this game.</p></div>'); return; }
        loading('Finding room ' + code + '…');
        getNet().joinByCode(code).then(function (r) { go('room', r.roomId, true); }, roomError);
    }

    function attachRoom() {
        var s = live.session;
        hidePill();
        page('<div id="pl-room"></div>');
        var box = $id('pl-room'), lastPhase = null;
        s.onUpdate = function (view) {
            if (!$id('pl-room')) return;
            if (view.room.rematch && live.finished && !live.followed) offerRematch(view.room.rematch);
            if (view.phase === 'lobby') { if (live.stage) { live.stage.destroy(); live.stage = null; } renderLobby(box, view); maybeAutoStart(view); lastPhase = 'lobby'; return; }
            if (view.phase === 'done' && s.resultsReady()) { finishRoom(box); return; }
            if (!live.stage) {
                if (AppState.sheetOpen && typeof closeSheet === 'function') closeSheet(); // e.g. the invite list, still open when the game starts
                box.innerHTML = '<div id="pl-stage-box"></div><button class="btn btn-outline btn-sm pl-leave" id="pl-leave"><i class="fas fa-person-walking-arrow-right"></i> Leave game</button>';
                live.stage = Play.mount($id('pl-stage-box'), s, { names: function (uid) { return nameOf(uid, (s.room.players[uid] || {}).name); } });
                $id('pl-leave').onclick = confirmLeave;
            }
            lastPhase = view.phase;
            live.stage.update(view);
        };
        if (s._view) s.onUpdate(s._view);
    }
    function confirmLeave() {
        showModal('<h3 style="margin-bottom:8px;">Leave this game?</h3><p class="text-muted" style="margin-bottom:16px;">The others will carry on without you, and you won’t be able to rejoin.</p>' +
            '<div style="display:flex; gap:8px;"><button class="btn btn-outline" style="flex:1" onclick="closeModal()">Stay</button><button class="btn btn-primary" style="flex:1" id="pl-leave-yes">Leave</button></div>');
        $id('pl-leave-yes').onclick = function () { closeModal(); closeLive(true); go(null, null, true); };
    }

    function renderLobby(box, view) {
        var s = live.session, meta = view.room.meta, g = Core.GAMES[meta.game];
        var max = Core.MAX_PLAYERS[meta.kind], seated = view.seated;
        var isHost = meta.hostUid === s.uid, level = meta.level && AI && AI.LEVELS[meta.level] ? meta.level : null;
        var aiReady = !!(level && AI.ready(meta.game, level)), auto = rematchAuto && rematchAuto.roomId === live.roomId ? rematchAuto : null;
        var key = 'lobby:' + seated.map(function (u) { return u + (view.room.players[u].online === false ? '-' : '+'); }).join(',') + ':' + view.canStart + ':' + aiReady + ':' + !!auto;
        if (box.getAttribute('data-key') === key) return;
        box.setAttribute('data-key', key);
        var searching = meta.public && seated.length < 2;
        box.innerHTML =
            '<div class="pl-hero pl-game-card-' + meta.game + '"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span><h2>' + esc(g.name) + '</h2>' +
            '<p>' + (meta.kind === 'duel' ? '1v1' : 'Room · up to ' + max + ' players') + (level ? ' · ' + AI.LEVELS[level].label : '') + '</p></div>' +
            (auto ? '<div class="pl-searching"><div class="pl-spinner"></div><p>Rematch — waiting for the others to rejoin (' + seated.length + '/' + auto.need + ')</p><small>The game starts by itself when everyone is back.</small></div>' : '') +
            (searching ? '<div class="pl-searching"><div class="pl-spinner"></div><p>Looking for an opponent…</p><small>You’ll start automatically when someone joins. You can also invite a Brethren.</small></div>'
                : '<div class="pl-code-card"><small>Room code</small><div class="pl-code">' + esc(meta.code) + '</div>' +
                  '<div class="pl-code-actions"><button class="btn btn-outline btn-sm" id="pl-copy-code"><i class="fas fa-copy"></i> Copy</button>' +
                  '<button class="btn btn-sm pl-btn-whatsapp" id="pl-share-room"><i class="fab fa-whatsapp"></i> Share</button></div></div>') +
            '<button class="btn btn-gold btn-block" id="pl-invite"><i class="fas fa-user-plus"></i> Invite Brethren</button>' +
            '<h3 class="pl-section">Players <span>' + seated.length + '/' + max + '</span></h3><div class="card pl-players">' + seated.map(function (uid) {
                var p = view.room.players[uid];
                return '<div class="pl-player' + (p.online === false ? ' pl-player-away' : '') + '"><span class="post-avatar pl-avatar">' + esc(nameOf(uid, p.name).charAt(0).toUpperCase()) + '</span>' +
                    '<span class="pl-player-name">' + esc(nameOf(uid, p.name)) + (uid === s.uid ? ' <small>(you)</small>' : '') + '</span>' +
                    (uid === meta.hostUid ? '<span class="pl-tag">Host</span>' : '') + (p.online === false ? '<span class="pl-tag pl-tag-away">Away</span>' : '') + '</div>';
            }).join('') + '</div>' +
            (isHost && level ? '<p class="pl-ai-note"><i class="fas ' + (aiReady ? 'fa-circle-check' : 'fa-wand-magic-sparkles') + '"></i> ' +
                (aiReady ? 'Fresh ' + AI.LEVELS[level].label.toLowerCase() + ' questions are ready.'
                    : 'Shepherd is preparing fresh ' + AI.LEVELS[level].label.toLowerCase() + ' questions. If you start first, the game begins as soon as they are ready.') + '</p>' : '') +
            (meta.public ? '' : (view.canStart ? '<button class="btn btn-primary btn-block pl-start" id="pl-start"><i class="fas fa-play"></i> ' + (auto ? 'Start now' : 'Start game') + '</button>'
                : '<p class="pl-waiting">' + (seated.length < 2 ? 'Waiting for at least one more player…' : 'Waiting for the host to start…') + '</p>')) +
            (isHost ? '<button class="btn btn-outline btn-block pl-leave" id="pl-cancel-room"><i class="fas fa-ban"></i> Cancel room</button>'
                : '<button class="btn btn-outline btn-block pl-leave" id="pl-leave-lobby">Leave</button>') +
            '<p class="pl-foot">This room is kept for 3 days. You can leave this page and come back — your seat stays.</p>';
        if (isHost && level && !aiReady) AI.refill(meta.game, level);
        var link = playUrl('join/' + meta.code);
        var text = 'Join my ' + g.name + ' game on GraceGuide! 🎮📖\nRoom code: ' + meta.code;
        if ($id('pl-copy-code')) $id('pl-copy-code').onclick = function () {
            (navigator.clipboard ? navigator.clipboard.writeText(meta.code) : Promise.reject()).then(function () { showToast('Code copied', 'success'); }, function () { showToast('Your code is ' + meta.code, 'info'); });
        };
        if ($id('pl-share-room')) $id('pl-share-room').onclick = function () { share(text, link); };
        $id('pl-invite').onclick = function () { showInviteSheet({ roomId: live.roomId, code: meta.code, game: meta.game, kind: meta.kind }); };
        if ($id('pl-start')) $id('pl-start').onclick = function () {
            $id('pl-start').disabled = true;
            Promise.resolve(startRoomGame(s)).then(function (ok) { if (!ok && $id('pl-start')) $id('pl-start').disabled = false; });
        };
        if ($id('pl-leave-lobby')) $id('pl-leave-lobby').onclick = function () { closeLive(true); go(null, null, true); };
        if ($id('pl-cancel-room')) $id('pl-cancel-room').onclick = function () {
            showModal('<h3 style="margin-bottom:8px;">Cancel this room?</h3><p class="text-muted" style="margin-bottom:16px;">It closes for everyone and the code stops working.</p>' +
                '<div style="display:flex; gap:8px;"><button class="btn btn-outline" style="flex:1" onclick="closeModal()">Keep it</button><button class="btn btn-primary" style="flex:1" id="pl-cancel-yes">Cancel room</button></div>');
            $id('pl-cancel-yes').onclick = function () {
                var id = live.roomId;
                closeModal(); getNet().stopWaiting(); closeLive(false);
                getNet().cancelRoom(id).catch(function () { showToast('Couldn’t cancel the room. Please try again.', 'error'); });
                go(null, null, true);
            };
        };
    }

    /** Starts an online game with verified AI questions at the room's level when they are ready, else the built-in bank. */
    function startRoomGame(s) {
        return s.start(); // the session itself picks verified AI questions for the room's level when ready
    }
    /** A rematch room starts by itself once everyone from the last game is back in (the screen that created it does this). */
    function maybeAutoStart(view) {
        var auto = rematchAuto, s = live.session;
        if (!auto || !s || auto.roomId !== live.roomId || auto.started) return;
        if (view.seated.length >= auto.need && view.canStart) { auto.started = true; startRoomGame(s); }
    }
    // The lobby shows whether the AI questions are ready; redraw when that changes.
    document.addEventListener('gg-ai-pool', function () {
        var box = $id('pl-room'), v = live.session && live.session._view;
        if (box && v && v.phase === 'lobby' && !live.session.solo) renderLobby(box, v);
    });

    function awardedKey() { var u = user(); return 'gg_games_awarded_' + (u ? u.uid : ''); }
    function awardedBefore(roomId) {
        try { return JSON.parse(localStorage.getItem(awardedKey()) || '[]').indexOf(roomId) >= 0; } catch (e) { return false; }
    }
    function markAwarded(roomId) {
        try {
            var list = JSON.parse(localStorage.getItem(awardedKey()) || '[]');
            list.push(roomId); localStorage.setItem(awardedKey(), JSON.stringify(list.slice(-40)));
        } catch (e) { /* ignore */ }
    }

    function finishRoom(box) {
        var s = live.session;
        if (live.finished) { if (!$id('pl-results')) renderResults(box, s, live.results, live.award); return; }
        live.finished = true;
        if (live.stage) { live.stage.destroy(); live.stage = null; }
        var res = s.results(), mine = res.byUid[s.uid];
        live.results = res;
        // Re-opening a game that was already counted (back button, reload): no second award.
        // The same goes for looking at an old game again (results are kept for three days).
        var old = getNet().now() - res.timeline.finishedAt > 10 * 60000;
        if (!mine || old || awardedBefore(live.roomId)) { live.award = { already: true }; renderResults(box, s, res, live.award); return; }
        renderResults(box, s, res, null);
        markAwarded(live.roomId);
        if (typeof publishFaith === 'function') setTimeout(publishFaith, 6000); // the Play streak feeds the Spirit Life score
        getNet().award({ game: s.game, units: mine.units, totalUnits: res.totalUnits, win: mine.win, multiplayer: res.players >= 2, day: today(), minGuesses: mine.minGuesses, score: mine.score, roomId: live.roomId })
            .then(function (a) { live.award = a; profileCache = a.profile; if ($id('pl-results') && live.session === s) renderResults(box, s, res, a); celebrateBadges(a.newBadges); })
            .catch(function () {});
    }
    /**
     * Someone tapped Rematch: everyone still looking at the results goes with them into the
     * new room (same people, no searching). "Stay here" opts out.
     */
    function offerRematch(newRoomId) {
        var btn = $id('pl-rematch');
        if (!btn || btn.getAttribute('data-room') === newRoomId) return;
        btn.innerHTML = '<i class="fas fa-rotate-right"></i> Join the rematch'; btn.classList.add('pl-pulse'); btn.setAttribute('data-room', newRoomId);
        if (live.rematchTimer || live.followed) return;
        var note = document.createElement('div');
        note.className = 'pl-rematch-note'; note.id = 'pl-rematch-note';
        note.innerHTML = '<span><i class="fas fa-rotate-right"></i> Rematch! Taking you back in…</span><button class="btn btn-outline btn-sm" id="pl-rematch-stay">Stay here</button>';
        btn.parentNode.insertBefore(note, btn);
        $id('pl-rematch-stay').onclick = function () { clearTimeout(live.rematchTimer); live.rematchTimer = 'declined'; note.remove(); };
        live.rematchTimer = setTimeout(function () { var b = $id('pl-rematch'); if (b && !b.disabled && $id('pl-results')) b.click(); }, 3000);
    }

    // ---------- results (shared by rooms, solo and the daily challenge) ----------

    function xpHtml(award) {
        if (!user()) return '<div class="pl-xp-earned pl-xp-guest"><a href="javascript:void(0)" onclick="showAuthModal({ message: \'Sign in to save your XP.\' })">Sign in</a> to save XP and earn badges.</div>';
        if (!award) return '<div class="pl-xp-earned"><div class="pl-spinner pl-spinner-sm"></div> Saving your progress…</div>';
        if (award.already) return '';
        if (award.pending) return '<div class="pl-xp-earned">Your XP will appear shortly.</div>';
        var p = award.profile || {}, lvl = Core.level(p.xp || 0), from = Core.xpForLevel(lvl), to = Core.xpForLevel(lvl + 1);
        var badges = (award.newBadges || []).map(function (id) {
            var b = Core.BADGES.filter(function (x) { return x.id === id; })[0];
            return b ? '<div class="pl-new-badge"><i class="fas ' + b.icon + '"></i><div><strong>New badge: ' + esc(b.name) + '</strong><small>' + esc(b.desc) + '</small></div></div>' : '';
        }).join('');
        return '<div class="pl-xp-earned"><strong>+' + award.gained + ' XP</strong><span>' + esc(Core.levelTitle(lvl)) + ' · Level ' + lvl + '</span>' +
            '<div class="pl-xpbar"><div class="pl-xpbar-fill" style="width:' + Math.round(100 * ((p.xp || 0) - from) / (to - from)) + '%"></div></div>' +
            (award.gained === 0 && (p.dayXp || 0) >= Core.XP_DAY_CAP ? '<small>You’ve reached today’s XP limit — well played!</small>' : '') + '</div>' + badges;
    }

    /** "From the Word": every question's Scripture, missed ones first, each one tap from the reader. */
    function scriptureHtml(items) {
        var missed = items.filter(function (i) { return !i.ok; }), right = items.filter(function (i) { return i.ok; });
        function row(i) {
            return '<div class="pl-verse' + (i.ok ? '' : ' pl-verse-missed') + '"><i class="fas ' + (i.ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i>' +
                '<div class="pl-verse-main"><strong>' + esc(i.label) + '</strong><small>' + esc(i.q.x) + '</small></div>' +
                '<button class="btn btn-outline btn-sm" onclick="openPassageReference(\'' + esc(i.q.ref).replace(/'/g, "\\'") + '\')"><i class="fas fa-book-bible"></i> ' + esc(i.q.ref) + '</button></div>';
        }
        return '<h3 class="pl-section">From the Word</h3>' +
            (missed.length ? '<p class="pl-foot" style="text-align:left;">Missed ' + (missed.length === 1 ? 'one' : 'a few') + '? Read ' + (missed.length === 1 ? 'it' : 'them') + ' in context — that’s how it sticks.</p>' : '<p class="pl-foot" style="text-align:left;">A clean sheet! Go deeper into any of these passages.</p>') +
            '<div class="card pl-verses">' + missed.concat(right).map(row).join('') + '</div>';
    }
    function answerLabel(game, q) { return game === 'wordle' ? q.w : game === 'bibleornot' ? '“' + truncate(q.q, 60) + '”' : q.o[q.c]; }

    function renderResults(box, s, res, award) {
        var me = s.uid, mine = res.byUid[me], multi = res.players >= 2, g = Core.GAMES[s.game];
        var items = s.room.plan.q.map(function (id, r) {
            var q = Core.roomQuestion(BANK, s.game, s.room.plan, r);
            return q ? { q: q, ok: !!(mine && mine.rounds[r] && mine.rounds[r].ok), label: answerLabel(s.game, q) } : null;
        }).filter(Boolean);
        var headline = !mine ? 'Game over' : multi ? (mine.win ? (res.ranking.filter(function (u) { return res.byUid[u].win; }).length > 1 ? 'It’s a tie!' : 'You won! 🎉') : ordinal(mine.rank) + ' place')
            : (mine.units >= res.totalUnits ? 'Flawless! 🌟' : mine.correct ? 'Well played' : 'Good try');
        var rematchRoom = s.room.rematch;
        box.removeAttribute('data-key');
        box.innerHTML = '<div id="pl-results"><div class="pl-hero pl-game-card-' + s.game + '"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span><h2>' + esc(headline) + '</h2>' +
            (mine ? '<div class="pl-final-score">' + mine.score + '<small> points</small></div><p>' + mine.correct + ' of ' + s.room.plan.rounds + ' correct' + (mine.bestStreak > 1 ? ' · best streak ' + mine.bestStreak : '') + '</p>' : '') + '</div>' +
            xpHtml(award) +
            (multi ? '<h3 class="pl-section">Final ranking</h3><div class="card pl-board">' + boardRows(res.ranking.map(function (uid) { return { uid: uid, name: res.byUid[uid].name, xp: 0, score: res.byUid[uid].score }; }), me, function (r) { return r.score + ' pts'; }) + '</div>' : '') +
            scriptureHtml(items) +
            '<div class="pl-result-actions">' +
            (s.solo ? '<button class="btn btn-primary btn-block" id="pl-again"><i class="fas fa-rotate-right"></i> Play again</button>'
                : '<button class="btn btn-primary btn-block' + (rematchRoom ? ' pl-pulse' : '') + '" id="pl-rematch"' + (rematchRoom ? ' data-room="' + esc(rematchRoom) + '"' : '') + '><i class="fas fa-rotate-right"></i> ' + (rematchRoom ? 'Join the rematch' : 'Rematch') + '</button>') +
            '<button class="btn btn-block pl-btn-whatsapp" id="pl-share-result"><i class="fab fa-whatsapp"></i> Challenge a friend</button>' +
            '<button class="btn btn-outline btn-block" onclick="GamesUI.go()">Back to Play &amp; Learn</button></div></div>';
        $id('pl-share-result').onclick = function () {
            share('I scored ' + (mine ? mine.score : 0) + ' on ' + g.name + ' in GraceGuide’s Play & Learn 📖 Can you beat me?', playUrl(s.game));
        };
        if ($id('pl-again')) $id('pl-again').onclick = function () { startSolo(s.game); };
        if ($id('pl-rematch')) $id('pl-rematch').onclick = function () {
            var btn = $id('pl-rematch'); btn.disabled = true; live.followed = true;
            if (typeof live.rematchTimer === 'number') clearTimeout(live.rematchTimer);
            var target = btn.getAttribute('data-room');
            // Whoever taps first hosts the rematch; it starts by itself once the same players are back.
            var need = res.ranking.filter(function (uid) { var p = s.room.players[uid]; return p && typeof p.leftAt !== 'number'; }).length;
            (target ? getNet().joinRoom(target).then(function () { return { id: target, mine: false }; }) : s.rematch().then(function (id) { return { id: id, mine: s.rematchHosted === true }; })).then(function (r) {
                closeLive(false);
                if (r.mine && !target) rematchAuto = { roomId: r.id, need: Math.max(2, need) };
                go('room', r.id, true);
            }, function (err) { btn.disabled = false; live.followed = false; showToast(errorText(err), 'error'); });
        };
    }
    function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }

    // ---------- solo ----------

    // ---------- fresh questions from Shepherd (AI), with the classic bank as the last resort ----------

    var STAGES = [['writing', 'Writing new questions'], ['checking', 'Looking up each verse in the Bible'], ['verifying', 'Checking every answer against Scripture'], ['ready', 'Ready to play']];
    function drawPreparing(game, level) {
        var box = $id('pl-preparing');
        if (!box) return;
        var st = AI.status(game, level) || { stage: 'writing', attempt: 1, attempts: 3, have: 0, need: Core.GAMES[game].rounds };
        var at = st.stage === 'retrying' ? 0 : Math.max(0, STAGES.map(function (s) { return s[0]; }).indexOf(st.stage));
        box.innerHTML = STAGES.map(function (s, i) {
            var state = i < at ? 'done' : i === at ? 'now' : 'todo';
            var detail = i === at && s[0] === 'checking' && st.of ? ' (' + st.at + ' of ' + st.of + ')' : '';
            return '<div class="pl-prep-step pl-prep-' + state + '"><span class="pl-prep-dot">' + (state === 'done' ? '<i class="fas fa-check"></i>' : state === 'now' ? '<span class="pl-spinner pl-spinner-sm"></span>' : '') + '</span><span>' + s[1] + detail + '</span></div>';
        }).join('') +
            '<p class="pl-prep-note">' + (st.attempt > 1 || st.stage === 'retrying'
                ? 'Some questions didn’t pass the Scripture check, so Shepherd is writing more (round ' + Math.min(st.attempts, st.attempt + (st.stage === 'retrying' ? 1 : 0)) + ' of ' + st.attempts + '). ' + (st.have || 0) + ' of ' + st.need + ' ready.'
                : 'Every question is checked against the Bible text before you see it. This usually takes under a minute.') + '</p>';
    }
    /**
     * Resolves this game's questions: a verified fresh set from Shepherd at the chosen level, or
     * null to play the classic questions — which only happens when the game has no level, the
     * AI cannot be reached at all, or every attempt to prepare a set has failed. While Shepherd
     * is still working a dialog shows what it is doing. `cancellable` (solo) adds a Cancel button;
     * the promise then rejects with { cancelled: true }.
     */
    function prepareQuestions(game, level, cancellable) {
        if (!AI || !level || !AI.LEVELS[level]) return Promise.resolve(null);
        var ready = AI.take(game, level);
        if (ready) return Promise.resolve(ready);
        if (!AI.available()) { showToast('Shepherd can’t be reached right now — playing the classic questions.', 'info'); return Promise.resolve(null); }
        return new Promise(function (resolve, reject) {
            var done = false, onProgress = function (e) { if (e.detail.game === game && e.detail.level === level) drawPreparing(game, level); };
            showModal('<div class="pl-prep"><div class="pl-prep-icon"><i class="fas fa-dove"></i></div><h3>Shepherd is still generating questions</h3>' +
                '<p class="pl-prep-sub">' + esc(Core.GAMES[game].name) + ' · ' + AI.LEVELS[level].label + '</p><div id="pl-preparing"></div>' +
                (cancellable ? '<button class="btn btn-outline btn-block" id="pl-prep-cancel">Cancel</button>' : '') + '</div>',
                { closeOnOverlay: false });
            drawPreparing(game, level);
            document.addEventListener('gg-ai-progress', onProgress);
            if ($id('pl-prep-cancel')) $id('pl-prep-cancel').onclick = function () { finish(null, true); };
            function finish(custom, cancelled) {
                if (done) return;
                done = true;
                document.removeEventListener('gg-ai-progress', onProgress);
                if ($id('pl-preparing') && AppState.modalOpen) closeModal();
                if (cancelled) reject({ cancelled: true }); else resolve(custom);
            }
            AI.ensure(game, level).then(function (ok) {
                var custom = ok ? AI.take(game, level) : null;
                if (!custom && !done) showToast('Shepherd couldn’t prepare new questions after several tries — playing the classic questions this time.', 'warning');
                finish(custom, false);
            });
        });
    }

    function startSolo(game) {
        closeLive(false);
        if (!Core.GAMES[game]) { go(null, null, true); return; }
        loading('Getting your questions…');
        prepareQuestions(game, AI ? AI.getLevel() : null, true).then(function (custom) {
            if (AppState.currentRoute !== 'play' || !AppState.playRoute || AppState.playRoute.sub !== 'solo' || AppState.playRoute.arg !== game) return;
            runSolo(game, custom);
        }, function () { go(game, null, true); });
    }
    function runSolo(game, custom) {
        var u = user(), cfg = Core.GAMES[game], n = getNet();
        var q;
        if (custom) q = custom.ids;
        else { q = Core.pickQuestions(BANK, game, cfg.rounds, n.recentQuestions(game)); n.rememberQuestions(game, q); }
        var s = new Play.LocalSession(game, u ? u.uid : 'guest', u ? u.name : 'You', q, custom ? custom.qs : null);
        live.session = s;
        page('<div id="pl-room"><div id="pl-stage-box"></div></div>');
        var box = $id('pl-room'), runRef = null;
        // With the game server deployed, a solo run is recorded so the server can verify it.
        if (u) n.serverAlive().then(function (alive) { return alive ? n.startRun(game, q, custom ? custom.qs : null) : null; }).then(function (ref) { runRef = ref; }).catch(function () {});
        live.stage = Play.mount($id('pl-stage-box'), s, { onNext: function () { s.skipReveal(); } });
        s.onUpdate = function (view) {
            if (!$id('pl-room')) return;
            if (view.phase !== 'done') { live.stage.update(view); return; }
            if (live.finished) return;
            live.finished = true;
            live.stage.destroy(); live.stage = null;
            var res = s.results(), mine = res.byUid[s.uid];
            live.results = res;
            renderResults(box, s, res, null);
            if (!u) return;
            n.award({ game: game, units: mine.units, totalUnits: res.totalUnits, win: false, multiplayer: false, day: today(), minGuesses: mine.minGuesses, score: mine.score,
                runRef: runRef, runAnswers: mine.rounds.map(function (r) { return r.a == null ? -1 : r.a; }) })
                .then(function (a) { live.award = a; profileCache = a.profile; if ($id('pl-results') && live.session === s) renderResults(box, s, res, a); celebrateBadges(a.newBadges); if (typeof publishFaith === 'function') publishFaith(); })
                .catch(function () { if ($id('pl-results') && live.session === s) renderResults(box, s, res, { pending: true }); });
        };
        s.open();
    }

    // ---------- daily challenge ----------

    function renderDaily() {
        if (!requireAuth('Sign in to take the Daily Challenge.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to take the Daily Challenge.</p></div>'); return; }
        closeLive(false);
        loading('Loading today’s challenge…');
        var n = getNet(), day = today();
        n.dailyStatus(day).then(function (run) {
            if (AppState.currentRoute !== 'play') return;
            if (run && typeof run.e === 'number') { showDailyBoard(day, run); return; }
            var qs = Core.dailyQuestions(BANK, day);
            page('<div class="pl-hero pl-daily-hero"><span class="pl-game-icon"><i class="fas fa-calendar-day"></i></span><h2>Daily Challenge</h2>' +
                '<p>Five questions from across the games. Everyone gets the same five today, and you get one try.</p><small>Faster finishes earn a bonus — the clock starts when you tap Start.</small></div>' +
                '<button class="btn btn-primary btn-block" id="pl-daily-start"><i class="fas fa-play"></i> ' + (run ? 'Continue' : 'Start') + '</button>' +
                '<button class="btn btn-outline btn-block" style="margin-top:8px;" onclick="GamesUI.go()">Not now</button>');
            $id('pl-daily-start').onclick = function () {
                $id('pl-daily-start').disabled = true;
                (run ? Promise.resolve() : n.dailyStart(day)).then(function () { playDaily(day, qs); }, function (err) { showToast(errorText(err), 'error'); go(null, null, true); });
            };
        }, function (err) { roomError(err); });
    }
    function playDaily(day, qs) {
        var u = user(), answers = [], started = Date.now(), i = 0;
        page('<div id="pl-room"><div id="pl-stage-box"></div></div>');
        function next() {
            if (live.stage) live.stage.destroy();
            if (live.session) live.session.close();
            if (i >= qs.length) { finish(); return; }
            var s = new Play.LocalSession(qs[i].game, u.uid, u.name, [qs[i].id]);
            live.session = s;
            live.stage = Play.mount($id('pl-stage-box'), s, { roundLabel: 'Daily ' + (i + 1) + ' / ' + qs.length, nextLabel: i + 1 >= qs.length ? 'Finish' : 'Next', onNext: function () { s.skipReveal(); } });
            s.onUpdate = function (view) {
                if (!$id('pl-stage-box')) return;
                if (view.phase !== 'done') { live.stage.update(view); return; }
                if (s._counted) return;
                s._counted = true;
                var a = s.myAnswer(0);
                answers.push(typeof a === 'number' ? a : -1);
                i++; next();
            };
            s.open();
        }
        function finish() {
            live.session = null; live.stage = null;
            loading('Scoring your challenge…');
            var n = getNet();
            // The server refuses a finish less than 5 s after the start (nobody reads five questions that fast).
            var wait = Math.max(0, 5600 - (Date.now() - started));
            setTimeout(function () {
                n.dailyFinish(day, answers).then(function (run) {
                    var sc = Core.scoreDaily(BANK, day, run);
                    return n.award({ game: 'battle', daily: true, units: sc.correct, totalUnits: sc.total, day: day, score: sc.score }).catch(function () { return { pending: true }; }).then(function (a) {
                        if (a && a.profile) profileCache = a.profile;
                        if (a) celebrateBadges(a.newBadges);
                        showDailyBoard(day, run, a);
                    });
                }, function (err) { showToast(errorText(err), 'error'); go(null, null, true); });
            }, wait);
        }
        next();
    }
    function showDailyBoard(day, run, award) {
        var sc = Core.scoreDaily(BANK, day, run), u = user();
        var items = Core.dailyQuestions(BANK, day).map(function (d, i) {
            var q = Core.questionById(BANK, d.game, d.id);
            return { q: q, ok: (run.a || [])[i] === q.c, label: answerLabel(d.game, q) };
        });
        page('<div class="pl-hero pl-daily-hero"><span class="pl-game-icon"><i class="fas fa-calendar-check"></i></span><h2>Today’s challenge</h2>' +
            '<div class="pl-final-score">' + sc.score + '<small> points</small></div><p>' + sc.correct + ' of ' + sc.total + ' correct · ' + Math.round(sc.elapsed / 1000) + ' s</p><small>Come back tomorrow for five new questions.</small></div>' +
            (award ? xpHtml(award) : '') + '<h3 class="pl-section">Today’s leaderboard</h3><div class="card pl-board" id="pl-daily-board"><div class="pl-spinner"></div></div>' +
            scriptureHtml(items) +
            '<div class="pl-result-actions"><button class="btn btn-block pl-btn-whatsapp" id="pl-share-daily"><i class="fab fa-whatsapp"></i> Share my score</button>' +
            '<button class="btn btn-outline btn-block" onclick="GamesUI.go()">Back to Play &amp; Learn</button></div>');
        $id('pl-share-daily').onclick = function () { share('GraceGuide Daily Challenge — ' + sc.correct + '/' + sc.total + ' and ' + sc.score + ' points today 📖 Your turn!', playUrl('daily')); };
        getNet().dailyBoard(day).then(function (rows) {
            var b = $id('pl-daily-board');
            if (b) b.innerHTML = rows.length ? boardRows(rows.slice(0, 50), u.uid, function (r) { return r.score + ' pts'; }) : '<p class="pl-waiting">You’re the first today!</p>';
        }).catch(function () { var b = $id('pl-daily-board'); if (b) b.innerHTML = '<p class="pl-waiting">Couldn’t load the leaderboard.</p>'; });
    }

    // ---------- leaderboard & badges ----------

    // Leaderboards are live: they redraw whenever anyone's score changes, not only mine.
    var boards = { stops: [], rows: null, expanded: false, value: null, empty: '' };
    function stopBoards() { boards.stops.forEach(function (stop) { try { stop(); } catch (e) { /* already stopped */ } }); boards.stops = []; }
    /** Top 10 first; "View more" shows everyone. */
    function drawBoard() {
        var b = $id('pl-board'), u = user();
        if (!b || !u) return;
        if (boards.rows === null) { b.innerHTML = '<p class="pl-waiting">Couldn’t load the leaderboard.</p>'; return; }
        if (!boards.rows.length) { b.innerHTML = '<p class="pl-waiting">' + boards.empty + '</p>'; return; }
        var rows = boards.expanded ? boards.rows : boards.rows.slice(0, 10);
        var mine = boards.rows.map(function (r) { return r.uid; }).indexOf(u.uid);
        b.innerHTML = boardRows(rows, u.uid, boards.value) +
            (!boards.expanded && mine >= 10 ? '<div class="pl-board-gap">…</div>' + boardRows([boards.rows[mine]], u.uid, boards.value, mine) : '') +
            (boards.rows.length > 10 ? '<button class="btn btn-outline btn-sm btn-block pl-board-more" id="pl-board-more">' + (boards.expanded ? 'Show top 10' : 'View more (' + boards.rows.length + ')') + '</button>' : '');
        if ($id('pl-board-more')) $id('pl-board-more').onclick = function () { boards.expanded = !boards.expanded; drawBoard(); };
    }
    function renderLeaderboard(tab) {
        if (!requireAuth('Sign in to see the leaderboard.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to see the leaderboard.</p></div>'); return; }
        tab = tab || 'global';
        var u = user(), n = getNet();
        page('<h2 class="pl-title">Leaderboard</h2><div class="pl-tabs">' +
            ['global', 'brethren', 'today'].map(function (t) {
                return '<button class="pl-tab' + (t === tab ? ' pl-tab-on' : '') + '" onclick="GamesUI.leaderboard(\'' + t + '\')">' + { global: 'Everyone', brethren: 'Brethren', today: 'Today’s challenge' }[t] + '</button>';
            }).join('') + '</div><p class="pl-live"><span></span> Live</p><div class="card pl-board" id="pl-board"><div class="pl-spinner"></div></div>');
        stopBoards();
        boards.rows = []; boards.expanded = false; boards.value = null;
        var show = function (rows) { boards.rows = rows; drawBoard(); };
        if (tab === 'today') {
            boards.value = function (r) { return r.score + ' pts'; }; boards.empty = 'Nobody has finished today’s challenge yet.';
            boards.stops.push(n.watchDailyBoard(today(), show));
        } else if (tab === 'brethren') {
            boards.empty = 'Play a game and invite your Brethren to see them here.';
            var uids = [u.uid];
            if (AppState.userConnections) AppState.userConnections.forEach(function (status, uid) { if (status === 'brethren') uids.push(uid); });
            // One small listener per Brethren, so their XP moves here as they play.
            var byUid = {};
            uids.slice(0, 60).forEach(function (uid) {
                var ref = database.ref('games/profiles/' + uid);
                var h = ref.on('value', function (s) {
                    var p = s.val();
                    if (p) byUid[uid] = { uid: uid, name: Core.cleanName(p.name), xp: p.xp || 0 }; else delete byUid[uid];
                    show(Object.keys(byUid).map(function (k) { return byUid[k]; }).sort(function (a, b) { return b.xp - a.xp; }));
                }, function () {});
                boards.stops.push(function () { ref.off('value', h); });
            });
        } else {
            boards.empty = 'No scores yet — be the first!';
            boards.stops.push(n.watchLeaderboard(100, show));
        }
    }
    function showBadges() {
        var earned = (profileCache && profileCache.badges) || {}, claimed = (profileCache && profileCache.claimed) || {};
        var waiting = Core.claimable(profileCache).length;
        // Earned first (unclaimed ones at the very top), then the ones still to earn.
        var order = Core.BADGES.slice().sort(function (a, b) {
            var rank = function (x) { return earned[x.id] ? (claimed[x.id] ? 1 : 0) : 2; };
            return rank(a) - rank(b);
        });
        showSheet('<h3 style="margin-bottom:4px;">Badges</h3><p class="text-muted" style="margin-bottom:16px;">' + Object.keys(earned).length + ' of ' + Core.BADGES.length + ' earned' +
            (waiting ? ' · <strong>' + waiting + ' bonus' + (waiting === 1 ? '' : 'es') + ' to claim</strong>' : '') + '</p><div class="pl-badges">' +
            order.map(function (b) {
                var on = !!earned[b.id], got = !!claimed[b.id];
                return '<div class="pl-badge' + (on ? ' pl-badge-on' : '') + '"><span class="pl-badge-icon"><i class="fas ' + b.icon + '"></i></span>' +
                    '<strong>' + esc(b.name) + '</strong><small>' + esc(b.desc) + '</small><em>' + esc(b.ref) + '</em>' +
                    (on && !got ? '<button class="btn btn-gold btn-sm pl-badge-claim" data-claim="' + b.id + '">Claim +' + b.xp + ' XP</button>'
                        : '<span class="pl-badge-xp">' + (got ? '<i class="fas fa-check"></i> +' + b.xp + ' XP claimed' : '+' + b.xp + ' XP') + '</span>') + '</div>';
            }).join('') + '</div>');
        document.querySelectorAll('[data-claim]').forEach(function (btn) {
            btn.onclick = function () { claimBadge(btn.getAttribute('data-claim'), btn).then(function () { if (AppState.sheetOpen) showBadges(); }); };
        });
    }

    /** Claims a badge's bonus XP; `btn` (optional) shows the progress. Resolves true when the XP was added. */
    function claimBadge(id, btn) {
        var b = Core.badgeById(id);
        if (!b || !user()) return Promise.resolve(false);
        if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
        return getNet().claimBadge(id).then(function (r) {
            if (r && r.profile) profileCache = r.profile;
            var slot = $id('pl-level-slot'); if (slot) slot.innerHTML = levelCard(profileCache);
            if (r && r.gained > 0) { chime([784, 988, 1319]); showToast('+' + r.gained + ' XP — ' + b.name, 'success'); return true; }
            if (r && r.pending) showToast('Your bonus XP will appear shortly.', 'info');
            return false;
        }, function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Claim +' + b.xp + ' XP'; }
            showToast('Couldn’t claim that just now — try again from Badges.', 'error');
            return false;
        });
    }

    // ---------- a badge is earned: the celebration ----------

    var audio = null;
    /** A short, soft chime (made in the browser — no sound file). Silent if the device does not allow it. */
    function chime(notes) {
        try {
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            if (audio.state === 'suspended') audio.resume();
            notes.forEach(function (freq, i) {
                var osc = audio.createOscillator(), gain = audio.createGain(), at = audio.currentTime + i * 0.13;
                osc.type = 'sine'; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
                osc.connect(gain); gain.connect(audio.destination);
                osc.start(at); osc.stop(at + 0.6);
            });
        } catch (e) { /* no audio: the animation is enough */ }
    }
    var badgeQueue = [], badgeShowing = false;
    function celebrateBadges(ids) {
        (ids || []).forEach(function (id) { if (Core.badgeById(id) && badgeQueue.indexOf(id) < 0) badgeQueue.push(id); });
        if (!badgeShowing) nextBadge();
    }
    function nextBadge() {
        var id = badgeQueue.shift(), b = id && Core.badgeById(id);
        if (!b) { badgeShowing = false; return; }
        badgeShowing = true;
        var el = document.createElement('div');
        el.className = 'pl-pop';
        var confetti = '';
        for (var i = 0; i < 26; i++) confetti += '<i style="left:' + Math.round(Math.random() * 100) + '%; animation-delay:' + (Math.random() * 0.6).toFixed(2) + 's; background:' + ['#c7a65a', '#c87552', '#718575', '#f8f6f0', '#d9bc7a'][i % 5] + '; transform: rotate(' + Math.round(Math.random() * 360) + 'deg);"></i>';
        el.innerHTML = '<div class="pl-pop-confetti">' + confetti + '</div><div class="pl-pop-card" role="dialog" aria-label="Badge earned">' +
            '<div class="pl-pop-rays"></div><div class="pl-pop-badge"><i class="fas ' + b.icon + '"></i></div>' +
            '<div class="pl-pop-eyebrow">Badge earned</div><h3>' + esc(b.name) + '</h3><p>' + esc(b.desc) + '</p><em>' + esc(b.ref) + '</em>' +
            '<button class="btn btn-gold btn-block pl-pop-claim" id="pl-pop-claim"><i class="fas fa-gift"></i> Claim +' + b.xp + ' XP</button>' +
            '<button class="pl-pop-later" id="pl-pop-later">Later</button></div>';
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.classList.add('pl-pop-in'); });
        chime([523, 659, 784, 1047]);
        function close() {
            el.classList.remove('pl-pop-in');
            setTimeout(function () { el.remove(); nextBadge(); }, 260);
        }
        el.querySelector('#pl-pop-later').onclick = close;
        el.querySelector('#pl-pop-claim').onclick = function () {
            var btn = el.querySelector('#pl-pop-claim');
            claimBadge(id, btn).then(function (ok) {
                if (ok) { btn.innerHTML = '<i class="fas fa-check"></i> +' + b.xp + ' XP added'; el.querySelector('.pl-pop-card').classList.add('pl-pop-claimed'); setTimeout(close, 900); }
                else close();
            });
        };
    }
    // ---------- invitations ----------

    function showInviteSheet(room, namesLoaded) {
        var brethren = [];
        if (AppState.userConnections) AppState.userConnections.forEach(function (status, uid) { if (status === 'brethren') brethren.push(uid); });
        if (!brethren.length) {
            showSheet('<h3 style="margin-bottom:8px;">Invite Brethren</h3><p class="text-muted">Connect with people as Brethren and you can challenge them here. For now, share the room code instead.</p>');
            return;
        }
        // Names come from each person's live profile; load any we don't have yet first.
        if (!namesLoaded && typeof fetchUserProfileName === 'function') {
            Promise.all(brethren.map(function (uid) { return Promise.resolve(fetchUserProfileName(uid)).catch(function () {}); }))
                .then(function () { showInviteSheet(room, true); });
            return;
        }
        brethren.sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
        showSheet('<h3 style="margin-bottom:4px;">Invite Brethren</h3><p class="text-muted" style="margin-bottom:12px;">They’ll get a notification they can accept in one tap.</p><div class="pl-players">' +
            brethren.map(function (uid) {
                return '<button class="pl-player pl-player-btn" data-invite="' + esc(uid) + '"><span class="post-avatar pl-avatar">' + esc(nameOf(uid).charAt(0).toUpperCase()) + '</span>' +
                    '<span class="pl-player-name">' + esc(nameOf(uid)) + '</span><span class="pl-tag">Invite</span></button>';
            }).join('') + '</div>');
        document.querySelectorAll('[data-invite]').forEach(function (btn) {
            btn.onclick = function () {
                var uid = btn.getAttribute('data-invite'), n = getNet();
                btn.disabled = true; btn.querySelector('.pl-tag').textContent = 'Sending…';
                n.sendInvite(uid, room).then(function (sent) {
                    btn.querySelector('.pl-tag').textContent = 'Invited ✓';
                    var stop = n.watchInviteReply(uid, sent.id, function (status) {
                        stop();
                        showToast(nameOf(uid) + (status === 'accepted' ? ' accepted your challenge!' : ' can’t play right now.'), status === 'accepted' ? 'success' : 'info');
                    });
                    setTimeout(function () { stop(); }, window.GamesNet.INVITE_TTL_MS + 5000);
                }, function () { btn.disabled = false; btn.querySelector('.pl-tag').textContent = 'Invite'; showToast('Couldn’t send that invite.', 'error'); });
            };
        });
    }

    /** A floating "you've been challenged" card — shown on whatever page the user is on. */
    function showInviteCard(invite) {
        if (invites.cards[invite.id]) return; // never twice for the same invitation
        var n = getNet(), g = Core.GAMES[invite.game];
        if (!g) return;
        var card = document.createElement('div');
        card.className = 'pl-invite-card';
        card.innerHTML = '<div class="pl-invite-icon"><i class="fas ' + g.icon + '"></i></div><div class="pl-invite-main"><strong>' + esc(nameOf(invite.from, invite.fromName)) + ' challenged you to ' + esc(g.name) + '!</strong>' +
            '<small>' + (invite.kind === 'duel' ? '1v1' : 'Room') + ' · code ' + esc(invite.code) + '</small><div class="pl-invite-timer"><div></div></div>' +
            '<div class="pl-invite-actions"><button class="btn btn-outline btn-sm" data-act="decline">Decline</button><button class="btn btn-gold btn-sm" data-act="accept">Accept</button></div></div>';
        document.body.appendChild(card);
        requestAnimationFrame(function () { card.classList.add('pl-invite-in'); });
        var total = Math.max(1000, invite.exp - n.now());
        var bar = card.querySelector('.pl-invite-timer div');
        void bar.offsetWidth; // paint the full bar first, then let it drain
        setTimeout(function () { bar.style.transition = 'width ' + total + 'ms linear'; bar.style.width = '0%'; }, 60);
        var timer = setTimeout(function () { removeInviteCard(invite.id); }, total);
        invites.cards[invite.id] = { el: card, timer: timer };
        card.querySelector('[data-act="decline"]').onclick = function () { n.respondInvite(invite.id, 'declined').catch(function () {}); removeInviteCard(invite.id); };
        card.querySelector('[data-act="accept"]').onclick = function () { acceptInvite(invite); };
    }
    function removeInviteCard(id) {
        var c = invites.cards[id];
        if (!c || !c.el) return;
        clearTimeout(c.timer);
        c.el.classList.remove('pl-invite-in');
        var el = c.el;
        invites.cards[id] = { el: null }; // remembered, so it is not shown again this session
        setTimeout(function () { el.remove(); }, 250);
    }
    function acceptInvite(invite) {
        var n = getNet();
        removeInviteCard(invite.id);
        n.inviteLive(invite).then(function (ok) {
            if (!ok) { showToast('That invitation has expired.', 'info'); n.dismissInvite(invite.id); return; }
            if (busyWithRoom()) return;
            n.respondInvite(invite.id, 'accepted').catch(function () {});
            closeLive(false);
            go('join', invite.code);
        });
    }
    function onSignedIn() {
        if (invites.stop || !user()) return;
        try { invites.stop = getNet().watchInvites(showInviteCard, function (id) { removeInviteCard(id); }); } catch (e) { /* not signed in yet */ }
    }
    function onSignedOut() {
        if (invites.stop) { invites.stop(); invites.stop = null; }
        Object.keys(invites.cards).forEach(removeInviteCard);
        closeLive(false);
        profileCache = null;
    }

    // ---------- routing ----------

    /** navigateTo('play') → this. AppState.playRoute = { sub, arg } from the URL (#/play/sub/arg). */
    function renderPlayPage() {
        var r = AppState.playRoute || {}, sub = r.sub, arg = r.arg;
        onSignedIn();
        AppState.scrollPositions.play = 0; // every Play screen opens at the top
        stopBoards();
        if (sub === 'room' && arg) { openRoom(arg); return; }
        // One room at a time: starting something else would abandon the people in it.
        if ((sub === 'solo' || sub === 'daily' || sub === 'join') && busyWithRoom(true)) return;
        // Any other Play page: my room (lobby or game) stays mine behind the "return" pill.
        if (liveRoomOpen()) keepRoomInBackground();
        else if (sub !== 'solo' && sub !== 'daily') closeLive(false);
        if (!sub) renderHub();
        else if (Core.GAMES[sub]) renderGamePage(sub);
        else if (sub === 'solo' && Core.GAMES[arg]) startSolo(arg);
        else if (sub === 'join' && arg) joinCode(arg);
        else if (sub === 'daily') renderDaily();
        else if (sub === 'leaderboard') renderLeaderboard(arg);
        else renderHub();
    }

    /** The small "Play & Learn" card on Home (below the Bible/devotional content). */
    function homeCardHtml() {
        return '<div class="card mb-4 pl-home-card" onclick="navigateToHash(\'#/play\')"><div class="pl-home-icon"><i class="fas fa-gamepad"></i></div>' +
            '<div style="flex:1;"><h3>Play &amp; Learn</h3><p>Five Bible games and a Daily Challenge — every answer leads back to Scripture.</p></div><i class="fas fa-chevron-right" style="color: var(--text-slate);"></i></div>';
    }

    window.renderPlayPage = renderPlayPage;
    window.GamesUI = {
        go: go, joinTyped: joinTyped, showBadges: showBadges, showTour: function () { showTour(0); }, leaderboard: function (tab) { go('leaderboard', tab, true); },
        onNavigate: onNavigate, onSignedIn: onSignedIn, onSignedOut: onSignedOut, homeCardHtml: homeCardHtml,
        acceptInviteById: function (inviteId, code) { // from a notification tap
            var u = user();
            if (!u) return;
            database.ref('games/invites/' + u.uid + '/' + inviteId).once('value').then(function (s) {
                var inv = s.val();
                if (inv) acceptInvite(Object.assign({ id: inviteId }, inv)); else go('join', code);
            }, function () { go('join', code); });
        }
    };
})();
