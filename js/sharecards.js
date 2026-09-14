/* ============================================
   GraceGuide — js/sharecards.js
   PHASE 2: Share Cards.
   Load AFTER core.js, features.js, community.js, quiz.js (uses globals
   from all of them: AppState, showSheet/showToast/escapeHtml/truncate/
   formatDate, database).

   One reusable engine for generating branded GraceGuide image cards
   (client-side, via <canvas>) and sharing them — used by all 7 content
   types listed in the Phase 2 spec: Bible verse, Space post, Profile,
   Reading plan, Quiz/result, Daily verse, Daily devotional.

   Nothing in here duplicates or replaces the existing Space/Group/DM
   text-sharing flows (shareVerseToGroup, sharePlanToGroup, DM shares,
   showShareReelToGroupSheet, etc.) — those keep working exactly as
   they did. This is a new, additional capability layered on top of
   (and in shareVerse()/shareSpacePost()'s case, upgrading) the existing
   simple navigator.share() calls.

   PHASE 3: resolveShareUrl() now builds real deep-link URLs (see
   js/core.js's central route parser/dispatcher — parseAppRoute() and
   navigateToHash() — for how those routes are handled on the receiving
   end). sharePlanCard()/shareDevotionalCard() below also write small
   PUBLIC snapshot records (plannerShares/devotionalShares) so their
   share links have something safe to resolve to — never the private
   users/{uid}/planner or personalized devotional data itself.
   ============================================ */

/* ============================================
   CARD RENDERER (the one reusable engine)
   ============================================ */
const SHARE_CARD_WIDTH = 1080;
const SHARE_CARD_HEIGHT = 1350;

const SHARE_CARD_COLORS = {
    oliveDark: '#243629',
    olive: '#30483A',
    gold: '#C7A65A',
    goldLight: '#d9bc7a',
    terracotta: '#C87552',
    sage: '#718575',
    cream: 'rgba(248,246,240,0.94)'
};

// Same content-type vocabulary used throughout the builders below —
// each just gets its own accent color on top of the shared dark-olive
// brand background, so every card reads as unmistakably "GraceGuide"
// while still visually distinguishing what kind of card it is.
const SHARE_CARD_ACCENTS = {
    verse: SHARE_CARD_COLORS.gold,
    dailyVerse: SHARE_CARD_COLORS.gold,
    devotional: SHARE_CARD_COLORS.gold,
    space: SHARE_CARD_COLORS.goldLight,
    profile: SHARE_CARD_COLORS.sage,
    plan: SHARE_CARD_COLORS.sage,
    quiz: SHARE_CARD_COLORS.terracotta
};

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function wrapCanvasText(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    words.forEach(word => {
        const test = current ? `${current} ${word}` : word;
        if (current && ctx.measureText(test).width > maxWidth) {
            lines.push(current);
            current = word;
        } else {
            current = test;
        }
    });
    if (current) lines.push(current);
    return lines;
}

// The Google Fonts <link> is already in index.html; this just makes
// sure the specific weights we draw with have actually finished
// downloading before we paint text — otherwise canvas silently falls
// back to a system font for the first render.
async function ensureShareCardFontsReady() {
    try {
        await Promise.all([
            document.fonts.load('700 58px "Playfair Display"'),
            document.fonts.load('italic 400 36px "Playfair Display"'),
            document.fonts.load('800 40px "Inter"'),
            document.fonts.load('700 24px "Inter"'),
            document.fonts.load('600 30px "Inter"'),
            document.fonts.load('600 26px "Inter"'),
            document.fonts.load('400 24px "Inter"')
        ]);
        await document.fonts.ready;
    } catch (error) {
        // Fine — worst case this draws with a fallback sans/serif font.
    }
}

