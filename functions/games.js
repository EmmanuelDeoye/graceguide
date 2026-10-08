/* ============================================
   GraceGuide — functions/games.js
   Play & Learn: the game referee.

   The apps can run the games with no server at all: the database rules
   make every answer write-once and server-timestamped, and every client
   derives the same scores from them. What the rules alone cannot do is
   decide how much XP a finished game is worth — without this file the
   apps report that themselves (inside hard limits enforced by the rules).

   Once these functions are deployed they take that over:
     - a heartbeat at games/server/seen tells the rules a referee is
       running, which LOCKS players out of writing their own profile;
     - when a player claims a finished game the referee re-scores it from
       the answers in the database and awards XP, streaks and badges.
   So after deployment nobody can change their XP, wins or badges at all.

   Shares its scoring code with the apps: games-core.js and
   games-bank.json here are copies of the web app's (kept in sync by
   graceguide-games-tests/build-bank.js).
   ============================================ */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const Core = require('./games-core.js');
const BANK = require('./games-bank.json');

const REGION = 'europe-west1';
const DAY_MS = 86400000;
const KEEP_MS = 3 * DAY_MS; // rooms, their codes and their results are kept for three days
const db = () => admin.database();
const beat = () => db().ref('/games/server/seen').set(admin.database.ServerValue.TIMESTAMP).catch(() => {});

