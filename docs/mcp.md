# AI assistant (MCP server)

ScadaCraft ships an [MCP](https://modelcontextprotocol.io) server, `scadacraft-mcp-server`, in the
[`mcp/`](https://github.com/inferis995/scadacraft/tree/main/mcp) folder. It lets Claude or any MCP
client do through conversation what the editor and the settings do through the UI:

- **Pages:** OpenBridge widgets on the 24 px P&ID grid, pipes, instruments, charts, controls, alerts,
  imported SVG widgets, trend charts and trend pages, all bound to tags.
- **Devices and tags:** Modbus TCP/RTU, Siemens S7, OPC UA, MQTT and the other drivers; scaling, history, deadband.
- **Alarms and data:** alarm definitions, active alarms, acknowledge, history; live read/write, tag history with CSV export.
- **Project:** summary, export, import (merge or replace).
- **Application:** layout (menu, header, logo, colours), settings and history database, users and roles,
  scripts, notifications, languages, reports, API keys, logs, scheduled backups and restore.

Installation, configuration, the full list of tools and the safety notes are in the
[MCP server README](https://github.com/inferis995/scadacraft/blob/main/mcp/README.md).
To create your own widgets for the library, see [Widgets](HowTo-Widgets.md).