/**
 * The single reusable renderer. `config` shape:
 *   {
 *     kind: 'verse'|'dailyVerse'|'devotional'|'space'|'profile'|'plan'|'quiz',
 *     eyebrow: 'BIBLE VERSE',      // small label pill
 *     icon: '📖',                  // one emoji, optional
 *     title: 'John 3:16',          // large headline, required
 *     body: '"For God so loved…"',  // optional supporting text/quote
 *     footer: '@username',         // optional small attribution line
 *     tagline: 'Read the Word'     // optional, replaces the default footer tagline
 *   }
 * Every field is plain text — callers are responsible for only passing
 * data that's safe to make public (see the per-type builders below).
 */
async function renderShareCardOntoCanvas(canvas, config) {
    await ensureShareCardFontsReady();

    canvas.width = SHARE_CARD_WIDTH;
    canvas.height = SHARE_CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    const W = SHARE_CARD_WIDTH, H = SHARE_CARD_HEIGHT;
    const accent = SHARE_CARD_ACCENTS[config.kind] || SHARE_CARD_COLORS.gold;
    const marginX = 84;

    // ---- Background: richer multi-stop gradient + soft glow ----
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, SHARE_CARD_COLORS.olive);
    bg.addColorStop(0.55, SHARE_CARD_COLORS.oliveDark);
    bg.addColorStop(1, '#182920');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.82, H * 0.16, 40, W * 0.82, H * 0.16, 720);
    glow.addColorStop(0, accent + '30');
    glow.addColorStop(1, accent + '00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // ---- Background texture: large watermark icon + faint rings, so
    // the card reads as "designed" rather than a flat color fill.
    // Opacity is low enough that body text drawn over it stays legible. ----
    if (config.icon) {
        ctx.save();
        ctx.globalAlpha = 0.09;
        ctx.font = '460px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(config.icon, W + 60, H + 40);
        ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    [[W * 0.1, H * 0.88, 150], [W * 0.92, H * 0.08, 90]].forEach(([cx, cy, r]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    });
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // ---- Wordmark: fixed near the top, acts as a consistent header
    // rather than part of the vertically-centered content block below. ----
    const wordmarkY = 96;
    ctx.font = '800 40px "Inter", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Grace', marginX, wordmarkY);
    const graceWidth = ctx.measureText('Grace').width;
    ctx.fillStyle = accent;
    ctx.fillText('Guide', marginX + graceWidth, wordmarkY);

    // ---- Bottom brand bar position (fixed) ----
    const barY = H - 120;

    // ---- Pre-measure the content block so it can be vertically
    // centered in the space between the wordmark and the brand bar,
    // instead of always starting right under the wordmark and leaving
    // a dead gap below whatever text happens to fit. ----
    const contentTop = wordmarkY + 70;
    const contentBottom = barY - 50;
    const maxTextWidth = W - marginX * 2;
    const pillH = 46;

    let blockHeight = 0;
    if (config.eyebrow) blockHeight += pillH + 44;
    if (config.icon) blockHeight += 82;

    ctx.font = '700 56px "Playfair Display", serif';
    const titleLines = wrapCanvasText(ctx, config.title || 'GraceGuide', maxTextWidth).slice(0, 4);
    blockHeight += titleLines.length * 66 + 20;

    let bodyLines = [];
    if (config.body) {
        ctx.font = 'italic 400 34px "Playfair Display", serif';
        bodyLines = wrapCanvasText(ctx, config.body, maxTextWidth).slice(0, 7);
        blockHeight += bodyLines.length * 48 + 12;
    }

    let footerLines = [];
    if (config.footer) {
        ctx.font = '600 30px "Inter", sans-serif';
        footerLines = wrapCanvasText(ctx, config.footer, maxTextWidth).slice(0, 2);
        blockHeight += footerLines.length * 40;
    }

    let y = contentTop + Math.max(0, (contentBottom - contentTop - blockHeight) / 2);

    // ---- Eyebrow pill ----
    if (config.eyebrow) {
        const eyebrow = config.eyebrow.toUpperCase();
        ctx.font = '700 24px "Inter", sans-serif';
        const eyebrowWidth = ctx.measureText(eyebrow).width;
        const pillPadX = 22;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        roundRectPath(ctx, marginX, y, eyebrowWidth + pillPadX * 2, pillH, pillH / 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.textBaseline = 'middle';
        ctx.fillText(eyebrow, marginX + pillPadX, y + pillH / 2 + 2);
        ctx.textBaseline = 'alphabetic';
        y += pillH + 44;
    }

    // ---- Icon ----
    if (config.icon) {
        ctx.font = '60px sans-serif';
        ctx.fillText(config.icon, marginX, y + 8);
        y += 82;
    }

    // ---- Title ----
    ctx.font = '700 56px "Playfair Display", serif';
    ctx.fillStyle = '#FFFFFF';
    titleLines.forEach(line => {
        ctx.fillText(line, marginX, y);
        y += 66;
    });
    y += 20;

    // ---- Body / quote ----
    if (bodyLines.length > 0) {
        ctx.font = 'italic 400 34px "Playfair Display", serif';
        ctx.fillStyle = SHARE_CARD_COLORS.cream;
        bodyLines.forEach(line => {
            ctx.fillText(line, marginX, y);
            y += 48;
        });
        y += 12;
    }

    // ---- Footer meta line ----
    if (footerLines.length > 0) {
        ctx.font = '600 30px "Inter", sans-serif';
        ctx.fillStyle = accent;
        footerLines.forEach(line => {
            ctx.fillText(line, marginX, y);
            y += 40;
        });
    }

    // ---- Bottom brand bar ----
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(marginX, barY);
    ctx.lineTo(W - marginX, barY);
    ctx.stroke();

    ctx.font = '600 26px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('GraceGuide', marginX, barY + 46);

    ctx.textAlign = 'right';
    ctx.font = '400 24px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(config.tagline || 'Bible • Community • Growth', W - marginX, barY + 46);
    ctx.textAlign = 'left';
}

/* ============================================
   SHARE URL (Phase 3: connected to real deep links)
   ============================================ */
function resolveShareUrl(kind, params = {}) {
    const base = window.location.origin + window.location.pathname;
    switch (kind) {
        case 'verse':
        case 'dailyVerse':
            return (params.book && params.chapter)
                ? `${base}#/bible/${encodeURIComponent(params.book)}/${params.chapter}${params.verse ? '/' + params.verse : ''}`
                : base;
        case 'space-post':
            return params.postId ? `${base}#/space/post/${params.postId}` : base;
        case 'profile':
            return params.uid ? `${base}#/profile/${params.uid}` : base;
        case 'plan':
            return params.shareId ? `${base}#/planner/${params.shareId}` : base;
        case 'quiz-result':
            return params.quizId ? `${base}#/quiz/${params.quizId}` : base;
        case 'devotional':
            return params.shareId ? `${base}#/devotional/${params.shareId}` : base;
        default:
            return base;
    }
}

/** Bible references ("John 3:16", "Genesis 1:1, 2, 3", "Jeremiah 29:11")
    reduced to {book, chapter, verse} for the #/bible/BOOK/CHAPTER/VERSE
    deep link — reuses parsePassageReference() (core.js) for book/chapter
    and just pulls the first verse number mentioned, if any. */
function parseReferenceForDeepLink(reference) {
    if (!reference || typeof parsePassageReference !== 'function') return null;
    const parsed = parsePassageReference(reference);
    if (!parsed) return null;
    const verseMatch = reference.match(/:(\d+)/);
    return { book: parsed.book, chapter: parsed.chapter, verse: verseMatch ? parseInt(verseMatch[1], 10) : null };
}

/* ============================================
   SHARE SHEET (Share Image / Share Link / Image + Link)
   ============================================ */

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareImageOnly(file, title, text) {
    if (!file) {
        showToast('Could not generate the image — please try again.', 'error');
        return;
    }
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title, text });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return; // user cancelled the share sheet — not an error
        }
    }
    downloadBlob(file, file.name);
    showToast('Image saved — you can attach it wherever you\'d like.', 'success');
}

