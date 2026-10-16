/**
 * AVEVA Custom Widget packages (.cwp) as ScadaCraft widgets.
 *
 * A .cwp is a zip with one folder <name>/ holding index.html, <name>.wjson (the widget properties:
 * type, name, default value, description) and the widget scripts. In AVEVA the page talks to the
 * host through the global "cwidget" created by ../resources/apis/proxy.js: cwidget.<prop> reads,
 * cwidget.<prop> = v writes, cwidget.on('<prop>', fn) is called on changes.
 *
 * The import keeps the package as it is under _widgets/<group>/_cwp/<name>/, puts a compatible
 * proxy.js in _cwp/resources/apis/, and writes a normal ScadaCraft SVG widget _widgets/<group>/<name>.svg
 * that hosts the page in an iframe and exposes every AVEVA property as a widget variable
 * (_pb_ boolean, _pn_ number, _ps_ text). The variables are bound to tags in the editor property
 * panel like any widget; values go to the page through cwidget, writes come back as tag writes.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ENTRIES = 2000;
const MAX_TOTAL = 200 * 1024 * 1024;

/** Minimal zip reader (stored and deflated entries), enough for .cwp packages. */
function unzip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file (.cwp packages are zip archives).');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    if (count > MAX_ENTRIES) throw new Error(`Too many files in the package (${count}).`);
    const entries = [];
    let total = 0;
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip: bad central directory.');
        const method = buf.readUInt16LE(p + 10);
        const csize = buf.readUInt32LE(p + 20);
        const usize = buf.readUInt32LE(p + 24);
        const nlen = buf.readUInt16LE(p + 28);
        const xlen = buf.readUInt16LE(p + 30);
        const clen = buf.readUInt16LE(p + 32);
        const local = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nlen).replace(/\\/g, '/');
        p += 46 + nlen + xlen + clen;
        if (name.endsWith('/')) continue;
        total += usize;
        if (total > MAX_TOTAL) throw new Error('Package too large.');
        if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt zip: bad entry ${name}.`);
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
        const raw = buf.subarray(start, start + csize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = zlib.inflateRawSync(raw);
        else throw new Error(`Unsupported compression in ${name} (method ${method}).`);
        entries.push({ name, data });
    }
    return entries;
}

function safeRel(name) {
    const norm = path.posix.normalize(name).replace(/^\/+/, '');
    if (!norm || norm.startsWith('..') || path.posix.isAbsolute(norm) || norm.includes('\0')) return null;
    return norm;
}

const NUMBER_TYPES = /^(integer|int\d*|long|short|double|float|real|number|decimal|single|byte|uint\d*)$/i;

function varPrefix(type) {
    if (/^bool(ean)?$/i.test(type)) return '_pb_';
    if (NUMBER_TYPES.test(type)) return '_pn_';
    return '_ps_';
}

function defaultLiteral(prefix, value) {
    if (prefix === '_pb_') return String(value).toLowerCase() === 'true' || value === 1 || value === '1' ? 'true' : 'false';
    if (prefix === '_pn_') { const n = Number(value); return Number.isFinite(n) ? String(n) : '0'; }
    // text: backticks like the editor writes; no ";" (the export section is parsed per statement)
    return '`' + String(value ?? '').replace(/[`\\$;]/g, '') + '`';
}

function descText(desc) {
    if (!desc) return '';
    if (typeof desc === 'string') return desc;
    return desc['1033'] || desc[Object.keys(desc)[0]] || '';
}

/** Optional direction per property: window.CW_PROPS = [{name, dir: in|out|inout}] in a bundled props.js. */
function directionsFrom(entries) {
    const out = {};
    for (const e of entries) {
        if (!/props\.js$/i.test(e.name)) continue;
        const m = e.data.toString('utf8').match(/CW_PROPS\s*=\s*(\[[\s\S]*\])\s*;?/);
        if (!m) continue;
        try {
            for (const p of JSON.parse(m[1])) {
                if (p && p.name) out[p.name] = p.dir === 'in' ? 'read' : p.dir === 'out' ? 'write' : 'rw';
            }
        } catch (err) { /* not JSON: ignore */ }
    }
    return out;
}

function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** cwidget for a page hosted by ScadaCraft (replaces AVEVA's proxy.js). */
const PROXY_JS = `// ScadaCraft host for AVEVA Custom Widgets: same "cwidget" API as AVEVA's proxy.js.
(function () {
    'use strict';
    var values = {}, listeners = {};
    function fire(name) {
        (listeners[name] || []).slice().forEach(function (fn) {
            try { fn(values[name]); } catch (e) { console.error('cwidget.on(' + name + ')', e); }
        });
    }
    var api = {
        on: function (name, fn) { if (typeof fn === 'function') (listeners[name] = listeners[name] || []).push(fn); },
        off: function (name, fn) { listeners[name] = (listeners[name] || []).filter(function (f) { return fn && f !== fn; }); },
        triggerEvent: function () {}, raiseEvent: function () {}
    };
    window.cwidget = new Proxy(api, {
        get: function (t, k) { return Object.prototype.hasOwnProperty.call(t, k) ? t[k] : values[k]; },
        set: function (t, k, v) {
            values[k] = v;
            var host = window.__scadacraftHost;
            if (host && typeof host.write === 'function') host.write(String(k), v);
            return true;
        },
        has: function (t, k) { return k in t || k in values; }
    });
    // called by the ScadaCraft widget with the tag values
    window.__scadacraftPut = function (name, v) { values[name] = v; fire(name); };
})();
`;
const HELPER_JS = '// ScadaCraft: AVEVA MASvrHelper is not needed outside AVEVA.\n';

function buildWrapperSvg(opts) {
    const { widget, title, width, height, src, props } = opts;
    const meta = { widget: title, source: 'aveva-cwp', package: widget, properties: {} };
    const decl = [];
    const names = {};
    for (const p of props) {
        meta.properties[p.varName] = { label: p.name, description: p.description, dir: p.dir };
        decl.push(`let ${p.varName} = ${p.defaultLiteral};`);
        names[p.varName] = p.name;
    }
    const valuesInit = props.map((p) => `    ${JSON.stringify(p.name)}: ${p.varName}`).join(',\n');
    const script = `
