# GraceGuide — going live (web v14 shell, Android 1.6.0)

Three things have to happen in Firebase before everything works for real
users. Do them in this order.

## 1. Add the new blocks to your live database rules (required)

Open Firebase Console → Realtime Database → **Rules**, and paste these blocks
**inside** your existing `"rules": { … }`, next to `"users"`, `"spacePosts"`
and the others. Do not replace anything that is already there.

| File (next to this one) | Block | What stops working without it |
|---|---|---|
| `games.rules.json` | `"games": { … }` | All multiplayer: rooms, invites, XP, leaderboards, Daily Challenge, "My games". (Solo still works.) |
| `community.rules.json` | `"publicProfiles": { … }` | Community → Users shows "Couldn't load people". |
| `contact.rules.json` (new in 1.6.0) | `"contactMessages": { … }` | About Us → "Send to the GraceGuide team" fails (it tells the person to use WhatsApp or email instead), and the admin page's Messages tab cannot load. |

**The `"games"` block changed again in 1.5.0 — replace the one you pasted before:**

- `seen` (new): each player's question history, so games can be dealt from
  questions nobody at the table has seen. Until this is live the apps fall
  back to each phone's own short memory of recent questions — games still
  work, but the history does not follow the account or cover the other players.
- `invites`: a rematch may invite anyone who was in the game just played,
  not only Brethren. Until this is live, rematch invitations reach Brethren
  only (the others get an ordinary notification instead).
- `rooms/{id}/pauses` is gone: nobody can pause a game any more, whatever
  version of the app they are on.

**Both blocks changed in 1.3.0 (still needed if you have not pasted them yet):**

- `"games"`: badge bonus XP. A profile may now carry `claimed`, `perfect` and
  `claims`, a claim is its own kind of write (one badge at a time, at most
  150 XP, never more than 40), and there is a new `badgeClaims` path the
  referee listens to. Until this is live, **"Claim XP" on a badge fails**
  ("Couldn't claim that just now"). Ordinary game XP keeps saving either way.
- `"publicProfiles"`: a card may now hold `eh`, a one-way hash of the owner's
  email, which is what "search by email" matches. Until this is live, search
  by name works and search by email finds nobody. The address itself is never
  stored there.

Also check that your `"users"` rules let an account write its own
`users/{uid}/devotionStreak`, `users/{uid}/profile/faith` and
`users/{uid}/profile/spiritPrivate` (they do if a user can already write their
own `users/{uid}` data, which notes and bookmarks need).

Search by email reads `publicProfiles`; the wider people list also reads
`quizLeaderboardAllTime` and `games/profiles`, which signed-in users can
already read. Opening an older Space plan post looks in `plannerShares`.

Do **not** publish `database.rules.json` from this folder: it is not your live
ruleset and would break Chats, Shepherd and the Bible.

If the top of your live rules has a blanket `".read": true` / `".write": true`
(or `"auth != null"`) at the root, these rules cannot restrict anything,
because in Firebase a rule that allows access higher up always wins. In that
case paste the live rules to me — they need tightening first.

## 2. Deploy the Cloud Functions (recommended)

Needs the Blaze plan and the Firebase CLI. From the `graceguide` folder:

```bash
firebase deploy --only functions
```

- **Invitation pushes** to phones in the background / closed apps.
- **The game referee** (`functions/games.js`): re-scores every finished game
  and becomes the only thing that can write XP, wins, streaks and badges. It
  also sweeps rooms older than three days. New in 1.3.0: `gamesRefereeBadge`
  pays a badge's bonus XP when a player claims it — redeploy the functions, or
  claims will wait forever once the referee is running. In 1.4.0 the referee's
  copy of the engine and question bank changed too (pauses, 531 questions):
  **redeploy the functions with this release**, or it will mis-score paused
  games and not know the new questions.

## 3. Publish

