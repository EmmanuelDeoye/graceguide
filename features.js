/* ============================================
   GraceGuide — js/features.js
   Load AFTER config.js and core.js.
   Contains: Shepherd AI chat, conversation history,
   the Bible reading planner, personalization engine, and Space.
   ============================================ */

/* ============================================
   PERSONALIZATION ENGINE
   ============================================
   A lightweight, on-device "interest profile" built from what the user
   actually does in the app — books they read, topics they ask Shepherd
   about, and Space posts they engage with. Nothing here calls an external
   ML service; it's simple, transparent weighted-keyword scoring, which
   keeps it fast, free, and easy to reason about. The same profile powers
   both the Space feed ranking and the homepage "Recommended for You" list. */

const TOPIC_KEYWORDS = {
    faith: ['faith', 'believe', 'trust god', 'doubt'],
    fear: ['fear', 'afraid', 'anxious', 'anxiety', 'worry', 'worried'],
    peace: ['peace', 'calm', 'rest', 'anxiety'],
    love: ['love', 'relationship', 'marriage', 'spouse'],
    hope: ['hope', 'future', 'discourage', 'despair'],
    wisdom: ['wisdom', 'guidance', 'decision', 'direction'],
    strength: ['strength', 'strong', 'weak', 'tired', 'burnout', 'exhausted'],
    forgiveness: ['forgive', 'forgiveness', 'grudge', 'bitterness'],
    prayer: ['pray', 'prayer', 'praying'],
    grace: ['grace', 'mercy', 'shame', 'guilt'],
    patience: ['patience', 'patient', 'waiting'],
    joy: ['joy', 'happy', 'happiness', 'gratitude', 'thankful'],
    purpose: ['purpose', 'calling', 'career', 'work'],
    grief: ['grief', 'loss', 'death', 'mourning', 'sad'],
    family: ['family', 'parent', 'children', 'kids']
};

// A small curated pool of passages per topic, used to build personalized
// homepage recommendations without needing a server-side content index.
const TOPIC_PASSAGES = {
    faith: { book: 'Hebrews', chapter: 11, title: 'The Faith Chapter', duration: 9 },
    fear: { book: 'Philippians', chapter: 4, title: "Don't Be Anxious", duration: 6 },
    peace: { book: 'John', chapter: 14, title: 'Peace I Leave With You', duration: 6 },
    love: { book: '1 Corinthians', chapter: 13, title: 'The Way of Love', duration: 4 },
    hope: { book: 'Romans', chapter: 15, title: 'The God of Hope', duration: 7 },
    wisdom: { book: 'James', chapter: 1, title: 'Wisdom That Comes from Above', duration: 6 },
    strength: { book: 'Isaiah', chapter: 40, title: 'Those Who Wait Will Renew Their Strength', duration: 8 },
    forgiveness: { book: 'Colossians', chapter: 3, title: 'Bearing With One Another', duration: 6 },
    prayer: { book: 'Matthew', chapter: 6, title: 'The Lord\'s Prayer', duration: 7 },
    grace: { book: 'Ephesians', chapter: 2, title: 'Saved by Grace', duration: 6 },
    patience: { book: 'James', chapter: 5, title: 'Patience in Suffering', duration: 5 },
    joy: { book: 'Nehemiah', chapter: 8, title: 'The Joy of the Lord', duration: 8 },
    purpose: { book: 'Jeremiah', chapter: 29, title: 'Plans to Prosper You', duration: 5 },
    grief: { book: 'Psalm', chapter: 34, title: 'Close to the Brokenhearted', duration: 4 },
    family: { book: 'Ephesians', chapter: 6, title: 'Instructions for Households', duration: 6 }
};

function extractTags(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    return Object.keys(TOPIC_KEYWORDS).filter(topic => TOPIC_KEYWORDS[topic].some(kw => lower.includes(kw)));
}

function getInterestProfile() {
    if (!AppState.interestProfile) {
        AppState.interestProfile = { books: {}, tags: {}, updatedAt: Date.now() };
    }
    return AppState.interestProfile;
}

let interestSaveTimer = null;
function persistInterestProfileSoon() {
    // Debounced write — interest signals fire often (every message, every
    // scroll-triggered like), so batch them into occasional saves instead
    // of hammering the database.
    clearTimeout(interestSaveTimer);
    interestSaveTimer = setTimeout(() => {
        if (!AppState.currentUser) {
            localStorage.setItem('graceguide_interest_profile', JSON.stringify(AppState.interestProfile));
            return;
        }
        database.ref(`users/${AppState.currentUser.uid}/interestProfile`).set(AppState.interestProfile).catch(() => {});
    }, 2500);
}

/**
 * Records a single interest signal. category is 'book' or 'tag';
 * weight reflects how strong the signal is (a view is weak, creating
 * content is strong).
 */
function recordInterestSignal(category, key, weight) {
    if (!key) return;
    const profile = getInterestProfile();
    const bucket = category === 'book' ? profile.books : profile.tags;
    bucket[key] = (bucket[key] || 0) + weight;
    profile.updatedAt = Date.now();
    persistInterestProfileSoon();
}

async function loadInterestProfile() {
    try {
        if (AppState.currentUser) {
            const snapshot = await database.ref(`users/${AppState.currentUser.uid}/interestProfile`).once('value');
            const data = snapshot.val();
            AppState.interestProfile = normalizeInterestProfile(data);
            // Self-heal: if the node was missing altogether, or was written by
            // the old buggy path and only ever got "books" (RTDB drops keys
            // whose value is an empty object, so "tags" would never have been
            // persisted), write the normalized shape straight back so both
            // "books" and "tags" exist in the database going forward.
            const needsHeal = !data || !data.books || !data.tags
                || Object.keys(data.books).length === 0 || Object.keys(data.tags).length === 0;
            if (needsHeal) {
                database.ref(`users/${AppState.currentUser.uid}/interestProfile`).set(AppState.interestProfile).catch(() => {});
            }
        } else {
            const local = localStorage.getItem('graceguide_interest_profile');
            AppState.interestProfile = normalizeInterestProfile(local ? JSON.parse(local) : null);
        }
    } catch (error) {
        console.error('Error loading interest profile:', error);
        AppState.interestProfile = { books: { _seed: 0 }, tags: { _seed: 0 }, updatedAt: Date.now() };
    }
}

/** Ensures an interest profile object always has non-empty "books" and
 * "tags" maps (Realtime Database drops keys whose value is {} on write,
 * so without a placeholder they can silently vanish from the database
 * for brand-new users who haven't triggered both signal types yet). */
function normalizeInterestProfile(data) {
    const books = (data && data.books && Object.keys(data.books).length > 0) ? data.books : { _seed: 0 };
    const tags = (data && data.tags && Object.keys(data.tags).length > 0) ? data.tags : { _seed: 0 };
    return { books, tags, updatedAt: (data && data.updatedAt) || Date.now() };
}

/** Scores a piece of content (a Space post or a passage) against the
 * user's interest profile: tag/book affinity + a mild recency boost +
 * a small popularity nudge, so the feed favors what a user cares about
 * without becoming an total echo chamber of only-old-favorites. */
function scoreForInterest(tags, book, timestamp, engagementCount) {
    const profile = getInterestProfile();
    let score = 0;

    (tags || []).forEach(tag => { score += (profile.tags[tag] || 0); });
    if (book && profile.books[book]) score += profile.books[book] * 0.6;

    if (timestamp) {
        const ageHours = (Date.now() - timestamp) / 36e5;
        score += Math.max(0, 6 - Math.log2(ageHours + 1)); // fresher content nudged up
    }
    if (engagementCount) score += Math.log2(engagementCount + 1) * 0.5;

    return score;
}

function getPersonalizedRecommendations() {
    const profile = getInterestProfile();
    const topTagEntries = Object.entries(profile.tags).sort((a, b) => b[1] - a[1]);

    const picks = [];
    const usedBooks = new Set();

    for (const [tag] of topTagEntries) {
        const passage = TOPIC_PASSAGES[tag];
        if (passage && !usedBooks.has(passage.book + passage.chapter)) {
            picks.push({ ...passage, reference: `${passage.book} ${passage.chapter}` });
            usedBooks.add(passage.book + passage.chapter);
        }
        if (picks.length >= 4) break;
    }

    // Cold start / not enough signal yet — fall back to well-loved defaults.
    const defaults = [
        { book: 'Matthew', chapter: 5, title: 'The Beatitudes', reference: 'Matthew 5', duration: 5 },
        { book: 'Psalm', chapter: 23, title: 'The Lord is My Shepherd', reference: 'Psalm 23', duration: 3 },
        { book: 'Romans', chapter: 8, title: 'Life in the Spirit', reference: 'Romans 8', duration: 8 },
        { book: 'Proverbs', chapter: 3, title: 'Trust in the Lord', reference: 'Proverbs 3', duration: 5 }
    ];
    for (const d of defaults) {
        if (picks.length >= 4) break;
        if (!usedBooks.has(d.book + d.chapter)) { picks.push(d); usedBooks.add(d.book + d.chapter); }
    }

    return picks.slice(0, 4);
}

/* ============================================
   SHEPHERD (ASK AI) PAGE
   ============================================ */
const pendingAIActions = {};

