// Use Tailwind's dark mode class matching diff2html's theme system
const isDark = document.documentElement.classList.contains('dark');

// --- Salesforce OAuth (Implicit Flow) ---

let _oauthClientId = null;

(async function initOAuth() {
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        _oauthClientId = data.clientId || null;
    } catch (e) { /* non-fatal */ }

    handleOAuthCallback();
    ['source', 'target'].forEach(side => {
        if (sessionStorage.getItem(`oauth_${side}`)) applyOAuthCredentials(side);
    });
})();

function handleOAuthCallback() {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = params.get('access_token');
    const instanceUrl = params.get('instance_url');
    const state = params.get('state') || '';
    if (!accessToken || !instanceUrl) return;

    const side = state.startsWith('target') ? 'target' : 'source';
    sessionStorage.setItem(`oauth_${side}`, JSON.stringify({
        accessToken,
        instanceUrl: decodeURIComponent(instanceUrl)
    }));
    history.replaceState(null, '', window.location.pathname + window.location.search);
    applyOAuthCredentials(side);
}

function applyOAuthCredentials(side) {
    const stored = sessionStorage.getItem(`oauth_${side}`);
    if (!stored) return;
    const { accessToken, instanceUrl } = JSON.parse(stored);
    if (side === 'source') {
        document.getElementById('srcInstance').value = instanceUrl;
        document.getElementById('srcSession').value = accessToken;
    } else {
        document.getElementById('tgtInstance').value = instanceUrl;
        document.getElementById('tgtSession').value = accessToken;
    }
    _updateOAuthUI(side, instanceUrl);
}

function _updateOAuthUI(side, instanceUrl) {
    const prefix = side === 'source' ? 'src' : 'tgt';
    const hostname = instanceUrl ? new URL(instanceUrl).hostname.split('.')[0] : null;
    document.getElementById(`${prefix}LoginButtons`)?.classList.toggle('hidden', !!instanceUrl);
    document.getElementById(`${prefix}ConnectedPanel`)?.classList.toggle('hidden', !instanceUrl);
    const lbl = document.getElementById(`${prefix}ConnectedLabel`);
    if (lbl) lbl.textContent = hostname || instanceUrl || '';
    const alias = document.getElementById(`${prefix}OrgAliasLabel`);
    if (alias) alias.textContent = hostname ? `[${hostname}]` : '';
}