- Web: upload the `graceguide` folder (including `index.html`, `sw.js` and everything in `js/` and `css/`). `sw.js` is at cache version v14. Upload `admin.html`, `css/admin.css` and `js/admin.js` too — the admin page was repaired in 1.4.1. `js/games-ai.js` is gone — delete it from the server too.
- Android: `graceguide-android/app/build/outputs/bundle/release/app-release.aab`
  or `…/apk/release/app-release.apk` — version 1.6.0 (code 8). Set the admin
  page's "Android latest version" to 1.6.0.
- Release web and Android together, and ask players to update: a phone still on
  an older version does not know the new questions (it shows "This question
  isn't available in your version of the app") and does not freeze when someone
  pauses, so it would fall out of step in a shared room.

## What changed in 1.6.0

Nothing in the `"games"` rules or the Cloud Functions changed. One new rule
block to add: `contact.rules.json` (table above). Also check that an account
can write its own `users/{uid}/quizPrizeClaims` (it can if it can already
write its own `users/{uid}` data).

**Set this once:** admin page → App Settings → **GraceGuide WhatsApp line**.
It is the number behind About Us → "Send on WhatsApp" and the quiz winner's
"Claim your prize". If it is left blank the Talk to Someone number is used;
if both are blank, people are pointed to the support email.

- **Weekly Quiz winner.** When a round is over, the player at the top of its
  leaderboard (highest score, fastest on a tie) — and nobody else — sees a
  full-screen celebration with **Claim your prize**, which opens WhatsApp with
  a ready-written message. It appears once each time they open the app until
  they tap the button; after that it never appears again. A card at the top
  of the Quiz page offers the same button, and stays as "Prize claimed"
  afterwards. The offer lasts 14 days after the round closes.
- **About Us** (menu → About Us, also in Settings): who we are, and a contact
  form with four kinds of message (inquiry, partnership, feedback, complaint)
  and three ways to send it — to the GraceGuide team inside the app, on
  WhatsApp, or by email to support@graceguide.com.ng.
- **Admin → Messages** (new tab): everything sent to the team, with search,
  filters by kind and status, Reply in the app (a notification to the
  sender), Reply by email (when they left an address), Mark read, Resolve and
  Delete. The sidebar shows how many are new.
- **Space** has two arrangements, **Latest** (newest first — the default) and
  **For you** (by the reader's interests). The last choice is remembered on
  the device.
- **Reacting to a Space post no longer reloads it** (web): only the row of
  buttons is redrawn, so a video keeps playing. (On Android a video opens in
  its own player, so it never had this problem.)
- **My Profile is no longer in the menu** — it is always in the top bar.
  On the web the top-bar picture now carries the Spirit Life sticker too.
- **Share cards: one brand, five designs.** Same colours and glass panel, a
  different feel for each family: verses (centred, opening with a large
  quotation mark), devotionals and plans (rays of light, a gold spine), Space
  / forums / profiles (a round medallion, drifting circles), games / quizzes
  / streaks (an icon tile, a field of dots), Spirit Life (a medallion with
  light radiating behind it).
- **"Recommended for You" is removed from Home.**

## What changed in 1.5.0 (Play & Learn only)

Redeploy the **rules** (above) and the **functions** with this release: the
server's copy of the engine and bank changed (levels, the frozen Daily
Challenge pool).

- **Pause is removed.** There is no Pause button on web or Android. (If a
  player still on 1.4.x pauses before the new rules are in, everyone stays in
  step and anyone can tap Resume — that is the only place the old screen can
  still appear.)
- **Rematch stays in the same room.** The host's Rematch button reopens the
  room with the same code, the same players and the same level, and new
  questions. Players still on the results screen are taken back in
  automatically; anyone who has left gets an invitation (in the app and as a
  phone notification) a few seconds later. It starts by itself when everyone
  is back, or the host can tap Start now. Only the host can call a rematch —
  unless the host has left, then any player can. Underneath, each game still
  has its own answer record: that is what keeps scores tamper-proof and lets
  the server re-check them.
- **Easy / Medium / Hard is back**, on each game's page, and now works from
  the question bank: every question is tagged, the host's choice is saved in
  the room and shown in the lobby, and it applies to solo games too.
- **Fair questions.** Each account keeps a history of the questions it has
  been shown (on any device). A game is dealt from questions no seated player
  has seen; when those run out, the least-seen ones. A rematch never repeats
  the game before it. Solo play uses the same history. The histories load in
  the background while players are in the lobby — starting a game never waits
  for them.
- **The Daily Challenge is frozen** against bank growth: it draws from a fixed
  part of the bank, so adding questions never changes a day's five questions.

## The question bank: growing it safely

- Add questions **only at the end** of the arrays in
  `graceguide-games-tests/bank-src-2.js`. Ids come from position, and
  `bank-lock.json` now refuses a build in which an existing id has come to
  mean a different question.
- Set difficulty in `bank-levels.js` (anything not listed is Medium).
- `npm run bank` writes the web, server and Android copies together;
  `npm run check` reports mistakes (duplicates, unknown books or chapters,
  bad Wordle words, hints that give the word away), the count per game and
  level, and whether every copy of the bank and of the engine is identical.
- The bank holds **531 questions today** (Emoji 86, Wordle 89, Who Am I? 81,
  Bible or Not? 101, Bible Battle 174). The apps are built and tested for a
  thousand per game: lookups are indexed, the web copy loads as one JSON
  string, and Android reads it off the main thread.
- The checker confirms a reference names a real book and chapter. It does
  **not** know how many verses each chapter has, and it cannot tell whether
  an answer is right — new questions still need a human read-through.

## What changed in 1.4.1

Nothing in the database rules or the Cloud Functions changed in 1.4.1 — only
the web files and the Android app.

- **Admin page repaired.** It could not scroll and was squeezed into a narrow
  strip, because the iPhone fix in the main app (which pins the page body)
  also applied to the admin page. The graphs never drew because the page asked
  for a version of the chart library that does not exist on that host (the
  link returned "not found"); it now loads a version that does, with a second
  host as a fallback.
- **Admin → Users**: search by name or email, a Sort menu (newest, oldest,
  recently active, least recently active, name, email), sortable column
  headings and a Refresh button.
- **"How to play"** is now a help icon in the top corner of the Play & Learn
  page (on the level card) instead of a full-width button.
- **Spirit Life sticker (Android)** sits on the edge of the profile picture.
  It was being cut off by the round clipping of the top bar and of the
  profile picture's shadow.
- **Chat and forum messages are no longer listed under the bell** and do not
  count in its number. Instead, a dot shows on the three-line menu icon
  whenever a chat or a forum has unread messages (the drawer's Chats and
  Community links keep their own dots). Phone pop-up notifications for
  messages are unchanged.
- Web version stamp is `?v=1.4.1`, service worker cache `v12`.

## What changed in 1.4.0

- **Game questions come only from the built-in bank again.** The AI question
  writer is removed from both apps (no Easy / Medium / Hard picker, no waiting
  dialog), because some of its questions marked the right answer wrong. The
  bank grew from 252 to **531 questions** (Emoji 86, Who Am I? 81, Bible or
  Not? 101, Bible Battle 174, Wordle 89). Every item cites the verse that
  states its answer; I wrote and checked them against the King James text, but
  please still play through and tell me about anything that looks wrong — the
  source is `graceguide-games-tests/bank-src-2.js`, one line per question.
- **Pause.** During a question any player can tap Pause: the game stops for
  everyone, the question is covered, and anyone can resume. It also resumes by
  itself after 60 seconds, and a game can be paused at most six times, so
  nobody can hold a room hostage. Paused time does not count against speed
  points. The Daily Challenge cannot be paused (it is timed start to finish).
- **Starting together.** A player who has taken a seat now only shows as ready
  once their phone has the room open. When the host taps Start while someone is
  still connecting, the game waits for them (up to 6 seconds) and then begins —
  so guests no longer arrive after the first question has started.
- **My games** lists only rooms that have not been played yet. A room leaves
  the list the moment its game starts.
- **Spirit Life celebration.** Reaching a higher level shows a full-screen
  celebration wherever the person is in the app, with a Share button. It is
  remembered per device, so the first time a device sees a level it only notes
  it (no pop-up for a level already held).
- **Shorter share cards** (square instead of tall) for a game room, Spirit Life
  and a forum link. Forum groups now have a share button and a link
  (`#/forum/GROUP_ID`) that opens the group.
- **Wins** (multiplayer games won) show on every profile.
- **Brethren list** updates live — no need to close and reopen the app.
- **Updates reach people straight away (web).** The service worker used to
  serve saved scripts first and refresh them in the background, so a new
  release took several visits to appear. It now asks the network first and
  uses the saved copy only when offline; `index.html` also stamps every
  script and stylesheet with the version (`?v=1.4.0` at the time). A tab that is already
  open when you publish shows a small "GraceGuide has been updated — Refresh"
  bar. **When you publish future versions, change that `?v=` stamp in
  `index.html` and bump `CACHE_VERSION` in `sw.js`.** People still on the
  old service worker need one more visit for it to replace itself; after that
  updates are immediate.

## What changed in 1.3.0

- **Levels climb more slowly the higher you go**: level 2 at 100 XP, 3 at 400,
  5 at 2,000, 10 at 16,500, 20 at 133,000. Nobody loses XP, but most players
  will see a lower level number than before.
- **Spirit Life** is the new name for Faithfulness (the database still calls
  it `faith`). Each of the ten levels has a sticker worn on the avatar.
  "Brethren only" in Settings hides it from everyone else — this is respected
  by the apps, not enforced by database rules, so treat it as a courtesy
  setting, not a secret.
- **Videos in Space**: YouTube, Facebook, TikTok, X, Instagram and Vimeo play
  inside GraceGuide. Snapchat, TikTok share links (`vm.tiktok.com`) and other
  sites are refused when posting. Older posts with such links show "This video
  can't play here".
- **Space study plans**: a plan's readings were not being saved with the post,
  which is why nobody could open one. New posts carry them. An older post can
  only be opened if its author also shared that plan in a chat, forum or by
  link; otherwise they need to post it again.

## Community → Users: existing members

People appear in the Users list once they open the updated app (it writes
their public card: name, photo, short bio, joined, last active — never an
email). To list everyone straight away, sign in on the **web** app with an
admin account and open Community → Users once: it fills in the missing cards
from the admin directory.

## Game questions

All questions come from the built-in bank (`js/games-bank.js`, generated from
`graceguide-games-tests/bank-src.js` + `bank-src-2.js`). The bank is
append-only: question ids are positions, and saved rooms and the Daily
Challenge point at them. To add or correct questions, edit the source file,
run `node build-bank.js` in `graceguide-games-tests`, then publish web,
Android and the functions together.

## What is where

| | |
|---|---|
| `js/games-core.js` | The engine: schedule (including pauses), scoring, XP, badges. Shared by web, Android (Kotlin port) and the referee. |
| `js/games-bank.js` | The built-in questions (531). Generated — edit `graceguide-games-tests/bank-src.js` / `bank-src-2.js`, run `node build-bank.js`. |
| `js/games-net.js`, `js/games-play.js`, `js/games.js`, `css/games.css` | Rooms / the question screen / the Play & Learn pages. |
| `js/streaks.js` | Devotion streak + Spirit Life score, its ten levels and stickers (Android: `data/Faithfulness.kt`). |
| `games.rules.json`, `community.rules.json` | Rule blocks to merge (generated by `build-rules.js`). |
| `functions/games.js` | The referee. |
