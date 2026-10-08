/* ============================================
   GraceGuide — js/community.js
   Load AFTER config.js, core.js, and features.js.
   Contains: Space, Forum Groups, public profile
   view/connect/report/block, Direct Messages,
   Profile page, Settings, notifications, event
   listeners, and app initialization/bootstrap.
   ============================================ */

/* ============================================
   COMMUNITY (Groups)
   ============================================ */
/** Community = Forums (groups) + Users (find other GraceGuide members). */
async function renderCommunityPage() {
    const tab = AppState.communityTab === 'users' ? 'users' : 'forums';
    DOM.pageContainer.innerHTML = `
        <div class="community-container">
            <div class="flex items-center justify-between mb-4">
                <h2 style="font-weight: 700;">Community</h2>
                ${tab === 'forums' ? `
                    <button class="btn btn-primary btn-sm" onclick="showCreateGroupModal()">
                        <i class="fas fa-plus"></i> New Group
                    </button>` : ''}
            </div>

            <div class="community-tabs" role="tablist">
                <button class="community-tab ${tab === 'forums' ? 'active' : ''}" role="tab" aria-selected="${tab === 'forums'}" onclick="switchCommunityTab('forums')"><i class="fas fa-comments"></i> Forums</button>
                <button class="community-tab ${tab === 'users' ? 'active' : ''}" role="tab" aria-selected="${tab === 'users'}" onclick="switchCommunityTab('users')"><i class="fas fa-user-group"></i> Users</button>
            </div>

            ${tab === 'forums' ? `
                <div id="groups-list">
                    <div class="skeleton" style="height: 80px; margin-bottom: 12px;"></div>
                    <div class="skeleton" style="height: 80px; margin-bottom: 12px;"></div>
                </div>
            ` : `
                <div class="community-users-tools">
                    <input type="search" id="community-user-search" class="form-input" placeholder="Search by name or email" autocomplete="off" value="${escapeHtml(CommunityUsers.query)}">
                    <div class="community-users-row">
                        <div class="community-chips" id="community-user-filters">
                            ${[['all', 'All'], ['brethren', 'Brethren'], ['new', 'Not connected'], ['active', 'Active this week']].map(([key, label]) =>
                                `<button class="community-chip ${CommunityUsers.filter === key ? 'active' : ''}" onclick="setCommunityUserFilter('${key}')">${label}</button>`).join('')}
                        </div>
                        <select id="community-user-sort" class="form-input community-sort" aria-label="Sort people" onchange="setCommunityUserSort(this.value)">
                            ${[['name', 'Name A–Z'], ['newest', 'Newest members'], ['active', 'Recently active']].map(([key, label]) =>
                                `<option value="${key}" ${CommunityUsers.sort === key ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div id="community-users-list">
                    <div class="skeleton" style="height: 64px; margin-bottom: 8px;"></div>
                    <div class="skeleton" style="height: 64px; margin-bottom: 8px;"></div>
                    <div class="skeleton" style="height: 64px; margin-bottom: 8px;"></div>
                </div>
            `}
        </div>
    `;

    if (tab === 'forums') { await loadCommunityGroups(); return; }

    const search = document.getElementById('community-user-search');
    search.addEventListener('input', () => { CommunityUsers.query = search.value; CommunityUsers.shown = 40; refreshCommunityUserSearch(); });
    await loadCommunityUsers();
    refreshCommunityUserSearch();
}

function switchCommunityTab(tab) {
    AppState.communityTab = tab;
    AppState.scrollPositions.community = 0;
    renderCommunityPage();
}

/* ---- Users tab ----
   People are listed from publicProfiles/{uid} — a small public card (name,
   photo, when they joined, when they were last active) each account keeps up
   to date itself. It never contains an email address; the admin-only
   userDirectory does, which is why that is not what is listed here. */
const CommunityUsers = { all: null, loadedAt: 0, query: '', queryHash: '', filter: 'all', sort: 'name', shown: 40 };

/** SHA-256 of a trimmed, lower-cased email, as hex ('' if it cannot be worked out here). */
async function emailSearchHash(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean || !window.crypto || !crypto.subtle || typeof TextEncoder === 'undefined') return '';
    try {
        const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean)));
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (error) { return ''; }
}

/** Redraws the list for what is typed. A full email address is matched by its hash — emails themselves are never listed. */
async function refreshCommunityUserSearch() {
    const typed = CommunityUsers.query;
    const looksLikeEmail = /^\S+@\S+\.\S+$/.test(typed.trim());
    CommunityUsers.queryHash = '';
    if (looksLikeEmail) {
        const hash = await emailSearchHash(typed);
        if (CommunityUsers.query !== typed) return; // they kept typing
        CommunityUsers.queryHash = hash;
    }
    renderCommunityUsersList();
}

/**
 * Everyone who can be listed: the public cards first, then members who have no card yet but
 * are already visible elsewhere in the app (my Brethren, Space authors, the quiz and games
 * rankings). Each source is optional — one failing never empties the list.
 */
async function gatherCommunityPeople() {
    const people = new Map();
    const add = (uid, username, extra) => {
        const name = typeof username === 'string' ? username.trim() : '';
        if (!uid || !name || people.has(uid)) return;
        people.set(uid, Object.assign({ uid, username: name, avatar: '', bio: '', createdAt: 0, lastActiveAt: 0, eh: '' }, extra || {}));
    };
    const read = (query) => query.once('value').then(snap => snap.val() || {}).catch(() => null);

    const [cards, quiz, games] = await Promise.all([
        read(database.ref('publicProfiles')),
        read(database.ref('quizLeaderboardAllTime')),
        read(database.ref('games/profiles').orderByChild('xp').limitToLast(200))
    ]);
    Object.entries(cards || {}).forEach(([uid, p]) => {
        if (p) add(uid, p.username, { avatar: p.avatar || '', bio: p.bio || '', createdAt: p.createdAt || 0, lastActiveAt: p.lastActiveAt || 0, eh: typeof p.eh === 'string' ? p.eh : '' });
    });
    Object.entries(quiz || {}).forEach(([uid, row]) => { if (row) add(uid, row.username || row.name); });
    Object.entries(games || {}).forEach(([uid, row]) => { if (row) add(uid, row.name); });
    (AppState.spacePosts || []).forEach(post => add(post.authorId, getDisplayName(post.authorId, post.authorName || '')));

    // People I am connected with are always findable, even with no public card.
    const known = AppState.userConnections ? Array.from(AppState.userConnections.keys()).filter(uid => !people.has(uid)) : [];
    await Promise.all(known.slice(0, 200).map(uid => fetchUserProfileName(uid).then(name => add(uid, name, { avatar: UserNameCache.avatars.get(uid) || '' }))));

    return { list: Array.from(people.values()), cards };
}

function setCommunityUserFilter(key) {
    CommunityUsers.filter = key; CommunityUsers.shown = 40;
    document.querySelectorAll('#community-user-filters .community-chip').forEach((chip, i) => chip.classList.toggle('active', ['all', 'brethren', 'new', 'active'][i] === key));
    renderCommunityUsersList();
}
function setCommunityUserSort(key) { CommunityUsers.sort = key; renderCommunityUsersList(); }
function showMoreCommunityUsers() { CommunityUsers.shown += 40; renderCommunityUsersList(); }

async function loadCommunityUsers() {
    const list = document.getElementById('community-users-list');
    if (!list) return;
    if (!AppState.currentUser) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-user-group"></i></div>
                <h3 style="margin-bottom: 8px;">Find people on GraceGuide</h3>
                <p style="color: var(--text-slate); margin-bottom: 16px;">Sign in to search for other members and connect as Brethren.</p>
                <button class="btn btn-primary" onclick="showAuthModal({ message: 'Sign in to find people on GraceGuide.' })">Sign in</button>
            </div>`;
        return;
    }
    try {
        if (!CommunityUsers.all || Date.now() - CommunityUsers.loadedAt > 60000) {
            const found = await gatherCommunityPeople();
            if (found.list.length === 0 && found.cards === null) throw new Error('No source of people could be read');
            CommunityUsers.all = found.list;
            CommunityUsers.loadedAt = Date.now();
            backfillPublicProfilesIfAdmin(found.cards || {});
        }
        renderCommunityUsersList();
    } catch (error) {
        console.error('Error loading people:', error);
        if (document.getElementById('community-users-list')) {
            list.innerHTML = `<div class="error-state"><h3>Couldn't load people</h3><p style="color: var(--text-slate);">Please check your connection and try again.</p></div>`;
        }
    }
}

/** Members who haven't opened the app since the Users tab was added have no
    public card yet. When an admin opens this tab, the missing cards are filled
    in from the admin-only directory (name + dates only — never the email). */
async function backfillPublicProfilesIfAdmin(existing) {
    const adminLink = document.getElementById('drawer-link-admin');
    if (!adminLink || adminLink.classList.contains('hidden') || CommunityUsers.backfilled) return;
    CommunityUsers.backfilled = true;
    try {
        const dir = (await database.ref('userDirectory').once('value')).val() || {};
        const updates = {};
        Object.entries(dir).forEach(([uid, d]) => {
            if (existing[uid] || !d || !d.username) return;
            updates[`publicProfiles/${uid}`] = { username: String(d.username).slice(0, 60), avatar: '', bio: '', createdAt: d.createdAt || 0, lastActiveAt: d.lastActiveAt || 0 };
        });
        const count = Object.keys(updates).length;
        if (count === 0) return;
        await database.ref().update(updates);
        CommunityUsers.all = null;
        showToast(`Added ${count} existing member${count === 1 ? '' : 's'} to the Users list.`, 'success');
        loadCommunityUsers();
    } catch (error) {
        console.warn('Could not backfill public profiles:', error);
    }
}

/** Applies search + filter + sort to the loaded people (pure, so it can be tested). */
function filterCommunityUsers(all, { query, queryHash, filter, sort, myUid, connections, blocked, now }) {
    // Names are compared without accents, case or spacing differences, word by word in any order.
    const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const words = fold(query).split(' ').filter(Boolean);
    const weekAgo = now - 7 * 86400000;
    const list = (all || []).filter(u => {
        if (blocked && blocked.has(u.uid)) return false;
        // I am left out of the browsing list, but searching for myself still finds me.
        if (u.uid === myUid && words.length === 0) return false;
        if (words.length > 0) {
            const name = fold(u.username);
            const byName = words.every(word => name.includes(word));
            const byEmail = !!queryHash && u.eh === queryHash;
            if (!byName && !byEmail) return false;
        }
        const status = connections ? connections.get(u.uid) : undefined;
        if (filter === 'brethren') return status === 'brethren';
        if (filter === 'new') return !status;
        if (filter === 'active') return u.lastActiveAt >= weekAgo;
        return true;
    });
    const byName = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });
    if (sort === 'newest') list.sort((a, b) => (b.createdAt - a.createdAt) || byName(a, b));
    else if (sort === 'active') list.sort((a, b) => (b.lastActiveAt - a.lastActiveAt) || byName(a, b));
    else list.sort(byName);
    return list;
}

