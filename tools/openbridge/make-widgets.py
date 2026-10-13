#!/usr/bin/env python3
"""Generate ScadaCraft widget SVGs wrapping OpenBridge automation web components.

Each widget is a FUXA-compatible SVG widget:
- an xhtml <foreignObject> hosting the OpenBridge custom element (id "ob_el")
- a script whose //!export-start ... //!export-end section declares bindable
  properties (_pb_ boolean, _pn_ number, _ps_ string), shown in the property panel
- putValue(id, value) receives tag values, postValue(id, value) writes to tags

Output: server/_widgets/openbridge/*.svg  (run from repo root)
"""
import os
from xml.sax.saxutils import escape

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'server', '_widgets', 'openbridge')

# Properties shared by every OpenBridge automation button (pump, motor, fan, valves)
BUTTON_COMMON = [
    ('_pb_alarm', 'false', 'alert', 'bool', 'Alarm active (red alert frame)'),
    ('_pb_auto', 'false', 'badgeAuto', 'bool', 'Auto mode badge'),
    ('_ps_tag', "''", 'tag', 'str', 'Numeric equipment ID shown as #NNNN (empty = hidden)'),
]

WIDGETS = [
    {
        'file': 'ob-pump.svg', 'tag': 'obc-pump', 'size': (60, 90), 'anchor': (30, 26),
        'title': 'OpenBridge Pump',
        'props': [('_pb_running', 'false', 'on', 'bool', 'Running feedback'),
                  ('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation')] + BUTTON_COMMON,
        'command': ('_pb_command', 'Start/stop command: written with !running on click'),
        'state': '_pb_running',
    },
    {
        'file': 'ob-motor.svg', 'tag': 'obc-motor', 'size': (60, 90), 'anchor': (30, 26),
        'title': 'OpenBridge Motor',
        'props': [('_pb_running', 'false', 'on', 'bool', 'Running feedback'),
                  ('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation')]
                 + [p if p[0] != '_ps_tag' else ('_ps_tag', "''", 'tag', 'str', p[4]) for p in BUTTON_COMMON],
        'command': ('_pb_command', 'Start/stop command: written with !running on click'),
        'state': '_pb_running',
    },
    {
        'file': 'ob-fan.svg', 'tag': 'obc-fan', 'size': (60, 90), 'anchor': (30, 26),
        'title': 'OpenBridge Fan',
        'props': [('_pb_running', 'false', 'on', 'bool', 'Running feedback'),
                  ('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation')]
                 + [p if p[0] != '_ps_tag' else ('_ps_tag', "''", 'tag', 'str', p[4]) for p in BUTTON_COMMON],
        'command': ('_pb_command', 'Start/stop command: written with !running on click'),
        'state': '_pb_running',
    },
    {
        'file': 'ob-valve-digital.svg', 'tag': 'obc-digital-valve', 'size': (60, 90), 'anchor': (30, 26),
        'title': 'OpenBridge On/Off Valve',
        'props': [('_pb_open', 'false', 'open', 'bool', 'Open feedback'),
                  ('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation')]
                 + [p if p[0] != '_ps_tag' else ('_ps_tag', "''", 'tag', 'str', p[4]) for p in BUTTON_COMMON],
        'command': ('_pb_command', 'Open/close command: written with !open on click'),
        'state': '_pb_open',
    },
    {
        'file': 'ob-valve-analog.svg', 'tag': 'obc-analog-valve', 'size': (60, 90), 'anchor': (30, 26),
        'title': 'OpenBridge Control Valve',
        'props': [('_pn_position', '0', 'value', 'num', 'Valve position %'),
                  ('_pb_open', 'false', 'open', 'bool', 'Open feedback'),
                  ('_pb_vertical', 'false', 'vertical', 'bool', 'Vertical orientation')]
                 + [p if p[0] != '_ps_tag' else ('_ps_tag', "''", 'tag', 'str', p[4]) for p in BUTTON_COMMON],
        'command': None,
    },
    {
        'file': 'ob-tank.svg', 'tag': 'obc-automation-tank', 'size': (184, 224), 'anchor': (86, 22),
        'title': 'OpenBridge Tank',
        'props': [('_pn_level', '50', 'value', 'num', 'Level (same unit as max)'),
                  ('_pn_max', '100', 'max', 'num', 'Maximum level'),
                  ('_ps_trend', "'stable'", 'trend', 'str', 'fast-rising | rising | stable | falling | fast-falling'),
                  ('_ps_medium', "'water'", 'medium', 'str', 'water | air | normal | empty'),
                  ('_ps_tag', "'T-101'", 'tag', 'str', 'Tank tag label')],
        'command': None,
    },
    {
        'file': 'ob-readout.svg', 'tag': 'obc-automation-readout', 'size': (120, 52), 'anchor': (41, 2),
        'title': 'OpenBridge Readout',
        'props': [('_pn_value', '0', 'value', 'num', 'Process value'),
                  ('_ps_unit', "'m3/h'", 'unit', 'str', 'Engineering unit'),
                  ('_pn_digits', '3', 'numberOfDigits', 'num', 'Number of digits')],
        'command': None,
    },
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
{click}
apply();
'''


def build(w):
    width, height = w['size']
    ax, ay = w['anchor']
    props = list(w['props'])
    if w.get('command'):
        props.append((w['command'][0], 'false', None, 'bool', w['command'][1]))

    exports = '\n'.join(f'let {name} = {default};' for name, default, *_ in props)

    apply_lines = []
    for name, _, attr, kind, _ in props:
        if not attr:
            continue
        if kind == 'bool':
            apply_lines.append(f'    el.{attr} = toBool({name});')
        elif kind == 'num':
            apply_lines.append(f'    el.{attr} = toNum({name});')
        else:
            apply_lines.append(f'    el.{attr} = String({name});')
    if any(p[0] == '_ps_tag' for p in props) and w['tag'] != 'obc-automation-tank':
        apply_lines.append('    el.hasIdTag = String(_ps_tag).length > 0;')

    put_lines = []
    for name, _, _, kind, _ in props:
        conv = {'bool': 'toBool(value)', 'num': 'toNum(value)', 'str': 'String(value)'}[kind]
        put_lines.append(f"    if (id === '{name}') {{ {name} = {conv}; }}")

    click = ''
    if w.get('command'):
        cmd, state = w['command'][0], w['state']
        click = f'''
function onClick() {{
    {cmd} = !toBool({state});
    postValue('{cmd}', {cmd} ? 1 : 0);
}}

(function () {{
    var el = document.getElementById('ob_el');
    if (el) {{ el.addEventListener('click', onClick); }}
}})();
'''

    script = SCRIPT.format(exports=exports, apply='\n'.join(apply_lines),
                           put='\n'.join(put_lines), click=click)

    doc_lines = [f'{w["title"]} (OpenBridge {w["tag"]}, Apache-2.0).', 'Bindable properties:']
    for name, default, _, _, desc in props:
        doc_lines.append(f'  {name} (default {default}): {desc}')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <desc>{escape(chr(10).join(doc_lines))}</desc>
  <rect id="ob_bg" x="0" y="0" width="{width}" height="{height}" fill="none" />
  <foreignObject id="ob_fo" x="0" y="0" width="{width}" height="{height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:100%;height:100%;overflow:visible;">
      <{w["tag"]} id="ob_el" style="position:absolute;left:{ax}px;top:{ay}px;"></{w["tag"]}>
    </div>
  </foreignObject>
  <script type="text/javascript"><![CDATA[{script}]]></script>
</svg>
'''


def main():
    os.makedirs(OUT, exist_ok=True)
    for w in WIDGETS:
        path = os.path.join(OUT, w['file'])
        with open(path, 'w', encoding='utf-8') as f:
            f.write(build(w))
        print('written', os.path.normpath(path))


if __name__ == '__main__':
    main()
