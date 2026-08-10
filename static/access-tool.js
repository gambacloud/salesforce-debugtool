// --- Salesforce OAuth (Implicit Flow) ---

let _oauthClientId = null;
let _instanceUrl = null;
let _sessionId = null;
let _selectedUser = null;
let _keyPrefixMap = null;   // { '001': { name: 'Account', label: 'Account' }, ... }
let _roleMap = null;        // { Id: { Name, ParentRoleId } }
let _mode = 'user';         // 'user' (check a user's access) | 'record' (who can see this record)

const GROUP_EXPANSION_MAX_DEPTH = 6;
const GROUP_EXPANSION_MAX_USERS = 500;

const ROW_CAUSE_LABELS = {
    Owner: 'Owner',
    Rule: 'Sharing Rule',
    Manual: 'Manual Share',
    Team: 'Account/Opportunity Team',
    ImplicitChild: 'Implicit (Child Record)',
    ImplicitParent: 'Implicit (Parent Record)',
    Territory: 'Territory',
    Territory2Association: 'Territory',
    Territory2Manual: 'Territory (Manual)'
};

// Standard objects whose Share table uses "<Object>Id" instead of "ParentId".
const STANDARD_SHARE_PARENT_FIELD = {
    Account: 'AccountId',
    Case: 'CaseId',
    Contact: 'ContactId',
    Lead: 'LeadId',
    Opportunity: 'OpportunityId',
    Campaign: 'CampaignId',
    Contract: 'ContractId',
    Order: 'OrderId'
};

(async function initOAuth() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        _oauthClientId = data.clientId || null;
    } catch (e) { /* non-fatal */ }

    handleOAuthCallback();
    if (sessionStorage.getItem('oauth_access')) applyStoredCredentials();
})();

function handleOAuthCallback() {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    const instanceUrl = params.get('instance_url');
    if (!accessToken || !instanceUrl) return;

    sessionStorage.setItem('oauth_access', JSON.stringify({
        accessToken,
        instanceUrl: decodeURIComponent(instanceUrl)
    }));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    applyStoredCredentials();
}

function applyStoredCredentials() {
    const stored = sessionStorage.getItem('oauth_access');
    if (!stored) return;
    const { accessToken, instanceUrl } = JSON.parse(stored);
    connect(instanceUrl, accessToken);
}

window.loginOrg = function (env) {
    if (!_oauthClientId) {
        alert('Salesforce Client ID not configured. Set SF_CLIENT_ID in Heroku config vars.');
        return;
    }
    const base = env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
    const nonce = Math.random().toString(36).substring(2, 10);
    const redirectUri = window.location.origin + '/access-tool';
    window.location.href = `${base}/services/oauth2/authorize?response_type=token&client_id=${_oauthClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(nonce)}`;
};

window.connectManual = function () {
    const instanceUrl = document.getElementById('manualInstance').value.trim();
    const sessionId = document.getElementById('manualSession').value.trim();
    if (!instanceUrl || !sessionId) {
        alert('Enter both Instance URL and Session ID.');
        return;
    }
    connect(instanceUrl, sessionId);
};

window.disconnectOrg = function () {
    sessionStorage.removeItem('oauth_access');
    _instanceUrl = null;
    _sessionId = null;
    _selectedUser = null;
    _keyPrefixMap = null;
    _roleMap = null;
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('mainScreen').classList.add('hidden');
};

function connect(instanceUrl, sessionId) {
    _instanceUrl = instanceUrl;
    _sessionId = sessionId;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    const hostname = new URL(instanceUrl).hostname.split('.')[0];
    document.getElementById('connectedLabel').textContent = hostname;
    setMode('user');
}

// --- Mode toggle ---

window.setMode = function (mode) {
    _mode = mode;
    document.getElementById('modeUserBtn').classList.toggle('active', mode === 'user');
    document.getElementById('modeRecordBtn').classList.toggle('active', mode === 'record');
    document.getElementById('modeObjectBtn').classList.toggle('active', mode === 'object');
    document.getElementById('userSearchField').classList.toggle('hidden', mode === 'record');
    document.getElementById('recordIdField').classList.toggle('hidden', mode === 'object');
    document.getElementById('objectField').classList.toggle('hidden', mode !== 'object');
    document.getElementById('checkAccessBtnLabel').textContent = mode === 'record' ? 'Find Access' : mode === 'object' ? 'Check Permissions' : 'Check Access';
    document.getElementById('resultsPanel').classList.add('hidden');
    document.getElementById('resultsPanel').innerHTML = '';
    clearError();
    updateCheckButtonState();
    if (mode === 'object') populateObjectDatalist();
};

window.runAnalysis = function () {
    if (_mode === 'user') {
        checkAccess();
    } else if (_mode === 'record') {
        findWhoCanSee();
    } else {
        checkObjectAccess();
    }
};

