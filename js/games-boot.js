/* ============================================
   GraceGuide — Play & Learn: the question bank's placeholder.

   The bank (js/games-bank.js) holds a thousand questions for every game, so
   index.html loads it in the background (`async`) instead of making the whole
   app wait for it. This tiny file runs first and puts an EMPTY bank in place;
   games-bank.js fills that same object in when it arrives, sets `ready`, and
   fires the `gg-bank-ready` event. The Play page waits for that (games.js).
   ============================================ */
window.GAMES_BANK = window.GAMES_BANK || { version: 0, ready: false, emoji: [], wordle: [], whoami: [], bibleornot: [], battle: [] };