window.loginOrg = function (side, env) {
    if (!_oauthClientId) {
        alert('Salesforce Client ID not configured. Set SF_CLIENT_ID in Heroku config vars.');
        return;
    }
    const base = env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
    const nonce = Math.random().toString(36).substring(2, 10);
    const state = `${side}_${nonce}`;
    const redirectUri = window.location.origin + '/deploytool';
    window.location.href = `${base}/services/oauth2/authorize?response_type=token&client_id=${_oauthClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
};

window.disconnectOrg = function (side) {
    sessionStorage.removeItem(`oauth_${side}`);
    const prefix = side === 'source' ? 'src' : 'tgt';
    document.getElementById(`${prefix}Instance`).value = '';
    document.getElementById(`${prefix}Session`).value = '';
    _updateOAuthUI(side, null);
};

// DOM Elements
const srcInstance = document.getElementById('srcInstance');
const srcSession = document.getElementById('srcSession');
const tgtInstance = document.getElementById('tgtInstance');
const tgtSession = document.getElementById('tgtSession');
const packageXml = document.getElementById('packageXml');

const btnRetrieve = document.getElementById('btnRetrieve');
const btnDemo = document.getElementById('btnDemo');
const btnReset = document.getElementById('btnReset');
const btnValidate = document.getElementById('btnValidate');
const btnDeploy = document.getElementById('btnDeploy');

const retrieveStatus = document.getElementById('retrieveStatus');
const retrieveProgress = document.getElementById('retrieveProgress');
const retrieveMsg = document.getElementById('retrieveMsg');

const diffSection = document.getElementById('diffSection');
const emptyState = document.getElementById('emptyState');
const diffList = document.getElementById('diffList');
const diffCountBadge = document.getElementById('diffCountBadge');
const selectAll = document.getElementById('selectAll');

// Health Check DOM Elements
const tabDeploy = document.getElementById('tabDeploy');
const tabHealth = document.getElementById('tabHealth');
const tabHistory = document.getElementById('tabHistory');
const historyContainer = document.getElementById('historyContainer');
const historyDetail = document.getElementById('historyDetail');
const historyEmptyState = document.getElementById('historyEmptyState');
const targetOrgContainer = document.getElementById('targetOrgContainer');
const deployScopeContainer = document.getElementById('deployScopeContainer');
const healthCheckContainer = document.getElementById('healthCheckContainer');
const btnAnalyze = document.getElementById('btnAnalyze');
const healthEmptyState = document.getElementById('healthEmptyState');
const dependenciesSection = document.getElementById('dependenciesSection');
const componentNameInput = document.getElementById('componentNameInput');
const depList = document.getElementById('depList');
const depCountBadge = document.getElementById('depCountBadge');



const deployActionBar = document.getElementById('deployActionBar');
const deployStatus = document.getElementById('deployStatus');
const deployProgress = document.getElementById('deployProgress');
const deployMsg = document.getElementById('deployMsg');
const testClassesInput = document.getElementById('testClasses');
const testLevelInput = document.getElementById('testLevel');

const modal = document.getElementById('diffModal');
const closeModalBtn = document.getElementById('closeModal');
const modalTitle = document.getElementById('modalTitle');
const diffViewer = document.getElementById('diffViewer');

// UI Enhancements elements
const btnSwapOrgs = document.getElementById('btnSwapOrgs');
const selectedCountText = document.getElementById('selectedCountText');
const showSelectedOnly = document.getElementById('showSelectedOnly');
const statusFilter = document.getElementById('statusFilter');

const tgtOrgAliasLabel = document.getElementById('tgtOrgAliasLabel');
const fastCompareToggle = document.getElementById('fastCompareToggle');

// State
let srcZip = null;
let tgtZip = null;
let changedFiles = [];
let testClassNames = [];

// --- IndexedDB History Storage ---
const HISTORY_DB_NAME = 'sfdc-deploy-history';
const HISTORY_DB_VERSION = 1;
const HISTORY_MAX = 50;

function openHistoryDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('history')) {
                const store = db.createObjectStore('history', { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('historyFiles')) {
                db.createObjectStore('historyFiles', { keyPath: 'historyId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function loadHistory() {
    try {
        const db = await openHistoryDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('history', 'readonly');
            const store = tx.objectStore('history');
            const req = store.index('timestamp').getAll();
            req.onsuccess = () => resolve(req.result.reverse()); // newest first
            req.onerror = () => reject(req.error);
        });
    } catch { return []; }
}

async function saveHistoryEntry(entry, files) {
    const db = await openHistoryDB();
    const tx = db.transaction(['history', 'historyFiles'], 'readwrite');
    tx.objectStore('history').put(entry);
    tx.objectStore('historyFiles').put({ historyId: entry.id, files });

    // Enforce max entries
    const allReq = tx.objectStore('history').index('timestamp').getAll();
    allReq.onsuccess = () => {
        const all = allReq.result;
        if (all.length > HISTORY_MAX) {
            const toRemove = all.slice(0, all.length - HISTORY_MAX);
            toRemove.forEach(old => {
                tx.objectStore('history').delete(old.id);
                tx.objectStore('historyFiles').delete(old.id);
            });
        }
    };
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function getHistoryFiles(historyId) {
    const db = await openHistoryDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('historyFiles', 'readonly');
        const req = tx.objectStore('historyFiles').get(historyId);
        req.onsuccess = () => resolve(req.result?.files || []);
        req.onerror = () => reject(req.error);
    });
}

async function clearAllHistory() {
    const db = await openHistoryDB();
    const tx = db.transaction(['history', 'historyFiles'], 'readwrite');
    tx.objectStore('history').clear();
    tx.objectStore('historyFiles').clear();
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

async function updateHistoryTitle(id, title) {
    const db = await openHistoryDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('history', 'readwrite');
        const store = tx.objectStore('history');
        const req = store.get(id);
        req.onsuccess = () => {
            const entry = req.result;
            if (!entry) return resolve();
            entry.title = title || '';
            store.put(entry);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

// Presets Config
const presets = {
    code: ['ApexClass', 'ApexComponent', 'ApexPage', 'ApexTrigger', 'AuraDefinitionBundle', 'LightningComponentBundle'],
    nocode: ['Flow', 'ValidationRule'],
    config: ['CustomLabels', 'CustomMetadata', 'CustomField'],
    empty: []
};

// Metadata Type Mapping
const FOLDER_TO_TYPE_MAP = {
    'classes': 'ApexClass', 'pages': 'ApexPage', 'components': 'ApexComponent',
    'triggers': 'ApexTrigger', 'aura': 'AuraDefinitionBundle', 'lwc': 'LightningComponentBundle',
    'objects': 'CustomObject', 'layouts': 'Layout', 'permissionsets': 'PermissionSet',
    'profiles': 'Profile', 'customMetadata': 'CustomMetadata', 'labels': 'CustomLabels',
    'flows': 'Flow', 'workflows': 'Workflow', 'email': 'EmailTemplate',
    'roles': 'Role', 'groups': 'Group', 'queues': 'Queue', 'connectedApps': 'ConnectedApp',
    'approvalProcesses': 'ApprovalProcess', 'assignmentRules': 'AssignmentRule',
    'autoResponseRules': 'AutoResponseRule', 'escalationRules': 'EscalationRule',
    'postTemplate': 'PostTemplate', 'homePageLayouts': 'HomePageLayout',
    'homePageComponents': 'HomePageComponent', 'objectTranslations': 'CustomObjectTranslation',
    'flowDefinitions': 'FlowDefinition', 'weblinks': 'CustomPageWebLink',
    'tabs': 'CustomTab', 'applications': 'CustomApplication',
    'letterhead': 'Letterhead', 'reportTypes': 'ReportType',
    'reports': 'Report', 'dashboards': 'Dashboard'
};

// Returns true if a component name has a managed package namespace prefix (e.g. "myns__MyClass")
// Distinguishes from standard API suffixes like __c, __mdt, __e which are NOT namespace prefixes
function isManagedPackageComponent(componentName) {
    const withoutExt = componentName.split('.')[0];
    const match = withoutExt.match(/^([a-zA-Z][a-zA-Z0-9]{0,14})__(.+)/);
    if (!match) return false;
    // If the part after __ is a standard Salesforce suffix, it's not a namespace prefix
    const standardSuffixes = /^(c|mdt|e|b|x|ka|kav|share|history|feed|changeEvent)(__.*)?$/i;
    return !standardSuffixes.test(match[2]);
}

// Salesforce Setup URL builder
function getSfSetupUrl(instanceUrl, typeName, componentName) {
    if (!instanceUrl) return null;
    const base = instanceUrl.replace(/\/$/, '');
    // Strip file extension for the component name
    const name = componentName.replace(/\.(cls|trigger|page|component|js|css|html|xml|cmp|design|svg|app)(-meta\.xml)?$/i, '');
    const searchBase = `${base}/lightning/setup`;
    const typeMap = {
        'ApexClass': `${searchBase}/ApexClasses/home`,
        'ApexTrigger': `${searchBase}/ApexTriggers/home`,
        'ApexPage': `${searchBase}/ApexPages/home`,
        'ApexComponent': `${searchBase}/ApexComponents/home`,
        'LightningComponentBundle': `${searchBase}/LightningComponentBundles/home`,
        'AuraDefinitionBundle': `${searchBase}/LightningComponentBundles/home`,
        'Flow': `${searchBase}/Flows/home`,
        'CustomObject': `${searchBase}/ObjectManager/${name}/Details/view`,
        'Layout': `${searchBase}/ObjectManager/home`,
        'PermissionSet': `${searchBase}/PermSets/home`,
        'Profile': `${searchBase}/Profiles/home`,
        'ValidationRule': `${searchBase}/ObjectManager/home`,
        'CustomLabels': `${searchBase}/ExternalStrings/home`,
        'CustomMetadata': `${searchBase}/CustomMetadata/home`,
    };
    return typeMap[typeName] || null;
}

// --- Alpine.js Component for Manifest Builder ---
document.addEventListener('alpine:init', () => {
    Alpine.data('manifestBuilder', () => ({
        searchQuery: '',
        memberSelections: {}, // type -> Array of names

        // Comprehensive list of common Salesforce Metadata Types
        allAvailableTypes: [
            'ApexClass', 'ApexComponent', 'ApexPage', 'ApexTrigger', 'AppMenu', 'ApprovalProcess', 'AssignmentRules',
            'AuraDefinitionBundle', 'AuthProvider', 'AutoResponseRules', 'Certificate', 'CleanDataService',
            'Community', 'CompactLayout', 'ConnectedApp', 'ContentAsset', 'CorsWhitelistOrigin', 'CustomApplication',
            'CustomApplicationComponent', 'CustomField', 'CustomLabels', 'CustomMetadata', 'CustomObject',
            'CustomObjectTranslation', 'CustomPageWebLink', 'CustomPermission', 'CustomSite', 'CustomTab',
            'Dashboard', 'DataCategoryGroup', 'DelegateGroup', 'Document', 'DuplicateRule', 'EmailTemplate',
            'EntitlementProcess', 'EntitlementTemplate', 'EscalationRules', 'ExternalDataSource', 'FlexiPage',
            'Flow', 'FlowDefinition', 'GlobalValueSet', 'GlobalValueSetTranslation', 'Group', 'HomePageComponent',
            'HomePageLayout', 'Layout', 'Letterhead', 'LightningComponentBundle', 'ListView', 'MatchingRules',
            'MilestoneType', 'NamedCredential', 'Network', 'PathAssistant', 'PermissionSet', 'PermissionSetGroup',
            'PlatformCachePartition', 'PlatformEventChannel', 'PostTemplate', 'PresenceDeclineReason',
            'PresenceUserConfig', 'Profile', 'ProfilePasswordPolicy', 'ProfileSessionSetting', 'Queue',
            'QueueRoutingConfig', 'QuickAction', 'RecordType', 'RemoteSiteSetting', 'Report', 'ReportType',
            'Role', 'SamlSsoConfig', 'Scontrol', 'ServiceChannel', 'ServicePresenceStatus', 'SharingRules',
            'StandardValueSet', 'StandardValueSetTranslation', 'StaticResource', 'TransactionSecurityPolicy',
            'Translations', 'ValidationRule', 'WebLink', 'Workflow'
        ].sort(),

        selectedTypes: ['ApexClass'],

        get filteredAvailableTypes() {
            if (this.searchQuery === '') return this.allAvailableTypes;
            const q = this.searchQuery.toLowerCase();
            return this.allAvailableTypes.filter(t => t.toLowerCase().includes(q));
        },

        get generatedXml() {
            if (this.selectedTypes.length === 0) {
                return `<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n  <version>58.0</version>\n</Package>`;
            }

            let xml = `<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
            this.selectedTypes.forEach(type => {
                xml += `  <types>\n`;
                const members = this.memberSelections[type] || [];
                if (members.length === 0) {
                    xml += `    <members>*</members>\n`;
                } else {
                    members.forEach(m => {
                        xml += `    <members>${m}</members>\n`;
                    });
                }
                xml += `    <name>${type}</name>\n  </types>\n`;
            });
            xml += `  <version>58.0</version>\n</Package>`;
            return xml;
        },

        addType(type) {
            if (!this.selectedTypes.includes(type)) {
                this.selectedTypes.push(type);
                this.selectedTypes.sort();
            }
        },

        removeType(type) {
            this.selectedTypes = this.selectedTypes.filter(t => t !== type);
            delete this.memberSelections[type];
        },

        loadPreset(presetName) {
            if (presets[presetName]) {
                this.selectedTypes = [...presets[presetName]].sort();
                this.memberSelections = {};
            }
        },

    }));

    Alpine.store('deploy', {
        show: false,
        status: 'Idle',
        progress: 0,
        jobId: '',
        isCheckOnly: false,
        logs: [],
        deployed: 0,
        total: 0,
        errors: 0,
        coverage: 0,
        classCoverage: [],
        startTime: null,
        processedIds: new Set(), // To avoid duplicate logs

        reset(isCheckOnly) {
            this.show = true;
            this.startTime = Date.now();
            this.status = 'Queued';
            this.progress = 0;
            this.jobId = 'Pending...';
            this.isCheckOnly = isCheckOnly;
            this.logs = [];
            this.deployed = 0;
            this.total = 0;
            this.errors = 0;
            this.coverage = 0;
            this.classCoverage = [];
            this.processedIds = new Set();
            
            // Clear the actual terminal DOM if needed, though logs is reactive
            this.addLog('info', `Initializing ${isCheckOnly ? 'validation' : 'deployment'} sequence...`);
        },

        addLog(type, msg, id = null) {
            if (id && this.processedIds.has(id)) return;
            if (id) this.processedIds.add(id);

            this.logs.push({
                id: Date.now() + Math.random(),
                type: type || 'default',
                msg: msg
            });

            // Auto-scroll terminal
            setTimeout(() => {
                const el = document.getElementById('terminalLog');
                if (el) el.scrollTop = el.scrollHeight;
            }, 10);
        }
    });

    // History Panel (sidebar list)
    Alpine.data('historyPanel', () => ({
        entries: [],
        selected: null,
        editingTitleId: null,

        async init() {
            this.entries = await loadHistory();
            window.addEventListener('history-updated', async () => {
                this.entries = await loadHistory();
            });
        },

        async select(entry) {
            this.selected = entry;
            window.dispatchEvent(new CustomEvent('history-select', { detail: entry }));
        },

        startEditTitle(entry) {
            this.editingTitleId = entry.id;
            this.$nextTick(() => {
                const input = document.querySelector(`[data-title-input="${entry.id}"]`);
                if (input) { input.focus(); input.select(); }
            });
        },

        async saveTitle(entry, title) {
            if (this.editingTitleId !== entry.id) return;
            this.editingTitleId = null;
            title = title.trim();
            if (title === (entry.title || '')) return;
            entry.title = title;
            await updateHistoryTitle(entry.id, title);
        },

        async clearAll() {
            if (!confirm('Clear all deployment history?')) return;
            await clearAllHistory();
            this.entries = [];
            this.selected = null;
            window.dispatchEvent(new CustomEvent('history-select', { detail: null }));
        }
    }));

    // History Detail (main content)
    Alpine.data('historyDetail', () => ({
        entry: null,
        files: [],

        init() {
            window.addEventListener('history-select', async (e) => {
                this.entry = e.detail;
                if (this.entry) {
                    this.files = await getHistoryFiles(this.entry.id);
                    historyDetail.classList.remove('hidden');
                    historyEmptyState.classList.add('hidden');
                } else {
                    this.files = [];
                    historyDetail.classList.add('hidden');
                    historyEmptyState.classList.remove('hidden');
                }
            });
        },

        formatDuration(ms) {
            if (!ms) return '';
            const s = Math.floor(ms / 1000);
            return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
        },

        showHistoryDiff(file) {
            _currentDiffFile = file.name;
            _currentDiffIdx = null;
            _currentCoverage = null;
            const coverageBar = document.getElementById('coverageSummaryBar');
            if (coverageBar) coverageBar.classList.add('hidden');
            const btnCov = document.getElementById('btnShowCoverage');
            if (btnCov) {
                if (isApexFile(file.name)) { btnCov.classList.remove('hidden'); } else { btnCov.classList.add('hidden'); }
            }

            const cleanName = file.name.replace('unpackaged/', '');
            const srcLabel = this.entry?.sourceOrg ? new URL(this.entry.sourceOrg).hostname.split('.')[0] : 'Source';
            const tgtLabel = this.entry?.targetOrg ? new URL(this.entry.targetOrg).hostname.split('.')[0] : 'Target';

            modalTitle.innerHTML = `<span class="text-lg font-bold">${cleanName}</span>
                <span class="ml-3 text-xs font-mono text-gray-400">\u2B05 ${tgtLabel} &nbsp;|&nbsp; \u27A1 ${srcLabel}</span>`;

            const ignoreWs = document.getElementById('ignoreWhitespace')?.checked;
            let srcText = file.srcContent;
            let tgtText = file.tgtContent;
            if (ignoreWs) {
                const normalize = s => s.split('\n').map(l => l.trimEnd()).join('\n');
                srcText = normalize(srcText);
                tgtText = normalize(tgtText);
            }

            const patch = Diff.createTwoFilesPatch(
                `\u2B05 TARGET (${tgtLabel})`, `\u27A1 SOURCE (${srcLabel})`,
                tgtText, srcText
            );
            const currentIsDark = document.documentElement.classList.contains('dark');
            diffViewer.innerHTML = Diff2Html.html(patch, {
                drawFileList: false, matching: 'lines',
                outputFormat: 'side-by-side', theme: currentIsDark ? 'dark' : 'light'
            });
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.querySelector('.transform')?.classList.add('scale-100', 'opacity-100');
                modal.querySelector('.transform')?.classList.remove('scale-95', 'opacity-0');
            }, 10);
        }
    }));
});
// ------------------------------------------------
// Utils
function extractZipFromSoap(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");
    
    // Check for SOAP faults first
    const faultStringNode = xmlDoc.getElementsByTagName("faultstring")[0] || xmlDoc.getElementsByTagName("soapenv:faultstring")[0];
    if (faultStringNode) {
        throw new Error(`SOAP Error: ${faultStringNode.textContent}`);
    }

    const resultNode = xmlDoc.getElementsByTagName("result")[0] || xmlDoc.getElementsByTagName("met:result")[0];
    if (!resultNode) {
        const snippet = (xmlString || "").substring(0, 500);
        throw new Error(`Result node not found in SOAP response. Raw response snippet: ${snippet}`);
    }

    const successNode = xmlDoc.getElementsByTagName("success")[0] || xmlDoc.getElementsByTagName("met:success")[0];
    if (successNode && successNode.textContent === 'false') {
        const msgNode = xmlDoc.getElementsByTagName("errorMessage")[0] || xmlDoc.getElementsByTagName("met:errorMessage")[0];
        throw new Error(msgNode ? msgNode.textContent : "Unknown API Error");
    }

    const zipNode = xmlDoc.getElementsByTagName("zipFile")[0] || xmlDoc.getElementsByTagName("met:zipFile")[0];
    if (zipNode) return zipNode.textContent;
    throw new Error("Could not find ZIP file string in response.");
}

