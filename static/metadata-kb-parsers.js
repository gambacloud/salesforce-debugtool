/**
 * static/metadata-kb-parsers.js
 *
 * Salesforce metadata XML/Apex parsers, adapted for the browser (runs inside
 * the metadata-kb Web Worker). Ported from the Node.js parsers in
 * https://github.com/gambacloud/sfdc-metadata-visualizer (parser/parsers/*.js)
 * — same extraction logic, with `require('fast-xml-parser')` swapped for the
 * global `XMLParser` provided by the fast-xml-parser CDN bundle, and
 * `module.exports` swapped for `self.SfdcParsers`. Kept in sync manually;
 * `parseProfile` is new (no equivalent in the source repo yet).
 */

(function () {
    'use strict';

    // The fast-xml-parser CDN/UMD bundle's export shape has varied across
    // versions/builds (bare class, {XMLParser}, or webpack-style {default}).
    // Resolve defensively instead of assuming one shape.
    function resolveXMLParserCtor() {
        if (typeof XMLParser === 'function') return XMLParser;
        if (XMLParser && typeof XMLParser.XMLParser === 'function') return XMLParser.XMLParser;
        if (XMLParser && typeof XMLParser.default === 'function') return XMLParser.default;
        if (XMLParser && XMLParser.default && typeof XMLParser.default.XMLParser === 'function') return XMLParser.default.XMLParser;
        throw new Error('Could not resolve the XMLParser constructor from the fast-xml-parser bundle');
    }

    var XMLParserCtor = resolveXMLParserCtor();
    var xmlParser = new XMLParserCtor({ ignoreAttributes: false, isArray: function () { return true; } });

    function str(v) { return typeof v === 'string' ? v.trim() : (v != null ? String(v).trim() : null); }
    function first(v) { return Array.isArray(v) ? v[0] : v; }
    function unique(arr) { return Array.from(new Set(arr.filter(Boolean))); }
    function dedup(arr, key) {
        var seen = new Set();
        return arr.filter(function (x) {
            var k = key(x);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    }

    // ── formulaField.js ─────────────────────────────────────────────────────
    var CROSS_OBJ_RE = /\b([A-Z][A-Za-z0-9]+(?:__r)?)\.([\w]+)\b/g;
    var MERGE_CROSS_RE = /\{!([A-Z][A-Za-z0-9]+(?:__r)?)\.([\w]+)\}/g;
    var BARE_FIELD_RE = /\b([A-Za-z][A-Za-z0-9_]+__c)\b/g;

    var SKIP_PREFIXES = new Set([
        'IF', 'AND', 'OR', 'NOT', 'ISBLANK', 'ISNULL', 'NULLVALUE', 'TEXT', 'VALUE', 'LEN',
        'LEFT', 'RIGHT', 'MID', 'FIND', 'SUBSTITUTE', 'TRIM', 'UPPER', 'LOWER',
        'TODAY', 'NOW', 'DATE', 'DATEVALUE', 'DATETIMEVALUE', 'YEAR', 'MONTH', 'DAY',
        'HOUR', 'MINUTE', 'SECOND', 'ADDMONTHS', 'WEEKDAY',
        'ABS', 'CEILING', 'FLOOR', 'MAX', 'MIN', 'MOD', 'ROUND', 'SQRT', 'EXP', 'LN', 'LOG',
        'HYPERLINK', 'IMAGE', 'INCLUDES', 'ISPICKVAL', 'CASE', 'BEGINS', 'CONTAINS', 'REGEX',
        'GETRECORDIDS', 'PRIORVALUE', 'ISCHANGED', 'ISNEW', 'PARENTGROUPVAL', 'PREVGROUPVAL',
        'VLOOKUP', 'BLANKVALUE',
        'TRUE', 'FALSE', 'NULL',
    ]);

    function parseFormulaFields(objectName, xml) {
        var doc;
        try { doc = xmlParser.parse(xml); } catch (e) { return []; }
        if (!doc || !doc.CustomObject) return [];
        var obj = doc.CustomObject[0] || {};

        var formulaFields = [];
        var fields = obj.fields || [];
        for (var i = 0; i < fields.length; i++) {
            var field = fields[i];
            var type = str(first(field.type));
            if (type !== 'Formula' && type !== 'Summary') continue;

            var fieldName = str(first(field.fullName));
            var label = str(first(field.label));
            var returnType = str(first(field.formulaTreatBlanksAs)) || str(first(field.type));
            var expression = str(first(field.formula)) || str(first(field.summaryFormula));
            if (!fieldName || !expression) continue;

            var crossObjectRefs = [];
            var sameObjectRefs = [];

            [CROSS_OBJ_RE, MERGE_CROSS_RE].forEach(function (re) {
                var m;
                re.lastIndex = 0;
                while ((m = re.exec(expression)) !== null) {
                    var objRef = m[1], fld = m[2];
                    if (SKIP_PREFIXES.has(objRef.toUpperCase())) continue;
                    crossObjectRefs.push({ objectRef: objRef, field: fld });
                }
            });

            BARE_FIELD_RE.lastIndex = 0;
            var bm;
            while ((bm = BARE_FIELD_RE.exec(expression)) !== null) {
                sameObjectRefs.push(bm[1]);
            }

            formulaFields.push({
                fieldName: fieldName,
                label: label,
                returnType: returnType,
                expression: expression,
                crossObjectRefs: dedup(crossObjectRefs, function (r) { return r.objectRef + '.' + r.field; }),
                sameObjectRefs: Array.from(new Set(sameObjectRefs)),
            });
        }

        return formulaFields;
    }

    function normaliseRelationship(ref) {
        if (ref.endsWith('__r')) return ref.slice(0, -3) + '__c';
        var KNOWN = {
            Account: 'Account', Contact: 'Contact', Lead: 'Lead', Opportunity: 'Opportunity',
            Case: 'Case', User: 'User', Parent: null, Owner: 'User', CreatedBy: 'User', LastModifiedBy: 'User',
        };
        if (ref in KNOWN) return KNOWN[ref];
        if (/^[A-Z]/.test(ref)) return ref;
        return null;
    }

    function buildFormulaEdges(objectName, formulaFields) {
        var edges = [];
        formulaFields.forEach(function (ff) {
            ff.crossObjectRefs.forEach(function (ref) {
                var targetObject = normaliseRelationship(ref.objectRef);
                if (!targetObject || targetObject === objectName) return;
                edges.push({
                    from: objectName,
                    to: targetObject,
                    edgeType: 'formula-ref',
                    viaField: ff.fieldName,
                    viaFormula: ff.expression.slice(0, 80),
                });
            });
        });
        return edges;
    }

    // ── customObject.js ─────────────────────────────────────────────────────
    function parseCustomObject(name, xml, isPlatformEvent) {
        var doc;
        try { doc = xmlParser.parse(xml); } catch (e) { return null; }
        if (!doc || !doc.CustomObject) return null;

        var obj = doc.CustomObject[0] || {};
        var label = str(first(obj.label)) || name;
        var plural = str(first(obj.pluralLabel));

        var fields = (obj.fields || []).map(function (f) {
            return {
                name: str(first(f.fullName)),
                label: str(first(f.label)),
                type: str(first(f.type)),
                ref: str(first(f.referenceTo)),
                formula: str(first(f.formula)) || null,
                summaryFormula: str(first(f.summaryFormula)) || null,
                returnType: str(first(f.formulaTreatBlanksAs)) || null,
            };
        }).filter(function (f) { return f.name; });

        var relationships = fields.filter(function (f) { return f.ref; }).map(function (f) {
            return { field: f.name, referenceTo: f.ref, type: f.type };
        });

        var formulaFields = parseFormulaFields(name, xml);
        var formulaEdges = buildFormulaEdges(name, formulaFields);

        return {
            name: name,
            label: label,
            plural: plural,
            type: isPlatformEvent ? 'PlatformEvent' : 'CustomObject',
            fields: fields,
            relationships: relationships,
            formulaFields: formulaFields,
            formulaEdges: formulaEdges,
        };
    }

    // ── flowFormula.js ──────────────────────────────────────────────────────
    var FLOW_REF_RE = /\{!([\w]+)\.([\w]+)\}/g;
    var FLOW_VAR_RE = /\{!([\w]+)\}/g;

    function parseFlowFormulas(xml) {
        var doc;
        try { doc = xmlParser.parse(xml); } catch (e) { return []; }
        if (!doc || !doc.Flow) return [];
        var flow = doc.Flow[0] || {};

        var formulas = (flow.formulas || []).map(function (f) {
            var name = str(first(f.name || f.n));
            var dataType = str(first(f.dataType));
            var expression = str(first(f.expression));
            if (!name || !expression) return null;

            var fieldRefs = [];
            FLOW_REF_RE.lastIndex = 0;
            var m;
            while ((m = FLOW_REF_RE.exec(expression)) !== null) {
                fieldRefs.push({ prefix: m[1], field: m[2] });
            }

            var varRefs = [];
            FLOW_VAR_RE.lastIndex = 0;
            while ((m = FLOW_VAR_RE.exec(expression)) !== null) {
                varRefs.push(m[1]);
            }

            return { name: name, dataType: dataType, expression: expression, fieldRefs: fieldRefs, varRefs: varRefs };
        }).filter(Boolean);

        var decisions = (flow.decisions || []).map(function (d) {
            var dName = str(first(d.name || d.n));
            var rules = (d.rules || []).map(function (r) {
                return (r.conditions || []).map(function (c) {
                    return str(first(c.leftValueReference));
                }).filter(Boolean);
            }).reduce(function (a, b) { return a.concat(b); }, []);
            return { decision: dName, usesFormulas: rules };
        });

        formulas.forEach(function (f) {
            f.usedInDecisions = decisions.filter(function (d) {
                return d.usesFormulas.some(function (ref) { return ref.includes(f.name); });
            }).map(function (d) { return d.decision; });
        });

        return formulas;
    }

    // ── flow.js ──────────────────────────────────────────────────────────────
    function parseFlow(name, xml) {
        var doc;
        try { doc = xmlParser.parse(xml); } catch (e) { return null; }
        if (!doc || !doc.Flow) return null;

        var flow = doc.Flow[0] || {};

        var processType = str(first(flow.processType));
        var label = str(first(flow.label)) || name;
        var status = str(first(flow.status));

        var start = first(flow.start);
        var object = str(start && start.object && start.object[0]) || str(first(flow.object));
        var triggerType = str(start && start.triggerType && start.triggerType[0]) || str(first(flow.triggerType));
        var recTrigType = str(start && start.recordTriggerType && start.recordTriggerType[0]);

        var entryFilters = ((start && start.filters) || []).map(function (f) {
            return {
                field: str(first(f.field)),
                operator: str(first(f.operator)),
                value: str(first(f.value && f.value[0] && f.value[0].stringValue)) || str(first(f.value && f.value[0] && f.value[0].numberValue)),
            };
        }).filter(function (f) { return f.field; });

        var subflows = (flow.subflows || []).map(function (s) { return str(first(s.flowName)); }).filter(Boolean);

        var actionCalls = (flow.actionCalls || []).map(function (a) {
            return { name: str(first(a.actionName)), type: str(first(a.actionType)), label: str(first(a.label)) };
        }).filter(function (a) { return a.name; });

        var dmlObjects = unique([].concat(
            (flow.recordUpdates || []).map(function (r) { return str(first(r.object)); }),
            (flow.recordCreates || []).map(function (r) { return str(first(r.object)); }),
            (flow.recordDeletes || []).map(function (r) { return str(first(r.object)); })
        ));
        var queryObjects = unique((flow.recordLookups || []).map(function (r) { return str(first(r.object)); }));

        var decisions = (flow.decisions || []).map(function (d) {
            return {
                name: str(first(d.name || d.n)),
                label: str(first(d.label)),
                rules: (d.rules || []).map(function (r) { return str(first(r.label)); }).filter(Boolean),
            };
        }).filter(function (d) { return d.name; });

        var variables = (flow.variables || []).map(function (v) {
            return {
                name: str(first(v.name || v.n)),
                dataType: str(first(v.dataType)),
                isInput: str(first(v.isInput)) === 'true',
                isOutput: str(first(v.isOutput)) === 'true',
                objectType: str(first(v.objectType)),
            };
        }).filter(function (v) { return v.name; });

        var formulas = parseFlowFormulas(xml);
        var formulaFieldRefs = unique(
            formulas.map(function (f) { return f.fieldRefs.map(function (r) { return r.field; }); })
                .reduce(function (a, b) { return a.concat(b); }, [])
                .filter(Boolean)
        );

        return {
            name: name, label: label, type: 'Flow', processType: processType, status: status,
            object: object || null, triggerType: triggerType || null, recTrigType: recTrigType || null,
            entryFilters: entryFilters, subflows: subflows, actionCalls: actionCalls,
            dmlObjects: dmlObjects, queryObjects: queryObjects, decisions: decisions,
            variables: variables, formulas: formulas, formulaFieldRefs: formulaFieldRefs,
        };
    }

    // ── trigger.js ───────────────────────────────────────────────────────────
    function parseTrigger(name, code) {
        var sig = code.match(/trigger\s+(\w+)\s+on\s+(\w+)\s*\(([^)]+)\)/i);
        var object = sig ? sig[2] : null;
        var events = sig ? sig[3].split(',').map(function (e) { return e.trim(); }) : [];

        var handlers = unique(Array.from(code.matchAll(/new\s+(\w+Handler)\s*\(\s*\)/g)).map(function (m) { return m[1]; }));

        var classCalls = unique(
            Array.from(code.matchAll(/\b([A-Z]\w+)\s*\.\s*\w+\s*\(/g))
                .map(function (m) { return m[1]; })
                .filter(function (c) { return !['System', 'Database', 'EventBus', 'Schema', 'Test'].includes(c); })
        );

        var flowInvoke = unique(Array.from(code.matchAll(/Flow\.Interview\.(\w+)/g)).map(function (m) { return m[1]; }));
        var batches = unique(Array.from(code.matchAll(/Database\.executeBatch\s*\(\s*new\s+(\w+)\s*\(/g)).map(function (m) { return m[1]; }));
        var publishes = unique(Array.from(code.matchAll(/EventBus\.publish\s*\([^)]*new\s+(\w+__e)/g)).map(function (m) { return m[1]; }));

        return {
            name: name, type: 'Trigger', object: object, events: events, handlers: handlers,
            classCalls: unique(handlers.concat(classCalls)), flowInvoke: flowInvoke, batches: batches, publishes: publishes,
        };
    }

    // ── varTypeMap.js ────────────────────────────────────────────────────────
    var SKIP_TYPES = new Set([
        'String', 'Integer', 'Decimal', 'Boolean', 'Date', 'DateTime', 'Id', 'Long', 'Double',
        'Blob', 'Object', 'SObject', 'void', 'null', 'true', 'false',
    ]);
    var STANDARD_OBJECTS = new Set([
        'Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Task', 'Event', 'User',
        'Product2', 'Pricebook2', 'PricebookEntry', 'Quote', 'QuoteLine', 'Contract',
        'Order', 'OrderItem', 'Campaign', 'CampaignMember', 'Asset', 'Entitlement',
        'ServiceContract', 'WorkOrder', 'WorkOrderLineItem', 'ReturnOrder',
        'ContentVersion', 'ContentDocument', 'Attachment', 'Note', 'FeedItem',
        'ApexClass', 'ApexTrigger', 'CustomObject',
    ]);

    function looksLikeSObjectType(s) {
        if (!s || SKIP_TYPES.has(s)) return false;
        if (/__[cCeEbBsStTmMdDlLhH]$/.test(s)) return true;
        return STANDARD_OBJECTS.has(s);
    }

    function buildVarTypeMap(code) {
        var map = {};
        var register = function (varName, typeName) {
            if (varName && typeName && looksLikeSObjectType(typeName) && !SKIP_TYPES.has(varName)) {
                map[varName] = typeName;
            }
        };

        Array.from(code.matchAll(/\bList\s*<\s*([\w]+)\s*>\s+([\w]+)/g)).forEach(function (m) { register(m[2], m[1]); });
        Array.from(code.matchAll(/\bSet\s*<\s*([\w]+)\s*>\s+([\w]+)/g)).forEach(function (m) { register(m[2], m[1]); });
        Array.from(code.matchAll(/\bMap\s*<\s*[\w]+\s*,\s*(?:List\s*<\s*)?([\w]+)\s*>?\s*>\s+([\w]+)/g)).forEach(function (m) { register(m[2], m[1]); });
        Array.from(code.matchAll(/\bMap\s*<[^>]*,\s*([\w]+__[ceC])\s*>\s+([\w]+)/g)).forEach(function (m) { register(m[2], m[1]); });
        Array.from(code.matchAll(/\b([\w]+)\s*\[\s*\]\s+([\w]+)/g)).forEach(function (m) { register(m[2], m[1]); });

        var stdPattern = Array.from(STANDARD_OBJECTS).join('|');
        var simpleRe = new RegExp('\\b(' + stdPattern + '|[\\w]+__[ceC])\\s+([\\w]+)\\s*[=;(,]', 'g');
        Array.from(code.matchAll(simpleRe)).forEach(function (m) { register(m[2], m[1]); });

        Array.from(code.matchAll(/for\s*\(\s*([\w]+)\s+([\w]+)\s*:/g)).forEach(function (m) { register(m[2], m[1]); });
        Array.from(code.matchAll(/\b([\w]+)\s+([\w]+)\s*=\s*new\s+\1\s*[({]/g)).forEach(function (m) { register(m[2], m[1]); });

        return map;
    }

    // ── apexClass.js ─────────────────────────────────────────────────────────
    var DML_VERBS = ['insert', 'update', 'upsert', 'delete', 'undelete'];
    var SKIP_CLASSES = new Set([
        'System', 'Database', 'EventBus', 'Schema', 'Test', 'Flow', 'Http', 'HttpRequest',
        'HttpResponse', 'JSON', 'String', 'List', 'Map', 'Set', 'Date', 'Math', 'Trigger',
        'Limits', 'UserInfo', 'ApexPages', 'PageReference', 'Type', 'Blob', 'EncodingUtil',
        'Integer', 'Decimal', 'Boolean', 'Long', 'Double', 'DateTime', 'ID',
    ]);

    function detectDmlInLoop(code) {
        var DML_PATTERN = /\b(insert|update|upsert|delete|undelete|Database\s*\.\s*(?:insert|update|upsert|delete))\s*[\w(]/i;
        var loopRe = /\b(for|while)\s*\([^)]*\)\s*\{/gi;
        var m;
        while ((m = loopRe.exec(code)) !== null) {
            var body = code.slice(m.index + m[0].length, m.index + m[0].length + 500);
            if (DML_PATTERN.test(body)) return true;
        }
        return false;
    }

    function parseApexClass(name, code) {
        var sig = code.match(
            /public\s+((?:virtual|abstract|with\s+sharing|without\s+sharing|inherited\s+sharing)\s+)*class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/i
        );
        var extendsClass = (sig && sig[3]) || null;
        var implementsList = (sig && sig[4] && sig[4].split(',').map(function (s) { return s.trim(); }).filter(Boolean)) || [];
        var isTriggerHandler = extendsClass === 'TriggerHandler';

        var overrides = unique(
            Array.from(code.matchAll(/public\s+override\s+void\s+(beforeInsert|beforeUpdate|beforeDelete|afterInsert|afterUpdate|afterDelete)\s*\(/g)).map(function (m) { return m[1]; })
        );

        var restResourceMatch = code.match(/@RestResource\s*\(\s*urlMapping\s*=\s*['"]([^'"]+)['"]\s*\)/i);
        var restResource = restResourceMatch ? restResourceMatch[1] : null;
        var restMethods = unique(Array.from(code.matchAll(/@Http(Get|Post|Put|Patch|Delete)/g)).map(function (m) { return m[1]; }));
        var isBatch = /implements\s+[\w,\s]*Database\.Batchable/i.test(code);
        var isQueueable = /implements\s+[\w,\s]*Queueable/i.test(code);
        var isSchedulable = /implements\s+[\w,\s]*Schedulable/i.test(code);
        var isFuture = /@future/i.test(code);
        var isInvocable = /@InvocableMethod/i.test(code);
        var withoutSharing = /without\s+sharing/i.test(code);
        var withSharing = /\bwith\s+sharing/i.test(code);
        var inheritedSharing = /inherited\s+sharing/i.test(code);

        var dmlInLoop = detectDmlInLoop(code);
        var soqlInLoop = /for\s*\([^)]*\)\s*\{[^}]*\[SELECT/i.test(code) || /while\s*\([^)]*\)\s*\{[^}]*\[SELECT/i.test(code);
        var hasTestVisible = /@TestVisible/i.test(code);
        var hasTestRunning = /Test\.isRunningTest\s*\(\s*\)/i.test(code);
        var silentDml = /Database\s*\.\s*(?:insert|update|upsert|delete)\s*\([^,)]+,\s*false\s*\)/i.test(code);
        var debugCount = (code.match(/System\s*\.\s*debug\s*\(/g) || []).length;

        var varTypeMap = buildVarTypeMap(code);

        var dmlRaw = new Set();
        var dmlVerbs = {};
        DML_VERBS.forEach(function (verb) {
            var re = new RegExp('\\b' + verb + '\\s+([\\w\\.\\[]+)', 'gi');
            var count = 0;
            Array.from(code.matchAll(re)).forEach(function (m) { dmlRaw.add(m[1].trim()); count++; });
            if (count) dmlVerbs[verb] = (dmlVerbs[verb] || 0) + count;
        });

        var dbRe = /Database\s*\.\s*(insert|update|upsert|delete|undelete|insertImmediate|updateImmediate)\s*\(\s*([\w\.]+)/gi;
        Array.from(code.matchAll(dbRe)).forEach(function (m) {
            var verb = m[1].replace(/Immediate$/i, '').toLowerCase();
            dmlRaw.add(m[2].trim());
            dmlVerbs[verb] = (dmlVerbs[verb] || 0) + 1;
        });

        var dmlObjects = unique(
            Array.from(dmlRaw).map(function (raw) {
                if (looksLikeSObjectType(raw)) return raw;
                return varTypeMap[raw.split('.')[0]] || null;
            }).filter(looksLikeSObjectType)
        );

        var publishes = unique([].concat(
            Array.from(code.matchAll(/EventBus\s*\.\s*publish\s*\(\s*new\s+([\w]+__e)/g)).map(function (m) { return m[1]; }),
            Array.from(code.matchAll(/EventBus\s*\.\s*publish\s*\(\s*([\w]+)/g)).map(function (m) { return varTypeMap[m[1]] || null; }),
            Array.from(code.matchAll(/new\s+([\w]+__e)\s*[({]/g)).map(function (m) { return m[1]; })
        ).filter(Boolean));

        var flowInvoke = unique(Array.from(code.matchAll(/Flow\s*\.\s*Interview\s*\.\s*(\w+)/g)).map(function (m) { return m[1]; }));
        var callouts = unique(Array.from(code.matchAll(/callout:([\w_]+)\//g)).map(function (m) { return m[1]; }));
        var batchCalls = unique(Array.from(code.matchAll(/Database\s*\.\s*executeBatch\s*\(\s*new\s+(\w+)\s*[,(]/g)).map(function (m) { return m[1]; }));
        var queueableCalls = unique(Array.from(code.matchAll(/System\s*\.\s*enqueueJob\s*\(\s*new\s+(\w+)\s*[,(]/g)).map(function (m) { return m[1]; }));

        var classCalls = unique(
            Array.from(code.matchAll(/\b([A-Z][A-Za-z0-9]+)\s*\.\s*\w+\s*\(/g))
                .map(function (m) { return m[1]; })
                .filter(function (c) { return !SKIP_CLASSES.has(c); })
        );

        return {
            name: name, type: 'ApexClass', extendsClass: extendsClass, implementsList: implementsList,
            isTriggerHandler: isTriggerHandler, overrides: overrides, restResource: restResource, restMethods: restMethods,
            isBatch: isBatch, isQueueable: isQueueable, isSchedulable: isSchedulable, isFuture: isFuture, isInvocable: isInvocable,
            withoutSharing: withoutSharing, withSharing: withSharing, inheritedSharing: inheritedSharing,
            dmlInLoop: dmlInLoop, soqlInLoop: soqlInLoop, hasTestVisible: hasTestVisible, hasTestRunning: hasTestRunning,
            silentDml: silentDml, debugCount: debugCount, dmlObjects: dmlObjects, dmlVerbs: dmlVerbs,
            publishes: publishes, flowInvoke: flowInvoke, callouts: callouts,
            batchCalls: batchCalls, queueableCalls: queueableCalls, classCalls: classCalls,
        };
    }

    // ── lwc.js ───────────────────────────────────────────────────────────────
    function uniqueByJson(arr) {
        var seen = new Set();
        return arr.filter(function (a) {
            var key = JSON.stringify(a);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function parseLwcJs(componentName, js) {
        var apexImports = uniqueByJson(
            Array.from(js.matchAll(/from\s+['"]@salesforce\/apex\/([\w.]+)['"]/g)).map(function (m) {
                var parts = m[1].split('.');
                return { class: parts[0], method: parts[1] || null };
            })
        );
        var usesNavigation = /NavigationMixin/i.test(js);
        var flowInvoke = unique(Array.from(js.matchAll(/Flow\.Interview\.(\w+)/g)).map(function (m) { return m[1]; }));
        return { apexImports: apexImports, usesNavigation: usesNavigation, flowInvoke: flowInvoke };
    }

    function parseLwcHtml(componentName, html) {
        var flowRefs = unique(Array.from(html.matchAll(/flow-api-name\s*=\s*["']([^"']+)["']/g)).map(function (m) { return m[1]; }));
        var childComponents = unique(
            Array.from(html.matchAll(/<c-([\w-]+)/g)).map(function (m) { return kebabToCamel(m[1]); })
        );
        return { flowRefs: flowRefs, childComponents: childComponents };
    }

    function kebabToCamel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

    // ── aura.js ──────────────────────────────────────────────────────────────
    function parseAuraCmp(componentName, cmp) {
        var flowRefs = unique([].concat(
            Array.from(cmp.matchAll(/flowApiName\s*=\s*["']([^"']+)["']/g)).map(function (m) { return m[1]; }),
            Array.from(cmp.matchAll(/lightning:flow[^>]+flowApiName\s*=\s*["']([^"']+)["']/g)).map(function (m) { return m[1]; })
        ));
        var controllerMatch = cmp.match(/controller\s*=\s*["']([^"']+)["']/i);
        var controller = controllerMatch ? controllerMatch[1] : null;
        var childComponents = unique(
            Array.from(cmp.matchAll(/<[a-z]+:([A-Za-z]\w+)/g)).map(function (m) { return m[1]; })
                .filter(function (c) { return !['component', 'attribute', 'if', 'iteration', 'handler', 'registerEvent', 'dependency'].includes(c); })
        );
        return { flowRefs: flowRefs, controller: controller, childComponents: childComponents };
    }

    function parseAuraController(componentName, js) {
        var apexCalls = unique(Array.from(js.matchAll(/["']c\.([\w]+)['"]/g)).map(function (m) { return m[1]; }));
        return { apexCalls: apexCalls };
    }

    // ── profile.js (new) ────────────────────────────────────────────────────
    function boolStr(v) { return str(v) === 'true'; }

    function parseProfile(name, xml) {
        var doc;
        try { doc = xmlParser.parse(xml); } catch (e) { return null; }
        if (!doc || !doc.Profile) return null;
        var profile = doc.Profile[0] || {};

        var objectPermissions = (profile.objectPermissions || []).map(function (p) {
            return {
                object: str(first(p.object)),
                read: boolStr(first(p.allowRead)),
                create: boolStr(first(p.allowCreate)),
                edit: boolStr(first(p.allowEdit)),
                deleteAccess: boolStr(first(p.allowDelete)),
                viewAll: boolStr(first(p.viewAllRecords)),
                modifyAll: boolStr(first(p.modifyAllRecords)),
            };
        }).filter(function (p) { return p.object; });

        var fieldPermissions = (profile.fieldPermissions || []).map(function (p) {
            return {
                field: str(first(p.field)),
                readable: boolStr(first(p.readable)),
                editable: boolStr(first(p.editable)),
            };
        }).filter(function (p) { return p.field; });

        var classAccesses = (profile.classAccesses || []).map(function (c) {
            return { apexClass: str(first(c.apexClass)), enabled: boolStr(first(c.enabled)) };
        }).filter(function (c) { return c.apexClass && c.enabled; });

        var pageAccesses = (profile.pageAccesses || []).map(function (p) {
            return { apexPage: str(first(p.apexPage)), enabled: boolStr(first(p.enabled)) };
        }).filter(function (p) { return p.apexPage && p.enabled; });

        var tabVisibilities = (profile.tabVisibilities || []).map(function (t) {
            return { tab: str(first(t.tab)), visibility: str(first(t.visibility)) };
        }).filter(function (t) { return t.tab; });

        var recordTypeVisibilities = (profile.recordTypeVisibilities || []).map(function (r) {
            return {
                recordType: str(first(r.recordType)),
                visible: boolStr(first(r.visible)),
                isDefault: boolStr(first(r.default)),
            };
        }).filter(function (r) { return r.recordType; });

        var systemPermissions = (profile.userPermissions || []).map(function (p) {
            return { name: str(first(p.name)), enabled: boolStr(first(p.enabled)) };
        }).filter(function (p) { return p.name && p.enabled; }).map(function (p) { return p.name; });

        var userLicense = str(first(profile.userLicense));
        var custom = boolStr(first(profile.custom));

        return {
            name: name,
            type: 'Profile',
            userLicense: userLicense,
            custom: custom,
            objectPermissions: objectPermissions,
            fieldPermissions: fieldPermissions,
            classAccesses: classAccesses,
            pageAccesses: pageAccesses,
            tabVisibilities: tabVisibilities,
            recordTypeVisibilities: recordTypeVisibilities,
            systemPermissions: systemPermissions,
        };
    }

    // ── Dependency graph (new) ──────────────────────────────────────────────
    // Resolves the relationships each parser already extracts (class calls,
    // trigger handlers, flow subflows/apex actions, formula cross-object
    // refs, LWC/Aura apex imports, profile class access, ...) into a single
    // validated edge list: an edge is only kept if its target name actually
    // matches a parsed entity, so this is a real dependency graph, not a
    // dump of every regex hit (which would be noisy — see caveats on
    // parseApexClass's classCalls).
    function buildDependencyEdges(allNodes) {
        var registry = {};
        function register(list, type) {
            (list || []).forEach(function (n) {
                if (n && n.name) registry[n.name.toLowerCase()] = { name: n.name, type: type };
            });
        }
        register(allNodes.objects, 'CustomObject');
        register(allNodes.flows, 'Flow');
        register(allNodes.triggers, 'Trigger');
        register(allNodes.classes, 'ApexClass');
        register(allNodes.lwc, 'LWC');
        register(allNodes.aura, 'Aura');

        var edges = [];
        function addEdge(fromName, fromType, toNameRaw, edgeType) {
            if (!toNameRaw) return;
            var toName = toNameRaw;
            var resolved = registry[toName.toLowerCase()];
            if (!resolved) {
                var base = toName.split('.')[0];
                var baseResolved = registry[base.toLowerCase()];
                if (baseResolved) { resolved = baseResolved; toName = base; }
            }
            if (!resolved) return; // drop unresolved/external refs — keeps this a real graph, not a call dump
            if (resolved.name === fromName && resolved.type === fromType) return; // no self-edges
            edges.push({ from: fromName, fromType: fromType, to: resolved.name, toType: resolved.type, type: edgeType });
        }

        (allNodes.triggers || []).forEach(function (t) {
            (t.handlers || []).forEach(function (h) { addEdge(t.name, 'Trigger', h, 'trigger-handler'); });
            (t.classCalls || []).forEach(function (c) { if ((t.handlers || []).indexOf(c) === -1) addEdge(t.name, 'Trigger', c, 'apex-call'); });
            (t.flowInvoke || []).forEach(function (f) { addEdge(t.name, 'Trigger', f, 'flow-invoke'); });
            (t.batches || []).forEach(function (b) { addEdge(t.name, 'Trigger', b, 'executes-batch'); });
            (t.publishes || []).forEach(function (p) { addEdge(t.name, 'Trigger', p, 'publishes-event'); });
        });

        (allNodes.classes || []).forEach(function (c) {
            if (c.extendsClass) addEdge(c.name, 'ApexClass', c.extendsClass, 'extends');
            (c.classCalls || []).forEach(function (cc) { addEdge(c.name, 'ApexClass', cc, 'apex-call'); });
            (c.batchCalls || []).forEach(function (b) { addEdge(c.name, 'ApexClass', b, 'executes-batch'); });
            (c.queueableCalls || []).forEach(function (q) { addEdge(c.name, 'ApexClass', q, 'enqueues-job'); });
            (c.flowInvoke || []).forEach(function (f) { addEdge(c.name, 'ApexClass', f, 'flow-invoke'); });
            (c.publishes || []).forEach(function (p) { addEdge(c.name, 'ApexClass', p, 'publishes-event'); });
            (c.dmlObjects || []).forEach(function (o) { addEdge(c.name, 'ApexClass', o, 'dml'); });
        });

        (allNodes.flows || []).forEach(function (f) {
            (f.subflows || []).forEach(function (s) { addEdge(f.name, 'Flow', s, 'subflow'); });
            (f.actionCalls || []).forEach(function (a) {
                if (a.type && a.type.toLowerCase() === 'apex' && a.name) addEdge(f.name, 'Flow', a.name, 'flow-apex');
            });
            (f.dmlObjects || []).forEach(function (o) { addEdge(f.name, 'Flow', o, 'dml'); });
            (f.queryObjects || []).forEach(function (o) { addEdge(f.name, 'Flow', o, 'query'); });
        });

        (allNodes.lwc || []).forEach(function (l) {
            (l.apexImports || []).forEach(function (a) { if (a.class) addEdge(l.name, 'LWC', a.class, 'apex-import'); });
            (l.flowInvoke || []).forEach(function (f) { addEdge(l.name, 'LWC', f, 'flow-invoke'); });
            (l.flowRefs || []).forEach(function (f) { addEdge(l.name, 'LWC', f, 'embeds-flow'); });
            (l.childComponents || []).forEach(function (c) { addEdge(l.name, 'LWC', c, 'child-component'); });
        });

        (allNodes.aura || []).forEach(function (a) {
            if (a.controller) addEdge(a.name, 'Aura', a.controller, 'apex-controller');
            (a.flowRefs || []).forEach(function (f) { addEdge(a.name, 'Aura', f, 'embeds-flow'); });
            (a.childComponents || []).forEach(function (c) { addEdge(a.name, 'Aura', c, 'child-component'); });
        });

        (allNodes.objects || []).forEach(function (o) {
            (o.formulaEdges || []).forEach(function (fe) { addEdge(o.name, 'CustomObject', fe.to, 'formula-ref'); });
        });

        (allNodes.profiles || []).forEach(function (p) {
            (p.classAccesses || []).forEach(function (ca) { addEdge(p.name, 'Profile', ca.apexClass, 'profile-access'); });
        });

        var seen = new Set();
        edges = edges.filter(function (e) {
            var key = e.from + '|' + e.to + '|' + e.type;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return edges;
    }

    self.SfdcParsers = {
        parseCustomObject: parseCustomObject,
        parseFormulaFields: parseFormulaFields,
        parseFlow: parseFlow,
        parseTrigger: parseTrigger,
        parseApexClass: parseApexClass,
        parseLwcJs: parseLwcJs,
        parseLwcHtml: parseLwcHtml,
        parseAuraCmp: parseAuraCmp,
        parseAuraController: parseAuraController,
        parseProfile: parseProfile,
        buildDependencyEdges: buildDependencyEdges,
    };
})();