function renderCommunityUsersList() {
    const list = document.getElementById('community-users-list');
    if (!list || !CommunityUsers.all) return;
    const people = filterCommunityUsers(CommunityUsers.all, {
        query: CommunityUsers.query, queryHash: CommunityUsers.queryHash, filter: CommunityUsers.filter, sort: CommunityUsers.sort,
        myUid: AppState.currentUser?.uid, connections: AppState.userConnections, blocked: AppState.blockedUsers instanceof Set ? AppState.blockedUsers : null, now: Date.now()
    });
    if (people.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"><i class="fas fa-magnifying-glass"></i></div>
                <h3 style="margin-bottom: 8px;">No one found</h3>
                <p style="color: var(--text-slate);">${CommunityUsers.query.trim()
                    ? (CommunityUsers.query.includes('@')
                        ? 'Type the full email address exactly. People appear by email once they have opened this version of GraceGuide.'
                        : (CommunityUsers.filter !== 'all' ? 'Nobody with that name matches this filter — try “All”.' : 'Try another spelling, or search by their full email address.'))
                    : 'Nobody matches this filter yet.'}</p>
            </div>`;
        return;
    }
    const activeLabel = (ts) => {
        if (!ts) return '';
        const days = Math.floor((Date.now() - ts) / 86400000);
        return days <= 0 ? 'Active today' : days === 1 ? 'Active yesterday' : days < 7 ? `Active ${days} days ago` : days < 30 ? `Active ${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago` : '';
    };
    const tag = (status) => status === 'brethren' ? '<span class="badge-joined">Brethren</span>'
        : status === 'pending_sent' ? '<span class="community-user-tag">Request sent</span>'
        : status === 'pending_received' ? '<span class="community-user-tag">Wants to connect</span>' : '';
    list.innerHTML = `
        <p class="community-users-count">${people.length} ${people.length === 1 ? 'person' : 'people'}</p>
        ${people.slice(0, CommunityUsers.shown).map(u => {
            const joined = u.createdAt ? `Joined ${new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}` : '';
            const meta = [joined, activeLabel(u.lastActiveAt)].filter(Boolean).join(' · ');
            return `
                <div class="group-card community-user" onclick="viewUserProfile('${escapeHtml(u.uid)}', '${escapeHtml(u.username).replace(/'/g, "\\'")}')">
                    <div class="post-avatar community-user-avatar" data-spirit-uid="${escapeHtml(u.uid)}">${u.avatar ? `<img src="${escapeHtml(u.avatar)}" alt="" loading="lazy">` : escapeHtml(u.username.charAt(0).toUpperCase())}</div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(u.username)}</div>
                        ${u.bio ? `<div style="font-size: 12px; color: var(--text-slate); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(u.bio)}</div>` : ''}
                        ${meta ? `<div style="font-size: 11px; color: var(--text-slate); margin-top: 2px;">${meta}</div>` : ''}
                    </div>
                    ${u.uid === AppState.currentUser?.uid ? '<span class="community-user-tag">You</span>' : tag(AppState.userConnections.get(u.uid))}
                </div>`;
        }).join('')}
        ${people.length > CommunityUsers.shown ? `<button class="btn btn-outline btn-block mt-2" onclick="showMoreCommunityUsers()">Show more</button>` : ''}
    `;
    // Each person's Spirit Life sticker, once their profile is known (hidden if they keep it for Brethren).
    if (typeof spiritStickerFor === 'function') {
        list.querySelectorAll('[data-spirit-uid]').forEach(holder => {
            const uid = holder.dataset.spiritUid;
            fetchUserProfileName(uid).then(() => {
                if (!holder.isConnected || holder.querySelector('.spirit-sticker')) return;
                const html = spiritStickerFor(uid, uid === AppState.currentUser?.uid ? AppState.userProfile : UserNameCache.profiles.get(uid), 'spirit-on-avatar');
                if (html) { holder.classList.add('has-spirit'); holder.insertAdjacentHTML('beforeend', html); }
            });
        });
    }
}
async function loadCommunityGroups() {
    const container = $('#groups-list');
    if (!container) return;

    try {
        const snapshot = await database.ref('communityGroups').once('value');
        const groups = snapshot.val() || {};
        AppState.communityGroups = Object.values(groups).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (AppState.communityGroups.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-users"></i></div>
                    <h3 style="margin-bottom: 8px;">No Forum Groups Yet</h3>
                    <p style="color: var(--text-slate);">Start a group to discuss faith, study, and life together.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = AppState.communityGroups.map(group => renderGroupCard(group)).join('');
    } catch (error) {
        console.error('Error loading groups:', error);
        container.innerHTML = `<div class="error-state"><h3>Failed to load groups</h3></div>`;
    }
}

function renderGroupCard(group) {
    const uid = AppState.currentUser?.uid;
    const isMember = uid && group.members && group.members[uid];
    const memberCount = group.members ? Object.keys(group.members).length : 0;

    const hasUnread = AppState.unreadForumGroupIds && AppState.unreadForumGroupIds.has(group.id);

    return `
        <div class="group-card" onclick="openGroup('${group.id}')">
            <div class="group-card-icon"><i class="fas fa-users"></i></div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 700; display:flex; align-items:center; gap:6px;">
                    ${escapeHtml(group.name)}
                    ${hasUnread ? `<span class="drawer-badge-dot"></span>` : ''}
                </div>
                <div style="font-size: 12px; color: var(--text-slate); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(group.description || '')}</div>
                <div style="font-size: 11px; color: var(--text-slate); margin-top: 4px;"><i class="fas fa-user-group"></i> ${memberCount} member${memberCount !== 1 ? 's' : ''}</div>
            </div>
            ${isMember ? '<span class="badge-joined">Joined</span>' : ''}
        </div>
    `;
}

function showCreateGroupModal() {
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Start a Group</h3>
        <div class="form-group">
            <label class="form-label">Group Name</label>
            <input type="text" id="group-name" class="form-input" placeholder="e.g., Young Adults Bible Study">
        </div>
        <div class="form-group">
            <label class="form-label">Description</label>
            <textarea id="group-description" class="form-textarea" rows="3" placeholder="What's this group about?"></textarea>
        </div>
        <button id="submit-group-btn" class="btn btn-primary btn-block mt-3">Create Group</button>
    `;

    showModal(modalContent);

    $('#submit-group-btn').addEventListener('click', async () => {
        if (!requireAuth('Sign in to create a group.')) return;

        const name = $('#group-name').value.trim();
        const description = $('#group-description').value.trim();

        if (!name) {
            showToast('Please enter a group name', 'warning');
            return;
        }

        const group = {
            id: generateId(),
            name,
            description,
            createdBy: AppState.currentUser.uid,
            createdByName: AppState.userProfile?.username || 'Anonymous',
            createdAt: Date.now(),
            members: { [AppState.currentUser.uid]: true }
        };

        try {
            await database.ref(`communityGroups/${group.id}`).set(group);
            await database.ref(`users/${AppState.currentUser.uid}/groups/${group.id}`).set(true);
            closeModal();
            showToast('Group created!', 'success');
            openGroup(group.id);
        } catch (error) {
            showToast('Failed to create group', 'error');
        }
    });
}

function openGroup(groupId) {
    AppState.currentGroupId = groupId;
    navigateTo('group-chat');
}

async function renderGroupChatPage() {
    const groupId = AppState.currentGroupId;
    if (!groupId) {
        navigateTo('community');
        return;
    }

    DOM.pageContainer.innerHTML = `
        <div class="group-chat-container">
            <div class="group-chat-header">
                <button class="icon-btn" onclick="navigateTo('community')"><i class="fas fa-arrow-left"></i></button>
                <div style="flex:1; min-width:0; cursor:pointer;" onclick="showGroupMembers('${groupId}')">
                    <div id="group-chat-title" style="font-weight:700;">Loading…</div>
                    <div id="group-chat-members" style="font-size:12px; color: var(--text-slate);"></div>
                </div>
                <button class="btn btn-outline btn-sm" id="group-join-btn" style="display:none;">Join</button>
            </div>

            <div class="group-chat-messages" id="group-chat-messages">
                <div class="skeleton" style="height: 60px; margin-bottom: 12px;"></div>
            </div>

            <div class="group-chat-input-row">
                <button class="icon-btn" id="group-attach-btn" aria-label="Attach">
                    <i class="fas fa-paperclip"></i>
                </button>
                <textarea id="group-message-input" class="chat-input" rows="1" enterkeyhint="enter" placeholder="Message the group..." onkeydown="handleMessageInputKeydown(event, sendGroupMessage)" oninput="autoGrowTextarea(this)"></textarea>
                <button class="chat-send-btn" onclick="sendGroupMessage()" aria-label="Send">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    $('#group-attach-btn').addEventListener('click', showGroupAttachMenu);
    setChatThread('group', `communityGroups/${groupId}/messages`, 'group-message-input');

    try {
        const snapshot = await database.ref(`communityGroups/${groupId}`).once('value');
        const group = snapshot.val();
        if (!group) {
            showToast('Group not found', 'error');
            navigateTo('community');
            return;
        }

        if (DOM.topBarTitle) DOM.topBarTitle.textContent = group.name;
        $('#group-chat-title').textContent = group.name;
        const memberCount = group.members ? Object.keys(group.members).length : 0;
        $('#group-chat-members').textContent = `${memberCount} member${memberCount !== 1 ? 's' : ''}`;

        const uid = AppState.currentUser?.uid;
        const isMember = uid && group.members && group.members[uid];
        if (!isMember) {
            $('#group-join-btn').style.display = 'inline-flex';
            $('#group-join-btn').addEventListener('click', () => joinGroup(groupId));
        }

        await loadGroupMessages(groupId);

        // Mark as read now that the user is viewing this group's messages.
        if (uid && isMember) {
            database.ref(`users/${uid}/groupReads/${groupId}`).set(Date.now()).catch(() => {});
            if (AppState.unreadForumGroupIds) AppState.unreadForumGroupIds.delete(groupId);
            if (typeof updateForumDrawerBadge === 'function') updateForumDrawerBadge();
        }
    } catch (error) {
        console.error('Error loading group:', error);
    }
}

async function joinGroup(groupId) {
    if (!requireAuth('Sign in to join this group.')) return;
    try {
        await database.ref(`communityGroups/${groupId}/members/${AppState.currentUser.uid}`).set(true);
        await database.ref(`users/${AppState.currentUser.uid}/groups/${groupId}`).set(true);
        showToast('Joined group!', 'success');
        renderGroupChatPage();
    } catch (error) {
        showToast('Failed to join group', 'error');
    }
}

/**
 * WhatsApp-style member list: tap the group name/member count to see
 * everyone in the group, then tap a member to view their profile.
 */
async function showGroupMembers(groupId) {
    showSheet(`
        <h3 style="margin-bottom: 16px;">Group Members</h3>
        <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
    `);

    try {
        const groupSnap = await database.ref(`communityGroups/${groupId}`).once('value');
        const group = groupSnap.val();
        const memberIds = group?.members ? Object.keys(group.members) : [];

        if (memberIds.length === 0) {
            showSheet(`<h3 style="margin-bottom: 16px;">Group Members</h3><p class="text-center text-muted">No members yet.</p>`);
            return;
        }

        const profiles = await Promise.all(memberIds.map(async (id) => {
            try {
                const snap = await database.ref(`users/${id}/profile`).once('value');
                return { id, ...(snap.val() || { username: 'User' }) };
            } catch {
                return { id, username: 'User' };
            }
        }));

        showSheet(`
            <h3 style="margin-bottom: 16px;">Group Members (${profiles.length})</h3>
            <div style="max-height: 60vh; overflow-y: auto;">
                ${profiles.map(p => `
                    <div class="flex items-center gap-2 p-2" style="cursor:pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeSheetThen(() => viewUserProfile('${p.id}', '${escapeHtml(p.username || 'User').replace(/'/g, "\\'")}'))">
                        <div class="post-avatar comment-avatar" style="width:40px;height:40px;">
                            ${p.avatar ? `<img src="${p.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (p.username?.[0]?.toUpperCase() || 'U')}
                        </div>
                        <div style="font-weight:600;">${escapeHtml(p.username || 'User')}${AppState.currentUser && p.id === AppState.currentUser.uid ? ' (You)' : ''}</div>
                    </div>
                `).join('')}
            </div>
        `);
    } catch (error) {
        console.error('Error loading group members:', error);
        showSheet(`<h3 style="margin-bottom: 16px;">Group Members</h3><p class="text-center text-muted">Couldn't load members.</p>`);
    }
}

async function loadGroupMessages(groupId) {
    const container = $('#group-chat-messages');
    if (!container) return;

    try {
        const snapshot = await database.ref(`communityGroups/${groupId}/messages`).orderByChild('timestamp').limitToLast(100).once('value');
        if (AppState.currentGroupId !== groupId || !document.body.contains(container)) return;
        renderThreadMessages(container, snapshot.val() || {}, {
            showAuthor: true,
            emptyHTML: `<p class="text-center text-muted" style="padding: 40px 20px;">No messages yet. Start the conversation!</p>`
        });
    } catch (error) {
        console.error('Error loading group messages:', error);
    }
}

async function sendGroupMessage() {
    if (!requireAuth('Sign in to send messages.')) return;

    const groupId = AppState.currentGroupId;
    const input = $('#group-message-input');
    const content = input?.value.trim();
    if (!content || !groupId) return;

    input.value = '';
    autoGrowTextarea(input);

    if (ChatThread.editingId) {
        await submitThreadEdit(content);
        return;
    }

    const msg = {
        senderId: AppState.currentUser.uid,
        senderName: AppState.userProfile?.username || 'Anonymous',
        type: 'text',
        content,
        timestamp: Date.now()
    };
    const replyTo = consumeThreadReply();
    if (replyTo) msg.replyTo = replyTo;

    try {
        // Sending a message also makes you a member
        await database.ref(`communityGroups/${groupId}/members/${AppState.currentUser.uid}`).set(true);
        await database.ref(`communityGroups/${groupId}/messages/${generateId()}`).set(msg);

        // Notify other members (push, via the addNotification -> fcmTokens
        // Cloud Function trigger) that a forum/group message dropped.
        const membersSnap = await database.ref(`communityGroups/${groupId}/members`).once('value');
        const members = membersSnap.val() || {};
        Object.keys(members).forEach((memberUid) => {
            if (memberUid === AppState.currentUser.uid) return;
            addNotification(memberUid, {
                type: 'group_message',
                fromUid: AppState.currentUser.uid,
                fromName: msg.senderName,
                groupId,
                message: `${msg.senderName} in the group: ${content}`
            });
        });

        loadGroupMessages(groupId);
    } catch (error) {
        showToast('Failed to send message', 'error');
    }
}

function showGroupAttachMenu() {
    if (!requireAuth('Sign in to share into this group.')) return;

    const sheetContent = `
        <h3 style="margin-bottom: 12px;">Share to Group</h3>
        <div style="display: grid; gap: 8px;">
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(shareVerseToGroup)">
                <i class="fas fa-book-bible"></i> Share Bible Verse
            </button>
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(sharePlanToGroup)">
                <i class="fas fa-calendar-check"></i> Share Study Plan
            </button>
        </div>
    `;
    showSheet(sheetContent);
}

function shareVerseToGroup() {
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Share a Verse</h3>
        <div class="form-group">
            <label class="form-label">Reference</label>
            <input type="text" id="share-verse-ref" class="form-input" placeholder="e.g., John 3:16">
        </div>
        <div class="form-group">
            <label class="form-label">Verse Text</label>
            <textarea id="share-verse-text" class="form-textarea" rows="3" placeholder="Paste or type the verse..."></textarea>
        </div>
        <button id="submit-share-verse-btn" class="btn btn-primary btn-block mt-3">Share</button>
    `;
    showModal(modalContent);

    $('#submit-share-verse-btn').addEventListener('click', async () => {
        const reference = $('#share-verse-ref').value.trim();
        const text = $('#share-verse-text').value.trim();
        if (!reference || !text) {
            showToast('Please fill in both fields', 'warning');
            return;
        }

        const groupId = AppState.currentGroupId;
        const msg = {
            senderId: AppState.currentUser.uid,
            senderName: AppState.userProfile?.username || 'Anonymous',
            type: 'bible',
            reference,
            content: text,
            timestamp: Date.now()
        };

        try {
            await database.ref(`communityGroups/${groupId}/messages/${generateId()}`).set(msg);
            closeModal();
            loadGroupMessages(groupId);
        } catch (error) {
            showToast('Failed to share verse', 'error');
        }
    });
}

function sharePlanToGroup() {
    if (AppState.plannerData.length === 0) {
        showToast('You have no study plans to share yet', 'warning');
        return;
    }

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Share a Plan</h3>
        <div style="display: grid; gap: 8px;">
            ${AppState.plannerData.map((plan, i) => `
                <button class="btn btn-outline btn-block" onclick="submitSharePlanToGroup(${i})">
                    ${escapeHtml(plan.name || plan.title || plan.planType || 'Study Plan')}
                </button>
            `).join('')}
        </div>
    `;
    showModal(modalContent);
}

async function submitSharePlanToGroup(planIndex) {
    const plan = AppState.plannerData[planIndex];
    if (!plan) return;

    const groupId = AppState.currentGroupId;
    const msg = {
        senderId: AppState.currentUser.uid,
        senderName: AppState.userProfile?.username || 'Anonymous',
        type: 'plan',
        content: plan.name || plan.title || plan.planType || 'Study Plan',
        timestamp: Date.now()
    };
    // Lets the people it's shared with open the plan and adopt it.
    const planShareId = typeof savePlanShareSnapshot === 'function' ? savePlanShareSnapshot(plan) : null;
    if (planShareId) msg.planShareId = planShareId;

    try {
        await database.ref(`communityGroups/${groupId}/messages/${generateId()}`).set(msg);
        closeModal();
        loadGroupMessages(groupId);
    } catch (error) {
        showToast('Failed to share plan', 'error');
    }
}

/* ---- Public user profile (view/connect/report) ---- */
async function viewUserProfile(userId, displayName) {
    if (!userId) return;

    if (AppState.currentUser && userId === AppState.currentUser.uid) {
        navigateTo('profile');
        return;
    }

    AppState.viewedProfileId = userId;
    AppState.viewedProfileName = getDisplayName(userId, displayName || null);
    navigateTo('view-profile');
}

async function renderViewProfilePage() {
    const userId = AppState.viewedProfileId;
    if (!userId) {
        navigateTo('community');
        return;
    }

    DOM.pageContainer.innerHTML = `
        <div class="profile-container">
            <div class="profile-header">
                <div class="skeleton" style="width: 100px; height: 100px; border-radius: 50%; margin: 0 auto var(--spacing-md);"></div>
                <div class="skeleton" style="height: 20px; width: 140px; margin: 0 auto;"></div>
            </div>
        </div>
    `;

    let profile = { username: AppState.viewedProfileName || 'User', bio: '' };
    try {
        const snapshot = await database.ref(`users/${userId}/profile`).once('value');
        if (snapshot.exists()) profile = { ...profile, ...snapshot.val() };
    } catch (error) {
        console.error('Error loading profile:', error);
    }

    // Don't render a stale page if the user navigated away while this loaded.
    if (AppState.viewedProfileId !== userId || AppState.currentRoute !== 'view-profile') return;

    // The live profile is the source of truth for the name — keep the
    // shared name cache and the top-bar title in step with it.
    if (profile.username) {
        UserNameCache.names.set(userId, profile.username);
        UserNameCache.fetchedAt.set(userId, Date.now());
        AppState.viewedProfileName = profile.username;
        if (DOM.topBarTitle) DOM.topBarTitle.textContent = profile.username;
    }

    const name = escapeHtml(profile.username || 'User');
    const status = AppState.userConnections.get(userId) || null;
    const isBrethren = status === 'brethren';

    // Brethren/Posts/Streak are visible to anyone viewing this profile;
    // "User Journey" (reading history/bookmarks/notes) is only fetched
    // at all if the viewer is this person's Brethren — matching both the
    // UI gating below AND the database rules (non-Brethren wouldn't be
    // able to read those paths regardless).
    const statsPromises = [
        database.ref(`users/${userId}/connections`).once('value').then(s => {
            const conns = s.val() || {};
            return Object.values(conns).filter(c => c && c.status === 'accepted').length;
        }).catch(() => 0),
        database.ref('spacePosts').orderByChild('authorId').equalTo(userId).once('value').then(s => Object.keys(s.val() || {}).length).catch(() => 0),
        database.ref(`users/${userId}/spaceStreak`).once('value').then(s => (s.val() || {}).count || 0).catch(() => 0)
    ];
    let journeyLoadFailed = false;
    if (isBrethren) {
        statsPromises.push(
            database.ref(`users/${userId}/readingHistory`).once('value').then(s => dedupeReadingHistory(s.val()).length).catch(() => { journeyLoadFailed = true; return 0; }),
            database.ref(`users/${userId}/bookmarks`).once('value').then(s => (s.val() || []).length).catch(() => { journeyLoadFailed = true; return 0; }),
            database.ref(`users/${userId}/notes`).once('value').then(s => (s.val() || []).length).catch(() => { journeyLoadFailed = true; return 0; })
        );
    }
    const [brethrenCount, postsCount, streakCount, chaptersRead, bookmarksCount, notesCount] = await Promise.all(statsPromises);

    if (AppState.viewedProfileId !== userId || AppState.currentRoute !== 'view-profile') return;

    let connectButtonHTML;
    if (status === 'brethren') {
        connectButtonHTML = `
            <button class="btn btn-outline btn-sm" onclick="removeBrethren('${userId}', '${name.replace(/'/g, "\\'")}')">
                <i class="fas fa-people-arrows"></i> Brethren
            </button>
        `;
    } else if (status === 'pending_sent') {
        connectButtonHTML = `
            <button class="btn btn-outline btn-sm" onclick="cancelConnectRequest('${userId}')">
                <i class="fas fa-clock"></i> Pending
            </button>
        `;
    } else if (status === 'pending_received') {
        connectButtonHTML = `
            <button class="btn btn-primary btn-sm" onclick="acceptConnectRequest('${userId}', '${name.replace(/'/g, "\\'")}')">
                <i class="fas fa-check"></i> Accept Request
            </button>
        `;
    } else {
        connectButtonHTML = `
            <button class="btn btn-primary btn-sm" onclick="sendConnectRequest('${userId}', '${name.replace(/'/g, "\\'")}')">
                <i class="fas fa-people-arrows"></i> Connect
            </button>
        `;
    }

    DOM.pageContainer.innerHTML = `
        <div class="profile-container">
            <div class="profile-header">
                <div class="profile-avatar">
                    ${profile.avatar ? `<img src="${profile.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : (name[0]?.toUpperCase() || 'U')}
                    ${typeof spiritStickerFor === 'function' ? `<div class="avatar-spirit">${spiritStickerFor(userId, profile)}</div>` : ''}
                </div>
                <h2 style="font-weight: 700; margin-top: 8px;">${name}</h2>
                <p style="color: var(--text-slate);">${escapeHtml(profile.bio || 'No bio yet')}</p>
                ${typeof faithLineHTML === 'function' ? faithLineHTML(profile, userId) : ''}
                ${status === 'pending_received' ? `<p style="font-size: 12px; color: var(--text-slate); margin-top: 4px;">Sent you a connection request</p>` : ''}
            </div>

            <div class="profile-stats">
                <div class="profile-stat" style="cursor: pointer;" onclick="showUserBrethrenModal('${userId}', '${name.replace(/'/g, "\\'")}')">
                    <div class="profile-stat-value">${brethrenCount}</div>
                    <div class="profile-stat-label">Brethren</div>
                </div>
                <div class="profile-stat" style="cursor: pointer;" onclick="showUserPostsModal('${userId}', '${name.replace(/'/g, "\\'")}')">
                    <div class="profile-stat-value">${postsCount}</div>
                    <div class="profile-stat-label">Posts</div>
                </div>
                <div class="profile-stat">
                    <div class="profile-stat-value">${streakCount}</div>
                    <div class="profile-stat-label">Streak</div>
                </div>
            </div>

            <div class="flex gap-2 mb-4" style="justify-content: center; flex-wrap: wrap;">
                ${connectButtonHTML}
                ${status === 'brethren' ? `
                    <button class="btn btn-outline btn-sm" onclick="openConversation('${userId}', '${name.replace(/'/g, "\\'")}')">
                        <i class="fas fa-comment-dots"></i> Chat
                    </button>
                ` : `
                    <button class="btn btn-outline btn-sm" style="opacity:0.6;" onclick="showToast('Become Brethren first to chat with ${name.replace(/'/g, "\\'")}', 'warning')">
                        <i class="fas fa-lock"></i> Chat
                    </button>
                `}
                ${status === 'pending_received' ? `
                    <button class="btn btn-outline btn-sm" onclick="declineConnectRequest('${userId}')">
                        <i class="fas fa-xmark"></i> Decline
                    </button>
                ` : ''}
            </div>

            <div style="display:flex; justify-content:center; gap:20px; margin-bottom: 16px;">
                <button class="text-muted" style="background:none; border:none; font-size: 13px; cursor:pointer;" onclick="reportUser('${userId}', '${name.replace(/'/g, "\\'")}')">
                    <i class="fas fa-flag"></i> Report
                </button>
                <button class="text-muted" style="background:none; border:none; font-size: 13px; cursor:pointer;" onclick="blockUser('${userId}', '${name.replace(/'/g, "\\'")}')">
                    <i class="fas fa-ban"></i> Block
                </button>
            </div>

            ${isBrethren ? `
                <div class="card mb-3">
                    <h3 style="font-weight: 700; margin-bottom: 16px;">User Journey</h3>
                    ${journeyLoadFailed ? `
                        <p class="text-muted" style="font-size: 13px;">
                            <i class="fas fa-triangle-exclamation"></i> Couldn't load this — the site's database rules need to be updated to let Brethren see each other's journey. If you're the site owner, deploy <code>database.rules.json</code>.
                        </p>
                    ` : `
                    <div class="flex gap-2" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                        <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                            <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${chaptersRead}</div>
                            <div style="font-size: 11px; color: var(--text-slate);">Chapters Read</div>
                        </div>
                        <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                            <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${bookmarksCount}</div>
                            <div style="font-size: 11px; color: var(--text-slate);">Bookmarks</div>
                        </div>
                        <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                            <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${notesCount}</div>
                            <div style="font-size: 11px; color: var(--text-slate);">Notes</div>
                        </div>
                    </div>
                    `}
                </div>
            ` : ''}
        </div>
    `;
}

async function sendConnectRequest(otherUid, displayName) {
    if (!requireAuth('Sign in to connect with others.')) return;

    const uid = AppState.currentUser.uid;
    const myName = AppState.userProfile?.username || 'Anonymous';

    try {
        await database.ref(`users/${uid}/connections/${otherUid}`).set({ status: 'pending', direction: 'outgoing', timestamp: Date.now(), name: displayName || 'User' });
        await database.ref(`users/${otherUid}/connections/${uid}`).set({ status: 'pending', direction: 'incoming', timestamp: Date.now(), name: myName });
        AppState.userConnections.set(otherUid, 'pending_sent');

        // Surface it in the recipient's notification center, where they can
        // accept or decline right there.
        await addNotification(otherUid, {
            type: 'connection_request',
            fromUid: uid,
            fromName: myName,
            message: `${myName} wants to connect with you as Brethren`
        });

        showToast(`Connection request sent to ${displayName}`, 'success');
        renderViewProfilePage();
    } catch (error) {
        showToast('Something went wrong', 'error');
    }
}

async function cancelConnectRequest(otherUid) {
    if (!AppState.currentUser) return;
    const uid = AppState.currentUser.uid;

    try {
        await database.ref(`users/${uid}/connections/${otherUid}`).remove();
        await database.ref(`users/${otherUid}/connections/${uid}`).remove();
        AppState.userConnections.delete(otherUid);
        showToast('Request cancelled', 'success');
        if (AppState.currentRoute === 'view-profile' && AppState.viewedProfileId === otherUid) renderViewProfilePage();
    } catch (error) {
        showToast('Something went wrong', 'error');
    }
}

async function acceptConnectRequest(otherUid, displayName) {
    if (!requireAuth('Sign in to accept connection requests.')) return;
    const uid = AppState.currentUser.uid;
    const myName = AppState.userProfile?.username || 'Anonymous';

    try {
        await database.ref(`users/${uid}/connections/${otherUid}`).update({ status: 'accepted' });
        await database.ref(`users/${otherUid}/connections/${uid}`).update({ status: 'accepted' });
        AppState.userConnections.set(otherUid, 'brethren');

        await addNotification(otherUid, {
            type: 'connection_accepted',
            fromUid: uid,
            fromName: myName,
            message: `${myName} accepted your Brethren request — you can now message each other!`
        });

        showToast(`You and ${displayName} are now Brethren!`, 'success');

        if (AppState.currentRoute === 'view-profile' && AppState.viewedProfileId === otherUid) renderViewProfilePage();
        if (AppState.sheetOpen) showNotificationPanel();
    } catch (error) {
        showToast('Something went wrong', 'error');
    }
}

async function declineConnectRequest(otherUid) {
    await cancelConnectRequest(otherUid);
    if (AppState.sheetOpen) showNotificationPanel();
}

function removeBrethren(otherUid, displayName) {
    showModal(`
        <h3 style="margin-bottom: 12px;">Remove ${escapeHtml(displayName)} as Brethren?</h3>
        <p style="color: var(--text-slate); margin-bottom: 20px;">You can always reconnect later.</p>
        <div style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
            <button class="btn btn-block" style="background:#f44336; color:white;" onclick="closeModal(); cancelConnectRequest('${otherUid}');">Remove</button>
        </div>
    `);
}

function reportUser(userId, displayName) {
    showModal(`
        <h3 style="margin-bottom: 16px;">Report ${escapeHtml(displayName)}</h3>
        <textarea id="report-reason-input" class="form-textarea" placeholder="What's happening? (optional details)" rows="3"></textarea>
        <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-accent" onclick="submitUserReport('${userId}')">Submit Report</button>
        </div>
    `);
}

async function submitUserReport(userId) {
    const reason = $('#report-reason-input')?.value.trim() || '';
    try {
        await database.ref(`reports/${generateId()}`).set({
            reportedUserId: userId,
            reportedBy: AppState.currentUser?.uid || null,
            reason,
            timestamp: Date.now()
        });
        closeModal();
        closeSheet();
        showToast('Report submitted. Thank you.', 'success');
    } catch (error) {
        showToast('Failed to submit report', 'error');
    }
}

function blockUser(userId, displayName) {
    showModal(`
        <h3 style="margin-bottom: 16px;">Block ${escapeHtml(displayName)}</h3>
        <p>You won't see their posts or comments anymore.</p>
        <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-accent" onclick="confirmBlockUser('${userId}')">Block</button>
        </div>
    `);
}

async function confirmBlockUser(userId) {
    if (!AppState.currentUser) return;
    try {
        await database.ref(`users/${AppState.currentUser.uid}/blocked/${userId}`).set(true);
        closeModal();
        closeSheet();
        showToast('User blocked', 'success');
        if (AppState.currentRoute === 'space') loadSpacePosts();
    } catch (error) {
        showToast('Failed to block user', 'error');
    }
}

/* ============================================
   MESSAGES (Direct Messages)
   ============================================ */
function getDMConversationId(uidA, uidB) {
    return [uidA, uidB].sort().join('_');
}

function renderMessagesPage() {
    if (!AppState.currentUser) {
        DOM.pageContainer.innerHTML = `
            <div class="text-center" style="padding: 60px 24px;">
                <div class="empty-state-icon" style="margin: 0 auto 16px;"><i class="fas fa-envelope"></i></div>
                <h3 style="margin-bottom: 8px;">Sign in to view chats</h3>
                <p class="text-muted" style="margin-bottom: 24px;">Connect and chat with others in the community.</p>
                <button class="btn btn-primary" onclick="showAuthModal({message: 'Sign in to view your chats.'})">
                    <i class="fas fa-right-to-bracket"></i> Sign In
                </button>
            </div>
        `;
        return;
    }

    DOM.pageContainer.innerHTML = `
        <div class="planner-container">
            <h2 style="font-weight: 700; margin-bottom: 16px;">Chats</h2>
            <div id="dm-conversations-list">
                <div class="skeleton" style="height: 64px; margin-bottom: 12px;"></div>
                <div class="skeleton" style="height: 64px; margin-bottom: 12px;"></div>
            </div>
        </div>
    `;

    loadDMConversations();
}

async function loadDMConversations() {
    const container = $('#dm-conversations-list');
    if (!container || !AppState.currentUser) return;

    try {
        const snapshot = await database.ref(`users/${AppState.currentUser.uid}/dmIndex`).once('value');
        const data = snapshot.val() || {};
        const list = Object.entries(data)
            .map(([otherUid, info]) => ({ otherUid, ...info }))
            .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

        AppState.dmConversations = list;

        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fas fa-envelope"></i></div>
                    <h3 style="margin-bottom: 8px;">No Chats Yet</h3>
                    <p style="color: var(--text-slate);">Visit someone's profile and tap Message to start a conversation.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(conv => `
            <div class="conversation-item" onclick="openConversation('${conv.otherUid}', '${(conv.otherUserName || 'User').replace(/'/g, "\\'")}')">
                <div class="post-avatar comment-avatar" style="width:44px;height:44px;">
                    ${userInitialHTML(conv.otherUid, conv.otherUserName || 'User')}
                </div>
                <div class="conversation-item-main">
                    <div style="font-weight: 600; display:flex; align-items:center; gap:6px;">
                        ${userNameHTML(conv.otherUid, conv.otherUserName || 'User')}
                        ${conv.streak > 0 ? `<span class="streak-badge"><i class="fas fa-fire"></i> ${conv.streak}</span>` : ''}
                        ${conv.unread ? `<span class="drawer-badge-dot" style="margin-left:2px;"></span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: var(--text-slate); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:${conv.unread ? '600' : '400'};">${escapeHtml(conv.lastMessage || '')}</div>
                </div>
                <div style="font-size: 11px; color: var(--text-slate);">${conv.lastTimestamp ? formatDate(conv.lastTimestamp) : ''}</div>
            </div>
        `).join('');
        hydrateUserNames(container);
    } catch (error) {
        console.error('Error loading conversations:', error);
    }
}