function renderAskPage() {
    DOM.pageContainer.innerHTML = `
        <div class="chat-container">
            <div class="chat-header">
                <div class="chat-header-title">
                    <i class="fas fa-dove"></i>
                    <span id="chat-conversation-title">${AppState.currentConversationId ? escapeHtml(AppState.aiConversations.find(c => c.id === AppState.currentConversationId)?.title || 'Shepherd') : 'Shepherd'}</span>
                </div>
                <div class="chat-header-actions">
                    <button class="icon-btn" id="chat-voice-btn" aria-label="Voice settings">
                        <i class="fas fa-volume-high"></i>
                    </button>
                    <button class="icon-btn" id="chat-new-btn" aria-label="New conversation">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="icon-btn" id="chat-history-btn" aria-label="Conversation history">
                        <i class="fas fa-clock-rotate-left"></i>
                    </button>
                </div>
            </div>

            <div class="chat-messages" id="chat-messages">
                ${AppState.aiChatHistory.length === 0 ? `
                    <div class="text-center text-muted" style="padding: 40px 20px;">
                        <i class="fas fa-dove" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;"></i>
                        <h3 style="margin-bottom: 8px;">Ask Shepherd</h3>
                        <p>Ask me anything about faith, the Bible, or life. I'm here to help.</p>
                        
                        <div style="display: grid; gap: 8px; margin-top: 24px;">
                            <button class="btn btn-outline btn-sm" onclick="askSuggestedQuestion('What does the Bible say about anxiety?')">
                                What does the Bible say about anxiety?
                            </button>
                            <button class="btn btn-outline btn-sm" onclick="askSuggestedQuestion('How can I strengthen my faith?')">
                                How can I strengthen my faith?
                            </button>
                            <button class="btn btn-outline btn-sm" onclick="askSuggestedQuestion('Explain forgiveness in the Bible')">
                                Explain forgiveness in the Bible
                            </button>
                        </div>
                    </div>
                ` : ''}
            </div>
            
            <div class="chat-input-container">
                <textarea id="chat-input" class="chat-input" placeholder="Ask your question..." rows="1" onkeydown="handleChatInputKeydown(event)" style="max-height: 120px; resize: none;"></textarea>
                <button class="chat-send-btn" onclick="sendChatMessage()">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    $('#chat-new-btn').addEventListener('click', startNewConversation);
    $('#chat-history-btn').addEventListener('click', showConversationHistory);
    $('#chat-voice-btn').addEventListener('click', showVoicePickerSheet);

    // Render existing chat history
    renderChatHistory();

    // Scroll to bottom
    scrollChatToBottom();

    // Warm the conversation list cache for the history sheet
    if (AppState.currentUser) loadAIConversationsList();
}

function renderChatHistory() {
    const chatMessages = $('#chat-messages');
    if (!chatMessages || AppState.aiChatHistory.length === 0) return;
    
    chatMessages.innerHTML = AppState.aiChatHistory.map((msg, index) => `
        <div class="chat-message ${msg.role === 'user' ? 'user' : 'ai'}" id="chat-msg-${index}">
            ${msg.role === 'assistant' ? `
                <button class="chat-listen-btn" id="listen-btn-${index}" onclick="toggleSpeakMessage(${index})" aria-label="Listen">
                    <i class="fas fa-volume-high"></i> <span>Listen</span>
                </button>
            ` : ''}
            <div class="chat-message-body">${msg.role === 'user' ? escapeHtml(msg.content) : linkifyBibleReferences(formatAIText(msg.content))}</div>
            ${msg.bibleRefs ? `
                <div class="message-bible-ref">
                    <i class="fas fa-book-bible"></i> ${escapeHtml(msg.bibleRefs)}
                </div>
            ` : ''}
            ${msg.action ? renderActionWidget(msg.action, msg.actionId) : ''}
            ${msg.crisis ? renderCrisisBanner(msg.crisis) : ''}
            ${msg.role === 'assistant' ? `
                <div class="chat-message-toolbar">
                    <button class="icon-btn" onclick="copyMessageText(${index})" aria-label="Copy"><i class="fas fa-copy"></i></button>
                    <button class="icon-btn" onclick="shareMessageText(${index})" aria-label="Share"><i class="fas fa-share-nodes"></i></button>
                    <button class="icon-btn" onclick="postMessageToReels(${index})" aria-label="Post to Space"><i class="fas fa-bullhorn"></i></button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

function linkifyBibleReferences(html) {
    const pattern = /\b((?:[1-3]\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+\d+(?::\d+(?:\s*[-–]\s*\d+)?)?)\b/g;
    return html.replace(pattern, (match) => {
        const safe = match.replace(/'/g, "\\'");
        return `<a href="javascript:void(0)" class="bible-ref-link" onclick="openPassageReference('${safe}')">${match}</a>`;
    });
}

function copyMessageText(index) {
    const msg = AppState.aiChatHistory[index];
    if (!msg) return;

    navigator.clipboard.writeText(msg.content).then(() => {
        showToast('Copied to clipboard', 'success');
    }).catch(() => {
        showToast('Could not copy', 'error');
    });
}

function shareMessageText(index) {
    const msg = AppState.aiChatHistory[index];
    if (!msg) return;

    if (navigator.share) {
        navigator.share({ title: 'Shepherd — GraceGuide', text: msg.content }).catch(() => {});
    } else {
        navigator.clipboard.writeText(msg.content).then(() => showToast('Copied for sharing', 'success'));
    }
}

async function postMessageToReels(index) {
    if (!requireAuth('Sign in to post.')) return;

    const msg = AppState.aiChatHistory[index];
    if (!msg) return;

    const post = buildSpacePostObject({
        type: 'shepherd',
        slides: splitTextIntoSlides(msg.content, 'Shepherd says'),
        tags: extractTags(msg.content)
    });

    try {
        await database.ref(`spacePosts/${post.id}`).set(post);
        recordInterestSignal('tag', 'own_post', 2.5);
        (post.tags || []).forEach(tag => recordInterestSignal('tag', tag, 2.5));
        showToast('Posted to Space!', 'success');
        navigateTo('space');
    } catch (error) {
        showToast('Failed to post', 'error');
        console.error(error);
    }
}

function renderCrisisBanner(crisis) {
    const category = crisis?.category || 'This sounds serious';
    return `
        <div class="crisis-banner">
            <div class="crisis-banner-title"><i class="fas fa-hand-holding-heart"></i> You don't have to go through this alone</div>
            <p>${escapeHtml(crisis?.message || "What you're describing matters, and a real person — a pastor, Christian counselor, or mentor — can support you better than I can here.")}</p>
            <button class="btn btn-block" onclick="navigateTo('talk-to-someone')">
                <i class="fas fa-comments"></i> Talk to Someone
            </button>
        </div>
    `;
}

function scrollChatToBottom() {
    const chatMessages = $('#chat-messages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

/**
 * Scrolls so the start of a given message (usually a fresh AI reply) is at
 * the top of the visible chat area, rather than jumping to the bottom where
 * only the tail of a long response would be visible.
 */
function scrollToMessageTop(index) {
    const chatMessages = $('#chat-messages');
    const el = document.getElementById(`chat-msg-${index}`);
    if (chatMessages && el) {
        chatMessages.scrollTop = el.offsetTop - 12;
    }
}

function askSuggestedQuestion(question) {
    const chatInput = $('#chat-input');
    if (chatInput) {
        chatInput.value = question;
        sendChatMessage();
    }
}

/** Coarse pointer = touch-primary (phones/tablets). Preferred over
    feature-detecting touch events, which false-positive on hybrid
    laptops that have a touchscreen but are primarily used with a
    keyboard — where Enter-to-send is still the expected behavior. */
function isTouchPrimaryDevice() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

function handleChatInputKeydown(event) {
    const textarea = event.target;

    // Enter without Shift = send — but only on non-touch input. On a
    // phone's on-screen keyboard there's no comfortable Shift+Enter to
    // reach for, so treating Enter as "send" there means a return in the
    // middle of a multi-line thought fires the message early. Touch
    // devices get plain default behavior: Enter just inserts a newline,
    // and sending happens only via the send button.
    if (event.key === 'Enter' && !event.shiftKey && !isTouchPrimaryDevice()) {
        event.preventDefault();
        sendChatMessage();
        return;
    }
    
    // After any input, auto-grow the textarea to fit content
    setTimeout(() => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }, 0);
}

async function sendChatMessage(override) {
    const chatInput = $('#chat-input');

    let displayText;
    let apiText;

    if (override && typeof override === 'object') {
        displayText = override.displayText;
        apiText = override.apiText || override.displayText;
    } else {
        displayText = apiText = (override || chatInput?.value.trim());
    }

    if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
    }
    if (!displayText) return;
    
    // Add user message to chat (what the user sees)
    AppState.aiChatHistory.push({
        role: 'user',
        content: displayText,
        timestamp: Date.now()
    });

    // Feed the personalization engine — what topics is the user asking about?
    extractTags(apiText).forEach(tag => recordInterestSignal('tag', tag, 1.5));
    
    renderChatHistory();
    scrollChatToBottom();
    
    // Show typing indicator
    const typingId = generateId();
    const typingHTML = `
        <div class="chat-message ai" id="${typingId}">
            <div style="display: flex; gap: 4px;">
                <span style="animation: pulse 1s infinite;">●</span>
                <span style="animation: pulse 1s infinite 0.2s;">●</span>
                <span style="animation: pulse 1s infinite 0.4s;">●</span>
            </div>
        </div>
    `;
    $('#chat-messages').insertAdjacentHTML('beforeend', typingHTML);
    scrollChatToBottom();
    
    try {
        // Call DeepSeek AI with the (possibly richer) API-facing text
        const aiResponse = await callDeepSeekAI(apiText);

        // Remove typing indicator
        $(`#${typingId}`)?.remove();

        let actionId = null;
        if (aiResponse.action) {
            actionId = generateId();
            pendingAIActions[actionId] = aiResponse.action;
        }

        // Add AI response
        AppState.aiChatHistory.push({
            role: 'assistant',
            content: aiResponse.text,
            bibleRefs: aiResponse.bibleRefs,
            action: aiResponse.action || null,
            actionId,
            crisis: aiResponse.crisis || null,
            timestamp: Date.now()
        });
        
        renderChatHistory();
        scrollToMessageTop(AppState.aiChatHistory.length - 1);
        
        // Save conversation to the database with a refined title
        saveCurrentConversation();
    } catch (error) {
        // Remove typing indicator
        $(`#${typingId}`)?.remove();
        
        showToast('Failed to get AI response', 'error');
        console.error('AI error:', error);
        
        // Add error message
        AppState.aiChatHistory.push({
            role: 'assistant',
            content: "I'm having trouble connecting right now. Please try again in a moment.",
            timestamp: Date.now()
        });
        
        renderChatHistory();
        scrollToMessageTop(AppState.aiChatHistory.length - 1);
    }
}

function discussReflectionWithShepherd() {
    const reflection = AppState.todayReflection || '';
    navigateTo('ask');
    setTimeout(() => {
        sendChatMessage({
            displayText: "Let's talk about today's reflection.",
            apiText: `Today's devotional reflection is: "${reflection}" The user wants to discuss this reflection and go deeper into it. Respond directly about its themes and application without asking the user to restate or repeat the reflection to you.`
        });
    }, 400);
}

/**
 * Builds a compact summary of the signed-in user's profile and app
 * activity so Shepherd can personalize its responses (e.g. reference
 * their current study plan, streak, or recent reading) — including
 * their activity in Space, Forum, Chats, and Notifications.
 */
async function buildShepherdUserContext() {
    if (!AppState.currentUser) {
        return 'The user is browsing as a guest (not signed in). Do not reference personal data that has not been shared in this conversation.';
    }

    const profile = AppState.userProfile || {};
    const plan = AppState.currentPlan;
    const recentBooks = AppState.readingHistory.slice(-5).map(h => `${h.book} ${h.chapter}`).join(', ') || 'none yet';
    const groupCount = AppState.communityGroups?.filter(g => g.members && AppState.currentUser && g.members[AppState.currentUser.uid]).length || 0;
    const brethrenCount = Array.from(AppState.userConnections.values()).filter(s => s === 'brethren').length;

    const lines = [
        `Signed-in user profile: username "${profile.username || 'Unknown'}"${profile.bio ? `, bio: "${profile.bio}"` : ''}.`,
        `Bible reading: ${AppState.readingHistory.length} chapters read historically; most recently read: ${recentBooks}.`,
        `Bookmarks: ${AppState.bookmarks.length}. Notes saved: ${AppState.notes.length}. Highlights: ${AppState.highlights.length}.`,
        plan
            ? `Active study plan: "${plan.name}" (${plan.type}), ${plan.completed || 0}/${plan.total || 0} days completed (${plan.progress || 0}%), current streak ${plan.streak || 0} days.`
            : 'No active study plan yet.',
        `Total study plans saved: ${AppState.plannerData.length}.`,
        `Forum groups joined: ${groupCount}. Brethren (accepted connections): ${brethrenCount}.`,
        `Prior Shepherd conversations saved: ${AppState.aiConversations.length}.`
    ];

    // --- Space activity (fetched fresh so this works even if the user
    // hasn't opened the Space tab yet this session) ---
    const spaceSummary = await getSpaceSummaryForShepherd();
    const streak = AppState.spaceStreak || { count: 0, lastPostDate: null };
    const postedToday = streak.lastPostDate === (typeof getTodayDateString === 'function' ? getTodayDateString() : null);
    lines.push(`Space posting streak: ${streak.count || 0} day(s)${postedToday ? ' (posted today)' : ''}.`);

    if (spaceSummary) {
        lines.push(`This user has posted ${spaceSummary.myPostsCount} time(s) to Space. Their posts have received ${spaceSummary.totalAmensReceived} total Amen(s) and ${spaceSummary.totalCommentsReceived} total comment(s).`);
        if (spaceSummary.latestOwnPost) {
            const p = spaceSummary.latestOwnPost;
            const preview = p.type === 'video' ? (p.videoUrl || '') : (p.slides?.[0]?.text || p.planName || '');
            lines.push(`Their most recent Space post (${formatDate(p.timestamp)}, type: ${p.type}): ${preview ? `"${truncate(preview, 90)}"` : '(no preview available)'}.`);
        }
        if (spaceSummary.recentTopics.length > 0) {
            lines.push(`Topics currently active in the wider Space community feed: ${spaceSummary.recentTopics.join(', ')}.`);
        }
    } else {
        lines.push('Space community feed data could not be loaded for this response.');
    }

    // --- Live indicators the user can currently see in the app ---
    const unreadNotifs = AppState.notifications?.filter(n => !n.read).length || 0;
    lines.push(`Unread notifications: ${unreadNotifs}. Unread direct-message chats: ${AppState.unreadChatsCount || 0}. Forum groups with new unread messages: ${AppState.unreadForumGroupIds?.size || 0}.`);

    return `Here is what you know about the signed-in user from the app, for personalizing your response. Only bring these details up when naturally relevant — don't recite this list back to them:\n${lines.join('\n')}`;
}

/**
 * Pulls a lightweight snapshot of Space (the community devotional feed)
 * for Shepherd's context: this user's own posting activity plus a sample
 * of what topics are currently active community-wide. Reuses the feed
 * already in memory if the user has visited Space this session; otherwise
 * fetches a small sample fresh so Shepherd is never blind to Space.
 */
