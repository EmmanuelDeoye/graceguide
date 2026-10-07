/* ============================================
   GraceGuide — js/messaging.js
   Load AFTER core.js, features.js and community.js.
   Shared conversation features used by the Shepherd chat, Forum group
   chats and one-to-one Chats:
     - Bible references typed in messages ("John 3:16", "John 3:16-18",
       "Psalm 23", "1 Cor 13:4-7") are recognised, linked, and rendered
       as verse cards with the actual Scripture text.
     - Long-press (touch) / click or right-click (desktop) a message to
       reveal a compact action toolbar beneath it — never shown permanently.
     - Reply to a message (quoted above the input and inside the sent
       message), edit and delete your own messages.
     - Enter never sends on touch keyboards; it inserts a new line.
   ============================================ */

/* ============================================
   BIBLE REFERENCE DETECTION
   ============================================ */
const BIBLE_REF_ALIASES = (() => {
    const map = {};
    const add = (alias, book) => { map[alias.toLowerCase()] = book; };

    getBibleBooks().forEach(book => add(book, book));
    add('Psalms', 'Psalm');
    add('Song of Songs', 'Song of Solomon');
    add('Songs', 'Song of Solomon');

    const abbreviations = {
        Gen: 'Genesis', Exod: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
        Josh: 'Joshua', Judg: 'Judges', Neh: 'Nehemiah', Esth: 'Esther', Ps: 'Psalm', Psa: 'Psalm',
        Prov: 'Proverbs', Eccl: 'Ecclesiastes', Eccles: 'Ecclesiastes', Isa: 'Isaiah', Jer: 'Jeremiah',
        Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea', Obad: 'Obadiah', Mic: 'Micah',
        Nah: 'Nahum', Hab: 'Habakkuk', Zeph: 'Zephaniah', Hag: 'Haggai', Zech: 'Zechariah', Mal: 'Malachi',
        Matt: 'Matthew', Mt: 'Matthew', Mk: 'Mark', Lk: 'Luke', Jn: 'John', Rom: 'Romans',
        Gal: 'Galatians', Eph: 'Ephesians', Phil: 'Philippians', Col: 'Colossians', Heb: 'Hebrews',
        Jas: 'James', Rev: 'Revelation', Philem: 'Philemon'
    };
    Object.entries(abbreviations).forEach(([alias, book]) => add(alias, book));

    // Numbered books: "1 Corinthians", "1Cor", "2 Tim", "1 Jn", ...
    const numbered = {
        Samuel: ['Samuel', 'Sam'], Kings: ['Kings', 'Kgs'], Chronicles: ['Chronicles', 'Chron', 'Chr'],
        Corinthians: ['Corinthians', 'Cor'], Thessalonians: ['Thessalonians', 'Thess'],
        Timothy: ['Timothy', 'Tim'], Peter: ['Peter', 'Pet'], John: ['John', 'Jn']
    };
    [1, 2, 3].forEach(n => {
        Object.entries(numbered).forEach(([base, aliases]) => {
            const book = `${n} ${base}`;
            if (!BIBLE_BOOK_CHAPTERS[book]) return;
            aliases.forEach(alias => {
                add(`${n} ${alias}`, book);
                add(`${n}${alias}`, book);
            });
        });
    });
    return map;
})();

const BIBLE_REF_REGEX = (() => {
    const alternation = Object.keys(BIBLE_REF_ALIASES)
        .sort((a, b) => b.length - a.length)
        .map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
        .join('|');
    return new RegExp(`(^|[^A-Za-z0-9])(${alternation})\\.?\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?![\\d:A-Za-z])`, 'gi');
})();

/** Every valid Bible reference in `text`, as
    [{ start, end, raw, book, chapter, from, to, label }]. */
function findBibleReferences(text) {
    const results = [];
    if (!text || typeof text !== 'string') return results;
    BIBLE_REF_REGEX.lastIndex = 0;
    let match;
    while ((match = BIBLE_REF_REGEX.exec(text)) !== null) {
        const [whole, prefix, bookRaw, chapterRaw, fromRaw, toRaw] = match;
        const book = BIBLE_REF_ALIASES[bookRaw.toLowerCase().replace(/\s+/g, ' ')];
        const chapter = parseInt(chapterRaw, 10);
        const from = fromRaw ? parseInt(fromRaw, 10) : null;
        let to = toRaw ? parseInt(toRaw, 10) : from;

        if (!book || !chapter || chapter > getBookChapterCount(book)) continue;
        // Without a verse ("Psalm 23") only accept a capitalised book name,
        // so everyday phrases like "my job 2 days" or "acts 3 times" aren't
        // mistaken for Scripture. With a verse ("john 3:16") any case is fine.
        const firstLetter = bookRaw.replace(/^\d\s*/, '')[0];
        if (!from && firstLetter !== firstLetter.toUpperCase()) continue;
        if (from === 0 || (to && to < from)) to = from;

        const start = match.index + prefix.length;
        const label = `${book} ${chapter}${from ? `:${from}${to && to !== from ? `-${to}` : ''}` : ''}`;
        results.push({ start, end: match.index + whole.length, raw: whole.slice(prefix.length), book, chapter, from, to, label });
    }
    return results;
}