async function populateObjectDatalist() {
    const datalist = document.getElementById('objectDatalist');
    if (datalist.childElementCount > 0) return;
    try {
        const map = await ensureKeyPrefixMap();
        const seen = new Set();
        datalist.innerHTML = Object.values(map)
            .filter(o => { if (seen.has(o.name)) return false; seen.add(o.name); return true; })
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.label)}</option>`).join('');
    } catch (e) { /* non-fatal — plain text entry still works */ }
}

// --- Helpers ---

function soqlEscape(str) {
    return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str == null ? '' : str);
    return div.innerHTML;
}

function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = msg;
    box.classList.remove('hidden');
}

function clearError() {
    document.getElementById('errorBox').classList.add('hidden');
}

async function soqlQuery(q) {
    const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(_instanceUrl)}&sessionId=${encodeURIComponent(_sessionId)}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function compositeRequest(requests) {
    const res = await fetch('/api/proxy/composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceUrl: _instanceUrl, sessionId: _sessionId, compositeRequest: requests })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const byRef = {};
    (data.compositeResponse || []).forEach(r => { byRef[r.referenceId] = r; });
    return byRef;
}

// --- User search ---

let _searchDebounce = null;
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('userSearchInput');
    input.addEventListener('input', () => {
        clearTimeout(_searchDebounce);
        const q = input.value.trim();
        if (q.length < 2) {
            document.getElementById('userSearchResults').classList.add('hidden');
            return;
        }
        _searchDebounce = setTimeout(() => runUserSearch(q), 300);
    });
    document.getElementById('recordIdInput').addEventListener('input', updateCheckButtonState);
    document.getElementById('objectInput').addEventListener('input', updateCheckButtonState);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#userSearchInput') && !e.target.closest('#userSearchResults')) {
            document.getElementById('userSearchResults').classList.add('hidden');
        }
    });
});

async function runUserSearch(q) {
    const resultsBox = document.getElementById('userSearchResults');
    try {
        const esc = soqlEscape(q);
        const soql = `SELECT Id, Name, Username, Email, IsActive, ProfileId, Profile.Name, UserRoleId, UserRole.Name FROM User WHERE (Name LIKE '%${esc}%' OR Username LIKE '%${esc}%' OR Email LIKE '%${esc}%') ORDER BY Name LIMIT 10`;
        const data = await soqlQuery(soql);
        const records = data.records || [];
        if (records.length === 0) {
            resultsBox.innerHTML = `<div class="px-3 py-2 text-xs text-gray-400">No users found</div>`;
        } else {
            resultsBox.innerHTML = records.map((u, i) => `
                <button type="button" data-idx="${i}"
                    class="user-result-item w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                    <div class="text-xs font-medium ${u.IsActive ? '' : 'text-gray-400 line-through'}">${escapeHtml(u.Name)}</div>
                    <div class="text-[11px] text-gray-400">${escapeHtml(u.Username)}</div>
                </button>`).join('');
            resultsBox.querySelectorAll('.user-result-item').forEach(btn => {
                btn.addEventListener('click', () => selectUser(records[Number(btn.dataset.idx)]));
            });
        }
        resultsBox.classList.remove('hidden');
    } catch (e) {
        resultsBox.innerHTML = `<div class="px-3 py-2 text-xs text-red-500">${escapeHtml(e.message)}</div>`;
        resultsBox.classList.remove('hidden');
    }
}

function selectUser(u) {
    _selectedUser = u;
    document.getElementById('userSearchInput').value = '';
    document.getElementById('userSearchResults').classList.add('hidden');
    const chip = document.getElementById('selectedUserChip');
    document.getElementById('selectedUserLabel').textContent = `${u.Name} (${u.Username})`;
    chip.classList.remove('hidden');
    updateCheckButtonState();
}

window.clearSelectedUser = function () {
    _selectedUser = null;
    document.getElementById('selectedUserChip').classList.add('hidden');
    updateCheckButtonState();
};

function updateCheckButtonState() {
    const recordId = document.getElementById('recordIdInput').value.trim();
    const objectVal = document.getElementById('objectInput').value.trim();
    let ready;
    if (_mode === 'user') ready = _selectedUser && recordId.length >= 15;
    else if (_mode === 'record') ready = recordId.length >= 15;
    else ready = _selectedUser && objectVal.length > 0;
    document.getElementById('checkAccessBtn').disabled = !ready;
}

// --- Describe / role hierarchy caching (per connected org, per browser session) ---

async function ensureKeyPrefixMap() {
    if (_keyPrefixMap) return _keyPrefixMap;
    const cacheKey = 'access_prefixmap_' + new URL(_instanceUrl).hostname;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        _keyPrefixMap = JSON.parse(cached);
        return _keyPrefixMap;
    }
    const res = await fetch(`/api/proxy/composite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            instanceUrl: _instanceUrl,
            sessionId: _sessionId,
            compositeRequest: [{ method: 'GET', url: '/services/data/v58.0/sobjects', referenceId: 'describe' }]
        })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const describeResp = (data.compositeResponse || []).find(r => r.referenceId === 'describe');
    if (!describeResp || describeResp.httpStatusCode >= 300) throw new Error('Could not load object list from org');
    const map = {};
    (describeResp.body.sobjects || []).forEach(o => {
        if (o.keyPrefix) map[o.keyPrefix] = { name: o.name, label: o.label };
    });
    _keyPrefixMap = map;
    sessionStorage.setItem(cacheKey, JSON.stringify(map));
    return map;
}

