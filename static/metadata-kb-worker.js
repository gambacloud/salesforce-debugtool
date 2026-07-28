/**
 * static/metadata-kb-worker.js
 *
 * Runs off the main thread so the drop/progress UI never freezes. Unzips the
 * uploaded Salesforce metadata package with JSZip, classifies each entry the
 * same way sfdc-metadata-visualizer's parser/index.js does (adapted here to
 * also recognize Profiles), parses it via metadata-kb-parsers.js, then builds
 * a single Markdown "knowledge base" document sized for pasting into
 * NotebookLM.
 */

importScripts(
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/fast-xml-parser/5.2.5/fxparser.min.js',
    'metadata-kb-parsers.js'
);

self.onmessage = function (e) {
    handleMessage(e.data).catch(function (err) {
        self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
    });
};

function decodeApiFilename(name) {
    try { return decodeURIComponent(name); } catch (e) { return name; }
}

async function handleMessage(data) {
    var fileName = data.fileName;
    var buffer = data.buffer;

    var zip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch (err) {
        throw new Error('Could not read this file as a ZIP archive: ' + ((err && err.message) || err));
    }

    var entries = [];
    zip.forEach(function (relPath, file) { if (!file.dir) entries.push(file); });

    if (entries.length === 0) {
        throw new Error('The ZIP archive is empty.');
    }

    var total = entries.length;
    var done = 0;
    function progress(label) {
        done++;
        self.postMessage({ type: 'progress', done: done, total: total, label: label });
    }

    var P = self.SfdcParsers;
    var nodes = { objects: [], flows: [], triggers: [], classes: [], profiles: [], customMetadata: [] };
    var lwcMap = {};
    var auraMap = {};
    var counts = {
        objects: 0, events: 0, customMetadataTypes: 0, flows: 0, triggers: 0, classes: 0,
        lwc: 0, aura: 0, profiles: 0, customMetadata: 0, skipped: 0,
    };

    for (var i = 0; i < entries.length; i++) {
        var file = entries[i];
        var entryPath = file.name.replace(/\\/g, '/');
        var lower = entryPath.toLowerCase();
        // Classic Metadata API retrieve zips URL-encode special characters (e.g. ":", " ")
        // in filenames derived from labels (mainly Profiles) — decode for a readable name.
        var filename = decodeApiFilename(entryPath.split('/').pop());

        // ── Flows ── (".flow" is the classic Metadata API retrieve format; ".flow-meta.xml" is SFDX source format)
        if (lower.endsWith('.flow-meta.xml') || lower.endsWith('.flow') || (lower.includes('/flows/') && lower.endsWith('.xml'))) {
            var flowName = filename.replace(/\.flow-meta\.xml$/i, '').replace(/\.flow$/i, '').replace(/\.xml$/i, '');
            var flowXml = await file.async('string');
            var flowNode = P.parseFlow(flowName, flowXml);
            if (flowNode) {
                flowNode.sourcePath = entryPath;
                flowNode.mermaid = P.buildFlowMermaid(flowXml);
                nodes.flows.push(flowNode); counts.flows++;
            }
            progress('Flows');
            continue;
        }

        // ── Triggers ──
        if (lower.endsWith('.trigger') || lower.endsWith('.trigger-meta.xml')) {
            if (lower.endsWith('-meta.xml')) { progress('Triggers'); continue; }
            var trgName = filename.replace(/\.trigger.*$/i, '');
            var trgCode = await file.async('string');
            var trgNode = P.parseTrigger(trgName, trgCode);
            if (trgNode) {
                trgNode.sourcePath = entryPath;
                trgNode.sourceContent = trgCode;
                nodes.triggers.push(trgNode); counts.triggers++;
            }
            progress('Apex Triggers');
            continue;
        }

        // ── Apex Classes ──
        if (lower.endsWith('.cls') && !lower.endsWith('.cls-meta.xml')) {
            var clsName = filename.replace(/\.cls$/i, '');
            var clsCode = await file.async('string');
            var clsNode = P.parseApexClass(clsName, clsCode);
            if (clsNode) {
                clsNode.sourcePath = entryPath;
                clsNode.sourceContent = clsCode;
                nodes.classes.push(clsNode); counts.classes++;
            }
            progress('Apex Classes');
            continue;
        }

        // ── Custom Objects / Platform Events / Custom Metadata Types ── (".object" is the classic Metadata API retrieve format)
        if (lower.endsWith('.object-meta.xml') || lower.endsWith('.object') || (lower.includes('/objects/') && lower.endsWith('.xml'))) {
            var objName = filename.replace(/\.object-meta\.xml$/i, '').replace(/\.object$/i, '').replace(/\.xml$/i, '');
            var isPlatformEvent = objName.endsWith('__e') || lower.includes('/platformevents/');
            var isCustomMetadataType = objName.endsWith('__mdt');
            var objNode = P.parseCustomObject(objName, await file.async('string'), isPlatformEvent);
            if (objNode) {
                if (isCustomMetadataType) objNode.type = 'CustomMetadataType';
                objNode.sourcePath = entryPath;
                nodes.objects.push(objNode);
                if (isPlatformEvent) counts.events++;
                else if (isCustomMetadataType) counts.customMetadataTypes++;
                else counts.objects++;
            }
            progress('Custom Objects');
            continue;
        }

        // ── Profiles ── (".profile" is the classic Metadata API retrieve format)
        if (lower.endsWith('.profile-meta.xml') || lower.endsWith('.profile') || (lower.includes('/profiles/') && lower.endsWith('.xml'))) {
            var profName = filename.replace(/\.profile-meta\.xml$/i, '').replace(/\.profile$/i, '').replace(/\.xml$/i, '');
            var profNode = P.parseProfile(profName, await file.async('string'));
            if (profNode) { profNode.sourcePath = entryPath; nodes.profiles.push(profNode); counts.profiles++; }
            progress('Profiles');
            continue;
        }

        // ── Custom Metadata Records ── (".md" is the classic Metadata API retrieve format, ".md-meta.xml" is SFDX source format)
        // This is where a lot of framework config actually lives (feature flags, trigger-handler
        // registries, integration settings) — easy to miss since it's not "code" or a standard object.
        // Path-segment check (not a "/customMetadata/" substring) since the folder may sit at the ZIP root with no wrapping directory.
        var isInCustomMetadataFolder = lower.split('/').indexOf('custommetadata') !== -1;
        if (lower.endsWith('.md-meta.xml') || (lower.endsWith('.md') && isInCustomMetadataFolder) || (isInCustomMetadataFolder && lower.endsWith('.xml'))) {
            var cmdName = filename.replace(/\.md-meta\.xml$/i, '').replace(/\.md$/i, '').replace(/\.xml$/i, '');
            var cmdNode = P.parseCustomMetadataRecord(cmdName, await file.async('string'));
            if (cmdNode) { cmdNode.sourcePath = entryPath; nodes.customMetadata.push(cmdNode); counts.customMetadata++; }
            progress('Custom Metadata');
            continue;
        }

        // ── LWC ── (path may or may not have a wrapping folder before "lwc/")
        var lwcParts = entryPath.split('/');
        var lwcIdx = lwcParts.findIndex(function (p) { return p.toLowerCase() === 'lwc'; });
        if (lwcIdx !== -1) {
            var lwcComp = lwcParts[lwcIdx + 1];
            if (lwcComp) {
                if (!lwcMap[lwcComp]) lwcMap[lwcComp] = {};
                if (lower.endsWith('.js') && !lower.endsWith('.test.js')) {
                    lwcMap[lwcComp].js = await file.async('string');
                    lwcMap[lwcComp].jsPath = entryPath;
                } else if (lower.endsWith('.html')) {
                    lwcMap[lwcComp].html = await file.async('string');
                    lwcMap[lwcComp].htmlPath = entryPath;
                } else {
                    // .css, .js-meta.xml, .svg, test files, etc. — not captured, but still
                    // counted so "skipped" honestly reflects everything not in this document.
                    counts.skipped++;
                }
            } else {
                counts.skipped++;
            }
            progress('LWC');
            continue;
        }

        // ── Aura ── (same reasoning as LWC above)
        var auraParts = entryPath.split('/');
        var auraIdx = auraParts.findIndex(function (p) { return p.toLowerCase() === 'aura'; });
        if (auraIdx !== -1) {
            var auraComp = auraParts[auraIdx + 1];
            if (auraComp) {
                if (!auraMap[auraComp]) auraMap[auraComp] = {};
                if (lower.endsWith('.cmp')) {
                    auraMap[auraComp].cmp = await file.async('string');
                    auraMap[auraComp].cmpPath = entryPath;
                } else if (lower.endsWith('controller.js')) {
                    auraMap[auraComp].controllerJs = await file.async('string');
                    auraMap[auraComp].controllerJsPath = entryPath;
                } else {
                    // .css, .design, .svg, .auradoc, helper.js, renderer.js, etc. — not captured,
                    // but still counted so "skipped" honestly reflects everything not in this document.
                    counts.skipped++;
                }
            } else {
                counts.skipped++;
            }
            progress('Aura');
            continue;
        }

        counts.skipped++;
        progress('Other');
    }

    var lwcNodes = Object.keys(lwcMap).map(function (compName) {
        var files = lwcMap[compName];
        var jsData = files.js ? P.parseLwcJs(compName, files.js) : {};
        var htmlData = files.html ? P.parseLwcHtml(compName, files.html) : {};
        var sourceFiles = [];
        if (files.js) sourceFiles.push({ path: files.jsPath, content: files.js });
        if (files.html) sourceFiles.push({ path: files.htmlPath, content: files.html });
        return {
            name: compName,
            apexImports: jsData.apexImports || [],
            usesNavigation: jsData.usesNavigation || false,
            flowInvoke: jsData.flowInvoke || [],
            flowRefs: htmlData.flowRefs || [],
            childComponents: htmlData.childComponents || [],
            sourceFiles: sourceFiles,
        };
    });
    counts.lwc = lwcNodes.length;

    var auraNodes = Object.keys(auraMap).map(function (compName) {
        var files = auraMap[compName];
        var cmpData = files.cmp ? P.parseAuraCmp(compName, files.cmp) : {};
        var ctrlData = files.controllerJs ? P.parseAuraController(compName, files.controllerJs) : {};
        var sourceFiles = [];
        if (files.cmp) sourceFiles.push({ path: files.cmpPath, content: files.cmp });
        if (files.controllerJs) sourceFiles.push({ path: files.controllerJsPath, content: files.controllerJs });
        return {
            name: compName,
            flowRefs: cmpData.flowRefs || [],
            controller: cmpData.controller || null,
            childComponents: cmpData.childComponents || [],
            apexMethods: ctrlData.apexCalls || [],
            sourceFiles: sourceFiles,
        };
    });
    counts.aura = auraNodes.length;

    var edges = P.buildDependencyEdges({
        objects: nodes.objects, flows: nodes.flows, triggers: nodes.triggers,
        classes: nodes.classes, lwc: lwcNodes, aura: auraNodes, profiles: nodes.profiles,
    });

    var stats = {
        fileName: fileName,
        generatedAt: new Date().toISOString(),
        totalEntries: total,
        counts: counts,
    };
    stats.counts.edges = edges.length;

    var markdown = buildMarkdown(stats, nodes, lwcNodes, auraNodes, edges);

    self.postMessage({ type: 'done', markdown: markdown, stats: stats });
}