/** Escapes plain message text, turns Bible references into links and
    keeps the sender's line breaks. */
function renderRichMessageText(text) {
    const source = String(text || '');
    const refs = findBibleReferences(source);
    let html = '';
    let cursor = 0;
    refs.forEach(ref => {
        html += escapeHtml(source.slice(cursor, ref.start));
        const safeLabel = ref.label.replace(/'/g, "\\'");
        html += `<a href="#" class="bible-ref-link" onclick="event.preventDefault(); event.stopPropagation(); openPassageReference('${safeLabel}')">${escapeHtml(ref.raw)}</a>`;
        cursor = ref.end;
    });
    html += escapeHtml(source.slice(cursor));
    return html.replace(/\n/g, '<br>');
}

/** Verse cards for the (first few, de-duplicated) references in `text`.
    Filled in with real Scripture by hydrateVerseCards(). */
function renderVerseCardsHTML(text, max = 2) {
    const seen = new Set();
    const refs = findBibleReferences(text).filter(ref => {
        if (seen.has(ref.label)) return false;
        seen.add(ref.label);
        return true;
    }).slice(0, max);
    if (refs.length === 0) return '';

    return `<div class="msg-verse-cards">${refs.map(ref => `
        <div class="msg-verse-card" role="button" tabindex="0"
             data-book="${escapeHtml(ref.book)}" data-chapter="${ref.chapter}" data-from="${ref.from || ''}" data-to="${ref.to || ''}"
             onclick="event.stopPropagation(); openBibleChapter('${ref.book.replace(/'/g, "\\'")}', ${ref.chapter}${ref.from ? `, ${ref.from}` : ''})">
            <div class="msg-verse-card-ref"><i class="fas fa-book-bible"></i> ${escapeHtml(ref.label)} <span class="msg-verse-card-version">${escapeHtml(AppState.bibleVersion || 'KJV')}</span></div>
            <div class="msg-verse-card-text"><span class="msg-verse-card-loading">Loading verse…</span></div>
        </div>
    `).join('')}</div>`;
}

const VERSE_CARD_MAX_VERSES = 8;
const VERSE_CARD_CHAPTER_PREVIEW = 2;

/** Fetches (cache-first — see fetchBibleChapter) and fills every verse card
    under `root` that hasn't been filled yet. */
function hydrateVerseCards(root = document) {
    if (!root) return;
    $$('.msg-verse-card:not([data-hydrated])', root).forEach(async (card) => {
        card.dataset.hydrated = '1';
        const book = card.dataset.book;
        const chapter = parseInt(card.dataset.chapter, 10);
        const from = parseInt(card.dataset.from, 10) || null;
        const to = parseInt(card.dataset.to, 10) || from;
        const textEl = card.querySelector('.msg-verse-card-text');
        try {
            const verses = await fetchBibleChapter(book, chapter, AppState.bibleVersion);
            let picked = from ? verses.filter(v => v.verse >= from && v.verse <= to) : verses.slice(0, VERSE_CARD_CHAPTER_PREVIEW);
            const truncated = from ? picked.length > VERSE_CARD_MAX_VERSES : verses.length > VERSE_CARD_CHAPTER_PREVIEW;
            picked = picked.slice(0, VERSE_CARD_MAX_VERSES);
            if (picked.length === 0) {
                textEl.innerHTML = `<span class="msg-verse-card-loading">That verse isn't in ${escapeHtml(book)} ${chapter} — tap to open the chapter.</span>`;
                return;
            }
            const numbered = picked.length > 1 || !from;
            textEl.innerHTML = picked.map(v => `${numbered ? `<sup>${v.verse}</sup>` : ''}${escapeHtml(v.text)}`).join(' ')
                + (truncated ? ` <span class="msg-verse-card-more">… Read more</span>` : '');
        } catch (error) {
            textEl.innerHTML = `<span class="msg-verse-card-loading">Tap to read in the Bible.</span>`;
        }
    });
}

