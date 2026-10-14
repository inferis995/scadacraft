# OpenBridge in ScadaCraft — design and usage guide

ScadaCraft uses the [OpenBridge](https://www.openbridge.no) design system for process
graphics: pumps, valves, tanks, readouts and pipes drawn to a common industrial HMI standard.
This guide explains how the components are placed, connected, bound to tags and themed.
The full list of widgets and properties is in the generated
[widget reference](openbridge-widgets.md).

## 1. What is included

| Item | Location |
| --- | --- |
| OpenBridge web components, automation subset (version in `VERSION`) | `client/src/assets/lib/openbridge/` |
| ScadaCraft fixes on top of OpenBridge | `client/src/assets/lib/openbridge/scadacraft-openbridge.css` |
| Editor widgets (library group **openbridge**) | `server/_widgets/openbridge/*.svg` |
| Machine-readable catalog (used by tooling and the MCP server) | `server/_widgets/openbridge/widgets.json` |
| Build and generation tools | `tools/openbridge/` |

**Components:** pump, motor, fan, on/off valve, control valve, tank, readout; horizontal and
vertical pipe, elbow, tee, cross (junction), crossover (no junction), pipe end, flow arrow.

## 2. Licensing

OpenBridge publishes each release under **AGPL-3.0-only for 180 days**, after which that
release is also available under **Apache-2.0**. A commercial license is available to members
of the OpenBridge Joint Industry Project.

ScadaCraft ships **OpenBridge 1.0.0**, published as Apache-2.0 on 2026-04-16 and past its
change date. Do not bump the version unless the new release is past its change date or a
commercial license is in place. The license text and notice are in
`client/src/assets/lib/openbridge/`.

## 3. The placement model

OpenBridge defines a *P&ID anchor point model*. ScadaCraft follows it exactly.

### 3.1 Grid

The canvas uses a **24 px grid**. Every point where a pipe connects to something is a
**grid node** `(x, y)` at pixel `(x × 24, y × 24)`.

In the editor, the **grid button** switches on the P&ID grid: cells of 24 px, a major line
every 4 cells, and snapping on 24 px (also applied when a widget is dropped on the canvas).
The keyboard move step can also be set to 24.

![Editor with the P&ID grid](images/openbridge-editor.png)

### 3.2 Anchors

Each component has an anchor: the point that must sit on a grid node.

| Component | Anchor |
| --- | --- |
| Pump, motor, fan, on/off valve, control valve | Centre of the icon |
| Tank | Top-centre of the tank body |
| Readout | End of the connection tick |
| Horizontal / vertical pipe, flow arrow | Start of the pipe axis (left end / top end) |
| Elbow, tee, cross, crossover, pipe end | Centre of the fitting |

Every widget box is a multiple of 24 px, and its anchor lies at a multiple of 24 px inside the
box. So **a widget whose box is snapped to the grid always has its anchor on a node.**

To place a widget with its anchor on node `(x, y)`:

```
left = x × 24 − anchor.x
top  = y × 24 − anchor.y
```

The anchor of every widget is listed in the [reference](openbridge-widgets.md) and in
`widgets.json`.

### 3.3 Sizes

- Devices (pump, motor, fan, valves) have an icon of **one cell radius**: the icon covers
  the node and half of each neighbouring cell. Readouts, badges and the ID tag are drawn
  around it inside the 120 × 120 box.
- The tank body is 168 px wide (7 cells), centred on its anchor.
- Straight pipes are `length × 24` px long. Elbows, tees and crosses have arms of half a cell.

## 4. Composing a P&ID

### 4.1 Rules

1. Put each device on a node.
2. Run pipes along grid lines only, from node to node.
3. A straight pipe that ends at a device stops **one node before** the device's anchor; the
   next pipe starts **one node after** it. The device icon fills the gap.
4. Change direction with an **elbow** placed on the turning node.
5. Join three or four pipes with a **tee** or **cross**. Where two pipes pass over each other
   without connecting, use a **crossover**.
6. Use a **flow arrow** (one cell) on straight runs to show the direction of flow.
7. Terminate open lines with a **pipe end**.
8. Put a **readout** on a pipe: anchor on the pipe node, `_ps_position` = side where the
   value is shown (`top` puts it above the pipe, with the tick pointing down to it).

### 4.2 Example

A tank feeding a pump, a control valve and a discharge line (nodes in grid units):

![P&ID example](images/openbridge-pid-example.png)

| Item | Widget | Anchor node | Settings |
| --- | --- | --- | --- |
| Tank T-101 | `ob-tank` | (4, 5) | fluid `waste` |
| Riser from the tank top | `ob-line-vertical` | (4, 3) | length 2 (box height 48) |
| Elbow | `ob-line-elbow` | (4, 3) | direction `bottom-right` |
| Suction line | `ob-line-horizontal` | (4, 3) | length 4 → ends at (8, 3) |
| Pump P-101 | `ob-pump` | (9, 3) | |
| Discharge line | `ob-line-horizontal` | (10, 3) | length 3 → ends at (13, 3) |
| Flow arrow | `ob-line-flow` | (11, 3) | |
| Control valve FCV-501 | `ob-valve-analog` | (14, 3) | |
| Outlet line | `ob-line-horizontal` | (15, 3) | length 4 |
| Line end | `ob-line-end` | (19, 3) | direction `right` |
| Flow readout | `ob-readout` | (17, 3) | position `top`, unit `m3/h` |

### 4.3 Stretching pipes

Straight pipes follow their widget size: resizing a horizontal pipe in the editor changes
its length in whole cells (`round(width / 24)`), it does not scale the drawing. Keep pipe
boxes at multiples of 24 px. Other widgets have a fixed size and should not be resized.

## 5. Binding to tags

Widget properties appear in the property panel. Bind each one to a tag, or leave it unbound
and set a fixed value.

| Prefix | Type | Tag value accepted |
| --- | --- | --- |
| `_pb_` | boolean | `true/false`, `1/0`, `"on"` |
| `_pn_` | number | any number or numeric string |
| `_ps_` | string | text |

**Commands.** Pumps, motors, fans and on/off valves have a `_pb_command` property. Clicking
the symbol writes `1` (start/open) or `0` (stop/close) to the bound tag, computed as the
opposite of the current feedback (`_pb_running` or `_pb_open`). The symbol only changes
when the feedback tag changes, so the operator always sees the real state of the equipment.

**Typical binding for a pump:**

| Property | Tag example |
| --- | --- |
| `_pb_running` | `P101.RunFeedback` |
| `_pb_command` | `P101.StartStopCmd` |
| `_pb_alarm` | `P101.Fault` |
| `_pb_auto` | `P101.AutoMode` |
| `_pn_speed` | `P101.SpeedPct` |
| `_ps_tag` | fixed `101` |

## 6. Fluids, media and line types

- **Pipe medium** (`_ps_medium`): `normal`, `water`, `air`, `empty`. `empty` draws a hollow
  pipe, useful for lines out of service.
- **Fluid colour** (`_ps_fluid`): colour from the OpenBridge medium palette, for tanks and
  for pipes whose medium is `water` or `air`: `fresh-water`, `sea-water`, `waste`, `masses`,
  `fuel`, `oil`, `steam`, `hot`, `cold`, `air-ventilation`, `acid-alkalis`, `fire-fighting`,
  `flammable-gas`, `non-flammable-gas`. Leave empty for the default colour.
- **Line type** (`_ps_lineType`): `fluid` (process pipe), `electric`, `air` (duct),
  `connector` (signal line).

For water and wastewater plants: `fresh-water` for potable and treated water, `waste` for
raw sewage, `masses` for sludge, `air-ventilation` for blowers and aeration air.

## 7. Themes

OpenBridge has four palettes: `day`, `dusk`, `night` and `bright`. The palette is selected by
the `data-obc-theme` attribute on `<html>` (default `day`, set in `client/src/index.html`).
Use `night` in control rooms with low lighting.

## 8. Known limitations of OpenBridge 1.0.0

| Limitation | ScadaCraft handling |
| --- | --- |
| Device ID tag is numeric only (shown as `#NNNN`) | `_ps_tag` takes a number; tank labels are free text |
| Pipes read `--automation-fresh-water`, which the palette does not define (also in 2.x) | Defined in `scadacraft-openbridge.css` from the palette's fresh-water colours |
| Tank ignores `medium` and always uses the fuel colour | Widget sets the fill from `_ps_fluid` |
| Badges are booleans (`badgeAuto`, …); 2.x uses enums | Widgets expose booleans |

## 9. Editor library previews

The editor shows library items as images, where scripts and web components do not run.
Each widget therefore embeds a static preview rendered from the real component
(`tools/openbridge/make-previews.mjs`). The preview is removed as soon as the widget runs on
a page.

## 10. Maintenance

```bash
cd tools/openbridge && npm install        # once: esbuild + playwright

# rebuild the OpenBridge bundle (components listed in entry.js)
npm run bundle

# regenerate widgets, library previews, widgets.json and docs/openbridge-widgets.md
npm run widgets
```

When upgrading OpenBridge: check the license change date, rebuild the bundle, re-measure
the anchors (component offsets may change between versions), regenerate the widgets and
re-run the visual check. Rebuild the client afterwards (`client/dist` is versioned).

## 11. For the MCP server and other tools

`server/_widgets/openbridge/widgets.json` describes every widget: file, OpenBridge element,
box size, anchor, stretch axis and properties (name, type, default, read/write). A tool that
places a widget on node `(x, y)` computes the position with the formula in §3.2, sets the
box size (stretch widgets: `cells × 24` on the stretch axis) and binds properties by name.