async function fetchMetadata(instanceUrl, sessionId, xmlPayload, useFastCompare = false) {
    let finalZip = new JSZip();
    let typesToRetrieve = []; // Array of objects { name, members }

    // 1. Parse XML payload to know what to fetch
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlPayload, "text/xml");
    const typesNodes = xmlDoc.getElementsByTagName("types");
    
    for (const typeNode of typesNodes) {
        const nameNode = typeNode.getElementsByTagName("name")[0];
        if (nameNode) {
            const typeName = nameNode.textContent;
            const members = [];
            const memberNodes = typeNode.getElementsByTagName("members");
            for (const m of memberNodes) {
                members.push(m.textContent);
            }
            typesToRetrieve.push({ name: typeName, members: members });
        }
    }

    // 2. Identify Fast Types vs Slow Types
    const supportedFastTypes = ['ApexClass', 'ApexTrigger', 'ApexComponent', 'ApexPage'];
    const fastTypes = [];
    const slowTypes = [];

    if (useFastCompare) {
        typesToRetrieve.forEach(t => {
            if (supportedFastTypes.includes(t.name)) fastTypes.push(t);
            else slowTypes.push(t);
        });
    } else {
        slowTypes.push(...typesToRetrieve);
    }

    // 3. Prepare Concurrent Promises
    const promises = [];

    // 3a. Standard Metadata API Retrieve for Slow Types
    if (slowTypes.length > 0) {
        // Build a restricted package.xml just for the slow types
        let restrictedXml = `<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
        slowTypes.forEach(type => {
            restrictedXml += `  <types>\n`;
            type.members.forEach(m => {
                restrictedXml += `    <members>${m}</members>\n`;
            });
            restrictedXml += `    <name>${type.name}</name>\n  </types>\n`;
        });
        restrictedXml += `  <version>58.0</version>\n</Package>`;

        const mdPromise = fetch('/api/proxy/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instanceUrl, sessionId, unpackagedXml: restrictedXml })
        }).then(async res => {
            if (!res.ok) throw new Error(`Proxy Error: ${await res.text()}`);
            const mdZip = new JSZip();
            await mdZip.loadAsync(await res.arrayBuffer());

            // Merge into finalZip
            mdZip.forEach((relativePath, file) => {
                finalZip.file(relativePath, file.async('arraybuffer'));
            });
        });
        promises.push(mdPromise);
    }

    // 3b. REST API Fast Fetch for Code
    if (fastTypes.length > 0) {
        const restPromise = fetchCodeViaRestApi(instanceUrl, sessionId, fastTypes).then(fastZip => {
            // Merge into finalZip
            fastZip.forEach((relativePath, file) => {
                finalZip.file(relativePath, file.async('arraybuffer'));
            });
        });
        promises.push(restPromise);
    }

    // 4. Wait for Both Streams
    await Promise.all(promises);

    return finalZip;
}

async function fetchCodeViaRestApi(instanceUrl, sessionId, typeConfigs) {
    const zip = new JSZip();
    
    const CHUNK_SIZE = 100;

    const fetchType = async (config) => {
        const type = config.name;
        const members = config.members;

        let folder = "";
        let ext = "";

        if (type === 'ApexClass') { folder = "classes"; ext = ".cls"; }
        else if (type === 'ApexTrigger') { folder = "triggers"; ext = ".trigger"; }
        else if (type === 'ApexPage') { folder = "pages"; ext = ".page"; }
        else if (type === 'ApexComponent') { folder = "components"; ext = ".component"; }

        // ApexClass/Trigger use 'Body', ApexPage/Component use 'Markup'
        const contentField = (type === 'ApexPage' || type === 'ApexComponent') ? 'Markup' : 'Body';

        const fetchChunk = async (chunkMembers) => {
            let where = "";
            if (chunkMembers.length > 0 && !chunkMembers.includes('*')) {
                const escapedNames = chunkMembers.map(m => `'${m}'`).join(',');
                where = ` WHERE Name IN (${escapedNames})`;
            }
            const q = `SELECT Name, ${contentField}, ApiVersion, Status, NamespacePrefix FROM ${type}${where}`;
            const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(instanceUrl)}&sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`REST API Error for ${type}: ${await res.text()}`);
            const data = await res.json();
            return data.records || [];
        };

        let allRecords;
        const isWildcard = members.length === 0 || members.includes('*');
        if (isWildcard) {
            allRecords = await fetchChunk(members);
        } else {
            const chunks = [];
            for (let i = 0; i < members.length; i += CHUNK_SIZE) {
                chunks.push(members.slice(i, i + CHUNK_SIZE));
            }
            const results = await Promise.all(chunks.map(chunk => fetchChunk(chunk)));
            allRecords = results.flat();
        }

        // Assemble Virtual Files
        for (const record of allRecords) {
            // Respect namespaces
            const prefix = record.NamespacePrefix ? `${record.NamespacePrefix}__` : '';
            const fileName = `${prefix}${record.Name}${ext}`;
            const compPath = `unpackaged/${folder}/${fileName}`;
            const metaPath = `unpackaged/${folder}/${fileName}-meta.xml`;

            // The code body is either in Body (Class/Trigger) or Markup (Page/Component)
            const bodyContent = record.Body || record.Markup || '';
            zip.file(compPath, bodyContent);

            // Generate virtual meta.xml
            let metaStatus = record.Status ? `<status>${record.Status}</status>\n` : '';
            let metaApi = record.ApiVersion ? `<apiVersion>${record.ApiVersion}</apiVersion>\n` : '';
            
            // Generate valid meta xml envelope based on type
            let metaXml = `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
            if (type === 'ApexPage' || type === 'ApexComponent') {
                metaXml += `    <label>${record.Name}</label>\n`;
            }
            if (metaApi) metaXml += `    ${metaApi}`;
            if (metaStatus) metaXml += `    ${metaStatus}`;
            metaXml += `</${type}>`;

            zip.file(metaPath, metaXml);
        }
    };

    const typePromises = typeConfigs.map(t => fetchType(t));
    await Promise.all(typePromises);
    
    // Virtual package.xml
    zip.file('unpackaged/package.xml', '<?xml version="1.0" encoding="UTF-8"?><Package><version>58.0</version></Package>');
    
    return zip;
}

function setProgress(bar, msgElem, percent, msg, isError = false) {
    if (percent !== null) bar.style.width = `${percent}%`;
    if (msg) msgElem.innerText = msg;

    if (isError) {
        bar.classList.remove('bg-blue-600', 'bg-emerald-600');
        bar.classList.add('bg-red-500');
        msgElem.classList.add('text-red-600', 'dark:text-red-400');
    } else {
        bar.classList.remove('bg-red-500');
        msgElem.classList.remove('text-red-600', 'dark:text-red-400');
    }
}