/* ============================================
   INPUTS: Enter behaviour + auto-grow
   ============================================ */
function autoGrowTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

/** Desktop: Enter sends, Shift+Enter is a new line. Touch keyboards: Enter
    is always a new line — sending only happens via the Send button. */
function handleMessageInputKeydown(event, sendFn) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !isTouchPrimaryDevice()) {
        event.preventDefault();
        sendFn();
        return;
    }
    if (event.key === 'Escape') {
        if (event.target.id && event.target.id === ChatThread.inputId) cancelComposerContext();
        else if (event.target.id === 'chat-input') cancelShepherdReply();
    }
    setTimeout(() => autoGrowTextarea(event.target), 0);
}

/* ============================================
   MESSAGE ACTION TOOLBAR (long-press / select)
   ============================================ */
let _openMessageActions = null;

/** Wires long-press (touch or mouse hold), right-click, and — on desktop —
    a plain click on a message to `onSelect(el, { toggle })`. Bound once per
    container via event delegation, so re-rendered messages keep working. */
function bindMessageGestures(container, selector, onSelect) {
    if (!container || container._messageGesturesBound) return;
    container._messageGesturesBound = true;

    const LONG_PRESS_MS = 450;
    const IGNORE = 'a, button, textarea, input, .msg-action-bar, .msg-verse-card, .msg-reply-quote, .group-msg-author, .group-msg-plan, .group-msg-reel, .ai-action-widget, .crisis-banner';
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longPressFired = false;
    let suppressClickUntil = 0;

    const cancel = () => { clearTimeout(timer); timer = null; };

    container.addEventListener('pointerdown', (e) => {
        longPressFired = false;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const el = e.target.closest(selector);
        if (!el || !container.contains(el) || e.target.closest('.msg-action-bar, textarea, input')) return;
        startX = e.clientX;
        startY = e.clientY;
        cancel();
        timer = setTimeout(() => {
            timer = null;
            longPressFired = true;
            if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* unsupported */ } }
            onSelect(el, { toggle: false });
        }, LONG_PRESS_MS);
    });
    container.addEventListener('pointermove', (e) => {
        if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) cancel();
    });
    ['pointerup', 'pointercancel'].forEach(type => container.addEventListener(type, () => {
        cancel();
        // Some browsers follow a long-press release with a click; only that
        // immediate click is swallowed (so it can't also follow a link).
        if (longPressFired) suppressClickUntil = Date.now() + 350;
        longPressFired = false;
    }));
    container.addEventListener('scroll', cancel, { passive: true });

    container.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil && !e.target.closest('.msg-action-bar')) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickUntil = 0;
            return;
        }
        if (isTouchPrimaryDevice()) return;
        const el = e.target.closest(selector);
        if (!el || !container.contains(el) || e.target.closest(IGNORE)) return;
        if (window.getSelection && String(window.getSelection()).trim()) return; // selecting text, not the message
        onSelect(el, { toggle: true });
    }, true);

    container.addEventListener('contextmenu', (e) => {
        const el = e.target.closest(selector);
        if (!el || !container.contains(el) || e.target.closest('textarea, input')) return;
        e.preventDefault();
        cancel();
        if (_openMessageActions && _openMessageActions.anchor === el) return;
        onSelect(el, { toggle: false });
    });
}

/** Shows a compact icon toolbar directly beneath `anchorEl`.
    actions: [{ icon, label, onClick, danger }] */
function openMessageActions(anchorEl, actions, options = {}) {
    const { align = 'start', toggle = false } = options;
    if (toggle && _openMessageActions && _openMessageActions.anchor === anchorEl) {
        closeMessageActions();
        return;
    }
    closeMessageActions();
    if (!anchorEl || actions.length === 0) return;

    const bar = document.createElement('div');
    bar.className = `msg-action-bar align-${align}`;
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML = actions.map((action, i) => `
        <button type="button" class="msg-action-btn ${action.danger ? 'danger' : ''}" data-action-index="${i}" aria-label="${escapeHtml(action.label)}">
            <i class="fas ${action.icon}"></i><span>${escapeHtml(action.label)}</span>
        </button>
    `).join('');
    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action-index]');
        if (!btn) return;
        e.stopPropagation();
        const action = actions[parseInt(btn.dataset.actionIndex, 10)];
        closeMessageActions();
        if (action) action.onClick();
    });

    anchorEl.insertAdjacentElement('afterend', bar);
    anchorEl.classList.add('msg-selected');
    _openMessageActions = { anchor: anchorEl, bar };
    requestAnimationFrame(() => bar.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

    setTimeout(() => {
        document.addEventListener('pointerdown', handleMessageActionsOutside, true);
        document.addEventListener('keydown', handleMessageActionsEscape);
    }, 0);
}