async function shareLinkOnly(url, title, text) {
    if (navigator.share) {
        try {
            await navigator.share({ url, title, text });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied to clipboard!', 'success');
    } catch (error) {
        showToast('Could not copy the link.', 'error');
    }
}

async function shareImageAndLink(file, url, title, text) {
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            // Not every browser actually attaches `url` alongside `files`
            // (some silently drop it), so it's folded into `text` too as
            // a guaranteed fallback.
            await navigator.share({ files: [file], title, text: `${text}\n${url}` });
            return;
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        showToast('Link copied — sharing image next…', 'success');
    } catch (error) { /* not fatal, keep going */ }
    await shareImageOnly(file, title, text);
}

/**
 * Opens the Share sheet: renders `cardConfig` onto a preview canvas,
 * then offers Share Image / Share Link / Image + Link / Download.
 *
 * `options`:
 *   url            - link to share (defaults to resolveShareUrl(cardConfig.kind))
 *   shareTitle     - navigator.share() title
 *   shareText      - navigator.share() text (defaults to a plain-text
 *                    summary built from the card config)
 *   extraButtonsHTML - additional buttons appended below the standard
 *                    ones (e.g. Space post's existing group-share entry)
 *   onExtraButtonsReady - called once the sheet is in the DOM, so a
 *                    caller supplying extraButtonsHTML can wire its own
 *                    listeners
 *
 * Returns a Promise that resolves once the person picks one of the
 * share actions (so callers that need to chain something afterward —
 * e.g. Space's "also share to a group?" follow-up — can await it).
 * If the sheet is dismissed without picking anything, the promise
 * simply never resolves; callers should treat that as "nothing more to
 * do here" rather than relying on a rejection.
 */