//!export-start
${decl.join('\n')}
//!export-end
var _cwp_names = ${JSON.stringify(names)};
var _cwp_vars = ${JSON.stringify(Object.fromEntries(props.map((p) => [p.name, p.varName])))};
var _cwp_values = {
${valuesInit}
};
var _cwp_win = null;
function postValue(id, value) {
    // replaced by ScadaCraft at runtime: writes the bound tag
}
function putValue(id, value) {
    var name = _cwp_names[id];
    if (!name) return;
    _cwp_values[name] = value;
    if (_cwp_win && _cwp_win.__scadacraftPut) _cwp_win.__scadacraftPut(name, value);
}
function _cwp_write(name, value) {
    var id = _cwp_vars[name];
    if (id) postValue(id, value);
}
function _cwp_loaded(ev) {
    var w = ev.target.contentWindow;
    if (!w) return;
    _cwp_win = w;
    w.__scadacraftHost = { write: _cwp_write };
    if (w.__scadacraftPut) {
        Object.keys(_cwp_values).forEach((k) => { w.__scadacraftPut(k, _cwp_values[k]); });
    }
}
function _cwp_attach() {
    var f = document.getElementById('cwpframe');
    if (!f) return;
    // in the editor the page must not take the mouse (selection, drag, resize)
    f.style.pointerEvents = document.getElementById('svgcanvas') ? 'none' : 'auto';
    f.addEventListener('load', _cwp_loaded);
    if (f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentWindow && f.contentWindow.__scadacraftPut) {
        _cwp_loaded({ target: f });
    }
}
setTimeout(_cwp_attach, 0);
`;
    return `<svg id="cwp_root" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<metadata data-scadacraft="widget-properties">${xmlEscape(JSON.stringify(meta))}</metadata>