function closeMessageActions() {
    if (!_openMessageActions) return;
    _openMessageActions.bar.remove();
    _openMessageActions.anchor.classList.remove('msg-selected');
    _openMessageActions = null;
    document.removeEventListener('pointerdown', handleMessageActionsOutside, true);
    document.removeEventListener('keydown', handleMessageActionsEscape);
}

function handleMessageActionsOutside(e) {
    if (!_openMessageActions) return;
    if (_openMessageActions.bar.contains(e.target) || _openMessageActions.anchor.contains(e.target)) return;
    closeMessageActions();
}

function handleMessageActionsEscape(e) {
    if (e.key === 'Escape') closeMessageActions();
}

async function copyTextToClipboard(text, successMessage = 'Copied') {
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage, 'success');
    } catch (error) {
        showToast('Could not copy', 'error');
    }
}

/* ============================================
   COMPOSER CONTEXT BAR (Replying to… / Editing…)
   ============================================ */
function showComposerContext(inputRow, { icon, title, preview, onCancel }) {
    if (!inputRow) return;
    let bar = inputRow.previousElementSibling;
    if (!bar || !bar.classList.contains('composer-context')) {
        bar = document.createElement('div');
        bar.className = 'composer-context';
        inputRow.insertAdjacentElement('beforebegin', bar);
    }
    bar.innerHTML = `
        <i class="fas ${icon} composer-context-icon"></i>
        <div class="composer-context-body">
            <div class="composer-context-title">${title}</div>
            <div class="composer-context-preview">${escapeHtml(preview || '')}</div>
        </div>
        <button type="button" class="icon-btn composer-context-close" aria-label="Cancel"><i class="fas fa-xmark"></i></button>
    `;
    bar.querySelector('.composer-context-close').addEventListener('click', onCancel);
}

function hideComposerContext(inputRow) {
    const bar = inputRow?.previousElementSibling;
    if (bar && bar.classList.contains('composer-context')) bar.remove();
}

/* ============================================
   FORUM + CHATS THREADS
   Group chats (communityGroups/{id}/messages) and DMs
   (dmConversations/{id}/messages) share one renderer and one set of
   reply/edit/delete actions.
   ============================================ */
const ChatThread = {
    kind: null,             // 'group' | 'dm'
    basePath: null,         // Firebase path of the messages node
    messages: new Map(),    // id -> message
    order: [],              // ids, oldest first
    replyTo: null,          // { id, senderId, senderName, preview }
    editingId: null,
    inputId: null,
    inputRowSelector: null
};

function setChatThread(kind, basePath, inputId) {
    if (ChatThread.basePath !== basePath) {
        ChatThread.replyTo = null;
        ChatThread.editingId = null;
    }
    ChatThread.kind = kind;
    ChatThread.basePath = basePath;
    ChatThread.inputId = inputId;
    ChatThread.inputRowSelector = '.group-chat-input-row';
}

function threadMessagePreview(msg) {
    if (!msg) return 'Original message unavailable';
    if (msg.deleted) return 'Deleted message';
    switch (msg.type) {
        case 'bible': return `📖 ${msg.reference || 'Bible verse'}`;
        case 'plan': return `📅 ${msg.content || 'Study plan'}`;
        case 'note': return `📝 ${msg.reference || 'Note'}`;
        case 'reflection': return "💡 Today's Reflection";
        case 'reel': return '🧭 Space post';
        default: return truncate(String(msg.content || '').replace(/\s+/g, ' '), 90);
    }
}

