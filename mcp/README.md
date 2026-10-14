# scadacraft-mcp-server

MCP server for [ScadaCraft](../README.md). It gives an AI assistant (Claude or any MCP client)
the whole project of a running ScadaCraft server: devices and tags, alarms, pages with
OpenBridge process graphics, live and historical data, export and import.

Everything is written in the same format as the ScadaCraft editor, so devices, alarms and
pages created through MCP appear, run and can be edited by hand like any other.

## Tools (33)

**Project**

| Tool | What it does |
| --- | --- |
| `scadacraft_get_project_summary` | Views, devices, tags, alarms, scripts at a glance |
| `scadacraft_export_project` | Save the project to a JSON file (same as "Save Project As") |
| `scadacraft_import_project` | Merge selected views/devices/alarms from a file, or replace the whole project (backup first) |

**Devices and tags**

| Tool | What it does |
| --- | --- |
| `scadacraft_list_devices` | Devices with connection settings, tag count and live connection status |
| `scadacraft_create_device` | Modbus TCP/RTU, Siemens S7, OPC UA, MQTT, BACnet, EtherNet/IP, … |
| `scadacraft_update_device` | Enable/disable, rename, polling, connection settings |
| `scadacraft_delete_device` | Delete, listing views/alarms that used its tags |
| `scadacraft_list_tags` | Tags of all devices with their `Device.Tag` reference |
| `scadacraft_add_tags` | Tags with driver addresses (`40001`, `DB1,REAL0`, OPC UA node ids, MQTT topics), scaling, history; server memory tags |
| `scadacraft_update_tags` | Rename, address, type, scaling, decimals, history logging, deadband |
| `scadacraft_delete_tags` | Delete, listing remaining references |
| `scadacraft_list_drivers` | Optional driver packages and whether they are installed |
| `scadacraft_install_driver` | Install a driver on the ScadaCraft server |

**Data**

| Tool | What it does |
| --- | --- |
| `scadacraft_read_tags` | Live values |
| `scadacraft_write_tags` | Write values — **reaches field devices** |
| `scadacraft_get_history` | History with min/max/avg, optional points and CSV file |

**Alarms**

| Tool | What it does |
| --- | --- |
| `scadacraft_list_alarms` | Alarm definitions |
| `scadacraft_set_alarm` | Create or replace an alarm: highhigh/high/low/info levels with `above`/`below`/range, text, group, delay, ack mode |
| `scadacraft_delete_alarm` | Delete a definition |
| `scadacraft_get_active_alarms` | Active and unacknowledged alarms |
| `scadacraft_ack_alarms` | Acknowledge one alarm or all |
| `scadacraft_get_alarm_history` | Alarm events in a time range |

**Pages**

| Tool | What it does |
| --- | --- |
| `scadacraft_list_widgets` | OpenBridge widgets, anchors, properties; explains the placement model |
| `scadacraft_list_views`, `scadacraft_get_view` | Pages and their items |
| `scadacraft_create_view`, `scadacraft_update_view`, `scadacraft_duplicate_view`, `scadacraft_delete_view` | Page management |
| `scadacraft_place_widgets` | Widgets by grid node, with properties and tag bindings |
| `scadacraft_draw_pipe` | Pipe along a path of nodes, elbows at bends |
| `scadacraft_set_properties` | Change values or bindings of a placed widget |
| `scadacraft_remove_items` | Remove items from a page |

Resources: `scadacraft://docs/openbridge` (design and usage guide) and
`scadacraft://docs/openbridge-widgets` (widget reference).

Times accept ISO 8601, epoch ms, or relative values such as `-15m`, `-24h`, `-7d`.

## Typical session

> Add a Modbus TCP PLC at 192.168.1.10 (unit 1) with the tank level in 40001 (Float32),
> pump running on coil 1 and start/stop on coil 2. Log the level. Alarm above 90 % and
> below 10 %. Then draw a page with the tank and the pump.

The assistant uses: `create_device` → `add_tags` → `update_device {enabled: true}` →
`read_tags` (checks communication) → `set_alarm` → `create_view` → `place_widgets` /
`draw_pipe` → `get_view`.

## Install and build

```bash
cd mcp
npm install
npm run build
```

Requires Node.js 20 or later and a running ScadaCraft server.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCADACRAFT_URL` | `http://127.0.0.1:1881` | ScadaCraft server |
| `SCADACRAFT_USERNAME`, `SCADACRAFT_PASSWORD` | — | Admin user, only if ScadaCraft security is enabled |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `HOST`, `PORT` | `127.0.0.1`, `3001` | Listen address for `TRANSPORT=http` (endpoint `/mcp`) |

### Claude Code

```bash
claude mcp add scadacraft --env SCADACRAFT_URL=http://127.0.0.1:1881 -- node /path/to/scadacraft/mcp/dist/index.js
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scadacraft": {
      "command": "node",
      "args": ["/path/to/scadacraft/mcp/dist/index.js"],
      "env": { "SCADACRAFT_URL": "http://127.0.0.1:1881" }
    }
  }
}
```

### HTTP transport

```bash
TRANSPORT=http PORT=3001 SCADACRAFT_URL=http://hmi-server:1881 node dist/index.js
```

The HTTP endpoint has no authentication of its own. Keep it on `127.0.0.1` or behind a
reverse proxy with authentication: anyone who reaches it can change the project and write
tags.

## Safety

- `scadacraft_write_tags` and enabling a device act on real equipment. Server memory tags
  (`FUXA Server.*`) are safe for tests and simulation.
- `scadacraft_import_project` with `mode: "replace"` replaces the whole project; a backup of
  the current project is written first.
- Delete tools report the pages and alarms that still reference removed tags.
- Device passwords (OPC UA, MQTT) are stored as device security on the server, not in the
  project file, and are masked in tool results.
- Files (export, import, CSV) are read and written on the machine running the MCP server.

## Notes

- If the editor is open while the project is changed through MCP, reload the editor.
- Tag references accept `Device.Tag`, a unique tag name, or a tag id.
- Optional drivers (Modbus, S7, OPC UA, …) must be installed on the ScadaCraft server;
  `scadacraft_create_device` warns when the driver is missing and `scadacraft_install_driver`
  installs it.
- An acknowledged alarm shows as acknowledged at the next alarm check (about 1 s).

## Tests

```bash
npm test
```

- `test/parity.mjs`: widget script processing matches the editor's code for every widget.
- `test/e2e.mjs`: page building with server memory tags (tank, pump, valve, readout, pipes).
- `test/e2e-plant.mjs`: full plant against a simulated Modbus TCP PLC (`test/modbus-sim.mjs`):
  driver install, device, tags with scaling and history, live read, write to the PLC,
  connection status, alarm raise/acknowledge/history, tag history with CSV, page bound to
  the PLC, view update/duplicate, export, merge import and full replace.

The end-to-end tests need a running ScadaCraft (`SCADACRAFT_URL`) and skip otherwise.
`E2E_CLEANUP=1` removes what they create.