// Retrieve Flow
btnRetrieve.addEventListener('click', async () => {
    if (!srcSession.value || !tgtSession.value) {
        alert("Please provide both Source and Target session IDs.");
        return;
    }

    retrieveStatus.classList.remove('hidden');
    emptyState.classList.add('hidden');
    diffSection.classList.add('hidden');
    deployActionBar.style.display = 'none';
    btnRetrieve.disabled = true;
    btnRetrieve.innerHTML = `<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Processing...`;

    try {
        setProgress(retrieveProgress, retrieveMsg, 10, 'Initiating Retrieve for Source and Target orgs...', false);

        const xml = packageXml.value;
        const useFastCompare = fastCompareToggle ? fastCompareToggle.checked : false;

        const [src, tgt] = await Promise.all([
            fetchMetadata(srcInstance.value, srcSession.value, xml, useFastCompare).catch(e => { throw new Error(`Source Org Error: ${e.message}`); }),
            fetchMetadata(tgtInstance.value, tgtSession.value, xml, useFastCompare).catch(e => { throw new Error(`Target Org Error: ${e.message}`); })
        ]);

        srcZip = src;
        tgtZip = tgt;

        setProgress(retrieveProgress, retrieveMsg, 60, 'Metadata retrieved. Comparing files...', false);
        await compareZips(src, tgt);
        await detectTestClasses(src);

        setProgress(retrieveProgress, retrieveMsg, 80, 'Fetching Last Modified data...', false);
        await fetchLastModifiedData(srcInstance.value, srcSession.value);

        setProgress(retrieveProgress, retrieveMsg, 100, `Comparison complete. Found ${changedFiles.length} differences.`, false);

        setProgress(retrieveProgress, retrieveMsg, 100, `Comparison complete. Found ${changedFiles.length} differences.`, false);
        diffCountBadge.textContent = `${changedFiles.length} files`;
        renderDiffTable();
        diffSection.classList.remove('hidden');
        deployActionBar.style.display = 'flex';

    } catch (err) {
        setProgress(retrieveProgress, retrieveMsg, 100, err.message, true);
    } finally {
        btnRetrieve.disabled = false;
        btnRetrieve.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg> Fetch & Compare`;
    }
});

btnSwapOrgs.addEventListener('click', () => {
    const tempInstance = srcInstance.value;
    const tempSession = srcSession.value;
    const tempAlias = srcOrgAliasLabel.textContent;
    
    srcInstance.value = tgtInstance.value;
    srcSession.value = tgtSession.value;
    srcOrgAliasLabel.textContent = tgtOrgAliasLabel.textContent;
    
    tgtInstance.value = tempInstance;
    tgtSession.value = tempSession;
    tgtOrgAliasLabel.textContent = tempAlias;
});

// --- Application Mode Toggling ---
function setAppMode(mode) {
    const activeTabClasses = ['bg-white', 'text-gray-900', 'dark:bg-gray-600', 'dark:text-white', 'shadow-sm'];
    const inactiveTabClasses = ['text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200', 'bg-transparent'];

    // Reset all tabs to inactive
    [tabDeploy, tabHealth, tabHistory].forEach(tab => {
        tab.classList.remove(...activeTabClasses);
        tab.classList.add(...inactiveTabClasses);
    });

    // Hide all content areas
    targetOrgContainer.classList.add('hidden');
    deployScopeContainer.classList.add('hidden');
    healthCheckContainer.classList.add('hidden');
    historyContainer.classList.add('hidden');
    emptyState.classList.add('hidden');
    diffSection.classList.add('hidden');
    deployActionBar.style.display = 'none';
    healthEmptyState.classList.add('hidden');
    dependenciesSection.classList.add('hidden');
    historyDetail.classList.add('hidden');
    historyEmptyState.classList.add('hidden');
    btnRetrieve.classList.add('hidden');
    btnAnalyze.classList.add('hidden');

    if (mode === 'deploy') {
        tabDeploy.classList.add(...activeTabClasses);
        tabDeploy.classList.remove(...inactiveTabClasses);

        targetOrgContainer.classList.remove('hidden');
        deployScopeContainer.classList.remove('hidden');
        btnRetrieve.classList.remove('hidden');

        if (changedFiles && changedFiles.length > 0) {
            diffSection.classList.remove('hidden');
            deployActionBar.style.display = 'flex';
        } else {
            emptyState.classList.remove('hidden');
        }
    } else if (mode === 'health') {
        tabHealth.classList.add(...activeTabClasses);
        tabHealth.classList.remove(...inactiveTabClasses);

        healthCheckContainer.classList.remove('hidden');
        btnAnalyze.classList.remove('hidden');

        if (depList.children.length > 0) {
            dependenciesSection.classList.remove('hidden');
        } else {
            healthEmptyState.classList.remove('hidden');
        }
    } else if (mode === 'history') {
        tabHistory.classList.add(...activeTabClasses);
        tabHistory.classList.remove(...inactiveTabClasses);

        historyContainer.classList.remove('hidden');
        historyEmptyState.classList.remove('hidden');
    }
}
tabDeploy.addEventListener('click', () => setAppMode('deploy'));
tabHealth.addEventListener('click', () => setAppMode('health'));
tabHistory.addEventListener('click', () => setAppMode('history'));

// --- Health Check Tooling API Flow ---
btnAnalyze.addEventListener('click', async () => {
    const compName = componentNameInput.value.trim();
    if (!compName) return alert("Please enter a component API name");
    if (!srcInstance.value || !srcSession.value) return alert("Please provide Source Org credentials");

    healthEmptyState.classList.add('hidden');
    dependenciesSection.classList.add('hidden');
    btnAnalyze.disabled = true;
    btnAnalyze.innerHTML = `<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Analyzing...`;

    try {
        let resolvedId = compName;
        // If not already a 15/18 char Salesforce ID
        if (!(compName.length >= 15 && compName.length <= 18 && /^[0-9a-zA-Z]+$/.test(compName))) {
            let toolingObj = 'ApexClass';
            let whereField = 'Name';
            let extractName = compName;

            if (compName.includes('.')) {
                toolingObj = 'CustomField';
                extractName = compName.split('.')[1].replace(/__c$/, '');
                whereField = 'DeveloperName';
            } else if (compName.endsWith('__c') || compName.endsWith('__mdt')) {
                toolingObj = 'CustomObject';
                extractName = compName.replace(/__c$/, '').replace(/__mdt$/, '');
                whereField = 'DeveloperName';
            }

            const resolveQuery = `SELECT Id FROM ${toolingObj} WHERE ${whereField} = '${extractName}' LIMIT 1`;
            const resolveUrl = `/api/proxy/tooling/query?instanceUrl=${encodeURIComponent(srcInstance.value)}&sessionId=${encodeURIComponent(srcSession.value)}&q=${encodeURIComponent(resolveQuery)}`;
            
            const resolveRes = await fetch(resolveUrl);
            if (!resolveRes.ok) throw new Error("ID Resolution failed: " + await resolveRes.text());
            
            const resolveData = await resolveRes.json();
            if (resolveData.records && resolveData.records.length > 0) {
                resolvedId = resolveData.records[0].Id;
            } else {
                throw new Error(`Could not resolve Component ID for '${compName}' (searched ${toolingObj}). Please enter the 15/18-character ID directly.`);
            }
        }

        const query = `SELECT MetadataComponentType, MetadataComponentName, MetadataComponentId FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${resolvedId}' LIMIT 2000`;
        const url = `/api/proxy/tooling/query?instanceUrl=${encodeURIComponent(srcInstance.value)}&sessionId=${encodeURIComponent(srcSession.value)}&q=${encodeURIComponent(query)}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        const records = data.records || [];

        depList.innerHTML = '';
        if (records.length === 0) {
            depList.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-gray-500 text-sm italic">No references found for ${compName}. It is safely decoupled.</td></tr>`;
        } else {
            records.forEach(r => {
                const tr = document.createElement('tr');
                
                // Construct the Salesforce Setup URL. 
                // Using frontdoor.jsp to pass the session token so the user is authenticated automatically.
                const baseUrl = srcInstance.value.replace(/\/$/, ''); // Remove trailing slash if any
                const retUrl = encodeURIComponent(`/${r.MetadataComponentId}`);
                const compUrl = `${baseUrl}/secur/frontdoor.jsp?sid=${encodeURIComponent(srcSession.value)}&retURL=${retUrl}`;

                tr.innerHTML = `
                    <td class="px-6 py-3 text-xs text-gray-700 dark:text-gray-300 font-medium">${r.MetadataComponentType}</td>
                    <td class="px-6 py-3 text-xs text-gray-900 dark:text-gray-100">
                        <a href="${compUrl}" target="_blank" class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1" title="Open in Salesforce Setup">
                            ${r.MetadataComponentName}
                            <svg class="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                        </a>
                    </td>
                `;
                depList.appendChild(tr);
            });
        }

        depCountBadge.textContent = `${records.length} references`;
        dependenciesSection.classList.remove('hidden');
    } catch (e) {
        alert("Tooling API Error: " + e.message);
        healthEmptyState.classList.remove('hidden');
    } finally {
        btnAnalyze.disabled = false;
        btnAnalyze.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg> Analyze Dependencies`;
    }
});

// Demo Data Flow
btnDemo.addEventListener('click', () => {
    changedFiles = [
        {
            name: "unpackaged/classes/AccountTriggerHandler.cls",
            status: "Modified",
            selected: false,
            lastModifiedByName: "Sarah Developer",
            lastModifiedDate: "2023-10-25T14:30:00Z",
            srcContent: "public class AccountTriggerHandler {\n    public static void beforeInsert(List<Account> newAccounts) {\n        for(Account acc : newAccounts) {\n            if(acc.Industry == 'Technology') {\n                acc.Rating = 'Hot';\n                acc.Description = 'Tech Account - Priority';\n            }\n        }\n    }\n    \n    public static void afterInsert(List<Account> newAccounts) {\n        // Call external tracking service\n        IntegrationService.notifyNewAccounts(newAccounts);\n        System.debug('Account creation fully processed');\n    }\n}\n",
            tgtContent: "public class AccountTriggerHandler {\n    public static void beforeInsert(List<Account> newAccounts) {\n        for(Account acc : newAccounts) {\n            if(acc.Industry == 'Technology') {\n                acc.Rating = 'Hot';\n            }\n        }\n    }\n    \n    public static void afterInsert(List<Account> newAccounts) {\n        // Old logic\n        System.debug('Account created');\n    }\n}\n"
        },
        {
            name: "unpackaged/objects/Opportunity.object",
            status: "Modified",
            selected: false,
            lastModifiedByName: "Admin User",
            lastModifiedDate: "2023-10-24T09:15:00Z",
            srcContent: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <fields>\n        <fullName>Discount__c</fullName>\n        <type>Percent</type>\n    </fields>\n</CustomObject>",
            tgtContent: "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n    <!-- Missing Discount field -->\n</CustomObject>"
        },
        {
            name: "unpackaged/lwc/customDatatable/customDatatable.js",
            status: "New",
            selected: false,
            lastModifiedByName: "Sarah Developer",
            lastModifiedDate: "2023-10-26T11:45:00Z",
            srcContent: "import { LightningElement } from 'lwc';\n\nexport default class CustomDatatable extends LightningElement {\n    data = [];\n    columns = [{ label: 'Name', fieldName: 'name' }];\n}",
            tgtContent: ""
        }
    ];

    emptyState.classList.add('hidden');

    diffCountBadge.textContent = `${changedFiles.length} files`;
    renderDiffTable();
    diffSection.classList.remove('hidden');
    deployActionBar.style.display = 'flex';

    btnDemo.classList.add('hidden');
    btnReset.classList.remove('hidden');
});

// Reset Flow
btnReset.addEventListener('click', () => {
    changedFiles = [];
    srcZip = null;
    tgtZip = null;

    diffSection.classList.add('hidden');
    deployActionBar.style.display = 'none';
    retrieveStatus.classList.add('hidden');
    deployStatus.classList.add('hidden');
    emptyState.classList.remove('hidden');

    btnReset.classList.add('hidden');
    btnDemo.classList.remove('hidden');
});

async function compareZips(src, tgt) {
    changedFiles = [];
    const srcFiles = Object.keys(src.files).filter(f => {
        if (src.files[f].dir || f === 'unpackaged/package.xml') return false;
        const parts = f.replace('unpackaged/', '').split('/');
        return parts.length < 2 || !isManagedPackageComponent(parts[1]);
    });
    const totalFiles = srcFiles.length;

    let completed = 0;
    const results = await Promise.all(srcFiles.map(async (fileName) => {
        const srcContent = await src.file(fileName).async("string");

        if (++completed % 5 === 0 || completed === totalFiles) {
            const pct = 10 + Math.floor((completed / totalFiles) * 50);
            setProgress(retrieveProgress, retrieveMsg, pct, `Comparing files (${completed}/${totalFiles})...`, false);
        }

        if (!tgt.file(fileName)) {
            return { name: fileName, status: 'New', selected: false, srcContent, tgtContent: '', lastModifiedByName: '-', lastModifiedDate: '-' };
        }
        const tgtContent = await tgt.file(fileName).async("string");
        if (srcContent !== tgtContent) {
            return { name: fileName, status: 'Modified', selected: false, srcContent, tgtContent, lastModifiedByName: '-', lastModifiedDate: '-' };
        }
        return null;
    }));

    changedFiles = results.filter(r => r !== null);
}

async function detectTestClasses(zip) {
    testClassNames = [];
    const clsFiles = Object.keys(zip.files).filter(f => f.endsWith('.cls') && !f.endsWith('-meta.xml'));
    const contents = await Promise.all(clsFiles.map(f => zip.file(f).async('string').then(content => ({ f, content }))));
    for (const { f, content } of contents) {
        if (/@isTest/i.test(content) || /\btestMethod\b/i.test(content)) {
            const name = f.split('/').pop().replace('.cls', '');
            testClassNames.push(name);
        }
    }
    testClassNames.sort();
}

async function fetchLastModifiedData(instanceUrl, sessionId) {
    if (changedFiles.length === 0) return;

    const typesNeeded = new Set();
    changedFiles.forEach(f => {
        const parts = f.name.replace('unpackaged/', '').split('/');
        if (parts.length >= 2) {
            const folder = parts[0];
            const type = FOLDER_TO_TYPE_MAP[folder] || folder;
            typesNeeded.add(type);
        }
    });

    const typesArray = Array.from(typesNeeded);
    const metadataResults = [];
    
    // --- SOQL Optimized Path ---
    const soqlSupportedTypes = ['ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'CustomObject'];
    const codes = ['ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent'];
    const fastMetadataTypes = typesArray.filter(t => soqlSupportedTypes.includes(t));
    const slowMetadataTypes = typesArray.filter(t => !soqlSupportedTypes.includes(t));

    const fetchPromises = [];

    // 1. Fetch Code info via SOQL (only changed names)
    codes.filter(t => fastMetadataTypes.includes(t)).forEach(type => {
        const folderName = Object.keys(FOLDER_TO_TYPE_MAP).find(k => FOLDER_TO_TYPE_MAP[k] === type);
        const changedNames = changedFiles
            .filter(f => f.name.replace('unpackaged/', '').split('/')[0] === folderName)
            .map(f => f.name.replace('unpackaged/', '').split('/').slice(1).join('/').split('.')[0]);
        const nameFilter = changedNames.length > 0
            ? `Name IN (${changedNames.map(n => `'${n}'`).join(',')}) AND `
            : '';
        const q = `SELECT Name, LastModifiedDate, LastModifiedBy.Name FROM ${type} WHERE ${nameFilter}NamespacePrefix = null`;
        const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(instanceUrl)}&sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}`;
        fetchPromises.push(fetch(url).then(async res => {
            if (!res.ok) return [];
            const data = await res.json();
            return (data.records || []).map(r => ({
                fullName: r.Name,
                type: type,
                lastModifiedByName: r.LastModifiedBy?.Name,
                lastModifiedDate: r.LastModifiedDate
            }));
        }));
    });

    // 2. Fetch Entity info (CustomObject) via SOQL
    if (fastMetadataTypes.includes('CustomObject')) {
        const q = `SELECT QualifiedApiName, LastModifiedDate, LastModifiedBy.Name FROM EntityDefinition WHERE IsCustomMetadataDefinition = false AND NamespacePrefix = null`;
        const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(instanceUrl)}&sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}`;
        fetchPromises.push(fetch(url).then(async res => {
            if (!res.ok) return [];
            const data = await res.json();
            return (data.records || []).map(r => ({
                fullName: r.QualifiedApiName,
                type: 'CustomObject',
                lastModifiedByName: r.LastModifiedBy?.Name,
                lastModifiedDate: r.LastModifiedDate
            }));
        }));
    }

    // 3. Fallback for Slow Types (listMetadata)
    for (let i = 0; i < slowMetadataTypes.length; i += 3) {
        const batch = slowMetadataTypes.slice(i, i + 3);
        fetchPromises.push(
            fetch('/api/proxy/listMetadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instanceUrl, sessionId, types: batch })
            })
            .then(async res => {
                if (res.ok) {
                    const data = await res.json();
                    return (data.result || []).filter(r => !r.namespacePrefix);
                }
                return [];
            })
        );
    }

    // 4. Wait & Merge results
    const resultsArrays = await Promise.all(fetchPromises.map((p, idx) => 
        p.then(res => {
            const pct = 60 + Math.floor(((idx + 1) / fetchPromises.length) * 20);
            setProgress(retrieveProgress, retrieveMsg, pct, `Updating metadata info...`, false);
            return res;
        }).catch(e => {
            console.error('Fetch error:', e);
            return [];
        })
    ));
    
    resultsArrays.forEach(arr => metadataResults.push(...arr));

    const lookup = {};
    metadataResults.forEach(r => {
        if (!lookup[r.type]) lookup[r.type] = {};
        lookup[r.type][r.fullName] = r;
    });

    changedFiles.forEach(f => {
        const parts = f.name.replace('unpackaged/', '').split('/');
        if (parts.length >= 2) {
            const folder = parts[0];
            const type = FOLDER_TO_TYPE_MAP[folder] || folder;
            let fullName = parts.slice(1).join('/');
            
            const noExtTypes = ['ApexClass', 'ApexTrigger', 'ApexPage', 'ApexComponent', 'CustomObject', 'CustomLabels'];
            if (noExtTypes.includes(type)) {
                fullName = fullName.split('.')[0];
            } else if (type === 'CustomMetadata') {
                fullName = fullName.replace(/\.md$/, '');
            }

            if (lookup[type] && lookup[type][fullName]) {
                const info = lookup[type][fullName];
                f.lastModifiedByName = info.lastModifiedByName || '-';
                const rawDate = info.lastModifiedDate;
                f.lastModifiedDateRaw = rawDate || '';
                if (rawDate) {
                    try {
                        const d = new Date(rawDate);
                        f.lastModifiedDate = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    } catch(e) {
                        f.lastModifiedDate = rawDate;
                    }
                } else {
                    f.lastModifiedDate = '-';
                }
            }
        }
    });
}

let currentSortColumn = 'name';
let currentSortDirection = 'asc';
const filterInput = document.getElementById('filterInput');

function updateSelectedCount() {
    const selectedCount = changedFiles.filter(f => f.selected).length;
    if (selectedCountText) {
        selectedCountText.textContent = `(${selectedCount} selected)`;
    }
}

diffList.addEventListener('change', (e) => {
    if (e.target.classList.contains('file-checkbox')) {
        const globalIdx = parseInt(e.target.dataset.idx);
        changedFiles[globalIdx].selected = e.target.checked;
        updateSelectedCount();
        
        // Update selectAll state
        const renderedCheckboxes = Array.from(document.querySelectorAll('.file-checkbox'));
        const allChecked = renderedCheckboxes.every(cb => cb.checked);
        selectAll.checked = allChecked && renderedCheckboxes.length > 0;
    }
});

if (filterInput) {
    filterInput.addEventListener('input', () => renderDiffTable());
}
if (showSelectedOnly) {
    showSelectedOnly.addEventListener('change', () => renderDiffTable());
}
if (statusFilter) {
    statusFilter.addEventListener('change', () => renderDiffTable());
}

document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (currentSortColumn === col) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            currentSortColumn = col;
            currentSortDirection = 'asc';
        }
        
        // Update sort indicators
        document.querySelectorAll('.sort-indicator').forEach(el => el.textContent = '');
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) {
            indicator.textContent = currentSortDirection === 'asc' ? '↑' : '↓';
        }
        renderDiffTable();
    });
});

function renderDiffTable() {
    diffList.innerHTML = '';

    // Close any open audit popover
    const prevPop = document.getElementById('auditPopover');
    if (prevPop) prevPop.remove();
    
    updateSelectedCount();

    if (changedFiles.length === 0) {
        diffList.innerHTML = '<tr><td colspan="4" class="px-6 py-8 text-center text-sm text-gray-500">No differences found. Orgs are perfectly synced for this manifest.</td></tr>';
        deployActionBar.style.display = 'none';
        return;
    }

    let filteredFiles = changedFiles;
    
    // Status Filter
    const sFilter = statusFilter ? statusFilter.value : 'all';
    if (sFilter !== 'all') {
        filteredFiles = filteredFiles.filter(f => f.status.toLowerCase() === sFilter);
    }
    
    // Selected Filter
    const selOnly = showSelectedOnly ? showSelectedOnly.checked : false;
    if (selOnly) {
        filteredFiles = filteredFiles.filter(f => f.selected);
    }

    // Text Filter
    const q = filterInput ? filterInput.value.toLowerCase() : '';
    if (q) {
        filteredFiles = filteredFiles.filter(f => {
            const rawName = f.name.replace('unpackaged/', '');
            const parts = rawName.split('/');
            const typeName = parts.length >= 2 ? (FOLDER_TO_TYPE_MAP[parts[0]] || parts[0]) : 'Unknown';
            const compName = parts.length >= 2 ? parts.slice(1).join('/') : rawName;
            
            return f.status.toLowerCase().includes(q) || 
                   typeName.toLowerCase().includes(q) || 
                   compName.toLowerCase().includes(q) ||
                   (f.lastModifiedByName || '').toLowerCase().includes(q) ||
                   (f.lastModifiedDate || '').toLowerCase().includes(q);
        });
    }

    filteredFiles.sort((a, b) => {
        let valA = '';
        let valB = '';
        
        const rawNameA = a.name.replace('unpackaged/', '');
        const partsA = rawNameA.split('/');
        const typeNameA = partsA.length >= 2 ? (FOLDER_TO_TYPE_MAP[partsA[0]] || partsA[0]) : 'Unknown';
        const compNameA = partsA.length >= 2 ? partsA.slice(1).join('/') : rawNameA;

        const rawNameB = b.name.replace('unpackaged/', '');
        const partsB = rawNameB.split('/');
        const typeNameB = partsB.length >= 2 ? (FOLDER_TO_TYPE_MAP[partsB[0]] || partsB[0]) : 'Unknown';
        const compNameB = partsB.length >= 2 ? partsB.slice(1).join('/') : rawNameB;

        if (currentSortColumn === 'status') {
            valA = a.status || ''; valB = b.status || '';
        } else if (currentSortColumn === 'type') {
            valA = typeNameA; valB = typeNameB;
        } else if (currentSortColumn === 'name') {
            valA = compNameA; valB = compNameB;
        } else if (currentSortColumn === 'lastModifiedByName') {
            valA = a.lastModifiedByName || ''; valB = b.lastModifiedByName || '';
        } else if (currentSortColumn === 'lastModifiedDate') {
            valA = a.lastModifiedDateRaw || ''; valB = b.lastModifiedDateRaw || '';
        }

        if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    diffCountBadge.textContent = `${filteredFiles.length} files`;

    // Show Source → Target direction
    const dirLabel = document.getElementById('orgDirectionLabel');
    if (dirLabel) {
        try {
            const srcHost = srcInstance.value ? new URL(srcInstance.value).hostname.split('.')[0] : 'Source';
            const tgtHost = tgtInstance.value ? new URL(tgtInstance.value).hostname.split('.')[0] : 'Target';
            dirLabel.textContent = `${srcHost} → ${tgtHost}`;
        } catch(e) { dirLabel.textContent = ''; }
    }

    filteredFiles.forEach((f, idx) => {
        const globalIdx = changedFiles.indexOf(f); // Keep reference to original index for showDiff
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer group';
        tr.onclick = (e) => {
            // Prevent opening modal if clicking the checkbox
            if (e.target.tagName.toLowerCase() === 'input') return;
            showDiff(globalIdx);
        };

        const tdCheck = document.createElement('td');
        tdCheck.className = 'px-6 py-4 whitespace-nowrap';
        tdCheck.innerHTML = `<input type="checkbox" class="file-checkbox w-4 h-4 text-salesforce border-gray-300 rounded focus:ring-salesforce cursor-pointer" data-idx="${globalIdx}" ${f.selected ? 'checked' : ''}>`;

        const tdStatus = document.createElement('td');
        tdStatus.className = 'px-6 py-4 whitespace-nowrap';
        if (f.status === 'New') {
            tdStatus.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800/50 uppercase tracking-wide">New</span>`;
        } else {
            tdStatus.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800/50 uppercase tracking-wide">Modified</span>`;
        }

        const rawName = f.name.replace('unpackaged/', '');
        const parts = rawName.split('/');
        let typeName = 'Unknown';
        let compName = rawName;

        if (parts.length >= 2) {
            typeName = FOLDER_TO_TYPE_MAP[parts[0]] || parts[0];
            compName = parts.slice(1).join('/');
        }

        const tdType = document.createElement('td');
        tdType.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono';
        tdType.textContent = typeName;

        const tdName = document.createElement('td');
        tdName.className = 'px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-salesforce transition-colors';
        
        // Build Setup link for Source org
        const setupUrl = getSfSetupUrl(srcInstance.value, typeName, compName);
        const linkIcon = `<svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`;
        if (setupUrl) {
            tdName.innerHTML = `<div class="flex items-center gap-2">${compName} <a href="${setupUrl}" target="_blank" rel="noopener" class="opacity-0 group-hover:opacity-100 transition-opacity text-salesforce hover:text-blue-700" title="Open in Source Org Setup" onclick="event.stopPropagation()">${linkIcon}</a></div>`;
        } else {
            tdName.innerHTML = `<div class="flex items-center gap-2">${compName}</div>`;
        }
        
        const tdModBy = document.createElement('td');
        tdModBy.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 truncate max-w-[12rem]';
        tdModBy.textContent = f.lastModifiedByName || '-';
        tdModBy.title = f.lastModifiedByName || '';

        const tdModDate = document.createElement('td');
        tdModDate.className = 'px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400';
        tdModDate.textContent = f.lastModifiedDate || '-';

        const tdAudit = document.createElement('td');
        tdAudit.className = 'px-3 py-4 whitespace-nowrap text-right';
        const auditBtnClass = 'p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors';
        const clockSvg = `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        tdAudit.innerHTML = `<div class="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button class="${auditBtnClass}" title="Source Audit Trail" onclick="event.stopPropagation(); showAuditTrail('${compName.split('.')[0]}', 'source', this)">
                <span class="flex items-center gap-0.5"><span class="text-[8px] font-bold text-blue-500">S</span>${clockSvg}</span>
            </button>
            <button class="${auditBtnClass}" title="Target Audit Trail" onclick="event.stopPropagation(); showAuditTrail('${compName.split('.')[0]}', 'target', this)">
                <span class="flex items-center gap-0.5"><span class="text-[8px] font-bold text-emerald-500">T</span>${clockSvg}</span>
            </button>
        </div>`;

        tr.appendChild(tdCheck);
        tr.appendChild(tdStatus);
        tr.appendChild(tdType);
        tr.appendChild(tdName);
        tr.appendChild(tdModBy);
        tr.appendChild(tdModDate);
        tr.appendChild(tdAudit);

        diffList.appendChild(tr);
    });

    const renderedCheckboxes = Array.from(document.querySelectorAll('.file-checkbox'));
    const allChecked = renderedCheckboxes.every(cb => cb.checked);
    selectAll.checked = allChecked && renderedCheckboxes.length > 0;
}

selectAll.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.file-checkbox').forEach(cb => {
        cb.checked = isChecked;
        const globalIdx = parseInt(cb.dataset.idx);
        changedFiles[globalIdx].selected = isChecked;
    });
    updateSelectedCount();
});

function closeDiff() {
    modal.classList.add('hidden');
    _currentCoverage = null;
    _currentDiffFile = null;
    const coverageBar = document.getElementById('coverageSummaryBar');
    if (coverageBar) coverageBar.classList.add('hidden');
}

let _currentDiffIdx = null; // Track current diff for re-render on whitespace toggle
let _currentDiffFile = null; // Track current file name for coverage

function showDiff(idx) {
    _currentDiffIdx = idx;
    const f = changedFiles[idx];
    _currentDiffFile = f.name;
    renderDiff(f, srcInstance.value, tgtInstance.value);
}

function renderDiff(f, srcUrl, tgtUrl) {
    _currentCoverage = null;
    const coverageBar = document.getElementById('coverageSummaryBar');
    if (coverageBar) coverageBar.classList.add('hidden');
    const btnCov = document.getElementById('btnShowCoverage');
    if (btnCov) {
        if (isApexFile(f.name)) { btnCov.classList.remove('hidden'); } else { btnCov.classList.add('hidden'); }
    }

    const cleanName = f.name.replace('unpackaged/', '');
    const srcLabel = srcUrl ? new URL(srcUrl).hostname.split('.')[0] : 'Source';
    const tgtLabel = tgtUrl ? new URL(tgtUrl).hostname.split('.')[0] : 'Target';
    modalTitle.innerHTML = `<span class="text-lg font-bold">${cleanName}</span>
        <span class="ml-3 text-xs font-mono text-gray-400">\u2B05 ${tgtLabel} &nbsp;|&nbsp; \u27A1 ${srcLabel}</span>`;

    const ignoreWs = document.getElementById('ignoreWhitespace')?.checked;
    let srcText = f.srcContent;
    let tgtText = f.tgtContent;
    if (ignoreWs) {
        const normalize = s => s.split('\n').map(l => l.trimEnd()).join('\n');
        srcText = normalize(srcText);
        tgtText = normalize(tgtText);
    }

    const patch = Diff.createTwoFilesPatch(
        `\u2B05 TARGET (${tgtLabel})`, `\u27A1 SOURCE (${srcLabel})`,
        tgtText, srcText
    );
    const currentIsDark = document.documentElement.classList.contains('dark');
    diffViewer.innerHTML = Diff2Html.html(patch, {
        drawFileList: false, matching: 'lines',
        outputFormat: 'side-by-side', theme: currentIsDark ? 'dark' : 'light'
    });
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.querySelector('.transform')?.classList.add('scale-100', 'opacity-100');
        modal.querySelector('.transform')?.classList.remove('scale-95', 'opacity-0');
    }, 10);
}

// Re-render diff when whitespace toggle changes
document.getElementById('ignoreWhitespace')?.addEventListener('change', () => {
    if (_currentDiffIdx !== null && changedFiles[_currentDiffIdx]) {
        renderDiff(changedFiles[_currentDiffIdx], srcInstance.value, tgtInstance.value);
    }
});

if (closeModalBtn) closeModalBtn.onclick = closeDiff;

// --- Test Coverage ---
let _currentCoverage = null; // { coveredLines: [], uncoveredLines: [] }

const COVERAGE_TYPES = ['ApexClass', 'ApexTrigger'];

function isApexFile(fileName) {
    return fileName && (fileName.includes('/classes/') || fileName.includes('/triggers/'));
}

function getApexClassName(fileName) {
    const parts = fileName.replace('unpackaged/', '').split('/');
    if (parts.length >= 2) {
        return parts[parts.length - 1].replace('.cls', '').replace('.trigger', '').replace('-meta.xml', '');
    }
    return null;
}

async function fetchCoverage(className, instanceUrl, sessionId) {
    const q = `SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered, Coverage FROM ApexCodeCoverageAggregate WHERE ApexClassOrTrigger.Name = '${className}'`;
    const params = new URLSearchParams({ instanceUrl, sessionId, q });
    const res = await fetch(`/api/proxy/tooling/query?${params}`);
    if (!res.ok) throw new Error(`Coverage query failed: ${res.status}`);
    const data = await res.json();
    if (data.records && data.records.length > 0) {
        const cov = data.records[0].Coverage;
        return {
            className,
            coveredLines: cov.coveredLines || [],
            uncoveredLines: cov.uncoveredLines || [],
            numCovered: data.records[0].NumLinesCovered || 0,
            numUncovered: data.records[0].NumLinesUncovered || 0
        };
    }
    return null;
}

function applyCoverageHighlight(coverage) {
    if (!coverage) return;
    _currentCoverage = coverage;
    const coveredSet = new Set(coverage.coveredLines);
    const uncoveredSet = new Set(coverage.uncoveredLines);

    // diff2html side-by-side: two .d2h-file-side-diff divs — [0]=target (left), [1]=source (right)
    const sides = diffViewer.querySelectorAll('.d2h-file-side-diff');
    const sourceTable = sides.length >= 2 ? sides[1] : diffViewer; // fallback to whole viewer

    const rows = sourceTable.querySelectorAll('.d2h-diff-tbody tr');
    rows.forEach(row => {
        const lineNumCell = row.querySelector('.d2h-code-side-linenumber');
        if (!lineNumCell) return;
        const lineNum = parseInt(lineNumCell.textContent.trim(), 10);
        if (isNaN(lineNum)) return;
        const codeCell = row.querySelector('.d2h-code-side-line');
        if (uncoveredSet.has(lineNum)) {
            lineNumCell.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            lineNumCell.style.borderLeft = '3px solid #ef4444';
            if (codeCell) codeCell.style.backgroundColor = 'rgba(239, 68, 68, 0.08)';
        } else if (coveredSet.has(lineNum)) {
            lineNumCell.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
            lineNumCell.style.borderLeft = '3px solid #22c55e';
            if (codeCell) codeCell.style.backgroundColor = 'rgba(34, 197, 94, 0.05)';
        }
    });

    updateCoverageSummary(coverage);
}

function updateCoverageSummary(coverage) {
    const bar = document.getElementById('coverageSummaryBar');
    if (!bar) return;
    if (!coverage) {
        bar.classList.add('hidden');
        return;
    }
    const total = coverage.numCovered + coverage.numUncovered;
    const pct = total > 0 ? Math.round((coverage.numCovered / total) * 100) : 0;
    const pctColor = pct >= 75 ? 'text-green-600 dark:text-green-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400';

    bar.innerHTML = `
        <div class="flex items-center gap-3 flex-wrap">
            <span class="text-xs text-gray-500 dark:text-gray-400">Coverage:</span>
            <span class="text-sm font-bold ${pctColor}">${pct}%</span>
            <span class="text-xs text-gray-400">(${coverage.numCovered}/${total} lines)</span>
            <span class="text-xs text-green-600 dark:text-green-400">${coverage.coveredLines.length} covered</span>
            <span class="text-xs text-red-600 dark:text-red-400">${coverage.uncoveredLines.length} uncovered</span>
            <button onclick="copyCoverageReport()" class="ml-auto px-2 py-0.5 text-[10px] font-semibold rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors flex items-center gap-1" title="Copy uncovered lines report">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                Copy Report
            </button>
        </div>`;
    bar.classList.remove('hidden');
}

function buildCoverageReport() {
    if (!_currentCoverage || _currentCoverage.uncoveredLines.length === 0) return 'All lines are covered!';
    const sorted = [..._currentCoverage.uncoveredLines].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0], end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            ranges.push({ start, end });
            start = sorted[i];
            end = sorted[i];
        }
    }
    ranges.push({ start, end });

    const total = _currentCoverage.numCovered + _currentCoverage.numUncovered;
    const pct = total > 0 ? Math.round((_currentCoverage.numCovered / total) * 100) : 0;
    let report = `Coverage Report: ${_currentCoverage.className} (${pct}%)\n`;
    report += `${'='.repeat(40)}\n`;
    ranges.forEach((r, i) => {
        if (r.start === r.end) {
            report += `${i + 1}. Line ${r.start} has no test coverage\n`;
        } else {
            report += `${i + 1}. Lines ${r.start}-${r.end} have no test coverage\n`;
        }
    });
    return report;
}

function copyCoverageReport() {
    const report = buildCoverageReport();
    navigator.clipboard.writeText(report).then(() => {
        const btn = document.querySelector('#coverageSummaryBar button');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
        }
    });
}

async function showCoverage(fileName, instanceUrl, sessionId) {
    if (!isApexFile(fileName)) return;
    const className = getApexClassName(fileName);
    if (!className) return;

    const btn = document.getElementById('btnShowCoverage');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Loading...';
    }

    try {
        const coverage = await fetchCoverage(className, instanceUrl, sessionId);
        if (coverage) {
            applyCoverageHighlight(coverage);
        } else {
            updateCoverageSummary(null);
            const bar = document.getElementById('coverageSummaryBar');
            if (bar) {
                bar.innerHTML = '<span class="text-xs text-gray-400">No coverage data found for this class. Run tests first.</span>';
                bar.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error('Coverage fetch error:', e);
        const bar = document.getElementById('coverageSummaryBar');
        if (bar) {
            bar.innerHTML = `<span class="text-xs text-red-500">Failed to load coverage: ${e.message}</span>`;
            bar.classList.remove('hidden');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Coverage';
        }
    }
}

// Deploy Flow
btnValidate.addEventListener('click', () => executeDeploy(true));
btnDeploy.addEventListener('click', () => executeDeploy(false));

async function executeDeploy(isCheckOnly) {
    const selectedIndexes = changedFiles.map((f, i) => f.selected ? i : -1).filter(i => i !== -1);
    if (selectedIndexes.length === 0) {
        alert("Please select at least one component to process.");
        return;
    }

    // Initialize Terminal Overlay
    Alpine.store('deploy').reset(isCheckOnly);

    deployStatus.classList.remove('hidden');
    btnValidate.disabled = true;
    btnDeploy.disabled = true;

    try {
        Alpine.store('deploy').addLog('info', 'Building deployment ZIP package...');
        setProgress(deployProgress, deployMsg, 10, 'Building deployment ZIP...', false);

        const deployZip = new JSZip();
        // ... (rest of zip logic remains same)
        const typesMap = {};

        for (const idx of selectedIndexes) {
            const file = changedFiles[idx];
            deployZip.file(file.name, file.srcContent);

            // Automatically include the corresponding associated metadata or base file
            const isMeta = file.name.endsWith('-meta.xml');
            const correspondingFileName = isMeta ? file.name.replace('-meta.xml', '') : file.name + '-meta.xml';
            
            // srcZip is defined globally during the fetch & compare stage
            if (srcZip && srcZip.file(correspondingFileName)) {
                const correspondingContent = await srcZip.file(correspondingFileName).async("string");
                deployZip.file(correspondingFileName, correspondingContent);
            }

            const parts = file.name.split('/');
            if (parts.length >= 3) {
                const folder = parts[1];
                let filename = parts.slice(2).join('/');
                filename = filename.split('.')[0];
                const typeName = FOLDER_TO_TYPE_MAP[folder] || folder;

                if (!typesMap[typeName]) typesMap[typeName] = new Set();
                typesMap[typeName].add(filename);
            }
        }

        let newPackageXml = `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n`;
        for (const [type, members] of Object.entries(typesMap)) {
            newPackageXml += `  <types>\n`;
            members.forEach(m => newPackageXml += `    <members>${m}</members>\n`);
            newPackageXml += `    <name>${type}</name>\n  </types>\n`;
        }
        newPackageXml += `  <version>58.0</version>\n</Package>`;

        deployZip.file('unpackaged/package.xml', newPackageXml);

        setProgress(deployProgress, deployMsg, 30, 'Uploading ZIP to Target Org...', false);
        const base64Zip = await deployZip.generateAsync({ type: "base64" });

        const testClasses = testClassesInput.value.split(',').map(s => s.trim()).filter(s => s);

        const res = await fetch('/api/proxy/deploy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                instanceUrl: tgtInstance.value,
                sessionId: tgtSession.value,
                zipBase64: base64Zip,
                testLevel: testLevelInput.value,
                testClasses: testClasses,
                checkOnly: isCheckOnly
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Deploy Proxy Error: ${err}`);
        }
        const data = await res.json();
        const jobId = data.jobId;
        Alpine.store('deploy').jobId = jobId;

        const actionStr = isCheckOnly ? "Validation" : "Deploy";
        Alpine.store('deploy').addLog('info', `${actionStr} job queued to Salesforce.`);
        setProgress(deployProgress, deployMsg, 50, `${actionStr} Job Queued (${jobId}). Polling status...`, false);

        await pollDeployStatus(jobId, tgtInstance.value, tgtSession.value, isCheckOnly);

    } catch (err) {
        Alpine.store('deploy').addLog('error', `Deployment Failed: ${err.message}`);
        Alpine.store('deploy').status = 'Failed';
        setProgress(deployProgress, deployMsg, 100, err.message, true);
    } finally {
        btnValidate.disabled = false;
        btnDeploy.disabled = false;
    }
}

