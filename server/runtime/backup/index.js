/**
 * ScadaCraft backup manager
 *
 * A backup is a folder <backupDir>/<YYYYMMDD-HHmmss>[-label]/ with:
 *   manifest.json            what is inside, version, date
 *   project.json             the project, same format as "Save Project As"
 *   appdata/*.db             project, users, alarms, api keys, recipes, scheduler (consistent SQLite copies)
 *   appdata/mysettings.json  server settings
 *   appdata/_upload_files/   uploaded images and resources
 *   db/*.db                  tag history (DAQ) and current values, when includeHistory is set
 *
 * SQLite files are copied with "VACUUM INTO", which gives a consistent snapshot while
 * ScadaCraft keeps running. A restore is applied at the next start of the server
 * (the databases are open while it runs): restore() writes a marker that
 * applyPendingRestore() executes during startup, before any database is opened.
 *
 * Configuration lives in <workDir>/backup.json:
 *   { enabled, time: "HH:MM", days: [0..6] (0 = Sunday, empty = every day), keep, dir, includeHistory }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const schedule = require('node-schedule');

const CONFIG_FILE = 'backup.json';
const RESTORE_MARKER = 'restore-pending.json';
const DEFAULTS = { enabled: false, time: '02:00', days: [], keep: 14, dir: '', includeHistory: true };

var settings;
var logger;
var runtime;
var job = null;
var running = false;

function init(_settings, _logger, _runtime) {
    settings = _settings;
    logger = _logger;
    runtime = _runtime;
    _reschedule();
}

function getConfig() {
    var config = { ...DEFAULTS };
    try {
        const file = path.join(settings.workDir, CONFIG_FILE);
        if (fs.existsSync(file)) {
            config = { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
        }
    } catch (err) {
        logger.error(`backup.config-read failed! ${err}`);
    }
    config.dir = config.dir || path.resolve(settings.workDir, '..', '_backups');
    return config;
}

function setConfig(changes) {
    const current = getConfig();
    const config = { ...current, ...changes };
    if (config.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time)) {
        throw new Error(`Invalid time "${config.time}", expected HH:MM`);
    }
    if (!Array.isArray(config.days) || config.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new Error('days must be an array of 0..6 (0 = Sunday)');
    }
    if (!Number.isInteger(config.keep) || config.keep < 1) {
        throw new Error('keep must be an integer >= 1');
    }
    fs.writeFileSync(path.join(settings.workDir, CONFIG_FILE), JSON.stringify(config, null, 4));
    _reschedule();
    return config;
}

function _reschedule() {
    if (job) {
        job.cancel();
        job = null;
    }
    const config = getConfig();
    if (!config.enabled) {
        return;
    }
    const [hour, minute] = config.time.split(':').map(Number);
    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;
    if (config.days && config.days.length) {
        rule.dayOfWeek = config.days;
    }
    job = schedule.scheduleJob(rule, () => {
        create({ label: 'auto', includeHistory: config.includeHistory }).then(result => {
            logger.info(`backup.auto created ${result.name}`);
            return prune(config.keep);
        }).catch(err => {
            logger.error(`backup.auto failed! ${err}`);
        });
    });
    logger.info(`backup.scheduled at ${config.time}${config.days.length ? ' on days ' + config.days.join(',') : ' every day'}, keep ${config.keep}`);
}

function nextRun() {
    return job ? job.nextInvocation()?.toISOString?.() || String(job.nextInvocation()) : null;
}

function _stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function _vacuumInto(source, target) {
    const sqlite3 = require('sqlite3');
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(source, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                return reject(err);
            }
            db.run('VACUUM INTO ?', [target], (err2) => {
                db.close();
                if (err2) {
                    reject(err2);
                } else {
                    resolve();
                }
            });
        });
    });
}

async function _copySqliteFiles(srcDir, dstDir, files) {
    const copied = [];
    fs.mkdirSync(dstDir, { recursive: true });
    for (const file of files) {
        const src = path.join(srcDir, file);
        const dst = path.join(dstDir, file);
        try {
            await _vacuumInto(src, dst);
        } catch (err) {
            // not an SQLite file or locked: plain copy
            fs.copyFileSync(src, dst);
        }
        copied.push({ file: path.relative(path.dirname(dstDir), dst), size: fs.statSync(dst).size });
    }
    return copied;
}

function _dirSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) {
        return 0;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        total += entry.isDirectory() ? _dirSize(p) : fs.statSync(p).size;
    }
    return total;
}

/**
 * Create a backup now.
 * @param {{label?: string, includeHistory?: boolean}} options
 */
