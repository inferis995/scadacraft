# scadacraft-mcp-server

MCP server for [ScadaCraft](../README.md). It lets an AI assistant (Claude or any MCP client)
build HMI pages on a running ScadaCraft server: P&ID process graphics with OpenBridge
components, placed on the 24 px grid, bound to tags, and checked against live values.

Pages created through MCP are saved in exactly the same format as the editor, so they open,
run and can be edited by hand like any other page.

## Tools

| Tool | What it does | Writes |
| --- | --- | --- |
| `scadacraft_list_widgets` | OpenBridge widgets with anchor, size and properties; explains the placement model | — |
| `scadacraft_list_views` | Pages of the project | — |
| `scadacraft_get_view` | Items on a page: id, widget, anchor node, bindings | — |
| `scadacraft_create_view` | New empty page | project |
| `scadacraft_place_widgets` | Place widgets by grid node, with properties and tag bindings (batch) | project |
| `scadacraft_draw_pipe` | Pipe along a path of nodes: straight runs plus elbows at bends | project |
| `scadacraft_set_properties` | Change fixed values or tag bindings of a placed widget | project |
| `scadacraft_remove_items` | Remove items from a page | project |
| `scadacraft_delete_view` | Delete a page | project |
| `scadacraft_list_tags` | Tags of all devices, with the `Device.Tag` reference used for bindings | — |
| `scadacraft_create_server_tags` | Memory tags on the ScadaCraft server device (simulation, setpoints) | project |
| `scadacraft_read_tags` | Live tag values | — |
| `scadacraft_write_tags` | Write tag values — **reaches field devices** | plant |

Resources: `scadacraft://docs/openbridge` (design and usage guide) and
`scadacraft://docs/openbridge-widgets` (widget reference).

## Placement model in one paragraph

The page is a 24 px grid; every pipe connection is a node `(x, y)` = pixel `(x × 24, y × 24)`.
Each widget is placed by putting its **anchor** on a node: pumps, motors, fans and valves by
the centre of the icon, the tank by the top-centre of its body, pipes by the start of their
axis, fittings by their centre. A pipe that reaches a device stops one node before the
device's anchor and the next pipe starts one node after it. Details: [docs/openbridge.md](../docs/openbridge.md).

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
TRANSPORT=http PORT=3001 SCADACRAFT_URL=http://plc-hmi:1881 node dist/index.js
```

The HTTP endpoint has no authentication of its own. Keep it on `127.0.0.1` or behind a
reverse proxy with authentication; anyone who can reach it can edit pages and write tags.

## Example

> Create a page "Sollevamento Cariati" with tank T-101 (wastewater) feeding pump P-101 and
> control valve FCV-201, flow readout on the outlet. Bind the pump to `PLC1.P101_Run` and
> `PLC1.P101_Cmd`.

The assistant calls `scadacraft_list_widgets`, `scadacraft_list_tags`,
`scadacraft_create_view`, `scadacraft_place_widgets` and `scadacraft_draw_pipe`, then
`scadacraft_get_view` to check the layout.

## Notes

- If the editor is open on a page changed through MCP, reload the editor to see the change.
- `scadacraft_write_tags` writes to real equipment for device tags. Server memory tags
  (`FUXA Server.*`) are safe for tests and simulation.
- Tag references accept `Device.Tag`, a unique tag name, or a tag id.

## Tests

```bash
npm test
```

- `test/parity.mjs` checks that the widget script processing matches the editor's code
  (`client/src/app/_helpers/svg-utils.ts`) for every OpenBridge widget.
- `test/e2e.mjs` runs the server over stdio against a running ScadaCraft
  (`SCADACRAFT_URL`), creates server tags and a page "MCP e2e" with a tank, pump, valve,
  readout and pipes, reads and writes tag values. Skipped when ScadaCraft is not reachable.
  `E2E_CLEANUP=1` deletes the page afterwards.