async function ensureRoleMap() {
    if (_roleMap) return _roleMap;
    const cacheKey = 'access_rolemap_' + new URL(_instanceUrl).hostname;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        _roleMap = JSON.parse(cached);
        return _roleMap;
    }
    const data = await soqlQuery('SELECT Id, Name, ParentRoleId FROM UserRole');
    const map = {};
    (data.records || []).forEach(r => { map[r.Id] = { Name: r.Name, ParentRoleId: r.ParentRoleId }; });
    _roleMap = map;
    sessionStorage.setItem(cacheKey, JSON.stringify(map));
    return map;
}

function roleChain(roleId) {
    const chain = [];
    let cur = roleId;
    let guard = 0;
    while (cur && _roleMap[cur] && guard < 50) {
        chain.push(_roleMap[cur].Name);
        cur = _roleMap[cur].ParentRoleId;
        guard++;
    }
    return chain; // leaf -> root
}

function resolveObjectByName(input) {
    const needle = input.trim().toLowerCase();
    const values = Object.values(_keyPrefixMap || {});
    return values.find(o => o.name.toLowerCase() === needle) ||
        values.find(o => o.label.toLowerCase() === needle) ||
        null;
}

function shareObjectInfo(apiName) {
    if (apiName.endsWith('__c')) {
        return { shareObject: apiName.slice(0, -3) + '__Share', parentField: 'ParentId' };
    }
    const parentField = STANDARD_SHARE_PARENT_FIELD[apiName];
    if (!parentField) return null; // unknown standard object share table naming — skip gracefully
    return { shareObject: apiName + 'Share', parentField };
}

// --- Main analysis ---

window.checkAccess = async function () {
    clearError();
    const recordId = document.getElementById('recordIdInput').value.trim();
    if (!_selectedUser || recordId.length < 15) return;

    const btn = document.getElementById('checkAccessBtn');
    const spinner = document.getElementById('checkSpinner');
    btn.disabled = true;
    spinner.classList.remove('hidden');
    document.getElementById('resultsPanel').classList.add('hidden');

    try {
        const [prefixMap] = await Promise.all([ensureKeyPrefixMap(), ensureRoleMap()]);
        const prefix = recordId.substring(0, 3);
        const objectInfo = prefixMap[prefix];
        if (!objectInfo) throw new Error(`Unrecognized record Id prefix "${prefix}" — could not resolve object type.`);

        const requests = [
            {
                method: 'GET',
                referenceId: 'ura',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT HasReadAccess, HasEditAccess, HasDeleteAccess, HasTransferAccess, MaxAccessLevel FROM UserRecordAccess WHERE UserId = '${soqlEscape(_selectedUser.Id)}' AND RecordId = '${soqlEscape(recordId)}'`
                )}`
            },
            {
                method: 'GET',
                referenceId: 'record',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT OwnerId, Owner.Name, Owner.Username, Owner.UserRoleId FROM ${objectInfo.name} WHERE Id = '${soqlEscape(recordId)}'`
                )}`
            }
        ];

        const shareInfo = shareObjectInfo(objectInfo.name);
        if (shareInfo) {
            requests.push({
                method: 'GET',
                referenceId: 'share',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT UserOrGroupId, RowCause, AccessLevel FROM ${shareInfo.shareObject} WHERE ${shareInfo.parentField} = '${soqlEscape(recordId)}'`
                )}`
            });
        }

        const results = await compositeRequest(requests);

        const uraOk = results.ura && results.ura.httpStatusCode < 300;
        const uraRow = uraOk ? (results.ura.body.records || [])[0] : null;

        const recordOk = results.record && results.record.httpStatusCode < 300;
        const recordRow = recordOk ? (results.record.body.records || [])[0] : null;

        let shareRows = [];
        let shareError = shareInfo ? null : 'No sharing table known for this object (custom objects and common standard objects are supported).';
        if (shareInfo && results.share) {
            if (results.share.httpStatusCode < 300) {
                shareRows = results.share.body.records || [];
            } else {
                shareError = 'Could not read the sharing table for this object (it may not have one, e.g. Public / Controlled-by-Parent OWD).';
            }
        }

        // Resolve names for UserOrGroupId values in share rows.
        let nameMap = {};
        if (shareRows.length > 0) {
            const ids = [...new Set(shareRows.map(r => r.UserOrGroupId))];
            const userIds = ids.filter(id => id.startsWith('005'));
            const groupIds = ids.filter(id => id.startsWith('00G') || id.startsWith('00E'));
            const nameRequests = [];
            if (userIds.length) {
                nameRequests.push({
                    method: 'GET', referenceId: 'shareUsers',
                    url: `/services/data/v58.0/query/?q=${encodeURIComponent(`SELECT Id, Name FROM User WHERE Id IN (${userIds.map(id => `'${soqlEscape(id)}'`).join(',')})`)}`
                });
            }
            if (groupIds.length) {
                nameRequests.push({
                    method: 'GET', referenceId: 'shareGroups',
                    url: `/services/data/v58.0/query/?q=${encodeURIComponent(`SELECT Id, Name, Type FROM Group WHERE Id IN (${groupIds.map(id => `'${soqlEscape(id)}'`).join(',')})`)}`
                });
            }
            if (nameRequests.length) {
                const nameResults = await compositeRequest(nameRequests);
                ['shareUsers', 'shareGroups'].forEach(ref => {
                    if (nameResults[ref] && nameResults[ref].httpStatusCode < 300) {
                        (nameResults[ref].body.records || []).forEach(r => {
                            nameMap[r.Id] = r.Type ? `${r.Name} (${r.Type})` : r.Name;
                        });
                    }
                });
            }
        }

        renderResults({
            objectLabel: objectInfo.label,
            recordId,
            uraRow,
            recordRow,
            shareRows,
            shareError,
            nameMap
        });
    } catch (e) {
        showError(e.message);
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
        updateCheckButtonState();
    }
};

