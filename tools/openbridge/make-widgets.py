#!/usr/bin/env python3
"""Generate the ScadaCraft editor widget library from OpenBridge web components.

The library is split like the OpenBridge design system, one editor group per category:

    openbridge/              Automation (P&ID): equipment and pipes on the 24 px grid
    openbridge-instruments/  Instruments: gauges, instrument field, trend, progress
    openbridge-charts/       Charts: line, area, pie, donut, radial bar
    openbridge-controls/     Controls: buttons, switches, slider, number input, mode selector
    openbridge-alerts/       Alerts and status: alert icon/button/frame, status, badge, tag, clock

Placement
- P&ID widgets (layout "anchor") follow the OpenBridge "P&ID anchor point model" (docs/openbridge.md):
  the element is placed at its anchor point; box and anchor are multiples of 24 px, so a widget
  snapped to the grid has its anchor on a grid node.
- every other widget fills its box (layout "fill") or is centred in it ("center"/"start");
  its anchor is the top-left corner. Resizing the widget in the editor resizes the element.

Each widget is a FUXA-compatible SVG widget:
- an xhtml <foreignObject> hosting the OpenBridge element (id "ob_el")
- a script whose //!export-start ... //!export-end section declares bindable properties
  (_pb_ boolean, _pn_ number, _ps_ string) shown in the property panel
- putValue(id, value) receives tag values; postValue(id, value) writes to the bound tag.
  Commands either write a dedicated variable (P&ID equipment: _pb_command) or, for controls,
  the same variable they display (read/write: bind the setpoint/state tag once).

Output: server/_widgets/<group>/*.svg + group.json (library title, order, labels),
server/_widgets/openbridge/widgets.json (catalog for docs and the MCP server) and
docs/openbridge-widgets.md (reference).
"""
import base64
import json
import os
from xml.sax.saxutils import escape

HERE = os.path.dirname(__file__)
WIDGETS_DIR = os.path.join(HERE, '..', '..', 'server', '_widgets')
PREVIEWS = os.path.join(HERE, 'previews')
DOC = os.path.join(HERE, '..', '..', 'docs', 'openbridge-widgets.md')
GRID = 24
OB_VERSION = '1.0.0'

# key, folder, library title, description
CATEGORIES = [
    ('automation', 'openbridge', 'OpenBridge · Automation (P&ID)',
     'Process equipment and pipes, placed on the 24 px P&ID grid by their anchor point.'),
    ('instruments', 'openbridge-instruments', 'OpenBridge · Instruments',
     'Gauges, instrument fields and trends showing a process value.'),
    ('charts', 'openbridge-charts', 'OpenBridge · Charts',
     'Live charts: rolling line/area trends of a tag, pie/donut/radial bars of several tags.'),
    ('controls', 'openbridge-controls', 'OpenBridge · Controls',
     'Operator commands: buttons, start/stop and toggle switches, slider, number input, mode selector.'),
    ('alerts', 'openbridge-alerts', 'OpenBridge · Alerts and status',
     'Alert icon, alert button, alert frame, status indicator, badge, tag label and clock.'),
]
CAT = {c[0]: c for c in CATEGORIES}


def p(name, default, prop, kind, desc, dir='read'):
    """Bindable property: widget variable, default (JS), element property, kind, description, direction.

    dir: read (tag -> widget), write (widget -> tag only), rw (both: displayed and written by the operator).
    """
    return (name, default, prop, kind, desc, dir)


# ======================================================================================
# Automation (P&ID)
# ======================================================================================

def device_common(tag_example):
    return [
        p('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation (pipe runs top-bottom)'),
        p('_ps_labelDirection', "'down'", 'labelDirection', 'str', 'Readout side: up | down | left | right'),
        p('_pb_alarm', 'false', 'alert', 'bool', 'Alarm active (alert frame)'),
        p('_pb_auto', 'false', 'badgeAuto', 'bool', 'Badge: automatic mode'),
        p('_pb_locked', 'false', 'badgeCommandLocked', 'bool', 'Badge: command locked'),
        p('_pb_duty', 'false', 'badgeDuty', 'bool', 'Badge: duty unit'),
        p('_pb_alarmOff', 'false', 'badgeAlertOff', 'bool', 'Badge: alarms suppressed'),
        p('_ps_tag', "''", 'tag', 'str', f'Numeric equipment ID shown as #NNNN, e.g. {tag_example} (empty = hidden)'),
    ]


def squared_common(tag_example):
    return [
        p('_ps_readout', "'bottom'", 'readoutPosition', 'str', 'Readout side: top | bottom | left | right'),
        p('_pb_alarm', 'false', 'alert', 'bool', 'Alarm active (alert frame)'),
        p('_pb_auto', 'false', 'badgeAuto', 'bool', 'Badge: automatic mode'),
        p('_pb_locked', 'false', 'badgeCommandLocked', 'bool', 'Badge: command locked'),
        p('_pb_duty', 'false', 'badgeDuty', 'bool', 'Badge: duty unit'),
        p('_pb_alarmOff', 'false', 'badgeAlertOff', 'bool', 'Badge: alarms suppressed'),
        p('_ps_tag', "''", 'tag', 'str', f'Numeric equipment ID shown as #NNNN, e.g. {tag_example} (empty = hidden)'),
    ]


MEDIUM = p('_ps_medium', "'normal'", 'medium', 'str', 'Pipe content: normal | water | air | empty')
LINETYPE = p('_ps_lineType', "'fluid'", 'lineType', 'str', 'Line type: fluid | electric | air | connector')
FLUIDS = 'fresh-water | sea-water | waste | masses | fuel | oil | steam | hot | cold | air-ventilation | acid-alkalis | fire-fighting | flammable-gas | non-flammable-gas'
FLUID_PIPE = p('_ps_fluid', "''", None, 'str', 'Fluid colour for water/air pipes (OpenBridge palette): ' + FLUIDS + ' (empty = default)')
RUNNING = p('_pb_running', 'false', 'on', 'bool', 'Running feedback')
SPEED = p('_pn_speed', '0', 'speedInPercent', 'num', 'Speed % (readout)')
DEVICE_BOX = dict(size=(120, 120), anchor=(48, 48))
START_STOP = 'Start/stop command, written on click as !running (1/0)'


def squared(file, el, title, tag_example, on_desc, command=None):
    w = dict(file=file, el=el, title=title, cat='automation', group='device', **DEVICE_BOX,
             props=[p('_pb_on', 'false', 'on', 'bool', on_desc)] + squared_common(tag_example),
             preview=[['_pb_on', 1]])
    if command:
        w['command'] = ('_pb_command', '_pb_on', command)
    return w


