/* ============================================
   GraceGuide — js/quiz.js
   Weekly Bible Quiz competition: homepage countdown/live-banner/
   leaderboard card, and the full quiz page (prep → attempt → result).

   DATA MODEL (Realtime Database) — written by the admin page (to be
   built later); read-only from this file except for
   quizCompetition/current/participants/{uid}, which this file writes
   when a user submits their attempt:

   quizCompetition/current: {
     startTime: <ms epoch>,        // required — when the quiz opens (D-Day)
     timerMinutes: 25,             // optional, defaults to 25
     concentration: [              // optional prep list, shown pre-window
       { character: "Moses", book: "Exodus", reference: "Exodus 1-14" }
     ],
     questions: [                  // required before the window opens
       { question: "...", options: ["A","B","C","D"], correctIndex: 0 }
     ],
     participants: {                // written by clients on submit
       [uid]: { name, score, total, submittedAt, timeTakenSeconds }
     }
   }

   STATE is computed purely from `now` vs startTime — no separate
   status flag for the admin to keep in sync:
     "none"      — no startTime configured yet
     "countdown" — now < startTime
     "active"    — startTime <= now < startTime + 24h
     "ended"     — now >= startTime + 24h

   CAVEAT (documented for whoever builds the admin page): because there
   is no backend gating yet, `questions[].correctIndex` is technically
   visible to any signed-in client. Locking that down properly means
   restricting reads of `quizCompetition/current/questions` via Firebase
   Security Rules until the active window opens (a rule keyed off
   startTime), which the admin page/rules should add later.
   ============================================ */

const QUIZ_WINDOW_MS = 24 * 60 * 60 * 1000;
const QUIZ_DEFAULT_TIMER_MINUTES = 25;

let quizCountdownIntervalId = null;
let quizAttemptTimerIntervalId = null;
let lastLeaderboardParticipants = [];
let lastAllTimeLeaderboardEntries = [];

// In-memory state for whichever quiz page view is currently mounted —
// intentionally NOT in AppState since it's transient UI state specific
// to a single visit to the quiz page.
let quizPageData = null;
let quizAttempt = null; // { answers: {}, startedAt, timerSeconds, deadline }

function stopQuizCountdownInterval() {
    if (quizCountdownIntervalId) {
        clearInterval(quizCountdownIntervalId);
        quizCountdownIntervalId = null;
    }
}

function stopQuizAttemptTimer() {
    if (quizAttemptTimerIntervalId) {
        clearInterval(quizAttemptTimerIntervalId);
        quizAttemptTimerIntervalId = null;
    }
}

async function fetchQuizCompetition() {
    try {
        const snap = await database.ref('quizCompetition/current').once('value');
        return snap.val();
    } catch (e) {
        console.error('Error loading quiz competition:', e);
        return null;
    }
}

function getQuizState(data) {
    if (!data || !data.startTime) return 'none';
    const now = Date.now();
    if (now < data.startTime) return 'countdown';
    if (now < data.startTime + QUIZ_WINDOW_MS) return 'active';
    return 'ended';
}

function getSortedParticipants(data) {
    const participants = Object.entries(data?.participants || {}).map(([uid, p]) => ({ uid, ...p }));
    participants.sort((a, b) => (b.score - a.score) || ((a.timeTakenSeconds ?? 9e9) - (b.timeTakenSeconds ?? 9e9)));
    return participants;
}

/** Same "reference like Exodus 1-14" parsing the concentration list uses,
    reused here so a question's supporting verse can double as a tappable
    link straight to that passage in the Bible reader. */
function resolveVerseReferenceLink(reference) {
    if (!reference) return null;
    const parsed = parsePassageReference(reference);
    return parsed ? { book: parsed.book, chapter: parsed.chapter } : null;
}