async function create(options = {}) {
    if (running) {
        throw new Error('A backup is already running');
    }
    running = true;
    try {
        const config = getConfig();
        const label = (options.label || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
        const name = `${_stamp()}${label ? '-' + label : ''}`;
        const target = path.join(config.dir, name);
        fs.mkdirSync(target, { recursive: true });
        const includeHistory = options.includeHistory !== undefined ? !!options.includeHistory : config.includeHistory;
        const files = [];

        // project in portable format
        const project = await runtime.project.getProject(null, -1);   // admin view: complete project
        fs.writeFileSync(path.join(target, 'project.json'), JSON.stringify(project, null, 2));
        files.push({ file: 'project.json', size: fs.statSync(path.join(target, 'project.json')).size });

        // application databases and settings
        const appDbs = fs.readdirSync(settings.workDir).filter(f => f.endsWith('.db'));
        files.push(...await _copySqliteFiles(settings.workDir, path.join(target, 'appdata'), appDbs));
        for (const f of ['mysettings.json', CONFIG_FILE]) {
            const src = path.join(settings.workDir, f);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(target, 'appdata', f));
                files.push({ file: `appdata/${f}`, size: fs.statSync(src).size });
            }
        }
        if (settings.uploadFileDir && fs.existsSync(settings.uploadFileDir)) {
            const dst = path.join(target, 'appdata', path.basename(settings.uploadFileDir));
            fs.cpSync(settings.uploadFileDir, dst, { recursive: true });
            files.push({ file: `appdata/${path.basename(settings.uploadFileDir)}/`, size: _dirSize(dst) });
        }

        // tag history
        if (includeHistory && fs.existsSync(settings.dbDir)) {
            const dbs = fs.readdirSync(settings.dbDir).filter(f => f.endsWith('.db'));
            files.push(...await _copySqliteFiles(settings.dbDir, path.join(target, 'db'), dbs));
        }

        const manifest = {
            product: 'ScadaCraft',
            version: require('../../package.json').version,
            name,
            label: label || null,
            created: new Date().toISOString(),
            includesHistory: includeHistory,
            files,
            size: files.reduce((a, b) => a + (b.size || 0), 0),
        };
        fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
        logger.info(`backup.created ${name} (${files.length} items)`);
        return { ...manifest, path: target };
    } finally {
        running = false;
    }
}

function list() {
    const config = getConfig();
    if (!fs.existsSync(config.dir)) {
        return [];
    }
    return fs.readdirSync(config.dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && fs.existsSync(path.join(config.dir, e.name, 'manifest.json')))
        .map(e => {
            try {
                const m = JSON.parse(fs.readFileSync(path.join(config.dir, e.name, 'manifest.json'), 'utf8'));
                return { name: m.name, label: m.label, created: m.created, includesHistory: m.includesHistory, size: m.size, path: path.join(config.dir, e.name) };
            } catch (err) {
                return { name: e.name, error: 'invalid manifest' };
            }
        })
        .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function _resolve(name) {
    const config = getConfig();
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
        throw new Error('Invalid backup name');
    }
    const dir = path.join(config.dir, name);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
        throw new Error(`Backup "${name}" not found`);
    }
    return dir;
}

function remove(name) {
    fs.rmSync(_resolve(name), { recursive: true, force: true });
    logger.info(`backup.removed ${name}`);
}

/** Keep the newest `keep` automatic backups ("auto" label); manual backups are never pruned. */
function prune(keep) {
    const autos = list().filter(b => b.label === 'auto');
    const removed = [];
    for (const b of autos.slice(keep)) {
        remove(b.name);
        removed.push(b.name);
    }
    return removed;
}

/**
 * Schedule a restore for the next server start.
 * @param {string} name backup name
 * @param {{history?: boolean, settings?: boolean}} options
 */
function restore(name, options = {}) {
    const dir = _resolve(name);
    const marker = {
        backup: dir,
        history: options.history !== false,
        settings: options.settings !== false,
        requested: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(settings.workDir, RESTORE_MARKER), JSON.stringify(marker, null, 2));
    logger.warn(`backup.restore scheduled from ${name}: applied at next server start`);
    return marker;
}

function pendingRestore(workDir) {
    const file = path.join(workDir || settings.workDir, RESTORE_MARKER);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function cancelRestore() {
    const file = path.join(settings.workDir, RESTORE_MARKER);
    if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        return true;
    }
    return false;
}

/**
 * Apply a pending restore. Called by main.js at startup, before databases are opened.
 * The current files are moved to <workDir>/../_backups/pre-restore-<stamp>/ first.
 */
function applyPendingRestore(workDir, dbDir, uploadDirName, log) {
    const markerFile = path.join(workDir, RESTORE_MARKER);
    if (!fs.existsSync(markerFile)) {
        return null;
    }
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    const src = marker.backup;
    const safety = path.resolve(workDir, '..', '_backups', `pre-restore-${_stamp()}`);
    fs.mkdirSync(path.join(safety, 'appdata'), { recursive: true });
    const appSrc = path.join(src, 'appdata');
    for (const f of fs.readdirSync(appSrc)) {
        const from = path.join(appSrc, f);
        const to = path.join(workDir, f);
        if (!marker.settings && (f === 'mysettings.json' || f === CONFIG_FILE)) {
            continue;
        }
        if (fs.existsSync(to)) {
            fs.cpSync(to, path.join(safety, 'appdata', f), { recursive: true });
            fs.rmSync(to, { recursive: true, force: true });
        }
        fs.cpSync(from, to, { recursive: true });
    }
    if (marker.history && fs.existsSync(path.join(src, 'db'))) {
        fs.mkdirSync(path.join(safety, 'db'), { recursive: true });
        for (const f of fs.readdirSync(dbDir).filter(f => f.endsWith('.db'))) {
            fs.renameSync(path.join(dbDir, f), path.join(safety, 'db', f));
        }
        for (const f of fs.readdirSync(path.join(src, 'db'))) {
            fs.copyFileSync(path.join(src, 'db', f), path.join(dbDir, f));
        }
    }
    fs.unlinkSync(markerFile);
    if (log) {
        log(`backup.restore applied from ${src}; previous files saved in ${safety}`);
    }
    return { from: src, safety };
}

module.exports = {
    init,
    getConfig,
    setConfig,
    nextRun,
    create,
    list,
    remove,
    prune,
    restore,
    pendingRestore,
    cancelRestore,
    applyPendingRestore,
};