AUTOMATION = [
    # ---- equipment ------------------------------------------------------------------
    dict(file='ob-pump.svg', el='obc-pump', title='Pump', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('101'),
         command=('_pb_command', '_pb_running', START_STOP), preview=[['_pb_running', 1]]),
    dict(file='ob-motor.svg', el='obc-motor', title='Motor', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('201'),
         command=('_pb_command', '_pb_running', START_STOP), preview=[['_pb_running', 1]]),
    dict(file='ob-fan.svg', el='obc-fan', title='Fan', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('301'),
         command=('_pb_command', '_pb_running', START_STOP), preview=[['_pb_running', 1]]),
    dict(file='ob-valve-digital.svg', el='obc-digital-valve', title='On/off valve', group='device', **DEVICE_BOX,
         props=[p('_pb_open', 'false', 'open', 'bool', 'Open feedback')] + device_common('401'),
         command=('_pb_command', '_pb_open', 'Open/close command, written on click as !open (1/0)'),
         preview=[['_pb_open', 1]]),
    dict(file='ob-valve-analog.svg', el='obc-analog-valve', title='Control valve', group='device', **DEVICE_BOX,
         props=[p('_pn_position', '0', 'value', 'num', 'Valve position 0-100 %'),
                p('_pb_open', 'false', 'open', 'bool', 'Open feedback')] + device_common('501'),
         preview=[['_pn_position', 60], ['_pb_open', 1]]),
    squared('ob-damper.svg', 'obc-damper', 'Damper', '601', 'Open feedback',
            'Open/close command, written on click as !open (1/0)'),
    squared('ob-filter.svg', 'obc-filter', 'Filter', '701', 'In service'),
    squared('ob-converter.svg', 'obc-converter', 'Converter / drive', '801', 'Running feedback', START_STOP.replace('running', 'on')),
    squared('ob-transformer.svg', 'obc-transformer', 'Transformer', '901', 'Energised'),
    squared('ob-breaker.svg', 'obc-switch', 'Breaker / switch', '1001', 'Closed feedback',
            'Close/open command, written on click as !closed (1/0)'),
    squared('ob-source.svg', 'obc-source', 'Power source', '1101', 'Available'),
    squared('ob-ground.svg', 'obc-ground', 'Ground / earth', '1201', 'Connected'),
    dict(file='ob-tank.svg', el='obc-automation-tank', title='Tank', group='device', size=(192, 216), anchor=(96, 24),
         props=[p('_pn_level', '50', 'value', 'num', 'Level (same unit as max)'),
                p('_pn_max', '100', 'max', 'num', 'Maximum level / capacity'),
                p('_ps_trend', "'stable'", 'trend', 'str', 'fast-rising | rising | stable | falling | fast-falling'),
                p('_ps_fluid', "'fresh-water'", None, 'str', 'Content colour (OpenBridge palette): ' + FLUIDS),
                p('_ps_tag', "'T-101'", 'tag', 'str', 'Tank label (free text)')],
         apply_extra=["    el.style.setProperty('--automation-medium-fuel', 'var(--automation-medium-' + String(_ps_fluid) + ')');"],
         preview=[['_pn_level', 60]]),
    dict(file='ob-readout.svg', el='obc-automation-readout', title='Readout', group='device', size=(192, 120), anchor=(96, 48),
         props=[p('_pn_value', '0', 'value', 'num', 'Process value'),
                p('_ps_unit', "'m3/h'", 'unit', 'str', 'Engineering unit'),
                p('_pn_digits', '3', 'numberOfDigits', 'num', 'Integer digits shown'),
                p('_ps_position', "'top'", 'position', 'str', 'Where the readout sits relative to its anchor (tick end): top | bottom | left | right')],
         preview=[['_pn_value', 123]]),
    # ---- pipes ---------------------------------------------------------------------
    dict(file='ob-line-horizontal.svg', el='obc-horizontal-line', title='Pipe horizontal', group='pipe',
         size=(96, 48), anchor=(0, 24), stretch='x', props=[MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-vertical.svg', el='obc-vertical-line', title='Pipe vertical', group='pipe',
         size=(48, 96), anchor=(24, 0), stretch='y', props=[MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-elbow.svg', el='obc-corner-line', title='Pipe elbow', group='pipe', size=(48, 48), anchor=(24, 24),
         props=[p('_ps_direction', "'bottom-right'", 'direction', 'str', 'Arms: top-right | top-left | bottom-right | bottom-left'),
                MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-tee.svg', el='obc-three-way-line', title='Pipe tee', group='pipe', size=(48, 48), anchor=(24, 24),
         props=[p('_ps_direction', "'bottom'", 'direction', 'str', 'Branch side: top | right | bottom | left'),
                MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-cross.svg', el='obc-line-cross', title='Pipe cross (junction)', group='pipe', size=(48, 48), anchor=(24, 24),
         props=[MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-overlap.svg', el='obc-line-overlap', title='Pipe crossover (no junction)', group='pipe', size=(48, 48), anchor=(24, 24),
         props=[MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-end.svg', el='obc-end-point-line', title='Pipe end', group='pipe', size=(48, 48), anchor=(24, 24),
         props=[p('_ps_direction', "'right'", 'direction', 'str', 'Side the closed end faces: top | right | bottom | left'),
                MEDIUM, LINETYPE, FLUID_PIPE]),
    dict(file='ob-line-flow.svg', el='obc-direction-line', title='Flow arrow (1 cell)', group='pipe', size=(24, 48), anchor=(0, 24),
         props=[MEDIUM, LINETYPE, FLUID_PIPE]),
]
for _w in AUTOMATION:
    _w.setdefault('cat', 'automation')
    _w.setdefault('layout', 'anchor')
    if _w['group'] == 'pipe':
        _w.setdefault('preview', [['_ps_medium', 'water']])

# ======================================================================================
# Instruments, charts, controls, alerts (layout fill/center/start, anchor = top-left)
# ======================================================================================

VALUE = p('_pn_value', '0', 'value', 'num', 'Process value')
MIN = p('_pn_min', '0', 'minValue', 'num', 'Scale minimum')
MAX = p('_pn_max', '100', 'maxValue', 'num', 'Scale maximum')
HAS_SP = p('_pb_hasSetpoint', 'false', None, 'bool', 'Show the setpoint marker')
SETPOINT = p('_pn_setpoint', '0', None, 'num', 'Setpoint (shown when _pb_hasSetpoint is true)')
SETPOINT_APPLY = '    el.setpoint = toBool(_pb_hasSetpoint) ? toNum(_pn_setpoint) : undefined;'
PRIORITY = p('_ps_priority', "'regular'", 'priority', 'str', 'Colour priority: regular | enhanced')
STATE = p('_pb_off', 'false', None, 'bool', 'Instrument off (greyed out)')
STATE_APPLY = "    el.state = toBool(_pb_off) ? 'off' : 'active';"

# rolling buffer for live charts: the current value is sampled every _pn_interval seconds (tags only
# notify changes, so a steady value must still move along the time axis); the last _pn_points are kept.
# "__series" is a hidden input used by the library preview renderer to seed a curve.
BUFFER_JS = '''
var __points = [];
var __hasValue = false;
var __lastSample = 0;
function pushPoint(v) {
    var d = new Date();
    var label = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
    __points.push({ label: label, value: toNum(v) });
    var n = Math.max(2, Math.round(toNum(_pn_points)) || 60);
    while (__points.length > n) { __points.shift(); }
    __lastSample = Date.now();
}
function chartData() {
    return __points.length === 1 ? [__points[0], { label: __points[0].label, value: __points[0].value }] : __points.slice();
}
function sampleTick() {
    if (!__hasValue) return;
    var every = Math.max(0.2, toNum(_pn_interval) || 1) * 1000;
    if (Date.now() - __lastSample >= every) { pushPoint(_pn_value); apply(); }
}
// stop when the widget leaves the page (page change, editor), as the FUXA widget guide requires
var __sampler = setInterval(function () {
    if (!document.getElementById('ob_root')) { clearInterval(__sampler); return; }
    sampleTick();
}, 200);
'''
BUFFER_PUT = {'_pn_value': 'if (!__hasValue) { __hasValue = true; pushPoint(_pn_value); }',
              '__series': ''}
INTERVAL = p('_pn_interval', '1', None, 'num', 'Sampling interval of the live buffer, seconds')
POINTS = p('_pn_points', '60', None, 'num', 'Points kept in the live buffer (60 points at 1 s = last minute)')
UNIT = p('_ps_unit', "''", 'unit', 'str', 'Engineering unit')

INSTRUMENTS = [
    dict(file='ob-gauge-radial.svg', el='obc-gauge-radial', title='Radial gauge', cat='instruments',
         layout='fill', size=(192, 192),
         props=[VALUE, MIN, MAX, HAS_SP, SETPOINT,
                p('_ps_type', "'filled'", 'type', 'str', 'Style: filled | bar | needle'),
                p('_pb_labels', 'true', 'showLabels', 'bool', 'Show scale labels'),
                PRIORITY, STATE],
         apply_extra=[SETPOINT_APPLY, STATE_APPLY], preview=[['_pn_value', 60]]),
    dict(file='ob-gauge-vertical.svg', el='obc-gauge-vertical', title='Vertical gauge (bar)', cat='instruments',
         layout='fill', size=(96, 288), init_js=['el.fixedAspectRatio = true;'],
         props=[VALUE, MIN, MAX, HAS_SP, SETPOINT,
                p('_ps_fillMode', "'fill'", 'fillMode', 'str', 'Bar fill: fill | tint'),
                p('_pb_labels', 'true', 'showLabels', 'bool', 'Show scale labels'),
                PRIORITY, STATE],
         apply_extra=[SETPOINT_APPLY, STATE_APPLY], preview=[['_pn_value', 60]]),
    dict(file='ob-gauge-horizontal.svg', el='obc-gauge-horizontal', title='Horizontal gauge (bar)', cat='instruments',
         # drawn at its native size (384x72) and scaled to the box: fixedAspectRatio keeps
         # room for a scale below the bar and would leave the bar small in a flat box
         layout='fill', size=(384, 72),
         fill_js="el.style.width = '384px'; el.style.height = '72px'; el.style.transformOrigin = '0 0'; "
                 "el.style.transform = 'scale(' + (w / 384) + ',' + (h / 72) + ')';",
         props=[VALUE, MIN, MAX, HAS_SP, SETPOINT,
                p('_ps_fillMode', "'fill'", 'fillMode', 'str', 'Bar fill: fill | tint'),
                p('_pb_labels', 'true', 'showLabels', 'bool', 'Show scale labels'),
                PRIORITY, STATE],
         apply_extra=[SETPOINT_APPLY, STATE_APPLY], preview=[['_pn_value', 60]]),
    dict(file='ob-gauge-trend.svg', el='obc-gauge-trend', title='Trend gauge (live)', cat='instruments',
         layout='fill', size=(288, 192), fill_js='el.width = w; el.height = h;',
         props=[VALUE, MIN, MAX, UNIT, POINTS, INTERVAL, HAS_SP, SETPOINT, STATE],
         extra_js=BUFFER_JS, on_put=BUFFER_PUT,
         apply_extra=['    el.data = chartData();', SETPOINT_APPLY, STATE_APPLY],
         preview=[['__series', [40, 46, 52, 55, 61, 58, 63, 66, 64, 70]], ['_pn_value', 70]]),
    dict(file='ob-instrument-field.svg', el='obc-instrument-field', title='Instrument field', cat='instruments',
         layout='start', size=(144, 72),
         props=[VALUE, HAS_SP, SETPOINT, UNIT,
                p('_ps_tag', "'PT-101'", 'tag', 'str', 'Instrument tag / label'),
                p('_pn_digits', '3', 'maxDigits', 'num', 'Integer digits'),
                p('_pn_decimals', '1', 'fractionDigits', 'num', 'Decimal digits'),
                p('_ps_size', "'enhanced'", 'size', 'str', 'Size: regular | enhanced'),
                p('_pb_off', 'false', 'off', 'bool', 'Instrument off (shows dashes)')],
         apply_extra=['    el.hasSetpoint = toBool(_pb_hasSetpoint);', '    el.setpoint = toNum(_pn_setpoint);'],
         preview=[['_pn_value', 42.5], ['_ps_unit', 'bar']]),
    dict(file='ob-circular-progress.svg', el='obc-circular-progress', title='Circular progress', cat='instruments',
         layout='fill', size=(96, 96), init_js=["el.mode = 'determinate';"],
         props=[p('_pn_value', '0', 'value', 'num', 'Progress 0-100 %')], preview=[['_pn_value', 65]]),
    dict(file='ob-progress-bar.svg', el='obc-progress-bar', title='Progress bar', cat='instruments',
         layout='hfill', size=(240, 48),
         props=[p('_pn_value', '0', 'value', 'num', 'Progress 0-100 %'),
                p('_pb_showValue', 'true', 'showValue', 'bool', 'Show the value'),
                p('_pb_showUnit', 'true', 'showUnit', 'bool', 'Show the % unit')],
         preview=[['_pn_value', 65]]),
]

SERIES_PREVIEW = [['__series', [12, 18, 15, 22, 30, 27, 35, 31, 38, 42, 40, 47]], ['_pn_value', 47]]
SLICES = []
for i, (lbl, val) in enumerate([('A', 40), ('B', 30), ('C', 20), ('D', 0)], start=1):
    SLICES.append(p(f'_pn_value{i}', '0', None, 'num', f'Slice {i} value'))
    SLICES.append(p(f'_ps_label{i}', f"'{lbl}'" if i < 4 else "''", None, 'str', f'Slice {i} label (empty = slice hidden)'))
SLICE_APPLY = ('    var d = [];\n'
               '    [[_ps_label1, _pn_value1], [_ps_label2, _pn_value2], [_ps_label3, _pn_value3], [_ps_label4, _pn_value4]]'
               '.forEach(function (s) { if (String(s[0])) { d.push({ label: String(s[0]), value: toNum(s[1]) }); } });\n'
               '    el.data = d;')
SLICE_PREVIEW = [['_pn_value1', 40], ['_pn_value2', 30], ['_pn_value3', 20]]

CHARTS = [
    dict(file='ob-line-graph.svg', el='obc-line-graph', title='Line graph (live)', cat='charts',
         layout='fill', size=(384, 240), fill_js='el.width = w; el.height = h;',
         props=[VALUE, UNIT, POINTS, INTERVAL,
                p('_ps_lineMode', "'smooth'", 'lineMode', 'str', 'Line: smooth | straight | stepped'),
                p('_pb_grid', 'true', 'showGrid', 'bool', 'Show grid')],
         extra_js=BUFFER_JS, on_put=BUFFER_PUT,
         apply_extra=['    el.data = chartData();'], preview=SERIES_PREVIEW),
    dict(file='ob-area-graph.svg', el='obc-area-graph', title='Area graph (live)', cat='charts',
         layout='fill', size=(384, 240), fill_js='el.width = w; el.height = h;',
         props=[VALUE, UNIT, POINTS, INTERVAL,
                p('_ps_lineMode', "'smooth'", 'lineMode', 'str', 'Line: smooth | straight | stepped'),
                p('_pb_grid', 'true', 'showGrid', 'bool', 'Show grid')],
         extra_js=BUFFER_JS, on_put=BUFFER_PUT,
         apply_extra=['    el.data = chartData();'], preview=SERIES_PREVIEW),
    dict(file='ob-pie-chart.svg', el='obc-pie-chart', title='Pie chart', cat='charts',
         layout='fill', size=(240, 240), fill_js='el.fixedHeight = h;',
         props=SLICES + [p('_pb_legend', 'false', 'legend', 'bool', 'Show legend')],
         apply_extra=[SLICE_APPLY], preview=SLICE_PREVIEW),
    dict(file='ob-donut-chart.svg', el='obc-donut-chart', title='Donut chart', cat='charts',
         layout='fill', size=(240, 240), fill_js='el.fixedHeight = h;',
         props=SLICES + [p('_pn_max', '100', 'max', 'num', 'Total of the ring (slices are drawn against it)'),
                         p('_ps_centerLabel', "'Total'", 'centerReadoutLabel', 'str', 'Label under the centre value'),
                         p('_ps_unit', "'%'", 'centerReadoutUnit', 'str', 'Unit of the centre value'),
                         p('_pb_legend', 'false', 'legend', 'bool', 'Show legend')],
         apply_extra=[SLICE_APPLY], preview=SLICE_PREVIEW),
    dict(file='ob-radial-bar-chart.svg', el='obc-radial-bar-chart', title='Radial bar chart', cat='charts',
         layout='fill', size=(240, 240), fill_js='el.fixedHeight = h;',
         props=[p('_pn_value1', '0', None, 'num', 'Ring 1 value'),
                p('_pn_value2', '0', None, 'num', 'Ring 2 value'),
                p('_pn_value3', '0', None, 'num', 'Ring 3 value'),
                p('_pn_rings', '3', None, 'num', 'Rings shown (1-3)'),
                p('_pn_max', '100', 'max', 'num', 'Full-scale value of every ring')],
         apply_extra=['    el.data = [_pn_value1, _pn_value2, _pn_value3].slice(0, Math.min(3, Math.max(1, Math.round(toNum(_pn_rings))))).map(toNum);'],
         preview=[['_pn_value1', 80], ['_pn_value2', 55], ['_pn_value3', 30]]),
]

DISABLED = p('_pb_disabled', 'false', 'disabled', 'bool', 'Disabled (operator cannot act)')

CONTROLS = [
    dict(file='ob-button.svg', el='obc-button', title='Command button', cat='controls',
         layout='hfill', size=(144, 48),
         props=[p('_pn_command', '0', None, 'num', 'Written on click with the value of _pn_pressValue', 'write'),
                p('_pn_pressValue', '1', None, 'num', 'Value written to _pn_command on click'),
                p('_ps_label', "'Start'", None, 'str', 'Button text'),
                p('_ps_variant', "'normal'", 'variant', 'str', 'Style: normal | raised | flat'),
                DISABLED],
         apply_extra=['    el.textContent = String(_ps_label);', '    el.fullWidth = true;'],
         events=[dict(event='click', var='_pn_command', expr='toNum(_pn_pressValue)', guard='!toBool(_pb_disabled)')]),
    dict(file='ob-start-stop.svg', el='obc-start-stop-switch', title='Start/stop switch', cat='controls',
         layout='hfill', size=(240, 48),
         props=[p('_pb_running', 'false', 'checked', 'bool', 'Running state; slide to start/stop writes it (1/0)', 'rw'),
                p('_ps_size', "'regular'", 'size', 'str', 'Size: regular | large'),
                p('_pb_alarm', 'false', 'hasAlert', 'bool', 'Alarm state'),
                DISABLED],
         apply_extra=["    el.variant = toBool(_pb_running) ? 'running' : 'normal';"],
         events=[dict(event='change', var='_pb_running', expr='!!(ev.detail && ev.detail.checked)')],
         preview=[['_pb_running', 1]]),
    dict(file='ob-toggle-switch.svg', el='obc-toggle-switch', title='Toggle switch', cat='controls',
         layout='hfill', size=(240, 48),
         props=[p('_pb_value', 'false', 'checked', 'bool', 'On/off state, written (1/0) when toggled', 'rw'),
                p('_ps_label', "'Auto'", 'label', 'str', 'Label'),
                DISABLED],
         events=[dict(event='input', var='_pb_value', expr='!!(ev.detail && ev.detail.checked)')],
         preview=[['_pb_value', 1]]),
    dict(file='ob-slider.svg', el='obc-slider', title='Setpoint slider', cat='controls',
         layout='hfill', size=(288, 48),
         props=[p('_pn_value', '50', 'value', 'num', 'Setpoint, written while dragging (debounced)', 'rw'),
                p('_pn_min', '0', 'min', 'num', 'Minimum'),
                p('_pn_max', '100', 'max', 'num', 'Maximum'),
                p('_pn_step', '1', 'step', 'num', 'Step'),
                p('_pn_stepClick', '10', 'stepClick', 'num', 'Step of the -/+ buttons (enhanced variant)'),
                p('_ps_variant', "'normal'", 'variant', 'str', 'Style: normal | enhanced (with -/+ buttons) | no-input (read only)'),
                DISABLED],
         events=[dict(event='value', var='_pn_value', expr='toNum(ev.detail)', debounce=250)],
         preview=[['_pn_value', 40]]),
    dict(file='ob-number-input.svg', el='obc-number-input-field', title='Number input', cat='controls',
         layout='hfill', size=(192, 48), init_js=['el.rejectUpdatesOnFocus = true;'],
         props=[p('_pn_value', '0', None, 'num', 'Value, written on Enter or when the field loses focus', 'rw'),
                p('_pn_decimals', '1', None, 'num', 'Decimals shown'),
                UNIT, DISABLED],
         apply_extra=['    el.value = toNum(_pn_value).toFixed(Math.max(0, Math.round(toNum(_pn_decimals))));'],
         extra_js='''
var __pending = null;
function commitInput() {
    if (__pending === null) return;
    var v = parseFloat(String(__pending).replace(',', '.'));
    __pending = null;
    __busyUntil = Date.now() + 1000;
    if (isNaN(v)) { apply(); return; }
    _pn_value = v;
    postValue('_pn_value', v);
}

(function () {
    var el = document.getElementById('ob_el');
    if (!el) return;
    el.addEventListener('input', function (ev) {
        var src = ev.composedPath ? ev.composedPath()[0] : ev.target;
        __pending = (src && src.value !== undefined) ? src.value : el.value;
        __busyUntil = Date.now() + 60000;
    });
    el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { commitInput(); }
        if (ev.key === 'Escape') { __pending = null; __busyUntil = 0; apply(); }
    });
    el.addEventListener('focusout', commitInput);
})();
''', preview=[['_pn_value', 12.5], ['_ps_unit', 'bar']]),
    dict(file='ob-mode-selector.svg', el='obc-toggle-button-group', title='Mode selector (2-3 options)', cat='controls',
         layout='hfill', size=(288, 48),
         inner=('<obc-toggle-button-option id="ob_o1" value="0">Man</obc-toggle-button-option>'
                '<obc-toggle-button-option id="ob_o2" value="1">Auto</obc-toggle-button-option>'
                '<obc-toggle-button-option id="ob_o3" value="2">Off</obc-toggle-button-option>'),
         props=[p('_pn_value', '0', None, 'num', 'Selected option index 0, 1, 2 (written on selection)', 'rw'),
                p('_ps_option1', "'Man'", None, 'str', 'Option 0 text'),
                p('_ps_option2', "'Auto'", None, 'str', 'Option 1 text'),
                p('_ps_option3', "'Off'", None, 'str', 'Option 2 text'),
                p('_pn_options', '3', None, 'num', 'Number of options shown: 2 or 3'),
                DISABLED],
         apply_extra=["    el.value = String(Math.round(toNum(_pn_value)));",
                      "    [['ob_o1', _ps_option1], ['ob_o2', _ps_option2], ['ob_o3', _ps_option3]].forEach(function (o) {",
                      "        var opt = document.getElementById(o[0]); if (!opt) return;",
                      "        opt.textContent = String(o[1]);",
                      "        opt.style.display = (o[0] === 'ob_o3' && Math.round(toNum(_pn_options)) < 3) || !String(o[1]).trim() ? 'none' : '';",
                      "    });"],
         events=[dict(event='value', var='_pn_value', expr='toNum(ev.detail && ev.detail.value)')],
         preview=[['_pn_value', 1]]),
    dict(file='ob-check-button.svg', el='obc-check-button', title='Check button', cat='controls',
         layout='hfill', size=(144, 48),
         props=[p('_pb_value', 'false', 'checked', 'bool', 'Checked state, written (1/0) on click', 'rw'),
                p('_ps_label', "'Bypass'", None, 'str', 'Button text'),
                p('_ps_type', "'regular'", 'type', 'str', 'Style: regular | checkbox'),
                DISABLED],
         apply_extra=['    el.textContent = String(_ps_label);', '    el.fullWidth = true;'],
         events=[dict(event='check-button-click', var='_pb_value', expr='!!(ev.detail && ev.detail.checked)')]),
    dict(file='ob-ok-nok.svg', el='obc-toggle-button-three-state', title='OK / NOK selector', cat='controls',
         layout='start', size=(144, 48),
         props=[p('_pn_value', '0', None, 'num', 'State 0 = none, 1 = OK, 2 = NOK (written on selection)', 'rw'),
                DISABLED],
         apply_extra=["    el.state = ['no-input', 'success', 'error'][Math.round(toNum(_pn_value))] || 'no-input';"],
         events=[dict(event='change', var='_pn_value',
                      expr="Math.max(0, ['no-input', 'success', 'error'].indexOf(ev.detail && ev.detail.state))")],
         preview=[['_pn_value', 1]]),
]

ALERTS = [
    dict(file='ob-alert-icon.svg', el='obc-alert-icon', title='Alert icon', cat='alerts',
         layout='center', size=(48, 48), el_style='display:block;width:32px;height:32px;',
         props=[p('_pb_active', 'false', None, 'bool', 'Alert active (icon shown in colour; hidden when inactive and _pb_hideInactive)'),
                p('_pb_acknowledged', 'false', 'acknowledged', 'bool', 'Acknowledged'),
                p('_ps_type', "'alarm'", 'type', 'str', 'Type: alarm | warning | caution'),
                p('_pb_hideInactive', 'false', None, 'bool', 'Hide the icon while the alert is not active')],
         apply_extra=['    el.active = toBool(_pb_active);',
                      "    el.style.visibility = (!toBool(_pb_active) && toBool(_pb_hideInactive)) ? 'hidden' : 'visible';"],
         preview=[['_pb_active', 1]]),
    dict(file='ob-alert-button.svg', el='obc-alert-button', title='Alert button (counter)', cat='alerts',
         layout='start', size=(144, 48),
         props=[p('_pn_count', '0', 'nAlerts', 'num', 'Number of active alerts'),
                p('_ps_type', "'alarm'", None, 'str', 'Highest alert type: alarm | warning | caution (idle when count is 0)'),
                p('_pb_blinking', 'false', 'blinking', 'bool', 'Blink (unacknowledged alerts)'),
                p('_pb_command', 'false', None, 'bool', 'Written 1 on click (e.g. acknowledge / silence request)', 'write')],
         apply_extra=['    el.counter = true;',
                      '    el.alertType = toNum(_pn_count) > 0 ? String(_ps_type) : undefined;'],
         events=[dict(event='click', var='_pb_command', expr='true')],
         preview=[['_pn_count', 3]]),
    dict(file='ob-alert-frame.svg', el='obc-alert-frame', title='Alert frame', cat='alerts',
         layout='fill', size=(192, 120),
         props=[p('_pb_active', 'false', None, 'bool', 'Frame visible (alert active); place it around the equipment'),
                p('_ps_status', "'alarm'", 'status', 'str', 'Type: alarm | warning | caution'),
                p('_ps_thickness', "'regular'", 'thickness', 'str', 'Border: regular | thick')],
         apply_extra=["    el.style.visibility = toBool(_pb_active) ? 'visible' : 'hidden';"],
         preview=[['_pb_active', 1]]),
    dict(file='ob-status-indicator.svg', el='obc-status-indicator', title='Status indicator', cat='alerts',
         layout='center', size=(48, 24),
         props=[p('_pn_state', '1', None, 'num', 'State: 0 inactive, 1 active, 2 running, 3 caution, 4 warning, 5 alarm; or a boolean (on/off) with _pn_onState'),
                p('_pn_onState', '-1', None, 'num', 'For a boolean tag: state shown when it is on (e.g. 2 running, 5 alarm; off = inactive). -1 = _pn_state is the state code')],
         apply_extra=["    var code = toNum(_pn_onState) >= 0 ? (toNum(_pn_state) ? toNum(_pn_onState) : 0) : toNum(_pn_state);",
                      "    el.status = ['inactive', 'active', 'running', 'caution', 'warning', 'alarm'][Math.round(code)] || 'inactive';"],
         preview=[['_pn_state', 2]]),
    dict(file='ob-badge.svg', el='obc-badge', title='Badge (count)', cat='alerts',
         layout='center', size=(48, 48),
         props=[p('_pn_number', '0', 'number', 'num', 'Number shown'),
                p('_ps_type', "'alarm'", 'type', 'str', 'Type: alarm | warning | caution | running | notification | regular | automation'),
                p('_ps_size', "'large'", 'size', 'str', 'Size: regular | large'),
                p('_pb_hideZero', 'true', None, 'bool', 'Hide the badge when the number is 0')],
         apply_extra=["    el.style.visibility = (toBool(_pb_hideZero) && toNum(_pn_number) === 0) ? 'hidden' : 'visible';"],
         preview=[['_pn_number', 5]]),
    dict(file='ob-tag.svg', el='obc-tag', title='Tag label', cat='alerts',
         layout='start', size=(96, 48),
         props=[p('_ps_label', "'AUTO'", 'label', 'str', 'Text (bind a string tag for live state text)'),
                p('_ps_color', "'blue'", 'color', 'str', 'Colour: gray | blue | cyan | teal | green | yellow | orange | red | magenta | purple')]),
    dict(file='ob-clock.svg', el='obc-clock', title='Clock', cat='alerts',
         layout='start', size=(144, 48),
         props=[p('_pb_seconds', 'false', 'showSeconds', 'bool', 'Show seconds'),
                p('_pb_date', 'false', 'showDate', 'bool', 'Show the date')],
         apply_extra=['    el.timeZoneOffsetHours = -new Date().getTimezoneOffset() / 60;',
                      '    el.date = new Date().toISOString();'],
         extra_js='''
// stop when the widget leaves the page (page change, editor), as the FUXA widget guide requires
var __ticker = setInterval(function () {
    if (!document.getElementById('ob_root')) { clearInterval(__ticker); return; }
    apply();
}, 1000);
'''),
]

WIDGETS = AUTOMATION + INSTRUMENTS + CHARTS + CONTROLS + ALERTS
for _w in WIDGETS:
    _w.setdefault('layout', 'anchor')
    _w.setdefault('anchor', (0, 0))
    _w.setdefault('group', _w['cat'])

# ======================================================================================
# Script templates
# ======================================================================================

SCRIPT = r'''
//!export-start
{exports}
//!export-end

var __busyUntil = 0;

function toBool(v) {{
    if (v === true || v === 1) return true;
    var s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'on';
}}

function toNum(v) {{
    if (v === true || v === 'true') return 1;
    if (v === false || v === 'false') return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}}
{pre}
function apply() {{
    var preview = document.getElementById('ob_preview');
    if (preview && preview.parentNode) {{ preview.parentNode.removeChild(preview); }}
    var el = document.getElementById('ob_el');
    if (!el) return;
{apply}
}}

function putValue(id, value) {{
{guard}{put}
    apply();
}}

function postValue(id, value) {{
    // replaced at runtime: writes value to the tag bound to "id"
}}
{extra}
apply();
'''

CLICK = '''
function onCommandClick() {{
    {cmd} = !toBool({state});
    postValue('{cmd}', {cmd} ? 1 : 0);
}}

(function () {{
    var el = document.getElementById('ob_el');
    if (el) {{ el.addEventListener('click', onCommandClick); }}
}})();
'''

# Note: FUXA exports every named function of a widget script to the module (also nested ones),
# so helper functions must be top-level; nested code uses anonymous functions only.
#
# operator input -> variable -> tag. While the operator acts, incoming values of read/write
# variables are ignored for a moment so the control does not jump back.
EVENT = '''
(function () {{
    var el = document.getElementById('ob_el');
    if (!el) return;
    var timer = null;
    el.addEventListener('{event}', function (ev) {{
        if (!({guard})) return;
        {var} = {expr};
        __busyUntil = Date.now() + {busy};
        if (timer) {{ clearTimeout(timer); }}
        timer = setTimeout(function () {{ timer = null; postValue('{var}', {post}); }}, {debounce});
    }});
}})();
'''

# Straight pipes follow the widget size: resizing the widget in the editor changes the
# pipe length in whole grid cells instead of scaling the drawing.
STRETCH = '''
function fitLength() {{
    var root = document.getElementById('ob_root');
    var fo = document.getElementById('ob_fo');
    var el = document.getElementById('ob_el');
    if (!root || !fo || !el) return;
    var w = parseFloat(root.getAttribute('width')) || {w};
    var h = parseFloat(root.getAttribute('height')) || {h};
    if (root.getAttribute('viewBox') !== '0 0 ' + w + ' ' + h) {{
        root.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    }}
    fo.setAttribute('width', w);
    fo.setAttribute('height', h);
    el.length = Math.max(1, Math.round({axis} / {grid}));
}}

(function () {{
    var root = document.getElementById('ob_root');
    fitLength();
    if (root && window.MutationObserver) {{
        new MutationObserver(fitLength).observe(root, {{ attributes: true, attributeFilter: ['width', 'height'] }});
    }}
}})();
'''

# Non-P&ID widgets: the element follows the widget box (resizing re-lays out, no scaling).
FIT = '''
function fitBox() {{
    var root = document.getElementById('ob_root');
    var fo = document.getElementById('ob_fo');
    var el = document.getElementById('ob_el');
    if (!root || !fo || !el) return;
    var w = parseFloat(root.getAttribute('width')) || {w};
    var h = parseFloat(root.getAttribute('height')) || {h};
    if (root.getAttribute('viewBox') !== '0 0 ' + w + ' ' + h) {{
        root.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    }}
    fo.setAttribute('width', w);
    fo.setAttribute('height', h);
{size}
}}

(function () {{
    var root = document.getElementById('ob_root');
    fitBox();
    if (root && window.MutationObserver) {{
        new MutationObserver(fitBox).observe(root, {{ attributes: true, attributeFilter: ['width', 'height'] }});
    }}
}})();
'''

CONV = {'bool': 'toBool({})', 'num': 'toNum({})', 'str': 'String({})'}
POST = {'bool': '({} ? 1 : 0)', 'num': '{}', 'str': '{}'}

CONTAINER = {
    'anchor': 'position:relative;width:100%;height:100%;overflow:visible;',
    'fill': 'position:relative;width:100%;height:100%;overflow:visible;',
    'hfill': 'position:relative;width:100%;height:100%;overflow:visible;display:flex;align-items:center;',
    'center': 'position:relative;width:100%;height:100%;overflow:visible;display:flex;align-items:center;justify-content:center;',
    'start': 'position:relative;width:100%;height:100%;overflow:visible;display:flex;align-items:center;justify-content:flex-start;',
}


def all_props(w):
    props = list(w['props'])
    if w.get('command'):
        props.append(p(w['command'][0], 'false', None, 'bool', w['command'][2], 'write'))
    return props


def element_style(w):
    width, height = w['size']
    if w.get('el_style'):
        return w['el_style']
    if w['layout'] == 'anchor':
        ax, ay = w['anchor']
        return f'position:absolute;left:{ax}px;top:{ay}px;'
    if w['layout'] == 'fill':
        return f'position:absolute;left:0;top:0;width:{width}px;height:{height}px;display:block;'
    if w['layout'] == 'hfill':
        return 'display:block;width:100%;'
    return ''


def build(w):
    width, height = w['size']
    ax, ay = w['anchor']
    assert width % GRID == 0 and height % GRID == 0, w['file']
    assert ax % GRID == 0 and ay % GRID == 0, w['file']
    props = all_props(w)
    kinds = {x[0]: x[3] for x in props}

    exports = '\n'.join(f'let {x[0]} = {x[1]};' for x in props)
    apply_lines = [f'    el.{x[2]} = {CONV[x[3]].format(x[0])};' for x in props if x[2]]
    if any(x[0] == '_ps_tag' for x in props) and w['cat'] == 'automation' and w['el'] != 'obc-automation-tank':
        apply_lines.append('    el.hasIdTag = String(_ps_tag).length > 0;')
    apply_lines += w.get('apply_extra', [])
    if any(x[0] == '_ps_fluid' for x in props) and w['group'] == 'pipe':
        apply_lines.append("    if (String(_ps_fluid)) { el.style.setProperty('--automation-fresh-water', 'var(--automation-medium-' + String(_ps_fluid) + ')'); }"
                           " else { el.style.removeProperty('--automation-fresh-water'); }")
    on_put = w.get('on_put', {})
    put_lines = []
    for x in props:
        hook = (' ' + on_put[x[0]]) if x[0] in on_put else ''
        put_lines.append(f"    if (id === '{x[0]}') {{ {x[0]} = {CONV[x[3]].format('value')};{hook} }}")
    if '__series' in on_put:
        put_lines.append("    if (id === '__series' && value && value.forEach) { __points = []; value.forEach(function (v) { pushPoint(v); }); __hasValue = true; }")
    rw = [x[0] for x in props if x[5] == 'rw']
    guard = ''
    if rw:
        guard = f"    if (Date.now() < __busyUntil && {json.dumps(rw)}.indexOf(id) >= 0) return;\n"

    pre = w.get('extra_js', '') if w.get('on_put') else ''
    extra = ''
    if w.get('init_js'):
        extra += '\n(function () {\n    var el = document.getElementById(\'ob_el\');\n    if (!el) return;\n' + \
                 ''.join(f'    {line}\n' for line in w['init_js']) + '})();\n'
    if w.get('command'):
        extra += CLICK.format(cmd=w['command'][0], state=w['command'][1])
    for ev in w.get('events', []):
        kind = kinds[ev['var']]
        extra += EVENT.format(event=ev['event'], var=ev['var'], expr=ev['expr'], guard=ev.get('guard', 'true'),
                              busy=1000 + ev.get('debounce', 0), debounce=ev.get('debounce', 0),
                              post=POST[kind].format(ev['var']))
    if w.get('stretch'):
        extra += STRETCH.format(w=width, h=height, axis='w' if w['stretch'] == 'x' else 'h', grid=GRID)
    if w['layout'] != 'anchor':
        size = ''
        if w['layout'] == 'fill':
            size = "    el.style.width = w + 'px';\n    el.style.height = h + 'px';\n"
            if w.get('fill_js'):
                size += f"    {w['fill_js']}\n"
        extra += FIT.format(w=width, h=height, size=size.rstrip('\n'))
    if not w.get('on_put'):
        extra += w.get('extra_js', '')

    script = SCRIPT.format(exports=exports, pre=pre, apply='\n'.join(apply_lines),
                           guard=guard, put='\n'.join(put_lines), extra=extra)

    cat = CAT[w['cat']]
    doc = [f'ScadaCraft OpenBridge widget: {w["title"]} ({w["el"]}, OpenBridge {OB_VERSION}, Apache-2.0).',
           f'Library: {cat[2]}. Box {width}x{height} px, anchor at ({ax},{ay}).',
           'Bindable properties:']
    doc += [f'  {x[0]} (default {x[1]}, {x[5]}): {x[4]}' for x in props]

    preview = ''
    png = os.path.join(PREVIEWS, w['file'][:-4] + '.png')
    if os.path.exists(png):
        data = base64.b64encode(open(png, 'rb').read()).decode('ascii')
        # static picture for the editor library (<img> does not run scripts); removed at runtime
        preview = (f'\n  <image id="ob_preview" x="0" y="0" width="{width}" height="{height}" '
                   f'href="data:image/png;base64,{data}" xlink:href="data:image/png;base64,{data}" />')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="ob_root" width="{width}" height="{height}" viewBox="0 0 {width} {height}" overflow="visible">
  <desc>{escape(chr(10).join(doc))}</desc>
  <rect id="ob_bg" x="0" y="0" width="{width}" height="{height}" fill="none" />{preview}
  <foreignObject id="ob_fo" x="0" y="0" width="{width}" height="{height}" overflow="visible">
    <div xmlns="http://www.w3.org/1999/xhtml" style="{CONTAINER[w['layout']]}">
      <{w["el"]} id="ob_el" style="{element_style(w)}">{w.get('inner', '')}</{w["el"]}>
    </div>
  </foreignObject>
  <script type="text/javascript"><![CDATA[{script}]]></script>
</svg>
'''


def folder(w):
    return CAT[w['cat']][1]


def catalog():
    """Machine-readable catalog: used by docs and by the MCP server to place widgets."""
    items = []
    for w in WIDGETS:
        items.append({
            'widget': w['file'][:-4],
            'file': f'_widgets/{folder(w)}/{w["file"]}',
            'title': w['title'],
            'category': w['cat'],
            'group': w['group'],
            'element': w['el'],
            'layout': w['layout'],
            'size': {'width': w['size'][0], 'height': w['size'][1]},
            'anchor': {'x': w['anchor'][0], 'y': w['anchor'][1]},
            'stretch': w.get('stretch'),
            'properties': [{'name': x[0], 'type': x[3], 'default': x[1].strip("'"),
                            'dir': x[5], 'write': x[5] in ('write', 'rw'),
                            'description': x[4]} for x in all_props(w)],
            'preview': w.get('preview', []),
        })
    return {'grid': GRID, 'openbridge': OB_VERSION,
            'categories': [{'key': c[0], 'folder': c[1], 'title': c[2], 'description': c[3]} for c in CATEGORIES],
            'widgets': items}


ANCHOR_MEANING = {
    'obc-automation-tank': 'top-centre of the tank body', 'obc-automation-readout': 'end of the connection tick',
    'obc-horizontal-line': 'start of the pipe axis (left)', 'obc-vertical-line': 'start of the pipe axis (top)',
    'obc-direction-line': 'start of the pipe axis (left)',
}


def reference_md(cat):
    """Widget reference generated from the catalog (docs/openbridge-widgets.md)."""
    g = cat['grid']
    out = ['# OpenBridge widget reference', '',
           '<!-- Generated by tools/openbridge/make-widgets.py — do not edit by hand. -->', '',
           f'Grid: **{g} px**. OpenBridge: **{cat["openbridge"]}**. '
           'Placement: `left = node.x × 24 − anchor.x`, `top = node.y × 24 − anchor.y` '
           '(see [openbridge.md](openbridge.md)). P&ID widgets are anchored at their connection point; '
           'all other widgets at their top-left corner and they fill their box (resize freely, in 24 px steps).', '',
           'Direction: **read** = tag → widget, **write** = widget → tag (command), '
           '**rw** = shown and written by the operator (bind the same tag, e.g. a setpoint).', '']
    for c in cat['categories']:
        ws = [w for w in cat['widgets'] if w['category'] == c['key']]
        out += [f"## {c['title']}", '', f"{c['description']} Editor library group: `{c['folder']}` ({len(ws)} widgets).", '',
                '| Widget | Element | Box (px) | Anchor (px) | Anchor meaning |', '| --- | --- | --- | --- | --- |']
        for w in ws:
            if w['layout'] == 'anchor':
                m = ANCHOR_MEANING.get(w['element'], 'centre of the icon' if w['group'] == 'device' else 'centre of the fitting')
            else:
                m = 'top-left corner (fills the box)'
            stretch = ' (stretches in X)' if w['stretch'] == 'x' else ' (stretches in Y)' if w['stretch'] == 'y' else ''
            out.append(f"| `{w['widget']}` | `{w['element']}` | {w['size']['width']}×{w['size']['height']}{stretch} "
                       f"| ({w['anchor']['x']}, {w['anchor']['y']}) | {m} |")
        out.append('')
    for w in cat['widgets']:
        out += [f"### {w['title']} — `{w['widget']}`", '',
                f"OpenBridge element `{w['element']}`, file `server/{w['file']}`.", '',
                '| Property | Type | Default | Dir | Description |', '| --- | --- | --- | --- | --- |']
        for pr in w['properties']:
            default = pr['default'] if pr['default'] != '' else '—'
            out.append(f"| `{pr['name']}` | {pr['type']} | `{default}` | {pr['dir']} | {pr['description']} |")
        out.append('')
    return '\n'.join(out).rstrip('\n') + '\n'


def main():
    for key, fold, title, desc in CATEGORIES:
        out = os.path.join(WIDGETS_DIR, fold)
        os.makedirs(out, exist_ok=True)
        ws = [w for w in WIDGETS if w['cat'] == key]
        keep = {w['file'] for w in ws}
        for f in os.listdir(out):
            if f.endswith('.svg') and f not in keep:
                os.remove(os.path.join(out, f))
        for w in ws:
            with open(os.path.join(out, w['file']), 'w', encoding='utf-8') as f:
                f.write(build(w))
        meta = {'label': title, 'order': [c[0] for c in CATEGORIES].index(key),
                'description': desc, 'items': [{'file': w['file'], 'label': w['title']} for w in ws]}
        with open(os.path.join(out, 'group.json'), 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2, ensure_ascii=False)
            f.write('\n')
    cat = catalog()
    with open(os.path.join(WIDGETS_DIR, 'openbridge', 'widgets.json'), 'w', encoding='utf-8') as f:
        json.dump(cat, f, indent=2, ensure_ascii=False)
        f.write('\n')
    with open(DOC, 'w', encoding='utf-8') as f:
        f.write(reference_md(cat))
    print(f'{len(WIDGETS)} widgets in {len(CATEGORIES)} groups written to {os.path.normpath(WIDGETS_DIR)}; '
          f'reference: {os.path.normpath(DOC)}')


if __name__ == '__main__':
    main()
