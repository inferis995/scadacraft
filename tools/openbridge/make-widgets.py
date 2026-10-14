#!/usr/bin/env python3
"""Generate ScadaCraft editor widgets wrapping OpenBridge automation web components.

Placement model (OpenBridge "P&ID anchor point model", see docs/openbridge.md):
- the canvas uses a 24 px grid; every pipe connection is a grid node
- each OpenBridge element is placed with position:absolute at its anchor point:
    devices (pump, motor, fan, valves)  -> centre of the icon
    tank                                -> top-centre of the tank body
    readout                             -> connection tick
    straight pipes / flow arrow         -> start of the pipe axis
    elbow / tee / cross / end           -> centre of the fitting
- every widget box is a multiple of 24 px and its anchor sits at a multiple of 24 px
  inside the box, so a widget snapped to the grid has its anchor on a grid node.

Each widget is a FUXA-compatible SVG widget:
- an xhtml <foreignObject> hosting the OpenBridge element (id "ob_el")
- a script whose //!export-start ... //!export-end section declares bindable
  properties (_pb_ boolean, _pn_ number, _ps_ string) shown in the property panel
- putValue(id, value) receives tag values, postValue(id, value) writes to tags

Output: server/_widgets/openbridge/*.svg  (also writes widgets.json, the catalog)
"""
import base64
import json
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'server', '_widgets', 'openbridge')
GRID = 24
PREVIEWS = os.path.join(os.path.dirname(__file__), 'previews')


def p(name, default, prop, kind, desc):
    """Bindable property: widget variable, default, element property, kind, description."""
    return (name, default, prop, kind, desc)


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


MEDIUM = p('_ps_medium', "'normal'", 'medium', 'str', 'Pipe content: normal | water | air | empty')
LINETYPE = p('_ps_lineType', "'fluid'", 'lineType', 'str', 'Line type: fluid | electric | air | connector')
FLUIDS = 'fresh-water | sea-water | waste | masses | fuel | oil | steam | hot | cold | air-ventilation | acid-alkalis | fire-fighting | flammable-gas | non-flammable-gas'
FLUID_PIPE = p('_ps_fluid', "''", None, 'str', 'Fluid colour for water/air pipes (OpenBridge palette): ' + FLUIDS + ' (empty = default)')
RUNNING = p('_pb_running', 'false', 'on', 'bool', 'Running feedback')
SPEED = p('_pn_speed', '0', 'speedInPercent', 'num', 'Speed % (readout)')
DEVICE_BOX = dict(size=(120, 120), anchor=(48, 48))
START_STOP = 'Start/stop command, written on click as !running (1/0)'