function openShareSheet(cardConfig, options = {}) {
    const shareUrl = options.url || resolveShareUrl(cardConfig.kind);
    const shareTitle = options.shareTitle || 'GraceGuide';
    const fallbackText = [cardConfig.title, cardConfig.body].filter(Boolean).join(' — ');
    const shareText = options.shareText || fallbackText || 'Check this out on GraceGuide';

    return new Promise((resolve) => {
        showSheet(`
            <h3 style="margin-bottom: 12px;">Share</h3>
            <div class="share-card-preview-wrap">
                <canvas id="share-card-canvas-preview" class="share-card-preview-canvas" aria-label="Share card preview"></canvas>
                <div class="share-card-preview-loading" id="share-card-preview-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
            </div>
            <div class="share-sheet-actions">
                <button class="btn btn-primary btn-block" id="share-image-btn" disabled>
                    <i class="fas fa-image"></i> Share Image
                </button>
                <button class="btn btn-outline btn-block mt-2" id="share-link-btn">
                    <i class="fas fa-link"></i> Share Link
                </button>
                <button class="btn btn-outline btn-block mt-2" id="share-both-btn" disabled>
                    <i class="fas fa-share-nodes"></i> Image + Link
                </button>
                <button class="btn btn-outline btn-block mt-2" id="share-download-btn" disabled>
                    <i class="fas fa-download"></i> Download Image
                </button>
                ${options.extraButtonsHTML || ''}
            </div>
        `);

        if (typeof options.onExtraButtonsReady === 'function') options.onExtraButtonsReady();

        const canvas = document.getElementById('share-card-canvas-preview');
        const loadingEl = document.getElementById('share-card-preview-loading');

        const linkBtn = document.getElementById('share-link-btn');
        linkBtn?.addEventListener('click', () => {
            closeSheetThen(() => { shareLinkOnly(shareUrl, shareTitle, shareText); resolve(); });
        });

        if (!canvas) { resolve(); return; }

        renderShareCardOntoCanvas(canvas, cardConfig).then(() => {
            canvas.toBlob((blob) => {
                if (loadingEl) loadingEl.remove();
                if (!blob) {
                    showToast('Could not generate the share image.', 'error');
                    return;
                }
                const fileName = `graceguide-${cardConfig.kind || 'share'}-${Date.now()}.png`;
                const file = new File([blob], fileName, { type: 'image/png' });

                const imageBtn = document.getElementById('share-image-btn');
                const bothBtn = document.getElementById('share-both-btn');
                const downloadBtn = document.getElementById('share-download-btn');
                [imageBtn, bothBtn, downloadBtn].forEach(btn => { if (btn) btn.disabled = false; });

                imageBtn?.addEventListener('click', () => {
                    closeSheetThen(() => { shareImageOnly(file, shareTitle, shareText); resolve(); });
                });
                bothBtn?.addEventListener('click', () => {
                    closeSheetThen(() => { shareImageAndLink(file, shareUrl, shareTitle, shareText); resolve(); });
                });
                downloadBtn?.addEventListener('click', () => {
                    closeSheetThen(() => { downloadBlob(file, fileName); showToast('Image saved.', 'success'); resolve(); });
                });
            }, 'image/png', 0.95);
        }).catch((error) => {
            console.error('Error rendering share card:', error);
            if (loadingEl) loadingEl.innerHTML = `<span style="font-size:13px; color: var(--text-slate);">Preview unavailable</span>`;
            showToast('Could not render the preview image, but you can still share the link.', 'warning');
        });
    });
}