async function getSpaceSummaryForShepherd() {
    if (!AppState.currentUser) return null;
    try {
        let posts = AppState.spacePosts;
        if (!posts || posts.length === 0) {
            const snapshot = await database.ref('spacePosts').orderByChild('timestamp').limitToLast(30).once('value');
            posts = Object.values(snapshot.val() || {});
        }

        const uid = AppState.currentUser.uid;
        const myPosts = posts.filter(p => p.authorId === uid);
        const myPostsSorted = [...myPosts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const totalAmensReceived = myPosts.reduce((sum, p) => sum + Object.keys(p.amens || {}).length, 0);
        const totalCommentsReceived = myPosts.reduce((sum, p) => sum + Object.keys(p.comments || {}).length, 0);
        const recentTopics = [...new Set(posts.flatMap(p => p.tags || []))].slice(0, 8);

        return {
            myPostsCount: myPosts.length,
            latestOwnPost: myPostsSorted[0] || null,
            totalAmensReceived,
            totalCommentsReceived,
            recentTopics
        };
    } catch (error) {
        console.error('Error building Space summary for Shepherd:', error);
        return null;
    }
}

/**
 * Fast local backstop for crisis language. This runs on every outgoing
 * user message *in addition to* asking the AI to self-report a crisis via
 * §CRISIS§, so a banner still appears even if the model misses it.
 */
function detectCrisisKeywords(text) {
    if (!text) return null;
    const t = text.toLowerCase();

    const patterns = [
        { category: 'suicide', regex: /\b(kill myself|end my life|suicid|don'?t want to (live|be alive)|want to die|better off dead)\b/ },
        { category: 'self_harm', regex: /\b(self.?harm|cutting myself|hurt(ing)? myself|harming myself)\b/ },
        { category: 'abuse', regex: /\b(being abused|sexually abused|molest|being trafficked|someone is hurting me)\b/ },
        { category: 'domestic_violence', regex: /\b(my (husband|wife|partner|boyfriend|girlfriend) (hits|hit|beats|beat) me|domestic violence|afraid (he|she) will hurt me)\b/ }
    ];

    for (const p of patterns) {
        if (p.regex.test(t)) return { category: p.category };
    }
    return null;
}

async function callDeepSeekAI(message) {
    const systemPrompt = `You are Shepherd, the AI-powered Christian companion inside the GraceGuide app. You are knowledgeable, compassionate, and biblically grounded. You reference the Bible when appropriate, provide specific verses, explain biblical context, encourage personal Bible study, and maintain a conversational, warm tone while remaining respectful. You distinguish between what Scripture says and areas where Christians may have different interpretations. You never present personal opinions as biblical facts.

App feature knowledge: you are fully aware of every part of GraceGuide and can explain, guide, or answer questions about any of them:
- Bible: a full Bible reader (KJV, NLT, MSG, AMP) with bookmarking, highlighting, notes, and font size controls.
- Shepherd: this AI chat itself — for questions, prayer, study help, and encouragement.
- Space: a devotional social feed where users post testimonies/thoughts, notes, study plans, or video links as swipeable cards. Other users can react with "Amen" (like), comment, save, or share a post. Users build a daily posting streak (a flame counter) by posting at least once per day. Anyone can copy a shared study plan from Space straight into their own Study Planner via an "Add to My Study Plan" button.
- Forum: topic-based group chats users can create or join to discuss faith, study, and life together.
- Study Planner: day-by-day Bible reading plans (AI-generated or custom) with passages, topics, reflection questions, prayer points, progress tracking, and a completion streak.
- Chats: one-to-one direct messaging, but only between "Brethren" — users who have sent and accepted a connection request on each other's profile. Has its own daily streak per conversation.
- Notifications: a bell icon in the top bar shows Brethren requests and alerts for Amens/comments on the user's own Space posts, updating live.
- Profile: username, bio, avatar, bookmarks, notes, and reading history; other users' public profiles can be viewed, connected with (Brethren), messaged once connected, reported, or blocked.
- Talk to Someone: a page with resources for reaching a real person for support.
- Settings: theme (light/dark), Bible version default, and account settings.
If asked what something is, how to use it, or "how do I do X in the app", answer directly and practically using this knowledge — don't say you don't have access to app features.

Formatting rules: Write in plain, natural sentences and short paragraphs. Do not use markdown symbols like **, ##, or bullet dashes, and do not use em dashes. If a list genuinely helps, write it as short plain sentences separated by line breaks instead of using markdown list syntax.

Action rule: If, and only if, the user is clearly asking you to DO something the app can perform for them (create a study plan, post a verse or share something to Space, open a specific Bible passage, or save a note/prayer list as a downloadable file), end your reply with exactly one line in this exact machine-readable format and nothing after it:
§ACTION§{"type":"create_plan|create_post|open_bible|download_file","label":"short button label","data":{...}}
For create_plan, data may include planType, duration (days), description.
For create_post, data may include content, reference, embedUrl.
For open_bible, data must include book, chapter, and optionally verse.
For download_file, data must include filename and content.
Omit the §ACTION§ line entirely for normal conversational replies.

Safety rule: If, and only if, the user's message describes suicidal thoughts, self-harm, sexual abuse, domestic violence, or another severe personal-safety crisis, respond first with a brief, warm, stabilizing message (do not counsel them at length, do not diagnose, do not moralize) and gently encourage them to reach out to a real person. Then end your reply with exactly one line in this exact machine-readable format:
§CRISIS§{"category":"suicide|self_harm|abuse|domestic_violence|severe_crisis","message":"one short compassionate sentence encouraging them to talk to a real person"}
A §CRISIS§ line can appear together with or instead of an §ACTION§ line, each on its own line. Omit it entirely for ordinary conversations, including ordinary sadness, doubt, or struggle that isn't an acute safety crisis.`;

    const userContext = await buildShepherdUserContext();

    // Send recent conversation history so Shepherd has continuity within
    // this conversation, not just the latest message in isolation.
    const recentHistory = AppState.aiChatHistory
        .slice(-12)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'system', content: userContext },
                ...recentHistory,
                { role: 'user', content: message }
            ],
            temperature: 0.7,
            max_tokens: 600
        })
    });
    
    if (!response.ok) {
        throw new Error('AI API request failed');
    }
    
    const data = await response.json();
    const rawText = data.choices[0].message.content;

    const { cleanText, action, crisis } = extractAIMeta(rawText);

    // Extract Bible references (simple pattern matching)
    const bibleRefs = extractBibleReferences(cleanText);

    // Local keyword backstop, in case the model didn't self-report.
    const localCrisis = detectCrisisKeywords(message);

    return {
        text: cleanText,
        bibleRefs: bibleRefs,
        action,
        crisis: crisis || localCrisis
    };
}

/* ---- Structured (non-markdown) rendering for AI replies ---- */
function inlineFormat(str) {
    return str
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function formatAIText(raw) {
    if (!raw) return '';
    let text = escapeHtml(raw);

    // Replace em/en dashes used as structural punctuation with plain, conversational punctuation
    text = text.replace(/\s*[—–]\s*/g, ', ');

    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let listType = null;

    const closeList = () => {
        if (inList) {
            html += listType === 'ol' ? '</ol>' : '</ul>';
            inList = false;
            listType = null;
        }
    };

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) { closeList(); return; }

        const headerMatch = trimmed.match(/^#{1,4}\s+(.*)$/);
        if (headerMatch) {
            closeList();
            html += `<h4 class="ai-heading">${inlineFormat(headerMatch[1])}</h4>`;
            return;
        }

        const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
        if (bulletMatch) {
            if (!inList || listType !== 'ul') { closeList(); html += '<ul class="ai-list">'; inList = true; listType = 'ul'; }
            html += `<li>${inlineFormat(bulletMatch[1])}</li>`;
            return;
        }

        const numMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
        if (numMatch) {
            if (!inList || listType !== 'ol') { closeList(); html += '<ol class="ai-list">'; inList = true; listType = 'ol'; }
            html += `<li>${inlineFormat(numMatch[1])}</li>`;
            return;
        }

        closeList();
        html += `<p>${inlineFormat(trimmed)}</p>`;
    });

    closeList();
    return html;
}

function stripMarkdownForSpeech(raw) {
    if (!raw) return '';
    return raw
        .replace(/§ACTION§[\s\S]*$/, '')
        .replace(/\s*[—–]\s*/g, ', ')
        .replace(/^#{1,4}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^[-*•]\s+/gm, '')
        .replace(/^\d+[.)]\s+/gm, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim();
}

/* ============================================
   VOICE (Text-to-Speech for Shepherd's replies)
   ============================================ */
// Uses only the browser's free, built-in Web Speech API (SpeechSynthesis) —
// no paid/cloud service or API key required. Personas are matched to
// on-device voices by gender/name hints at speak-time, so the exact voice
// heard can vary by browser/OS, but the set always includes at least one
// male and one female option.
const SHEPHERD_VOICES = [
    { id: 'david', label: 'David', gender: 'Male', description: 'Warm, steady male voice' },
    { id: 'aria', label: 'Aria', gender: 'Female', description: 'Warm, steady female voice' },
    { id: 'daniel', label: 'Daniel', gender: 'Male', description: 'Calm, measured male voice' },
    { id: 'grace', label: 'Grace', gender: 'Female', description: 'Gentle, encouraging female voice' }
];

let availableVoices = [];
let currentSpeakingIndex = null;

function getSelectedVoiceOption() {
    const savedId = localStorage.getItem('graceguide_voice_id');
    return SHEPHERD_VOICES.find(v => v.id === savedId) || SHEPHERD_VOICES.find(v => v.id === AppState.selectedVoiceId) || SHEPHERD_VOICES[0];
}

function initVoices() {
    AppState.selectedVoiceId = localStorage.getItem('graceguide_voice_id') || SHEPHERD_VOICES[0].id;

    if (window.speechSynthesis) {
        const loadBrowserVoices = () => { availableVoices = window.speechSynthesis.getVoices() || []; };
        loadBrowserVoices();
        window.speechSynthesis.onvoiceschanged = loadBrowserVoices;
    }
}

// Picks the best available on-device voice for a persona's gender. Falls
// back gracefully so a male voice is always available if the device has
// one at all — same for female.
function pickBrowserVoiceForGender(gender) {
    if (availableVoices.length === 0) return null;
    const englishVoices = availableVoices.filter(v => v.lang?.toLowerCase().startsWith('en'));
    const pool = englishVoices.length ? englishVoices : availableVoices;

    const femaleHints = ['female', 'samantha', 'victoria', 'aria', 'jenny', 'zira', 'susan', 'karen', 'moira', 'grace', 'fiona'];
    const maleHints = ['male', 'david', 'guy', 'daniel', 'alex', 'fred', 'george', 'mark', 'james'];
    const hints = gender === 'Male' ? maleHints : femaleHints;

    const match = pool.find(v => hints.some(h => v.name.toLowerCase().includes(h)));
    return match || pool[0];
}

function stopSpeaking() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (currentSpeakingIndex !== null) {
        const btn = document.getElementById(`listen-btn-${currentSpeakingIndex}`);
        if (btn) btn.classList.remove('speaking');
    }
    currentSpeakingIndex = null;
}

async function toggleSpeakMessage(index) {
    if (currentSpeakingIndex === index) {
        stopSpeaking();
        return;
    }
    stopSpeaking();

    const msg = AppState.aiChatHistory[index];
    if (!msg) return;

    const text = stripMarkdownForSpeech(msg.content);
    if (!text) return;

    if (!window.speechSynthesis) {
        showToast('Voice playback is not supported on this device', 'warning');
        return;
    }

    const voice = getSelectedVoiceOption();
    const btn = document.getElementById(`listen-btn-${index}`);

    currentSpeakingIndex = index;
    if (btn) btn.classList.add('speaking');

    const onDone = () => {
        if (btn) btn.classList.remove('speaking');
        if (currentSpeakingIndex === index) currentSpeakingIndex = null;
    };

    try {
        const utterance = new SpeechSynthesisUtterance(text);
        const browserVoice = pickBrowserVoiceForGender(voice.gender);
        if (browserVoice) utterance.voice = browserVoice;
        utterance.rate = 0.96;
        utterance.pitch = voice.gender === 'Male' ? 0.9 : 1.05;
        utterance.onend = onDone;
        utterance.onerror = onDone;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.error('TTS error:', error);
        showToast('Voice playback failed', 'error');
        onDone();
    }
}

function showVoicePickerSheet() {
    const renderVoiceList = () => SHEPHERD_VOICES.map(v => `
        <div class="voice-option ${v.id === getSelectedVoiceOption().id ? 'active' : ''}" data-voice-id="${v.id}">
            <div class="voice-option-info" onclick="selectVoice('${v.id}')">
                <div class="voice-option-name">${v.label} <span style="font-weight:400; color: var(--text-slate);">— ${v.gender}</span></div>
                <div class="voice-option-lang">${v.description}</div>
            </div>
            <button class="icon-btn" onclick="previewVoice('${v.id}')" aria-label="Preview voice">
                <i class="fas fa-play"></i>
            </button>
            <i class="fas fa-check voice-selected-check"></i>
        </div>
    `).join('');

    showSheet(`
        <h3 style="margin-bottom: 4px;">Shepherd's Voice</h3>
        <p class="text-muted" style="font-size: 13px; margin-bottom: 16px;">Choose how AI replies sound when read aloud. Voices use your device's built-in speech engine and are always free.</p>
        <div id="voice-options-list">${renderVoiceList()}</div>
    `);
}

function selectVoice(voiceId) {
    AppState.selectedVoiceId = voiceId;
    localStorage.setItem('graceguide_voice_id', voiceId);

    $$('.voice-option').forEach(el => {
        el.classList.toggle('active', el.dataset.voiceId === voiceId);
    });

    showToast('Voice updated', 'success');
}

