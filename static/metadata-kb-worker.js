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
    var nodes = { objects: [], flows: [], triggers: [], classes: [], profiles: [] };
    var lwcMap = {};
    var auraMap = {};
    var counts = {
        objects: 0, events: 0, flows: 0, triggers: 0, classes: 0,
        lwc: 0, aura: 0, profiles: 0, skipped: 0,
    };

    for (var i = 0; i < entries.length; i++) {
        var file = entries[i];
        var entryPath = file.name.replace(/\\/g, '/');
        var lower = entryPath.toLowerCase();
        var filename = entryPath.split('/').pop();

        // ── Flows ──
        if (lower.endsWith('.flow-meta.xml') || (lower.includes('/flows/') && lower.endsWith('.xml'))) {
            var flowName = filename.replace(/\.flow-meta\.xml$/i, '').replace(/\.xml$/i, '');
            var flowNode = P.parseFlow(flowName, await file.async('string'));
            if (flowNode) { nodes.flows.push(flowNode); counts.flows++; }
            progress('Flows');
            continue;
        }

        // ── Triggers ──
        if (lower.endsWith('.trigger') || lower.endsWith('.trigger-meta.xml')) {
            if (lower.endsWith('-meta.xml')) { progress('Triggers'); continue; }
            var trgName = filename.replace(/\.trigger.*$/i, '');
            var trgNode = P.parseTrigger(trgName, await file.async('string'));
            if (trgNode) { nodes.triggers.push(trgNode); counts.triggers++; }
            progress('Apex Triggers');
            continue;
        }

        // ── Apex Classes ──
        if (lower.endsWith('.cls') && !lower.endsWith('.cls-meta.xml')) {
            var clsName = filename.replace(/\.cls$/i, '');
            var clsNode = P.parseApexClass(clsName, await file.async('string'));
            if (clsNode) { nodes.classes.push(clsNode); counts.classes++; }
            progress('Apex Classes');
            continue;
        }

        // ── Custom Objects / Platform Events ──
        if (lower.endsWith('.object-meta.xml') || (lower.includes('/objects/') && lower.endsWith('.xml'))) {
            var objName = filename.replace(/\.object-meta\.xml$/i, '').replace(/\.xml$/i, '');
            var isPlatformEvent = objName.endsWith('__e') || lower.includes('/platformevents/');
            var objNode = P.parseCustomObject(objName, await file.async('string'), isPlatformEvent);
            if (objNode) {
                nodes.objects.push(objNode);
                if (isPlatformEvent) counts.events++; else counts.objects++;
            }
            progress('Custom Objects');
            continue;
        }

        // ── Profiles ──
        if (lower.endsWith('.profile-meta.xml') || (lower.includes('/profiles/') && lower.endsWith('.xml'))) {
            var profName = filename.replace(/\.profile-meta\.xml$/i, '').replace(/\.xml$/i, '');
            var profNode = P.parseProfile(profName, await file.async('string'));
            if (profNode) { nodes.profiles.push(profNode); counts.profiles++; }
            progress('Profiles');
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
                } else if (lower.endsWith('.html')) {
                    lwcMap[lwcComp].html = await file.async('string');
                }
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
                } else if (lower.endsWith('controller.js')) {
                    auraMap[auraComp].controllerJs = await file.async('string');
                }
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
        return {
            name: compName,
            apexImports: jsData.apexImports || [],
            usesNavigation: jsData.usesNavigation || false,
            flowInvoke: jsData.flowInvoke || [],
            flowRefs: htmlData.flowRefs || [],
            childComponents: htmlData.childComponents || [],
        };
    });
    counts.lwc = lwcNodes.length;

    var auraNodes = Object.keys(auraMap).map(function (compName) {
        var files = auraMap[compName];
        var cmpData = files.cmp ? P.parseAuraCmp(compName, files.cmp) : {};
        var ctrlData = files.controllerJs ? P.parseAuraController(compName, files.controllerJs) : {};
        return {
            name: compName,
            flowRefs: cmpData.flowRefs || [],
            controller: cmpData.controller || null,
            childComponents: cmpData.childComponents || [],
            apexMethods: ctrlData.apexCalls || [],
        };
    });
    counts.aura = auraNodes.length;

    var stats = {
        fileName: fileName,
        generatedAt: new Date().toISOString(),
        totalEntries: total,
        counts: counts,
    };

    var markdown = buildMarkdown(stats, nodes, lwcNodes, auraNodes);

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

function buildMarkdown(stats, nodes, lwcNodes, auraNodes) {
    var c = stats.counts;
    var out = [];

    out.push('# Salesforce Metadata Knowledge Base');
    out.push('');
    out.push('- Generated: ' + stats.generatedAt);
    out.push('- Source ZIP: ' + stats.fileName);
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push(mdTable(['Type', 'Count'], [
        ['Custom Objects', c.objects],
        ['Platform Events', c.events],
        ['Flows', c.flows],
        ['Apex Classes', c.classes],
        ['Apex Triggers', c.triggers],
        ['Lightning Web Components', c.lwc],
        ['Aura Components', c.aura],
        ['Profiles', c.profiles],
    ]));

    // ── Custom Objects ──
    out.push('## Custom Objects');
    out.push('');
    if (nodes.objects.length === 0) out.push('_None found._\n');
    nodes.objects.forEach(function (obj) {
        out.push('### ' + obj.name + (obj.label && obj.label !== obj.name ? ' — ' + obj.label : '') + (obj.type === 'PlatformEvent' ? ' _(Platform Event)_' : ''));
        out.push('');
        if (obj.plural) out.push('Plural label: ' + obj.plural);
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
    });

    // ── Flows ──
    out.push('## Flows');
    out.push('');
    if (nodes.flows.length === 0) out.push('_None found._\n');
    nodes.flows.forEach(function (flow) {
        out.push('### ' + flow.name + (flow.label && flow.label !== flow.name ? ' — ' + flow.label : ''));
        out.push('');
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
        out.push('');
    });

    // ── Apex Classes ──
    out.push('## Apex Classes');
    out.push('');
    if (nodes.classes.length === 0) out.push('_None found._\n');
    nodes.classes.forEach(function (cls) {
        out.push('### ' + cls.name);
        out.push('');
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
        out.push('');
    });

    // ── Apex Triggers ──
    out.push('## Apex Triggers');
    out.push('');
    if (nodes.triggers.length === 0) out.push('_None found._\n');
    nodes.triggers.forEach(function (trg) {
        out.push('### ' + trg.name);
        out.push('');
        out.push('- Object: ' + (trg.object || 'n/a'));
        out.push('- Events: ' + trg.events.join(', '));
        if (trg.handlers.length) out.push('- Handler classes: ' + trg.handlers.join(', '));
        if (trg.flowInvoke.length) out.push('- Invokes flows: ' + trg.flowInvoke.join(', '));
        if (trg.batches.length) out.push('- Executes batches: ' + trg.batches.join(', '));
        if (trg.publishes.length) out.push('- Publishes platform events: ' + trg.publishes.join(', '));
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
        out.push('');
    });

    // ── Profiles ──
    out.push('## Profiles & Permissions');
    out.push('');
    if (nodes.profiles.length === 0) out.push('_None found._\n');
    nodes.profiles.forEach(function (prof) {
        out.push('### ' + prof.name);
        out.push('');
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

    return out.join('\n');
}
