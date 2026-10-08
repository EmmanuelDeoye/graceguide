/* ============================================
   GraceGuide — js/games-net.js
   Play & Learn: the multiplayer service (Firebase Realtime Database).

   No DOM in here — js/games.js renders, this file talks to the database:
   rooms, room codes, quick match, presence, reconnect, answers, invites,
   XP awards and leaderboards. All game rules come from js/games-core.js;
   this layer only moves the data described in
   graceguide-games-tests/DESIGN.md.

   Everything is created through GamesNet.create({ ... }) so the same code
   runs in the browser and, headlessly, in the multi-client test suite.
   ============================================ */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.GamesNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var SERVER_FRESH_MS = 72 * 3600000;
    var QUEUE_FRESH_MS = 30000;
    var INVITE_TTL_MS = 120000;
    var KEEP_MS = 3 * 24 * 3600000; // rooms, their codes and their results are kept for three days
    var CODE_TTL_MS = KEEP_MS;

    function GameError(code, message) {
        var e = new Error(message || code);
        e.code = code;
        return e;
    }

    /**
     * opts: {
     *   db            firebase.database() (compat API)
     *   ServerValue   firebase.database.ServerValue
     *   core, bank    GamesCore, GAMES_BANK
     *   user()        -> { uid, name } | null   (current signed-in user)
     *   storage       { get(key), set(key, value) }  small persistent key/value store
     *   notify(toUid, notification)   optional: adds an entry to a user's inbox (push pipeline)
     * }
     */
    function create(opts) {
        var db = opts.db, TS = opts.ServerValue.TIMESTAMP, core = opts.core, bank = opts.bank;
        var storage = opts.storage || { get: function () { return null; }, set: function () {} };
        var offset = 0;
        var offsetRef = db.ref('.info/serverTimeOffset');
        // The whole game runs on the server's clock. Until the offset to it is known, a device
        // whose own clock is wrong would see the game in the wrong place (and could hand in
        // "no answer" for rounds that have not happened) — so sessions wait for clockReady.
        var clockKnown = false, clockWaiters = [];
        offsetRef.on('value', function (s) {
            offset = s.val() || 0;
            clockKnown = true;
            clockWaiters.splice(0).forEach(function (fn) { fn(); });
        });
        function clockReady() {
            if (clockKnown) return Promise.resolve();
            return new Promise(function (resolve) { clockWaiters.push(resolve); setTimeout(resolve, 5000); });
        }

        function now() { return Date.now() + offset; }
        function me() {
            var u = opts.user && opts.user();
            if (!u || !u.uid) throw GameError('signed-out', 'Sign in to play with others.');
            return { uid: u.uid, name: core.cleanName(u.name) };
        }
        function roomRef(id) { return db.ref('games/rooms/' + id); }
        function val(ref) { return ref.once('value').then(function (s) { return s.val(); }); }
        function readJson(key, fallback) {
            try { var v = JSON.parse(storage.get(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
        }
        function writeJson(key, value) { try { storage.set(key, JSON.stringify(value)); } catch (e) { /* storage full / private mode */ } }

        // ---------- question memory (so games don't repeat recent questions) ----------
        function recentQuestions(game) { return readJson('gg_games_seen_' + game, []); }
        function rememberQuestions(game, ids) {
            var keep = Math.max(0, ((bank[game] || []).length) - core.GAMES[game].rounds * 2);
            writeJson('gg_games_seen_' + game, recentQuestions(game).concat(ids).slice(-keep || -1).slice(-200));
        }

        // ---------- rooms ----------
        function trackRoom(id) {
            var mine = readJson('gg_games_rooms', []).filter(function (r) { return now() - r.t < 6 * 3600000; });
            mine.push({ id: id, t: now() });
            writeJson('gg_games_rooms', mine.slice(-20));
        }
        /** Best-effort removal of rooms this device hosted more than three days ago. */
        function sweepMyOldRooms() {
            var list = readJson('gg_games_rooms', []), keep = [];
            list.forEach(function (r) {
                if (now() - r.t < KEEP_MS) { keep.push(r); return; }
                roomRef(r.id).remove().catch(function () {});
            });
            writeJson('gg_games_rooms', keep);
        }

        // ---------- "my games": rooms I created or joined, kept for three days ----------
        function remember(roomId, meta) {
            var u = me();
            var entry = { game: meta.game, t: now() };
            if (meta.code) entry.code = meta.code;
            if (meta.kind) entry.kind = meta.kind;
            db.ref('games/mine/' + u.uid + '/' + roomId).set(entry).catch(function () {});
        }
        function forget(roomId) {
            try { db.ref('games/mine/' + me().uid + '/' + roomId).remove().catch(function () {}); } catch (e) { /* signed out */ }
        }
        /** My rooms from the last three days, newest first: [{ roomId, game, kind, code, t }]. Older ones are dropped. */
        function myGames() {
            var u = me();
            return val(db.ref('games/mine/' + u.uid)).then(function (all) {
                var out = [];
                Object.keys(all || {}).forEach(function (roomId) {
                    var e = all[roomId] || {};
                    if (now() - (e.t || 0) > KEEP_MS) { forget(roomId); return; }
                    out.push({ roomId: roomId, game: e.game, kind: e.kind || 'room', code: e.code || '', t: e.t || 0 });
                });
                return out.sort(function (a, b) { return b.t - a.t; });
            });
        }
        /** Host only: cancels a room for everyone (a lobby at any time; a game once it is over). */
        function cancelRoom(roomId) {
            return val(roomRef(roomId).child('meta/code')).then(function (code) {
                return roomRef(roomId).remove().then(function () {
                    if (code) db.ref('games/codes/' + code).remove().catch(function () {});
                    forget(roomId);
                });
            });
        }

        function reserveCode(roomId, uid, attempt) {
            var code = core.makeCode();
            return db.ref('games/codes/' + code).set({ room: roomId, uid: uid, t: TS }).then(function () { return code; }, function (err) {
                if ((attempt || 0) >= 6) throw err;
                return reserveCode(roomId, uid, (attempt || 0) + 1); // code in use → try another
            });
        }

        /** Creates a lobby and seats me in it. kind: 'duel' (2 players) | 'room' (up to 8). */
        function createRoom(game, kind, isPublic, level) {
            var u = me();
            if (!core.GAMES[game]) return Promise.reject(GameError('bad-game'));
            sweepMyOldRooms();
            var ref = db.ref('games/rooms').push(), id = ref.key;
            return reserveCode(id, u.uid).then(function (code) {
                var update = {};
                update.meta = { game: game, kind: kind === 'duel' ? 'duel' : 'room', hostUid: u.uid, code: code, createdAt: TS, public: !!isPublic };
                if (level === 'easy' || level === 'medium' || level === 'hard') update.meta.level = level;
                update['players/' + u.uid] = { name: u.name, joinedAt: TS, online: true };
                return ref.update(update).then(function () {
                    trackRoom(id);
                    remember(id, update.meta);
                    return { roomId: id, code: code, game: game, kind: update.meta.kind };
                });
            });
        }

        /** Seats me in an existing lobby. Rejects with code: not-found | started | full. */
        function joinRoom(roomId) {
            var u = me(), ref = roomRef(roomId);
            return Promise.all([val(ref.child('meta')), val(ref.child('plan')), val(ref.child('players'))]).then(function (r) {
                var meta = r[0], plan = r[1], players = r[2] || {};
                if (!meta) throw GameError('not-found', 'That room no longer exists.');
                if (players[u.uid]) { // already seated (rejoin / reload)
                    if (typeof players[u.uid].leftAt === 'number') throw GameError('left', 'You already left this game.');
                    return { roomId: roomId, meta: meta, rejoined: true };
                }
                if (plan) throw GameError('started', 'That game has already started.');
                var max = core.MAX_PLAYERS[meta.kind] || core.MAX_PLAYERS.room;
                if (core.seatedPlayers(players, meta.kind).length >= max) throw GameError('full', 'That room is full.');
                return ref.child('players/' + u.uid).set({ name: u.name, joinedAt: TS, online: true }).then(function () {
                    return val(ref.child('players'));
                }).then(function (after) {
                    // Two people can take the last seat at once: the server's join order decides.
                    if (core.seatedPlayers(after || {}, meta.kind).indexOf(u.uid) < 0) {
                        return ref.child('players/' + u.uid).remove().catch(function () {}).then(function () {
                            throw GameError('full', 'That room is full.');
                        });
                    }
                    remember(roomId, meta);
                    return { roomId: roomId, meta: meta, rejoined: false };
                });
            });
        }

        function joinByCode(input) {
            var code = core.parseCode(input);
            if (!code) return Promise.reject(GameError('bad-code', 'Room codes are 5 letters and numbers.'));
            me();
            return val(db.ref('games/codes/' + code)).then(function (entry) {
                if (!entry || !entry.room || now() - (entry.t || 0) > CODE_TTL_MS) throw GameError('not-found', 'No room found for that code.');
                return joinRoom(entry.room);
            });
        }

        /** Leaves a room: removes my seat in a lobby; records a final "left" stamp mid-game. */
        function leaveRoom(roomId) {
            var u;
            try { u = me(); } catch (e) { return Promise.resolve(); }
            var ref = roomRef(roomId);
            return Promise.all([val(ref.child('meta')), val(ref.child('plan')), val(ref.child('players'))]).then(function (r) {
                var meta = r[0], plan = r[1], players = r[2] || {};
                if (!meta || !players[u.uid]) return null;
                ref.child('players/' + u.uid + '/online').onDisconnect().cancel();
                if (plan) {
                    if (typeof players[u.uid].leftAt === 'number') return null;
                    return ref.child('players/' + u.uid).update({ leftAt: TS, online: false });
                }
                var alone = Object.keys(players).length <= 1;
                forget(roomId);
                if (meta.hostUid === u.uid && alone) {
                    db.ref('games/codes/' + meta.code).remove().catch(function () {});
                    return ref.remove();
                }
                return ref.child('players/' + u.uid).remove();
            }).catch(function () { return null; });
        }

        // ---------- quick match ----------
        var waiting = null; // { game, roomId, timer }

        function stopWaiting(removeEntry) {
            if (!waiting) return;
            clearInterval(waiting.timer);
            var w = waiting;
            waiting = null;
            if (removeEntry !== false) {
                var ref = db.ref('games/match/' + w.game + '/' + w.uid);
                ref.onDisconnect().cancel();
                ref.remove().catch(function () {});
            }
        }

        /**
         * Finds someone waiting for this game and takes the seat (first claim wins), otherwise
         * opens a public 1v1 room and waits. Resolves { roomId, role: 'guest' | 'host' }.
         */
        function quickMatch(game, level) {
            var u = me(), q = db.ref('games/match/' + game);
            stopWaiting();
            return val(q).then(function (all) {
                var entries = Object.keys(all || {}).map(function (host) { return { host: host, e: all[host] }; })
                    .filter(function (x) { return x.host !== u.uid && x.e && !x.e.takenBy && now() - (x.e.t || 0) < QUEUE_FRESH_MS; })
                    .sort(function (a, b) { return a.e.t - b.e.t; });
                function tryNext(i) {
                    if (i >= entries.length) return null;
                    var x = entries[i];
                    return q.child(x.host + '/takenBy').transaction(function (cur) { return cur ? undefined : u.uid; }).then(function (res) {
                        if (!res.committed || res.snapshot.val() !== u.uid) return tryNext(i + 1);
                        return joinRoom(x.e.room).then(function () { return { roomId: x.e.room, role: 'guest' }; }, function () { return tryNext(i + 1); });
                    }, function () { return tryNext(i + 1); });
                }
                return tryNext(0);
            }).then(function (found) {
                if (found) return found;
                return createRoom(game, 'duel', true, level).then(function (room) {
                    var entry = q.child(u.uid);
                    entry.onDisconnect().remove();
                    var put = function () { return entry.set({ room: room.roomId, name: u.name, t: TS }); };
                    return put().then(function () {
                        waiting = { game: game, uid: u.uid, roomId: room.roomId, timer: setInterval(function () {
                            // Keep the entry fresh while waiting; stop once someone has claimed it.
                            val(entry.child('takenBy')).then(function (t) { if (waiting && !t) put().catch(function () {}); });
                        }, 10000) };
                        return { roomId: room.roomId, role: 'host' };
                    });
                });
            });
        }

        // ---------- profile / XP ----------
        function serverAlive() {
            return val(db.ref('games/server/seen')).then(function (seen) {
                return typeof seen === 'number' && now() - seen < SERVER_FRESH_MS;
            }, function () { return false; });
        }
        function loadProfile(uid) { return val(db.ref('games/profiles/' + uid)); }

        function writeOwnProfile(result, attempt) {
            var u = me(), ref = db.ref('games/profiles/' + u.uid);
            return val(ref).then(function (current) {
                var applied = core.applyResult(current, Object.assign({}, result, { name: u.name }), now());
                var data = Object.assign({}, applied.profile, { updatedAt: TS });
                return ref.set(data).then(function () {
                    return { mode: 'client', gained: applied.gained, newBadges: applied.newBadges, profile: applied.profile };
                }, function (err) {
                    // A database still on the rules from before badge XP refuses the newer fields:
                    // save the game without them rather than lose the XP.
                    if (!attempt) {
                        var plain = Object.assign({}, data);
                        delete plain.perfect; delete plain.claims; delete plain.claimed;
                        return ref.set(plain).then(function () {
                            var kept = Object.assign({}, applied.profile, { perfect: 0, claims: 0, claimed: {} });
                            return { mode: 'client', gained: applied.gained, newBadges: applied.newBadges, profile: kept };
                        }, function () {
                            return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return writeOwnProfile(result, 1); });
                        });
                    }
                    // Two games finishing within the cooldown, or the clock ticking over midnight UTC.
                    if ((attempt || 0) < 2) return new Promise(function (res) { setTimeout(res, attempt ? 9000 : 1200); }).then(function () { return writeOwnProfile(result, (attempt || 0) + 1); });
                    throw err;
                });
            });
        }

        /** Waits (up to `ms`) for a database value to satisfy `test`. Resolves the value or null. */
        function waitFor(ref, test, ms) {
            return new Promise(function (resolve) {
                var done = false;
                var handler = ref.on('value', function (s) {
                    if (done || !test(s.val())) return;
                    done = true; ref.off('value', handler); clearTimeout(timer); resolve(s.val());
                }, function () { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
                var timer = setTimeout(function () { if (!done) { done = true; ref.off('value', handler); resolve(null); } }, ms);
            });
        }

        /**
         * Records a finished game and returns what it earned:
         *   { mode: 'server' | 'client', gained, newBadges, profile }
         * Server mode: write a claim / run and let the Cloud Function referee award it.
         * Otherwise (no game server deployed): update my own profile inside the rule limits.
         */
        function award(result) {
            var u = me();
            return Promise.all([serverAlive(), loadProfile(u.uid)]).then(function (r) {
                var before = r[1] || {};
                if (!r[0]) return writeOwnProfile(result);
                var trigger;
                if (result.roomId) trigger = roomRef(result.roomId).child('claims/' + u.uid).set({ t: TS, day: result.day });
                else if (result.runRef) trigger = result.runRef.update({ a: result.runAnswers, e: TS, day: result.day });
                else if (result.daily) trigger = Promise.resolve(); // finishing the daily run already told the server
                else return writeOwnProfile(result); // nothing the server could verify
                return trigger.catch(function () { return null; }).then(function () {
                    return waitFor(db.ref('games/profiles/' + u.uid), function (p) { return p && (p.played || 0) > (before.played || 0); }, 9000);
                }).then(function (after) {
                    if (!after) return { mode: 'server', pending: true, gained: 0, newBadges: [], profile: before };
                    var fresh = Object.keys(after.badges || {}).filter(function (id) { return !(before.badges || {})[id]; });
                    return { mode: 'server', gained: (after.xp || 0) - (before.xp || 0), newBadges: fresh, profile: after };
                });
            });
        }

        /**
         * Claims the bonus XP of a badge I have earned. Resolves { gained, profile } (gained 0 if it
         * was already claimed). With the referee deployed the server adds the XP; otherwise my own
         * profile is updated inside the rule limits (one claim per write, never twice per badge).
         */
        function claimBadge(badgeId, attempt) {
            var u = me(), ref = db.ref('games/profiles/' + u.uid);
            return Promise.all([serverAlive(), val(ref)]).then(function (r) {
                var current = r[1];
                if (!current || (current.claimed || {})[badgeId]) return { gained: 0, profile: current };
                if (r[0]) {
                    return db.ref('games/badgeClaims/' + u.uid + '/' + badgeId).set(TS).catch(function () { return null; }).then(function () {
                        return waitFor(ref, function (p) { return p && (p.claimed || {})[badgeId]; }, 9000);
                    }).then(function (after) {
                        return after ? { gained: (after.xp || 0) - (current.xp || 0), profile: after } : { gained: 0, profile: current, pending: true };
                    });
                }
                var claimed = core.claimBadge(current, badgeId, now());
                if (!claimed) return { gained: 0, profile: current };
                return ref.set(Object.assign({}, claimed.profile, { updatedAt: TS })).then(function () { return claimed; }, function (err) {
                    if ((attempt || 0) < 1) return new Promise(function (res) { setTimeout(res, 1200); }).then(function () { return claimBadge(badgeId, 1); });
                    throw err;
                });
            });
        }

        /** Top players by XP, highest first. */
        function leaderboard(limit) {
            return db.ref('games/profiles').orderByChild('xp').limitToLast(limit || 50).once('value').then(function (snap) {
                var rows = [];
                snap.forEach(function (c) { var p = c.val() || {}; rows.push({ uid: c.key, name: core.cleanName(p.name), xp: p.xp || 0, wins: p.wins || 0, played: p.played || 0, streak: p.streak || 0 }); });
                return rows.sort(function (a, b) { return (b.xp - a.xp) || (a.uid < b.uid ? -1 : 1); });
            });
        }
        /** The same list, live: `onRows` is called again whenever anyone's XP changes. Returns "stop". */
        function watchLeaderboard(limit, onRows) {
            var q = db.ref('games/profiles').orderByChild('xp').limitToLast(limit || 50);
            var h = q.on('value', function (snap) {
                var rows = [];
                snap.forEach(function (c) { var p = c.val() || {}; rows.push({ uid: c.key, name: core.cleanName(p.name), xp: p.xp || 0, wins: p.wins || 0, played: p.played || 0, streak: p.streak || 0 }); });
                onRows(rows.sort(function (a, b) { return (b.xp - a.xp) || (a.uid < b.uid ? -1 : 1); }));
            }, function () { onRows(null); });
            return function () { q.off('value', h); };
        }
        /** Today's Daily Challenge board, live. Returns "stop". */
        function watchDailyBoard(day, onRows) {
            var ref = db.ref('games/daily/' + day);
            var h = ref.on('value', function (snap) {
                var all = snap.val() || {};
                onRows(Object.keys(all).map(function (uid) {
                    var s = core.scoreDaily(bank, day, all[uid]);
                    return { uid: uid, name: core.cleanName(all[uid].name), score: s.score, correct: s.correct, elapsed: s.elapsed, finished: s.finished };
                }).filter(function (r) { return r.finished; }).sort(function (a, b) { return (b.score - a.score) || (a.elapsed - b.elapsed); }));
            }, function () { onRows(null); });
            return function () { ref.off('value', h); };
        }
        function profilesOf(uids) {
            return Promise.all(uids.map(function (uid) {
                return loadProfile(uid).then(function (p) { return p ? { uid: uid, name: core.cleanName(p.name), xp: p.xp || 0, wins: p.wins || 0, played: p.played || 0, streak: p.streak || 0 } : null; }, function () { return null; });
            })).then(function (rows) { return rows.filter(Boolean).sort(function (a, b) { return b.xp - a.xp; }); });
        }

        // ---------- daily challenge ----------
        function dailyRef(day, uid) { return db.ref('games/daily/' + day + '/' + uid); }
        function dailyStatus(day) { var u = me(); return val(dailyRef(day, u.uid)); }
        function dailyStart(day) { var u = me(); return dailyRef(day, u.uid).set({ name: u.name, s: TS }); }
        function dailyFinish(day, answers) { var u = me(); return dailyRef(day, u.uid).update({ a: answers, e: TS }).then(function () { return val(dailyRef(day, u.uid)); }); }
        function dailyBoard(day) {
            return val(db.ref('games/daily/' + day)).then(function (all) {
                return Object.keys(all || {}).map(function (uid) {
                    var s = core.scoreDaily(bank, day, all[uid]);
                    return { uid: uid, name: core.cleanName(all[uid].name), score: s.score, correct: s.correct, elapsed: s.elapsed, finished: s.finished };
                }).filter(function (r) { return r.finished; }).sort(function (a, b) { return (b.score - a.score) || (a.elapsed - b.elapsed); });
            });
        }

        // ---------- solo runs (only needed for the game server to verify) ----------
        function startRun(game, questionIds, custom) {
            var u = me(), ref = db.ref('games/runs/' + u.uid).push();
            var run = { game: game, q: questionIds, s: TS };
            if (custom) run.qs = custom; // AI-written questions, so the server can score them too
            return ref.set(run).then(function () { return ref; });
        }

        // ---------- invites ----------
        function sendInvite(toUid, room) {
            var u = me(), ref = db.ref('games/invites/' + toUid).push();
            var exp = now() + INVITE_TTL_MS - 5000; // rules compare against the server stamp
            var invite = { from: u.uid, fromName: u.name, game: room.game, kind: room.kind, room: room.roomId, code: room.code, t: TS, exp: exp };
            return ref.set(invite).then(function () {
                if (opts.notify) {
                    opts.notify(toUid, {
                        type: 'game_invite', fromUid: u.uid, fromName: u.name, inviteId: ref.key, game: room.game, code: room.code, expiresAt: exp,
                        route: 'play/join/' + room.code,
                        title: 'Game invite',
                        message: u.name + ' challenged you to ' + core.GAMES[room.game].name + '!'
                    });
                }
                return { id: ref.key, toUid: toUid, exp: exp };
            });
        }
        function respondInvite(id, status) { var u = me(); return db.ref('games/invites/' + u.uid + '/' + id + '/status').set(status); }
        function dismissInvite(id) { var u = me(); return db.ref('games/invites/' + u.uid + '/' + id).remove().catch(function () {}); }
        function cancelInvite(toUid, id) { return db.ref('games/invites/' + toUid + '/' + id).remove().catch(function () {}); }
        /** An invite can still be accepted if it hasn't expired, wasn't answered, and its room is still a lobby. */
        function inviteLive(invite) {
            if (!invite || invite.status || now() >= invite.exp) return Promise.resolve(false);
            return Promise.all([val(roomRef(invite.room).child('meta')), val(roomRef(invite.room).child('plan'))]).then(function (r) { return !!r[0] && !r[1]; }, function () { return false; });
        }
        /** Calls back with each pending invite once (fresh ones only) and when one goes away. */
        function watchInvites(onInvite, onGone) {
            var u = me(), ref = db.ref('games/invites/' + u.uid), seen = {};
            var added = ref.on('child_added', function (s) {
                var inv = s.val();
                if (!inv || seen[s.key]) return;
                seen[s.key] = true;
                if (inv.status || now() >= inv.exp) { if (now() >= (inv.exp || 0) + 3600000) s.ref.remove().catch(function () {}); return; }
                onInvite(Object.assign({ id: s.key }, inv));
            }, function () {});
            var changed = ref.on('child_changed', function (s) { var inv = s.val(); if (inv && inv.status && onGone) onGone(s.key, inv.status); }, function () {});
            var removed = ref.on('child_removed', function (s) { if (onGone) onGone(s.key, 'cancelled'); }, function () {});
            return function () { ref.off('child_added', added); ref.off('child_changed', changed); ref.off('child_removed', removed); };
        }
        function watchInviteReply(toUid, id, onReply) {
            var ref = db.ref('games/invites/' + toUid + '/' + id + '/status');
            var h = ref.on('value', function (s) { if (s.val()) onReply(s.val()); }, function () {});
            return function () { ref.off('value', h); };
        }

        // ---------- a live room ----------

        /**
         * Keeps one room in sync and drives it from the server clock.
         *   session.open() → resolves once the room is loaded
         *   session.onUpdate = function (view) {…}   called on every change and tick
         *   session.submit(answer), session.progress(n), session.start(), session.rematch()
         *   session.results()  → final scores (after phase 'done' and all answers are loaded)
         */
        function RoomSession(roomId) {
            this.roomId = roomId;
            this.room = { meta: null, players: {}, plan: null, answered: {}, answers: {}, official: null, rematch: null };
            this.onUpdate = null;
            this._mine = {};        // round -> answer I submitted (optimistic)
            this._watching = {};    // round -> 'pending' | 'on'
            this._probed = {};      // round -> asked the server whether I already answered it
            this._subs = [];
            this._starting = false;
            this._closed = false;
            this._view = null;
        }

        RoomSession.prototype.open = function () {
            var self = this, u = me(), ref = roomRef(this.roomId);
            return val(ref.child('meta')).then(function (meta) {
                if (!meta) throw GameError('not-found', 'That room no longer exists.');
                self.room.meta = meta;
                self.game = meta.game;
                self.uid = u.uid;
                function listen(path, key, fallback) {
                    var r = ref.child(path);
                    var h = r.on('value', function (s) { self.room[key] = s.val() == null ? fallback : s.val(); self._tick(); }, function () {});
                    self._subs.push(function () { r.off('value', h); });
                }
                listen('players', 'players', {});
                listen('plan', 'plan', null);
                listen('answered', 'answered', {});
                listen('official', 'official', null);
                listen('rematch', 'rematch', null);

                // Presence: (re)assert "online" whenever the connection comes back.
                var conn = db.ref('.info/connected'), mineOnline = ref.child('players/' + u.uid + '/online');
                var ch = conn.on('value', function (s) {
                    if (s.val() !== true || self._closed) return;
                    mineOnline.onDisconnect().set(false).then(function () { if (!self._closed) mineOnline.set(true).catch(function () {}); }).catch(function () {});
                });
                self._subs.push(function () { conn.off('value', ch); mineOnline.onDisconnect().cancel().catch(function () {}); });

                // Load who is seated and whether the game has started BEFORE the first view, so a
                // player rejoining a running game never sees a flash of the lobby. The server clock
                // must be known too (see clockReady).
                return Promise.all([val(ref.child('players')), val(ref.child('plan')), clockReady()]).then(function (r) {
                    self.room.players = r[0] || {};
                    self.room.plan = r[1] || null;
                    self._ready = true;
                    self._timer = setInterval(function () { self._tick(); }, 250);
                    self._tick();
                    return self;
                });
            });
        };

        RoomSession.prototype.close = function () {
            this._closed = true;
            clearInterval(this._timer);
            this._subs.forEach(function (off) { try { off(); } catch (e) { /* already detached */ } });
            this._subs = [];
        };

        RoomSession.prototype.seated = function () { return core.seatedPlayers(this.room.players, this.room.meta.kind); };

        /** Who may press Start: the host, or — if the host is gone — the longest-seated online player. */
        RoomSession.prototype.canStart = function () {
            var room = this.room, seated = this.seated();
            if (room.plan || seated.length < 2 || seated.indexOf(this.uid) < 0) return false;
            if (room.meta.hostUid === this.uid) return true;
            var host = room.players[room.meta.hostUid];
            if (host && host.online === true) return false;
            var online = seated.filter(function (uid) { return room.players[uid].online === true; });
            return online[0] === this.uid;
        };

        /**
         * Starts the game. `custom` = { ids, qs } are verified AI-written questions (js/games-ai.js);
         * without them the built-in bank is used.
         */
        RoomSession.prototype.start = function (custom) {
            var self = this, cfg = core.GAMES[this.game];
            if (this._starting || this.room.plan) return Promise.resolve(false);
            this._starting = true;
            // However the game is started (button, quick match, rematch): fresh AI questions at the
            // room's level. opts.customQuestions may take a while (it waits for the questions to be
            // written and verified) and resolves null only when that has really failed.
            var ask = custom ? Promise.resolve(custom)
                : opts.customQuestions ? Promise.resolve().then(function () { return opts.customQuestions(self.game, self.room.meta.level); }).catch(function () { return null; })
                : Promise.resolve(null);
            return ask.then(function (custom) {
                if (self._closed || self.room.plan) { self._starting = false; return false; }
                var plan = { startedAt: TS, secs: cfg.secs, rounds: cfg.rounds };
                if (custom && custom.ids && custom.ids.length === cfg.rounds) { plan.q = custom.ids; plan.qs = custom.qs; }
                else plan.q = core.pickQuestions(bank, self.game, cfg.rounds, recentQuestions(self.game));
                return roomRef(self.roomId).child('plan').set(plan).then(function () {
                    if (waiting && waiting.roomId === self.roomId) stopWaiting();
                    return true;
                }, function () { self._starting = false; return false; }); // someone else started it first
            });
        };

        /** Makes round `r` readable (writing a pass if I never answered it) and listens to it. */
        RoomSession.prototype._watchRound = function (r, attempt, mayPass) {
            var self = this, ref = roomRef(this.roomId).child('answers/' + r);
            if (this._watching[r] || this._closed) return;
            this._watching[r] = 'pending';
            var mine = ref.child(this.uid);
            val(mine).then(function (existing) {
                if (existing) { if (self._mine[r] === undefined) self._mine[r] = existing.a; return null; }
                if (self._mine[r] !== undefined && self._mine[r] !== null) return null; // my answer is still on its way
                // "No answer" is only ever handed in for a round whose full time has run out on the
                // server clock. A round cannot end early without my answer, so anything else means
                // this device's idea of the time is off — wait rather than throw the round away.
                if (!mayPass) { self._watching[r] = null; return 'wait'; }
                self._mine[r] = -1;
                return mine.set({ a: core.GAMES[self.game].type === 'wordle' ? '' : -1, t: TS }).catch(function () {});
            }).then(function (state) {
                if (self._closed || state === 'wait') return;
                var h = ref.on('value', function (s) { self._watching[r] = 'on'; self.room.answers[r] = s.val() || {}; self._tick(); }, function () {
                    // Not readable yet (my own answer hasn't landed): try again shortly.
                    ref.off('value', h);
                    self._watching[r] = null;
                    if ((attempt || 0) < 8) setTimeout(function () { self._watchRound(r, (attempt || 0) + 1, true); }, 400);
                });
                self._subs.push(function () { ref.off('value', h); });
            }).catch(function () { self._watching[r] = null; });
        };

        /** Locks in my answer for the round on screen. Returns false if it is not answerable. */
        RoomSession.prototype.submit = function (answer) {
            var self = this, v = this._view;
            if (!v || v.phase !== 'question' || this._mine[v.round] !== undefined || this.seated().indexOf(this.uid) < 0) return Promise.resolve(false);
            var r = v.round, ref = roomRef(this.roomId);
            this._mine[r] = answer;
            this._tick();
            return ref.child('answers/' + r + '/' + this.uid).set({ a: answer, t: TS }).then(function () {
                if (core.GAMES[self.game].type !== 'wordle') ref.child('answered/' + r + '/' + self.uid).set(1).catch(function () {});
                self._watchRound(r, 0, true); // my answer is in: the round is now readable
                return true;
            }, function () {
                // Rejected (e.g. already answered from another tab): show what the server has instead.
                self._mine[r] = undefined;
                self._probed[r] = false;
                return false;
            });
        };

        /** Wordle: publish how many guesses I have used (no letters). */
        RoomSession.prototype.progress = function (count) {
            var v = this._view;
            if (!v || v.phase !== 'question') return;
            roomRef(this.roomId).child('answered/' + v.round + '/' + this.uid).set(Math.max(0, Math.min(9, count))).catch(function () {});
        };

        RoomSession.prototype.myAnswer = function (r) { return this._mine[r]; };

        RoomSession.prototype._tick = function () {
            if (this._closed || !this.room.meta || !this._ready) return;
            var room = this.room, view;
            if (!room.plan) {
                view = { phase: 'lobby', round: 0, msLeft: 0, syncing: false };
                // Quick-match rooms start themselves as soon as the second player sits down.
                if (room.meta.public && room.meta.hostUid === this.uid && this.seated().length >= 2) this.start();
            } else {
                var tl = core.timeline(this.game, room);
                view = core.phaseAt(tl, now());
                view.timeline = tl;
                // Rounds that are over (or that I've answered) become readable; needed for scores and reconnects.
                var upTo = view.phase === 'question' ? view.round - 1 : view.phase === 'countdown' ? -1 : view.round;
                var clock = now();
                for (var r = 0; r <= upTo; r++) this._watchRound(r, 0, clock >= tl.rounds[r].nominalEnd);
                if (view.phase === 'question' && this._mine[view.round] === undefined && !this._probed[view.round]) {
                    // After a reload mid-round: did I already answer this one (from here or another tab)?
                    this._probed[view.round] = 'pending';
                    var self = this, rr = view.round;
                    val(roomRef(this.roomId).child('answers/' + rr + '/' + this.uid)).then(function (a) {
                        if (a && self._mine[rr] === undefined) { self._mine[rr] = a.a; self._watchRound(rr, 0, true); }
                    }).catch(function () {}).then(function () { self._probed[rr] = 'done'; self._tick(); });
                }
                // Catching up after a (re)load: until earlier rounds' answers have arrived the
                // schedule above can only lag behind reality (unknown rounds count as full
                // length), so what it shows may be an old round. Report "syncing" until it settles.
                if (!this._synced) {
                    var settled = true;
                    for (var k = 0; k <= upTo; k++) if (this._watching[k] !== 'on') settled = false;
                    if (view.phase === 'question') {
                        // Not answered: wait until the server confirms that. Answered: the round may
                        // already be over, which only its answers can tell — wait for those.
                        if (this._mine[view.round] === undefined ? this._probed[view.round] !== 'done' : this._watching[view.round] !== 'on') settled = false;
                    }
                    if (settled) this._synced = true;
                }
                view.syncing = !this._synced;
                if (view.phase !== 'countdown' && !this._remembered) { this._remembered = true; rememberQuestions(this.game, room.plan.q || []); }
            }
            view.room = room;
            view.game = this.game;
            view.seated = this.seated();
            view.canStart = this.canStart();
            view.isHost = room.meta.hostUid === this.uid;
            this._view = view;
            if (this.onUpdate) this.onUpdate(view);
        };

        /** True once every round's answers have arrived, i.e. results() is final. */
        RoomSession.prototype.resultsReady = function () {
            if (!this.room.plan) return false;
            for (var r = 0; r < this.room.plan.rounds; r++) if (this._watching[r] !== 'on') return false;
            return true;
        };
        RoomSession.prototype.results = function (upToRound) { return core.scoreRoom(this.game, bank, this.room, upToRound); };

        /** First tap creates the next room; everyone else follows `rematch`. Resolves the new room id. */
        RoomSession.prototype.rematch = function () {
            var self = this, ref = roomRef(this.roomId).child('rematch');
            if (this.room.rematch) return joinRoom(this.room.rematch).then(function () { return self.room.rematch; });
            // A private room for the same people: it is not offered to anyone else, and the screen
            // that created it starts the game as soon as the others are back in (see games.js).
            return createRoom(this.game, this.room.meta.kind, false, this.room.meta.level).then(function (room) {
                return ref.set(room.roomId).then(function () { self.rematchHosted = true; return room.roomId; }, function () {
                    // Someone beat me to it: drop my spare room and join theirs.
                    return leaveRoom(room.roomId).then(function () { return val(ref); }).then(function (id) { return joinRoom(id).then(function () { return id; }); });
                });
            });
        };

        return {
            now: now, me: me, GameError: GameError,
            createRoom: createRoom, joinRoom: joinRoom, joinByCode: joinByCode, leaveRoom: leaveRoom,
            quickMatch: quickMatch, stopWaiting: stopWaiting,
            openRoom: function (roomId) { return new RoomSession(roomId).open(); },
            serverAlive: serverAlive, loadProfile: loadProfile, award: award, claimBadge: claimBadge, leaderboard: leaderboard, profilesOf: profilesOf,
            watchLeaderboard: watchLeaderboard, watchDailyBoard: watchDailyBoard, myGames: myGames, cancelRoom: cancelRoom, forgetGame: forget, KEEP_MS: KEEP_MS,
            dailyStatus: dailyStatus, dailyStart: dailyStart, dailyFinish: dailyFinish, dailyBoard: dailyBoard, startRun: startRun,
            sendInvite: sendInvite, respondInvite: respondInvite, dismissInvite: dismissInvite, cancelInvite: cancelInvite,
            inviteLive: inviteLive, watchInvites: watchInvites, watchInviteReply: watchInviteReply,
            recentQuestions: recentQuestions, rememberQuestions: rememberQuestions,
            dispose: function () { stopWaiting(); offsetRef.off('value'); }
        };
    }

    return { create: create, INVITE_TTL_MS: INVITE_TTL_MS };
});