function accessBadge(has) {
    return has
        ? `<span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>Yes</span>`
        : `<span class="inline-flex items-center gap-1 text-gray-400"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>No</span>`;
}

function renderResults({ objectLabel, recordId, uraRow, recordRow, shareRows, shareError, nameMap }) {
    const panel = document.getElementById('resultsPanel');
    const isOwner = recordRow && recordRow.OwnerId === _selectedUser.Id;

    const maxAccess = uraRow ? uraRow.MaxAccessLevel : 'None';
    const hasAny = uraRow && (uraRow.HasReadAccess || uraRow.HasEditAccess || uraRow.HasDeleteAccess);

    let html = '';

    // Verdict card
    html += `
    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
            <div>
                <div class="text-xs text-gray-400">${escapeHtml(objectLabel)} · <span class="font-mono">${escapeHtml(recordId)}</span></div>
                <div class="text-sm font-semibold mt-0.5">${escapeHtml(_selectedUser.Name)}${isOwner ? ' <span class="text-[10px] font-medium text-primary-600 dark:text-primary-400 align-middle">(Owner)</span>' : ''}</div>
            </div>
            <span class="text-[11px] font-semibold px-2.5 py-1 rounded-full ${hasAny ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}">
                Max Access: ${escapeHtml(maxAccess || 'None')}
            </span>
        </div>
        <div class="grid grid-cols-4 gap-3 text-xs">
            <div><div class="text-gray-400 mb-1">Read</div>${accessBadge(!!(uraRow && uraRow.HasReadAccess))}</div>
            <div><div class="text-gray-400 mb-1">Edit</div>${accessBadge(!!(uraRow && uraRow.HasEditAccess))}</div>
            <div><div class="text-gray-400 mb-1">Delete</div>${accessBadge(!!(uraRow && uraRow.HasDeleteAccess))}</div>
            <div><div class="text-gray-400 mb-1">Transfer</div>${accessBadge(!!(uraRow && uraRow.HasTransferAccess))}</div>
        </div>
        ${recordRow ? `<div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">Owned by <span class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(recordRow.Owner ? recordRow.Owner.Name : recordRow.OwnerId)}</span></div>` : ''}
    </div>`;

    // Why panel
    html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <h3 class="text-sm font-semibold mb-3">Why</h3>`;

    if (shareError) {
        html += `<p class="text-xs text-gray-400 mb-2">${escapeHtml(shareError)}</p>`;
    }

    const whyRows = [];
    if (isOwner) whyRows.push({ label: 'Owner', who: _selectedUser.Name, level: 'Full Access' });
    shareRows.forEach(r => {
        whyRows.push({
            label: ROW_CAUSE_LABELS[r.RowCause] || r.RowCause,
            who: nameMap[r.UserOrGroupId] || r.UserOrGroupId,
            level: r.AccessLevel
        });
    });

    if (whyRows.length === 0 && !isOwner) {
        html += `<p class="text-xs text-gray-400">No explicit share rows found for this user or their groups. Access, if any, comes from org-wide defaults or role hierarchy alone.</p>`;
    } else {
        html += `<div class="space-y-1.5">` + whyRows.map(w => `
            <div class="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/50 rounded-md px-3 py-2">
                <span class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(w.label)}</span>
                <span class="text-gray-400">${escapeHtml(w.who)}</span>
                <span class="font-mono text-gray-500 dark:text-gray-400">${escapeHtml(w.level)}</span>
            </div>`).join('') + `</div>`;
    }
    html += `</div>`;

    // Role hierarchy panel
    if (recordRow && recordRow.Owner && recordRow.Owner.UserRoleId) {
        const ownerChain = roleChain(recordRow.Owner.UserRoleId);
        const targetChain = _selectedUser.UserRoleId ? roleChain(_selectedUser.UserRoleId) : [];
        const targetIsAncestor = targetChain.length > 0 && ownerChain.slice(1).some(r => r === targetChain[0]);
        html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 class="text-sm font-semibold mb-3">Role Hierarchy</h3>
            <div class="grid grid-cols-2 gap-4 text-xs">
                <div>
                    <div class="text-gray-400 mb-1">Owner's role (leaf → top)</div>
                    <div class="text-gray-700 dark:text-gray-300">${ownerChain.length ? ownerChain.map(escapeHtml).join(' → ') : '<span class="text-gray-400">No role</span>'}</div>
                </div>
                <div>
                    <div class="text-gray-400 mb-1">${escapeHtml(_selectedUser.Name)}'s role (leaf → top)</div>
                    <div class="text-gray-700 dark:text-gray-300">${targetChain.length ? targetChain.map(escapeHtml).join(' → ') : '<span class="text-gray-400">No role</span>'}</div>
                </div>
            </div>
            ${targetIsAncestor ? `<p class="mt-3 text-xs text-primary-600 dark:text-primary-400">This user sits above the owner in the role hierarchy — access may also come from hierarchy-based sharing (if enabled for this object).</p>` : ''}
        </div>`;
    }

    panel.innerHTML = html;
    panel.classList.remove('hidden');
}

// --- "Who can see this record" (reverse direction) ---

window.findWhoCanSee = async function () {
    clearError();
    const recordId = document.getElementById('recordIdInput').value.trim();
    if (recordId.length < 15) return;

    const btn = document.getElementById('checkAccessBtn');
    const spinner = document.getElementById('checkSpinner');
    btn.disabled = true;
    spinner.classList.remove('hidden');
    document.getElementById('resultsPanel').classList.add('hidden');

    try {
        const prefixMap = await ensureKeyPrefixMap();
        const prefix = recordId.substring(0, 3);
        const objectInfo = prefixMap[prefix];
        if (!objectInfo) throw new Error(`Unrecognized record Id prefix "${prefix}" — could not resolve object type.`);

        const requests = [
            {
                method: 'GET',
                referenceId: 'record',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT OwnerId, Owner.Name, Owner.Username FROM ${objectInfo.name} WHERE Id = '${soqlEscape(recordId)}'`
                )}`
            }
        ];
        const shareInfo = shareObjectInfo(objectInfo.name);
        let shareError = shareInfo ? null : 'No sharing table known for this object (custom objects and common standard objects are supported).';
        if (shareInfo) {
            requests.push({
                method: 'GET',
                referenceId: 'share',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT UserOrGroupId, RowCause, AccessLevel FROM ${shareInfo.shareObject} WHERE ${shareInfo.parentField} = '${soqlEscape(recordId)}'`
                )}`
            });
        }

        const results = await compositeRequest(requests);
        const recordOk = results.record && results.record.httpStatusCode < 300;
        const recordRow = recordOk ? (results.record.body.records || [])[0] : null;

        let shareRows = [];
        if (shareInfo && results.share) {
            if (results.share.httpStatusCode < 300) {
                shareRows = results.share.body.records || [];
            } else {
                shareError = 'Could not read the sharing table for this object (it may not have one, e.g. Public / Controlled-by-Parent OWD).';
            }
        }

        // Origins: index 0 reserved for Owner (if any), rest map to shareRows.
        const origins = [];
        if (recordRow && recordRow.OwnerId) {
            origins.push({ rowCause: 'Owner', accessLevel: 'Full Access', groupId: null, groupName: null });
        }
        shareRows.forEach(r => {
            origins.push({ rowCause: r.RowCause, accessLevel: r.AccessLevel, groupId: r.UserOrGroupId.startsWith('00G') ? r.UserOrGroupId : null, groupName: null });
        });

        // resolvedUsers: userId -> Set(originIndex)
        const resolvedUsers = new Map();
        const unresolvedPrincipals = []; // { id, rowCause, accessLevel } — not a User/Group we can expand
        const truncated = { value: false };

        function addUser(userId, originIndex) {
            if (!resolvedUsers.has(userId)) {
                if (resolvedUsers.size >= GROUP_EXPANSION_MAX_USERS) { truncated.value = true; return; }
                resolvedUsers.set(userId, new Set());
            }
            resolvedUsers.get(userId).add(originIndex);
        }

        if (recordRow && recordRow.OwnerId) addUser(recordRow.OwnerId, 0);

        // Seed frontier from direct share rows.
        let frontier = []; // { groupId, originIndex }
        shareRows.forEach((r, i) => {
            const originIndex = i + (recordRow && recordRow.OwnerId ? 1 : 0);
            const id = r.UserOrGroupId;
            if (id.startsWith('005')) {
                addUser(id, originIndex);
            } else if (id.startsWith('00G')) {
                frontier.push({ groupId: id, originIndex });
            } else {
                unresolvedPrincipals.push({ id, rowCause: r.RowCause, accessLevel: r.AccessLevel });
            }
        });

        const visitedGroups = new Set(frontier.map(f => f.groupId));
        let depth = 0;
        while (frontier.length > 0 && depth < GROUP_EXPANSION_MAX_DEPTH && resolvedUsers.size < GROUP_EXPANSION_MAX_USERS) {
            const groupIds = [...new Set(frontier.map(f => f.groupId))];
            const originByGroup = new Map();
            frontier.forEach(f => {
                if (!originByGroup.has(f.groupId)) originByGroup.set(f.groupId, []);
                originByGroup.get(f.groupId).push(f.originIndex);
            });

            const data = await soqlQuery(`SELECT GroupId, UserOrGroupId FROM GroupMember WHERE GroupId IN (${groupIds.map(id => `'${soqlEscape(id)}'`).join(',')})`);
            const nextFrontier = [];
            (data.records || []).forEach(m => {
                const originIndexes = originByGroup.get(m.GroupId) || [];
                if (m.UserOrGroupId.startsWith('005')) {
                    originIndexes.forEach(oi => addUser(m.UserOrGroupId, oi));
                } else if (m.UserOrGroupId.startsWith('00G') && !visitedGroups.has(m.UserOrGroupId)) {
                    visitedGroups.add(m.UserOrGroupId);
                    originIndexes.forEach(oi => nextFrontier.push({ groupId: m.UserOrGroupId, originIndex: oi }));
                }
            });
            frontier = nextFrontier;
            depth++;
        }
        if (frontier.length > 0) truncated.value = true;

        // Resolve display names: resolved users + any groups referenced directly in share rows (for "via" labels).
        const userIds = [...resolvedUsers.keys()];
        const topGroupIds = shareRows.filter(r => r.UserOrGroupId.startsWith('00G')).map(r => r.UserOrGroupId);
        const nameRequests = [];
        if (userIds.length) {
            nameRequests.push({
                method: 'GET', referenceId: 'users',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(`SELECT Id, Name, Username, IsActive FROM User WHERE Id IN (${userIds.map(id => `'${soqlEscape(id)}'`).join(',')})`)}`
            });
        }
        if (topGroupIds.length) {
            nameRequests.push({
                method: 'GET', referenceId: 'groups',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(`SELECT Id, Name, Type FROM Group WHERE Id IN (${topGroupIds.map(id => `'${soqlEscape(id)}'`).join(',')})`)}`
            });
        }
        let userInfo = {};
        let groupInfo = {};
        if (nameRequests.length) {
            const nameResults = await compositeRequest(nameRequests);
            if (nameResults.users && nameResults.users.httpStatusCode < 300) {
                (nameResults.users.body.records || []).forEach(u => { userInfo[u.Id] = u; });
            }
            if (nameResults.groups && nameResults.groups.httpStatusCode < 300) {
                (nameResults.groups.body.records || []).forEach(g => { groupInfo[g.Id] = g; });
            }
        }
        origins.forEach(o => { if (o.groupId && groupInfo[o.groupId]) o.groupName = `${groupInfo[o.groupId].Name} (${groupInfo[o.groupId].Type})`; });

        renderWhoCanSee({
            objectLabel: objectInfo.label,
            recordId,
            ownerId: recordRow ? recordRow.OwnerId : null,
            ownerLabel: recordRow && recordRow.Owner ? recordRow.Owner.Name : null,
            resolvedUsers,
            origins,
            userInfo,
            unresolvedPrincipals,
            shareError,
            truncated: truncated.value
        });
    } catch (e) {
        showError(e.message);
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
        updateCheckButtonState();
    }
};

function renderWhoCanSee({ objectLabel, recordId, ownerId, ownerLabel, resolvedUsers, origins, userInfo, unresolvedPrincipals, shareError, truncated }) {
    const panel = document.getElementById('resultsPanel');
    let html = '';

    html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div class="text-xs text-gray-400 mb-1">${escapeHtml(objectLabel)} · <span class="font-mono">${escapeHtml(recordId)}</span></div>
        <div class="text-sm font-semibold">${resolvedUsers.size} user${resolvedUsers.size === 1 ? '' : 's'} can access this record${ownerLabel ? ` (owned by ${escapeHtml(ownerLabel)})` : ''}</div>
        ${shareError ? `<p class="text-xs text-gray-400 mt-2">${escapeHtml(shareError)}</p>` : ''}
        ${truncated ? `<p class="text-xs text-amber-600 dark:text-amber-400 mt-2">List truncated at ${GROUP_EXPANSION_MAX_USERS} users or ${GROUP_EXPANSION_MAX_DEPTH} nested group levels — large public groups/queues may not be fully expanded.</p>` : ''}
    </div>`;

    const rows = [...resolvedUsers.entries()].map(([userId, originIndexes]) => {
        const u = userInfo[userId];
        const causes = [...originIndexes].map(i => {
            const o = origins[i];
            if (!o) return null;
            const label = ROW_CAUSE_LABELS[o.rowCause] || o.rowCause;
            return o.groupName ? `${label} via ${o.groupName}` : label;
        }).filter(Boolean);
        return {
            userId,
            name: u ? u.Name : userId,
            username: u ? u.Username : '',
            active: u ? u.IsActive : true,
            isOwner: userId === ownerId,
            causes: [...new Set(causes)]
        };
    }).sort((a, b) => (b.isOwner - a.isOwner) || a.name.localeCompare(b.name));

    html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <table class="min-w-full text-xs">
            <thead class="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                    <th class="px-4 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">User</th>
                    <th class="px-4 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">Granted via</th>
                </tr>
            </thead>
            <tbody>
                ${rows.length === 0 ? `<tr><td colspan="2" class="text-center text-gray-400 py-6">No access found for this record.</td></tr>` : rows.map(r => `
                <tr class="border-t border-gray-100 dark:border-gray-700/50">
                    <td class="px-4 py-2 whitespace-nowrap">
                        <div class="font-medium ${r.active ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 line-through'}">${escapeHtml(r.name)}${r.isOwner ? ' <span class="text-[10px] font-medium text-primary-600 dark:text-primary-400 align-middle">(Owner)</span>' : ''}</div>
                        <div class="text-[11px] text-gray-400">${escapeHtml(r.username)}</div>
                    </td>
                    <td class="px-4 py-2 text-gray-500 dark:text-gray-400">${r.causes.map(escapeHtml).join('; ') || '—'}</td>
                </tr>`).join('')}
            </tbody>
        </table>
    </div>`;

    if (unresolvedPrincipals.length > 0) {
        html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
            <h3 class="text-sm font-semibold mb-2">Not expanded</h3>
            <p class="text-xs text-gray-400 mb-2">These share rows grant access to something other than a User or Group (e.g. a Territory) and aren't expanded into individual users here.</p>
            <div class="space-y-1.5">${unresolvedPrincipals.map(p => `
                <div class="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/50 rounded-md px-3 py-2">
                    <span class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(ROW_CAUSE_LABELS[p.rowCause] || p.rowCause)}</span>
                    <span class="text-gray-400 font-mono">${escapeHtml(p.id)}</span>
                    <span class="font-mono text-gray-500 dark:text-gray-400">${escapeHtml(p.accessLevel)}</span>
                </div>`).join('')}</div>
        </div>`;
    }

    panel.innerHTML = html;
    panel.classList.remove('hidden');
}