/** The player's own calendar day if it is believable (within a day of UTC today), else UTC today. */
function trustedDay(day) {
  const today = new Date().toISOString().slice(0, 10);
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return today;
  const diff = Math.abs(Date.parse(day + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z'));
  return diff <= DAY_MS ? day : today;
}

/** True the first time it is called for `key`; false on every repeat (triggers can fire twice). */
async function firstTime(key) {
  const res = await db().ref(`/games/awarded/${key}`).transaction((cur) => (cur ? undefined : Date.now()));
  return res.committed;
}

async function displayName(uid, fallback) {
  const snap = await db().ref(`/users/${uid}/profile/username`).once('value');
  return snap.val() || fallback || 'Player';
}

/** Folds one verified result into the player's profile (XP, streak, badges). */
async function award(uid, result) {
  const now = Date.now();
  let applied = null;
  await db().ref(`/games/profiles/${uid}`).transaction((current) => {
    applied = Core.applyResult(current, result, now);
    return Object.assign({}, applied.profile, { updatedAt: now });
  });
  return applied;
}

/** A player says "this multiplayer game is over — count it". Re-score it from the database. */
exports.gamesRefereeRoom = functions
  .region(REGION)
  .database.ref('/games/rooms/{roomId}/claims/{uid}')
  .onCreate(async (snapshot, context) => {
    const { roomId, uid } = context.params;
    const claim = snapshot.val() || {};
    await beat();
    const roomRef = db().ref(`/games/rooms/${roomId}`);
    const room = (await roomRef.once('value')).val();
    if (!room || !room.meta || !room.plan || !room.players || !room.players[uid]) return null;
    const game = room.meta.game;
    if (!Core.GAMES[game] || !Array.isArray(room.plan.q)) return null;
    room.answers = room.answers || {};

    // Only a finished game counts. (Small tolerance for clock differences.)
    const tl = Core.timeline(game, room);
    const lastEnd = tl.rounds[tl.rounds.length - 1].end;
    if (Date.now() < lastEnd - 5000) return null;

    const res = Core.scoreRoom(game, BANK, room);
    const mine = res.byUid[uid];
    if (!mine) return null; // not one of the seated players
    if (!(await firstTime(`rooms/${roomId}/${uid}`))) return null;

    const scores = {};
    res.ranking.forEach((u) => {
      const p = res.byUid[u];
      scores[u] = { score: p.score, correct: p.correct, rank: p.rank, win: !!p.win };
    });
    await roomRef.child('official').update({ scores, at: Date.now() });

    await award(uid, {
      game, units: mine.units, totalUnits: res.totalUnits, win: !!mine.win, multiplayer: res.players >= 2,
      day: trustedDay(claim.day), minGuesses: mine.minGuesses, score: mine.score, name: mine.name,
    });
    return null;
  });

/** A solo game was finished (start and finish are separate, server-stamped writes). */
exports.gamesRefereeRun = functions
  .region(REGION)
  .database.ref('/games/runs/{uid}/{runId}')
  .onUpdate(async (change, context) => {
    const { uid, runId } = context.params;
    const before = change.before.val() || {}, run = change.after.val() || {};
    if (typeof run.e !== 'number' || typeof before.e === 'number') return null;
    await beat();
    const cfg = Core.GAMES[run.game];
    const q = Array.isArray(run.q) ? run.q : Object.values(run.q || {});
    const a = Array.isArray(run.a) ? run.a : Object.values(run.a || {});
    if (!cfg || q.length !== cfg.rounds || new Set(q).size !== q.length) return null;
    // AI-written questions travel with the run (run.qs); the engine re-validates each one.
    const questions = q.map((id, r) => Core.roomQuestion(BANK, run.game, { q, qs: run.qs }, r));
    if (questions.some((x) => !x)) return null;
    if (run.e - run.s < 3000 || run.e - run.s > 2 * 3600000) return null;
    if (!(await firstTime(`runs/${uid}/${runId}`))) return null;

    let units = 0, correct = 0, minGuesses = 0;
    questions.forEach((question, i) => {
      const judged = Core.judge(run.game, question, a[i]);
      if (!judged.ok) return;
      correct += 1;
      units += cfg.type === 'wordle' ? 3 : 1;
      if (judged.guesses && (minGuesses === 0 || judged.guesses < minGuesses)) minGuesses = judged.guesses;
    });
    const totalUnits = cfg.rounds * (cfg.type === 'wordle' ? 3 : 1);
    await award(uid, {
      game: run.game, units, totalUnits, win: false, multiplayer: false, day: trustedDay(run.day), minGuesses,
      score: correct * (cfg.base || 100), name: await displayName(uid),
    });
    return null;
  });

/** A Daily Challenge was finished. */
exports.gamesRefereeDaily = functions
  .region(REGION)
  .database.ref('/games/daily/{day}/{uid}')
  .onUpdate(async (change, context) => {
    const { day, uid } = context.params;
    const before = change.before.val() || {}, run = change.after.val() || {};
    if (typeof run.e !== 'number' || typeof before.e === 'number') return null;
    await beat();
    if (trustedDay(day) !== day) return null; // not today's challenge
    if (!(await firstTime(`daily/${day}/${uid}`))) return null;
    const sc = Core.scoreDaily(BANK, day, run);
    if (!sc.finished) return null;
    await award(uid, { game: 'battle', daily: true, units: sc.correct, totalUnits: sc.total, day, score: sc.score, name: await displayName(uid, run.name) });
    return null;
  });

/**
 * Twice a day: refresh the heartbeat (so the rules keep trusting the referee) and sweep
 * what games leave behind — rooms older than three days (with their codes and everyone's
 * "my games" entries for them), stale quick-match entries, expired invites.
 */
exports.gamesHousekeeping = functions
  .region(REGION)
  .pubsub.schedule('every 12 hours')
  .onRun(async () => {
    await beat();
    const now = Date.now();
    const updates = {};
    const [rooms, codes, match, invites, awarded] = await Promise.all([
      db().ref('/games/rooms').orderByChild('meta/createdAt').endAt(now - KEEP_MS).limitToFirst(500).once('value'),
      db().ref('/games/codes').once('value'),
      db().ref('/games/match').once('value'),
      db().ref('/games/invites').once('value'),
      db().ref('/games/awarded/rooms').once('value'),
    ]);
    rooms.forEach((r) => { updates[`/games/rooms/${r.key}`] = null; updates[`/games/awarded/rooms/${r.key}`] = null; });
    codes.forEach((c) => { if (now - ((c.val() || {}).t || 0) > KEEP_MS) updates[`/games/codes/${c.key}`] = null; });
    match.forEach((g) => { g.forEach((e) => { if (now - ((e.val() || {}).t || 0) > 3600000) updates[`/games/match/${g.key}/${e.key}`] = null; }); });
    invites.forEach((u) => { u.forEach((i) => { if (now - ((i.val() || {}).exp || 0) > 3600000) updates[`/games/invites/${u.key}/${i.key}`] = null; }); });
    awarded.forEach((r) => { const first = Object.values(r.val() || {})[0]; if (now - (first || 0) > KEEP_MS + DAY_MS) updates[`/games/awarded/rooms/${r.key}`] = null; });
    // Solo-run records and yesterday's award markers are only needed briefly.
    const [runs, dailyMarks] = await Promise.all([db().ref('/games/runs').once('value'), db().ref('/games/awarded/daily').once('value')]);
    runs.forEach((u) => { u.forEach((r) => { if (now - ((r.val() || {}).s || 0) > DAY_MS) { updates[`/games/runs/${u.key}/${r.key}`] = null; updates[`/games/awarded/runs/${u.key}/${r.key}`] = null; } }); });
    dailyMarks.forEach((d) => { if (now - Date.parse(d.key + 'T00:00:00Z') > 3 * DAY_MS) updates[`/games/awarded/daily/${d.key}`] = null; });
    const mine = await db().ref('/games/mine').once('value');
    mine.forEach((u) => { u.forEach((g) => { if (now - ((g.val() || {}).t || 0) > KEEP_MS) updates[`/games/mine/${u.key}/${g.key}`] = null; }); });
    if (Object.keys(updates).length) await db().ref().update(updates);
    return null;
  });