WIDGETS = [
    # ---- devices ------------------------------------------------------------------
    dict(file='ob-pump.svg', el='obc-pump', title='Pump', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('101'),
         command=('_pb_command', '_pb_running', START_STOP)),
    dict(file='ob-motor.svg', el='obc-motor', title='Motor', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('201'),
         command=('_pb_command', '_pb_running', START_STOP)),
    dict(file='ob-fan.svg', el='obc-fan', title='Fan', group='device', **DEVICE_BOX,
         props=[RUNNING, SPEED] + device_common('301'),
         command=('_pb_command', '_pb_running', START_STOP)),
    dict(file='ob-valve-digital.svg', el='obc-digital-valve', title='On/off valve', group='device', **DEVICE_BOX,
         props=[p('_pb_open', 'false', 'open', 'bool', 'Open feedback')] + device_common('401'),
         command=('_pb_command', '_pb_open', 'Open/close command, written on click as !open (1/0)')),
    dict(file='ob-valve-analog.svg', el='obc-analog-valve', title='Control valve', group='device', **DEVICE_BOX,
         props=[p('_pn_position', '0', 'value', 'num', 'Valve position 0-100 %'),
                p('_pb_open', 'false', 'open', 'bool', 'Open feedback')] + device_common('501')),
    dict(file='ob-tank.svg', el='obc-automation-tank', title='Tank', group='device', size=(192, 216), anchor=(96, 24),
         props=[p('_pn_level', '50', 'value', 'num', 'Level (same unit as max)'),
                p('_pn_max', '100', 'max', 'num', 'Maximum level / capacity'),
                p('_ps_trend', "'stable'", 'trend', 'str', 'fast-rising | rising | stable | falling | fast-falling'),
                p('_ps_fluid', "'fresh-water'", None, 'str', 'Content colour (OpenBridge palette): ' + FLUIDS),
                p('_ps_tag', "'T-101'", 'tag', 'str', 'Tank label (free text)')],
         apply_extra=["    el.style.setProperty('--automation-medium-fuel', 'var(--automation-medium-' + String(_ps_fluid) + ')');"]),
    dict(file='ob-readout.svg', el='obc-automation-readout', title='Readout', group='device', size=(192, 120), anchor=(96, 48),
         props=[p('_pn_value', '0', 'value', 'num', 'Process value'),
                p('_ps_unit', "'m3/h'", 'unit', 'str', 'Engineering unit'),
                p('_pn_digits', '3', 'numberOfDigits', 'num', 'Integer digits shown'),
                p('_ps_position', "'top'", 'position', 'str', 'Where the readout sits relative to its anchor (tick end): top | bottom | left | right')]),
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

SCRIPT = r'''
//!export-start
{exports}
//!export-end

function toBool(v) {{
    if (v === true || v === 1) return true;
    var s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'on';
}}

function toNum(v) {{
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}}

function apply() {{
    var preview = document.getElementById('ob_preview');
    if (preview && preview.parentNode) {{ preview.parentNode.removeChild(preview); }}
    var el = document.getElementById('ob_el');
    if (!el) return;
{apply}
}}

function putValue(id, value) {{
{put}
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

CONV = {'bool': 'toBool({})', 'num': 'toNum({})', 'str': 'String({})'}


def all_props(w):
    props = list(w['props'])
    if w.get('command'):
        props.append(p(w['command'][0], 'false', None, 'bool', w['command'][2]))
    return props


def build(w):
    width, height = w['size']
    ax, ay = w['anchor']
    assert width % GRID == 0 and height % GRID == 0, w['file']
    assert ax % GRID == 0 and ay % GRID == 0, w['file']
    props = all_props(w)

    exports = '\n'.join(f'let {x[0]} = {x[1]};' for x in props)
    apply_lines = [f'    el.{x[2]} = {CONV[x[3]].format(x[0])};' for x in props if x[2]]
    if any(x[0] == '_ps_tag' for x in props) and w['el'] != 'obc-automation-tank':
        apply_lines.append('    el.hasIdTag = String(_ps_tag).length > 0;')
    apply_lines += w.get('apply_extra', [])
    if any(x[0] == '_ps_fluid' for x in props) and w['group'] == 'pipe':
        apply_lines.append("    if (String(_ps_fluid)) { el.style.setProperty('--automation-fresh-water', 'var(--automation-medium-' + String(_ps_fluid) + ')'); }"
                           " else { el.style.removeProperty('--automation-fresh-water'); }")
    put_lines = [f"    if (id === '{x[0]}') {{ {x[0]} = {CONV[x[3]].format('value')}; }}" for x in props]

    extra = ''
    if w.get('command'):
        extra += CLICK.format(cmd=w['command'][0], state=w['command'][1])
    if w.get('stretch'):
        extra += STRETCH.format(w=width, h=height, axis='w' if w['stretch'] == 'x' else 'h', grid=GRID)

    script = SCRIPT.format(exports=exports, apply='\n'.join(apply_lines),
                           put='\n'.join(put_lines), extra=extra)

    doc = [f'ScadaCraft OpenBridge widget: {w["title"]} ({w["el"]}, OpenBridge 1.0.0, Apache-2.0).',
           f'Box {width}x{height} px, anchor at ({ax},{ay}).',
           'Bindable properties:']
    doc += [f'  {x[0]} (default {x[1]}): {x[4]}' for x in props]

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
    <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:100%;height:100%;overflow:visible;">
      <{w["el"]} id="ob_el" style="position:absolute;left:{ax}px;top:{ay}px;"></{w["el"]}>
    </div>
  </foreignObject>
  <script type="text/javascript"><![CDATA[{script}]]></script>
</svg>
'''


def catalog():
    """Machine-readable catalog: used by docs and by the MCP server to place widgets."""
    items = []
    for w in WIDGETS:
        items.append({
            'widget': w['file'][:-4],
            'file': f'_widgets/openbridge/{w["file"]}',
            'title': w['title'],
            'group': w['group'],
            'element': w['el'],
            'size': {'width': w['size'][0], 'height': w['size'][1]},
            'anchor': {'x': w['anchor'][0], 'y': w['anchor'][1]},
            'stretch': w.get('stretch'),
            'properties': [{'name': x[0], 'type': x[3], 'default': x[1].strip("'"),
                            'write': bool(w.get('command')) and x[0] == w['command'][0],
                            'description': x[4]} for x in all_props(w)],
        })
    return {'grid': GRID, 'openbridge': '1.0.0', 'widgets': items}


DOC = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'openbridge-widgets.md')