async function fetchAllTimeLeaderboard() {
    try {
        const snap = await database.ref('quizLeaderboardAllTime').once('value');
        const raw = snap.val() || {};
        const entries = Object.entries(raw).map(([uid, e]) => ({ uid, ...e }));
        // Same tie-break philosophy as the per-round leaderboard: highest
        // accumulated percentage first, and when two people are tied on
        // that, the one who has spent LESS total time across all their
        // attempts ranks higher.
        entries.sort((a, b) => (b.accumulatedPercentage - a.accumulatedPercentage) || ((a.totalTimeTakenSeconds ?? 9e9) - (b.totalTimeTakenSeconds ?? 9e9)));
        return entries;
    } catch (e) {
        console.error('Error loading all-time leaderboard:', e);
        return [];
    }
}

/** Writes this attempt into the user's own quiz history (for their
    profile page) and folds it into their all-time aggregate leaderboard
    entry. Best-effort — if either write fails, the round submission
    itself (already saved by the caller) is unaffected. */
async function recordQuizCompletion(uid, name, result, roundStartTime) {
    const percentage = result.total > 0 ? Math.round((result.score / result.total) * 1000) / 10 : 0;

    const historyEntry = {
        startTime: roundStartTime,
        score: result.score,
        total: result.total,
        percentage,
        timeTakenSeconds: result.timeTakenSeconds,
        submittedAt: result.submittedAt
    };

    try {
        await database.ref(`users/${uid}/quizHistory/${roundStartTime}`).set(historyEntry);
    } catch (e) {
        console.error('Error saving quiz history:', e);
    }

    try {
        const allTimeRef = database.ref(`quizLeaderboardAllTime/${uid}`);
        const existingSnap = await allTimeRef.once('value');
        const existing = existingSnap.val() || { totalQuizzes: 0, totalScore: 0, totalPossible: 0, totalTimeTakenSeconds: 0 };

        const totalQuizzes = (existing.totalQuizzes || 0) + 1;
        const totalScore = (existing.totalScore || 0) + result.score;
        const totalPossible = (existing.totalPossible || 0) + result.total;
        const totalTimeTakenSeconds = (existing.totalTimeTakenSeconds || 0) + (result.timeTakenSeconds || 0);
        const accumulatedPercentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 1000) / 10 : 0;

        await allTimeRef.set({
            name,
            totalQuizzes,
            totalScore,
            totalPossible,
            accumulatedPercentage,
            totalTimeTakenSeconds,
            lastSubmittedAt: result.submittedAt
        });
    } catch (e) {
        console.error('Error updating all-time leaderboard:', e);
    }
}

