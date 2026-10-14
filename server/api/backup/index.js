/**
 * 'api/backup': ScadaCraft backups (admin only)
 *
 *   GET    /api/backup                 -> { config, nextRun, pendingRestore, backups: [...] }
 *   POST   /api/backup                 -> create now   { label?, includeHistory? }
 *   POST   /api/backup/config          -> set schedule { enabled, time "HH:MM", days [0..6], keep, dir, includeHistory }
 *   POST   /api/backup/restore         -> schedule a restore at next start { name, history?, settings? }
 *   DELETE /api/backup/restore         -> cancel a scheduled restore
 *   DELETE /api/backup?name=<name>     -> delete a backup
 *   POST   /api/backup/restart         -> exit the process so a supervisor (Docker, systemd, pm2) restarts it
 */

var express = require('express');
const authJwt = require('../jwt-helper');
var runtime;
var secureFnc;
var checkGroupsFnc;

function guard(req, res) {
    const permission = checkGroupsFnc(req);
    if (res.statusCode === 403) {
        return false;
    }
    if (!authJwt.haveAdminPermission(permission)) {
        res.status(401).json({ error: 'unauthorized_error', message: 'Unauthorized!' });
        return false;
    }
    return true;
}

function fail(res, err, where) {
    const message = err && err.message ? err.message : String(err);
    runtime.logger.error(`api ${where}: ${message}`);
    res.status(400).json({ error: 'backup_error', message });
}

module.exports = {
    init: function (_runtime, _secureFnc, _checkGroupsFnc) {
        runtime = _runtime;
        secureFnc = _secureFnc;
        checkGroupsFnc = _checkGroupsFnc;
    },
    app: function () {
        var backupApp = express();
        backupApp.use(function (req, res, next) {
            if (!runtime.backup) {
                res.status(404).end();
            } else {
                next();
            }
        });

        backupApp.get('/api/backup', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            try {
                res.json({
                    config: runtime.backup.getConfig(),
                    nextRun: runtime.backup.nextRun(),
                    pendingRestore: runtime.backup.pendingRestore(),
                    backups: runtime.backup.list(),
                });
            } catch (err) {
                fail(res, err, 'get backup');
            }
        });

        backupApp.post('/api/backup', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            runtime.backup.create(req.body || {}).then(result => res.json(result)).catch(err => fail(res, err, 'post backup'));
        });

        backupApp.post('/api/backup/config', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            try {
                const config = runtime.backup.setConfig(req.body || {});
                res.json({ config, nextRun: runtime.backup.nextRun() });
            } catch (err) {
                fail(res, err, 'post backup/config');
            }
        });

        backupApp.post('/api/backup/restore', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            try {
                res.json(runtime.backup.restore(req.body.name, req.body));
            } catch (err) {
                fail(res, err, 'post backup/restore');
            }
        });

        backupApp.delete('/api/backup/restore', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            res.json({ cancelled: runtime.backup.cancelRestore() });
        });

        backupApp.delete('/api/backup', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            try {
                runtime.backup.remove(req.query.name);
                res.end();
            } catch (err) {
                fail(res, err, 'delete backup');
            }
        });

        backupApp.post('/api/backup/restart', secureFnc, function (req, res) {
            if (!guard(req, res)) return;
            runtime.logger.warn('api backup/restart: exiting so the service supervisor restarts ScadaCraft');
            res.json({ restarting: true });
            setTimeout(() => process.exit(0), 500);
        });

        return backupApp;
    }
};