async function pollDeployStatus(jobId, instanceUrl, sessionId, isCheckOnly) {
    let done = false;
    const store = Alpine.store('deploy');

    while (!done) {
        await new Promise(r => setTimeout(r, 3000));

        const qs = new URLSearchParams({ instanceUrl, sessionId, apiVersion: '58.0' }).toString();
        const res = await fetch(`/api/proxy/status/${jobId}?${qs}`);
        if (!res.ok) throw new Error("Failed to check deploy status");

        const soapStr = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(soapStr, "text/xml");

        // Check for SOAP fault
        const faultNode = xmlDoc.getElementsByTagName("faultstring")[0] || xmlDoc.getElementsByTagName("soapenv:faultstring")[0];
        if (faultNode) {
            throw new Error(`SOAP Fault during deploy status: ${faultNode.textContent}`);
        }

        const statusNode = xmlDoc.getElementsByTagName("status")[0] || xmlDoc.getElementsByTagName("met:status")[0];
        if (!statusNode) {
            const snippet = (soapStr || "").substring(0, 500);
            throw new Error(`Deploy Status Result node not found. Raw response snippet: ${snippet}`);
        }

        const status = statusNode.textContent;
        store.status = status;
        
        // --- Aggressive Parsing for Terminal ---
        const details = xmlDoc.getElementsByTagName("details")[0] || xmlDoc.getElementsByTagName("met:details")[0];
        if (details) {
            // 1. Successes
            const successes = details.getElementsByTagName("componentSuccesses") || details.getElementsByTagName("met:componentSuccesses");
            for (const s of successes) {
                const name = s.getElementsByTagName("fullName")[0]?.textContent;
                const type = s.getElementsByTagName("componentType")[0]?.textContent;
                if (name && type && !name.includes('package.xml')) {
                    store.addLog('success', `Component: ${type} - ${name} ... Success`, `succ_${name}`);
                }
            }

            // 2. Failures
            const failures = details.getElementsByTagName("componentFailures") || details.getElementsByTagName("met:componentFailures");
            for (const f of failures) {
                const name = f.getElementsByTagName("fullName")[0]?.textContent;
                const problem = f.getElementsByTagName("problem")[0]?.textContent;
                if (name && problem) {
                    store.addLog('error', `Error in ${name}: ${problem}`, `fail_${name}`);
                    store.errors++;
                }
            }

            // 3. Tests
            const testResult = details.getElementsByTagName("runTestResult")[0] || details.getElementsByTagName("met:runTestResult")[0];
            if (testResult) {
                const testSuccesses = testResult.getElementsByTagName("successes") || testResult.getElementsByTagName("met:successes");
                for (const ts of testSuccesses) {
                    const mName = ts.getElementsByTagName("methodName")[0]?.textContent;
                    const cName = ts.getElementsByTagName("name")[0]?.textContent;
                    if (mName) store.addLog('info', `Test Passed: ${cName}.${mName}`, `test_${cName}_${mName}`);
                }

                const testFailures = testResult.getElementsByTagName("failures") || testResult.getElementsByTagName("met:failures");
                for (const tf of testFailures) {
                    const mName = tf.getElementsByTagName("methodName")[0]?.textContent;
                    const cName = tf.getElementsByTagName("name")[0]?.textContent;
                    const msg = tf.getElementsByTagName("message")[0]?.textContent;
                    if (mName) store.addLog('error', `Test Failed: ${cName}.${mName} - ${msg}`, `test_fail_${cName}_${mName}`);
                }

                // Coverage
                const coverageList = testResult.getElementsByTagName("codeCoverage") || testResult.getElementsByTagName("met:codeCoverage");
                let totalLocations = 0;
                let totalUncovered = 0;
                const classCov = [];

                for (const c of coverageList) {
                    const cName = c.getElementsByTagName("name")[0]?.textContent;
                    const numUncovered = parseInt(c.getElementsByTagName("numLocationsNotCovered")[0]?.textContent) || 0;
                    const numTotal = parseInt(c.getElementsByTagName("numLocations")[0]?.textContent) || 0;
                    
                    if (numTotal > 0) {
                        const pct = Math.round(((numTotal - numUncovered) / numTotal) * 100);
                        classCov.push({ name: cName, pct: pct });
                        totalLocations += numTotal;
                        totalUncovered += numUncovered;
                    }
                }
                
                if (totalLocations > 0) {
                    store.coverage = Math.round(((totalLocations - totalUncovered) / totalLocations) * 100);
                    store.classCoverage = classCov.sort((a, b) => a.pct - b.pct);
                }
            }
        }

        // --- Standard Progress logic ---
        let progressPct = null;
        let progressMsg = "";
        
        const deployedNode = xmlDoc.getElementsByTagName("numberComponentsDeployed")[0] || xmlDoc.getElementsByTagName("met:numberComponentsDeployed")[0];
        const totalNode = xmlDoc.getElementsByTagName("numberComponentsTotal")[0] || xmlDoc.getElementsByTagName("met:numberComponentsTotal")[0];
        const testsDeployedNode = xmlDoc.getElementsByTagName("numberTestsCompleted")[0] || xmlDoc.getElementsByTagName("met:numberTestsCompleted")[0];
        const testsTotalNode = xmlDoc.getElementsByTagName("numberTestsTotal")[0] || xmlDoc.getElementsByTagName("met:numberTestsTotal")[0];

        if (deployedNode && totalNode) {
            const deployed = parseInt(deployedNode.textContent) || 0;
            const total = parseInt(totalNode.textContent) || 0;
            const testsDone = parseInt(testsDeployedNode?.textContent) || 0;
            const testsTotal = parseInt(testsTotalNode?.textContent) || 0;
            
            store.deployed = deployed;
            store.total = total;

            if (total > 0) {
                // components are roughly 0-70% of wait time, tests 70-100%
                const compRatio = deployed / total;
                const testRatio = testsTotal > 0 ? (testsDone / testsTotal) : 0;
                
                if (testsTotal > 0) {
                    progressPct = Math.floor(50 + (compRatio * 20) + (testRatio * 30));
                    progressMsg = `Components: ${deployed}/${total}, Tests: ${testsDone}/${testsTotal}`;
                } else {
                    progressPct = Math.floor(50 + (compRatio * 50));
                    progressMsg = `Components: ${deployed}/${total}`;
                }
            }
        }

        if (progressPct !== null) store.progress = progressPct;

        const actionStr = isCheckOnly ? "Validation" : "Deploy";
        setProgress(deployProgress, deployMsg, progressPct, `${actionStr} Status: ${status}. ${progressMsg}`, false);

        if (status === 'Succeeded' || status === 'Failed' || status === 'Canceled') {
            done = true;
            if (status === 'Succeeded') store.addLog('success', `${actionStr} completed successfully.`);
            else store.addLog('error', `${actionStr} finished with status: ${status}`);

            // Save to history
            const selectedFiles = changedFiles.filter(f => f.selected).map(f => ({
                name: f.name, status: f.status,
                srcContent: f.srcContent, tgtContent: f.tgtContent,
                lastModifiedByName: f.lastModifiedByName, lastModifiedDate: f.lastModifiedDate
            }));
            const historyId = jobId + '_' + Date.now();
            saveHistoryEntry({
                id: historyId,
                timestamp: new Date().toISOString(),
                type: isCheckOnly ? 'validation' : 'deployment',
                jobId,
                status,
                sourceOrg: srcInstance.value,
                targetOrg: instanceUrl,
                duration: Date.now() - (store.startTime || Date.now()),
                componentsDeployed: store.deployed,
                componentsTotal: store.total,
                errors: store.errors,
                coverage: store.coverage,
                componentList: store.logs.filter(l => l.type === 'success').map(l => l.msg),
                errorDetails: store.logs.filter(l => l.type === 'error').map(l => l.msg),
                testLevel: testLevelInput.value
            }, selectedFiles).then(() => {
                window.dispatchEvent(new Event('history-updated'));
            }).catch(e => console.error('Failed to save history:', e));
        }
    }
}