async function previewVoice(voiceId) {
    stopSpeaking();
    const voice = SHEPHERD_VOICES.find(v => v.id === voiceId);
    if (!voice) return;

    if (!window.speechSynthesis) {
        showToast('Voice playback is not supported on this device', 'warning');
        return;
    }

    const sampleText = "Peace be with you. This is how I'll sound.";

    try {
        const utterance = new SpeechSynthesisUtterance(sampleText);
        const browserVoice = pickBrowserVoiceForGender(voice.gender);
        if (browserVoice) utterance.voice = browserVoice;
        utterance.rate = 0.96;
        utterance.pitch = voice.gender === 'Male' ? 0.9 : 1.05;
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.error('Voice preview error:', error);
        showToast('Could not preview this voice', 'error');
    }
}

/* ---- AI-triggered action widgets ---- */
function extractAIMeta(text) {
    let cleanText = text;
    let action = null;
    let crisis = null;

    const actionMatch = text.match(/§ACTION§(\{[\s\S]*?\})\s*$/m) || text.match(/§ACTION§(\{[\s\S]*\})\s*$/);
    const crisisMatch = text.match(/§CRISIS§(\{[\s\S]*?\})\s*$/m) || text.match(/§CRISIS§(\{[\s\S]*\})\s*$/);

    // Strip whichever markers are present from the tail of the text, starting
    // with whichever one appears later so earlier indices stay valid.
    [actionMatch, crisisMatch]
        .filter(Boolean)
        .sort((a, b) => b.index - a.index)
        .forEach(m => { cleanText = cleanText.slice(0, m.index).trimEnd(); });

    if (actionMatch) {
        try { action = JSON.parse(actionMatch[1]); } catch (e) { action = null; }
    }
    if (crisisMatch) {
        try { crisis = JSON.parse(crisisMatch[1]); } catch (e) { crisis = null; }
    }

    return { cleanText: cleanText.trim(), action, crisis };
}

function renderActionWidget(action, actionId) {
    if (!action) return '';
    const icons = {
        create_plan: 'fa-calendar-check',
        create_post: 'fa-users',
        open_bible: 'fa-book-bible',
        download_file: 'fa-download'
    };
    const icon = icons[action.type] || 'fa-bolt';

    return `
        <button class="ai-action-widget" id="widget-${actionId}" onclick="executeAIAction('${actionId}')">
            <span class="ai-action-icon"><i class="fas ${icon}"></i></span>
            <span class="ai-action-label">${escapeHtml(action.label || 'Run this')}</span>
            <i class="fas fa-arrow-right ai-action-arrow"></i>
        </button>
    `;
}

async function executeAIAction(actionId) {
    const action = pendingAIActions[actionId];
    if (!action) return;

    const widget = document.getElementById(`widget-${actionId}`);
    if (widget) {
        widget.disabled = true;
        widget.classList.add('running');
    }

    try {
        switch (action.type) {
            case 'create_plan': {
                const data = action.data || {};
                const duration = parseInt(data.duration) || 7;
                const plan = await generatePlanWithAI(data.planType || 'custom', duration, data.description || action.label);

                AppState.currentPlan = plan;
                AppState.plannerData.push(plan);

                if (AppState.currentUser) {
                    await database.ref(`users/${AppState.currentUser.uid}/planner`).set(AppState.plannerData);
                }

                showToast('Plan created!', 'success');
                navigateTo('planner');
                break;
            }
            case 'create_post': {
                if (!AppState.currentUser) {
                    showToast('Please sign in first', 'warning');
                    break;
                }
                const data = action.data || {};
                let slides;
                let type;
                if (data.reference) {
                    type = 'verses';
                    slides = [{ kind: 'verse', reference: data.reference, text: data.content || '' }];
                } else if (data.embedUrl) {
                    type = 'video';
                    slides = [];
                } else {
                    type = 'shepherd';
                    slides = splitTextIntoSlides(data.content || action.label || '', 'Shepherd says');
                }

                const post = buildSpacePostObject({
                    type,
                    slides,
                    videoUrl: data.embedUrl || null,
                    tags: extractTags(data.content || action.label || '')
                });

                await database.ref(`spacePosts/${post.id}`).set(post);
                showToast('Posted to Space!', 'success');
                navigateTo('space');
                break;
            }
            case 'open_bible': {
                const data = action.data || {};
                openBibleChapter(data.book || 'John', parseInt(data.chapter) || 1, data.verse ? parseInt(data.verse) : undefined);
                break;
            }
            case 'download_file': {
                const data = action.data || {};
                const blob = new Blob([data.content || ''], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = data.filename || 'graceguide-note.txt';
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                showToast('File downloaded', 'success');
                break;
            }
            default:
                showToast('This action is not supported yet', 'warning');
        }

        if (widget) {
            widget.classList.remove('running');
            widget.classList.add('done');
            widget.innerHTML = `<span class="ai-action-icon"><i class="fas fa-check"></i></span><span class="ai-action-label">Done</span>`;
        }
    } catch (error) {
        console.error('Action error:', error);
        showToast('Failed to complete that action', 'error');
        if (widget) {
            widget.disabled = false;
            widget.classList.remove('running');
        }
    }
}

/* ---- Conversation history (saved to the database) ---- */
async function loadAIConversationsList() {
    if (!AppState.currentUser) return [];

    try {
        const uid = AppState.currentUser.uid;
        const snapshot = await database.ref(`users/${uid}/aiConversations`).once('value');
        const data = snapshot.val() || {};
        AppState.aiConversations = Object.values(data).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (error) {
        console.error('Error loading conversations:', error);
    }

    return AppState.aiConversations;
}

async function saveCurrentConversation() {
    if (!AppState.currentUser || AppState.aiChatHistory.length === 0) return;

    const uid = AppState.currentUser.uid;
    if (!AppState.currentConversationId) {
        AppState.currentConversationId = generateId();
    }

    const existing = AppState.aiConversations.find(c => c.id === AppState.currentConversationId);
    const conv = {
        id: AppState.currentConversationId,
        title: existing?.title || truncate(AppState.aiChatHistory[0].content, 40),
        titleRefined: existing?.titleRefined || false,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages: AppState.aiChatHistory
    };

    try {
        await database.ref(`users/${uid}/aiConversations/${conv.id}`).set(conv);
        const idx = AppState.aiConversations.findIndex(c => c.id === conv.id);
        if (idx !== -1) AppState.aiConversations[idx] = conv;
        else AppState.aiConversations.unshift(conv);
    } catch (error) {
        console.error('Error saving conversation:', error);
    }

    // Once we have a real exchange, ask the AI for a short, refined title
    if (!conv.titleRefined && AppState.aiChatHistory.length >= 2) {
        refineConversationTitle(conv.id, AppState.aiChatHistory);
    }
}

async function refineConversationTitle(convId, messages) {
    try {
        const summaryPrompt = `Give a short, plain title (4 words or fewer, no quotes, no punctuation at the end) that summarizes what this conversation is about:\nUser: ${messages[0].content}\nAssistant: ${(messages[1]?.content || '').slice(0, 200)}`;

        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: summaryPrompt }],
                temperature: 0.4,
                max_tokens: 20
            })
        });

        if (!response.ok) return;
        const data = await response.json();
        let title = data.choices?.[0]?.message?.content?.trim().replace(/^["']+|["']+$/g, '');
        if (!title) return;
        if (title.length > 48) title = title.slice(0, 48);

        if (AppState.currentUser) {
            await database.ref(`users/${AppState.currentUser.uid}/aiConversations/${convId}`).update({ title, titleRefined: true });
        }

        const idx = AppState.aiConversations.findIndex(c => c.id === convId);
        if (idx !== -1) {
            AppState.aiConversations[idx].title = title;
            AppState.aiConversations[idx].titleRefined = true;
        }

        if (AppState.currentConversationId === convId) {
            const titleEl = $('#chat-conversation-title');
            if (titleEl) titleEl.textContent = title;
        }
    } catch (error) {
        console.error('Error refining conversation title:', error);
    }
}

function startNewConversation() {
    stopSpeaking();
    AppState.aiChatHistory = [];
    AppState.currentConversationId = null;
    renderAskPage();
}

function loadConversation(convId) {
    const conv = AppState.aiConversations.find(c => c.id === convId);
    if (!conv) return;

    stopSpeaking();
    AppState.aiChatHistory = conv.messages || [];
    AppState.currentConversationId = conv.id;
    closeSheet();
    renderAskPage();
}

function showConversationHistory() {
    if (!requireAuth('Sign in to save your conversation history.')) return;

    const renderList = () => {
        if (AppState.aiConversations.length === 0) {
            return `<p class="text-center text-muted" style="padding: 24px 0;">No saved conversations yet</p>`;
        }
        return AppState.aiConversations.map(conv => `
            <div class="conversation-item ${conv.id === AppState.currentConversationId ? 'active' : ''}">
                <div class="conversation-item-main" onclick="loadConversation('${conv.id}')">
                    <div style="font-weight: 600;">${escapeHtml(conv.title || 'Untitled conversation')}</div>
                    <div style="font-size: 12px; color: var(--text-slate);">${formatDate(conv.updatedAt || conv.createdAt)}</div>
                </div>
                <button class="icon-btn" onclick="closeSheetThen(() => renameConversation('${conv.id}'))" aria-label="Rename">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="icon-btn" onclick="closeSheetThen(() => deleteConversation('${conv.id}'))" aria-label="Delete">
                    <i class="fas fa-trash" style="color: #f44336;"></i>
                </button>
            </div>
        `).join('');
    };

    const sheetContent = `
        <div class="flex items-center justify-between mb-3">
            <h3>Conversations</h3>
            <button class="btn btn-primary btn-sm" onclick="closeSheetThen(startNewConversation)">
                <i class="fas fa-plus"></i> New
            </button>
        </div>
        <div id="conversation-list">${renderList()}</div>
    `;

    showSheet(sheetContent);

    loadAIConversationsList().then(() => {
        const listEl = $('#conversation-list');
        if (listEl) listEl.innerHTML = renderList();
    });
}

