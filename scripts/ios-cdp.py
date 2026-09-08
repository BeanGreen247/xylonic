#!/usr/bin/env python3
"""Minimal Chrome-DevTools-Protocol client for the pymobiledevice3 webinspector
CDP server (started by scripts/ios-debug.sh).

  ios-cdp.py targets                 list inspectable WebView pages
  ios-cdp.py eval '<js expression>'  Runtime.evaluate (awaits promises), prints JSON
  ios-cdp.py listen  [seconds]       stream console + exceptions
  ios-cdp.py listen-net [seconds]    also stream network requests

Env: XYLONIC_CDP_PORT (default 9222), XYLONIC_CDP_URL_MATCH (default
"capacitor://localhost" — the Xylonic WebView).

Needs the `websocket-client` package (`pip install websocket-client`).
"""
import json
import os
import sys
import time
import urllib.request

PORT = os.environ.get("XYLONIC_CDP_PORT", "9222")
URL_MATCH = os.environ.get("XYLONIC_CDP_URL_MATCH", "capacitor://localhost")
BASE = f"http://127.0.0.1:{PORT}"

try:
    from websocket import create_connection
except ImportError:
    sys.exit("ios-cdp: missing dependency — pip install websocket-client")


def targets():
    with urllib.request.urlopen(f"{BASE}/json", timeout=5) as r:
        return json.load(r)


def pick_ws():
    ts = targets()
    for t in ts:
        if URL_MATCH in (t.get("url") or ""):
            return t["webSocketDebuggerUrl"]
    if ts:
        return ts[0]["webSocketDebuggerUrl"]
    sys.exit(f"ios-cdp: no inspectable pages at {BASE}/json — is Xylonic foregrounded?")


class CDP:
    def __init__(self):
        self.ws = create_connection(pick_ws(), max_size=32_000_000)
        self.i = 0

    def send(self, method, params=None):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params or {}}))
        return self.i

    def wait(self, mid, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            self.ws.settimeout(max(0.1, end - time.time()))
            try:
                m = json.loads(self.ws.recv())
            except Exception:
                break
            if m.get("id") == mid:
                return m
        return None

    def evaluate(self, expr):
        self.wait(self.send("Runtime.enable"), 5)
        mid = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True,
            "allowUnsafeEvalBlockedByCSP": True, "userGesture": True,
        })
        return self.wait(mid, 45)

    def stream(self, seconds, network=False):
        for m in ("Runtime.enable", "Console.enable", "Log.enable"):
            self.wait(self.send(m), 3)
        if network:
            self.wait(self.send("Network.enable"), 3)
        end = time.time() + seconds
        while time.time() < end:
            self.ws.settimeout(max(0.1, end - time.time()))
            try:
                msg = json.loads(self.ws.recv())
            except Exception:
                continue
            method, p = msg.get("method"), msg.get("params", {})
            if method == "Runtime.consoleAPICalled":
                args = " ".join(_s(a) for a in p.get("args", []))
                print(f"[console.{p.get('type')}] {args}", flush=True)
            elif method == "Log.entryAdded":
                e = p.get("entry", {})
                print(f"[log.{e.get('level')}] {e.get('text')}", flush=True)
            elif method == "Runtime.exceptionThrown":
                d = p.get("exceptionDetails", {})
                ex = d.get("exception", {})
                print(f"[exception] {d.get('text','')} {ex.get('description', ex.get('value',''))}", flush=True)
            elif method == "Network.requestWillBeSent":
                print(f"[net >] {p.get('request',{}).get('method')} {p.get('request',{}).get('url','')[:200]}", flush=True)
            elif method == "Network.responseReceived":
                r = p.get("response", {})
                print(f"[net <] {r.get('status')} {r.get('url','')[:200]}", flush=True)
            elif method == "Network.loadingFailed":
                print(f"[net x] {p.get('errorText')}", flush=True)


def _s(a):
    if "value" in a:
        return a["value"] if isinstance(a["value"], str) else json.dumps(a["value"])
    return a.get("description", str(a.get("type")))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "targets"
    if cmd == "targets":
        for t in targets():
            print(f"{t.get('title','?'):40.40}  {t.get('url','')}")
    elif cmd == "eval":
        r = CDP().evaluate(sys.argv[2])
        res = (r or {}).get("result", {})
        if res.get("exceptionDetails"):
            print(json.dumps(res["exceptionDetails"], indent=2)); sys.exit(1)
        print(json.dumps(res.get("result", {}).get("value", res), indent=2, ensure_ascii=False))
    elif cmd == "listen":
        CDP().stream(int(sys.argv[2]) if len(sys.argv) > 2 else 120)
    elif cmd == "listen-net":
        CDP().stream(int(sys.argv[2]) if len(sys.argv) > 2 else 120, network=True)
    else:
        sys.exit(__doc__)
