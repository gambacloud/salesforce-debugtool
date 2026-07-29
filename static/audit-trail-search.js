// --- Salesforce OAuth (Implicit Flow) ---

let _oauthClientId = null;
let _instanceUrl = null;
let _sessionId = null;
let allRecords = [];
let sortState = { field: 'CreatedDate', dir: 'desc' };
let currentPage = 1;
const PAGE_SIZE = 100;

(async function initOAuth() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        _oauthClientId = data.clientId || null;
    } catch (e) { /* non-fatal */ }

    handleOAuthCallback();
    if (sessionStorage.getItem('oauth_audit')) applyStoredCredentials();
})();

function handleOAuthCallback() {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    const instanceUrl = params.get('instance_url');
    if (!accessToken || !instanceUrl) return;

    sessionStorage.setItem('oauth_audit', JSON.stringify({
        accessToken,
        instanceUrl: decodeURIComponent(instanceUrl)
    }));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    applyStoredCredentials();
}

function applyStoredCredentials() {
    const stored = sessionStorage.getItem('oauth_audit');
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
    const redirectUri = window.location.origin + '/audit-trail-search';
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
    sessionStorage.removeItem('oauth_audit');
    _instanceUrl = null;
    _sessionId = null;
    allRecords = [];
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('searchScreen').classList.add('hidden');
};

function connect(instanceUrl, sessionId) {
    _instanceUrl = instanceUrl;
    _sessionId = sessionId;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('searchScreen').classList.remove('hidden');
    const hostname = new URL(instanceUrl).hostname.split('.')[0];
    document.getElementById('connectedLabel').textContent = hostname;
    loadAuditTrail();
}

// --- Audit Trail loading ---

window.loadAuditTrail = async function () {
    const refreshBtn = document.getElementById('refreshBtn');
    const refreshSpinner = document.getElementById('refreshSpinner');
    const errorBox = document.getElementById('errorBox');
    refreshBtn.disabled = true;
    refreshSpinner.classList.remove('hidden');
    errorBox.classList.add('hidden');

    try {
        const q = `SELECT Id, Action, CreatedBy.Name, CreatedDate, Display, Section FROM SetupAuditTrail ORDER BY CreatedDate DESC`;
        const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(_instanceUrl)}&sessionId=${encodeURIComponent(_sessionId)}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        allRecords = data.records || [];
        document.getElementById('lastLoaded').textContent = new Date().toLocaleTimeString();
        document.getElementById('totalBadge').textContent = allRecords.length;
        populateSectionFilter();
        currentPage = 1;
        renderTable();
    } catch (e) {
        errorBox.textContent = e.message;
        errorBox.classList.remove('hidden');
    } finally {
        refreshBtn.disabled = false;
        refreshSpinner.classList.add('hidden');
    }
};

function populateSectionFilter() {
    const select = document.getElementById('sectionFilter');
    const current = select.value;
    const sections = [...new Set(allRecords.map(r => r.Section).filter(Boolean))].sort();
    select.innerHTML = '<option value="">All Sections</option>' +
        sections.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if (sections.includes(current)) select.value = current;
}

// --- Filtering / sorting / pagination ---

function getFiltered() {
    const userQ = document.getElementById('userFilter').value.trim().toLowerCase();
    const textQ = document.getElementById('textFilter').value.trim().toLowerCase();
    const section = document.getElementById('sectionFilter').value;
    const fromVal = document.getElementById('dateFrom').value;
    const toVal = document.getElementById('dateTo').value;
    const from = fromVal ? new Date(fromVal) : null;
    const to = toVal ? new Date(toVal) : null;

    return allRecords.filter(r => {
        if (userQ && !(r.CreatedBy?.Name || '').toLowerCase().includes(userQ)) return false;
        if (textQ) {
            const hay = `${r.Display || ''} ${r.Action || ''} ${r.Section || ''}`.toLowerCase();
            if (!hay.includes(textQ)) return false;
        }
        if (section && r.Section !== section) return false;
        const created = new Date(r.CreatedDate);
        if (from && created < from) return false;
        if (to && created > to) return false;
        return true;
    });
}

function sortRecords(records) {
    const { field, dir } = sortState;
    const mult = dir === 'asc' ? 1 : -1;
    return [...records].sort((a, b) => {
        let av, bv;
        if (field === 'User') {
            av = a.CreatedBy?.Name || '';
            bv = b.CreatedBy?.Name || '';
        } else if (field === 'CreatedDate') {
            av = new Date(a.CreatedDate).getTime();
            bv = new Date(b.CreatedDate).getTime();
        } else {
            av = a[field] || '';
            bv = b[field] || '';
        }
        if (av < bv) return -1 * mult;
        if (av > bv) return 1 * mult;
        return 0;
    });
}

window.setSort = function (field) {
    if (sortState.field === field) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState = { field, dir: field === 'CreatedDate' ? 'desc' : 'asc' };
    }
    currentPage = 1;
    renderTable();
};

window.changePage = function (delta) {
    currentPage += delta;
    renderTable();
};

window.clearFilters = function () {
    document.getElementById('dateFrom').value = '';
    document.getElementById('dateTo').value = '';
    document.getElementById('userFilter').value = '';
    document.getElementById('sectionFilter').value = '';
    document.getElementById('textFilter').value = '';
    currentPage = 1;
    renderTable();
};

function renderTable() {
    const filtered = sortRecords(getFiltered());
    document.getElementById('resultCountBadge').textContent = filtered.length;

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRecords = filtered.slice(start, start + PAGE_SIZE);

    const tbody = document.getElementById('resultsBody');
    if (pageRecords.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-sm text-gray-400 py-8">No records match your filters</td></tr>`;
    } else {
        tbody.innerHTML = pageRecords.map(r => `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700/50">
                <td class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">${new Date(r.CreatedDate).toLocaleString()}</td>
                <td class="px-4 py-2 text-xs font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">${escapeHtml(r.CreatedBy?.Name || 'Unknown')}</td>
                <td class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">${escapeHtml(r.Section || '-')}</td>
                <td class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">${escapeHtml(r.Action || '-')}</td>
                <td class="px-4 py-2 text-xs text-gray-700 dark:text-gray-300">${escapeHtml(r.Display || '-')}</td>
            </tr>`).join('');
    }

    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
    updateSortIndicators();
}

function updateSortIndicators() {
    document.querySelectorAll('[data-sort-field]').forEach(th => {
        const indicator = th.querySelector('.sort-indicator');
        if (!indicator) return;
        indicator.textContent = th.dataset.sortField === sortState.field
            ? (sortState.dir === 'asc' ? '▲' : '▼')
            : '';
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

// Wire up filter inputs to re-render on change
['dateFrom', 'dateTo', 'userFilter', 'sectionFilter', 'textFilter'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
        currentPage = 1;
        renderTable();
    });
});
