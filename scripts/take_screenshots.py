#!/usr/bin/env python3
"""
Xylonic screenshot automation via Chrome DevTools Protocol (CDP).
Starts the app, navigates through all UI states, and saves screenshots to img/.
"""
import asyncio
import json
import base64
import subprocess
import time
import os
import sys
import urllib.request
import signal

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), '..', 'img')
CDP_PORT = 9222
VITE_PORT = 3000
PROJECT_DIR = os.path.join(os.path.dirname(__file__), '..')

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

screenshot_index = [0]

def next_name():
    i = screenshot_index[0]
    screenshot_index[0] += 1
    if i == 0:
        return 'image.png'
    return f'image-{i}.png'


async def run(ws_url: str):
    import websockets

    async with websockets.connect(ws_url, max_size=200 * 1024 * 1024) as ws:
        cmd_id = [0]

        async def send(method, params=None):
            cmd_id[0] += 1
            cid = cmd_id[0]
            msg = json.dumps({'id': cid, 'method': method, 'params': params or {}})
            await ws.send(msg)
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=30)
                data = json.loads(raw)
                if data.get('id') == cid:
                    if 'error' in data:
                        print(f'  CDP error for {method}: {data["error"]}')
                    return data.get('result', {})

        async def screenshot(name, delay=1.0):
            await asyncio.sleep(delay)
            result = await send('Page.captureScreenshot', {
                'format': 'png',
                'captureBeyondViewport': False,
                'fromSurface': True,
            })
            if 'data' not in result:
                print(f'  WARNING: no screenshot data for {name}')
                return
            data = base64.b64decode(result['data'])
            path = os.path.join(SCREENSHOTS_DIR, name)
            with open(path, 'wb') as f:
                f.write(data)
            print(f'  saved {name} ({len(data)//1024} KB)')

        async def js(expr, delay=0.0):
            result = await send('Runtime.evaluate', {
                'expression': expr,
                'awaitPromise': True,
                'returnByValue': True,
            })
            if delay:
                await asyncio.sleep(delay)
            return result.get('result', {}).get('value')

        async def click(selector, delay=0.8):
            val = await js(f'''
                (() => {{
                    const el = document.querySelector({json.dumps(selector)});
                    if (!el) return "NOT_FOUND:" + {json.dumps(selector)};
                    el.click();
                    return "ok";
                }})()
            ''')
            if val and val.startswith('NOT_FOUND'):
                print(f'  WARN: {val}')
            await asyncio.sleep(delay)

        async def key_event(key, ctrl=False, shift=False):
            await js(f'''
                (() => {{
                    const opts = {{
                        key: {json.dumps(key)},
                        ctrlKey: {'true' if ctrl else 'false'},
                        shiftKey: {'true' if shift else 'false'},
                        bubbles: true,
                        cancelable: true
                    }};
                    document.dispatchEvent(new KeyboardEvent('keydown', opts));
                    window.dispatchEvent(new KeyboardEvent('keydown', opts));
                }})()
            ''', delay=0.5)

        async def type_text(selector, text, delay=0.8):
            await js(f'''
                (() => {{
                    const el = document.querySelector({json.dumps(selector)});
                    if (!el) return;
                    el.focus();
                    el.value = {json.dumps(text)};
                    el.dispatchEvent(new Event('input', {{bubbles: true}}));
                    el.dispatchEvent(new Event('change', {{bubbles: true}}));
                }})()
            ''', delay=delay)

        # Let the app fully load
        await asyncio.sleep(3)
        print('--- Starting screenshot sequence ---')

        # ── 1. Artists view (default Library view) ──────────────────────────
        print('[1] Artists view')
        await click('.app-nav-item[title="Library"]')
        await click('.view-toggle-btn[title="Browse by Artist"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image.png

        # ── 2. All Albums grid ───────────────────────────────────────────────
        print('[2] All Albums grid')
        await click('.view-toggle-btn[title="Browse all Albums"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-1.png

        # ── 3. All Songs grid ────────────────────────────────────────────────
        print('[3] All Songs grid')
        await click('.view-toggle-btn[title="Browse all Songs"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-2.png

        # ── 4. Liked Songs view ──────────────────────────────────────────────
        print('[4] Liked Songs view')
        await click('.view-toggle-btn[title="Liked Songs"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-3.png

        # ── 5. Home / Discover ───────────────────────────────────────────────
        print('[5] Home / Discover view')
        await click('.app-nav-item[title="Home"]', delay=2.0)
        name = next_name()
        await screenshot(name)   # image-4.png

        # ── 6. Artist albums view ────────────────────────────────────────────
        print('[6] Artist albums view — clicking first artist card')
        await click('.app-nav-item[title="Library"]')
        await click('.view-toggle-btn[title="Browse by Artist"]', delay=1.0)
        # Click the first artist card
        clicked = await js('''
            (() => {
                const cards = document.querySelectorAll('.artist-card');
                if (cards.length === 0) {
                    // try alternate selectors
                    const alts = document.querySelectorAll('[class*="artist"]');
                    if (alts.length > 0) { alts[0].click(); return "alt"; }
                    return "none";
                }
                cards[0].click();
                return "ok:" + cards[0].textContent.trim().slice(0,30);
            })()
        ''', delay=1.5)
        print(f'  artist card click result: {clicked}')
        name = next_name()
        await screenshot(name)   # image-5.png

        # ── 7. Song list ─────────────────────────────────────────────────────
        print('[7] Song list — clicking first album')
        clicked = await js('''
            (() => {
                const cards = document.querySelectorAll('.album-card');
                if (cards.length === 0) return "none";
                cards[0].click();
                return "ok:" + cards[0].textContent.trim().slice(0,30);
            })()
        ''', delay=1.5)
        print(f'  album card click result: {clicked}')
        name = next_name()
        await screenshot(name)   # image-6.png

        # ── 8. Download quality picker ───────────────────────────────────────
        print('[8] Download quality picker')
        clicked = await js('''
            (() => {
                // Look for download album button (various selectors)
                const selectors = [
                    '.download-album-btn',
                    'button[title*="Download"]',
                    'button[aria-label*="Download"]',
                    '.download-btn',
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) { el.click(); return "ok:" + sel; }
                }
                return "none";
            })()
        ''', delay=1.0)
        print(f'  download btn click result: {clicked}')
        name = next_name()
        await screenshot(name, delay=0.8)   # image-7.png
        # Dismiss the picker (press Escape)
        await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))", delay=0.5)
        # Also try clicking cancel button
        await js('''
            (() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const cancel = btns.find(b => b.textContent.includes('Cancel') || b.textContent.includes('cancel'));
                if (cancel) { cancel.click(); return "ok"; }
                return "none";
            })()
        ''', delay=0.3)

        # ── 9. Queue panel ───────────────────────────────────────────────────
        print('[9] Queue panel')
        await key_event('q')
        name = next_name()
        await screenshot(name)   # image-8.png
        await key_event('q')  # close

        # ── 10. History panel ─────────────────────────────────────────────────
        print('[10] History panel')
        await key_event('h')
        name = next_name()
        await screenshot(name)   # image-9.png
        await key_event('h')  # close

        # ── 11. Playlists panel ──────────────────────────────────────────────
        print('[11] Playlists panel')
        await key_event('p')
        name = next_name()
        await screenshot(name)   # image-10.png
        await key_event('p')  # close

        # ── 12. Search results ───────────────────────────────────────────────
        print('[12] Search results')
        # Focus search bar and type
        await js('''
            (() => {
                const bar = document.querySelector('.search-bar input, input[placeholder*="Search"], input[type="search"]');
                if (!bar) return "none";
                bar.focus();
                bar.value = "rock";
                bar.dispatchEvent(new Event("input", {bubbles:true}));
                return "ok";
            })()
        ''', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-11.png
        # Clear search
        await js('''
            (() => {
                const bar = document.querySelector('.search-bar input, input[placeholder*="Search"], input[type="search"]');
                if (!bar) return;
                bar.value = "";
                bar.dispatchEvent(new Event("input", {bubbles:true}));
                bar.blur();
            })()
        ''', delay=0.5)

        # ── 13. Right-click context menu ─────────────────────────────────────
        print('[13] Right-click context menu on song row')
        # Navigate to a song list first
        await click('.app-nav-item[title="Library"]')
        await click('.view-toggle-btn[title="Browse by Artist"]', delay=0.8)
        # Click first artist
        await js('''
            (() => {
                const cards = document.querySelectorAll('.artist-card');
                if (cards.length > 0) cards[0].click();
            })()
        ''', delay=1.2)
        # Click first album
        await js('''
            (() => {
                const cards = document.querySelectorAll('.album-card');
                if (cards.length > 0) cards[0].click();
            })()
        ''', delay=1.2)
        # Right-click on first song row
        await js('''
            (() => {
                const rows = document.querySelectorAll('.song-row, .song-item, [class*="song-row"]');
                if (rows.length === 0) return "none";
                const e = new MouseEvent("contextmenu", {bubbles:true, cancelable:true, button:2});
                rows[0].dispatchEvent(e);
                return "ok";
            })()
        ''', delay=0.8)
        name = next_name()
        await screenshot(name)   # image-12.png
        # Dismiss context menu
        await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))", delay=0.3)

        # ── 14. Hamburger menu open ──────────────────────────────────────────
        print('[14] Hamburger menu open')
        await click('.hamburger-button', delay=1.0)
        name = next_name()
        await screenshot(name)   # image-13.png

        # ── 15. Theme selector ───────────────────────────────────────────────
        print('[15] Theme selector')
        # Click the theme item in the hamburger dropdown
        clicked = await js('''
            (() => {
                const items = document.querySelectorAll(".menu-item");
                for (const item of items) {
                    if (item.textContent.includes("Theme") || item.textContent.includes("theme")) {
                        item.click();
                        return "ok:" + item.textContent.trim().slice(0,30);
                    }
                }
                return "none";
            })()
        ''', delay=1.0)
        print(f'  theme menu item click: {clicked}')
        name = next_name()
        await screenshot(name)   # image-14.png
        # Close theme selector
        await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))", delay=0.3)
        await js('''
            (() => {
                const btns = Array.from(document.querySelectorAll("button"));
                const close = btns.find(b => b.textContent.includes("Close") || b.className.includes("close"));
                if (close) close.click();
            })()
        ''', delay=0.5)

        # ── 16. Keyboard shortcuts help ──────────────────────────────────────
        print('[16] Keyboard shortcuts help dialog')
        await click('.app-nav-help, .app-nav-item[title="Help"]', delay=1.0)
        name = next_name()
        await screenshot(name)   # image-15.png
        # Close
        await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))", delay=0.5)

        # ── 17. Downloads section ────────────────────────────────────────────
        print('[17] Downloads section (Download Manager inline)')
        await click('.app-nav-item[title="Downloads"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-16.png

        # Scroll to show Manage Cache section
        await js('''
            (() => {
                const btn = Array.from(document.querySelectorAll("button")).find(
                    b => b.textContent.includes("Manage Cache")
                );
                if (btn) { btn.scrollIntoView(); btn.click(); return "clicked manage cache"; }
                return "not found";
            })()
        ''', delay=1.0)
        name = next_name()
        await screenshot(name)   # image-17.png (Manage Cache with Verify Cache button)

        # ── 18. Settings panel ───────────────────────────────────────────────
        print('[18] Settings panel')
        await click('.app-nav-item[title="Settings"]', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-18.png

        # ── 19. Playback controls + player bar ──────────────────────────────
        print('[19] Playback controls bar (bottom)')
        await click('.app-nav-item[title="Library"]')
        await click('.view-toggle-btn[title="Browse by Artist"]', delay=0.8)
        # Navigate to a song list and play a song
        await js('''
            (() => {
                const cards = document.querySelectorAll(".artist-card");
                if (cards.length > 0) cards[0].click();
            })()
        ''', delay=1.2)
        await js('''
            (() => {
                const cards = document.querySelectorAll(".album-card");
                if (cards.length > 0) cards[0].click();
            })()
        ''', delay=1.2)
        # Click the first song's play button
        await js('''
            (() => {
                const rows = document.querySelectorAll(".song-row, .song-item, [class*=\"song-row\"]");
                if (rows.length > 0) {
                    // Try to click a play button in the row
                    const playBtn = rows[0].querySelector("button");
                    if (playBtn) { playBtn.click(); return "clicked play btn"; }
                    rows[0].click();
                    return "clicked row";
                }
                return "none";
            })()
        ''', delay=2.0)
        name = next_name()
        await screenshot(name)   # image-19.png (playing state, bottom bar)

        # ── 20. Now Playing overlay ──────────────────────────────────────────
        print('[20] Now Playing overlay (click player bar)')
        await js('''
            (() => {
                // Click the playback controls bar to open now playing
                const bar = document.querySelector(".playback-controls, .player-bar, .now-playing-bar");
                if (bar) { bar.click(); return "ok"; }
                // Try album art in the bar
                const art = document.querySelector(".current-song-art, .player-album-art");
                if (art) { art.click(); return "ok-art"; }
                return "none";
            })()
        ''', delay=1.5)
        name = next_name()
        await screenshot(name)   # image-20.png

        # Close now playing
        await js("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))", delay=0.5)
        await js('''
            (() => {
                const btns = Array.from(document.querySelectorAll("button"));
                const close = btns.find(b => b.className.includes("close") || b.title === "Close" || b.title === "Back");
                if (close) close.click();
            })()
        ''', delay=0.5)

        # ── 21. Logout → Login page ──────────────────────────────────────────
        print('[21] Login page (after logout)')
        await click('.app-nav-logout, .app-nav-item[title="Logout"]', delay=2.0)
        name = next_name()
        await screenshot(name)   # image-21.png

        print('--- Screenshot sequence complete ---')
        print(f'Total screenshots: {screenshot_index[0]}')


async def wait_for_cdp(port=CDP_PORT, timeout=60):
    print(f'Waiting for CDP on port {port}...')
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f'http://localhost:{port}/json', timeout=2) as r:
                targets = json.loads(r.read())
                pages = [t for t in targets if t.get('type') == 'page']
                if pages:
                    return targets
        except Exception:
            pass
        await asyncio.sleep(1)
    raise TimeoutError(f'CDP did not become available in {timeout}s')


async def main():
    env = os.environ.copy()
    env['DISPLAY'] = ':0'
    env['SKIP_DEV_CLEAR'] = 'true'

    print('Starting Vite dev server...')
    vite = subprocess.Popen(
        ['npx', 'vite', '--port', '3000'],
        cwd=PROJECT_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for Vite
    print('Waiting for Vite to be ready...')
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            with urllib.request.urlopen('http://localhost:3000', timeout=2):
                break
        except Exception:
            await asyncio.sleep(1)
    else:
        print('ERROR: Vite did not start in time')
        vite.kill()
        sys.exit(1)
    print('Vite ready.')

    print(f'Starting Electron with --remote-debugging-port={CDP_PORT}...')
    electron = subprocess.Popen(
        ['npx', 'electron', '.', f'--remote-debugging-port={CDP_PORT}'],
        cwd=PROJECT_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        targets = await wait_for_cdp()
        # Find the main renderer page (localhost:3000)
        pages = [t for t in targets if t.get('type') == 'page']
        if not pages:
            print('No page targets found. Available targets:')
            for t in targets:
                print(f'  {t.get("type")}: {t.get("url", "?")}')
            sys.exit(1)

        # Prefer the page with our dev URL
        main = None
        for p in pages:
            if 'localhost:3000' in p.get('url', '') or 'index.html' in p.get('url', ''):
                main = p
                break
        if not main:
            main = pages[0]

        ws_url = main['webSocketDebuggerUrl']
        print(f'Connected to: {main.get("url", "?")}')
        print(f'WebSocket: {ws_url}')

        await run(ws_url)

    finally:
        print('Shutting down...')
        electron.terminate()
        vite.terminate()
        try:
            electron.wait(timeout=5)
        except subprocess.TimeoutExpired:
            electron.kill()
        try:
            vite.wait(timeout=5)
        except subprocess.TimeoutExpired:
            vite.kill()


if __name__ == '__main__':
    asyncio.run(main())
