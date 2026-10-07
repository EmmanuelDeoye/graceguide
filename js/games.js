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
    var Core = window.GamesCore, BANK = window.GAMES_BANK, Play = window.GamesPlay;
    var net = null;
    var live = { session: null, stage: null, roomId: null, finished: false, results: null, award: null };
    var invites = { stop: null, cards: {} };
    var profileCache = null;
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
                notify: function (toUid, n) { if (typeof addNotification === 'function') addNotification(toUid, n); }
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
    /** Called by navigateTo() for every navigation. */
    function onNavigate(route) {
        if (route === 'play') { hidePill(); return; }
        if (!live.session) return;
        if (liveGameRunning()) {
            // Wandered off mid-game: keep the game ticking and offer a way back.
            if (live.stage) { live.stage.destroy(); live.stage = null; }
            live.session.onUpdate = function () { updatePill(); };
            showPill();
        } else closeLive(!live.finished); // lobby or solo: just leave it
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
            '<h3 class="pl-section">Games</h3><div class="pl-games">' + Core.GAME_IDS.map(function (id) {
                var g = Core.GAMES[id];
                return '<button class="pl-game pl-game-card-' + id + '" onclick="GamesUI.go(\'' + id + '\')"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span>' +
                    '<span class="pl-game-name">' + esc(g.name) + '</span><span class="pl-game-tag">' + esc(g.tagline) + '</span></button>';
            }).join('') + '</div>' +
            '<div class="pl-join"><input id="pl-code-input" class="form-input" maxlength="5" autocapitalize="characters" autocomplete="off" placeholder="Room code">' +
            '<button class="btn btn-primary" onclick="GamesUI.joinTyped()"><i class="fas fa-right-to-bracket"></i> Join</button></div>' +
            '<div class="pl-row-links"><button class="btn btn-outline btn-sm" onclick="GamesUI.go(\'leaderboard\')"><i class="fas fa-ranking-star"></i> Leaderboard</button>' +
            '<button class="btn btn-outline btn-sm" onclick="GamesUI.showBadges()"><i class="fas fa-award"></i> Badges</button></div>' +
            '<div id="pl-top-slot"></div>');
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
        n.leaderboard(5).then(function (rows) {
            var slot = $id('pl-top-slot');
            if (!slot || !rows.length) return;
            slot.innerHTML = '<h3 class="pl-section">Top players</h3><div class="card pl-board">' + boardRows(rows, u.uid) + '</div>';
        }).catch(function () {});
    }

    function boardRows(rows, myUid, valueOf) {
        return rows.map(function (r, i) {
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
            '<div class="pl-modes">' +
            mode('solo', 'fa-user', 'Solo', 'Practise at your own pace') +
            mode('quick', 'fa-bolt', 'Quick Match', '1v1 against whoever is online') +
            mode('duel', 'fa-user-group', 'Challenge a Brethren', 'A private 1v1 — invite or share the code') +
            mode('room', 'fa-people-group', 'Create a Room', 'Up to 8 players with a room code') +
            '</div><p class="pl-foot">Every answer comes with its Scripture — read it after you play.</p>');
        DOM.pageContainer.querySelectorAll('[data-mode]').forEach(function (b) {
            b.onclick = function () { startMode(id, b.getAttribute('data-mode')); };
        });
    }
    function mode(key, icon, title, sub) {
        return '<button class="pl-mode" data-mode="' + key + '"><span class="pl-mode-icon"><i class="fas ' + icon + '"></i></span><span><strong>' + title + '</strong><small>' + sub + '</small></span><i class="fas fa-chevron-right"></i></button>';
    }
    function startMode(game, how) {
        if (how === 'solo') { go('solo', game); return; }
        if (!requireAuth('Sign in to play with others.', function () { startMode(game, how); })) return;
        var n = getNet();
        loading(how === 'quick' ? 'Looking for an opponent…' : 'Setting up your room…');
        var p = how === 'quick' ? n.quickMatch(game) : n.createRoom(game, how === 'duel' ? 'duel' : 'room', false);
        p.then(function (r) { go('room', r.roomId, true); }, function (err) { showToast(errorText(err), 'error'); go(game, null, true); });
    }

    // ---------- rooms: lobby → game → results ----------

    function openRoom(roomId) {
        if (!requireAuth('Sign in to join this game.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to join this game.</p></div>'); return; }
        if (live.session && live.roomId === roomId && !live.session.solo) { attachRoom(); return; } // coming back via the pill
        closeLive(true);
        loading('Joining…');
        var n = getNet(), ticket = ++openTicket;
        n.joinRoom(roomId).then(function () { return n.openRoom(roomId); }).then(function (session) {
            if (ticket !== openTicket || AppState.currentRoute !== 'play' || !AppState.playRoute || AppState.playRoute.arg !== roomId) { session.close(); return; }
            live.session = session; live.roomId = roomId;
            attachRoom();
        }).catch(function (err) { roomError(err); });
    }
    function roomError(err) {
        var msg = { 'not-found': 'That room no longer exists.', started: 'That game has already started.', full: 'That room is full.', left: 'You left this game.' }[err && err.code] || errorText(err);
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
            if (view.phase === 'lobby') { if (live.stage) { live.stage.destroy(); live.stage = null; } renderLobby(box, view); lastPhase = 'lobby'; return; }
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
        var key = 'lobby:' + seated.map(function (u) { return u + (view.room.players[u].online === false ? '-' : '+'); }).join(',') + ':' + view.canStart;
        if (box.getAttribute('data-key') === key) return;
        box.setAttribute('data-key', key);
        var searching = meta.public && seated.length < 2;
        box.innerHTML =
            '<div class="pl-hero pl-game-card-' + meta.game + '"><span class="pl-game-icon"><i class="fas ' + g.icon + '"></i></span><h2>' + esc(g.name) + '</h2>' +
            '<p>' + (meta.kind === 'duel' ? '1v1' : 'Room · up to ' + max + ' players') + '</p></div>' +
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
            (meta.public ? '' : (view.canStart ? '<button class="btn btn-primary btn-block pl-start" id="pl-start"><i class="fas fa-play"></i> Start game</button>'
                : '<p class="pl-waiting">' + (seated.length < 2 ? 'Waiting for at least one more player…' : 'Waiting for the host to start…') + '</p>')) +
            '<button class="btn btn-outline btn-block pl-leave" id="pl-leave-lobby">Leave</button>';
        var link = playUrl('join/' + meta.code);
        var text = 'Join my ' + g.name + ' game on GraceGuide! 🎮📖\nRoom code: ' + meta.code;
        if ($id('pl-copy-code')) $id('pl-copy-code').onclick = function () {
            (navigator.clipboard ? navigator.clipboard.writeText(meta.code) : Promise.reject()).then(function () { showToast('Code copied', 'success'); }, function () { showToast('Your code is ' + meta.code, 'info'); });
        };
        if ($id('pl-share-room')) $id('pl-share-room').onclick = function () { share(text, link); };
        $id('pl-invite').onclick = function () { showInviteSheet({ roomId: live.roomId, code: meta.code, game: meta.game, kind: meta.kind }); };
        if ($id('pl-start')) $id('pl-start').onclick = function () { $id('pl-start').disabled = true; s.start(); };
        $id('pl-leave-lobby').onclick = function () { closeLive(true); go(null, null, true); };
    }

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
        if (!mine || awardedBefore(live.roomId)) { live.award = { already: true }; renderResults(box, s, res, live.award); return; }
        renderResults(box, s, res, null);
        markAwarded(live.roomId);
        getNet().award({ game: s.game, units: mine.units, totalUnits: res.totalUnits, win: mine.win, multiplayer: res.players >= 2, day: today(), minGuesses: mine.minGuesses, score: mine.score, roomId: live.roomId })
            .then(function (a) { live.award = a; profileCache = a.profile; if ($id('pl-results') && live.session === s) renderResults(box, s, res, a); })
            .catch(function () {});
    }
    function offerRematch(newRoomId) {
        var btn = $id('pl-rematch');
        if (btn) { btn.innerHTML = '<i class="fas fa-rotate-right"></i> Join the rematch'; btn.classList.add('pl-pulse'); btn.setAttribute('data-room', newRoomId); }
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
            var q = Core.questionById(BANK, s.game, id);
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
            var target = btn.getAttribute('data-room');
            (target ? getNet().joinRoom(target).then(function () { return target; }) : s.rematch()).then(function (id) {
                closeLive(false); go('room', id, true);
            }, function (err) { btn.disabled = false; live.followed = false; showToast(errorText(err), 'error'); });
        };
    }
    function ordinal(n) { return n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'); }

    // ---------- solo ----------

    function startSolo(game) {
        closeLive(true);
        var u = user(), cfg = Core.GAMES[game], n = getNet();
        var q = Core.pickQuestions(BANK, game, cfg.rounds, n.recentQuestions(game));
        n.rememberQuestions(game, q);
        var s = new Play.LocalSession(game, u ? u.uid : 'guest', u ? u.name : 'You', q);
        live.session = s;
        page('<div id="pl-room"><div id="pl-stage-box"></div></div>');
        var box = $id('pl-room'), runRef = null;
        // With the game server deployed, a solo run is recorded so the server can verify it.
        if (u) n.serverAlive().then(function (alive) { return alive ? n.startRun(game, q) : null; }).then(function (ref) { runRef = ref; }).catch(function () {});
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
                .then(function (a) { live.award = a; profileCache = a.profile; if ($id('pl-results') && live.session === s) renderResults(box, s, res, a); })
                .catch(function () { if ($id('pl-results') && live.session === s) renderResults(box, s, res, { pending: true }); });
        };
        s.open();
    }

    // ---------- daily challenge ----------

    function renderDaily() {
        if (!requireAuth('Sign in to take the Daily Challenge.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to take the Daily Challenge.</p></div>'); return; }
        closeLive(true);
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

    function renderLeaderboard(tab) {
        if (!requireAuth('Sign in to see the leaderboard.')) { page('<div class="pl-stage pl-center"><p class="pl-waiting">Sign in to see the leaderboard.</p></div>'); return; }
        closeLive(true);
        tab = tab || 'global';
        var u = user(), n = getNet();
        page('<h2 class="pl-title">Leaderboard</h2><div class="pl-tabs">' +
            ['global', 'brethren', 'today'].map(function (t) {
                return '<button class="pl-tab' + (t === tab ? ' pl-tab-on' : '') + '" onclick="GamesUI.leaderboard(\'' + t + '\')">' + { global: 'Everyone', brethren: 'Brethren', today: 'Today’s challenge' }[t] + '</button>';
            }).join('') + '</div><div class="card pl-board" id="pl-board"><div class="pl-spinner"></div></div>');
        var load;
        if (tab === 'today') load = n.dailyBoard(today()).then(function (rows) { return { rows: rows, value: function (r) { return r.score + ' pts'; }, empty: 'Nobody has finished today’s challenge yet.' }; });
        else if (tab === 'brethren') {
            var uids = [u.uid];
            if (AppState.userConnections) AppState.userConnections.forEach(function (status, uid) { if (status === 'brethren') uids.push(uid); });
            load = n.profilesOf(uids).then(function (rows) { return { rows: rows, empty: 'Play a game and invite your Brethren to see them here.' }; });
        } else load = n.leaderboard(50).then(function (rows) { return { rows: rows, empty: 'No scores yet — be the first!' }; });
        load.then(function (r) {
            var b = $id('pl-board');
            if (b) b.innerHTML = r.rows.length ? boardRows(r.rows, u.uid, r.value) : '<p class="pl-waiting">' + r.empty + '</p>';
        }).catch(function () { var b = $id('pl-board'); if (b) b.innerHTML = '<p class="pl-waiting">Couldn’t load the leaderboard.</p>'; });
    }

    function showBadges() {
        var earned = (profileCache && profileCache.badges) || {};
        showSheet('<h3 style="margin-bottom:4px;">Badges</h3><p class="text-muted" style="margin-bottom:16px;">' + Object.keys(earned).length + ' of ' + Core.BADGES.length + ' earned</p><div class="pl-badges">' +
            Core.BADGES.map(function (b) {
                return '<div class="pl-badge' + (earned[b.id] ? ' pl-badge-on' : '') + '"><span class="pl-badge-icon"><i class="fas ' + b.icon + '"></i></span>' +
                    '<strong>' + esc(b.name) + '</strong><small>' + esc(b.desc) + '</small><em>' + esc(b.ref) + '</em></div>';
            }).join('') + '</div>');
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
            n.respondInvite(invite.id, 'accepted').catch(function () {});
            if (live.session) closeLive(true);
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
        if (sub === 'room' && arg) { openRoom(arg); return; }
        // One game at a time: starting something else would abandon the others mid-game.
        if (liveGameRunning() && (sub === 'solo' || sub === 'daily' || sub === 'join')) {
            showToast('Finish your current game first.', 'info');
            go('room', live.roomId, true);
            return;
        }
        // Any other Play page: a live game keeps running behind the "return" pill.
        if (liveGameRunning()) { if (live.stage) { live.stage.destroy(); live.stage = null; } live.session.onUpdate = function () { updatePill(); }; showPill(); }
        else if (sub !== 'solo' && sub !== 'daily') closeLive(!live.finished);
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
        go: go, joinTyped: joinTyped, showBadges: showBadges, leaderboard: function (tab) { go('leaderboard', tab, true); },
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
