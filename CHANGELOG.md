# Changelog

All notable changes to ScadaCraft. Versions of the MCP server are in brackets.

## Unreleased

### Added
- `tools/promo/record-video.mjs`: presentation video recorded from the real screens.
- Widget property panel: readable label, description and direction (read / command / read-write)
  next to every variable; OpenBridge widgets carry the metadata, custom widgets can use trailing
  comments (see docs/HowTo-Widgets.md).
- MCP `scadacraft_draw_shapes`: cards, titles, labels and separators as plain editor shapes, with
  colours that follow the OpenBridge palette; example `mcp/examples/stazione-pompaggio.mjs`
  (pumping-station page, simulated plant, alarms, trend page).
- OpenBridge status indicator: boolean tags with an "on" state (running, active, alarm);
  mode selector with 2 or 3 options.
- OpenBridge palettes: day / dusk / night / bright chosen in the layout (editor and MCP
  `openbridge_theme`), page backgrounds follow the palette through the MCP.
- Noto Sans font for OpenBridge components (they fell back to a serif font).
- Alarm colours from the OpenBridge alert palette; alarm status system tags (active,
  unacknowledged, per level) kept by the server, for the OpenBridge alert widgets.
- MCP server [0.5.0]: import native SVG widgets into the editor library, place imported widgets
  with bindings, trend charts on pages (realtime or history), one-step trend pages with menu entry.
- OpenBridge widget libraries: 49 widgets in five editor groups (automation P&ID, instruments,
  charts, controls, alerts); library titles and order from `group.json`.
- MCP server [0.4.0]: widget libraries, resizable widgets (size in cells), read/write controls.
- Scheduled backups of project, settings and history database, restore on restart; MCP [0.3.0]
  covers layout, menu, logo and colours, settings, users and roles, scripts, notifications,
  languages, charts, reports, API keys, logs and backups.
- MCP server [0.2.0]: devices and tags for every driver, alarms, live and historical data,
  project export and import (merge or replace).
- OpenBridge P&ID: 24 px grid with snapping, anchor model, stretching pipes, library previews.
- CI: MCP build and parity, end-to-end tests against a running ScadaCraft; Docker image on GHCR.

### Changed
- Rebranded from FUXA 1.3.5 to ScadaCraft (logo, UI strings, docs site, packages).

### Fixed
- The OpenBridge alert frame no longer takes clicks meant for the equipment under it.
- Widget uploads go to the folder the widget library is served from (also with `--userDir`).
- Reports no longer fail when the chart renderer is missing.
- OpenBridge clock and live charts stop their timers when the widget leaves the page.