<rect id="cwp_bg" x="0" y="0" width="${width}" height="${height}" fill="transparent"/>
<foreignObject id="cwp_fo" x="0" y="0" width="100%" height="100%">
<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden">
<iframe id="cwpframe" src="${xmlEscape(src)}" style="width:100%;height:100%;border:0;display:block;pointer-events:none" title="${xmlEscape(title)}"></iframe>
</div>
</foreignObject>
<script><![CDATA[${script}]]></script>
</svg>
`;
}

/**
 * Import a .cwp into the widget library.
 * @param {Buffer} buf  package content
 * @param {{ widgetsDir: string, group: string, name?: string, overwrite?: boolean }} opts
 */
function importCwp(buf, opts) {
    const group = String(opts.group || '').trim();
    if (!/^[\w .-]+$/.test(group) || group.startsWith('.')) throw new Error('Group name may contain letters, digits, space, "-", "_" and "." only.');
    const entries = unzip(buf).map((e) => ({ ...e, name: safeRel(e.name) })).filter((e) => e.name);
    const wjsonEntry = entries.find((e) => /\.wjson$/i.test(e.name));
    if (!wjsonEntry) throw new Error('No .wjson in the package: not an AVEVA Custom Widget.');
    const root = wjsonEntry.name.includes('/') ? wjsonEntry.name.split('/')[0] : '';
    const pkgName = root || path.posix.basename(wjsonEntry.name, path.extname(wjsonEntry.name));
    const name = String(opts.name || pkgName).trim();
    if (!/^[\w.-]+$/.test(name)) throw new Error(`Invalid widget name "${name}" (letters, digits, "-", "_", ".").`);
    const strip = (n) => (root && n.startsWith(root + '/') ? n.slice(root.length + 1) : n);
    const files = entries.filter((e) => !root || e.name.startsWith(root + '/')).map((e) => ({ name: strip(e.name), data: e.data }));
    if (!files.some((f) => f.name.toLowerCase() === 'index.html')) throw new Error('No index.html in the package.');

    let wjson;
    try {
        wjson = JSON.parse(wjsonEntry.data.toString('utf8').replace(/^﻿/, ''));
    } catch (err) {
        throw new Error(`${wjsonEntry.name}: invalid JSON (${err.message}).`);
    }
    const dirs = directionsFrom(entries);
    const used = new Set();
    const props = Object.values(wjson.properties || {}).filter((p) => p && p.name).map((p) => {
        const prefix = varPrefix(p.type || 'String');
        let varName = prefix + String(p.name).replace(/\W/g, '_');
        while (used.has(varName)) varName += '_';
        used.add(varName);
        return {
            name: String(p.name), type: p.type || 'String', varName, defaultLiteral: defaultLiteral(prefix, p.value),
            description: descText(p.desc), dir: dirs[p.name] || 'rw',
        };
    });
    if (!props.length) throw new Error('The .wjson declares no properties: nothing to bind.');
    const width = Math.max(50, Math.round(Number(wjson.width) || 800));
    const height = Math.max(50, Math.round(Number(wjson.height) || 450));

    const groupDir = path.join(opts.widgetsDir, group);
    const svgFile = path.join(groupDir, `${name}.svg`);
    const pkgDir = path.join(groupDir, '_cwp', name);
    if ((fs.existsSync(svgFile) || fs.existsSync(pkgDir)) && !opts.overwrite) {
        const e = new Error(`"${group}/${name}" already exists (overwrite replaces it).`);
        e.code = 'exists';
        throw e;
    }
    fs.rmSync(pkgDir, { recursive: true, force: true });
    for (const f of files) {
        const target = path.join(pkgDir, f.name);
        if (!target.startsWith(pkgDir + path.sep)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.data);
    }
    const apis = path.join(groupDir, '_cwp', 'resources', 'apis');
    fs.mkdirSync(apis, { recursive: true });
    fs.writeFileSync(path.join(apis, 'proxy.js'), PROXY_JS);
    fs.writeFileSync(path.join(apis, 'MASvrHelper.js'), HELPER_JS);

    const htmlTitle = (files.find((f) => f.name.toLowerCase() === 'index.html').data.toString('utf8').match(/<title>([^<]*)<\/title>/i) || [])[1];
    const title = (htmlTitle || name).trim();
    // relative to the app base (<base href>): works under a base path too
    const src = ['_widgets', group, '_cwp', name, 'index.html'].map(encodeURIComponent).join('/');
    fs.writeFileSync(svgFile, buildWrapperSvg({ widget: name, title, width, height, src, props }));
    return {
        path: `_widgets/${group}/${name}.svg`, name, title, size: { width, height },
        properties: props.map((p) => ({ name: p.varName, aveva: p.name, type: p.type, dir: p.dir, description: p.description })),
    };
}

/** When a library widget is removed, remove its AVEVA package too. */
function removeCwpFor(svgFullPath) {
    const dir = path.join(path.dirname(svgFullPath), '_cwp', path.basename(svgFullPath, '.svg'));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { importCwp, removeCwpFor, unzip, PROXY_JS };