function renameConversation(convId) {
    const conv = AppState.aiConversations.find(c => c.id === convId);
    if (!conv) return;

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Rename Conversation</h3>
        <input type="text" id="rename-conv-input" class="form-input" value="${escapeHtml(conv.title || '')}">
        <button id="save-rename-btn" class="btn btn-primary btn-block mt-3">Save</button>
    `;
    showModal(modalContent);

    $('#save-rename-btn').addEventListener('click', async () => {
        const newTitle = $('#rename-conv-input').value.trim();
        if (!newTitle) {
            showToast('Title cannot be empty', 'warning');
            return;
        }

        try {
            if (AppState.currentUser) {
                await database.ref(`users/${AppState.currentUser.uid}/aiConversations/${convId}`).update({ title: newTitle, titleRefined: true });
            }
            conv.title = newTitle;
            conv.titleRefined = true;
            closeModalThen(() => {
                showToast('Renamed', 'success');
                showConversationHistory();
            });
        } catch (error) {
            showToast('Failed to rename', 'error');
        }
    });
}

function deleteConversation(convId) {
    showModal(`
        <h3 style="margin-bottom: 16px;">Delete Conversation</h3>
        <p>This can't be undone.</p>
        <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-accent" onclick="confirmDeleteConversation('${convId}')">Delete</button>
        </div>
    `);
}

async function confirmDeleteConversation(convId) {
    try {
        if (AppState.currentUser) {
            await database.ref(`users/${AppState.currentUser.uid}/aiConversations/${convId}`).remove();
        }
        AppState.aiConversations = AppState.aiConversations.filter(c => c.id !== convId);
        if (AppState.currentConversationId === convId) {
            startNewConversation();
        }
        closeModalThen(() => {
            showToast('Conversation deleted', 'success');
            showConversationHistory();
        });
    } catch (error) {
        showToast('Failed to delete', 'error');
    }
}

function extractBibleReferences(text) {
    const refs = [];
    const patterns = [
        /\b(?:[1-3]\s*)?(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|John|Jude|Revelation)\s+\d+:\d+(?:\s*[-–]\s*\d+)?\b/gi
    ];
    
    patterns.forEach(pattern => {
        const matches = text.match(pattern);
        if (matches) {
            refs.push(...matches);
        }
    });
    
    return refs.length > 0 ? refs.join(', ') : null;
}

/* ============================================
   STUDY PLANNER
   ============================================ */
function renderPlannerPage() {
    DOM.pageContainer.innerHTML = `
        <div class="planner-container">
            <div class="flex items-center justify-between mb-4">
                <h2 style="font-weight: 700;">Study Planner</h2>
                <button class="btn btn-primary btn-sm" onclick="createNewPlan()">
                    <i class="fas fa-plus"></i> New Plan
                </button>
            </div>

            ${AppState.plannerData.length > 1 ? `
                <div class="form-group" style="margin-bottom: 16px;">
                    <select id="plan-switcher" class="form-select">
                        ${AppState.plannerData.map(p => `<option value="${p.id}" ${p.id === AppState.currentPlan?.id ? 'selected' : ''}>${escapeHtml(p.name || 'Study Plan')}</option>`).join('')}
                    </select>
                </div>
            ` : ''}

            <div class="planner-stats">
                <div class="stat-card">
                    <div class="stat-value">${AppState.currentPlan?.progress || 0}%</div>
                    <div class="stat-label">Overall Progress</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${AppState.currentPlan?.streak || 0}</div>
                    <div class="stat-label">Day Streak</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${AppState.currentPlan?.completed || 0}/${AppState.currentPlan?.total || 0}</div>
                    <div class="stat-label">Days Completed</div>
                </div>
            </div>
            
            <div id="planner-content">
                ${AppState.plannerData.length > 0 ? `
                    <div class="flex items-center justify-between mb-2">
                        <h3 style="font-weight: 600;">${escapeHtml(AppState.currentPlan?.name || 'Reading')}</h3>
                        <div style="display:flex; gap:8px;">
                            <button class="btn btn-outline btn-sm" onclick="addPlannerDay()">
                                <i class="fas fa-plus"></i> Add Entry
                            </button>
                            <button class="btn btn-outline btn-sm" onclick="deleteCurrentPlan()" style="color:#f44336; border-color:rgba(244,67,54,0.4);">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    ${renderPlannerDays()}
                ` : `
                    <div class="empty-state">
                        <div class="empty-state-icon">
                            <i class="fas fa-calendar-check"></i>
                        </div>
                        <h3 style="margin-bottom: 8px;">No Active Plans</h3>
                        <p style="color: var(--text-slate); margin-bottom: 16px;">Create your first study plan with AI assistance.</p>
                        <button class="btn btn-primary" onclick="createNewPlan()">
                            <i class="fas fa-plus"></i> Create Plan
                        </button>
                    </div>
                `}
            </div>
        </div>
    `;

    const switcher = $('#plan-switcher');
    if (switcher) {
        switcher.addEventListener('change', (e) => switchPlan(e.target.value));
    }
}

function switchPlan(planId) {
    const plan = AppState.plannerData.find(p => p.id === planId);
    if (!plan) return;
    AppState.currentPlan = plan;
    renderPlannerPage();
}

function renderPlannerDays() {
    if (!AppState.currentPlan || !AppState.currentPlan.days) return '';

    return AppState.currentPlan.days.map((day, index) => `
        <div class="planner-day ${day.completed ? 'completed' : ''}">
            <div class="planner-day-checkbox ${day.completed ? 'checked' : ''}" onclick="event.stopPropagation(); togglePlannerDay('${day.date}')">
                ${day.completed ? '<i class="fas fa-check"></i>' : ''}
            </div>
            <div style="flex: 1; cursor: pointer;" onclick="openPassageReference('${escapeHtml(day.passage).replace(/'/g, "\\'")}')">
                <div style="font-weight: 600;">${escapeHtml(day.passage)}</div>
                <div style="font-size: 12px; color: var(--text-slate);">${escapeHtml(day.topic)}</div>
                <div style="font-size: 12px; color: var(--text-slate);">${formatDate(day.date)}</div>
            </div>
            <button class="icon-btn" aria-label="Edit entry" onclick="event.stopPropagation(); editPlannerDay(${index})">
                <i class="fas fa-pen" style="font-size: 13px; color: var(--text-slate);"></i>
            </button>
            <button class="icon-btn" aria-label="Delete entry" onclick="event.stopPropagation(); deletePlannerDay(${index})">
                <i class="fas fa-trash" style="font-size: 13px; color: #f44336;"></i>
            </button>
            <i class="fas fa-chevron-right" style="color: var(--text-slate); cursor: pointer;" onclick="openPassageReference('${escapeHtml(day.passage).replace(/'/g, "\\'")}')"></i>
        </div>
    `).join('');
}

function persistPlannerData() {
    if (!AppState.currentUser) return;
    const uid = AppState.currentUser.uid;
    const planIndex = AppState.plannerData.findIndex(p => p.id === AppState.currentPlan.id);
    if (planIndex !== -1) AppState.plannerData[planIndex] = AppState.currentPlan;
    database.ref(`users/${uid}/planner`).set(AppState.plannerData);
}

function recalcPlanProgress() {
    if (!AppState.currentPlan) return;
    const days = AppState.currentPlan.days || [];
    const completedDays = days.filter(d => d.completed);
    AppState.currentPlan.total = days.length;
    AppState.currentPlan.completed = completedDays.length;
    AppState.currentPlan.progress = days.length ? Math.round((completedDays.length / days.length) * 100) : 0;
}

function addPlannerDay() {
    if (!AppState.currentPlan) return;

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Add Study Entry</h3>
        <div class="form-group">
            <label class="form-label">Passage</label>
            <input type="text" id="entry-passage" class="form-input" placeholder="e.g., Romans 8:28-39">
        </div>
        <div class="form-group">
            <label class="form-label">Topic</label>
            <input type="text" id="entry-topic" class="form-input" placeholder="e.g., Hope">
        </div>
        <div class="form-group">
            <label class="form-label">Date</label>
            <input type="date" id="entry-date" class="form-input" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <button id="save-entry-btn" class="btn btn-primary btn-block mt-3">Add Entry</button>
    `;
    showModal(modalContent);

    $('#save-entry-btn').addEventListener('click', () => {
        const passage = $('#entry-passage').value.trim();
        const topic = $('#entry-topic').value.trim();
        if (!passage) {
            showToast('Please enter a passage', 'warning');
            return;
        }

        AppState.currentPlan.days.push({
            date: $('#entry-date').value || new Date().toISOString().split('T')[0],
            passage,
            topic: topic || 'Study',
            completed: false
        });

        recalcPlanProgress();
        persistPlannerData();
        closeModal();
        showToast('Entry added', 'success');
        renderPlannerPage();
    });
}

function editPlannerDay(index) {
    if (!AppState.currentPlan || !AppState.currentPlan.days[index]) return;
    const day = AppState.currentPlan.days[index];

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Edit Study Entry</h3>
        <div class="form-group">
            <label class="form-label">Passage</label>
            <input type="text" id="entry-passage" class="form-input" value="${escapeHtml(day.passage || '')}">
        </div>
        <div class="form-group">
            <label class="form-label">Topic</label>
            <input type="text" id="entry-topic" class="form-input" value="${escapeHtml(day.topic || '')}">
        </div>
        <div class="form-group">
            <label class="form-label">Reflection Question</label>
            <textarea id="entry-reflection" class="form-textarea" rows="2">${escapeHtml(day.reflection_question || '')}</textarea>
        </div>
        <div class="form-group">
            <label class="form-label">Prayer Point</label>
            <textarea id="entry-prayer" class="form-textarea" rows="2">${escapeHtml(day.prayer_point || '')}</textarea>
        </div>
        <div class="form-group">
            <label class="form-label">Date</label>
            <input type="date" id="entry-date" class="form-input" value="${day.date || ''}">
        </div>
        <button id="save-entry-btn" class="btn btn-primary btn-block mt-3">Save Changes</button>
    `;
    showModal(modalContent);

    $('#save-entry-btn').addEventListener('click', () => {
        const passage = $('#entry-passage').value.trim();
        if (!passage) {
            showToast('Please enter a passage', 'warning');
            return;
        }

        Object.assign(day, {
            passage,
            topic: $('#entry-topic').value.trim() || 'Study',
            reflection_question: $('#entry-reflection').value.trim(),
            prayer_point: $('#entry-prayer').value.trim(),
            date: $('#entry-date').value || day.date
        });

        persistPlannerData();
        closeModal();
        showToast('Entry updated', 'success');
        renderPlannerPage();
    });
}

function deletePlannerDay(index) {
    if (!AppState.currentPlan || !AppState.currentPlan.days[index]) return;

    AppState.currentPlan.days.splice(index, 1);
    recalcPlanProgress();
    persistPlannerData();
    showToast('Entry deleted', 'success');
    renderPlannerPage();
}

function deleteCurrentPlan() {
    if (!AppState.currentPlan) return;
    const planId = AppState.currentPlan.id;

    showModal(`
        <h3 style="margin-bottom: 12px;">Delete this plan?</h3>
        <p style="color: var(--text-slate); margin-bottom: 20px;">This will permanently remove "${escapeHtml(AppState.currentPlan.name || 'this plan')}" and all its entries.</p>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
            <button class="btn btn-block" style="background:#f44336; color:white;" onclick="confirmDeletePlan('${planId}')">Delete</button>
        </div>
    `);
}

function confirmDeletePlan(planId) {
    AppState.plannerData = AppState.plannerData.filter(p => p.id !== planId);
    AppState.currentPlan = AppState.plannerData[0] || null;

    if (AppState.currentUser) {
        database.ref(`users/${AppState.currentUser.uid}/planner`).set(AppState.plannerData);
    }

    closeModal();
    showToast('Plan deleted', 'success');
    renderPlannerPage();
}

function createNewPlan() {
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Create Study Plan</h3>
        <p style="color: var(--text-slate); margin-bottom: 16px;">Let AI create a personalized plan for you.</p>
        
        <div class="form-group">
            <label class="form-label">Plan Type</label>
            <select id="plan-type" class="form-select">
                <option value="new_christian">New Christian</option>
                <option value="bible_year">Read Bible in One Year</option>
                <option value="faith_struggle">30-Day Faith Journey</option>
                <option value="relationships">Relationships</option>
                <option value="prayer">Prayer</option>
                <option value="purpose">Purpose & Calling</option>
                <option value="young_christians">Young Christians</option>
                <option value="gospel">Gospel Reading</option>
                <option value="character_study">Character Study</option>
                <option value="custom">Custom Plan</option>
            </select>
        </div>
        
        <div class="form-group" id="custom-plan-group" style="display: none;">
            <label class="form-label">Describe Your Plan</label>
            <textarea id="custom-plan-description" class="form-textarea" placeholder="What would you like to study?"></textarea>
        </div>
        
        <div class="form-group">
            <label class="form-label">Duration</label>
            <select id="plan-duration" class="form-select">
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
            </select>
        </div>
        
        <button id="generate-plan-btn" class="btn btn-primary btn-block mt-3">
            <i class="fas fa-dove"></i> Generate Plan
        </button>
    `;
    
    showModal(modalContent);
    
    $('#plan-type').addEventListener('change', (e) => {
        $('#custom-plan-group').style.display = e.target.value === 'custom' ? 'block' : 'none';
    });
    
    $('#generate-plan-btn').addEventListener('click', async () => {
        const planType = $('#plan-type').value;
        const duration = parseInt($('#plan-duration').value);
        const customDescription = $('#custom-plan-description')?.value;

        const btn = $('#generate-plan-btn');
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.innerHTML = `<span class="btn-spinner"></span> Generating…`;

        try {
            const plan = await generatePlanWithAI(planType, duration, customDescription, (done, total) => {
                if (btn) btn.innerHTML = `<span class="btn-spinner"></span> Generating ${done}/${total} days…`;
            });
            
            AppState.currentPlan = plan;
            AppState.plannerData.push(plan);
            
            if (AppState.currentUser) {
                const uid = AppState.currentUser.uid;
                await database.ref(`users/${uid}/planner`).set(AppState.plannerData);
            }
            
            closeModal();
            showToast('Plan created successfully!', 'success');
            renderPlannerPage();
        } catch (error) {
            showToast('Failed to generate plan', 'error');
            console.error(error);
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            btn.innerHTML = `<i class="fas fa-dove"></i> Generate Plan`;
        }
    });
}

