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
    cream: 'rgba(248,246,240,0.94)',
    creamSolid: '#F8F6F0',
    goldBright: '#E3C46F'
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
// back to a system font for the first render. Font Awesome (already
// loaded for the UI) supplies the label-pill glyph.
async function ensureShareCardFontsReady() {
    try {
        await Promise.all([
            document.fonts.load('700 92px "Playfair Display"'),
            document.fonts.load('italic 400 46px "Playfair Display"'),
            document.fonts.load('800 42px "Inter"'),
            document.fonts.load('600 30px "Inter"'),
            document.fonts.load('500 28px "Inter"'),
            document.fonts.load('900 30px "Font Awesome 6 Free"', '')
        ]);
        await document.fonts.ready;
    } catch (error) {
        // Fine — worst case this draws with a fallback sans/serif font.
    }
}

// The real leaf logo for the card header (same file the app uses).
let shareCardLogoPromise = null;
function loadShareCardLogo() {
    if (!shareCardLogoPromise) {
        shareCardLogoPromise = new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = 'img/logo.png';
        });
    }
    return shareCardLogoPromise;
}

// Font Awesome glyph for the label pill, per card kind.
function shareCardGlyph(config) {
    if (/streak/i.test(config.eyebrow || '')) return ''; // fire
    switch (config.kind) {
        case 'verse':
        case 'dailyVerse': return ''; // book-open
        case 'devotional': return ''; // sun
        case 'space': return ''; // dove
        case 'profile': return ''; // user
        case 'plan': return ''; // calendar-check
        case 'quiz': return ''; // trophy
        default: return '';
    }
}

// Wraps into at most `max` lines, ending with an ellipsis when cut.
function wrapCanvasTextMax(ctx, text, maxWidth, max) {
    const all = wrapCanvasText(ctx, text, maxWidth);
    if (all.length <= max) return all;
    const kept = all.slice(0, max);
    let last = kept[kept.length - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) {
        last = last.includes(' ') ? last.slice(0, last.lastIndexOf(' ')) : '';
    }
    kept[kept.length - 1] = last.replace(/[,;:.\s]+$/, '') + '…';
    return kept;
}

// Four-point sparkle (✦) centred on (cx, cy).
function sparklePath(ctx, cx, cy, r) {
    const k = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
    ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
    ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
    ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
    ctx.closePath();
}

// Letter-spaced text drawn glyph by glyph (ctx.letterSpacing isn't
// supported everywhere yet).
function spacedTextWidth(ctx, text, spacing) {
    return [...text].reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * Math.max(0, text.length - 1);
}
function drawSpacedText(ctx, text, x, y, spacing) {
    let cx = x;
    [...text].forEach(ch => {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + spacing;
    });
}

/**
 * The single reusable renderer (mirrors ShareCards.render() in the
 * Android app, so a card looks the same wherever it was made). `config`:
 *   {
 *     kind: 'verse'|'dailyVerse'|'devotional'|'space'|'profile'|'plan'|'quiz',
 *     eyebrow: 'Bible Verse',      // label in the pill
 *     icon: '📖',                  // (legacy; the pill glyph is chosen by kind)
 *     title: 'John 3:16',          // large headline, required
 *     body: '“For God so loved…”',  // optional supporting text/quote
 *     footer: '@username',         // optional small gold line under the body
 *     tagline: 'Read the Word'     // bottom-left label
 *   }
 * Every field is plain text — callers are responsible for only passing
 * data that's safe to make public (see the per-type builders below).
 */