/* ============================================
   PER-TYPE BUILDERS
   Each one maps a piece of app data to a normalized card config and
   opens the share sheet. Only ever pass data that's safe to make
   public — see the comments on the devotional/plan builders in
   particular.
   ============================================ */

// 1. Bible verse
function shareVerseCard(reference, text) {
    return openShareSheet({
        kind: 'verse',
        eyebrow: 'Bible Verse',
        icon: '📖',
        title: reference || 'Bible Verse',
        body: text ? `"${text}"` : '',
        tagline: 'Read the Word'
    }, {
        url: resolveShareUrl('verse', parseReferenceForDeepLink(reference) || {}),
        shareTitle: 'GraceGuide — Bible Verse',
        shareText: text ? `"${text}" — ${reference}` : reference
    });
}

// 2. Space post
function shareSpacePostCard(post) {
    const excerpt = post.type === 'video'
        ? ''
        : (post.slides || []).map(s => s.text).filter(Boolean).join(' ');

    return openShareSheet({
        kind: 'space',
        eyebrow: 'Space',
        icon: '🕊️',
        title: post.authorName ? `${post.authorName} shared` : 'Shared on Space',
        body: excerpt ? `"${truncate(excerpt, 150)}"` : (post.type === 'video' ? 'Shared a video reflection' : ''),
        tagline: 'Join the Community'
    }, {
        url: resolveShareUrl('space-post', { postId: post.id }),
        shareTitle: 'GraceGuide — Space',
        shareText: excerpt
            ? `${post.authorName}: ${truncate(excerpt, 150)}`
            : `${post.authorName || 'Someone'} shared on GraceGuide Space`
    });
}

// 3. Profile — only ever built from a person's OWN already-rendered
// public stats (brethren count, post count, streak, quiz %). Never
// pulls notes/bookmarks content, DM/group activity, or anything not
// already visible on their own profile page.
function shareProfileCard() {
    if (!AppState.currentUser) return Promise.resolve();
    const profile = AppState.userProfile || {};
    const brethrenCount = Array.from(AppState.userConnections.values()).filter(s => s === 'brethren').length;

    const buildAndOpen = (accumulatedPercentage) => {
        const statsLine = [
            `${brethrenCount} Brethren`,
            `${AppState.spacePostCount ?? 0} Posts`,
            accumulatedPercentage != null ? `${accumulatedPercentage}% Quiz Score` : null
        ].filter(Boolean).join('  •  ');

        return openShareSheet({
            kind: 'profile',
            eyebrow: 'My Profile',
            icon: '🙏',
            title: profile.username || 'GraceGuide',
            body: profile.bio ? truncate(profile.bio, 120) : '',
            footer: statsLine,
            tagline: 'Growing Together'
        }, {
            url: resolveShareUrl('profile', { uid: AppState.currentUser.uid }),
            shareTitle: 'GraceGuide — Profile',
            shareText: `${profile.username || 'My'} GraceGuide profile — ${statsLine}`
        });
    };

    return database.ref(`quizLeaderboardAllTime/${AppState.currentUser.uid}`).once('value')
        .then(snap => buildAndOpen(snap.val()?.accumulatedPercentage ?? null))
        .catch(() => buildAndOpen(null));
}