function openConversation(otherUid, otherUserName) {
    if (!requireAuth('Sign in to send messages.', () => openConversation(otherUid, otherUserName))) return;

    if (AppState.userConnections.get(otherUid) !== 'brethren') {
        showToast('You can only message Brethren. Send a connection request first.', 'warning');
        viewUserProfile(otherUid, otherUserName);
        return;
    }

    AppState.currentDMUserId = otherUid;
    AppState.currentDMUserName = getDisplayName(otherUid, otherUserName);
    navigateTo('dm-thread');
}

async function renderDMThreadPage() {
    const otherUid = AppState.currentDMUserId;
    if (!otherUid || !AppState.currentUser) {
        navigateTo('messages');
        return;
    }

    if (AppState.userConnections.get(otherUid) !== 'brethren') {
        showToast('You can only message Brethren.', 'warning');
        navigateTo('messages');
        return;
    }

    DOM.pageContainer.innerHTML = `
        <div class="group-chat-container">
            <div class="group-chat-header">
                <button class="icon-btn" onclick="navigateTo('messages')"><i class="fas fa-arrow-left"></i></button>
                <div style="flex:1; min-width:0; cursor:pointer;" onclick="viewUserProfile('${otherUid}', '${(AppState.currentDMUserName || 'User').replace(/'/g, "\\'")}')">
                    <div style="font-weight:700; display:flex; align-items:center; gap:8px;">
                        ${userNameHTML(otherUid, AppState.currentDMUserName || 'User')}
                        <span id="dm-streak-badge"></span>
                    </div>
                </div>
            </div>

            <div class="group-chat-messages" id="dm-messages">
                <div class="skeleton" style="height: 60px; margin-bottom: 12px;"></div>
            </div>

            <div class="group-chat-input-row">
                <button class="icon-btn" id="dm-attach-btn" aria-label="Attach">
                    <i class="fas fa-paperclip"></i>
                </button>
                <textarea id="dm-message-input" class="chat-input" rows="1" enterkeyhint="enter" placeholder="Message..." onkeydown="handleMessageInputKeydown(event, sendDirectMessage)" oninput="autoGrowTextarea(this)"></textarea>
                <button class="chat-send-btn" onclick="sendDirectMessage()" aria-label="Send">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    if (DOM.topBarTitle) DOM.topBarTitle.textContent = AppState.currentDMUserName || 'Chats';
    fetchUserProfileName(otherUid).then(name => {
        if (!name || AppState.currentDMUserId !== otherUid) return;
        AppState.currentDMUserName = name;
        if (AppState.currentRoute === 'dm-thread' && DOM.topBarTitle) DOM.topBarTitle.textContent = name;
        hydrateUserNames($('.group-chat-header'));
    });
    $('#dm-attach-btn').addEventListener('click', showDMAttachMenu);
    setChatThread('dm', `dmConversations/${getDMConversationId(AppState.currentUser.uid, otherUid)}/messages`, 'dm-message-input');

    await loadDMMessages();
    await refreshDMStreakBadge();

    // Mark this thread as read now that the user is looking at it.
    database.ref(`users/${AppState.currentUser.uid}/dmIndex/${otherUid}/unread`).set(false).catch(() => {});
}

async function refreshDMStreakBadge() {
    const badge = $('#dm-streak-badge');
    const uid = AppState.currentUser?.uid;
    const otherUid = AppState.currentDMUserId;
    if (!badge || !uid || !otherUid) return;

    try {
        const snapshot = await database.ref(`dmConversations/${getDMConversationId(uid, otherUid)}/streak/count`).once('value');
        const count = snapshot.val() || 0;
        badge.innerHTML = count > 0 ? `<span class="streak-badge"><i class="fas fa-fire"></i> ${count}</span>` : '';
    } catch (error) {
        console.error('Error loading streak:', error);
    }
}

async function loadDMMessages() {
    const container = $('#dm-messages');
    const uid = AppState.currentUser?.uid;
    const otherUid = AppState.currentDMUserId;
    if (!container || !uid || !otherUid) return;

    const conversationId = getDMConversationId(uid, otherUid);

    try {
        const snapshot = await database.ref(`dmConversations/${conversationId}/messages`).orderByChild('timestamp').limitToLast(200).once('value');
        if (AppState.currentDMUserId !== otherUid || !document.body.contains(container)) return;
        renderThreadMessages(container, snapshot.val() || {}, {
            showAuthor: false,
            emptyHTML: `<p class="text-center text-muted" style="padding: 40px 20px;">Say hello 👋</p>`
        });
    } catch (error) {
        console.error('Error loading DM messages:', error);
    }
}

async function sendDirectMessage() {
    if (!requireAuth('Sign in to send messages.')) return;

    const input = $('#dm-message-input');
    const content = input?.value.trim();
    const otherUid = AppState.currentDMUserId;
    if (!content || !otherUid) return;

    input.value = '';
    autoGrowTextarea(input);

    if (ChatThread.editingId) {
        await submitThreadEdit(content);
        return;
    }

    const fields = { type: 'text', content };
    const replyTo = consumeThreadReply();
    if (replyTo) fields.replyTo = replyTo;
    await deliverDMMessage(fields);
}

// Message types that count toward the daily Brethren streak — sharing
// anything devotional (not just verses) keeps the streak alive.
const STREAK_ELIGIBLE_TYPES = ['bible', 'note', 'reflection'];

/**
 * Writes a message into the current DM thread and keeps both users'
 * conversation indexes (dmIndex) up to date. Used by plain text, verse,
 * plan, note, and reflection shares alike.
 */
async function deliverDMMessage(messageFields) {
    const otherUid = AppState.currentDMUserId;
    if (!AppState.currentUser || !otherUid) return;

    if (AppState.userConnections.get(otherUid) !== 'brethren') {
        showToast('You can only message Brethren.', 'warning');
        return;
    }

    const uid = AppState.currentUser.uid;
    const conversationId = getDMConversationId(uid, otherUid);
    const myName = AppState.userProfile?.username || 'Anonymous';
    const preview = messageFields.type === 'bible' ? `📖 ${messageFields.reference || 'Shared a verse'}`
        : messageFields.type === 'plan' ? `📅 ${messageFields.content || 'Shared a study plan'}`
        : messageFields.type === 'note' ? `📝 ${messageFields.reference || 'Shared a note'}`
        : messageFields.type === 'reflection' ? `💡 Shared today's reflection`
        : messageFields.content;

    const msg = {
        senderId: uid,
        senderName: myName,
        timestamp: Date.now(),
        ...messageFields
    };

    try {
        await database.ref(`dmConversations/${conversationId}/messages/${generateId()}`).set(msg);
        await database.ref(`dmConversations/${conversationId}/participants`).update({ [uid]: true, [otherUid]: true });

        await database.ref(`users/${uid}/dmIndex/${otherUid}`).update({
            otherUserName: AppState.currentDMUserName || 'User',
            lastMessage: preview,
            lastTimestamp: Date.now(),
            conversationId,
            unread: false
        });

        // Recipient's side is marked unread so the drawer/chat list can
        // show a live indicator until they open this thread.
        await database.ref(`users/${otherUid}/dmIndex/${uid}`).update({
            otherUserName: myName,
            lastMessage: preview,
            lastTimestamp: Date.now(),
            conversationId,
            unread: true
        });

        if (STREAK_ELIGIBLE_TYPES.includes(messageFields.type)) {
            await updateDMStreak(conversationId, uid, otherUid);
        }

        // Fires a push notification (via the addNotification -> fcmTokens
        // Cloud Function trigger) so the recipient is alerted even if the
        // app is closed, matching "when a chat message drops".
        addNotification(otherUid, {
            type: 'dm_message',
            fromUid: uid,
            fromName: myName,
            conversationId,
            message: `${myName}: ${preview}`
        });

        loadDMMessages();
        refreshDMStreakBadge();
    } catch (error) {
        showToast('Failed to send message', 'error');
        console.error(error);
    }
}