async function generatePlanWithAI(planType, duration, customDescription, onProgress) {
    const planLabel = planType.replace(/_/g, ' ');
    const days = [];
    const startDate = new Date();
    const batchSize = 30;

    const fallbackTopics = ['Faith', 'Hope', 'Love', 'Prayer', 'Forgiveness', 'Purpose', 'Wisdom', 'Peace', 'Joy', 'Patience'];
    const fallbackPassages = ['Matthew 5', 'Psalm 23', 'Romans 8', 'Proverbs 3', 'John 3', 'Philippians 4', 'Isaiah 40', 'Jeremiah 29', 'James 1', '1 Corinthians 13'];

    while (days.length < duration) {
        const remaining = duration - days.length;
        const count = Math.min(batchSize, remaining);
        const usedTopics = days.slice(-10).map(d => d.topic).filter(Boolean);

        const prompt = `Create ${count} consecutive days of a Bible reading plan for someone focused on: ${planLabel}.${customDescription ? ` Specific focus: ${customDescription}.` : ''}
This is day ${days.length + 1} through ${days.length + count} of a ${duration}-day plan.
${usedTopics.length ? `Avoid repeating these recent topics: ${usedTopics.join(', ')}.` : ''}
Respond with ONLY a JSON array (no markdown, no code fences, no commentary) of exactly ${count} objects, each with these exact fields:
- "passage": a specific Bible reference (e.g. "Romans 8:28-39")
- "topic": a short 1-3 word theme
- "reflection_question": one thoughtful open-ended question about the passage
- "prayer_point": one short prayer focus related to the passage`;

        try {
            const response = await fetch(DEEPSEEK_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: 'You generate structured Bible reading plans. You always respond with strictly valid JSON only — no markdown formatting, no code fences, no extra text before or after the JSON array.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.8,
                    max_tokens: Math.min(4000, count * 150)
                })
            });

            if (!response.ok) throw new Error('AI plan request failed');

            const data = await response.json();
            let raw = data.choices[0].message.content.trim();
            raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

            const arrayMatch = raw.match(/\[[\s\S]*\]/);
            const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : raw);

            parsed.slice(0, count).forEach(entry => {
                const date = new Date(startDate);
                date.setDate(date.getDate() + days.length);
                const topic = entry.topic || planLabel;
                days.push({
                    date: date.toISOString().split('T')[0],
                    passage: entry.passage || 'Psalm 23',
                    topic,
                    reflection_question: entry.reflection_question || `What does this passage teach you about ${topic}?`,
                    prayer_point: entry.prayer_point || `Pray for deeper understanding of ${topic}`,
                    completed: false
                });
            });
        } catch (error) {
            console.error('AI plan generation error — filling this batch with a fallback so the plan still completes:', error);
            for (let i = 0; i < count; i++) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + days.length);
                const topic = fallbackTopics[days.length % fallbackTopics.length];
                days.push({
                    date: date.toISOString().split('T')[0],
                    passage: fallbackPassages[days.length % fallbackPassages.length],
                    topic,
                    reflection_question: `What does this passage teach you about ${topic}?`,
                    prayer_point: `Pray for deeper understanding of ${topic}`,
                    completed: false
                });
            }
        }

        if (onProgress) onProgress(days.length, duration);
    }

    return {
        id: generateId(),
        name: `${planLabel.replace(/\b\w/g, l => l.toUpperCase())} Plan`,
        type: planType,
        duration,
        createdAt: Date.now(),
        days,
        progress: 0,
        streak: 0,
        completed: 0,
        total: duration
    };
}

function togglePlannerDay(date) {
    if (!AppState.currentPlan) return;

    const day = AppState.currentPlan.days.find(d => d.date === date);
    if (day) {
        day.completed = !day.completed;

        recalcPlanProgress();
        persistPlannerData();

        renderPlannerPage();
        showToast(day.completed ? 'Day completed!' : 'Day uncompleted', 'success');
    }
}


/* ============================================
   SPACE — post & discover verses, study plans, notes,
   and Shepherd reflections. Replaces the old TikTok-style
   "Reels" feed from before with a calmer, carousel-friendly feed built
   for daily habit-forming engagement (streaks, saves, Amens).
   ============================================ */

/* ---- Content helpers ---- */

// Breaks a long piece of text (e.g. a Shepherd reply) into carousel
// slides of readable length, breaking on sentence boundaries so no
// sentence is ever cut mid-word.
function splitTextIntoSlides(text, label) {
    const clean = (text || '').trim();
    if (!clean) return [{ kind: 'text', label, text: '' }];

    const MAX_CHARS = 260;
    if (clean.length <= MAX_CHARS) return [{ kind: 'text', label, text: clean }];

    const sentences = clean.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [clean];
    const slides = [];
    let current = '';

    sentences.forEach(sentence => {
        if ((current + sentence).length > MAX_CHARS && current) {
            slides.push(current.trim());
            current = sentence;
        } else {
            current += sentence;
        }
    });
    if (current.trim()) slides.push(current.trim());

    return slides.map((s, i) => ({ kind: 'text', label: slides.length > 1 ? `${label} (${i + 1}/${slides.length})` : label, text: s }));
}

function buildSpacePostObject(fields) {
    return {
        id: generateId(),
        authorId: AppState.currentUser.uid,
        authorName: AppState.userProfile?.username || 'Anonymous',
        timestamp: Date.now(),
        type: fields.type,
        slides: fields.slides || [],
        sourceBook: fields.sourceBook || null,
        sourceChapter: fields.sourceChapter || null,
        videoUrl: fields.videoUrl || null,
        planName: fields.planName || null,
        tags: fields.tags || [],
        amens: {},
        saves: {},
        comments: {}
    };
}

/* ---- Daily posting streak (Snapchat-style, but with yourself/community) ----
   Posting to Space on consecutive calendar days builds a personal streak —
   a light, fun nudge to keep coming back, shown right at the top of the
   feed with a flame counter. */
async function loadSpaceStreak() {
    if (!AppState.currentUser) { AppState.spaceStreak = { count: 0, lastPostDate: null }; return; }
    try {
        const snapshot = await database.ref(`users/${AppState.currentUser.uid}/spaceStreak`).once('value');
        AppState.spaceStreak = snapshot.val() || { count: 0, lastPostDate: null };
    } catch (error) {
        AppState.spaceStreak = { count: 0, lastPostDate: null };
    }
}

async function bumpSpaceStreak() {
    if (!AppState.currentUser) return;
    const today = getTodayDateString();
    const yesterday = getYesterdayDateString();
    const streak = AppState.spaceStreak || { count: 0, lastPostDate: null };

    if (streak.lastPostDate === today) return; // already posted today

    streak.count = streak.lastPostDate === yesterday ? (streak.count || 0) + 1 : 1;
    streak.lastPostDate = today;
    AppState.spaceStreak = streak;

    try {
        await database.ref(`users/${AppState.currentUser.uid}/spaceStreak`).set(streak);
    } catch (error) { /* non-critical */ }

    if (STREAK_MILESTONES.includes(streak.count)) {
        showToast(`🔥 ${streak.count}-day Space streak! You're on a roll.`, 'success');
    }
}

function renderSpaceStreakBanner() {
    if (!AppState.currentUser) return '';
    const streak = AppState.spaceStreak || { count: 0, lastPostDate: null };
    const postedToday = streak.lastPostDate === getTodayDateString();

    return `
        <div class="space-streak-banner ${postedToday ? 'done' : ''}">
            <div class="space-streak-flame"><i class="fas fa-fire"></i></div>
            <div style="flex:1;">
                <div style="font-weight:700;">${streak.count > 0 ? `${streak.count}-day streak` : 'Start your streak'}</div>
                <div style="font-size:12px; color: var(--text-slate);">${postedToday ? "Nice — you've posted today!" : 'Post a verse, note, or reflection to keep it going.'}</div>
            </div>
            ${!postedToday ? `<button class="btn btn-primary btn-sm" onclick="showCreateSpacePostModal()">Post</button>` : ''}
        </div>
    `;
}

/* ---- Page render ---- */
async function renderSpacePage() {
    // Fresh visit starts unfiltered — filters/search are a within-session
    // convenience, not something that should surprise the user by
    // silently persisting from a previous visit.
    AppState.spaceFilterType = 'all';
    AppState.spaceSearchQuery = '';

    DOM.pageContainer.innerHTML = `
        <div class="space-container" style="max-width: 640px; margin: 0 auto; padding: 12px;">
            <div id="space-streak-slot">${renderSpaceStreakBanner()}</div>

            <div class="space-search-bar">
                <i class="fas fa-magnifying-glass"></i>
                <input type="text" id="space-search-input" placeholder="Search Space...">
            </div>
            <div class="space-filter-pills" id="space-filter-pills">
                <button class="space-filter-pill active" data-type="all">All</button>
                <button class="space-filter-pill" data-type="text">Reflections</button>
                <button class="space-filter-pill" data-type="note">Notes</button>
                <button class="space-filter-pill" data-type="plan">Study Plans</button>
                <button class="space-filter-pill" data-type="video">Videos</button>
            </div>

            <div id="space-feed" class="space-feed">
                <div class="skeleton" style="height: 220px; border-radius: 16px; margin-bottom: 14px;"></div>
                <div class="skeleton" style="height: 220px; border-radius: 16px;"></div>
            </div>
        </div>
    `;

    $('#space-search-input').addEventListener('input', (e) => {
        AppState.spaceSearchQuery = e.target.value;
        applySpaceFilters();
    });

    $$('#space-filter-pills .space-filter-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            $$('#space-filter-pills .space-filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            AppState.spaceFilterType = pill.dataset.type;
            applySpaceFilters();
        });
    });

    // loadSpaceStreak() and loadSpacePosts() hit independent DB paths —
    // running them in parallel instead of one-after-another was adding a
    // full extra network round trip to every Space page load.
    const streakPromise = loadSpaceStreak().catch((error) => {
        console.error('Error loading space streak:', error);
    });
    const postsPromise = loadSpacePosts();

    await streakPromise;
    if (AppState.currentRoute !== 'space') return;
    const streakSlot = $('#space-streak-slot');
    if (streakSlot) streakSlot.innerHTML = renderSpaceStreakBanner();

    await postsPromise;
}

/** Text used to match a post against the Space search bar. */
function getSpacePostSearchableText(post) {
    return [
        post.content, post.text, post.caption, post.title, post.reference,
        post.sourceBook, (post.slides || []).map(s => s.text || s.content).join(' '),
        (post.tags || []).join(' ')
    ].filter(Boolean).join(' ').toLowerCase();
}

/** Re-renders #space-feed from the already-fetched AppState.spacePosts,
    applying the current type filter + search query — no network round
    trip, so filtering/searching feels instant. */
function applySpaceFilters() {
    const container = $('#space-feed');
    if (!container) return;

    const type = AppState.spaceFilterType || 'all';
    const query = (AppState.spaceSearchQuery || '').trim().toLowerCase();

    let list = AppState.spacePosts || [];
    if (type !== 'all') list = list.filter(p => (p.type || 'text') === type);
    if (query) list = list.filter(p => getSpacePostSearchableText(p).includes(query));

    if (list.length === 0) {
        container.innerHTML = `
            <div class="text-center" style="padding: 60px 20px;">
                <i class="fas fa-magnifying-glass" style="font-size: 36px; opacity: 0.3; margin-bottom: 12px;"></i>
                <p class="text-muted">No posts match${query ? ` "${escapeHtml(AppState.spaceSearchQuery.trim())}"` : ''}${type !== 'all' ? ' in this category' : ''}.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(post => {
        try {
            return renderSpaceCard(post);
        } catch (cardError) {
            console.error('Skipping a Space post that failed to render:', post?.id, cardError);
            return '';
        }
    }).join('');
}

async function loadSpacePosts() {
    const container = $('#space-feed');
    if (!container) return;

    let posts;
    try {
        // Primary path: ordered + limited query (needs a `timestamp` index —
        // see database.rules.json; without it this silently falls back to
        // the much slower full-table read below on every single load).
        const snapshot = await database.ref('spacePosts').orderByChild('timestamp').limitToLast(60).once('value');
        posts = Object.values(snapshot.val() || {});
    } catch (error) {
        console.error('Ordered Space query failed, falling back to a plain read:', error);
        try {
            // Fallback: some Firebase projects reject an unindexed orderByChild
            // query for authenticated reads even though the same query is
            // permitted for anonymous ones. A plain read has no such
            // constraint — just sort/trim on the client instead.
            const snapshot = await database.ref('spacePosts').once('value');
            const all = Object.values(snapshot.val() || {});
            posts = all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 60);
        } catch (fallbackError) {
            console.error('Error loading Space posts:', fallbackError);
            container.innerHTML = `
                <div class="text-center" style="padding: 40px 20px;">
                    <p class="text-muted" style="margin-bottom:12px;">Couldn't load Space right now.</p>
                    <button class="btn btn-outline btn-sm" onclick="loadSpacePosts()"><i class="fas fa-rotate-right"></i> Retry</button>
                </div>
            `;
            return;
        }
    }

    try {
        if (AppState.currentRoute !== 'space') return; // navigated away while this was loading

        if (posts.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="padding: 60px 20px;">
                    <i class="fas fa-compass" style="font-size: 44px; opacity: 0.3; margin-bottom: 16px;"></i>
                    <h3 style="margin-bottom: 8px;">Space is quiet right now</h3>
                    <p class="text-muted" style="margin-bottom:16px;">Be the first to share a verse, note, or reflection.</p>
                    <button class="btn btn-primary" onclick="showCreateSpacePostModal()"><i class="fas fa-plus"></i> Create a Post</button>
                </div>
            `;
            return;
        }

        // Personalized ranking: score every post against the user's interest
        // profile, but always keep the handful of newest posts near the top
        // too, so Space never feels stale or like a total echo chamber.
        const scored = posts.map(post => ({
            post,
            score: scoreForInterest(post.tags, post.sourceBook, post.timestamp, Object.keys(post.amens || {}).length + Object.keys(post.comments || {}).length)
        })).sort((a, b) => b.score - a.score);

        const newest = [...posts].sort((a, b) => b.timestamp - a.timestamp).slice(0, 3).map(p => p.id);
        const ranked = [...scored.map(s => s.post)];
        // Ensure the 3 newest posts appear within the first 6 cards even if
        // their personalization score is low (freshness guarantee).
        newest.forEach(id => {
            const idx = ranked.findIndex(p => p.id === id);
            if (idx > 5) {
                const [item] = ranked.splice(idx, 1);
                ranked.splice(Math.min(2, ranked.length), 0, item);
            }
        });

        AppState.spacePosts = ranked;
        applySpaceFilters();
        initSpaceCarouselObservers();
    } catch (error) {
        console.error('Error rendering Space posts:', error);
        container.innerHTML = `
            <div class="text-center" style="padding: 40px 20px;">
                <p class="text-muted" style="margin-bottom:12px;">Couldn't load Space right now.</p>
                <button class="btn btn-outline btn-sm" onclick="loadSpacePosts()"><i class="fas fa-rotate-right"></i> Retry</button>
            </div>
        `;
    }
}