// --- Snapshot Utility ---
window.takeScreenshot = async (btn) => {
    try {
        const originalIcon = btn.innerHTML;
        btn.innerHTML = `<svg class="animate-spin w-4 h-4 text-salesforce" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
        
        await new Promise(r => setTimeout(r, 100));

        const canvas = await html2canvas(document.body, {
            backgroundColor: document.documentElement.classList.contains('dark') ? '#111827' : '#f9fafb',
            windowWidth: document.body.scrollWidth,
            windowHeight: document.body.scrollHeight,
            useCORS: true,
            logging: false
        });

        canvas.toBlob(async (blob) => {
            if (!blob) throw new Error("Canvas capture failed");
            try {
                const clipboardItem = new ClipboardItem({ "image/png": blob });
                await navigator.clipboard.write([clipboardItem]);
                btn.innerHTML = `<svg class="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
            } catch (err) {
                console.error('Clipboard error:', err);
                alert('Could not save to clipboard.');
            }
            setTimeout(() => btn.innerHTML = originalIcon, 2000);
        }, "image/png");

    } catch (err) {
        console.error("Screenshot failed:", err);
        alert("Screenshot failed.");
    }
};

// Listeners for both screenshot buttons
document.getElementById('screenshotBtn')?.addEventListener('click', (e) => window.takeScreenshot(e.currentTarget));
document.addEventListener('click', (e) => {
    if (e.target.closest('#terminalScreenshotBtn')) {
        window.takeScreenshot(e.target.closest('#terminalScreenshotBtn'));
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (modal && !modal.classList.contains('hidden')) {
            closeDiff();
        }
    }
});

