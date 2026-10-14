# tools/openbridge

Build tooling for the OpenBridge integration. Usage guide: [docs/openbridge.md](../../docs/openbridge.md).
Widget reference (generated): [docs/openbridge-widgets.md](../../docs/openbridge-widgets.md).

| File | Purpose |
| --- | --- |
| `entry.js` | OpenBridge components included in the bundle |
| `build-bundle.sh` | Builds `client/src/assets/lib/openbridge/openbridge-automation.min.js` (`OB_VERSION`, default 1.0.0) |
| `make-widgets.py` | Generates `server/_widgets/openbridge/*.svg`, `widgets.json` and `docs/openbridge-widgets.md` |

Check the OpenBridge license change date before changing `OB_VERSION` (see the guide, §2).