function renderSpaceSlides(post) {
    const slides = post.slides && post.slides.length > 0 ? post.slides : [{ kind: 'text', text: '' }];

    return `
        <div class="space-carousel" id="carousel-${post.id}">
            <div class="space-carousel-track">
                ${slides.map(slide => `
                    <div class="space-slide">
                        ${slide.kind === 'verse' ? `
                            <i class="fas fa-book-bible space-slide-icon"></i>
                            <p class="space-slide-text">"${escapeHtml(slide.text || '')}"</p>
                            <p class="space-slide-ref">${escapeHtml(slide.book || '')} ${slide.chapter || ''}:${slide.verse || ''} • ${escapeHtml(slide.version || AppState.bibleVersion || 'KJV')}</p>
                        ` : `
                            ${slide.label ? `<div class="space-slide-label">${escapeHtml(slide.label)}</div>` : ''}
                            <p class="space-slide-text">${escapeHtml(slide.text || '')}</p>
                        `}
                    </div>
                `).join('')}
            </div>
        </div>
        ${slides.length > 1 ? `
            <div class="space-carousel-dots" id="dots-${post.id}">
                ${slides.map((_, i) => `<span class="space-dot ${i === 0 ? 'active' : ''}" onclick="scrollSpaceCarousel('${post.id}', ${i})"></span>`).join('')}
            </div>
        ` : ''}
    `;
}