function showDMAttachMenu() {
    if (!requireAuth('Sign in to share.')) return;

    const sheetContent = `
        <h3 style="margin-bottom: 4px;">Share</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 12px;"><i class="fas fa-fire" style="color:#f57c00;"></i> Any of these keep your streak alive today.</p>
        <div style="display: grid; gap: 8px;">
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(shareVerseToDM)">
                <i class="fas fa-book-bible"></i> Share Bible Verse
            </button>
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(shareNoteToDM)">
                <i class="fas fa-sticky-note"></i> Share a Note
            </button>
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(shareReflectionToDM)">
                <i class="fas fa-lightbulb"></i> Share Today's Reflection
            </button>
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(sharePlanToDM)">
                <i class="fas fa-calendar-check"></i> Share Study Plan
            </button>
        </div>
    `;
    showSheet(sheetContent);
}

function shareVerseToDM() {
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Share a Verse</h3>
        <div class="form-group">
            <label class="form-label">Reference</label>
            <input type="text" id="share-verse-ref" class="form-input" placeholder="e.g., John 3:16">
        </div>
        <div class="form-group">
            <label class="form-label">Verse Text</label>
            <textarea id="share-verse-text" class="form-textarea" rows="3" placeholder="Paste or type the verse..."></textarea>
        </div>
        <button id="submit-share-verse-btn" class="btn btn-primary btn-block mt-3">Share</button>
    `;
    showModal(modalContent);

    $('#submit-share-verse-btn').addEventListener('click', async () => {
        const reference = $('#share-verse-ref').value.trim();
        const text = $('#share-verse-text').value.trim();
        if (!reference || !text) {
            showToast('Please fill in both fields', 'warning');
            return;
        }

        await deliverDMMessage({ type: 'bible', reference, content: text });
        closeModal();
    });
}

function shareNoteToDM() {
    if (AppState.notes.length === 0) {
        showToast('You have no notes to share yet — add one from the Bible reader.', 'warning');
        return;
    }

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Share a Note</h3>
        <div style="display: grid; gap: 8px; max-height: 320px; overflow-y: auto;">
            ${AppState.notes.map((note, i) => `
                <button class="btn btn-outline btn-block" style="text-align:left;" onclick="submitShareNoteToDM(${i})">
                    <div style="font-weight:600;">${escapeHtml(note.reference || 'Note')}</div>
                    <div style="font-size:12px; color: var(--text-slate); white-space:normal;">${escapeHtml((note.text || '').slice(0, 80))}${(note.text || '').length > 80 ? '…' : ''}</div>
                </button>
            `).join('')}
        </div>
    `;
    showModal(modalContent);
}

async function submitShareNoteToDM(noteIndex) {
    const note = AppState.notes[noteIndex];
    if (!note) return;

    await deliverDMMessage({ type: 'note', reference: note.reference || 'Note', content: note.text || '' });
    closeModal();
}

async function shareReflectionToDM() {
    const reflection = AppState.todayReflection || await getDailyReflection();
    await deliverDMMessage({ type: 'reflection', content: reflection });
    showToast('Reflection shared', 'success');
}

function sharePlanToDM() {
    if (AppState.plannerData.length === 0) {
        showToast('You have no study plans to share yet', 'warning');
        return;
    }

    const modalContent = `
        <h3 style="margin-bottom: 16px;">Share a Plan</h3>
        <div style="display: grid; gap: 8px;">
            ${AppState.plannerData.map((plan, i) => `
                <button class="btn btn-outline btn-block" onclick="submitSharePlanToDM(${i})">
                    ${escapeHtml(plan.name || plan.title || plan.planType || 'Study Plan')}
                </button>
            `).join('')}
        </div>
    `;
    showModal(modalContent);
}

async function submitSharePlanToDM(planIndex) {
    const plan = AppState.plannerData[planIndex];
    if (!plan) return;

    const fields = { type: 'plan', content: plan.name || plan.title || plan.planType || 'Study Plan' };
    // Lets the other person open the plan and adopt it.
    const planShareId = typeof savePlanShareSnapshot === 'function' ? savePlanShareSnapshot(plan) : null;
    if (planShareId) fields.planShareId = planShareId;
    await deliverDMMessage(fields);
    closeModal();
}

/* ---- Devotional streaks (Snapchat-style) ----
   A streak day is only "completed" once BOTH participants in a DM have
   shared something devotional (a verse, a note, or a reflection) on that
   calendar date. Consecutive completed days increase the streak; a missed
   day resets it. Milestones get a little celebration to keep it fun and
   worth coming back for. */
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}

function getYesterdayDateString() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 365];

async function updateDMStreak(conversationId, uid, otherUid) {
    const streakRef = database.ref(`dmConversations/${conversationId}/streak`);
    let previousCount = 0;

    try {
        const result = await streakRef.transaction(current => {
            const today = getTodayDateString();
            const yesterday = getYesterdayDateString();
            const streak = current || { count: 0, lastCompletedDate: null, activeDates: {} };
            previousCount = streak.count || 0;
            streak.activeDates = streak.activeDates || {};
            streak.activeDates[uid] = today;

            const otherActiveToday = streak.activeDates[otherUid] === today;
            if (otherActiveToday && streak.lastCompletedDate !== today) {
                streak.count = streak.lastCompletedDate === yesterday ? (streak.count || 0) + 1 : 1;
                streak.lastCompletedDate = today;
                streak.longest = Math.max(streak.longest || 0, streak.count);
            }
            return streak;
        });

        const count = result.committed ? (result.snapshot.val()?.count || 0) : 0;

        // Denormalize into both users' conversation indexes for fast list rendering.
        await database.ref(`users/${uid}/dmIndex/${otherUid}/streak`).set(count);
        await database.ref(`users/${otherUid}/dmIndex/${uid}/streak`).set(count);

        if (count > previousCount && STREAK_MILESTONES.includes(count)) {
            const name = AppState.currentDMUserName || 'your Brethren';
            showToast(`🔥 ${count}-day streak with ${name}! Keep it going.`, 'success');
            await addNotification(otherUid, {
                type: 'streak_milestone',
                fromUid: uid,
                fromName: AppState.userProfile?.username || 'A Brethren',
                message: `🔥 You and ${AppState.userProfile?.username || 'a Brethren'} hit a ${count}-day streak!`
            });
        }

        return count;
    } catch (error) {
        console.error('Error updating streak:', error);
        return null;
    }
}

/* ============================================
   PROFILE PAGE
   ============================================ */
