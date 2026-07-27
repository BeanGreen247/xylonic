#!/usr/bin/env bash
# ── Credentials (edit here) ───────────────────────────────────────────────────
SERVER_URL="https://bandcamp.com/api/subsonic"
USERNAME="CCXVP5N4ZU7RMCUYWK5HJDEXATFIX4JI"
PASSWORD="73NXLAA7K3WXEBMRKBF3BRAOTAE5ZP5V"
# ─────────────────────────────────────────────────────────────────────────────

PKG="xylonic.beangreen247xyz.musicplayer"
CDP_PORT=9222

# ── 1. Launch the app ─────────────────────────────────────────────────────────
echo "→ Launching app..."
adb shell am start -n "${PKG}/.MainActivity" > /dev/null
sleep 3

# ── 2. Forward Chrome DevTools Protocol port ──────────────────────────────────
echo "→ Setting up CDP tunnel..."
PID=$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r ')
if [ -z "$PID" ]; then
    echo "✗ App not running (pidof returned empty)" >&2
    exit 1
fi
echo "  App PID: $PID"

# Android System WebView exposes devtools on webview_devtools_remote_<pid>
adb forward "tcp:${CDP_PORT}" "localabstract:webview_devtools_remote_${PID}" > /dev/null 2>&1 \
  || adb forward "tcp:${CDP_PORT}" "localabstract:webview_devtools_remote" > /dev/null 2>&1

# ── 3. Fill form via JavaScript (no pixel coords needed) ─────────────────────
echo "→ Injecting credentials via CDP..."
python3 - <<PYEOF
import json, sys, time
import websocket  # pip: websocket-client

SERVER_URL = """${SERVER_URL}"""
USERNAME   = """${USERNAME}"""
PASSWORD   = """${PASSWORD}"""
CDP_PORT   = ${CDP_PORT}

# ── wait for /json endpoint ───────────────────────────────────────────────────
import urllib.request

def get_ws_url(retries=10):
    for i in range(retries):
        try:
            r = urllib.request.urlopen(f"http://localhost:{CDP_PORT}/json", timeout=3)
            pages = json.loads(r.read())
            if pages:
                return pages[0]["webSocketDebuggerUrl"]
        except Exception:
            pass
        print(f"  Waiting for WebView ({i+1}/{retries})...", flush=True)
        time.sleep(1)
    return None

ws_url = get_ws_url()
if not ws_url:
    print("✗ Could not reach WebView DevTools on port", CDP_PORT, file=sys.stderr)
    print("  Make sure you installed a debug APK (debuggable=true).", file=sys.stderr)
    sys.exit(1)

print(f"  WebView: {ws_url}", flush=True)
ws = websocket.create_connection(ws_url, timeout=10)

_msg_counter = [0]

def evaluate(js_expr):
    _msg_counter[0] += 1
    msg_id = _msg_counter[0]
    ws.send(json.dumps({
        "id": msg_id,
        "method": "Runtime.evaluate",
        "params": {
            "expression": js_expr,
            "returnByValue": True,
            "awaitPromise": False,
        },
    }))
    # Drain incoming messages until we see the reply for our id
    for _ in range(40):
        try:
            raw = ws.recv()
        except websocket.WebSocketTimeoutException:
            return "(recv timeout)"
        msg = json.loads(raw)
        if msg.get("id") != msg_id:
            continue  # skip events / other responses
        result = msg.get("result", {}).get("result", {})
        if result.get("type") == "string":
            return result.get("value", "")
        exc = msg.get("result", {}).get("exceptionDetails")
        if exc:
            return "JS error: " + str(exc.get("text", exc))
        return repr(result)
    return "(no matching response)"

# ── wait for React to render inputs ──────────────────────────────────────────
print("  Waiting for login form...", flush=True)
for attempt in range(12):
    count_str = evaluate("document.querySelectorAll('input').length")
    try:
        if int(count_str) >= 1:
            print(f"  Found {count_str} input(s)", flush=True)
            break
    except ValueError:
        pass
    print(f"  inputs={count_str!r} (attempt {attempt+1}/12)", flush=True)
    time.sleep(0.8)

