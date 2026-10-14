<p align="center">
  <img src="docs/brand/scadacraft-logo.png" alt="ScadaCraft" width="320">
</p>

# ScadaCraft

Web-based SCADA/HMI platform for industrial automation, with AI-assisted page building.

ScadaCraft is a fork of [FUXA](https://github.com/frangoteam/FUXA) by frangoteam, extended with:

- **OpenBridge process graphics** — pumps, valves, tanks, readouts and pipes from the OpenBridge design system, on a 24 px P&ID grid ([guide](docs/openbridge.md), [widget reference](docs/openbridge-widgets.md))
- **HTML widgets with custom properties** — import custom HTML pages (AVEVA-style custom properties) and bind them to tags *(planned)*
- **MCP server** — an AI assistant builds P&ID pages, binds tags and reads live values ([mcp/](mcp/README.md))

## Drivers

Modbus RTU/TCP, Siemens S7, OPC UA, MQTT, BACnet, EtherNet/IP, Omron, Melsec, ADS, ODBC, Redis, HTTP and more (inherited from FUXA).

## Quick start

```bash
# server
cd server && npm install && npm start
# client (dev)
cd client && npm install && npm start
```

Docker:

```bash
docker compose up --build
```

Then open `http://localhost:1881`.

## Credits and license

ScadaCraft is based on FUXA, Copyright (c) 2019-2025 frangoteam, released under the MIT License.
The original license is kept in [LICENSE](LICENSE); see [NOTICE](NOTICE) and the original
FUXA documentation in [docs/FUXA-README.md](docs/FUXA-README.md).

"FUXA" is the name of the upstream project; ScadaCraft is not affiliated with or endorsed by frangoteam.