function renderProfilePage() {
    if (!AppState.currentUser) {
        DOM.pageContainer.innerHTML = `
            <div class="text-center" style="padding: 60px 24px;">
                <div class="empty-state-icon" style="margin: 0 auto 16px;">
                    <i class="fas fa-user"></i>
                </div>
                <h3 style="margin-bottom: 8px;">You're browsing as a guest</h3>
                <p class="text-muted" style="margin-bottom: 24px;">Sign in to set up your profile, save your progress, and connect with others.</p>
                <button class="btn btn-primary" onclick="showAuthModal({message: 'Sign in to set up your profile.'})">
                    <i class="fas fa-right-to-bracket"></i> Sign In / Create Account
                </button>
            </div>
        `;
        return;
    }
    
    const profile = AppState.userProfile || {};
    const brethrenCount = Array.from(AppState.userConnections.values()).filter(s => s === 'brethren').length;

    DOM.pageContainer.innerHTML = `
        <div class="profile-container">
            <div class="profile-header">
                <div class="profile-avatar" style="position: relative; cursor: pointer;" onclick="triggerAvatarUpload()">
                    ${profile.avatar ? `<img src="${profile.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">` : (profile.username?.[0]?.toUpperCase() || 'U')}
                    <div class="avatar-spirit" id="my-spirit-sticker"></div>
                </div>
                <button class="btn btn-sm btn-outline mt-2" onclick="triggerAvatarUpload()">
                    <i class="fas fa-camera"></i> Change Photo
                </button>
                <h2 style="font-weight: 700; margin-top: 8px;">${escapeHtml(profile.username || 'User')}</h2>
                <p style="color: var(--text-slate);">${escapeHtml(profile.bio || 'No bio yet')}</p>
                
                <div class="profile-stats">
                    <div class="profile-stat" style="cursor: pointer;" onclick="showBrethrenListModal()">
                        <div class="profile-stat-value">${brethrenCount}</div>
                        <div class="profile-stat-label">Brethren</div>
                    </div>
                    <div class="profile-stat" style="cursor: pointer;" onclick="showMyPostsModal()">
                        <div class="profile-stat-value" id="profile-posts-count">${AppState.spacePostCount ?? '—'}</div>
                        <div class="profile-stat-label">Posts</div>
                    </div>
                    <div class="profile-stat">
                        <div class="profile-stat-value">${AppState.spaceStreak?.count || 0}</div>
                        <div class="profile-stat-label">Streak</div>
                    </div>
                </div>
            </div>
            
            <div class="flex gap-2 mb-4" style="justify-content: center;">
                <button class="btn btn-outline btn-sm" onclick="editProfile()">
                    <i class="fas fa-edit"></i> Edit Profile
                </button>
                <button class="btn btn-outline btn-sm" onclick="showUserBible()">
                    <i class="fas fa-book-bible"></i> My Bible
                </button>
                <button class="btn btn-outline btn-sm" onclick="shareProfileCard()">
                    <i class="fas fa-share"></i> Share
                </button>
            </div>

            <!-- Spirit Life: the three daily streaks averaged into points and a title -->
            ${typeof faithCardHTML === 'function' ? faithCardHTML() : ''}

            <!-- Your Journey (moved from Home — sits just before Recent Activity) -->
            <div class="card mb-3">
                <h3 style="font-weight: 700; margin-bottom: 16px;">Your Journey</h3>
                <div class="flex gap-2" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                    <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                        <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${AppState.readingHistory.length || 0}</div>
                        <div style="font-size: 11px; color: var(--text-slate);">Chapters Read</div>
                    </div>
                    <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                        <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${AppState.bookmarks.length || 0}</div>
                        <div style="font-size: 11px; color: var(--text-slate);">Bookmarks</div>
                    </div>
                    <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                        <div style="font-size: 28px; font-weight: 800; color: var(--primary-deep-olive);">${AppState.notes.length || 0}</div>
                        <div style="font-size: 11px; color: var(--text-slate);">Notes</div>
                    </div>
                </div>
            </div>

            <div class="card mb-3" id="profile-quiz-card">
                <h3 style="font-weight: 700; margin-bottom: 16px;"><i class="fas fa-trophy"></i> Quiz Performance</h3>
                <div class="skeleton" style="height: 70px; border-radius: 12px;"></div>
            </div>

            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 16px;">Recent Activity</h3>
                ${AppState.readingHistory.length > 0 ? `
                    ${AppState.readingHistory.slice(-5).reverse().map(entry => `
                        <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                            <span>${entry.book} ${entry.chapter}</span>
                            <span style="font-size: 12px; color: var(--text-slate);">${formatDate(entry.timestamp)}</span>
                        </div>
                    `).join('')}
                ` : `
                    <p class="text-center text-muted">No reading activity yet</p>
                `}
            </div>
            
            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 16px;">My Bookmarks</h3>
                ${AppState.bookmarks.length > 0 ? `
                    ${AppState.bookmarks.map((bookmark, index) => ({ bookmark, index })).slice(-5).reverse().map(({ bookmark, index }) => `
                        <div class="p-2 profile-item" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                            <div class="profile-item-main" onclick="openBookmark('${escapeHtml(bookmark.reference || '').replace(/'/g, "\\'")}')">
                                <div style="font-weight: 600;">${escapeHtml(bookmark.reference)}</div>
                                ${bookmark.text ? `<div style="font-size: 12px; color: var(--text-slate);">${truncate(escapeHtml(bookmark.text), 80)}</div>` : ''}
                                ${bookmark.note ? `<div class="profile-item-note"><i class="fas fa-pen"></i> ${truncate(escapeHtml(bookmark.note), 90)}</div>` : ''}
                            </div>
                            <div class="profile-item-actions">
                                <button class="icon-btn" title="Edit" aria-label="Edit bookmark" onclick="editProfileBookmark(${index})"><i class="fas fa-pen"></i></button>
                                <button class="icon-btn" title="Delete" aria-label="Delete bookmark" onclick="deleteProfileItem('bookmarks', ${index})"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
                ` : `
                    <p class="text-center text-muted">No bookmarks yet</p>
                `}
            </div>

            <div class="card">
                <h3 style="font-weight: 600; margin-bottom: 16px;">My Notes</h3>
                ${AppState.notes.length > 0 ? `
                    ${AppState.notes.map((note, index) => ({ note, index })).slice(-5).reverse().map(({ note, index }) => `
                        <div class="p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                            <div style="display: flex; align-items: flex-start; gap: 8px; justify-content: space-between;">
                                <div style="flex: 1; min-width: 0; cursor: pointer;" onclick="viewProfileNote('${escapeHtml(note.reference).replace(/'/g, "\\'")}', '${escapeHtml(note.text || '').replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">
                                    <div style="font-weight: 600;">${escapeHtml(note.reference)}</div>
                                    ${note.text ? `<div style="font-size: 12px; color: var(--text-slate); margin-top: 4px;">${truncate(escapeHtml(note.text), 80)}</div>` : ''}
                                </div>
                                <button class="btn btn-outline btn-sm" title="Share to Space" onclick="shareNoteToSpace('${escapeHtml(note.reference).replace(/'/g, "\\'")}', '${escapeHtml(note.text || '').replace(/'/g, "\\'").replace(/\n/g, '\\n')}')" style="flex-shrink: 0; padding: 6px 10px;">
                                    <i class="fas fa-share"></i>
                                </button>
                                <button class="icon-btn" title="Edit" aria-label="Edit note" onclick="editProfileNote(${index})"><i class="fas fa-pen"></i></button>
                                <button class="icon-btn" title="Delete" aria-label="Delete note" onclick="deleteProfileItem('notes', ${index})"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                    `).join('')}
                ` : `
                    <p class="text-center text-muted">No notes yet</p>
                `}
            </div>
        </div>
    `;

    // Post count isn't kept in AppState continuously (only Space page
    // loads know it), so fetch it lazily and fill in the stat once ready
    // rather than blocking the whole profile render on a query.
    fetchMySpacePostCount();
    fetchAndRenderMyQuizStats();
}

/* ---- Editing and deleting my notes and bookmarks from the profile page ----
   Both are saved as whole lists (users/{uid}/notes, users/{uid}/bookmarks),
   the same way the Bible reader saves them, so the two stay in step. */
async function saveProfileList(kind, next, previous, doneMessage) {
    AppState[kind] = next;
    try {
        await database.ref(`users/${AppState.currentUser.uid}/${kind}`).set(next);
        closeModal();
        showToast(doneMessage, 'success');
    } catch (error) {
        console.error(`Error saving ${kind}:`, error);
        AppState[kind] = previous; // put it back: nothing was saved
        showToast('Could not save — please try again.', 'error');
    }
    if (AppState.currentRoute === 'profile') renderProfilePage();
}

function editProfileNote(index) {
    const note = AppState.notes[index];
    if (!note || !AppState.currentUser) return;
    showModal(`
        <h3 style="margin-bottom: 4px;">Edit note</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 12px;"><i class="fas fa-book-bible"></i> ${escapeHtml(note.reference || '')}</p>
        <textarea id="profile-note-text" class="form-textarea" rows="6" maxlength="4000">${escapeHtml(note.text || '')}</textarea>
        <div class="stack-buttons mt-3">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="profile-note-save">Save</button>
        </div>
    `);
    document.getElementById('profile-note-save').onclick = () => {
        const text = document.getElementById('profile-note-text').value.trim();
        if (!text) { showToast('A note can’t be empty — delete it instead.', 'warning'); return; }
        const previous = AppState.notes;
        saveProfileList('notes', previous.map((n, i) => i === index ? { ...n, text, updatedAt: Date.now() } : n), previous, 'Note updated');
    };
}

/** A bookmark is a saved verse; what can be edited is your own note on it. */
function editProfileBookmark(index) {
    const bookmark = AppState.bookmarks[index];
    if (!bookmark || !AppState.currentUser) return;
    showModal(`
        <h3 style="margin-bottom: 4px;">Edit bookmark</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 12px;"><i class="fas fa-bookmark"></i> ${escapeHtml(bookmark.reference || '')}</p>
        <label class="form-label" for="profile-bookmark-note">Why you saved it (optional)</label>
        <textarea id="profile-bookmark-note" class="form-textarea" rows="4" maxlength="600" placeholder="A few words to remember it by">${escapeHtml(bookmark.note || '')}</textarea>
        <div class="stack-buttons mt-3">
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" id="profile-bookmark-save">Save</button>
        </div>
    `);
    document.getElementById('profile-bookmark-save').onclick = () => {
        const note = document.getElementById('profile-bookmark-note').value.trim();
        const previous = AppState.bookmarks;
        saveProfileList('bookmarks', previous.map((b, i) => {
            if (i !== index) return b;
            const next = { ...b, updatedAt: Date.now() };
            if (note) next.note = note; else delete next.note;
            return next;
        }), previous, 'Bookmark updated');
    };
}

function deleteProfileItem(kind, index) {
    const item = AppState[kind][index];
    if (!item || !AppState.currentUser) return;
    const what = kind === 'notes' ? 'note' : 'bookmark';
    showModal(`
        <h3 style="margin-bottom: 8px;">Delete this ${what}?</h3>
        <p class="text-muted" style="margin-bottom: 16px;">${escapeHtml(item.reference || '')}${kind === 'notes' && item.text ? ` — “${truncate(escapeHtml(item.text), 70)}”` : ''}<br>This can’t be undone.</p>
        <div class="stack-buttons">
            <button class="btn btn-outline" onclick="closeModal()">Keep it</button>
            <button class="btn btn-accent" id="profile-item-delete">Delete</button>
        </div>
    `);
    document.getElementById('profile-item-delete').onclick = () => {
        const previous = AppState[kind];
        saveProfileList(kind, previous.filter((_, i) => i !== index), previous, what === 'note' ? 'Note deleted' : 'Bookmark deleted');
    };
}

function viewProfileNote(reference, text) {
    showModal(`
        <h3 style="margin-bottom: 4px;">${escapeHtml(reference)}</h3>
        <p class="text-muted" style="font-size: 12px; margin-bottom: 16px;"><i class="fas fa-book-bible"></i> ${escapeHtml(reference)}</p>
        <div style="background: rgba(48,72,58,0.06); padding: 12px; border-radius: 10px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;">
            ${escapeHtml(text || '')}
        </div>
        <button class="btn btn-outline btn-sm btn-block mt-3" onclick="shareNoteToSpace('${reference.replace(/'/g, "\\'")}', '${text.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">
            <i class="fas fa-share"></i> Share to Space
        </button>
    `);
}

async function shareNoteToSpace(reference, text) {
    if (!requireAuth('Sign in to share notes.')) return;

    closeModal();
    showModal(`
        <h3 style="margin-bottom: 12px;">Share Note to Space</h3>
        <div style="background: rgba(48,72,58,0.06); padding: 12px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; line-height: 1.5;">
            <strong>${escapeHtml(reference)}</strong>
            <div style="margin-top: 8px; white-space: pre-wrap; color: var(--text-slate);">
                ${truncate(escapeHtml(text), 200)}
            </div>
        </div>
        <textarea id="share-note-caption" class="form-input" placeholder="Add a caption (optional)..." style="height: 80px; resize: vertical;"></textarea>
        <div style="margin-top: 12px; display: flex; gap: 8px;">
            <button class="btn btn-primary btn-block" onclick="submitSharedNote('${reference.replace(/'/g, "\\'")}', '${text.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')">
                <i class="fas fa-paper-plane"></i> Share
            </button>
            <button class="btn btn-outline btn-block" onclick="closeModal()">Cancel</button>
        </div>
    `);
}

async function submitSharedNote(reference, text) {
    if (!AppState.currentUser) return;

    const caption = document.getElementById('share-note-caption')?.value.trim() || '';
    const postContent = caption
        ? `${caption}\n\n"${text}"`
        : `My note on ${reference}:\n\n"${text}"`;

    // Reuse the same reference parser the rest of the app uses so the
    // "Read Chapter" quick-jump button on the resulting card points to
    // the right place — sourceBook must be just the book name (e.g.
    // "John"), not the full "John 3:16" reference string.
    const parsed = typeof parsePassageReference === 'function' ? parsePassageReference(reference) : null;

    const post = {
        id: generateId(),
        authorId: AppState.currentUser.uid,
        authorName: AppState.userProfile?.username || 'Anonymous',
        timestamp: Date.now(),
        type: 'note',
        content: postContent,
        slides: [],
        sourceBook: parsed?.book || null,
        sourceChapter: parsed?.chapter || null,
        videoUrl: null,
        planName: null,
        tags: [],
        amens: {},
        saves: {},
        comments: {}
    };

    try {
        await database.ref(`spacePosts/${post.id}`).set(post);
        if (post.sourceBook && typeof recordInterestSignal === 'function') recordInterestSignal('book', post.sourceBook, 2);
        if (typeof bumpSpaceStreak === 'function') await bumpSpaceStreak();
        showToast('Note shared to Space!', 'success');
        closeModal();
    } catch (error) {
        console.error('Error sharing note:', error);
        showToast('Could not share note. Please try again.', 'error');
    }
}

/** Loads this user's quiz history (per-round scores) and their all-time
    aggregate (accumulated percentage, tie-break time) and fills in the
    "Quiz Performance" card on their own profile page. Lazy/async for the
    same reason fetchMySpacePostCount() is — no need to block the rest of
    the profile on it. */
async function fetchAndRenderMyQuizStats() {
    if (!AppState.currentUser) return;
    const card = document.getElementById('profile-quiz-card');
    if (!card) return;
    const uid = AppState.currentUser.uid;

    try {
        const [historySnap, allTimeSnap] = await Promise.all([
            database.ref(`users/${uid}/quizHistory`).once('value'),
            database.ref(`quizLeaderboardAllTime/${uid}`).once('value')
        ]);

        // Page may have navigated away while this loaded.
        if (!document.getElementById('profile-quiz-card')) return;

        const history = Object.values(historySnap.val() || {}).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
        const allTime = allTimeSnap.val();

        if (history.length === 0) {
            card.innerHTML = `
                <h3 style="font-weight: 700; margin-bottom: 12px;"><i class="fas fa-trophy"></i> Quiz Performance</h3>
                <p class="text-center text-muted">You haven't taken a Weekly Bible Quiz yet — check Home for the next round.</p>
            `;
            return;
        }

        card.innerHTML = `
            <h3 style="font-weight: 700; margin-bottom: 16px;"><i class="fas fa-trophy"></i> Quiz Performance</h3>
            <div class="profile-quiz-stats-grid mb-3">
                <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 24px; font-weight: 800; color: var(--primary-deep-olive);">${allTime?.totalQuizzes ?? history.length}</div>
                    <div style="font-size: 11px; color: var(--text-slate);">Quizzes Taken</div>
                </div>
                <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 24px; font-weight: 800; color: var(--primary-deep-olive);">${allTime?.accumulatedPercentage ?? 0}%</div>
                    <div style="font-size: 11px; color: var(--text-slate);">Accumulated Score</div>
                </div>
                <div class="text-center" style="background: rgba(48,72,58,0.08); padding: 16px; border-radius: 12px;">
                    <div style="font-size: 24px; font-weight: 800; color: var(--primary-deep-olive);">${allTime?.totalScore ?? 0}/${allTime?.totalPossible ?? 0}</div>
                    <div style="font-size: 11px; color: var(--text-slate);">Total Points</div>
                </div>
            </div>
            <div>
                <h4 style="font-size: 13px; font-weight: 700; color: var(--text-slate); margin-bottom: 4px;">Round History</h4>
                ${history.slice(0, 10).map(h => `
                    <div class="profile-quiz-history-row">
                        <span class="profile-quiz-history-date">${formatDate(h.submittedAt)}</span>
                        <span class="profile-quiz-history-score">${h.score}/${h.total} <span style="font-weight:400; color:var(--text-slate);">(${h.percentage}%)</span></span>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (error) {
        console.error('Error loading quiz stats:', error);
        card.innerHTML = `
            <h3 style="font-weight: 700; margin-bottom: 12px;"><i class="fas fa-trophy"></i> Quiz Performance</h3>
            <p class="text-center text-muted">Couldn't load your quiz history right now.</p>
        `;
    }
}

/** Queries how many Space posts the signed-in user has authored and
    updates both AppState (so it doesn't need refetching this session)
    and the profile stat if it's currently on screen. */
async function fetchMySpacePostCount() {
    if (!AppState.currentUser) return;
    try {
        const snapshot = await database.ref('spacePosts').orderByChild('authorId').equalTo(AppState.currentUser.uid).once('value');
        const posts = snapshot.val() || {};
        AppState.spacePostCount = Object.keys(posts).length;
        const el = document.getElementById('profile-posts-count');
        if (el) el.textContent = AppState.spacePostCount;
    } catch (error) {
        console.error('Error fetching post count:', error);
    }
}

/** Shows every Brethren (accepted connection) the user has, each
    tappable straight through to their profile. */
async function showBrethrenListModal() {
    if (!requireAuth('Sign in to view your Brethren.')) return;

    showModal(`
        <h3 style="margin-bottom: 16px;">Brethren</h3>
        <div id="brethren-list-body">
            <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        </div>
    `);

    try {
        const uid = AppState.currentUser.uid;
        const snapshot = await database.ref(`users/${uid}/connections`).once('value');
        const connections = snapshot.val() || {};
        const brethren = Object.entries(connections)
            .filter(([, info]) => info && info.status === 'accepted')
            .map(([otherUid, info]) => ({ otherUid, name: info.name || 'A GraceGuide member' }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const body = document.getElementById('brethren-list-body');
        if (!body) return; // modal was closed before this resolved

        body.innerHTML = brethren.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:4px; max-height: 400px; overflow-y:auto;">
                ${brethren.map(b => `
                    <div class="flex items-center gap-2 p-2" style="cursor:pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeModalThen(() => viewUserProfile('${b.otherUid}', '${escapeHtml(b.name).replace(/'/g, "\\'")}'))">
                        <div class="post-avatar comment-avatar" style="width:40px;height:40px;">${escapeHtml(b.name)[0]?.toUpperCase() || 'U'}</div>
                        <div style="flex:1; min-width:0; font-weight:600;">${escapeHtml(b.name)}</div>
                        <i class="fas fa-chevron-right" style="color: var(--text-slate);"></i>
                    </div>
                `).join('')}
            </div>
        ` : `<p class="text-center text-muted">No Brethren yet — connect with someone from their profile to start.</p>`;
    } catch (error) {
        console.error('Error loading Brethren list:', error);
        const body = document.getElementById('brethren-list-body');
        if (body) body.innerHTML = `<p class="text-center text-muted">Couldn't load your Brethren list.</p>`;
    }
}