// --- Object / Field access (Profile + Permission Sets merged) ---

const OBJECT_PERM_FIELDS = [
    { key: 'PermissionsCreate', label: 'Create' },
    { key: 'PermissionsRead', label: 'Read' },
    { key: 'PermissionsEdit', label: 'Edit' },
    { key: 'PermissionsDelete', label: 'Delete' },
    { key: 'PermissionsViewAllRecords', label: 'View All' },
    { key: 'PermissionsModifyAllRecords', label: 'Modify All' }
];

let _fieldAccessRows = []; // cached for client-side filtering

window.checkObjectAccess = async function () {
    clearError();
    if (!_selectedUser) return;
    const objectVal = document.getElementById('objectInput').value.trim();
    if (!objectVal) return;

    const btn = document.getElementById('checkAccessBtn');
    const spinner = document.getElementById('checkSpinner');
    btn.disabled = true;
    spinner.classList.remove('hidden');
    document.getElementById('resultsPanel').classList.add('hidden');

    try {
        await ensureKeyPrefixMap();
        const objectInfo = resolveObjectByName(objectVal);
        if (!objectInfo) throw new Error(`Unknown object "${objectVal}". Pick one from the list.`);

        const psaData = await soqlQuery(
            `SELECT PermissionSetId, PermissionSet.Label, PermissionSet.IsOwnedByProfile FROM PermissionSetAssignment WHERE AssigneeId = '${soqlEscape(_selectedUser.Id)}'`
        );
        const assignments = psaData.records || [];
        if (assignments.length === 0) {
            renderObjectAccess({ objectLabel: objectInfo.label, objectName: objectInfo.name, objectPerms: null, fieldRows: [], contributors: [] });
            return;
        }
        const permSetIds = assignments.map(a => a.PermissionSetId);
        const labelById = {};
        assignments.forEach(a => {
            labelById[a.PermissionSetId] = a.PermissionSet.IsOwnedByProfile ? `${a.PermissionSet.Label} (Profile)` : a.PermissionSet.Label;
        });
        const idList = permSetIds.map(id => `'${soqlEscape(id)}'`).join(',');

        const results = await compositeRequest([
            {
                method: 'GET', referenceId: 'objPerm',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT ParentId, PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE SobjectType = '${soqlEscape(objectInfo.name)}' AND ParentId IN (${idList})`
                )}`
            },
            {
                method: 'GET', referenceId: 'fieldPerm',
                url: `/services/data/v58.0/query/?q=${encodeURIComponent(
                    `SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE SobjectType = '${soqlEscape(objectInfo.name)}' AND ParentId IN (${idList})`
                )}`
            },
            { method: 'GET', referenceId: 'describe', url: `/services/data/v58.0/sobjects/${encodeURIComponent(objectInfo.name)}/describe` }
        ]);

        // Object-level: OR across permission sets, tracking which ones granted each permission.
        const objectPerms = {};
        OBJECT_PERM_FIELDS.forEach(f => { objectPerms[f.key] = new Set(); });
        if (results.objPerm && results.objPerm.httpStatusCode < 300) {
            (results.objPerm.body.records || []).forEach(row => {
                OBJECT_PERM_FIELDS.forEach(f => {
                    if (row[f.key]) objectPerms[f.key].add(labelById[row.ParentId] || row.ParentId);
                });
            });
        }

        // Field-level: merge Read/Edit per field, tracking contributing permission sets.
        const fieldPermMap = new Map(); // Field API name -> { read: Set, edit: Set }
        if (results.fieldPerm && results.fieldPerm.httpStatusCode < 300) {
            (results.fieldPerm.body.records || []).forEach(row => {
                const fieldName = row.Field.includes('.') ? row.Field.split('.').slice(1).join('.') : row.Field;
                if (!fieldPermMap.has(fieldName)) fieldPermMap.set(fieldName, { read: new Set(), edit: new Set() });
                const entry = fieldPermMap.get(fieldName);
                if (row.PermissionsRead) entry.read.add(labelById[row.ParentId] || row.ParentId);
                if (row.PermissionsEdit) entry.edit.add(labelById[row.ParentId] || row.ParentId);
            });
        }

        let describeFields = [];
        if (results.describe && results.describe.httpStatusCode < 300) {
            describeFields = results.describe.body.fields || [];
        }

        const fieldRows = describeFields.map(f => {
            const perm = fieldPermMap.get(f.name);
            return {
                name: f.name,
                label: f.label,
                type: f.type,
                flsControlled: !!perm,
                read: perm ? [...perm.read] : [],
                edit: perm ? [...perm.edit] : []
            };
        }).sort((a, b) => a.label.localeCompare(b.label));

        renderObjectAccess({
            objectLabel: objectInfo.label,
            objectName: objectInfo.name,
            objectPerms,
            fieldRows,
            contributors: [...new Set(Object.values(labelById))]
        });
    } catch (e) {
        showError(e.message);
    } finally {
        btn.disabled = false;
        spinner.classList.add('hidden');
        updateCheckButtonState();
    }
};