def reference_md(cat):
    """Widget reference generated from the catalog (docs/openbridge-widgets.md)."""
    g = cat['grid']
    out = ['# OpenBridge widget reference', '',
           '<!-- Generated by tools/openbridge/make-widgets.py — do not edit by hand. -->', '',
           f'Grid: **{g} px**. OpenBridge: **{cat["openbridge"]}**. '
           'Placement: `left = node.x × 24 − anchor.x`, `top = node.y × 24 − anchor.y` '
           '(see [openbridge.md](openbridge.md)).', '',
           '| Widget | Element | Box (px) | Anchor (px) | Anchor meaning |', '| --- | --- | --- | --- | --- |']
    meaning = {
        'obc-automation-tank': 'top-centre of the tank body', 'obc-automation-readout': 'end of the connection tick',
        'obc-horizontal-line': 'start of the pipe axis (left)', 'obc-vertical-line': 'start of the pipe axis (top)',
        'obc-direction-line': 'start of the pipe axis (left)',
    }
    for w in cat['widgets']:
        m = meaning.get(w['element'], 'centre of the icon' if w['group'] == 'device' else 'centre of the fitting')
        stretch = ' (stretches in X)' if w['stretch'] == 'x' else ' (stretches in Y)' if w['stretch'] == 'y' else ''
        out.append(f"| `{w['widget']}` | `{w['element']}` | {w['size']['width']}×{w['size']['height']}{stretch} "
                   f"| ({w['anchor']['x']}, {w['anchor']['y']}) | {m} |")
    for w in cat['widgets']:
        out += ['', f"## {w['title']} — `{w['widget']}`", '',
                f"OpenBridge element `{w['element']}`, file `server/{w['file']}`.", '',
                '| Property | Type | Default | Dir | Description |', '| --- | --- | --- | --- | --- |']
        for pr in w['properties']:
            d = 'write' if pr['write'] else 'read'
            default = pr['default'] if pr['default'] != '' else '—'
            out.append(f"| `{pr['name']}` | {pr['type']} | `{default}` | {d} | {pr['description']} |")
    return '\n'.join(out) + '\n'


def main():
    os.makedirs(OUT, exist_ok=True)
    keep = {w['file'] for w in WIDGETS}
    for f in os.listdir(OUT):
        if f.endswith('.svg') and f not in keep:
            os.remove(os.path.join(OUT, f))
    for w in WIDGETS:
        with open(os.path.join(OUT, w['file']), 'w', encoding='utf-8') as f:
            f.write(build(w))
    cat = catalog()
    with open(os.path.join(OUT, 'widgets.json'), 'w', encoding='utf-8') as f:
        json.dump(cat, f, indent=2)
        f.write('\n')
    with open(DOC, 'w', encoding='utf-8') as f:
        f.write(reference_md(cat))
    print(f'{len(WIDGETS)} widgets + widgets.json written to {os.path.normpath(OUT)}; reference: {os.path.normpath(DOC)}')


if __name__ == '__main__':
    main()