function renderSharedContentBody(msg) {
    if (msg.type === 'bible') {
        return `
            <div class="group-msg-bible">
                <i class="fas fa-book-bible"></i>
                <div>
                    <div style="font-weight:600;">${escapeHtml(msg.reference || '')}</div>
                    <div style="font-size:13px;">"${escapeHtml(msg.content || '')}"</div>
                </div>
            </div>
        `;
    }
    if (msg.type === 'plan') {
        return `
            <div class="group-msg-plan" onclick="openSharedPlanMessage('${escapeHtml(msg.planShareId || '').replace(/'/g, '')}', ${!!(AppState.currentUser && msg.senderId === AppState.currentUser.uid)})">
                <i class="fas fa-calendar-check"></i>
                <div>
                    <div style="font-weight:600;">${escapeHtml(msg.content || 'Shared a study plan')}</div>
                    <div style="font-size:12px; opacity:0.8;">Study plan · tap to view</div>
                </div>
            </div>
        `;
    }
    if (msg.type === 'reel') {
        return `
            <div class="group-msg-reel" onclick="openSpacePostFromNotification('${escapeHtml(msg.content || '')}', false)">
                <i class="fas fa-compass"></i>
                <div style="font-weight:600;">Shared a Space post</div>
            </div>
        `;
    }
    if (msg.type === 'note' || msg.type === 'reflection') {
        return `
            <div class="group-msg-bible">
                <i class="fas ${msg.type === 'note' ? 'fa-sticky-note' : 'fa-lightbulb'}"></i>
                <div>
                    <div style="font-weight:600;">${escapeHtml(msg.type === 'note' ? (msg.reference || 'A note') : "Today's Reflection")}</div>
                    <div style="font-size:13px;">${escapeHtml(msg.content || '')}</div>
                </div>
            </div>
        `;
    }
    return `<p class="msg-text">${renderRichMessageText(msg.content)}</p>${renderVerseCardsHTML(msg.content)}`;
}

function renderReplyQuote(replyTo) {
    if (!replyTo) return '';
    // Prefer the live original (so edits/deletions show up in the quote).
    const original = ChatThread.messages.get(replyTo.id);
    const preview = original ? threadMessagePreview(original) : (replyTo.preview || 'Original message');
    return `
        <div class="msg-reply-quote" onclick="event.stopPropagation(); scrollToThreadMessage('${escapeHtml(replyTo.id || '')}')">
            <div class="msg-reply-name">${userNameHTML(replyTo.senderId, replyTo.senderName)}</div>
            <div class="msg-reply-text">${escapeHtml(preview)}</div>
        </div>
    `;
}

function renderThreadMessage(id, msg, { showAuthor = false } = {}) {
    const isMe = !!AppState.currentUser && msg.senderId === AppState.currentUser.uid;
    const body = msg.deleted
        ? `<p class="msg-deleted"><i class="fas fa-ban"></i> This message was deleted</p>`
        : `${renderReplyQuote(msg.replyTo)}${renderSharedContentBody(msg)}`;
    const meta = `
        <div class="msg-meta">
            ${msg.editedAt && !msg.deleted ? '<span class="msg-edited">edited</span>' : ''}
            ${msg.timestamp ? `<span>${formatTime(msg.timestamp)}</span>` : ''}
        </div>
    `;
    return `
        <div class="group-message ${isMe ? 'me' : ''} ${msg.deleted ? 'is-deleted' : ''}" id="msg-${escapeHtml(id)}" data-msg-id="${escapeHtml(id)}">
            ${showAuthor && !isMe ? `<div class="group-msg-author" onclick="viewUserProfile('${escapeHtml(msg.senderId || '')}')">${userNameHTML(msg.senderId, msg.senderName)}</div>` : ''}
            <div class="group-msg-bubble">${body}${meta}</div>
        </div>
    `;
}

/** Renders a whole thread from a Firebase messages snapshot value. */
function renderThreadMessages(container, rawMessages, { showAuthor = false, emptyHTML = '' } = {}) {
    closeMessageActions();
    const entries = Object.entries(rawMessages || {})
        .filter(([, msg]) => msg && typeof msg === 'object')
        .sort(([, a], [, b]) => (a.timestamp || 0) - (b.timestamp || 0));

    ChatThread.messages = new Map(entries);
    ChatThread.order = entries.map(([id]) => id);

    container.innerHTML = entries.length === 0
        ? emptyHTML
        : entries.map(([id, msg]) => renderThreadMessage(id, msg, { showAuthor })).join('');
    container.scrollTop = container.scrollHeight;

    bindMessageGestures(container, '.group-message', (el, opts) => openThreadMessageActions(el, opts));
    hydrateUserNames(container);
    hydrateVerseCards(container);
}

function rerenderThreadMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    const msg = ChatThread.messages.get(id);
    if (!el || !msg) return;
    el.outerHTML = renderThreadMessage(id, msg, { showAuthor: ChatThread.kind === 'group' });
    const fresh = document.getElementById(`msg-${id}`);
    hydrateUserNames(fresh);
    hydrateVerseCards(fresh);
    // Quotes elsewhere in the thread that point at this message
    ChatThread.order.forEach(otherId => {
        const other = ChatThread.messages.get(otherId);
        if (other && other.replyTo && other.replyTo.id === id && otherId !== id) {
            const otherEl = document.getElementById(`msg-${otherId}`);
            const quoteText = otherEl?.querySelector('.msg-reply-text');
            if (quoteText) quoteText.textContent = threadMessagePreview(msg);
        }
    });
}

function scrollToThreadMessage(id) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) {
        showToast('The original message is no longer loaded.', 'info');
        return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('msg-flash');
    setTimeout(() => el.classList.remove('msg-flash'), 1400);
}

function openThreadMessageActions(el, opts = {}) {
    const id = el.dataset.msgId;
    const msg = ChatThread.messages.get(id);
    if (!msg) return;
    const isMe = !!AppState.currentUser && msg.senderId === AppState.currentUser.uid;
    const actions = [];

    if (!msg.deleted) {
        actions.push({ icon: 'fa-reply', label: 'Reply', onClick: () => startThreadReply(id) });
        const copyText = msg.type === 'bible' ? `${msg.content || ''} — ${msg.reference || ''}` : (msg.content || '');
        if (copyText.trim()) actions.push({ icon: 'fa-copy', label: 'Copy', onClick: () => copyTextToClipboard(copyText, 'Message copied') });
        if (isMe && (!msg.type || msg.type === 'text')) actions.push({ icon: 'fa-pen', label: 'Edit', onClick: () => startThreadEdit(id) });
        if (isMe) actions.push({ icon: 'fa-trash', label: 'Delete', danger: true, onClick: () => confirmDeleteThreadMessage(id) });
    }
    openMessageActions(el, actions, { align: isMe ? 'end' : 'start', toggle: !!opts.toggle });
}

function getThreadInput() {
    return ChatThread.inputId ? document.getElementById(ChatThread.inputId) : null;
}

function getThreadInputRow() {
    return getThreadInput()?.closest('.group-chat-input-row') || null;
}

function startThreadReply(id) {
    if (!requireAuth('Sign in to reply.')) return;
    const msg = ChatThread.messages.get(id);
    if (!msg) return;
    if (ChatThread.editingId) cancelComposerContext();
    ChatThread.replyTo = {
        id,
        senderId: msg.senderId || null,
        senderName: msg.senderName || 'Anonymous',
        preview: threadMessagePreview(msg)
    };
    showComposerContext(getThreadInputRow(), {
        icon: 'fa-reply',
        title: `Replying to ${escapeHtml(getDisplayName(msg.senderId, msg.senderName))}`,
        preview: ChatThread.replyTo.preview,
        onCancel: cancelComposerContext
    });
    getThreadInput()?.focus();
}