// --- Test Class Picker ---
let testPickerSelected = new Set();

function openTestPicker() {
    if (testClassNames.length === 0) {
        alert('No test classes detected. Run Compare first.');
        return;
    }
    testPickerSelected = new Set();
    // Pre-populate from current input
    testClassesInput.value.split(',').map(s => s.trim()).filter(Boolean).forEach(t => testPickerSelected.add(t));
    // Auto-add selected diff files that are test classes
    changedFiles.filter(f => f.selected && f.name.includes('/classes/')).forEach(f => {
        const name = f.name.split('/').pop().replace('.cls', '').replace('-meta.xml', '');
        if (testClassNames.includes(name)) testPickerSelected.add(name);
    });
    const search = document.getElementById('testPickerSearch');
    search.value = '';
    renderTestPickerList();
    document.getElementById('testPickerModal').classList.remove('hidden');
}

function renderTestPickerList(filter) {
    const q = (filter || '').toLowerCase();
    const filtered = q ? testClassNames.filter(n => n.toLowerCase().includes(q)) : testClassNames;
    const list = document.getElementById('testPickerList');
    list.innerHTML = filtered.length === 0
        ? '<p class="text-center text-xs text-gray-400 py-4">No matching test classes</p>'
        : filtered.map(name => `
            <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded cursor-pointer text-sm">
                <input type="checkbox" value="${name}" ${testPickerSelected.has(name) ? 'checked' : ''}
                       class="w-4 h-4 text-salesforce border-gray-300 rounded focus:ring-salesforce cursor-pointer"
                       onchange="toggleTestPick('${name}', this.checked)">
                <span class="text-gray-800 dark:text-gray-200">${name}</span>
            </label>`).join('');
    updateTestPickerBadge();
}