function renderSpaceCard(post) {
    const uid = AppState.currentUser?.uid;
    const isAmen = uid && post.amens && post.amens[uid];
    const isSaved = uid && post.saves && post.saves[uid];
    const amenCount = post.amens ? Object.keys(post.amens).length : 0;
    const commentCount = post.comments ? Object.keys(post.comments).length : 0;
    const authorName = escapeHtml(post.authorName || 'Anonymous');
    const safeName = authorName.replace(/'/g, "\\'");

    const typeIcon = {
        verses: 'fa-book-bible',
        note: 'fa-sticky-note',
        plan: 'fa-calendar-check',
        shepherd: 'fa-dove',
        video: 'fa-video',
        text: 'fa-quote-left'
    }[post.type] || 'fa-quote-left';

    let mediaHTML;
    if (post.type === 'video' && post.videoUrl) {
        mediaHTML = `<div class="space-video-wrap">${renderEmbed(post.videoUrl)}</div>`;
    } else {
        mediaHTML = renderSpaceSlides(post);
    }

    const readChapterBtn = post.sourceBook ? `
        <button class="space-chapter-btn" onclick="openBibleChapter('${post.sourceBook.replace(/'/g, "\\'")}', ${post.sourceChapter})">
            <i class="fas fa-book-bible"></i> Read Full Chapter
        </button>
    ` : (post.type === 'plan' ? (
        post.authorId === uid ? `
        <button class="space-chapter-btn" onclick="navigateTo('planner')">
            <i class="fas fa-calendar-check"></i> View Study Plan
        </button>
    ` : (post.planData?.days?.length > 0 ? `
        <button class="space-chapter-btn" onclick="addSpacePlanToMyPlanner('${post.id}')">
            <i class="fas fa-plus"></i> Add to My Study Plan
        </button>
    ` : '')
    ) : '');

    return `
        <div class="space-card" id="space-${post.id}">
            <div class="space-card-header" onclick="viewUserProfile('${post.authorId}', '${safeName}')">
                <div class="post-avatar space-author-avatar">${authorName[0]?.toUpperCase() || 'U'}</div>
                <div style="flex:1;">
                    <div class="space-author-name">${authorName}</div>
                    <div class="space-author-time">${formatDate(post.timestamp)}</div>
                </div>
                <i class="fas ${typeIcon}" style="color: var(--text-slate); opacity:0.6;"></i>
            </div>

            ${mediaHTML}
            ${readChapterBtn}

            <div class="space-actions">
                <button class="space-action-btn ${isAmen ? 'active' : ''}" onclick="toggleSpaceAmen('${post.id}')" aria-label="Amen">
                    <i class="fas fa-hands-praying"></i> <span>Amen${amenCount > 0 ? ` · ${amenCount}` : ''}</span>
                </button>
                <button class="space-action-btn" onclick="showSpacePostComments('${post.id}')" aria-label="Comments">
                    <i class="fas fa-comment"></i> <span>${commentCount > 0 ? commentCount : 'Comment'}</span>
                </button>
                <button class="space-action-btn ${isSaved ? 'active' : ''}" onclick="toggleSpaceSave('${post.id}')" aria-label="Save">
                    <i class="fas ${isSaved ? 'fa-bookmark' : 'fa-bookmark'}"></i> <span>${isSaved ? 'Saved' : 'Save'}</span>
                </button>
                <button class="space-action-btn" onclick="shareSpacePost('${post.id}')" aria-label="Share">
                    <i class="fas fa-share"></i>
                </button>
                ${post.authorId === uid ? `
                    <button class="space-action-btn" onclick="deleteSpacePost('${post.id}')" aria-label="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function scrollSpaceCarousel(postId, index) {
    const track = document.querySelector(`#carousel-${postId} .space-carousel-track`);
    const dotsWrap = document.getElementById(`dots-${postId}`);
    if (!track) return;

    const slideWidth = track.querySelector('.space-slide')?.offsetWidth || track.offsetWidth;
    track.scrollTo({ left: slideWidth * index, behavior: 'smooth' });

    if (dotsWrap) {
        $$('.space-dot', dotsWrap).forEach((dot, i) => dot.classList.toggle('active', i === index));
    }
}

function initSpaceCarouselObservers() {
    $$('.space-carousel-track').forEach(track => {
        track.addEventListener('scroll', () => {
            clearTimeout(track._scrollTimer);
            track._scrollTimer = setTimeout(() => {
                const slideWidth = track.querySelector('.space-slide')?.offsetWidth || 1;
                const index = Math.round(track.scrollLeft / slideWidth);
                const carousel = track.closest('.space-carousel');
                const dotsWrap = document.getElementById(`dots-${carousel.id.replace('carousel-', '')}`);
                if (dotsWrap) {
                    $$('.space-dot', dotsWrap).forEach((dot, i) => dot.classList.toggle('active', i === index));
                }
            }, 100);
        }, { passive: true });
    });
}

function updateSpaceCardDOM(postId) {
    const post = AppState.spacePosts.find(p => p.id === postId);
    const el = document.getElementById(`space-${postId}`);
    if (post && el) {
        el.outerHTML = renderSpaceCard(post);
        initSpaceCarouselObservers();
    }
}

/* ---- Creating a post ---- */
function showCreateSpacePostModal(prefill) {
    prefill = prefill || {};

    if (prefill.verses) {
        submitCreateSpacePost({
            type: 'verses',
            slides: prefill.verses.map(v => ({ kind: 'verse', book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, version: v.version })),
            sourceBook: prefill.sourceBook,
            sourceChapter: prefill.sourceChapter,
            tags: extractTags(prefill.verses.map(v => v.text).join(' '))
        });
        return;
    }

    const modalContent = `
        <h3 style="margin-bottom: 4px;">Post to Space</h3>
        <p class="text-muted" style="font-size:12px; margin-bottom:14px;">Share something devotional with the community — and keep your streak going.</p>
        <div style="display:grid; gap:8px; margin-bottom: 14px;" id="space-post-type-picker">
            <button class="btn btn-outline btn-block" onclick="showSpacePostComposer('text')"><i class="fas fa-quote-left"></i> Testimony / Thought</button>
            <button class="btn btn-outline btn-block" onclick="showSpacePostComposer('note')"><i class="fas fa-sticky-note"></i> Share a Note</button>
            <button class="btn btn-outline btn-block" onclick="showSpacePostComposer('plan')"><i class="fas fa-calendar-check"></i> Share a Study Plan</button>
            <button class="btn btn-outline btn-block" onclick="showSpacePostComposer('video')"><i class="fas fa-video"></i> Video Link</button>
        </div>
        <div id="space-post-composer"></div>
    `;
    showModal(modalContent);
}

const SPACE_POST_TYPE_LABELS = {
    text: 'Testimony / Thought',
    note: 'Share a Note',
    plan: 'Share a Study Plan',
    video: 'Video Link'
};

/**
 * Shows the composer for a chosen post type as its own standalone view —
 * the type picker is hidden while composing so the textbox/list has the
 * full modal to itself, with a Back link to return to the picker.
 */
function showSpacePostComposer(kind) {
    const picker = $('#space-post-type-picker');
    const slot = $('#space-post-composer');
    if (!slot) return;

    if (picker) picker.style.display = 'none';

    const backBtn = `
        <button class="btn btn-sm" style="background:none; border:none; padding:0; margin-bottom:14px; color:var(--text-slate); display:inline-flex; align-items:center; gap:6px; cursor:pointer;" onclick="backToSpacePostTypePicker()">
            <i class="fas fa-arrow-left"></i> Back
        </button>
    `;
    const heading = `<h4 style="margin-bottom:12px;">${SPACE_POST_TYPE_LABELS[kind] || ''}</h4>`;

    if (kind === 'text') {
        slot.innerHTML = `
            ${backBtn}
            ${heading}
            <div class="form-group">
                <textarea id="space-text-input" class="form-textarea" rows="7" placeholder="Share a testimony, thought, or encouragement..."></textarea>
            </div>
            <button class="btn btn-primary btn-block" onclick="submitTextSpacePost()">Post</button>
        `;
        setTimeout(() => $('#space-text-input')?.focus(), 50);
    } else if (kind === 'video') {
        slot.innerHTML = `
            ${backBtn}
            ${heading}
            <div class="form-group">
                <input type="url" id="space-video-input" class="form-input" placeholder="https://youtube.com/... or https://x.com/...">
            </div>
            <button class="btn btn-primary btn-block" onclick="submitVideoSpacePost()">Post</button>
        `;
        setTimeout(() => $('#space-video-input')?.focus(), 50);
    } else if (kind === 'note') {
        if (AppState.notes.length === 0) {
            slot.innerHTML = `${backBtn}${heading}<p class="text-muted text-center">You have no notes yet — add one from the Bible reader.</p>`;
            return;
        }
        slot.innerHTML = `
            ${backBtn}
            ${heading}
            <div style="display:grid; gap:8px; max-height:50vh; overflow-y:auto;">
                ${AppState.notes.map((note, i) => `
                    <button class="btn btn-outline btn-block" style="text-align:left;" onclick="submitNoteSpacePost(${i})">
                        <div style="font-weight:600;">${escapeHtml(note.reference || 'Note')}</div>
                        <div style="font-size:12px; color:var(--text-slate); white-space:normal;">${escapeHtml((note.text || '').slice(0, 70))}${(note.text || '').length > 70 ? '…' : ''}</div>
                    </button>
                `).join('')}
            </div>
        `;
    } else if (kind === 'plan') {
        if (AppState.plannerData.length === 0) {
            slot.innerHTML = `${backBtn}${heading}<p class="text-muted text-center">You have no study plans yet.</p>`;
            return;
        }
        slot.innerHTML = `
            ${backBtn}
            ${heading}
            <div style="display:grid; gap:8px; max-height:50vh; overflow-y:auto;">
                ${AppState.plannerData.map((plan, i) => `
                    <button class="btn btn-outline btn-block" onclick="submitPlanSpacePost(${i})">${escapeHtml(plan.name || plan.title || plan.planType || 'Study Plan')}</button>
                `).join('')}
            </div>
        `;
    }
}

function backToSpacePostTypePicker() {
    const picker = $('#space-post-type-picker');
    const slot = $('#space-post-composer');
    if (picker) picker.style.display = '';
    if (slot) slot.innerHTML = '';
}

async function submitCreateSpacePost(fields) {
    if (!requireAuth('Sign in to post.')) return;

    const post = buildSpacePostObject(fields);

    try {
        await database.ref(`spacePosts/${post.id}`).set(post);

        // Personalization + streak — creating content is a strong signal.
        (post.tags || []).forEach(tag => recordInterestSignal('tag', tag, 2.5));
        if (post.sourceBook) recordInterestSignal('book', post.sourceBook, 2);
        await bumpSpaceStreak();

        closeModal();
        showToast('Posted to Space!', 'success');
        navigateTo('space');
    } catch (error) {
        showToast('Failed to post', 'error');
        console.error(error);
    }
}

async function submitTextSpacePost() {
    const text = $('#space-text-input')?.value.trim();
    if (!text) { showToast('Please write something first', 'warning'); return; }

    const moderationResult = await moderateContent(text);
    if (moderationResult.flagged && moderationResult.action === 'hide') {
        showToast('Your post was flagged by moderation', 'error');
        return;
    }

    submitCreateSpacePost({ type: 'text', slides: splitTextIntoSlides(text, ''), tags: extractTags(text) });
}

function submitVideoSpacePost() {
    const url = $('#space-video-input')?.value.trim();
    if (!url) { showToast('Please paste a video link', 'warning'); return; }
    submitCreateSpacePost({ type: 'video', videoUrl: url, slides: [] });
}

function submitNoteSpacePost(index) {
    const note = AppState.notes[index];
    if (!note) return;
    submitCreateSpacePost({
        type: 'note',
        slides: [{ kind: 'text', label: note.reference || 'Note', text: note.text || '' }],
        sourceBook: note.book,
        sourceChapter: note.chapter,
        tags: extractTags(note.text)
    });
}

function submitPlanSpacePost(index) {
    const plan = AppState.plannerData[index];
    if (!plan) return;
    const name = plan.name || plan.title || plan.planType || 'Study Plan';
    submitCreateSpacePost({
        type: 'plan',
        slides: [{ kind: 'text', label: 'Study Plan', text: name }],
        planName: name,
        // Full day-by-day content so other users can add this plan to
        // their own Study Planner straight from Space, not just view the name.
        planData: {
            name,
            days: (plan.days || []).map(d => ({ passage: d.passage, topic: d.topic, date: d.date }))
        },
        tags: extractTags(name)
    });
}

/**
 * Lets any signed-in user copy a study plan they see on Space into their
 * own Study Planner. Resets completion/progress so it starts fresh for them.
 */
async function addSpacePlanToMyPlanner(postId) {
    if (!requireAuth('Sign in to add this study plan.', () => addSpacePlanToMyPlanner(postId))) return;

    const post = AppState.spacePosts.find(p => p.id === postId) || AppState.spacePosts.find(p => p.id === postId);
    const planData = post?.planData;
    if (!planData || !Array.isArray(planData.days) || planData.days.length === 0) {
        showToast("This study plan doesn't have day-by-day content to copy.", 'warning');
        return;
    }

    const newPlan = {
        id: generateId(),
        name: planData.name || 'Study Plan',
        days: planData.days.map(d => ({ ...d, completed: false })),
        progress: 0,
        streak: 0,
        completed: 0,
        total: planData.days.length,
        createdAt: Date.now()
    };

    AppState.plannerData.push(newPlan);
    AppState.currentPlan = newPlan;

    try {
        const uid = AppState.currentUser.uid;
        await database.ref(`users/${uid}/planner`).set(AppState.plannerData);
        showToast('Added to your Study Planner!', 'success');
        navigateTo('planner');
    } catch (error) {
        showToast('Failed to add study plan', 'error');
        console.error(error);
    }
}

/* ---- Reactions, comments, delete, share ---- */
async function toggleSpaceAmen(postId) {
    if (!requireAuth('Sign in to react.')) return;

    const uid = AppState.currentUser.uid;
    const ref = database.ref(`spacePosts/${postId}/amens/${uid}`);
    const post = AppState.spacePosts.find(p => p.id === postId);

    try {
        const snapshot = await ref.once('value');
        if (snapshot.exists()) {
            await ref.remove();
            if (post?.amens) delete post.amens[uid];
        } else {
            await ref.set(true);
            if (post) { post.amens = post.amens || {}; post.amens[uid] = true; }
            (post?.tags || []).forEach(tag => recordInterestSignal('tag', tag, 1));
            if (post?.sourceBook) recordInterestSignal('book', post.sourceBook, 1);

            // Let the post's author know — but not when they Amen their own post.
            if (post && post.authorId && post.authorId !== uid && typeof addNotification === 'function') {
                const myName = AppState.userProfile?.username || 'Anonymous';
                addNotification(post.authorId, {
                    type: 'space_amen',
                    fromUid: uid,
                    fromName: myName,
                    postId,
                    message: `${myName} said Amen to your Space post`
                });
            }
        }
        updateSpaceCardDOM(postId);
    } catch (error) {
        showToast('Failed to update', 'error');
    }
}

async function toggleSpaceSave(postId) {
    if (!requireAuth('Sign in to save posts.')) return;

    const uid = AppState.currentUser.uid;
    const ref = database.ref(`spacePosts/${postId}/saves/${uid}`);
    const post = AppState.spacePosts.find(p => p.id === postId);

    try {
        const snapshot = await ref.once('value');
        if (snapshot.exists()) {
            await ref.remove();
            if (post?.saves) delete post.saves[uid];
        } else {
            await ref.set(true);
            if (post) { post.saves = post.saves || {}; post.saves[uid] = true; }
            (post?.tags || []).forEach(tag => recordInterestSignal('tag', tag, 2));
            showToast('Saved to your Space bookmarks', 'success');
        }
        updateSpaceCardDOM(postId);
    } catch (error) {
        showToast('Failed to save', 'error');
    }
}

function showSpacePostComments(postId) {
    const post = AppState.spacePosts.find(p => p.id === postId);
    if (!post) return;

    const renderList = (comments) => {
        const list = Object.entries(comments || {}).map(([id, c]) => ({ id, ...c })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (list.length === 0) return `<p class="text-center text-muted" style="padding: 20px 0;">No comments yet. Be the first to respond.</p>`;
        return list.map(c => `
            <div class="comment-item">
                <div class="post-avatar comment-avatar" style="cursor:pointer;" onclick="viewUserProfile('${c.authorId}', '${(c.authorName || 'User').replace(/'/g, "\\'")}')">${(c.authorName || 'U')[0].toUpperCase()}</div>
                <div class="comment-body">
                    <div class="comment-meta">
                        <span class="comment-author" style="cursor:pointer;" onclick="viewUserProfile('${c.authorId}', '${(c.authorName || 'User').replace(/'/g, "\\'")}')">${escapeHtml(c.authorName || 'Anonymous')}</span>
                        <span class="comment-time">${formatDate(c.timestamp)}</span>
                    </div>
                    <p>${escapeHtml(c.content || '')}</p>
                </div>
            </div>
        `).join('');
    };

    showSheet(`
        <h3 style="margin-bottom: 12px;">Comments</h3>
        <div id="comments-list" style="max-height: 40vh; overflow-y: auto; margin-bottom: 12px;">${renderList(post.comments)}</div>
        <div class="comment-input-row">
            <input type="text" id="new-comment-input" class="form-input" placeholder="Write a comment..." onkeypress="if(event.key === 'Enter') submitSpacePostComment('${postId}')">
            <button class="btn btn-primary btn-sm" onclick="submitSpacePostComment('${postId}')"><i class="fas fa-paper-plane"></i></button>
        </div>
    `);
    setTimeout(() => $('#new-comment-input')?.focus(), 200);
}

async function submitSpacePostComment(postId) {
    if (!requireAuth('Sign in to comment.')) return;

    const input = $('#new-comment-input');
    const content = input?.value.trim();
    if (!content) return;
    input.value = '';

    const comment = { authorId: AppState.currentUser.uid, authorName: AppState.userProfile?.username || 'Anonymous', content, timestamp: Date.now() };

    try {
        const commentId = generateId();
        await database.ref(`spacePosts/${postId}/comments/${commentId}`).set(comment);

        const post = AppState.spacePosts.find(p => p.id === postId);
        if (post) { post.comments = post.comments || {}; post.comments[commentId] = comment; }

        extractTags(content).forEach(tag => recordInterestSignal('tag', tag, 1.5));

        // Let the post's author know — but not when they comment on their own post.
        if (post && post.authorId && post.authorId !== AppState.currentUser.uid && typeof addNotification === 'function') {
            addNotification(post.authorId, {
                type: 'space_comment',
                fromUid: AppState.currentUser.uid,
                fromName: comment.authorName,
                postId,
                message: `${comment.authorName} commented on your Space post`
            });
        }

        showSpacePostComments(postId);
        updateSpaceCardDOM(postId);
    } catch (error) {
        showToast('Failed to post comment', 'error');
    }
}

function deleteSpacePost(postId) {
    showModal(`
        <h3 style="margin-bottom: 16px;">Delete Post</h3>
        <p>Are you sure you want to delete this Space post?</p>
        <div style="display:flex; gap:8px; margin-top:16px;">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-accent" onclick="confirmDeleteSpacePost('${postId}')">Delete</button>
        </div>
    `);
}

async function confirmDeleteSpacePost(postId) {
    try {
        await database.ref(`spacePosts/${postId}`).remove();
        closeModal();
        showToast('Post deleted', 'success');
        AppState.spacePosts = AppState.spacePosts.filter(p => p.id !== postId);
        document.getElementById(`space-${postId}`)?.remove();
    } catch (error) {
        showToast('Failed to delete', 'error');
    }
}

async function shareSpacePost(postId) {
    const post = AppState.spacePosts.find(p => p.id === postId);
    if (!post) return;

    let shareText = `${post.authorName}: `;
    if (post.type === 'video') {
        shareText += post.videoUrl;
    } else {
        shareText += (post.slides || []).map(s => s.text).join(' ');
    }

    if (navigator.share) {
        navigator.share({ title: 'GraceGuide Space', text: shareText }).catch(() => {});
    } else {
        navigator.clipboard.writeText(shareText).then(() => showToast('Copied to clipboard!', 'success'));
    }

    if (AppState.currentUser) {
        try {
            const snapshot = await database.ref(`users/${AppState.currentUser.uid}/groups`).once('value');
            const groupIds = Object.keys(snapshot.val() || {});
            if (groupIds.length > 0) showShareReelToGroupSheet(postId, groupIds);
        } catch (error) { /* sharing to a group is a bonus, not required */ }
    }
}

function showShareReelToGroupSheet(postId, groupIds) {
    const groupsSnippet = groupIds.map(id => `
        <button class="btn btn-outline btn-block" data-group-id="${id}" onclick="submitShareReelToGroup('${postId}', '${id}')">
            <i class="fas fa-users"></i> Share to group
        </button>
    `).join('');

    showSheet(`
        <h3 style="margin-bottom: 12px;">Also share to a group?</h3>
        <div style="display: grid; gap: 8px;">${groupsSnippet}</div>
    `);

    groupIds.forEach(async (id) => {
        try {
            const snap = await database.ref(`communityGroups/${id}/name`).once('value');
            const name = snap.val();
            const btn = document.querySelector(`[data-group-id="${id}"]`);
            if (btn && name) btn.innerHTML = `<i class="fas fa-users"></i> ${escapeHtml(name)}`;
        } catch (e) { /* ignore */ }
    });
}

async function submitShareReelToGroup(postId, groupId) {
    if (!AppState.currentUser) return;

    const msg = { senderId: AppState.currentUser.uid, senderName: AppState.userProfile?.username || 'Anonymous', type: 'reel', content: postId, timestamp: Date.now() };
    try {
        await database.ref(`communityGroups/${groupId}/messages/${generateId()}`).set(msg);
        closeSheet();
        showToast('Shared to group!', 'success');
    } catch (error) {
        showToast('Failed to share', 'error');
    }
}

function renderEmbed(url) {
    if (url && (url.includes('youtube.com') || url.includes('youtu.be'))) {
        const videoId = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
        if (videoId) {
            return `
                <div class="space-yt-wrap">
                    <img class="space-yt-thumb" src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="" loading="lazy" onclick="this.parentElement.innerHTML='<iframe src=\\'https://www.youtube.com/embed/${videoId}?autoplay=1\\' allow=\\'autoplay; encrypted-media; picture-in-picture\\' allowfullscreen class=\\'space-yt-iframe\\'></iframe>'">
                    <div class="space-yt-play"><i class="fas fa-play"></i></div>
                </div>
            `;
        }
    }
    if (url && (url.includes('twitter.com') || url.includes('x.com'))) {
        return `<div class="space-tweet-wrap"><blockquote class="twitter-tweet" data-dnt="true"><a href="${url}"></a></blockquote></div>`;
    }
    return `<div class="space-link-card"><i class="fas fa-link" style="font-size: 28px;"></i><a href="${url}" target="_blank">View Link</a></div>`;
}

async function moderateContent(content) {
    const bannedWords = ['spam', 'scam', 'hack', 'illegal', 'explicit'];
    const flagged = bannedWords.some(word => content.toLowerCase().includes(word));
    return flagged ? { flagged: true, action: 'hide' } : { flagged: false, action: 'approve' };
}