function startThreadEdit(id) {
    const msg = ChatThread.messages.get(id);
    if (!msg) return;
    ChatThread.replyTo = null;
    ChatThread.editingId = id;
    const input = getThreadInput();
    showComposerContext(getThreadInputRow(), {
        icon: 'fa-pen',
        title: 'Editing message',
        preview: threadMessagePreview(msg),
        onCancel: cancelComposerContext
    });
    if (input) {
        input.value = msg.content || '';
        autoGrowTextarea(input);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

function cancelComposerContext() {
    const wasEditing = !!ChatThread.editingId;
    ChatThread.replyTo = null;
    ChatThread.editingId = null;
    hideComposerContext(getThreadInputRow());
    const input = getThreadInput();
    if (wasEditing && input) {
        input.value = '';
        autoGrowTextarea(input);
    }
}

/** Returns (and clears) the pending reply, for the send functions. */
function consumeThreadReply() {
    const reply = ChatThread.replyTo;
    ChatThread.replyTo = null;
    hideComposerContext(getThreadInputRow());
    return reply ? { ...reply } : null;
}

async function submitThreadEdit(newContent) {
    const id = ChatThread.editingId;
    const msg = ChatThread.messages.get(id);
    if (!id || !msg) { cancelComposerContext(); return; }
    const content = String(newContent || '').trim();
    if (!content) {
        showToast("A message can't be empty — delete it instead.", 'warning');
        return;
    }
    ChatThread.editingId = null;
    hideComposerContext(getThreadInputRow());
    if (content === msg.content) return;

    const editedAt = Date.now();
    try {
        await database.ref(`${ChatThread.basePath}/${id}`).update({ content, editedAt });
        msg.content = content;
        msg.editedAt = editedAt;
        rerenderThreadMessage(id);
        refreshDMPreviewIfLatest(id);
    } catch (error) {
        console.error('Error editing message:', error);
        showToast("Couldn't edit that message. Please try again.", 'error');
    }
}

function confirmDeleteThreadMessage(id) {
    showModal(`
        <h3 style="margin-bottom: 12px;">Delete message?</h3>
        <p class="text-muted" style="margin-bottom: 20px;">It will be removed for everyone in this conversation.</p>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
            <button class="btn btn-block" style="background:#f44336; color:white;" onclick="closeModalThen(() => deleteThreadMessage('${escapeHtml(id)}'))">Delete</button>
        </div>
    `);
}

async function deleteThreadMessage(id) {
    const msg = ChatThread.messages.get(id);
    if (!msg) return;
    const deletedAt = Date.now();
    try {
        // Kept as a tombstone (content removed) so replies that quote it
        // still make sense and the conversation doesn't silently reflow.
        await database.ref(`${ChatThread.basePath}/${id}`).update({
            deleted: true, deletedAt, content: null, reference: null, replyTo: null
        });
        Object.assign(msg, { deleted: true, deletedAt, content: null, reference: null, replyTo: null });
        if (ChatThread.editingId === id) cancelComposerContext();
        rerenderThreadMessage(id);
        refreshDMPreviewIfLatest(id);
        showToast('Message deleted', 'success');
    } catch (error) {
        console.error('Error deleting message:', error);
        showToast("Couldn't delete that message. Please try again.", 'error');
    }
}

/** In one-to-one Chats the conversation list shows the latest message —
    keep that preview honest after an edit/delete of the latest message. */
function refreshDMPreviewIfLatest(id) {
    if (ChatThread.kind !== 'dm' || ChatThread.order[ChatThread.order.length - 1] !== id) return;
    const uid = AppState.currentUser?.uid;
    const otherUid = AppState.currentDMUserId;
    const msg = ChatThread.messages.get(id);
    if (!uid || !otherUid || !msg) return;
    const preview = msg.deleted ? 'Message deleted' : threadMessagePreview(msg);
    database.ref(`users/${uid}/dmIndex/${otherUid}/lastMessage`).set(preview).catch(() => {});
    database.ref(`users/${otherUid}/dmIndex/${uid}/lastMessage`).set(preview).catch(() => {});
}

/* ============================================
   SHEPHERD: sent-prompt + reply actions
   ============================================ */
let shepherdReplyTo = null; // { preview }

function bindShepherdMessageGestures() {
    const container = $('#chat-messages');
    bindMessageGestures(container, '.chat-message.user, .chat-message.ai[data-index]', (el, opts) => {
        const index = parseInt(el.dataset.index, 10);
        if (Number.isNaN(index)) return;
        if (el.classList.contains('editing')) return;
        if (el.classList.contains('user')) openShepherdPromptActions(el, index, opts);
        else openShepherdReplyActions(el, index, opts);
    });
}

function shepherdIsBusy() {
    if (AppState.shepherdBusy) {
        showToast('Please wait for Shepherd to finish replying.', 'info');
        return true;
    }
    return false;
}

function openShepherdPromptActions(el, index, opts = {}) {
    const msg = AppState.aiChatHistory[index];
    if (!msg) return;
    openMessageActions(el, [
        { icon: 'fa-pen', label: 'Edit', onClick: () => { if (!shepherdIsBusy()) startEditShepherdPrompt(index); } },
        { icon: 'fa-copy', label: 'Copy', onClick: () => copyTextToClipboard(msg.content, 'Prompt copied') },
        { icon: 'fa-rotate-right', label: 'Retry', onClick: () => { if (!shepherdIsBusy()) resubmitShepherdPrompt(index, msg.content); } },
        { icon: 'fa-share-nodes', label: 'Share', onClick: () => shareShepherdText(msg.content) },
        { icon: 'fa-trash', label: 'Delete', danger: true, onClick: () => { if (!shepherdIsBusy()) confirmDeleteShepherdPrompt(index); } }
    ], { align: 'end', toggle: !!opts.toggle });
}

function openShepherdReplyActions(el, index, opts = {}) {
    const msg = AppState.aiChatHistory[index];
    if (!msg) return;
    openMessageActions(el, [
        { icon: 'fa-reply', label: 'Reply', onClick: () => startShepherdReply(index) },
        { icon: 'fa-copy', label: 'Copy', onClick: () => copyMessageText(index) },
        { icon: 'fa-share-nodes', label: 'Share', onClick: () => shareMessageText(index) }
    ], { align: 'start', toggle: !!opts.toggle });
}

function shareShepherdText(text) {
    if (navigator.share) {
        navigator.share({ title: 'GraceGuide', text }).catch(() => {});
    } else {
        copyTextToClipboard(text, 'Copied for sharing');
    }
}

function startShepherdReply(index) {
    const msg = AppState.aiChatHistory[index];
    if (!msg) return;
    const preview = truncate(stripMarkdownForSpeech(msg.content).replace(/\s+/g, ' '), 140);
    shepherdReplyTo = { index, preview };
    showComposerContext($('.chat-input-container'), {
        icon: 'fa-reply',
        title: 'Replying to Shepherd',
        preview,
        onCancel: cancelShepherdReply
    });
    $('#chat-input')?.focus();
}

function cancelShepherdReply() {
    shepherdReplyTo = null;
    hideComposerContext($('.chat-input-container'));
}

/** Used by sendChatMessage(): returns and clears the pending reply. */
function consumeShepherdReply() {
    const reply = shepherdReplyTo;
    cancelShepherdReply();
    return reply;
}

function startEditShepherdPrompt(index) {
    const msg = AppState.aiChatHistory[index];
    const el = document.getElementById(`chat-msg-${index}`);
    if (!msg || !el) return;
    stopSpeaking();

    el.classList.add('editing');
    el.innerHTML = `
        <textarea class="msg-edit-input" rows="1" aria-label="Edit your prompt">${escapeHtml(msg.content)}</textarea>
        <div class="msg-edit-actions">
            <button type="button" class="btn btn-sm msg-edit-cancel">Cancel</button>
            <button type="button" class="btn btn-sm msg-edit-send"><i class="fas fa-paper-plane"></i> Send</button>
        </div>
    `;
    const textarea = el.querySelector('.msg-edit-input');
    const submit = () => {
        const text = textarea.value.trim();
        if (!text) { showToast('Your prompt is empty', 'warning'); return; }
        resubmitShepherdPrompt(index, text);
    };
    el.querySelector('.msg-edit-cancel').addEventListener('click', () => renderChatHistory());
    el.querySelector('.msg-edit-send').addEventListener('click', submit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); renderChatHistory(); return; }
        handleMessageInputKeydown(e, submit);
    });
    textarea.addEventListener('input', () => autoGrowTextarea(textarea));
    autoGrowTextarea(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

/** Drops the prompt at `index` (and everything after it — the answers
    were to the old wording) and sends `text` in its place. */
function resubmitShepherdPrompt(index, text) {
    const original = AppState.aiChatHistory[index];
    if (!original) return;
    stopSpeaking();
    const unchanged = text === original.content;
    AppState.aiChatHistory = AppState.aiChatHistory.slice(0, index);
    sendChatMessage({
        displayText: text,
        apiText: unchanged && original.apiText ? original.apiText : text,
        replyTo: unchanged ? original.replyTo || null : null,
        edited: !unchanged || !!original.editedAt
    });
}

function confirmDeleteShepherdPrompt(index) {
    showModal(`
        <h3 style="margin-bottom: 12px;">Delete this prompt?</h3>
        <p class="text-muted" style="margin-bottom: 20px;">Shepherd's reply to it will be removed too.</p>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
            <button class="btn btn-block" style="background:#f44336; color:white;" onclick="closeModalThen(() => deleteShepherdPrompt(${index}))">Delete</button>
        </div>
    `);
}

async function deleteShepherdPrompt(index) {
    const msg = AppState.aiChatHistory[index];
    if (!msg || msg.role !== 'user') return;
    stopSpeaking();
    const next = AppState.aiChatHistory[index + 1];
    const removeCount = next && next.role === 'assistant' ? 2 : 1;
    AppState.aiChatHistory.splice(index, removeCount);

    if (AppState.aiChatHistory.length === 0) {
        const convId = AppState.currentConversationId;
        if (convId && AppState.currentUser) {
            try {
                await database.ref(`users/${AppState.currentUser.uid}/aiConversations/${convId}`).remove();
            } catch (error) {
                console.error('Error removing empty conversation:', error);
            }
            AppState.aiConversations = AppState.aiConversations.filter(c => c.id !== convId);
        }
        AppState.currentConversationId = null;
        renderAskPage();
    } else {
        renderChatHistory();
        saveCurrentConversation();
    }
    showToast('Prompt deleted', 'success');
}