/** Shows every Space post the user has authored/shared, each tappable
    straight through to that post in the Space feed. */
async function showMyPostsModal() {
    if (!requireAuth('Sign in to view your posts.')) return;

    showModal(`
        <h3 style="margin-bottom: 16px;">My Posts</h3>
        <div id="my-posts-list-body">
            <div class="skeleton" style="height: 60px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="height: 60px; margin-bottom: 8px;"></div>
        </div>
    `);

    try {
        const uid = AppState.currentUser.uid;
        const snapshot = await database.ref('spacePosts').orderByChild('authorId').equalTo(uid).once('value');
        const posts = Object.values(snapshot.val() || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        AppState.spacePostCount = posts.length;
        const countEl = document.getElementById('profile-posts-count');
        if (countEl) countEl.textContent = posts.length;

        const body = document.getElementById('my-posts-list-body');
        if (!body) return;

        const preview = (post) => {
            if (post.type === 'text' || !post.type) return truncate(escapeHtml(post.content || ''), 90);
            if (post.type === 'note') return truncate(escapeHtml(post.text || post.content || ''), 90);
            if (post.type === 'plan') return `📅 ${escapeHtml(post.planName || post.title || 'Study Plan')}`;
            if (post.type === 'video') return `🎬 ${escapeHtml(post.caption || 'Video')}`;
            return truncate(escapeHtml(post.content || post.text || ''), 90);
        };

        body.innerHTML = posts.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:4px; max-height: 420px; overflow-y:auto;">
                ${posts.map(post => `
                    <div class="p-2" style="cursor:pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeModalThen(() => openSpacePostFromNotification('${post.id}', false))">
                        <div style="font-size: 11px; color: var(--text-slate); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px;">${escapeHtml(post.type || 'post')} • ${formatDate(post.timestamp)}</div>
                        <div>${preview(post)}</div>
                        <div style="font-size: 12px; color: var(--text-slate); margin-top: 4px;"><i class="fas fa-hands-praying"></i> ${Object.keys(post.amens || {}).length} &nbsp; <i class="fas fa-comment"></i> ${Object.keys(post.comments || {}).length}</div>
                    </div>
                `).join('')}
            </div>
        ` : `<p class="text-center text-muted">You haven't posted to Space yet.</p>`;
    } catch (error) {
        console.error('Error loading my posts:', error);
        const body = document.getElementById('my-posts-list-body');
        if (body) body.innerHTML = `<p class="text-center text-muted">Couldn't load your posts.</p>`;
    }
}

/** Same idea as showBrethrenListModal(), but for viewing someone ELSE's
    Brethren list from their profile page — deliberately a separate
    function so the "my own profile" version above is untouched. */
async function showUserBrethrenModal(uid, displayName) {
    if (!requireAuth('Sign in to view Brethren.')) return;

    showModal(`
        <h3 style="margin-bottom: 16px;">${escapeHtml(displayName || 'User')}'s Brethren</h3>
        <div id="brethren-list-body">
            <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="height: 48px; margin-bottom: 8px;"></div>
        </div>
    `);

    try {
        const snapshot = await database.ref(`users/${uid}/connections`).once('value');
        const connections = snapshot.val() || {};
        const brethren = Object.entries(connections)
            .filter(([, info]) => info && info.status === 'accepted')
            .map(([otherUid, info]) => ({ otherUid, name: info.name || 'A GraceGuide member' }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const body = document.getElementById('brethren-list-body');
        if (!body) return; // modal was closed before this resolved

        body.innerHTML = brethren.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:4px; max-height: 400px; overflow-y:auto;">
                ${brethren.map(b => `
                    <div class="flex items-center gap-2 p-2" style="cursor:pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeModalThen(() => viewUserProfile('${b.otherUid}', '${escapeHtml(b.name).replace(/'/g, "\\'")}'))">
                        <div class="post-avatar comment-avatar" style="width:40px;height:40px;">${escapeHtml(b.name)[0]?.toUpperCase() || 'U'}</div>
                        <div style="flex:1; min-width:0; font-weight:600;">${escapeHtml(b.name)}</div>
                        <i class="fas fa-chevron-right" style="color: var(--text-slate);"></i>
                    </div>
                `).join('')}
            </div>
        ` : `<p class="text-center text-muted">No Brethren yet.</p>`;
    } catch (error) {
        console.error('Error loading Brethren list:', error);
        const body = document.getElementById('brethren-list-body');
        if (body) body.innerHTML = `<p class="text-center text-muted">Couldn't load this Brethren list.</p>`;
    }
}

/** Same idea as showMyPostsModal(), but for viewing someone ELSE's Space
    posts from their profile page — deliberately a separate function so
    the "my own profile" version above is untouched. */
async function showUserPostsModal(uid, displayName) {
    if (!requireAuth('Sign in to view posts.')) return;

    showModal(`
        <h3 style="margin-bottom: 16px;">${escapeHtml(displayName || 'User')}'s Posts</h3>
        <div id="user-posts-list-body">
            <div class="skeleton" style="height: 60px; margin-bottom: 8px;"></div>
            <div class="skeleton" style="height: 60px; margin-bottom: 8px;"></div>
        </div>
    `);

    try {
        const snapshot = await database.ref('spacePosts').orderByChild('authorId').equalTo(uid).once('value');
        const posts = Object.values(snapshot.val() || {}).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const body = document.getElementById('user-posts-list-body');
        if (!body) return;

        const preview = (post) => {
            if (post.type === 'text' || !post.type) return truncate(escapeHtml(post.content || ''), 90);
            if (post.type === 'note') return truncate(escapeHtml(post.text || post.content || ''), 90);
            if (post.type === 'plan') return `📅 ${escapeHtml(post.planName || post.title || 'Study Plan')}`;
            if (post.type === 'video') return `🎬 ${escapeHtml(post.caption || 'Video')}`;
            return truncate(escapeHtml(post.content || post.text || ''), 90);
        };

        body.innerHTML = posts.length > 0 ? `
            <div style="display:flex; flex-direction:column; gap:4px; max-height: 420px; overflow-y:auto;">
                ${posts.map(post => `
                    <div class="p-2" style="cursor:pointer; border-bottom: 1px solid rgba(0,0,0,0.06);" onclick="closeModalThen(() => openSpacePostFromNotification('${post.id}', false))">
                        <div style="font-size: 11px; color: var(--text-slate); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px;">${escapeHtml(post.type || 'post')} • ${formatDate(post.timestamp)}</div>
                        <div>${preview(post)}</div>
                        <div style="font-size: 12px; color: var(--text-slate); margin-top: 4px;"><i class="fas fa-hands-praying"></i> ${Object.keys(post.amens || {}).length} &nbsp; <i class="fas fa-comment"></i> ${Object.keys(post.comments || {}).length}</div>
                    </div>
                `).join('')}
            </div>
        ` : `<p class="text-center text-muted">${escapeHtml(displayName || 'This user')} hasn't posted to Space yet.</p>`;
    } catch (error) {
        console.error('Error loading user posts:', error);
        const body = document.getElementById('user-posts-list-body');
        if (body) body.innerHTML = `<p class="text-center text-muted">Couldn't load these posts.</p>`;
    }
}

function editProfile() {
    const profile = AppState.userProfile || {};
    
    const modalContent = `
        <h3 style="margin-bottom: 16px;">Edit Profile</h3>
        
        <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" id="edit-username" class="form-input" value="${escapeHtml(profile.username || '')}">
        </div>
        
        <div class="form-group">
            <label class="form-label">Bio</label>
            <textarea id="edit-bio" class="form-textarea" rows="3">${escapeHtml(profile.bio || '')}</textarea>
        </div>
        
        <button id="save-profile-btn" class="btn btn-primary btn-block mt-3">Save Changes</button>
    `;
    
    showModal(modalContent);
    
    $('#save-profile-btn').addEventListener('click', async () => {
        const username = $('#edit-username').value.trim();
        const bio = $('#edit-bio').value.trim();
        
        if (!username) {
            showToast('Username is required', 'warning');
            return;
        }
        
        if (!AppState.currentUser) return;
        
        try {
            await database.ref(`users/${AppState.currentUser.uid}/profile`).update({
                username,
                bio
            });
            // Keep the admin directory in step (best-effort).
            database.ref(`userDirectory/${AppState.currentUser.uid}/username`).set(username).catch(() => {});
            setTimeout(() => { if (typeof syncPublicProfile === 'function') syncPublicProfile(); }, 0);

            AppState.userProfile = {
                ...AppState.userProfile,
                username,
                bio
            };
            // Posts/comments/messages resolve names live from the profile,
            // so everything this user has ever written now shows the new name.
            UserNameCache.names.set(AppState.currentUser.uid, username);
            UserNameCache.fetchedAt.set(AppState.currentUser.uid, Date.now());
            
            closeModal();
            showToast('Profile updated!', 'success');
            updateProfileNavIcon();
            renderProfilePage();
        } catch (error) {
            showToast('Failed to update profile', 'error');
        }
    });
}

/* ---- Profile photo upload ---- */
function triggerAvatarUpload() {
    if (!requireAuth('Sign in to upload a profile photo.', triggerAvatarUpload)) return;

    let fileInput = document.getElementById('avatar-file-input');
    if (!fileInput) {
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.id = 'avatar-file-input';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        fileInput.addEventListener('change', handleAvatarFileSelected);
    }
    fileInput.value = '';
    fileInput.click();
}

async function handleAvatarFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'warning');
        return;
    }

    showToast('Uploading photo…', 'success');

    try {
        const resizedBlob = await resizeImageFile(file, 320);
        const uid = AppState.currentUser.uid;
        const storageRef = storage.ref(`avatars/${uid}.jpg`);
        await storageRef.put(resizedBlob);
        const url = await storageRef.getDownloadURL();

        await database.ref(`users/${uid}/profile/avatar`).set(url);
        AppState.userProfile = { ...AppState.userProfile, avatar: url };

        updateProfileNavIcon();
        renderProfilePage();
        showToast('Profile photo updated!', 'success');
    } catch (error) {
        console.error('Avatar upload error:', error);
        showToast('Failed to upload photo', 'error');
    }
}

function resizeImageFile(file, maxSize) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else if (height >= width && height > maxSize) {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob); else reject(new Error('Canvas toBlob failed'));
                }, 'image/jpeg', 0.85);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showUserBible() {
    navigateTo('bible');
}

function openBookmark(reference) {
    // Parse reference to open Bible
    const parts = reference.split(' ');
    if (parts.length >= 2) {
        const book = parts.slice(0, -1).join(' ');
        const chapter = parseInt(parts[parts.length - 1].split(':')[0]);
        openBibleChapter(book, chapter);
    }
}

/* ============================================
   TALK TO SOMEONE (Safety & Support)
   ============================================ */
function renderTalkToSomeonePage() {
    DOM.pageContainer.innerHTML = `
        <div class="talk-to-someone-container">
            <div class="talk-to-someone-hero">
                <div class="talk-to-someone-hero-icon"><i class="fas fa-hand-holding-heart"></i></div>
                <h2 style="font-weight: 700; margin-bottom: 8px;">Talk to Someone</h2>
                <p style="color: var(--text-slate); line-height: 1.6;">
                    If you're going through something heavy — a mental health crisis, abuse, grief, or anything you shouldn't carry alone —
                    a real person is ready to listen. Pastors, Christian counselors, and trained mentors are on the other end of this.
                </p>
            </div>

            <div class="card">
                <div class="form-group">
                    <label class="form-label">Who would you feel most comfortable talking to?</label>
                    <select id="tts-gender-pref" class="form-select">
                        <option value="no preference">No preference</option>
                        <option value="a male">A male counselor</option>
                        <option value="a female">A female counselor</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">What kind of support are you looking for?</label>
                    <select id="tts-role-pref" class="form-select">
                        <option value="a pastor">Pastor</option>
                        <option value="a Christian counselor">Christian Counselor</option>
                        <option value="a mentor">Mentor</option>
                        <option value="anyone available">Anyone available</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Anything you'd like them to know before you connect? (optional)</label>
                    <textarea id="tts-note" class="form-textarea" rows="3" placeholder="Briefly, in your own words..."></textarea>
                </div>

                <button id="tts-proceed-btn" class="btn btn-primary btn-block mt-3">
                    <i class="fab fa-whatsapp"></i> Proceed to WhatsApp
                </button>
                <p style="font-size: 12px; color: var(--text-slate); text-align:center; margin-top: 10px;">
                    You'll be connected over WhatsApp. If you have a recent conversation with Shepherd, a short summary and reference link will be included so you don't have to repeat yourself.
                </p>
            </div>

            <div class="card mt-3" style="text-align:center;">
                <p style="font-size: 13px; color: var(--text-slate); margin-bottom: 4px;">In immediate danger or having thoughts of suicide?</p>
                <p style="font-weight: 700;">Please contact your local emergency number or a crisis line right away.</p>
            </div>
        </div>
    `;

    $('#tts-proceed-btn').addEventListener('click', proceedToTalkToSomeone);
}

/** WhatsApp line for Talk to Someone — set by admins in admin.html → App
    Settings (appConfig/talkToSomeoneWhatsApp). */
async function getTalkToSomeoneWhatsAppNumber() {
    try {
        const snap = await database.ref('appConfig/talkToSomeoneWhatsApp').once('value');
        const digits = String(snap.val() || '').replace(/\D/g, '');
        return digits.length >= 7 ? digits : null;
    } catch (error) {
        console.error('Error loading Talk to Someone number:', error);
        return null;
    }
}