window.toggleTestPick = function(name, checked) {
    if (checked) testPickerSelected.add(name); else testPickerSelected.delete(name);
    updateTestPickerBadge();
};

function updateTestPickerBadge() {
    const el = document.getElementById('testPickerCount');
    if (el) el.textContent = `${testPickerSelected.size} selected`;
}

function confirmTestPicker() {
    const selected = Array.from(testPickerSelected);
    testClassesInput.value = selected.join(',');
    if (selected.length > 0) testLevelInput.value = 'RunSpecifiedTests';
    document.getElementById('testPickerModal').classList.add('hidden');
}

document.addEventListener('click', (e) => {
    if (e.target.id === 'btnPickTests') openTestPicker();
    if (e.target.id === 'btnConfirmTests') confirmTestPicker();
    if (e.target.id === 'testPickerModalBg' || e.target.id === 'btnCloseTestPicker') {
        document.getElementById('testPickerModal').classList.add('hidden');
    }
});
document.addEventListener('input', (e) => {
    if (e.target.id === 'testPickerSearch') renderTestPickerList(e.target.value);
});

// --- Audit Trail Popover ---
window.showAuditTrail = async function(compName, orgSide, btnEl) {
    // Remove existing popover
    const prev = document.getElementById('auditPopover');
    if (prev) prev.remove();

    const instanceUrl = orgSide === 'source' ? srcInstance.value : tgtInstance.value;
    const sessionId = orgSide === 'source' ? srcSession.value : tgtSession.value;
    if (!instanceUrl || !sessionId) {
        alert(`No ${orgSide} org credentials.`);
        return;
    }

    // Create popover anchored near the button
    const pop = document.createElement('div');
    pop.id = 'auditPopover';
    pop.className = 'fixed z-[100] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl w-96 max-h-80 flex flex-col text-sm';

    // Position near button
    const rect = btnEl.getBoundingClientRect();
    pop.style.top = `${rect.bottom + 6}px`;
    pop.style.right = `${window.innerWidth - rect.right}px`;

    const orgLabel = orgSide === 'source' ? 'Source' : 'Target';
    const badgeColor = orgSide === 'source' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';

    pop.innerHTML = `
        <div class="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center flex-none">
            <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-gray-800 dark:text-gray-200">🕐 ${compName}</span>
                <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded ${badgeColor}">${orgLabel}</span>
            </div>
            <button onclick="document.getElementById('auditPopover').remove()" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
        <div class="flex-1 overflow-y-auto p-3" id="auditPopContent">
            <div class="flex justify-center py-6">
                <svg class="animate-spin h-5 w-5 text-salesforce" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
        </div>`;

    document.body.appendChild(pop);

    // Close on outside click
    const closeHandler = (e) => {
        if (!pop.contains(e.target) && e.target !== btnEl) {
            pop.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);

    // Query SetupAuditTrail
    try {
        const q = `SELECT Action, CreatedBy.Name, CreatedDate, Display, Section FROM SetupAuditTrail WHERE Display LIKE '%${compName}%' ORDER BY CreatedDate DESC LIMIT 25`;
        const url = `/api/proxy/query?instanceUrl=${encodeURIComponent(instanceUrl)}&sessionId=${encodeURIComponent(sessionId)}&q=${encodeURIComponent(q)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const records = data.records || [];
        const content = document.getElementById('auditPopContent');
        if (!content) return;

        if (records.length === 0) {
            content.innerHTML = '<p class="text-center text-xs text-gray-400 py-4">No audit trail found (last 180 days)</p>';
            return;
        }

        content.innerHTML = `<div class="space-y-2">${records.map(r => {
            const date = new Date(r.CreatedDate).toLocaleString();
            const user = r.CreatedBy?.Name || 'Unknown';
            return `<div class="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2 border border-gray-100 dark:border-gray-600">
                <div class="flex justify-between items-start mb-0.5">
                    <span class="text-[11px] font-medium text-gray-800 dark:text-gray-200">${user}</span>
                    <span class="text-[10px] text-gray-400 whitespace-nowrap ml-2">${date}</span>
                </div>
                <p class="text-[11px] text-gray-500 dark:text-gray-400">${r.Display || r.Action || '-'}</p>
            </div>`;
        }).join('')}</div>`;
    } catch (e) {
        const content = document.getElementById('auditPopContent');
        if (content) content.innerHTML = `<p class="text-center text-xs text-red-400 py-4">${e.message}</p>`;
    }
};
