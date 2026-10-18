'use strict';
// Tank station - Custom Widget page (AVEVA OMI and ScadaCraft). Values come only from the bound properties.
(function () {
  // ---- binding layer (same in every widget): state S from CW_PROPS, cwidget reads/writes ----
  var PROPS = window.CW_PROPS || [], S = {}, PD = {}, cw = null;
  PROPS.forEach(function (p) { PD[p.name] = p; S[p.name] = parse(p.type, p.value); });
  function toNum(v) { if (typeof v === 'boolean') return v ? 1 : 0; var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
  function parse(t, v) {
    if (t === 'Boolean') { var s = String(v).toLowerCase(); return v === true || v === 1 || s === 'true' || s === '1'; }
    if (t === 'String') return v == null ? '' : String(v);
    if (t === 'Integer') return Math.round(toNum(v));
    return toNum(v);
  }
  function bind() {
    if (typeof cwidget === 'undefined' || !cwidget) return false;
    cw = cwidget;
    PROPS.forEach(function (p) {
      try { cw.on(p.name, function () { S[p.name] = parse(p.type, cw[p.name]); render(); }); } catch (e) {}
      var v = cw[p.name];
      if (v !== undefined && v !== null && v !== '') S[p.name] = parse(p.type, v);
    });
    return true;
  }
  function put(name, v) { S[name] = v; if (cw) { try { cw[name] = v; } catch (e) {} } render(); }
  function pulse(name) { put(name, true); setTimeout(function () { put(name, false); }, 1500); }

  // ---- page ----
  var $ = function (id) { return document.getElementById(id); };
  function f(v, d) { return Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function render() {
    var max = S.level_max > 0 ? S.level_max : 1, pct = Math.max(0, Math.min(100, S.level / max * 100));
    $('title').textContent = S.title;
    $('link').textContent = cw ? (S.pump_fault ? 'Pump fault' : 'Online') : 'Not connected';
    $('link').className = 'tag' + (cw && S.pump_fault ? ' alm' : '');
    $('level').textContent = cw ? f(S.level, 2) : '--';
    $('fill').style.height = (cw ? pct : 0) + '%';
    $('spmark').style.bottom = Math.max(0, Math.min(100, S.sp_level / max * 100)) + '%';
    $('spv').textContent = f(S.sp_level, 2);
    $('pct').textContent = cw ? f(pct, 0) + ' %' : '--';
    $('flow').textContent = cw ? f(S.flow_raw * S.k_flow, 1) : '--';
    var ps = $('pstate');
    ps.textContent = !cw ? '--' : S.pump_fault ? 'FAULT' : S.pump_run ? 'RUNNING' : 'STOPPED';
    ps.className = 'state' + (S.pump_fault ? ' fault' : '');
  }
  var pending = null;
  function ask(text, fn) { $('dlgt').textContent = text; pending = fn; $('dlg').hidden = false; $('ok').focus(); }
  $('no').onclick = function () { $('dlg').hidden = true; pending = null; };
  $('ok').onclick = function () { $('dlg').hidden = true; if (pending) pending(); pending = null; };
  document.querySelectorAll('[data-cmd]').forEach(function (b) {
    b.onclick = function () { var c = b.dataset.cmd; ask((c === 'cmd_start' ? 'Start' : 'Stop') + ' the pump?', function () { pulse(c); }); };
  });
  $('spset').onclick = function () {
    var t = $('spin').value.trim(); if (!t) return;
    var v = toNum(t); if (!(v >= 0 && v <= S.level_max)) { $('spin').focus(); return; }
    ask('Set the level setpoint from ' + f(S.sp_level, 2) + ' to ' + f(v, 2) + ' m?', function () { put('sp_level', v); $('spin').value = ''; });
  };
  // the host may create cwidget after the page scripts: wait up to 5 s
  (function wait(n) { if (bind() || n > 25) return render(); setTimeout(function () { wait(n + 1); }, 200); })(0);
  render();
})();