async function proceedToTalkToSomeone() {
    const whatsappNumber = await getTalkToSomeoneWhatsAppNumber();
    if (!whatsappNumber) {
        showToast("This support line isn't available right now — please email support@graceguide.com.ng.", 'warning');
        return;
    }
    const genderPref = $('#tts-gender-pref')?.value || 'no preference';
    const rolePref = $('#tts-role-pref')?.value || 'anyone available';
    const note = $('#tts-note')?.value.trim();

    const lines = [
        `Hi, I'm using GraceGuide and would like to talk to ${rolePref}${genderPref !== 'no preference' ? ` (preferably ${genderPref})` : ''}.`
    ];

    if (note) {
        lines.push(`A note from me: "${note}"`);
    }

    // Include a short excerpt of the Shepherd conversation the user was having,
    // so the person on the other end has context without the user repeating themselves.
    const recentMessages = (AppState.aiChatHistory || []).slice(-4);
    if (recentMessages.length > 0) {
        const excerpt = recentMessages
            .map(m => `${m.role === 'user' ? 'Me' : 'Shepherd'}: ${truncate(m.content || '', 140)}`)
            .join('\n');
        lines.push(`Here's a bit of what I was just discussing with Shepherd:\n${excerpt}`);
    }

    const siteUrl = window.location.origin + window.location.pathname;
    if (AppState.currentConversationId) {
        lines.push(`Reference: ${siteUrl}#/ask (conversation ${AppState.currentConversationId})`);
    }

    const message = lines.join('\n\n');
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
}


function renderSettingsPage() {
    DOM.pageContainer.innerHTML = `
        <div class="planner-container">
            <h2 style="font-weight: 700; margin-bottom: 24px;">Settings</h2>
            
            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 16px;">Appearance</h3>
                
                <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                    <div>
                        <div style="font-weight: 600;">Dark Mode</div>
                        <div style="font-size: 12px; color: var(--text-slate);">Switch between light and dark theme</div>
                    </div>
                    <button class="btn btn-outline btn-sm" onclick="toggleTheme()">
                        ${AppState.currentTheme === 'dark' ? '<i class="fas fa-sun"></i> Light' : '<i class="fas fa-moon"></i> Dark'}
                    </button>
                </div>
                
                <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                    <div>
                        <div style="font-weight: 600;">Bible Font Size</div>
                        <div style="font-size: 12px; color: var(--text-slate);">Adjust reading font size</div>
                    </div>
                    <button class="btn btn-outline btn-sm" onclick="showFontSizeOptions()">
                        <i class="fas fa-font"></i> Font
                    </button>
                </div>
            </div>
            
            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 4px;">Daily Devotional</h3>
                <p style="font-size: 12px; color: var(--text-slate); margin-bottom: 12px;">How long should your devotional be? It applies from your next devotional.</p>
                <div class="settings-choice" role="radiogroup" aria-label="Devotional length">
                    ${Object.entries(DEVOTIONAL_LENGTHS).map(([key, l]) => `
                        <button class="settings-choice-item ${(getSavedDevotionalLength() || '') === key ? 'active' : ''}" role="radio" aria-checked="${getSavedDevotionalLength() === key}" onclick="setDevotionalLength('${key}')">
                            <strong>${l.label}</strong><small>${l.about}</small>
                        </button>`).join('')}
                </div>
                ${getSavedDevotionalLength() ? '' : '<p style="font-size: 12px; color: var(--text-slate); margin-top: 8px;">Not set yet — Shepherd is choosing for you (Auto).</p>'}
            </div>

            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 4px;">Spirit Life</h3>
                <div class="flex items-center justify-between p-2">
                    <div>
                        <div style="font-weight: 600;">Show my level to Brethren only</div>
                        <div style="font-size: 12px; color: var(--text-slate);">When on, only people you are connected with see your Spirit Life level and badge.</div>
                    </div>
                    <input type="checkbox" id="spirit-private" ${AppState.userProfile?.spiritPrivate ? 'checked' : ''} ${AppState.currentUser ? '' : 'disabled'} onchange="setSpiritPrivate(this.checked)" style="width: 20px; height: 20px; flex-shrink: 0;">
                </div>
            </div>

            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 16px;">Notifications</h3>

                <div class="flex items-center justify-between p-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                    <div>
                        <div style="font-weight: 600;">Push Notifications</div>
                        <div style="font-size: 12px; color: var(--text-slate);">Get notified about connections, amens, comments, chats, forum activity, and your reading streak — even when the app is closed.</div>
                    </div>
                </div>
                <button id="enable-notifications-btn" class="btn btn-outline btn-block mt-2" onclick="enableNotifications()">
                    <i class="fas fa-bell"></i> Enable Notifications
                </button>

                <div class="flex items-center justify-between p-2 mt-2" style="border-bottom: 1px solid rgba(0,0,0,0.06);">
                    <div>
                        <div style="font-weight: 600;">Daily Verse</div>
                        <div style="font-size: 12px; color: var(--text-slate);">Receive daily verse notification</div>
                    </div>
                    <input type="checkbox" id="notif-daily-verse" checked style="width: 20px; height: 20px;">
                </div>
                
                <div class="flex items-center justify-between p-2">
                    <div>
                        <div style="font-weight: 600;">Forum Alerts</div>
                        <div style="font-size: 12px; color: var(--text-slate);">Get notified about forum activity</div>
                    </div>
                    <input type="checkbox" id="notif-community" checked style="width: 20px; height: 20px;">
                </div>
            </div>
            
            <div class="card mb-3">
                <h3 style="font-weight: 600; margin-bottom: 16px;">About</h3>
                <p style="line-height: 1.6; margin-bottom: 8px;">GraceGuide v1.0.0</p>
                <p style="font-size: 12px; color: var(--text-slate);">Your AI Christian Companion</p>
                <button class="btn btn-outline btn-sm btn-block mt-3" onclick="navigateTo('terms')">
                    <i class="fas fa-file-contract"></i> Terms &amp; Conditions
                </button>
            </div>
            
            <div class="card">
                <h3 style="font-weight: 600; margin-bottom: 16px;">Account</h3>
                ${AppState.currentUser && !AppState.currentUser.emailVerified ? `
                    <div class="auth-verify-banner">
                        <i class="fas fa-circle-exclamation" style="color: var(--accent-muted-gold);"></i>
                        <div style="flex:1;">
                            Your email isn't verified yet.
                            <button class="btn btn-sm btn-outline" style="margin-left: 6px;" onclick="resendVerificationEmail()">Resend Email</button>
                        </div>
                    </div>
                ` : ''}
                ${AppState.currentUser ? `
                    <button class="btn btn-accent btn-block" onclick="handleLogout()">
                        <i class="fas fa-sign-out-alt"></i> Sign Out
                    </button>
                ` : `
                    <button class="btn btn-primary btn-block" onclick="showAuthModal({message: 'Sign in to your GraceGuide account.'})">
                        <i class="fas fa-right-to-bracket"></i> Sign In
                    </button>
                `}
            </div>
        </div>
    `;

    if (typeof refreshNotificationSettingsUI === 'function') refreshNotificationSettingsUI();
}

/* ============================================
   NOTIFICATIONS
   ============================================ */
async function loadNotifications() {
    // Kept for compatibility — startRealtimeListeners() now keeps
    // AppState.notifications live, but this is a safe one-shot fallback.
    if (!AppState.currentUser) return;

    try {
        const uid = AppState.currentUser.uid;
        const snapshot = await database.ref(`users/${uid}/notifications`).once('value');
        const raw = snapshot.val() || {};
        AppState.notifications = Object.entries(raw)
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        updateNotificationBadge();
    } catch (error) {
        console.error('Error loading notifications:', error);
    }
}

function updateNotificationBadge() {
    // Request notifications aren't counted twice — the pending request itself is.
    const unreadNotifs = AppState.notifications.filter(n => !n.read && n.type !== 'connection_request').length;
    const pendingRequests = Array.from(AppState.userConnections.values()).filter(s => s === 'pending_received').length;
    const unreadCount = unreadNotifs + pendingRequests;
    if (unreadCount > 0) {
        DOM.notifBadge.classList.remove('hidden');
        DOM.notifBadge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
        DOM.notifBadge.classList.add('hidden');
    }
}

async function addNotification(userId, notification) {
    try {
        await database.ref(`users/${userId}/notifications`).push({
            ...notification,
            read: false,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error adding notification:', error);
    }
}

/* ============================================
   REALTIME INDICATORS
   Notifications, unread chats, and unread forum groups all update live
   via Firebase's .on('value')/.on('child_*') listeners instead of
   requiring a page refresh or re-navigation.
   ============================================ */
let _notifRef = null;
let _dmIndexRef = null;
let _groupsListRef = null;
let _groupMsgRefs = {};
let _notifKnownKeys = new Set();
let _spacePostsRef = null;
const _shownSpacePosts = new Set();

/** Pop-up for someone else's new Space post (once per post, also de-duped with the push). */
function announceNewSpacePost(postId, post) {
    if (!postId || _shownSpacePosts.has(postId)) return;
    _shownSpacePosts.add(postId);
    const me = AppState.currentUser && AppState.currentUser.uid;
    if (!post || !post.authorId || post.authorId === me) return;
    if (AppState.blockedUsers && AppState.blockedUsers.has && AppState.blockedUsers.has(post.authorId)) return;
    if (Date.now() - (post.timestamp || 0) > 30 * 60 * 1000) return;
    if (AppState.currentRoute === 'space') return; // they're already looking at the feed
    const name = getDisplayName(post.authorId, post.authorName || 'Someone');
    const slides = Array.isArray(post.slides) ? post.slides : Object.values(post.slides || {});
    const text = post.type === 'video' ? 'Shared a video — tap to watch.'
        : (slides.map(s => (s && (s.text || s.content)) || '').join(' ').replace(/\s+/g, ' ').trim() || 'Shared something new.');
    if (typeof showInAppNotificationPopup === 'function') {
        showInAppNotificationPopup(`${name} posted in Space`, truncate(text, 140), { url: `/#/space/post/${postId}`, type: 'space_post', postId });
    }
}
window.announceNewSpacePost = announceNewSpacePost;

function startRealtimeListeners() {
    if (!AppState.currentUser) return;
    stopRealtimeListeners();
    const uid = AppState.currentUser.uid;

    // --- Notifications (space amens/comments, connection requests, etc.) ---
    _notifKnownKeys = new Set(AppState.notifications.map(n => n.key));
    // The first snapshot is the existing inbox; only later arrivals are "new"
    // (keying this off an empty inbox used to swallow a new user's first one).
    let notifInitial = true;
    _notifRef = database.ref(`users/${uid}/notifications`);
    _notifRef.on('value', (snapshot) => {
        const raw = snapshot.val() || {};
        const next = Object.entries(raw)
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // Toast for genuinely new, unread notifications that arrive while
        // the app is open (not the initial batch on first load).
        if (!notifInitial) {
            next.forEach(n => {
                // Game invites show their own Accept / Decline card (js/games.js) — no second toast.
                if (!n.read && !_notifKnownKeys.has(n.key) && n.type !== 'game_invite') {
                    showToast(n.message || 'You have a new notification', 'info');
                }
            });
        }
        notifInitial = false;
        _notifKnownKeys = new Set(next.map(n => n.key));

        AppState.notifications = next;
        updateNotificationBadge();
    });

    // --- New Space posts by others → in-app pop-up (the push server covers closed tabs) ---
    let spaceInitial = true;
    _spacePostsRef = database.ref('spacePosts').orderByChild('timestamp').limitToLast(3);
    _spacePostsRef.on('child_added', (snap) => {
        const post = snap.val() || {};
        if (spaceInitial) { _shownSpacePosts.add(snap.key); return; }
        announceNewSpacePost(snap.key, post);
    });
    // child_added fires the existing posts synchronously-ish on attach; anything after this tick is new.
    database.ref('spacePosts').orderByChild('timestamp').limitToLast(3).once('value').then(() => { spaceInitial = false; });

    // --- Unread direct messages ---
    _dmIndexRef = database.ref(`users/${uid}/dmIndex`);
    _dmIndexRef.on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const list = Object.entries(data)
            .map(([otherUid, info]) => ({ otherUid, ...info }))
            .sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));

        AppState.dmConversations = list;
        AppState.unreadChatsCount = list.filter(c => c.unread).length;
        updateChatDrawerBadge();

        // Keep an already-open Chats list in sync live.
        if (AppState.currentRoute === 'messages' && $('#dm-conversations-list')) {
            loadDMConversations();
        }
    });

    // --- Unread forum (group) messages ---
    _groupsListRef = database.ref(`users/${uid}/groups`);
    _groupsListRef.on('value', (snapshot) => {
        const groupIds = Object.keys(snapshot.val() || {});
        attachGroupUnreadListeners(uid, groupIds);
    });
}

function stopRealtimeListeners() {
    if (_notifRef) { _notifRef.off(); _notifRef = null; }
    if (_spacePostsRef) { _spacePostsRef.off(); _spacePostsRef = null; }
    if (_dmIndexRef) { _dmIndexRef.off(); _dmIndexRef = null; }
    if (_groupsListRef) { _groupsListRef.off(); _groupsListRef = null; }
    Object.values(_groupMsgRefs).forEach(ref => ref.off());
    _groupMsgRefs = {};
    _notifKnownKeys = new Set();
    AppState.unreadForumGroupIds = new Set();
}

function attachGroupUnreadListeners(uid, groupIds) {
    // Drop listeners for groups the user is no longer part of.
    Object.keys(_groupMsgRefs).forEach(gid => {
        if (!groupIds.includes(gid)) {
            _groupMsgRefs[gid].off();
            delete _groupMsgRefs[gid];
            AppState.unreadForumGroupIds.delete(gid);
        }
    });

    groupIds.forEach(gid => {
        if (_groupMsgRefs[gid]) return; // already listening
        const ref = database.ref(`communityGroups/${gid}/messages`).orderByChild('timestamp').limitToLast(1);
        _groupMsgRefs[gid] = ref;
        ref.on('value', async (snap) => {
            const latest = Object.values(snap.val() || {})[0];
            if (!latest || latest.senderId === uid) {
                AppState.unreadForumGroupIds.delete(gid);
                updateForumDrawerBadge();
                return;
            }
            try {
                const readSnap = await database.ref(`users/${uid}/groupReads/${gid}`).once('value');
                const lastRead = readSnap.val() || 0;
                if (latest.timestamp > lastRead) {
                    AppState.unreadForumGroupIds.add(gid);
                } else {
                    AppState.unreadForumGroupIds.delete(gid);
                }
            } catch (e) { /* ignore */ }
            updateForumDrawerBadge();
            if (AppState.currentRoute === 'community') renderCommunityPage();
        });
    });
}

function updateChatDrawerBadge() {
    const badge = document.getElementById('drawer-badge-messages');
    if (badge) badge.classList.toggle('hidden', !AppState.unreadChatsCount);
}

function updateForumDrawerBadge() {
    const badge = document.getElementById('drawer-badge-community');
    if (badge) badge.classList.toggle('hidden', !(AppState.unreadForumGroupIds && AppState.unreadForumGroupIds.size > 0));
}

/* ============================================
   EVENT LISTENERS
   ============================================ */
