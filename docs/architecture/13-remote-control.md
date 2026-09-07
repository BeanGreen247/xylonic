# Remote Control Architecture

Xylonic devices on the same LAN can discover and control each other using a two-layer protocol:

### Transport Layers

| Layer | Protocol | Port | Purpose |
|-------|----------|------|---------|
| **Discovery** | UDP multicast | 7766 | Devices announce presence; peers listen for `XYLONIC_HELLO` datagrams |
| **Commands** | HTTP/TCP | 7767 | Controller sends JSON commands; target responds with result |

### Multicast Group

Presence broadcasts are sent to multicast group `239.255.85.89` (Android API 12+ requirement). On Electron, the main process joins this group on every non-loopback IPv4 interface so that broadcasts from any LAN adapter are received.

### Device Roles

| Role | Behaviour |
|------|-----------|
| **Target ("Be Controlled")** | Runs HTTP server on port 7767; broadcasts `XYLONIC_HELLO` datagrams so controllers can find it |
| **Controller ("Control Others")** | Listens for `XYLONIC_HELLO` datagrams; sends `pair`, `play`, `pause`, `next`, `prev` etc. to target's HTTP server |

A single device may be a target only, a controller only, or neither — toggled independently via the "Be Controlled" and "Control Others" switches.

### Electron IPC for Remote Mode

```
Renderer (remoteDiscoveryService.ts)
  │
  ├─ remote-get-device-id / remote-get-device-name  ← sync identity from main at startup
  ├─ remote-get-devices                             ← snapshot of devices found before renderer loaded
  ├─ remote-set-control-enabled                     ← start/stop target broadcast + HTTP server
  ├─ remote-set-controller-target                   ← lock controller onto a specific device ID
  └─ remote-send-command { host, port, action, data, controllerId }
              │
  Main process (electron.js)
  ├─ UDP socket (port 7766)  ← multicast listener on all interfaces
  ├─ UDP socket              ← broadcaster (XYLONIC_HELLO datagrams)
  └─ HTTP server (port 7767) ← command receiver; emits 'remote-command' IPC to renderer
```

### Command Payload Format

All commands travel as a JSON body over TCP:

```json
{
  "action": "pair",
  "data": { "controllerName": "myhostname,Linux", "controllerId": "<uuid>" },
  "controllerId": "<uuid>"
}
```

`data` must always be a JSON **object** (never a string). Android's `RemoteDiscoveryPlugin` calls `cmd.getJSONObject("data")` and throws `JSONException` on a string value.

### Device Name Convention

Every device advertises its identity as `hostname,OSType` — for example `mypc,Linux`, `DESKTOP-ABC,Windows`, or `myhostname,macOS`. On Android the name is the device model string extracted from the user-agent. On Electron it is built in the main process from `os.hostname()` and `process.platform`.

---