// 4. Reading plan — deliberately shares only a SUMMARY (name, overall
// progress, and the single next/current day's passage+topic), never
// the full multi-day schedule with every date/completion status. That
// full itinerary is personal planning data, not something to publish.
//
// The share link (#/planner/SHARE_ID) resolves to a PUBLIC snapshot
// under plannerShares/{shareId} — never users/{uid}/planner directly.
// shareId is deterministic (uid_planId) so re-sharing the same plan
// reuses/refreshes the same link instead of spawning duplicates.
function sharePlanCard(plan) {
    if (!plan) return;
    const nextDay = (plan.days || []).find(d => !d.completed) || plan.days?.[0];
    const shareId = AppState.currentUser ? `${AppState.currentUser.uid}_${plan.id}` : null;

    if (shareId) {
        // Best-effort — the share sheet itself doesn't wait on this, and
        // if it fails the link just won't resolve yet rather than
        // blocking the person from sharing the image/text at all.
        database.ref(`plannerShares/${shareId}`).set({
            ownerId: AppState.currentUser.uid,
            ownerName: AppState.userProfile?.username || 'A GraceGuide user',
            name: plan.name || 'Study Plan',
            progress: plan.progress || 0,
            streak: plan.streak || 0,
            currentPassage: nextDay?.passage || '',
            currentTopic: nextDay?.topic || '',
            updatedAt: Date.now()
        }).catch(error => console.error('Error saving plan share snapshot:', error));
    }

    return openShareSheet({
        kind: 'plan',
        eyebrow: 'Reading Plan',
        icon: '📅',
        title: plan.name || 'My Study Plan',
        body: nextDay ? `Currently reading: ${nextDay.passage}${nextDay.topic ? ` — ${nextDay.topic}` : ''}` : '',
        footer: `${plan.progress || 0}% complete • ${plan.streak || 0}-day streak`,
        tagline: 'Study Together'
    }, {
        url: resolveShareUrl('plan', { shareId }),
        shareTitle: 'GraceGuide — Study Plan',
        shareText: `I'm ${plan.progress || 0}% through "${plan.name}" on GraceGuide!`
    });
}

// 5. Quiz result — score only, never the per-question answer breakdown.
// `quizId` (the round's startTime, same id used for both
// quizCompetition/current and quizCompetition/history/{startTime}) is
// optional — omitted, the link just falls back to the generic app URL
// rather than a dead #/quiz/undefined.
function shareQuizResultCard(result, quizId) {
    if (!result) return;
    const percentage = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;

    return openShareSheet({
        kind: 'quiz',
        eyebrow: 'Weekly Bible Quiz',
        icon: '🏆',
        title: `${result.score}/${result.total}`,
        body: `${percentage}% on this week's GraceGuide Bible Quiz!`,
        tagline: 'Think you can beat me?'
    }, {
        url: resolveShareUrl('quiz-result', { quizId }),
        shareTitle: 'GraceGuide — Weekly Quiz',
        shareText: `I scored ${result.score}/${result.total} (${percentage}%) on this week's GraceGuide Bible Quiz!`
    });
}

// 5b. Upcoming quiz (countdown, not yet started) — invites others to
// join once it opens. Uses the same #/quiz/QUIZ_ID deep link as a
// completed result; renderSharedQuizPage() (quiz.js) already resolves
// that id against the live/current round first, so this correctly
// lands on the not-yet-started round rather than a dead link.
function shareUpcomingQuizCard(startTime) {
    if (!startTime) return;
    const dateStr = formatDate(startTime);

    return openShareSheet({
        kind: 'quiz',
        eyebrow: 'Weekly Bible Quiz',
        icon: '🏆',
        title: 'Quiz Opens Soon',
        body: `Join me for this week's GraceGuide Bible Quiz — opens ${dateStr}!`,
        tagline: 'Think you know your Bible?'
    }, {
        url: resolveShareUrl('quiz-result', { quizId: startTime }),
        shareTitle: 'GraceGuide — Weekly Quiz',
        shareText: `Join me for this week's GraceGuide Bible Quiz — opens ${dateStr}. Think you know your Bible?`
    });
}