function initEventListeners() {
    // Theme toggle
    // Theme toggle now lives on the Settings page only.
    
    // Menu
    DOM.menuBtn.addEventListener('click', openDrawer);
    DOM.drawerClose.addEventListener('click', () => closeDrawer());
    DOM.drawerOverlay.addEventListener('click', () => closeDrawer());
    
    // Drawer navigation
    $$('.drawer-link').forEach(link => {
        link.addEventListener('click', (e) => {
            const route = link.dataset.route;
            // Links without a data-route (currently just Admin Dashboard,
            // which points at admin.html in a new tab) aren't part of the
            // in-app router — let them follow their normal href/target.
            if (!route) {
                if (AppState.drawerOpen) closeDrawer();
                return;
            }
            e.preventDefault();
            navigateTo(route);
        });
    });
    
    // Bottom navigation
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const route = item.dataset.route;
            navigateTo(route);
        });
    });
    
    // Logout
    DOM.drawerLogout.addEventListener('click', handleDrawerAuthButtonClick);
    
    // Back (iOS/desktop installed PWAs have no browser chrome back button)
    if (DOM.backBtn) {
        DOM.backBtn.addEventListener('click', goBack);
    }

    // Notifications
    DOM.notifBtn.addEventListener('click', () => {
        showNotificationPanel();
    });

    // Space "add post" button lives in the top bar (only visible on the
    // Space route — see navigateTo()).
    if (DOM.spaceAddBtn) {
        DOM.spaceAddBtn.addEventListener('click', () => showCreateSpacePostModal());
    }

    // Profile / avatar button in top bar
    DOM.profileNavBtn.addEventListener('click', handleProfileNavClick);

    // Keep track of scroll position per-route as the user scrolls, so
    // navigateTo() can restore it later instead of always resetting to top.
    if (DOM.pageContainer) {
        DOM.pageContainer.addEventListener('scroll', () => {
            AppState.scrollPositions[AppState.currentRoute] = DOM.pageContainer.scrollTop;
        }, { passive: true });
    }
    
    // Handle back/forward navigation. Closing overlays and navigating
    // between routes both consume a history entry, so the hardware/browser
    // back button steps through the app instead of exiting it.
    window.addEventListener('popstate', (e) => {
        // A modal/sheet/drawer was just closed via its own UI (X button,
        // backdrop click, etc.) and called history.back() purely to keep
        // the URL/history stack tidy. That should never re-render the
        // current page — it would wipe out scroll position, form input,
        // reel playback position, and any other in-progress UI state.
        if (AppState.suppressNextPopstateNav) {
            AppState.suppressNextPopstateNav = false;
            if (AppState.modalOpen) closeModal(true);
            if (AppState.sheetOpen) closeSheet(true);
            if (AppState.drawerOpen) closeDrawer(true);
            return;
        }

        if (AppState.modalOpen) {
            closeModal(true);
            return;
        }
        if (AppState.sheetOpen) {
            closeSheet(true);
            return;
        }
        if (AppState.drawerOpen) {
            closeDrawer(true);
            return;
        }

        if (!authReady) return;

        AppState.appNavDepth = Math.max(0, AppState.appNavDepth - 1);
        // Phase 3: always re-derive from the CURRENT hash (which the
        // browser has already updated for us by this point) rather than
        // trusting state.route alone — this is what lets back/forward
        // between deep-linked entries (e.g. #/profile/abc123 <-> #/space)
        // correctly re-set AppState.viewedProfileId etc, not just the
        // bare internal route name.
        navigateToHash(window.location.hash || '#/home', { fromPopstate: true });
    });
    
    // Online/offline
    window.addEventListener('online', () => {
        AppState.isOnline = true;
        showToast('Back online', 'success');
    });
    
    window.addEventListener('offline', () => {
        AppState.isOnline = false;
        showToast('You are offline', 'warning');
    });
}

/**
 * Builds the onclick action string for a notification row, routing
 * Space-related notifications (amens/comments) to the actual post
 * instead of always going to the sender's profile.
 */
function notifClickAction(notif) {
    // Admin announcements can target a specific screen (admin.html → Notifications).
    if (notif.route && /^[a-z0-9\-\/]+$/i.test(notif.route)) {
        return `closeSheetThen(() => navigateToHash('#/${notif.route}'))`;
    }
    if (notif.postId && (notif.type === 'space_amen' || notif.type === 'space_comment')) {
        const openComments = notif.type === 'space_comment';
        return `closeSheetThen(() => openSpacePostFromNotification('${notif.postId}', ${openComments}))`;
    }
    if (notif.fromUid) {
        const safeName = escapeHtml(notif.fromName || 'User').replace(/'/g, "\\'");
        return `viewUserProfile('${notif.fromUid}', '${safeName}')`;
    }
    return '';
}

/**
 * Jumps to Space and scrolls to a specific post (used when a notification
 * about an amen or comment on the user's own post is tapped).
 */
async function openSpacePostFromNotification(postId, openComments) {
    navigateTo('space');
    // Space renders its feed asynchronously; wait a beat for the card to exist.
    const tryFocus = (attemptsLeft) => {
        const el = document.getElementById(`space-${postId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('space-card-flash');
            setTimeout(() => el.classList.remove('space-card-flash'), 1500);
            if (openComments) showSpacePostComments(postId);
        } else if (attemptsLeft > 0) {
            setTimeout(() => tryFocus(attemptsLeft - 1), 250);
        }
    };
    setTimeout(() => tryFocus(8), 300);
}

async function showNotificationPanel() {
    if (!requireAuth('Sign in to view notifications.')) return;

    try {
        await renderNotificationPanelContent();
    } catch (error) {
        // Belt-and-braces: a single malformed notification/connection
        // record used to be able to throw mid-render and leave the tap
        // looking like it did nothing at all. Now it always at least
        // shows *something*, with a retry option.
        console.error('Error showing notifications:', error);
        showSheet(`
            <h3 style="margin-bottom: 12px;">Notifications</h3>
            <p class="text-center text-muted" style="margin-bottom: 16px;">Something went wrong loading your notifications.</p>
            <button class="btn btn-outline btn-block" onclick="closeSheetThen(showNotificationPanel)">
                <i class="fas fa-rotate-right"></i> Try Again
            </button>
        `);
    }
}

async function renderNotificationPanelContent() {
    // Pull pending incoming connection requests straight from the
    // connections node (source of truth) rather than relying on the
    // notification log, so Accept/Decline is always accurate even if a
    // notification was missed or already cleared.
    const uid = AppState.currentUser.uid;
    let pendingRequests = [];
    try {
        const snapshot = await database.ref(`users/${uid}/connections`).once('value');
        const connections = snapshot.val() || {};
        pendingRequests = Object.entries(connections)
            .filter(([, info]) => info && info.status === 'pending' && info.direction === 'incoming')
            .map(([otherUid, info]) => ({ otherUid, name: info.name || 'A GraceGuide member', timestamp: info.timestamp || 0 }))
            .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
        console.error('Error loading connection requests:', error);
    }

    const requestsHTML = pendingRequests.length > 0 ? `
        <h4 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-slate); margin-bottom: 8px;">Brethren Requests</h4>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom: 20px;">
            ${pendingRequests.map(req => `
                <div class="notif-request-row">
                    <div class="post-avatar comment-avatar" style="width:40px;height:40px; cursor:pointer;" onclick="viewUserProfile('${req.otherUid}', '${escapeHtml(req.name).replace(/'/g, "\\'")}')">
                        ${escapeHtml(req.name)[0]?.toUpperCase() || 'U'}
                    </div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600;">${escapeHtml(req.name)}</div>
                        <div style="font-size:12px; color: var(--text-slate);">wants to connect as Brethren</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn btn-primary btn-sm" onclick="acceptConnectRequest('${req.otherUid}', '${escapeHtml(req.name).replace(/'/g, "\\'")}')"><i class="fas fa-check"></i></button>
                        <button class="btn btn-outline btn-sm" onclick="declineConnectRequest('${req.otherUid}')"><i class="fas fa-xmark"></i></button>
                    </div>
                </div>
            `).join('')}
        </div>
    ` : '';

    const generalNotifs = AppState.notifications.filter(n => n.type !== 'connection_request');
    const unreadKeys = generalNotifs.filter(n => !n.read && n.key).map(n => n.key);

    const sheetContent = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom: 16px;">
            <h3 style="margin:0;">Notifications</h3>
            ${unreadKeys.length ? `<span class="notif-new-pill">${unreadKeys.length} new</span>
            <button class="btn btn-sm notif-mark-all" style="margin-left:auto;" onclick="markAllNotificationsRead()">Mark all read</button>` : ''}
        </div>
        ${requestsHTML}
        ${generalNotifs.length > 0 ? `
            ${pendingRequests.length > 0 ? `<h4 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-slate); margin-bottom: 8px;">Recent</h4>` : ''}
            ${generalNotifs.slice(-15).reverse().map(notif => `
                <div class="notif-row ${notif.read ? '' : 'notif-row-unread'}" onclick="markNotificationsRead(['${notif.key}']); ${notifClickAction(notif)}">
                    ${notif.read ? '' : '<span class="notif-unread-dot"></span>'}
                    <div style="flex: 1; min-width: 0;">
                        ${notif.title ? `<div class="notif-row-message" style="font-weight:700;">${escapeHtml(notif.title)}</div>` : ''}
                        <div class="notif-row-message">${escapeHtml(notif.message)}</div>
                        <div style="font-size: 12px; color: var(--text-slate);">${formatDate(notif.timestamp)}</div>
                    </div>
                </div>
            `).join('')}
        ` : (pendingRequests.length === 0 ? `<p class="text-center text-muted">No notifications</p>` : '')}
    `;

    // Opening the panel no longer marks anything read: an item is read once
    // it's tapped, or via "Mark all read" (the inbox is shared with the
    // Android app, so silently clearing it here also hid it there).
    showSheet(sheetContent);
}

/** Marks inbox entries read — optimistically in AppState (badge updates at
    once), then in the database. */
function markNotificationsRead(keys) {
    const uid = AppState.currentUser && AppState.currentUser.uid;
    keys = (keys || []).filter(Boolean);
    if (!uid || keys.length === 0) return Promise.resolve();
    AppState.notifications = AppState.notifications.map(n => keys.includes(n.key) ? { ...n, read: true } : n);
    updateNotificationBadge();
    const updates = {};
    keys.forEach(key => { updates[`${key}/read`] = true; });
    return database.ref(`users/${uid}/notifications`).update(updates).catch(error => {
        console.error('Error marking notifications read:', error);
    });
}

function markAllNotificationsRead() {
    const keys = AppState.notifications.filter(n => !n.read && n.type !== 'connection_request').map(n => n.key);
    markNotificationsRead(keys);
    renderNotificationPanelContent().catch(() => {});
}
window.markNotificationsRead = markNotificationsRead;
window.markAllNotificationsRead = markAllNotificationsRead;

/* ============================================
   INITIALIZATION
   ============================================ */
async function initApp() {
    console.log('🚀 Initializing GraceGuide...');
    
    // Initialize theme
    initTheme();

    // Initialize text-to-speech voices for Shepherd's replies
    initVoices();
    
    // Initialize event listeners
    initEventListeners();
    
    // Initialize authentication (also determines and navigates to the
    // initial route from the URL hash once auth state resolves — see
    // initAuth()/enterAppOnce() in core.js).
    initAuth();

    console.log('✅ GraceGuide initialized successfully');
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);

// Export functions for use in HTML onclick attributes
window.navigateTo = navigateTo;
window.toggleVerseSelection = toggleVerseSelection;
window.sendChatMessage = sendChatMessage;
window.toggleSpeakMessage = toggleSpeakMessage;
window.showVoicePickerSheet = showVoicePickerSheet;
window.selectVoice = selectVoice;
window.previewVoice = previewVoice;
window.discussReflectionWithShepherd = discussReflectionWithShepherd;
window.askSuggestedQuestion = askSuggestedQuestion;
window.showFontSizeOptions = showFontSizeOptions;
window.setBibleFontSize = setBibleFontSize;
window.shareVerse = shareVerse;
window.saveVerse = saveVerse;
window.openBibleChapter = openBibleChapter;
window.openBibleBook = openBibleBook;
window.openBibleChapterFromGrid = openBibleChapterFromGrid;
window.renderBibleBookListView = renderBibleBookListView;
window.renderBibleChapterListView = renderBibleChapterListView;
window.renderBibleReaderView = renderBibleReaderView;
window.loadBibleChapter = loadBibleChapter;
window.clearVerseSelection = clearVerseSelection;
window.closeSheetThen = closeSheetThen;
window.closeModalThen = closeModalThen;
window.showBrethrenListModal = showBrethrenListModal;
window.showMyPostsModal = showMyPostsModal;
window.showUserBrethrenModal = showUserBrethrenModal;
window.showUserPostsModal = showUserPostsModal;
window.showAuthModal = showAuthModal;
window.requireAuth = requireAuth;
window.handleProfileNavClick = handleProfileNavClick;
window.triggerAvatarUpload = triggerAvatarUpload;
window.postSelectedVersesToSpace = postSelectedVersesToSpace;
window.showCreateSpacePostModal = showCreateSpacePostModal;
window.showSpacePostComposer = showSpacePostComposer;
window.backToSpacePostTypePicker = backToSpacePostTypePicker;
window.addSpacePlanToMyPlanner = addSpacePlanToMyPlanner;
window.openSpacePostFromNotification = openSpacePostFromNotification;
window.submitTextSpacePost = submitTextSpacePost;
window.submitVideoSpacePost = submitVideoSpacePost;
window.submitNoteSpacePost = submitNoteSpacePost;
window.submitPlanSpacePost = submitPlanSpacePost;
window.toggleSpaceAmen = toggleSpaceAmen;
window.toggleSpaceSave = toggleSpaceSave;
window.showSpacePostComments = showSpacePostComments;
window.submitSpacePostComment = submitSpacePostComment;
window.shareSpacePost = shareSpacePost;
window.submitShareReelToGroup = submitShareReelToGroup;
window.deleteSpacePost = deleteSpacePost;
window.confirmDeleteSpacePost = confirmDeleteSpacePost;
window.scrollSpaceCarousel = scrollSpaceCarousel;
window.showCreateGroupModal = showCreateGroupModal;
window.openGroup = openGroup;
window.showGroupMembers = showGroupMembers;
window.joinGroup = joinGroup;
window.sendGroupMessage = sendGroupMessage;
window.showGroupAttachMenu = showGroupAttachMenu;
window.shareVerseToGroup = shareVerseToGroup;
window.sharePlanToGroup = sharePlanToGroup;
window.submitSharePlanToGroup = submitSharePlanToGroup;
window.viewUserProfile = viewUserProfile;
window.sendConnectRequest = sendConnectRequest;
window.cancelConnectRequest = cancelConnectRequest;
window.acceptConnectRequest = acceptConnectRequest;
window.declineConnectRequest = declineConnectRequest;
window.removeBrethren = removeBrethren;
window.reportUser = reportUser;
window.submitUserReport = submitUserReport;
window.blockUser = blockUser;
window.confirmBlockUser = confirmBlockUser;
window.openConversation = openConversation;
window.sendDirectMessage = sendDirectMessage;
window.executeAIAction = executeAIAction;
window.startNewConversation = startNewConversation;
window.loadConversation = loadConversation;
window.showConversationHistory = showConversationHistory;
window.renameConversation = renameConversation;
window.deleteConversation = deleteConversation;
window.confirmDeleteConversation = confirmDeleteConversation;
window.createNewPlan = createNewPlan;
window.togglePlannerDay = togglePlannerDay;
window.editProfile = editProfile;
window.showUserBible = showUserBible;
window.openBookmark = openBookmark;
window.highlightSelectedVerses = highlightSelectedVerses;
window.bookmarkSelectedVerses = bookmarkSelectedVerses;
window.addNoteToSelectedVerses = addNoteToSelectedVerses;
window.shareSelectedVerses = shareSelectedVerses;
window.askAIAboutSelectedVerses = askAIAboutSelectedVerses;
window.toggleTheme = toggleTheme;
window.closeModal = closeModal;
window.closeSheet = closeSheet;
window.handleLogout = handleLogout;
window.resendVerificationEmail = resendVerificationEmail;