function formatCountdownParts(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return {
        days: Math.floor(total / 86400),
        hours: Math.floor((total % 86400) / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60
    };
}

function formatBigCountdown(ms) {
    const { days, hours, minutes, seconds } = formatCountdownParts(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatSmallCountdown(ms) {
    const totalHours = Math.floor(Math.max(0, ms) / 3600000);
    const { minutes, seconds } = formatCountdownParts(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(totalHours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Prefers an explicit book/chapter on a concentration item; falls back
    to parsing something like "Exodus 1-14" into {book:'Exodus', chapter:1}. */
function resolveConcentrationLink(item) {
    if (item.book) return { book: item.book, chapter: item.chapter || 1 };
    const parsed = parsePassageReference(item.reference || '');
    return parsed ? { book: parsed.book, chapter: parsed.chapter } : null;
}

/* ============================================
   HOMEPAGE CARD
   ============================================ */
async function renderHomeQuizCard() {
    const data = await fetchQuizCompetition();
    const state = getQuizState(data);

    if (state === 'none') {
        return `
            <div class="card mb-4 quiz-home-card quiz-home-none" onclick="navigateTo('quiz')">
                <div class="quiz-home-header">
                    <span class="quiz-home-label"><i class="fas fa-trophy"></i> Weekly Bible Quiz</span>
                </div>
                <p class="quiz-home-sub">No competition is scheduled yet — check back soon!</p>
            </div>
        `;
    }

    if (state === 'countdown') {
        return `
            <div class="card mb-4 quiz-home-card quiz-home-countdown" onclick="navigateTo('quiz')">
                <div class="quiz-home-header">
                    <span class="quiz-home-label"><i class="fas fa-trophy"></i> Weekly Bible Quiz</span>
                    <span class="quiz-home-tag">Starts soon</span>
                </div>
                <div class="quiz-home-countdown-number" id="home-quiz-countdown" data-start="${data.startTime}">${formatBigCountdown(data.startTime - Date.now())}</div>
                <p class="quiz-home-sub">Tap to see what to study before the clock runs out</p>
            </div>
        `;
    }

    if (state === 'active') {
        const remaining = (data.startTime + QUIZ_WINDOW_MS) - Date.now();
        return `
            <div class="card mb-4 quiz-home-card quiz-home-live" onclick="navigateTo('quiz')">
                <div class="quiz-home-header">
                    <span class="quiz-home-label"><i class="fas fa-bolt"></i> Weekly Quiz is LIVE</span>
                    <span class="quiz-home-tag quiz-home-tag-live">Participate now</span>
                </div>
                <p class="quiz-home-sub">Time left to take part:</p>
                <div class="quiz-home-countdown-number quiz-home-countdown-small" id="home-quiz-countdown" data-end="${data.startTime + QUIZ_WINDOW_MS}">${formatSmallCountdown(remaining)}</div>
            </div>
        `;
    }

    // ended -> leaderboard (stays here on Home until the admin schedules
    // the next round's D-Day, at which point state flips back to
    // 'countdown' and this card is replaced automatically).
    const participants = getSortedParticipants(data);
    lastLeaderboardParticipants = participants;
    const allTimeEntries = await fetchAllTimeLeaderboard();
    lastAllTimeLeaderboardEntries = allTimeEntries;
    return renderHomeLeaderboardCard(participants) + renderHomeAllTimeLeaderboardCard(allTimeEntries);
}

function renderHomeLeaderboardCard(participants) {
    const top5 = participants.slice(0, 5);
    return `
        <div class="card mb-4 quiz-home-card quiz-home-leaderboard">
            <div class="quiz-home-header">
                <span class="quiz-home-label"><i class="fas fa-trophy"></i> Quiz Leaderboard</span>
                <span class="quiz-home-tag">${participants.length} participant${participants.length === 1 ? '' : 's'}</span>
            </div>
            ${top5.length > 0 ? `
                <div class="quiz-leaderboard-list">
                    ${top5.map((p, i) => `
                        <div class="quiz-leaderboard-row" onclick="event.stopPropagation(); viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
                            <span class="quiz-leaderboard-rank">#${i + 1}</span>
                            <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}</span>
                            <span class="quiz-leaderboard-score">${p.score}/${p.total}</span>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-outline btn-sm btn-block mt-2" onclick="event.stopPropagation(); showFullLeaderboardModal();">
                    Show More
                </button>
            ` : `<p class="text-muted quiz-home-sub">No one has taken this round's quiz yet.</p>`}
        </div>
    `;
}

function renderHomeAllTimeLeaderboardCard(entries) {
    const top5 = entries.slice(0, 5);
    return `
        <div class="card mb-4 quiz-home-card quiz-home-leaderboard quiz-home-alltime">
            <div class="quiz-home-header">
                <span class="quiz-home-label"><i class="fas fa-medal"></i> All-Time Ranking</span>
                <span class="quiz-home-tag">${entries.length} player${entries.length === 1 ? '' : 's'}</span>
            </div>
            ${top5.length > 0 ? `
                <div class="quiz-leaderboard-list">
                    ${top5.map((p, i) => `
                        <div class="quiz-leaderboard-row" onclick="event.stopPropagation(); viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
                            <span class="quiz-leaderboard-rank">#${i + 1}</span>
                            <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}<span class="quiz-leaderboard-subtext"> · ${p.totalQuizzes} quiz${p.totalQuizzes === 1 ? '' : 'zes'}</span></span>
                            <span class="quiz-leaderboard-score">${p.accumulatedPercentage}%</span>
                        </div>
                    `).join('')}
                </div>
                <button class="btn btn-outline btn-sm btn-block mt-2" onclick="event.stopPropagation(); showFullAllTimeLeaderboardModal();">
                    Show More
                </button>
            ` : `<p class="text-muted quiz-home-sub">No accumulated scores yet — take part in a round to get ranked here.</p>`}
        </div>
    `;
}

function showFullLeaderboardModal() {
    const participants = lastLeaderboardParticipants;
    showModal(`
        <h3 style="margin-bottom: 4px;">Leaderboard</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 16px;">${participants.length} participant${participants.length === 1 ? '' : 's'} this round</p>
        <div style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
            ${participants.length > 0 ? participants.map((p, i) => `
                <div class="quiz-leaderboard-row" onclick="viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
                    <span class="quiz-leaderboard-rank">#${i + 1}</span>
                    <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}</span>
                    <span class="quiz-leaderboard-score">${p.score}/${p.total}</span>
                </div>
            `).join('') : `<p class="text-center text-muted">No participants yet.</p>`}
        </div>
        <button class="btn btn-outline btn-sm btn-block mt-3" onclick="closeModalThen(showFullAllTimeLeaderboardModal)">
            <i class="fas fa-medal"></i> View All-Time Ranking
        </button>
    `);
}

async function showFullAllTimeLeaderboardModal() {
    // Modal opens immediately with a loading state, then fills in once the
    // (possibly not-yet-cached) all-time data arrives — same pattern as
    // everywhere else in the app that opens a modal before its data is ready.
    showModal(`
        <h3 style="margin-bottom: 4px;">All-Time Ranking</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 16px;">Ranked by accumulated score across every round — ties broken by total time taken.</p>
        <div id="alltime-leaderboard-body" style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
            <div class="skeleton" style="height: 44px; border-radius: 10px;"></div>
            <div class="skeleton" style="height: 44px; border-radius: 10px;"></div>
            <div class="skeleton" style="height: 44px; border-radius: 10px;"></div>
        </div>
        <button class="btn btn-outline btn-sm btn-block mt-3" onclick="closeModalThen(showFullLeaderboardModal)">
            <i class="fas fa-trophy"></i> Back to This Round
        </button>
    `);

    const entries = lastAllTimeLeaderboardEntries.length > 0 ? lastAllTimeLeaderboardEntries : await fetchAllTimeLeaderboard();
    lastAllTimeLeaderboardEntries = entries;

    const body = document.getElementById('alltime-leaderboard-body');
    if (!body) return; // modal was closed while this loaded
    body.innerHTML = entries.length > 0 ? entries.map((p, i) => `
        <div class="quiz-leaderboard-row" onclick="viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
            <span class="quiz-leaderboard-rank">#${i + 1}</span>
            <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}<span class="quiz-leaderboard-subtext"> · ${p.totalQuizzes} quiz${p.totalQuizzes === 1 ? '' : 'zes'}</span></span>
            <span class="quiz-leaderboard-score">${p.accumulatedPercentage}%</span>
        </div>
    `).join('') : `<p class="text-center text-muted">No accumulated scores yet.</p>`;
}

/** Ticks whichever countdown element is on screen (home or quiz page)
    once a second, without a full re-render — and triggers a one-time
    re-render the moment the state actually flips (countdown->active,
    or active->ended) so the UI updates itself with no user action. */
function startQuizCountdownTicker(onZero) {
    stopQuizCountdownInterval();
    quizCountdownIntervalId = setInterval(() => {
        const el = document.getElementById('home-quiz-countdown') || document.getElementById('quiz-page-countdown');
        if (!el) { stopQuizCountdownInterval(); return; }

        if (el.dataset.start) {
            const remaining = Number(el.dataset.start) - Date.now();
            if (remaining <= 0) { stopQuizCountdownInterval(); onZero(); return; }
            el.textContent = formatBigCountdown(remaining);
        } else if (el.dataset.end) {
            const remaining = Number(el.dataset.end) - Date.now();
            if (remaining <= 0) { stopQuizCountdownInterval(); onZero(); return; }
            el.textContent = formatSmallCountdown(remaining);
        }
    }, 1000);
}

/* ============================================
   QUIZ PAGE
   ============================================ */
async function renderQuizPage() {
    stopQuizCountdownInterval();
    stopQuizAttemptTimer();
    quizAttempt = null;

    DOM.pageContainer.innerHTML = `
        <div class="quiz-page-container">
            <div class="skeleton" style="height: 120px; border-radius: 16px; margin-bottom: 16px;"></div>
            <div class="skeleton" style="height: 200px; border-radius: 16px;"></div>
        </div>
    `;

    const data = await fetchQuizCompetition();
    if (AppState.currentRoute !== 'quiz') return; // navigated away while loading
    quizPageData = data;
    renderQuizPageForState();
}

function renderQuizPageForState() {
    const data = quizPageData;
    const state = getQuizState(data);

    if (state === 'none') {
        DOM.pageContainer.innerHTML = `
            <div class="quiz-page-container">
                <div class="text-center" style="padding: 60px 20px;">
                    <i class="fas fa-trophy" style="font-size: 44px; opacity: 0.3; margin-bottom: 16px;"></i>
                    <h3 style="margin-bottom: 8px;">No quiz scheduled yet</h3>
                    <p class="text-muted">Check back soon — a new Weekly Bible Quiz will appear here once one is scheduled.</p>
                </div>
            </div>
        `;
        return;
    }

    if (state === 'countdown') {
        const concentration = data.concentration || [];
        DOM.pageContainer.innerHTML = `
            <div class="quiz-page-container">
                <div class="quiz-coming-soon-banner">
                    <i class="fas fa-trophy"></i>
                    <div>
                        <strong>Coming Soon</strong>
                        <p>The quiz will only be available on the set date, and you'll have 24 hours to participate once it opens.</p>
                    </div>
                </div>
                <div class="quiz-page-countdown-wrap">
                    <div class="quiz-page-countdown-number" id="quiz-page-countdown" data-start="${data.startTime}">${formatBigCountdown(data.startTime - Date.now())}</div>
                    <div class="quiz-page-countdown-label">until the quiz opens</div>
                </div>
                ${concentration.length > 0 ? `
                    <div class="card mb-3">
                        <h3 style="font-weight: 700; margin-bottom: 12px;">Area of Concentration</h3>
                        <p class="text-muted" style="font-size: 13px; margin-bottom: 14px;">Study these ahead of time — tap any of them to jump straight into that passage.</p>
                        <div class="quiz-concentration-list">
                            ${concentration.map(item => {
                                const link = resolveConcentrationLink(item);
                                const safeBook = link ? link.book.replace(/'/g, "\\'") : '';
                                return `
                                    <div class="quiz-concentration-item" ${link ? `onclick="openBibleChapter('${safeBook}', ${link.chapter})"` : ''}>
                                        <div class="quiz-concentration-character"><i class="fas fa-user"></i> ${escapeHtml(item.character || 'Study focus')}</div>
                                        <div class="quiz-concentration-ref">${escapeHtml(item.reference || '')} ${link ? '<i class="fas fa-chevron-right"></i>' : ''}</div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
        startQuizCountdownTicker(() => renderQuizPage());
        return;
    }

    if (state === 'active') {
        renderQuizActiveState();
        return;
    }

    // ended
    const participants = getSortedParticipants(data);
    lastLeaderboardParticipants = participants;
    DOM.pageContainer.innerHTML = `
        <div class="quiz-page-container">
            <div class="text-center card mb-3" style="padding: 32px 20px;">
                <i class="fas fa-flag-checkered" style="font-size: 40px; opacity: 0.4; margin-bottom: 12px;"></i>
                <h3 style="margin-bottom: 8px;">This round's quiz has closed</h3>
                <p class="text-muted">A new round will open on the next scheduled date.</p>
            </div>
            <div class="card mb-3">
                <h3 style="font-weight: 700; margin-bottom: 12px;">Leaderboard</h3>
                ${participants.length > 0 ? `
                    <div class="quiz-leaderboard-list">
                        ${participants.map((p, i) => `
                            <div class="quiz-leaderboard-row" onclick="viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
                                <span class="quiz-leaderboard-rank">#${i + 1}</span>
                                <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}</span>
                                <span class="quiz-leaderboard-score">${p.score}/${p.total}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : `<p class="text-center text-muted">No one took part in this round.</p>`}
            </div>
            <div class="card">
                <h3 style="font-weight: 700; margin-bottom: 4px;"><i class="fas fa-medal"></i> All-Time Ranking</h3>
                <p class="text-muted" style="font-size: 12px; margin-bottom: 12px;">Accumulated score across every round — ties broken by total time taken.</p>
                <div class="quiz-leaderboard-list" id="quiz-page-alltime-list">
                    <div class="skeleton" style="height: 44px; border-radius: 10px; margin-bottom: 6px;"></div>
                    <div class="skeleton" style="height: 44px; border-radius: 10px;"></div>
                </div>
            </div>
        </div>
    `;
    renderQuizPageAllTimeSection();
}

async function renderQuizPageAllTimeSection() {
    const entries = await fetchAllTimeLeaderboard();
    lastAllTimeLeaderboardEntries = entries;
    const list = document.getElementById('quiz-page-alltime-list');
    if (!list) return; // navigated away while this loaded
    list.innerHTML = entries.length > 0 ? entries.map((p, i) => `
        <div class="quiz-leaderboard-row" onclick="viewUserProfile('${p.uid}', '${escapeHtml(p.name || 'Anonymous').replace(/'/g, "\\'")}')">
            <span class="quiz-leaderboard-rank">#${i + 1}</span>
            <span class="quiz-leaderboard-name">${escapeHtml(p.name || 'Anonymous')}<span class="quiz-leaderboard-subtext"> · ${p.totalQuizzes} quiz${p.totalQuizzes === 1 ? '' : 'zes'}</span></span>
            <span class="quiz-leaderboard-score">${p.accumulatedPercentage}%</span>
        </div>
    `).join('') : `<p class="text-center text-muted">No accumulated scores yet.</p>`;
}

function renderQuizActiveState() {
    const data = quizPageData;
    const uid = AppState.currentUser?.uid;
    const existingResult = uid ? data.participants?.[uid] : null;

    if (existingResult) {
        renderQuizResultScreen(existingResult, true);
        return;
    }

    const remaining = (data.startTime + QUIZ_WINDOW_MS) - Date.now();
    const questionCount = (data.questions || []).length;
    const timerMinutes = data.timerMinutes || QUIZ_DEFAULT_TIMER_MINUTES;

    DOM.pageContainer.innerHTML = `
        <div class="quiz-page-container">
            <div class="quiz-live-banner">
                <i class="fas fa-bolt"></i>
                <div>
                    <strong>Quiz is LIVE</strong>
                    <p>Available for 24 hours from when it opened.</p>
                </div>
                <div class="quiz-page-countdown-small" id="quiz-page-countdown" data-end="${data.startTime + QUIZ_WINDOW_MS}">${formatSmallCountdown(remaining)}</div>
            </div>

            <div class="card text-center">
                <i class="fas fa-book-bible" style="font-size: 40px; color: var(--primary-deep-olive); margin-bottom: 12px;"></i>
                <h3 style="margin-bottom: 8px;">Ready when you are</h3>
                <p class="text-muted" style="margin-bottom: 16px;">${questionCount} question${questionCount === 1 ? '' : 's'} • ${timerMinutes} minute timer once you start • one attempt only</p>
                <button class="btn btn-primary btn-block" onclick="startQuizAttempt()">
                    <i class="fas fa-play"></i> Start Quiz
                </button>
            </div>
        </div>
    `;

    startQuizCountdownTicker(() => renderQuizPage());
}

function startQuizAttempt() {
    if (!requireAuth('Sign in to take the quiz.')) return;

    const data = quizPageData;
    const questions = data.questions || [];
    if (questions.length === 0) {
        showToast('This round has no questions configured yet.', 'warning');
        return;
    }

    stopQuizCountdownInterval(); // countdown is suspended once the attempt begins

    const timerSeconds = (data.timerMinutes || QUIZ_DEFAULT_TIMER_MINUTES) * 60;
    quizAttempt = {
        answers: {},
        startedAt: Date.now(),
        deadline: Date.now() + timerSeconds * 1000
    };

    renderQuizAttemptScreen();
    stopQuizAttemptTimer();
    quizAttemptTimerIntervalId = setInterval(() => {
        const el = document.getElementById('quiz-attempt-timer');
        if (!el || !quizAttempt) { stopQuizAttemptTimer(); return; }
        const remaining = quizAttempt.deadline - Date.now();
        if (remaining <= 0) {
            el.textContent = '00:00';
            stopQuizAttemptTimer();
            submitQuizAttempt(true);
            return;
        }
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        el.classList.toggle('quiz-timer-urgent', remaining < 60000);
    }, 1000);
}

function renderQuizAttemptScreen() {
    const questions = quizPageData.questions || [];
    const answeredCount = Object.keys(quizAttempt.answers).length;

    DOM.pageContainer.innerHTML = `
        <div class="quiz-page-container">
            <div class="quiz-attempt-header">
                <span><i class="fas fa-list-check"></i> ${answeredCount}/${questions.length} answered</span>
                <span class="quiz-attempt-timer" id="quiz-attempt-timer">--:--</span>
            </div>
            ${questions.map((q, qi) => `
                <div class="card mb-3 quiz-question-card">
                    <div class="quiz-question-text"><strong>${qi + 1}.</strong> ${escapeHtml(q.question)}</div>
                    <div class="quiz-options">
                        ${(q.options || []).map((opt, oi) => `
                            <button class="quiz-option-btn ${quizAttempt.answers[qi] === oi ? 'selected' : ''}" onclick="selectQuizAnswer(${qi}, ${oi})">
                                ${escapeHtml(opt)}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
            <button class="btn btn-primary btn-block mb-4" onclick="submitQuizAttempt(false)">
                <i class="fas fa-paper-plane"></i> Submit Quiz
            </button>
        </div>
    `;
}

function selectQuizAnswer(questionIndex, optionIndex) {
    if (!quizAttempt) return;
    quizAttempt.answers[questionIndex] = optionIndex;
    renderQuizAttemptScreen(); // cheap enough to fully re-render; keeps selection/progress in sync
}

async function submitQuizAttempt(isAutoSubmit) {
    if (!quizAttempt || !AppState.currentUser) return;

    stopQuizAttemptTimer();
    const questions = quizPageData.questions || [];
    const answers = { ...quizAttempt.answers };
    let score = 0;
    questions.forEach((q, qi) => {
        if (answers[qi] === q.correctIndex) score++;
    });

    const timeTakenSeconds = Math.round((Date.now() - quizAttempt.startedAt) / 1000);
    const uid = AppState.currentUser.uid;
    const name = AppState.userProfile?.username || 'Anonymous';
    const result = {
        name,
        score,
        total: questions.length,
        submittedAt: Date.now(),
        timeTakenSeconds,
        answers
    };

    try {
        await database.ref(`quizCompetition/current/participants/${uid}`).set(result);
        if (!quizPageData.participants) quizPageData.participants = {};
        quizPageData.participants[uid] = result;
        renderQuizResultScreen(result, false, isAutoSubmit);
        // Best-effort — the round submission above (the part the
        // leaderboard reads from) has already succeeded regardless of
        // whether this secondary bookkeeping does.
        recordQuizCompletion(uid, name, result, quizPageData.startTime).catch(() => {});
    } catch (error) {
        console.error('Error submitting quiz:', error);
        showToast('Could not submit your quiz. Please try again.', 'error');
    }
}

/** Per-question review: your answer vs. the correct one, plus a tappable
    link to the supporting verse when the admin attached one. */
function renderQuizAnswerBreakdown(questions, userAnswers) {
    if (!questions || questions.length === 0) return '';
    userAnswers = userAnswers || {};

    return `
        <div class="card mt-3">
            <h3 style="font-weight: 700; margin-bottom: 12px;">Review Your Answers</h3>
            ${questions.map((q, qi) => {
                const userIdx = userAnswers[qi];
                const isCorrect = userIdx === q.correctIndex;
                const userAnswerText = (userIdx !== undefined && userIdx !== null && q.options?.[userIdx] !== undefined)
                    ? q.options[userIdx] : null;
                const correctAnswerText = q.options?.[q.correctIndex];
                const link = resolveVerseReferenceLink(q.verseReference);
                const safeBook = link ? link.book.replace(/'/g, "\\'") : '';

                return `
                    <div class="quiz-review-item ${isCorrect ? 'quiz-review-correct' : 'quiz-review-incorrect'}">
                        <div class="quiz-review-question">
                            <i class="fas ${isCorrect ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
                            <span><strong>${qi + 1}.</strong> ${escapeHtml(q.question)}</span>
                        </div>
                        <div class="quiz-review-answer-line">
                            Your answer: <span class="${isCorrect ? 'quiz-review-correct-text' : 'quiz-review-incorrect-text'}">${escapeHtml(userAnswerText ?? 'No answer')}</span>
                        </div>
                        ${!isCorrect ? `
                            <div class="quiz-review-answer-line">
                                Correct answer: <span class="quiz-review-correct-text">${escapeHtml(correctAnswerText ?? '—')}</span>
                            </div>
                        ` : ''}
                        ${q.verseReference ? `
                            <div class="quiz-review-verse" ${link ? `onclick="openBibleChapter('${safeBook}', ${link.chapter})"` : ''}>
                                <i class="fas fa-book-bible"></i> ${escapeHtml(q.verseReference)}
                                ${q.verseText ? `<span class="quiz-review-verse-text">"${escapeHtml(q.verseText)}"</span>` : ''}
                                ${link ? `<i class="fas fa-chevron-right"></i>` : ''}
                            </div>
                        ` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderQuizResultScreen(result, alreadyTaken, wasAutoSubmit) {
    quizAttempt = null;
    const questions = quizPageData?.questions || [];
    DOM.pageContainer.innerHTML = `
        <div class="quiz-page-container">
            <div class="card text-center">
                <i class="fas fa-circle-check" style="font-size: 44px; color: var(--primary-deep-olive); margin-bottom: 12px;"></i>
                <h3 style="margin-bottom: 4px;">${alreadyTaken ? "You've already taken this round" : 'Quiz submitted!'}</h3>
                ${wasAutoSubmit ? `<p class="text-muted" style="margin-bottom: 12px;">Time ran out, so your answers were submitted automatically.</p>` : ''}
                <div class="quiz-result-score">${result.score}<span>/${result.total}</span></div>
                <p class="text-muted" style="margin-top: 12px;">The Leaderboard will update here — and on the Home page — once this round's 24-hour window resets.</p>
            </div>
            ${renderQuizAnswerBreakdown(questions, result.answers)}
        </div>
    `;
}

window.showFullLeaderboardModal = showFullLeaderboardModal;
window.showFullAllTimeLeaderboardModal = showFullAllTimeLeaderboardModal;
window.startQuizAttempt = startQuizAttempt;
window.selectQuizAnswer = selectQuizAnswer;
window.submitQuizAttempt = submitQuizAttempt;