async function renderShareCardOntoCanvas(canvas, config) {
    await ensureShareCardFontsReady();
    const logo = await loadShareCardLogo();

    canvas.width = SHARE_CARD_WIDTH;
    canvas.height = SHARE_CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    const W = SHARE_CARD_WIDTH, H = SHARE_CARD_HEIGHT;
    const C = SHARE_CARD_COLORS;
    const marginX = 84;

    // ---- Background: deep emerald with a warm gold glow in the top-right ----
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1D4A36');
    bg.addColorStop(0.5, '#123826');
    bg.addColorStop(1, '#082418');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.98, H * 0.02, 0, W * 0.98, H * 0.02, 520);
    glow.addColorStop(0, 'rgba(201,180,86,0.55)');
    glow.addColorStop(0.45, 'rgba(184,166,78,0.2)');
    glow.addColorStop(1, 'rgba(184,166,78,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const glow2 = ctx.createRadialGradient(W * 0.15, H * 0.55, 0, W * 0.15, H * 0.55, 700);
    glow2.addColorStop(0, 'rgba(95,211,165,0.10)');
    glow2.addColorStop(1, 'rgba(95,211,165,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // ---- Decorative gold rings + sparkle stars ----
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(227,196,111,0.6)';
    ctx.beginPath(); ctx.arc(W - 30, 30, 200, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(227,196,111,0.35)';
    ctx.beginPath(); ctx.arc(46, H - 200, 190, 0, Math.PI * 2); ctx.stroke();
    const star = ctx.createLinearGradient(W * 0.7, H * 0.65, W, H);
    star.addColorStop(0, 'rgba(167,178,74,0.4)');
    star.addColorStop(1, 'rgba(104,128,58,0.2)');
    ctx.fillStyle = star;
    sparklePath(ctx, W * 0.86, H * 0.83, 150); ctx.fill();
    sparklePath(ctx, W * 0.745, H * 0.765, 52); ctx.fill();

    // ---- Header: leaf logo + GraceGuide wordmark (top-left), spaced motto (top-right) ----
    const headerY = 112;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (logo) ctx.drawImage(logo, marginX - 6, headerY - 58, 72, 72);
    const brandX = marginX + 78;
    ctx.font = '800 42px "Inter", sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Grace', brandX, headerY);
    ctx.fillStyle = C.goldBright;
    ctx.fillText('Guide', brandX + ctx.measureText('Grace').width, headerY);
    ctx.font = '500 21px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(248,246,240,0.65)';
    const motto = 'FAITH • GROWTH • LIFE';
    drawSpacedText(ctx, motto, W - marginX - spacedTextWidth(ctx, motto, 6), headerY - 12, 6);

    // ---- Footer rule: label left, reference/site right ----
    const footY = H - 150;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(marginX, footY); ctx.lineTo(W - marginX, footY); ctx.stroke();
    ctx.font = '500 28px "Inter", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(config.tagline || 'GraceGuide', marginX, footY + 52);
    const title = config.title || 'GraceGuide';
    const right = ((config.kind === 'verse' || config.kind === 'dailyVerse') && title.length <= 30) ? title : 'graceguide.com.ng';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(right, W - marginX, footY + 52);
    ctx.textAlign = 'left';

    // ---- Glass card: measure its content, shrinking type until it fits ----
    const cardL = marginX, cardR = W - marginX;
    const pad = 66;
    const textW = cardR - cardL - pad * 2;
    const areaTop = headerY + 80, areaBottom = footY - 60;
    const pillH = 76;
    let titleSize = 92, bodySize = 46;
    let titleLines, bodyLines, footLines, contentH;
    for (;;) {
        ctx.font = `700 ${titleSize}px "Playfair Display", serif`;
        titleLines = wrapCanvasTextMax(ctx, title, textW, 3);
        ctx.font = `italic 400 ${bodySize}px "Playfair Display", serif`;
        bodyLines = config.body ? wrapCanvasTextMax(ctx, config.body, textW, 9) : [];
        ctx.font = '600 30px "Inter", sans-serif';
        footLines = config.footer ? wrapCanvasTextMax(ctx, config.footer, textW, 2) : [];
        contentH = pillH + 48 + 56 + titleLines.length * titleSize * 1.12 + 34 + 12
            + (bodyLines.length ? 44 + bodyLines.length * bodySize * 1.42 : 0)
            + (footLines.length ? 30 + footLines.length * 42 : 0);
        if (contentH + pad * 2 <= areaBottom - areaTop || (titleSize <= 56 && bodySize <= 30)) break;
        titleSize = Math.max(56, titleSize - 6);
        bodySize = Math.max(30, bodySize - 2);
    }
    const cardH = Math.min(areaBottom - areaTop, Math.max(560, contentH + pad * 2));
    const cardT = areaTop + (areaBottom - areaTop - cardH) / 2;
    const cardB = cardT + cardH;
    const radius = 46;

    // Soft drop shadow + frosted fill.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 22;
    const fill = ctx.createLinearGradient(cardL, cardT, cardR, cardB);
    fill.addColorStop(0, '#1F5A43');
    fill.addColorStop(0.55, '#134230');
    fill.addColorStop(1, '#0E3627');
    ctx.fillStyle = fill;
    roundRectPath(ctx, cardL, cardT, cardR - cardL, cardH, radius);
    ctx.fill();
    ctx.restore();
    // The lighter teal sweep tucked into the bottom-right corner, edged in gold.
    ctx.save();
    roundRectPath(ctx, cardL, cardT, cardR - cardL, cardH, radius);
    ctx.clip();
    const sweepS = 560;
    const sx = cardR + sweepS * 0.78, sy = cardB + sweepS * 0.78, sr = sweepS * 1.415;
    const sweep = ctx.createLinearGradient(cardR - 200, cardB - 200, cardR, cardB);
    sweep.addColorStop(0, 'rgba(79,199,160,0.15)');
    sweep.addColorStop(1, 'rgba(79,199,160,0.28)');
    ctx.fillStyle = sweep;
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(227,196,111,0.7)';
    ctx.lineWidth = 3;
    ctx.stroke();
    const sheen = ctx.createLinearGradient(0, cardT, 0, cardT + cardH * 0.45);
    sheen.addColorStop(0, 'rgba(255,255,255,0.08)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(cardL, cardT, cardR - cardL, cardH * 0.45);
    ctx.restore();
    // Gold-to-teal glowing edge.
    const edge = ctx.createLinearGradient(cardL, cardB, cardR, cardT);
    edge.addColorStop(0, 'rgba(232,205,122,0.95)');
    edge.addColorStop(0.35, 'rgba(63,168,138,0.6)');
    edge.addColorStop(0.7, 'rgba(63,168,138,0.6)');
    edge.addColorStop(1, 'rgba(232,205,122,0.95)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    roundRectPath(ctx, cardL, cardT, cardR - cardL, cardH, radius);
    ctx.stroke();

    // ---- Card content ----
    const x = cardL + pad;
    let y = cardT + pad + Math.max(0, cardH - pad * 2 - contentH) / 2;
    // Label pill: glyph | EYEBROW
    const label = (config.eyebrow || 'GraceGuide').toUpperCase();
    const glyph = shareCardGlyph(config);
    ctx.font = '900 30px "Font Awesome 6 Free"';
    const glyphW = ctx.measureText(glyph).width;
    ctx.font = '600 25px "Inter", sans-serif';
    const pillW = 34 + glyphW + 56 + spacedTextWidth(ctx, label, 5) + 38;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRectPath(ctx, x, y, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(95,211,165,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    const mid = y + pillH / 2;
    ctx.font = '900 30px "Font Awesome 6 Free"';
    ctx.fillStyle = C.goldBright;
    ctx.fillText(glyph, x + 34, mid + 11);
    const divX = x + 34 + glyphW + 28;
    ctx.strokeStyle = C.goldBright;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(divX, mid - 18); ctx.lineTo(divX, mid + 18); ctx.stroke();
    ctx.font = '600 25px "Inter", sans-serif';
    ctx.fillStyle = C.creamSolid;
    drawSpacedText(ctx, label, divX + 28, mid + 9, 5);
    y += pillH + 48;
    // Sparkles above the title.
    const spark = ctx.createLinearGradient(x, y, x + 50, y + 56);
    spark.addColorStop(0, '#FFE08A');
    spark.addColorStop(1, '#E0A93A');
    ctx.fillStyle = spark;
    sparklePath(ctx, x + 22, y + 32, 24); ctx.fill();
    sparklePath(ctx, x + 50, y + 10, 11); ctx.fill();
    y += 56;
    // Title
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.font = `700 ${titleSize}px "Playfair Display", serif`;
    ctx.fillStyle = '#FFFFFF';
    titleLines.forEach(line => {
        ctx.fillText(line, x, y + titleSize * 0.92);
        y += titleSize * 1.12;
    });
    ctx.restore();
    // Gold underline
    y += 22;
    const bar = ctx.createLinearGradient(x, y, x + 116, y);
    bar.addColorStop(0, '#FFD66B');
    bar.addColorStop(1, C.gold);
    ctx.fillStyle = bar;
    roundRectPath(ctx, x, y, 116, 11, 5.5);
    ctx.fill();
    y += 12;
    // Body (italic serif quote)
    if (bodyLines.length) {
        y += 44;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetY = 3;
        ctx.font = `italic 400 ${bodySize}px "Playfair Display", serif`;
        ctx.fillStyle = C.creamSolid;
        bodyLines.forEach(line => {
            ctx.fillText(line, x, y + bodySize * 0.95);
            y += bodySize * 1.42;
        });
        ctx.restore();
    }
    if (footLines.length) {
        y += 30;
        ctx.font = '600 30px "Inter", sans-serif';
        ctx.fillStyle = C.goldBright;
        footLines.forEach(line => {
            ctx.fillText(line, x, y + 30);
            y += 42;
        });
    }
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
        body: text ? `“${text}”` : '',
        tagline: 'Bible Verse'
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
    // Current profile name, not the copy stored on the post.
    const authorName = getDisplayName(post.authorId, post.authorName || null);

    return openShareSheet({
        kind: 'space',
        eyebrow: 'Space',
        icon: '🕊️',
        title: authorName ? `${authorName} shared` : 'Shared on Space',
        body: excerpt ? `“${truncate(excerpt, 150)}”` : (post.type === 'video' ? 'Shared a video reflection' : ''),
        tagline: 'Join the Community'
    }, {
        url: resolveShareUrl('space-post', { postId: post.id }),
        shareTitle: 'GraceGuide — Space',
        shareText: excerpt
            ? `${authorName}: ${truncate(excerpt, 150)}`
            : `${authorName || 'Someone'} shared on GraceGuide Space`
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
/** Writes/refreshes the PUBLIC summary snapshot a plan share link resolves
    to and returns its shareId (null for guests). Best-effort — the share
    sheet never waits on it, and if it fails the link just won't resolve
    yet rather than blocking the person from sharing at all. */
function savePlanShareSnapshot(plan) {
    if (!plan || !AppState.currentUser) return null;
    const nextDay = (plan.days || []).find(d => !d.completed) || plan.days?.[0];
    const shareId = `${AppState.currentUser.uid}_${plan.id}`;
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
    return shareId;
}

function sharePlanCard(plan) {
    if (!plan) return;
    const nextDay = (plan.days || []).find(d => !d.completed) || plan.days?.[0];
    const shareId = savePlanShareSnapshot(plan);

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

// 4b. Study streak — consecutive days of completed Study Planner entries.
// Links to the active plan's public summary snapshot (which includes the
// streak), never the private day-by-day plan.
function shareStudyStreakCard() {
    const streak = typeof computeStudyStreak === 'function' ? computeStudyStreak() : { count: 0, best: 0 };
    const plan = AppState.currentPlan;
    if (plan) plan.streak = streak.count;
    const shareId = savePlanShareSnapshot(plan);
    const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

    const body = streak.count > 0
        ? `I've studied the Bible ${days(streak.count)} in a row${plan ? ` with "${plan.name || 'my study plan'}"` : ''}.`
        : "I'm building a daily Bible study habit on GraceGuide.";

    return openShareSheet({
        kind: 'plan',
        eyebrow: 'Study Streak',
        icon: '🔥',
        title: streak.count > 0 ? `${days(streak.count)} of study` : 'Starting My Study Streak',
        body,
        footer: `Best streak: ${days(streak.best || streak.count)}`,
        tagline: 'Study Together'
    }, {
        url: resolveShareUrl('plan', { shareId }),
        shareTitle: 'GraceGuide — Study Streak',
        shareText: streak.count > 0
            ? `🔥 I'm on a ${days(streak.count)} Bible study streak on GraceGuide! Join me.`
            : "I'm starting a daily Bible study streak on GraceGuide — join me!"
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
        body: verse.text ? `“${verse.text}”` : '',
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
        ? `“${devotional.verseText}”`
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