// 6. Daily verse
function shareDailyVerseCard(verse) {
    if (!verse) return;
    return openShareSheet({
        kind: 'dailyVerse',
        eyebrow: "Today's Verse",
        icon: '✨',
        title: verse.reference || 'Verse of the Day',
        body: verse.text ? `"${verse.text}"` : '',
        tagline: 'Daily Verse'
    }, {
        url: resolveShareUrl('dailyVerse', parseReferenceForDeepLink(verse.reference) || {}),
        shareTitle: 'GraceGuide — Verse of the Day',
        shareText: verse.text ? `"${verse.text}" — ${verse.reference}` : verse.reference
    });
}

// 7. Daily devotional — title + verse + prayer prompt ONLY. The
// devotional's `body` is deliberately excluded: it's AI-personalized
// using this specific user's reading/quiz/planner/Ask activity (see
// buildDevotionalPersonalizationContext in core.js), so it can reference
// details about them that shouldn't end up in a publicly shared image.
//
// Same public-snapshot approach as sharePlanCard(): the share link
// resolves to devotionalShares/{shareId}, which only ever contains the
// same safe fields the card itself shows — the private/personalized
// body is never written there.
function shareDevotionalCard(devotional) {
    if (!devotional) return;
    const bodyLine = devotional.verseText
        ? `"${devotional.verseText}"`
        : (devotional.prayerPrompt || '');
    const shareId = (AppState.currentUser && devotional.date) ? `${AppState.currentUser.uid}_${devotional.date}` : null;

    if (shareId) {
        // Best-effort, same reasoning as sharePlanCard()'s snapshot
        // write — only ever the safe fields, deliberately never
        // `devotional.body`. prayerPoints ARE included: unlike body,
        // they're generated to be generic/non-personal from the start
        // (see the system prompt in generateDevotionalWithAI), so
        // there's real, usable content for anyone who opens the link.
        database.ref(`devotionalShares/${shareId}`).set({
            ownerId: AppState.currentUser.uid,
            ownerName: AppState.userProfile?.username || 'A GraceGuide user',
            title: devotional.title || "Today's Devotional",
            verseReference: devotional.verseReference || '',
            verseText: devotional.verseText || '',
            prayerPrompt: devotional.prayerPrompt || '',
            prayerPoints: Array.isArray(devotional.prayerPoints) ? devotional.prayerPoints : [],
            updatedAt: Date.now()
        }).catch(error => console.error('Error saving devotional share snapshot:', error));
    }

    return openShareSheet({
        kind: 'devotional',
        eyebrow: 'Daily Devotional',
        icon: '🌅',
        title: devotional.title || "Today's Devotional",
        body: bodyLine,
        footer: devotional.verseReference || '',
        tagline: 'Daily Devotional'
    }, {
        url: resolveShareUrl('devotional', { shareId }),
        shareTitle: 'GraceGuide — Daily Devotional',
        shareText: `Today's devotional on GraceGuide: "${devotional.title}"${devotional.verseReference ? ` (${devotional.verseReference})` : ''}`
    });
}

window.openShareSheet = openShareSheet;
window.shareVerseCard = shareVerseCard;
window.shareSpacePostCard = shareSpacePostCard;
window.shareProfileCard = shareProfileCard;
window.sharePlanCard = sharePlanCard;
window.shareQuizResultCard = shareQuizResultCard;
window.shareUpcomingQuizCard = shareUpcomingQuizCard;
window.shareDailyVerseCard = shareDailyVerseCard;
window.shareDevotionalCard = shareDevotionalCard;