// ── Markdown assembly ────────────────────────────────────────────────────────

function mdEscape(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function mdCode(text) {
    if (text === null || text === undefined || text === '') return '';
    return '`' + String(text).replace(/`/g, "'").replace(/\r?\n/g, ' ') + '`';
}

function mdTable(headers, rows) {
    if (rows.length === 0) return '_None_\n';
    var lines = [];
    lines.push('| ' + headers.join(' | ') + ' |');
    lines.push('| ' + headers.map(function () { return '---'; }).join(' | ') + ' |');
    rows.forEach(function (row) {
        lines.push('| ' + row.map(mdEscape).join(' | ') + ' |');
    });
    return lines.join('\n') + '\n';
}

function yesNo(v) { return v ? 'Yes' : 'No'; }

// Repomix-style citation block: wraps real file content in a <file path="..."> tag
// with injected "line-number + tab" prefixes (same convention this toolchain's own
// file-reading tools use), so an LLM/NotebookLM can quote or cite an exact line.
function injectLineNumbers(content) {
    // Single-pass regex instead of split/map/join — avoids materializing two
    // intermediate line-count-sized arrays, matters on multi-thousand-line
    // Apex files. Normalize CRLF first so /^/gm (which only special-cases \n)
    // doesn't leave a stray \r at the end of each numbered line.
    var normalized = content.replace(/\r\n/g, '\n');
    var lineNum = 1;
    return normalized.replace(/^/gm, function () { return (lineNum++) + '\t'; });
}
function renderSourceFile(path, content) {
    return '<file path="' + path + '">\n' + injectLineNumbers(content) + '\n</file>';
}
function sourceLine(path) {
    return path ? '- **Source:** `' + path + '`' : null;
}

var EDGE_LABELS = {
    'trigger-handler': 'handled by', 'apex-call': 'calls', 'flow-invoke': 'invokes flow',
    'executes-batch': 'executes batch', 'enqueues-job': 'enqueues job', 'publishes-event': 'publishes event',
    'extends': 'extends', 'dml': 'DML on', 'query': 'queries', 'subflow': 'calls subflow',
    'flow-apex': 'calls apex action', 'apex-import': 'imports apex', 'embeds-flow': 'embeds flow',
    'child-component': 'uses component', 'apex-controller': 'uses controller',
    'formula-ref': 'formula references', 'profile-access': 'grants access to',
    'object-permission': 'has object permissions on', 'field-permission': 'has field permissions on',
};
function edgeLabel(type) { return EDGE_LABELS[type] || type; }

function buildReverseIndex(edges) {
    var index = {};
    edges.forEach(function (e) {
        var key = e.toType + '|' + e.to;
        if (!index[key]) index[key] = [];
        index[key].push({ from: e.from, fromType: e.fromType, type: e.type });
    });
    return index;
}

function usedByLine(reverseIndex, type, name) {
    var incoming = reverseIndex[type + '|' + name];
    if (!incoming || incoming.length === 0) return null;
    return '- Used by: ' + incoming.map(function (i) { return i.from + ' (' + edgeLabel(i.type) + ')'; }).join(', ');
}

function buildMarkdown(stats, nodes, lwcNodes, auraNodes, edges) {
    var c = stats.counts;
    var out = [];
    var reverseIndex = buildReverseIndex(edges);

    out.push('# Salesforce Metadata Knowledge Base');
    out.push('');
    out.push('This document is a structured dump of a Salesforce org\'s metadata — Apex classes/triggers, Flows (with control-flow diagrams), Custom Objects/Fields/Formulas, Custom Metadata Types & Records, LWC/Aura components, and Profile permissions.');
    out.push('Start with the Source Manifest and Dependency Graph sections to find what\'s relevant, then use the numbered `<file path="...">` blocks under each component to cite exact source lines.');
    out.push('');
    out.push('⚠ This is not a complete mirror of the org: only the types above are parsed. Permission Sets, Page Layouts, Static Resources, Workflow Rules, Approval Processes, Reports/Dashboards, and other metadata types are **not** included — see "Not Parsed" in the summary below for how much of this ZIP that is.');
    out.push('');
    out.push('- Generated: ' + stats.generatedAt);
    out.push('- Source ZIP: ' + stats.fileName);
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push(mdTable(['Type', 'Count'], [
        ['Custom Objects', c.objects],
        ['Platform Events', c.events],
        ['Custom Metadata Types', c.customMetadataTypes],
        ['Flows', c.flows],
        ['Apex Classes', c.classes],
        ['Apex Triggers', c.triggers],
        ['Lightning Web Components', c.lwc],
        ['Aura Components', c.aura],
        ['Profiles', c.profiles],
        ['Custom Metadata Records', c.customMetadata],
        ['Dependency Edges', edges.length],
        ['Not Parsed (other metadata types)', c.skipped],
    ]));

    // ── Source Manifest & References ──
    out.push('## Source Manifest & References');
    out.push('');
    out.push('Quick per-object index of related files and permissions — use this to jump straight to the right source before reading the detailed sections below.');
    out.push('');
    if (nodes.objects.length === 0) {
        out.push('_None found._\n');
    } else {
        nodes.objects.forEach(function (obj) {
            out.push('### ' + obj.name);
            if (obj.sourcePath) out.push('- **Metadata File:** `' + obj.sourcePath + '`');

            var related = edges.filter(function (e) {
                return (e.to === obj.name && e.toType === 'CustomObject') || (e.from === obj.name && e.fromType === 'CustomObject');
            });

            var relatedApex = Array.from(new Set(
                related.filter(function (e) { return e.toType === 'CustomObject' && (e.fromType === 'ApexClass' || e.fromType === 'Trigger'); })
                    .map(function (e) { return e.from + (e.fromType === 'Trigger' ? ' (Trigger)' : ''); })
            ));
            if (relatedApex.length) out.push('- **Related Apex:** ' + relatedApex.join(', '));

            var relatedFlows = Array.from(new Set(
                related.filter(function (e) { return e.toType === 'CustomObject' && e.fromType === 'Flow'; }).map(function (e) { return e.from; })
            ));
            if (relatedFlows.length) out.push('- **Related Flows:** ' + relatedFlows.join(', '));

            var profileAccess = [];
            nodes.profiles.forEach(function (p) {
                var op = (p.objectPermissions || []).filter(function (x) { return x.object === obj.name; })[0];
                if (!op) return;
                var perms = [];
                if (op.read) perms.push('Read');
                if (op.create) perms.push('Create');
                if (op.edit) perms.push('Edit');
                if (op.deleteAccess) perms.push('Delete');
                if (op.viewAll) perms.push('ViewAll');
                if (op.modifyAll) perms.push('ModifyAll');
                profileAccess.push(p.name + (perms.length ? ' (' + perms.join(', ') + ')' : ' (no CRUD)'));
            });
            if (profileAccess.length) out.push('- **Profile Access:** ' + profileAccess.join(', '));

            out.push('');
        });
    }

    // ── Dependency Graph ──
    out.push('## Dependency Graph');
    out.push('');
    out.push('Relationships resolved between the components above (only edges whose target was actually found in this package — no unresolved/external guesses). Each entity\'s own section below also lists what depends on it under "Used by".');
    out.push('');
    if (edges.length === 0) {
        out.push('_None found._\n');
    } else {
        out.push(mdTable(
            ['From', 'From Type', 'Relationship', 'To', 'To Type'],
            edges.map(function (e) { return [e.from, e.fromType, edgeLabel(e.type), e.to, e.toType]; })
        ));
    }

    // ── Custom Objects ──
    out.push('## Custom Objects');
    out.push('');
    if (nodes.objects.length === 0) out.push('_None found._\n');
    nodes.objects.forEach(function (obj) {
        var objTypeTag = obj.type === 'PlatformEvent' ? ' _(Platform Event)_' : (obj.type === 'CustomMetadataType' ? ' _(Custom Metadata Type)_' : '');
        out.push('### ' + obj.name + (obj.label && obj.label !== obj.name ? ' — ' + obj.label : '') + objTypeTag);
        out.push('');
        if (obj.plural) out.push('Plural label: ' + obj.plural);
        var objSrc = sourceLine(obj.sourcePath);
        if (objSrc) out.push(objSrc);
        out.push('');
        out.push('**Fields:**');
        out.push('');
        out.push(mdTable(
            ['Field', 'Label', 'Type', 'References'],
            obj.fields.map(function (f) { return [f.name, f.label, f.type, f.ref || '']; })
        ));

        var formulaFields = obj.formulaFields || [];
        if (formulaFields.length > 0) {
            out.push('**Formula Fields:**');
            out.push('');
            formulaFields.forEach(function (ff) {
                out.push('- **' + ff.fieldName + '**' + (ff.label ? ' (' + ff.label + ')' : '') + ' — returns ' + (ff.returnType || 'unknown') + ':  ' + mdCode(ff.expression));
                if (ff.crossObjectRefs.length > 0) {
                    out.push('  - Cross-object refs: ' + ff.crossObjectRefs.map(function (r) { return r.objectRef + '.' + r.field; }).join(', '));
                }
                if (ff.sameObjectRefs.length > 0) {
                    out.push('  - Same-object refs: ' + ff.sameObjectRefs.join(', '));
                }
            });
            out.push('');
        }

        var relationships = obj.relationships || [];
        if (relationships.length > 0) {
            out.push('**Relationships:**');
            out.push('');
            out.push(mdTable(
                ['Field', 'Type', 'References'],
                relationships.map(function (r) { return [r.field, r.type, r.referenceTo]; })
            ));
        }

        var ubObj = usedByLine(reverseIndex, 'CustomObject', obj.name);
        if (ubObj) out.push(ubObj);
        out.push('');
    });

    // ── Flows ──
    out.push('## Flows');
    out.push('');
    if (nodes.flows.length === 0) out.push('_None found._\n');
    nodes.flows.forEach(function (flow) {
        out.push('### ' + flow.name + (flow.label && flow.label !== flow.name ? ' — ' + flow.label : ''));
        out.push('');
        var flowSrc = sourceLine(flow.sourcePath);
        if (flowSrc) out.push(flowSrc);
        out.push('- Process type: ' + (flow.processType || 'n/a'));
        out.push('- Status: ' + (flow.status || 'n/a'));
        out.push('- Object: ' + (flow.object || 'n/a'));
        out.push('- Trigger type: ' + (flow.triggerType || 'n/a') + (flow.recTrigType ? ' (' + flow.recTrigType + ')' : ''));
        if (flow.subflows.length) out.push('- Subflows: ' + flow.subflows.join(', '));
        if (flow.actionCalls.length) out.push('- Apex/action calls: ' + flow.actionCalls.map(function (a) { return a.name; }).join(', '));
        if (flow.dmlObjects.length) out.push('- DML objects: ' + flow.dmlObjects.join(', '));
        if (flow.queryObjects.length) out.push('- Query objects: ' + flow.queryObjects.join(', '));
        if (flow.decisions.length) out.push('- Decisions: ' + flow.decisions.map(function (d) { return d.label || d.name; }).join(', '));
        if (flow.formulas.length) {
            out.push('- Formulas:');
            flow.formulas.forEach(function (f) {
                out.push('  - ' + f.name + ': ' + mdCode(f.expression) + (f.usedInDecisions.length ? ' (used in: ' + f.usedInDecisions.join(', ') + ')' : ''));
            });
        }
        var ubFlow = usedByLine(reverseIndex, 'Flow', flow.name);
        if (ubFlow) out.push(ubFlow);
        if (flow.mermaid) {
            out.push('');
            out.push('**Logic:**');
            out.push('');
            out.push('```mermaid');
            out.push(flow.mermaid);
            out.push('```');
        }
        out.push('');
    });

    // ── Apex Classes ──
    out.push('## Apex Classes');
    out.push('');
    if (nodes.classes.length === 0) out.push('_None found._\n');
    nodes.classes.forEach(function (cls) {
        out.push('### ' + cls.name);
        out.push('');
        var clsSrc = sourceLine(cls.sourcePath);
        if (clsSrc) out.push(clsSrc);
        if (cls.extendsClass) out.push('- Extends: ' + cls.extendsClass);
        if (cls.implementsList.length) out.push('- Implements: ' + cls.implementsList.join(', '));
        var sharing = cls.withoutSharing ? 'without sharing' : (cls.withSharing ? 'with sharing' : (cls.inheritedSharing ? 'inherited sharing' : 'unspecified'));
        out.push('- Sharing model: ' + sharing);
        var flags = [];
        if (cls.isBatch) flags.push('Batchable');
        if (cls.isQueueable) flags.push('Queueable');
        if (cls.isSchedulable) flags.push('Schedulable');
        if (cls.isFuture) flags.push('@future');
        if (cls.isInvocable) flags.push('@InvocableMethod');
        if (cls.isTriggerHandler) flags.push('TriggerHandler');
        if (flags.length) out.push('- Flags: ' + flags.join(', '));
        if (cls.restResource) out.push('- REST resource: ' + cls.restResource + (cls.restMethods.length ? ' (' + cls.restMethods.join(', ') + ')' : ''));
        if (cls.dmlObjects.length) out.push('- DML objects: ' + cls.dmlObjects.join(', ') + ' (' + Object.keys(cls.dmlVerbs).map(function (v) { return v + ':' + cls.dmlVerbs[v]; }).join(', ') + ')');
        if (cls.publishes.length) out.push('- Publishes platform events: ' + cls.publishes.join(', '));
        if (cls.callouts.length) out.push('- Callouts (named credentials): ' + cls.callouts.join(', '));
        if (cls.batchCalls.length) out.push('- Executes batches: ' + cls.batchCalls.join(', '));
        if (cls.queueableCalls.length) out.push('- Enqueues jobs: ' + cls.queueableCalls.join(', '));
        if (cls.flowInvoke.length) out.push('- Invokes flows: ' + cls.flowInvoke.join(', '));
        if (cls.classCalls.length) out.push('- Calls classes: ' + cls.classCalls.join(', '));
        if (cls.dmlInLoop) out.push('- ⚠ DML detected inside a loop');
        if (cls.soqlInLoop) out.push('- ⚠ SOQL detected inside a loop');
        var ubCls = usedByLine(reverseIndex, 'ApexClass', cls.name);
        if (ubCls) out.push(ubCls);
        if (cls.sourcePath && cls.sourceContent) {
            out.push('');
            out.push('**Source:**');
            out.push('');
            out.push(renderSourceFile(cls.sourcePath, cls.sourceContent));
        }
        out.push('');
    });

    // ── Apex Triggers ──
    out.push('## Apex Triggers');
    out.push('');
    if (nodes.triggers.length === 0) out.push('_None found._\n');
    nodes.triggers.forEach(function (trg) {
        out.push('### ' + trg.name);
        out.push('');
        var trgSrc = sourceLine(trg.sourcePath);
        if (trgSrc) out.push(trgSrc);
        out.push('- Object: ' + (trg.object || 'n/a'));
        out.push('- Events: ' + trg.events.join(', '));
        if (trg.handlers.length) out.push('- Handler classes: ' + trg.handlers.join(', '));
        if (trg.flowInvoke.length) out.push('- Invokes flows: ' + trg.flowInvoke.join(', '));
        if (trg.batches.length) out.push('- Executes batches: ' + trg.batches.join(', '));
        if (trg.publishes.length) out.push('- Publishes platform events: ' + trg.publishes.join(', '));
        var ubTrg = usedByLine(reverseIndex, 'Trigger', trg.name);
        if (ubTrg) out.push(ubTrg);
        if (trg.sourcePath && trg.sourceContent) {
            out.push('');
            out.push('**Source:**');
            out.push('');
            out.push(renderSourceFile(trg.sourcePath, trg.sourceContent));
        }
        out.push('');
    });

    // ── LWC ──
    out.push('## Lightning Web Components');
    out.push('');
    if (lwcNodes.length === 0) out.push('_None found._\n');
    lwcNodes.forEach(function (lwc) {
        out.push('### ' + lwc.name);
        out.push('');
        if (lwc.apexImports.length) out.push('- Apex imports: ' + lwc.apexImports.map(function (a) { return a.class + (a.method ? '.' + a.method : ''); }).join(', '));
        out.push('- Uses NavigationMixin: ' + yesNo(lwc.usesNavigation));
        if (lwc.flowInvoke.length) out.push('- Flow.Interview invocations: ' + lwc.flowInvoke.join(', '));
        if (lwc.flowRefs.length) out.push('- Embedded flows (lightning-flow): ' + lwc.flowRefs.join(', '));
        if (lwc.childComponents.length) out.push('- Child components: ' + lwc.childComponents.join(', '));
        var ubLwc = usedByLine(reverseIndex, 'LWC', lwc.name);
        if (ubLwc) out.push(ubLwc);
        if (lwc.sourceFiles && lwc.sourceFiles.length) {
            out.push('');
            out.push('**Source:**');
            out.push('');
            lwc.sourceFiles.forEach(function (sf) { out.push(renderSourceFile(sf.path, sf.content)); });
        }
        out.push('');
    });

    // ── Aura ──
    out.push('## Aura Components');
    out.push('');
    if (auraNodes.length === 0) out.push('_None found._\n');
    auraNodes.forEach(function (aura) {
        out.push('### ' + aura.name);
        out.push('');
        if (aura.controller) out.push('- Apex controller: ' + aura.controller);
        if (aura.flowRefs.length) out.push('- Embedded flows: ' + aura.flowRefs.join(', '));
        if (aura.childComponents.length) out.push('- Child components: ' + aura.childComponents.join(', '));
        if (aura.apexMethods.length) out.push('- Apex methods called from controller.js: ' + aura.apexMethods.join(', '));
        var ubAura = usedByLine(reverseIndex, 'Aura', aura.name);
        if (ubAura) out.push(ubAura);
        if (aura.sourceFiles && aura.sourceFiles.length) {
            out.push('');
            out.push('**Source:**');
            out.push('');
            aura.sourceFiles.forEach(function (sf) { out.push(renderSourceFile(sf.path, sf.content)); });
        }
        out.push('');
    });

    // ── Profiles ──
    out.push('## Profiles & Permissions');
    out.push('');
    if (nodes.profiles.length === 0) out.push('_None found._\n');
    nodes.profiles.forEach(function (prof) {
        out.push('### ' + prof.name);
        out.push('');
        var profSrc = sourceLine(prof.sourcePath);
        if (profSrc) out.push(profSrc);
        out.push('- User license: ' + (prof.userLicense || 'n/a'));
        out.push('- Custom profile: ' + yesNo(prof.custom));
        if (prof.systemPermissions.length) out.push('- Enabled system permissions: ' + prof.systemPermissions.join(', '));
        out.push('');

        out.push('**Object Permissions:**');
        out.push('');
        out.push(mdTable(
            ['Object', 'Read', 'Create', 'Edit', 'Delete', 'View All', 'Modify All'],
            prof.objectPermissions.map(function (p) {
                return [p.object, yesNo(p.read), yesNo(p.create), yesNo(p.edit), yesNo(p.deleteAccess), yesNo(p.viewAll), yesNo(p.modifyAll)];
            })
        ));

        if (prof.fieldPermissions.length) {
            out.push('**Field-Level Security:**');
            out.push('');
            out.push(mdTable(
                ['Field', 'Readable', 'Editable'],
                prof.fieldPermissions.map(function (p) { return [p.field, yesNo(p.readable), yesNo(p.editable)]; })
            ));
        }

        if (prof.classAccesses.length) out.push('- Enabled Apex class access: ' + prof.classAccesses.map(function (a) { return a.apexClass; }).join(', '));
        if (prof.pageAccesses.length) out.push('- Enabled Visualforce page access: ' + prof.pageAccesses.map(function (a) { return a.apexPage; }).join(', '));
        if (prof.tabVisibilities.length) out.push('- Tab visibility: ' + prof.tabVisibilities.map(function (t) { return t.tab + ' (' + t.visibility + ')'; }).join(', '));
        if (prof.recordTypeVisibilities.length) out.push('- Record type visibility: ' + prof.recordTypeVisibilities.map(function (r) { return r.recordType + (r.visible ? ' (visible' + (r.isDefault ? ', default' : '') + ')' : ' (hidden)'); }).join(', '));
        out.push('');
    });

    // ── Custom Metadata Records ──
    out.push('## Custom Metadata Records');
    out.push('');
    out.push('Configuration rows for Custom Metadata Types — often where framework/feature-flag/integration settings actually live, distinct from the type definitions listed under Custom Objects above.');
    out.push('');
    if (nodes.customMetadata.length === 0) out.push('_None found._\n');
    nodes.customMetadata.forEach(function (cmd) {
        out.push('### ' + cmd.name + (cmd.label && cmd.label !== cmd.developerName ? ' — ' + cmd.label : ''));
        out.push('');
        var cmdSrc = sourceLine(cmd.sourcePath);
        if (cmdSrc) out.push(cmdSrc);
        if (cmd.metadataType) out.push('- Metadata Type: ' + cmd.metadataType);
        out.push('- Protected: ' + yesNo(cmd.protected));
        out.push('');
        out.push(mdTable(['Field', 'Value'], cmd.values.map(function (v) { return [v.field, v.value]; })));
    });

    return out.join('\n');
}
