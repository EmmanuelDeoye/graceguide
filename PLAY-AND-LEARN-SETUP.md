# GraceGuide — going live (web v12 shell, Android 1.4.1)

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

**The `"games"` block changed again in 1.4.0 — replace the one you pasted before:**

- `"games"` → `rooms/{id}/pauses`: lets a player pause a running game for
  everyone (and anyone in it resume). Until this is live, games play normally
  but tapping **Pause** only says "This game can't be paused".

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

- Web: upload the `graceguide` folder (including `index.html`, `sw.js` and everything in `js/` and `css/`). `sw.js` is at cache version v12. Upload `admin.html`, `css/admin.css` and `js/admin.js` too — the admin page was repaired in 1.4.1. `js/games-ai.js` is gone — delete it from the server too.
- Android: `graceguide-android/app/build/outputs/bundle/release/app-release.aab`
  or `…/apk/release/app-release.apk` — version 1.4.1 (code 6). Set the admin
  page's "Android latest version" to 1.4.1.
- Release web and Android together, and ask players to update: a phone still on
  an older version does not know the new questions (it shows "This question
  isn't available in your version of the app") and does not freeze when someone
  pauses, so it would fall out of step in a shared room.

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