# ── fill all three fields with React-compatible setter ────────────────────────
print("  Filling form fields...", flush=True)
fill_result = evaluate(r"""
(function() {
    function setReactInput(el, val) {
        // The React synthetic onChange fires only when the native value setter is used.
        var setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value'
        ).set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    var all = Array.from(document.querySelectorAll('input'));

    function byPlaceholder(substr) {
        return all.find(function(i) {
            return (i.placeholder || '').toLowerCase().indexOf(substr.toLowerCase()) !== -1;
        });
    }

    var serverEl = byPlaceholder('192.168') || byPlaceholder('http') || byPlaceholder('server');
    var userEl   = byPlaceholder('username') || byPlaceholder('user');
    var passEl   = byPlaceholder('password') || all.find(function(i) { return i.type === 'password'; });

    var filled = [];
    if (serverEl) { setReactInput(serverEl, SERVER_URL_PH); filled.push('server'); }
    if (userEl)   { setReactInput(userEl,   USERNAME_PH);   filled.push('username'); }
    if (passEl)   { setReactInput(passEl,   PASSWORD_PH);   filled.push('password'); }

    if (!filled.length) {
        return 'NONE filled — inputs: [' + all.map(function(i) {
            return '"' + (i.placeholder || i.type) + '"';
        }).join(', ') + ']';
    }
    return 'filled: ' + filled.join(', ');
})()
""".replace('SERVER_URL_PH', json.dumps(SERVER_URL))
   .replace('USERNAME_PH',   json.dumps(USERNAME))
   .replace('PASSWORD_PH',   json.dumps(PASSWORD)))

print(f"  {fill_result}", flush=True)

if "NONE filled" in fill_result:
    print("✗ Could not find input fields — is the login screen visible?", file=sys.stderr)
    ws.close()
    sys.exit(1)

time.sleep(0.4)

# ── click Test Connection ─────────────────────────────────────────────────────
print("  Clicking Test Connection button...", flush=True)
click_result = evaluate(r"""
(function() {
    var btns = Array.from(document.querySelectorAll('button'));
    var btn = btns.find(function(b) {
        return /test[\s\-_]*connection/i.test(b.textContent);
    });
    if (btn) {
        btn.click();
        return 'clicked: "' + btn.textContent.trim() + '"';
    }
    return 'button not found — available: [' + btns.map(function(b) {
        return '"' + b.textContent.trim().slice(0, 25) + '"';
    }).join(', ') + ']';
})()
""")
print(f"  {click_result}", flush=True)

ws.close()
print("✓ CDP step complete", flush=True)
PYEOF

RC=$?
echo ""
if [ $RC -ne 0 ]; then
    echo "✗ CDP step failed — skipping logcat wait"
else
    # ── 4. Watch logcat for result ────────────────────────────────────────────
    echo "=== Logcat (10 s) ==="
    adb logcat -c 2>/dev/null
    sleep 10
    adb logcat -d --pid="$(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r ')" \
      | grep -i "Console\|CORS\|ERR_\|test.*connection\|connect\|success\|ping\|subsonic\|error\|fail\|exception" \
      | grep -v "XylonicRemote\|isOnWifi\|SyncAdapter\|BluetoothAdapter" \
      | head -40
fi

# ── 5. Direct curl smoke-test from desktop ────────────────────────────────────
SALT="testscript"
TOKEN=$(printf "%s%s" "$PASSWORD" "$SALT" | md5sum | awk '{print $1}')
PING="${SERVER_URL}/rest/ping.view?u=${USERNAME}&t=${TOKEN}&s=${SALT}&v=1.16.1&c=XylonicTest&f=json"

echo ""
echo "=== Direct curl (desktop) ==="
curl -s --max-time 10 "$PING" | python3 -m json.tool 2>/dev/null || echo "[no response]"