function objectPermBadge(label, contributors) {
    const has = contributors && contributors.size > 0;
    const title = has ? `via ${[...contributors].join(', ')}` : '';
    return `<div title="${escapeHtml(title)}">
        <div class="text-gray-400 mb-1">${escapeHtml(label)}</div>
        ${accessBadge(has)}
    </div>`;
}

function renderObjectAccess({ objectLabel, objectName, objectPerms, fieldRows, contributors }) {
    const panel = document.getElementById('resultsPanel');
    _fieldAccessRows = fieldRows || [];
    let html = '';

    html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
            <div>
                <div class="text-xs text-gray-400">${escapeHtml(objectLabel)} (${escapeHtml(objectName)})</div>
                <div class="text-sm font-semibold mt-0.5">${escapeHtml(_selectedUser.Name)}</div>
            </div>
        </div>`;

    if (!objectPerms) {
        html += `<p class="text-xs text-gray-400">This user has no Permission Set (or Profile) assignments — no access.</p></div>`;
    } else {
        html += `<div class="grid grid-cols-3 sm:grid-cols-6 gap-3 text-xs">
            ${OBJECT_PERM_FIELDS.map(f => objectPermBadge(f.label, objectPerms[f.key])).join('')}
        </div>
        <div class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-400">
            Assigned: ${contributors.map(escapeHtml).join(', ') || '—'}
        </div>
        </div>`;
    }

    html += `<div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
        <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700">
            <input type="text" id="fieldFilterInput" placeholder="Filter fields..."
                class="w-full sm:w-64 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none dark:placeholder-gray-500">
        </div>
        <div class="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table class="min-w-full text-xs">
                <thead class="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                    <tr>
                        <th class="px-4 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">Field</th>
                        <th class="px-4 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">Read</th>
                        <th class="px-4 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-[11px]">Edit</th>
                    </tr>
                </thead>
                <tbody id="fieldAccessBody"></tbody>
            </table>
        </div>
    </div>`;

    panel.innerHTML = html;
    panel.classList.remove('hidden');
    renderFieldAccessTable('');
    document.getElementById('fieldFilterInput').addEventListener('input', (e) => renderFieldAccessTable(e.target.value));
}

function renderFieldAccessTable(filterText) {
    const q = filterText.trim().toLowerCase();
    const rows = _fieldAccessRows.filter(r => !q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    const tbody = document.getElementById('fieldAccessBody');
    if (!tbody) return;
    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-400 py-6">No fields match</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr class="border-t border-gray-100 dark:border-gray-700/50">
            <td class="px-4 py-2 whitespace-nowrap">
                <div class="font-medium text-gray-700 dark:text-gray-300">${escapeHtml(r.label)}</div>
                <div class="text-[11px] text-gray-400 font-mono">${escapeHtml(r.name)}</div>
            </td>
            <td class="px-4 py-2">${r.flsControlled ? accessBadge(r.read.length > 0) : '<span class="text-gray-400">N/A</span>'}</td>
            <td class="px-4 py-2">${r.flsControlled ? accessBadge(r.edit.length > 0) : '<span class="text-gray-400">N/A</span>'}</td>
        </tr>`).join('');
}
