# OpenBridge integration

ScadaCraft ships a subset of the [OpenBridge web components](https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents)
(automation components) and exposes them as editor widgets.

## Files

| Path | What |
| --- | --- |
| `client/src/assets/lib/openbridge/` | Slim bundle (`openbridge-automation.min.js`), theme CSS, license and version |
| `client/src/index.html` | Loads the bundle and sets the theme (`data-obc-theme="day"`; also `dusk`, `night`, `bright`) |
| `server/_widgets/openbridge/*.svg` | Widgets listed in the editor library, group "openbridge" |
| `tools/openbridge/entry.js` | Components included in the bundle |
| `tools/openbridge/build-bundle.sh` | Rebuilds the bundle (`OB_VERSION=1.0.0` by default) |
| `tools/openbridge/make-widgets.py` | Regenerates the widget SVGs |

## Licensing

OpenBridge releases are AGPL-3.0-only for 180 days after publication, then also Apache-2.0.
ScadaCraft uses **1.0.0** (published 2026-04-16 as Apache-2.0, past its change date).
Before bumping `OB_VERSION`, check that the new version is past its 180-day change date,
or that a commercial license is in place.

## Widgets

| Widget | Component | Bindable properties |
| --- | --- | --- |
| `ob-pump` / `ob-motor` / `ob-fan` | `obc-pump`, `obc-motor`, `obc-fan` | `_pb_running`, `_pb_alarm`, `_pb_auto`, `_pb_vertical`, `_ps_tag`, `_pb_command` (write) |
| `ob-valve-digital` | `obc-digital-valve` | `_pb_open`, `_pb_alarm`, `_pb_auto`, `_pb_vertical`, `_ps_tag`, `_pb_command` (write) |
| `ob-valve-analog` | `obc-analog-valve` | `_pn_position`, `_pb_open`, `_pb_alarm`, `_pb_auto`, `_pb_vertical`, `_ps_tag` |
| `ob-tank` | `obc-automation-tank` | `_pn_level`, `_pn_max`, `_ps_trend`, `_ps_medium`, `_ps_tag` |
| `ob-readout` | `obc-automation-readout` | `_pn_value`, `_ps_unit`, `_pn_digits` |

Notes:

- Clicking a pump/motor/fan/on-off valve writes `!state` (1/0) to the tag bound to `_pb_command`.
- In OpenBridge 1.0.0 the button `tag` is numeric (shown as `#NNNN`); the tank `tag` is free text.
- OpenBridge components draw around their anchor point, so each widget positions the element at a
  measured offset (`anchor` in `make-widgets.py`). Re-measure if you change OpenBridge version.
