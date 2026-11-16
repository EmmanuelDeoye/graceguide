/* ============================================
   DELETING A GRACEGUIDE ACCOUNT
   Shared by delete-account.html (the public page linked from Google Play's
   Data safety form) and Settings → Delete account. Needs firebase app, auth,
   database and storage (compat) to be loaded.

   Order matters: Firebase only deletes a login that signed in within the
   last few minutes, so callers check accountDeletionNeedsFreshSignIn()
   first — otherwise the data could be removed while the login stays.
   Everything the database rules let the person remove is removed here; the
   cleanUpDeletedAccount Cloud Function removes the rest (their game profile)
   once the login is gone.
   ============================================ */

/** Firebase asks for a sign-in within the last 5 minutes; keep a margin. */
const ACCOUNT_DELETE_FRESH_MS = 4 * 60 * 1000;

function accountDeletionNeedsFreshSignIn(user) {
    const last = Date.parse(user?.metadata?.lastSignInTime || '');
    return !last || Date.now() - last > ACCOUNT_DELETE_FRESH_MS;
}

/** Removes the person's data, then their login. Throws if the login could not be deleted. */
async function deleteGraceGuideAccount(user) {
    const uid = user.uid;
    const db = firebase.database();
    const steps = [];

    // Their own Space posts (the rules let an author delete their post).
    try {
        const posts = await db.ref('spacePosts').orderByChild('authorId').equalTo(uid).once('value');
        posts.forEach((p) => { steps.push(db.ref(`spacePosts/${p.key}`).remove()); });
    } catch (e) {
        console.warn('Could not list Space posts for deletion:', e);
    }
    // Direct messages: each conversation goes for both people, and leaves the other
    // person's chat list. users/{uid}/dmIndex is keyed by the other person's uid;
    // the conversation id is the two uids sorted and joined with "_".
    try {
        const chats = await db.ref(`users/${uid}/dmIndex`).once('value');
        chats.forEach((c) => {
            steps.push(db.ref(`dmConversations/${[uid, c.key].sort().join('_')}`).remove());
            steps.push(db.ref(`users/${c.key}/dmIndex/${uid}`).remove());
        });
    } catch (e) {
        console.warn('Could not list chats for deletion:', e);
    }
    // Brethren: the other person's side of each connection (the rules let either side remove it).
    try {
        const conns = await db.ref(`users/${uid}/connections`).once('value');
        conns.forEach((c) => { steps.push(db.ref(`users/${c.key}/connections/${uid}`).remove()); });
    } catch (e) {
        console.warn('Could not list Brethren for deletion:', e);
    }
    for (const path of [
        `publicProfiles/${uid}`,
        `userDirectory/${uid}`,
        `quizLeaderboardAllTime/${uid}`,
        `quizCompetition/current/participants/${uid}`,
        `games/seen/${uid}`,
        `games/mine/${uid}`,
    ]) {
        steps.push(db.ref(path).remove());
    }
    if (typeof firebase.storage === 'function') {
        steps.push(firebase.storage().ref(`avatars/${uid}.jpg`).delete());
    }
    // Some of these may be refused or already gone; the server finishes the job.
    const results = await Promise.allSettled(steps);
    results.filter((r) => r.status === 'rejected').forEach((r) => console.warn('Deletion step skipped:', r.reason?.code || r.reason));

    // Their private data: profile, Bible notes, highlights, planner, chats list,
    // devotionals, streaks, settings, notification tokens.
    await db.ref(`users/${uid}`).remove();

    // Finally the login itself.
    await user.delete();
}
