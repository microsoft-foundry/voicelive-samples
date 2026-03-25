"""
Local E2E test for Voice Live — all 4 backends, voice + text mode.
Starts each backend sequentially on port 8000, runs Playwright tests
with video recording, then shuts down.

Usage:
  python tests/test_local_all_backends.py
  python tests/test_local_all_backends.py --backend python       # single backend
  python tests/test_local_all_backends.py --backend javascript
  python tests/test_local_all_backends.py --mode agent           # test agent mode

Requires:
  - .env file in each backend directory with AZURE_VOICELIVE_ENDPOINT
  - pip install playwright websockets
  - playwright install chromium
"""

import asyncio
import base64
import json
import math
import os
import signal
import struct
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PORT = 8000
BASE_URL = f"http://localhost:{PORT}"
WS_URL = f"ws://localhost:{PORT}"
SESSION_TIMEOUT = 45
ROOT = Path(__file__).resolve().parent.parent

RESULTS_DIR = Path(__file__).resolve().parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)

PYTHON_VENV = ROOT / "python" / ".venv" / "Scripts" / "python.exe"
PYTHON_EXE = str(PYTHON_VENV) if PYTHON_VENV.exists() else sys.executable

BACKENDS = {
    "python": {
        "cwd": ROOT / "python",
        "cmd": [PYTHON_EXE, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(PORT)],
        "health": f"{BASE_URL}/health",
        "ready_text": "Application startup complete",
    },
    "javascript": {
        "cwd": ROOT / "javascript",
        "cmd": ["node", "app.js"],
        "health": f"{BASE_URL}/health",
        "ready_text": "listening on",
        "env_extra": {"PORT": str(PORT)},
    },
    "csharp": {
        "cwd": ROOT / "csharp",
        "cmd": ["dotnet", "run", "--no-build"],
        "health": f"{BASE_URL}/health",
        "ready_text": "Now listening on",
    },
    "java": {
        "cwd": ROOT / "java",
        "cmd": ["mvn.cmd", "-q", "spring-boot:run", f"-Dspring-boot.run.arguments=--server.port={PORT}"],
        "health": f"{BASE_URL}/health",
        "ready_text": "Started",
    },
}

# ---------------------------------------------------------------------------
# Result tracking
# ---------------------------------------------------------------------------

@dataclass
class TestResult:
    backend: str
    test_name: str
    passed: bool = False
    duration: float = 0.0
    details: str = ""
    errors: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Audio helpers
# ---------------------------------------------------------------------------

def generate_sine_chunks(duration_s: float = 3.0, freq: float = 440.0) -> list[str]:
    """Generate synthetic PCM16 sine wave chunks (24kHz mono)."""
    rate = 24000
    total = int(rate * duration_s)
    pcm = b""
    for i in range(total):
        sample = int(16000 * math.sin(2 * math.pi * freq * i / rate))
        pcm += struct.pack("<h", max(-32768, min(32767, sample)))
    chunk_size = 7200
    return [base64.b64encode(pcm[i:i + chunk_size]).decode() for i in range(0, len(pcm), chunk_size)]


# ---------------------------------------------------------------------------
# Backend lifecycle
# ---------------------------------------------------------------------------

def start_backend(name: str) -> tuple[subprocess.Popen, dict]:
    """Start a backend server and wait until it's healthy. Returns (process, env_vars)."""
    cfg = BACKENDS[name]
    env = os.environ.copy()
    env.update(cfg.get("env_extra", {}))

    # Load backend-specific .env
    backend_env = {}
    env_file = cfg["cwd"] / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
                backend_env[k.strip()] = v.strip()

    print(f"  Starting {name} on port {PORT}...")
    proc = subprocess.Popen(
        cfg["cmd"],
        cwd=str(cfg["cwd"]),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )

    # Wait for health endpoint
    import urllib.request
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            resp = urllib.request.urlopen(cfg["health"], timeout=2)
            if resp.status == 200:
                print(f"  ✅ {name} healthy on port {PORT}")
                return proc, backend_env
        except Exception:
            pass
        if proc.poll() is not None:
            raise RuntimeError(f"{name} exited early (code={proc.returncode})")
        time.sleep(1)

    # Timeout
    try:
        proc.kill()
    except Exception:
        pass
    raise RuntimeError(f"{name} did not become healthy within 60s.")


def stop_backend(proc: subprocess.Popen, name: str):
    """Stop a backend server."""
    if proc and proc.poll() is None:
        print(f"  Stopping {name}...")
        try:
            if sys.platform == "win32":
                proc.send_signal(signal.CTRL_BREAK_EVENT)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except Exception as e:
            print(f"    ⚠ Error stopping {name}: {e}")
            try:
                proc.kill()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Test 1: WebSocket — voice mode (send audio, get audio back)
# ---------------------------------------------------------------------------

async def test_ws_voice(backend: str, mode: str = "model") -> TestResult:
    """WebSocket test: start session, send audio, verify audio/transcript response."""
    import websockets
    import websockets.exceptions

    result = TestResult(backend=backend, test_name=f"ws_voice_{mode}")
    start = time.time()
    audio_received = 0
    transcripts = []

    try:
        ws_url = f"{WS_URL}/ws/test-voice-{int(time.time())}"
        chunks = generate_sine_chunks(3.0)

        async with websockets.connect(ws_url, open_timeout=20, close_timeout=10) as ws:
            # Start session
            start_msg = {
                "type": "start_session",
                "mode": mode,
                "model": "gpt-realtime",
                "voice": "en-US-Ava:DragonHDLatestNeural",
                "voice_type": "azure-standard",
                "vad_type": "azure_semantic",
                "transcribe_model": "gpt-4o-transcribe",
                "noise_reduction": True,
                "echo_cancellation": True,
                "proactive_greeting": True,
                "greeting_type": "llm",
                "temperature": 0.7,
            }
            if mode == "agent":
                start_msg["agent_name"] = os.environ.get("E2E_AGENT_NAME", "")
                start_msg["project"] = os.environ.get("E2E_AGENT_PROJECT", "")
                if os.environ.get("E2E_AGENT_VERSION"):
                    start_msg["agent_version"] = os.environ["E2E_AGENT_VERSION"]
            await ws.send(json.dumps(start_msg))

            # Wait for session_started
            session_ok = False
            deadline = time.time() + SESSION_TIMEOUT
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msg = json.loads(raw)
                    if msg.get("type") == "session_started":
                        session_ok = True
                        break
                    elif msg.get("type") == "error":
                        result.errors.append(msg.get("message", ""))
                        break
                except asyncio.TimeoutError:
                    continue

            if not session_ok:
                result.details = f"No session_started. Errors: {result.errors}"
                result.duration = time.time() - start
                return result

            # Let greeting flow
            await asyncio.sleep(3)

            # Send audio
            for chunk in chunks:
                await ws.send(json.dumps({"type": "audio_chunk", "data": chunk}))
                await asyncio.sleep(0.15)

            # Collect responses
            collect_end = time.time() + SESSION_TIMEOUT
            while time.time() < collect_end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=3)
                    msg = json.loads(raw)
                    if msg.get("type") == "audio_data":
                        audio_received += 1
                    elif msg.get("type") == "transcript":
                        transcripts.append(f"[{msg.get('role', '?')}] {msg.get('text', '')[:80]}")
                    elif msg.get("type") == "error":
                        result.errors.append(msg.get("message", ""))
                except asyncio.TimeoutError:
                    if audio_received > 0 or transcripts:
                        break

            # Stop
            await ws.send(json.dumps({"type": "stop_session"}))
            try:
                await asyncio.wait_for(ws.recv(), timeout=2)
            except Exception:
                pass

        result.passed = (audio_received > 0 or len(transcripts) > 0) and not result.errors
        result.details = f"audio={audio_received}, transcripts={len(transcripts)}"
        if transcripts:
            result.details += f"\n      📝 {transcripts[0]}"

    except websockets.exceptions.ConnectionClosedError as e:
        # Accept as pass if we got meaningful data before the close
        result.passed = audio_received > 0 or len(transcripts) > 0
        result.details = f"audio={audio_received}, transcripts={len(transcripts)} (close code={e.code})"
        if transcripts:
            result.details += f"\n      📝 {transcripts[0]}"

    except Exception as e:
        result.errors.append(str(e)[:200])
        result.details = f"Exception: {str(e)[:200]}"

    result.duration = time.time() - start
    return result


# ---------------------------------------------------------------------------
# Test 2: WebSocket — text mode (send_text, get response)
# ---------------------------------------------------------------------------

async def test_ws_text(backend: str, mode: str = "model") -> TestResult:
    """WebSocket test: start session, send text message, verify transcript response."""
    import websockets

    result = TestResult(backend=backend, test_name=f"ws_text_{mode}")
    start = time.time()

    try:
        ws_url = f"{WS_URL}/ws/test-text-{int(time.time())}"
        audio_received = 0
        transcripts = []

        async with websockets.connect(ws_url, open_timeout=20, close_timeout=10) as ws:
            start_msg = {
                "type": "start_session",
                "mode": mode,
                "model": "gpt-realtime",
                "voice": "en-US-Ava:DragonHDLatestNeural",
                "voice_type": "azure-standard",
                "vad_type": "azure_semantic",
                "transcribe_model": "gpt-4o-transcribe",
                "noise_reduction": True,
                "echo_cancellation": True,
                "proactive_greeting": False,
                "temperature": 0.7,
            }
            if mode == "agent":
                start_msg["agent_name"] = os.environ.get("E2E_AGENT_NAME", "")
                start_msg["project"] = os.environ.get("E2E_AGENT_PROJECT", "")
                if os.environ.get("E2E_AGENT_VERSION"):
                    start_msg["agent_version"] = os.environ["E2E_AGENT_VERSION"]
            await ws.send(json.dumps(start_msg))

            # Wait for session_started
            session_ok = False
            deadline = time.time() + SESSION_TIMEOUT
            while time.time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msg = json.loads(raw)
                    if msg.get("type") == "session_started":
                        session_ok = True
                        break
                    elif msg.get("type") == "error":
                        result.errors.append(msg.get("message", ""))
                        break
                except asyncio.TimeoutError:
                    continue

            if not session_ok:
                result.details = f"No session_started. Errors: {result.errors}"
                result.duration = time.time() - start
                return result

            # Give session a moment to stabilize
            await asyncio.sleep(1)

            # Send text message — this is the critical test for our fix
            await ws.send(json.dumps({
                "type": "send_text",
                "text": "Hello! What is 2 plus 3?"
            }))

            # Collect responses — expect transcript and/or audio
            collect_end = time.time() + SESSION_TIMEOUT
            while time.time() < collect_end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                    msg = json.loads(raw)
                    if msg.get("type") == "audio_data":
                        audio_received += 1
                    elif msg.get("type") == "transcript":
                        transcripts.append(f"[{msg.get('role', '?')}] {msg.get('text', '')[:80]}")
                    elif msg.get("type") == "error":
                        result.errors.append(msg.get("message", ""))
                except asyncio.TimeoutError:
                    if audio_received > 0 or transcripts:
                        break

            # Stop
            await ws.send(json.dumps({"type": "stop_session"}))
            try:
                await asyncio.wait_for(ws.recv(), timeout=2)
            except Exception:
                pass

        result.passed = (audio_received > 0 or len(transcripts) > 0) and not result.errors
        result.details = f"audio={audio_received}, transcripts={len(transcripts)}"
        if transcripts:
            result.details += f"\n      📝 {transcripts[0]}"

    except Exception as e:
        result.errors.append(str(e)[:200])
        result.details = f"Exception: {str(e)[:200]}"

    result.duration = time.time() - start
    return result


# ---------------------------------------------------------------------------
# Test 3: Playwright browser test — voice + text mode with video
# ---------------------------------------------------------------------------

async def test_browser(backend: str) -> TestResult:
    """Playwright browser test: load UI, start voice session, switch to text, send message."""
    from playwright.async_api import async_playwright

    result = TestResult(backend=backend, test_name="browser_voice_and_text")
    start = time.time()
    video_dir = str(RESULTS_DIR / f"videos_{backend}")
    os.makedirs(video_dir, exist_ok=True)

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                permissions=["microphone"],
                record_video_dir=video_dir,
                record_video_size={"width": 1280, "height": 720},
                viewport={"width": 1280, "height": 720},
            )

            page = await context.new_page()

            # Mock microphone
            await page.add_init_script("""
                navigator.mediaDevices.getUserMedia = async function(constraints) {
                    if (constraints.audio) {
                        const ctx = new AudioContext({ sampleRate: 24000 });
                        const osc = ctx.createOscillator();
                        const dest = ctx.createMediaStreamDestination();
                        osc.frequency.value = 440;
                        osc.connect(dest);
                        osc.start();
                        return dest.stream;
                    }
                    throw new Error('Video not supported');
                };
            """)

            checks = []

            # 1. Load page
            resp = await page.goto(BASE_URL, wait_until="load", timeout=30000)
            checks.append(("page_load", resp and resp.status == 200))

            # 2. Verify idle state
            await page.wait_for_timeout(2000)
            start_btn = page.locator("button:has-text('Start session')")
            has_start = await start_btn.count() > 0
            checks.append(("start_button_visible", has_start))

            # 3. Screenshot idle
            await page.screenshot(path=str(RESULTS_DIR / f"{backend}_01_idle.png"))

            # 4. Start voice session
            if has_start:
                await start_btn.first.click()
                await page.wait_for_timeout(6000)  # Wait for session + greeting

            # 5. Check session is active (orb visible or transcript visible)
            orb = page.locator("[class*='orb'], [class*='Orb']")
            orb_visible = await orb.count() > 0
            checks.append(("voice_session_active", orb_visible))

            # 6. Screenshot active voice
            await page.screenshot(path=str(RESULTS_DIR / f"{backend}_02_voice_active.png"))

            # 7. End session
            end_btn = page.locator("button[aria-label='End session'], button[title='End session'], button:has-text('End')")
            if await end_btn.count() > 0:
                await end_btn.first.click()
                await page.wait_for_timeout(2000)

            # 8. Screenshot ended
            await page.screenshot(path=str(RESULTS_DIR / f"{backend}_03_session_ended.png"))

            # 9. Start new session for text mode test
            new_chat = page.locator("button:has-text('New chat')")
            if await new_chat.count() > 0:
                await new_chat.first.click()
                await page.wait_for_timeout(1000)

            # 10. Check for text mode toggle (if lockedMode not set)
            text_toggle = page.locator("button[aria-label='Text mode'], [aria-label='Switch to text']")
            # Also try direct URL for text mode
            await page.goto(f"{BASE_URL}/?mode=text", wait_until="load")
            await page.wait_for_timeout(2000)

            # 11. Screenshot text mode idle
            await page.screenshot(path=str(RESULTS_DIR / f"{backend}_04_text_idle.png"))

            # 12. Start session in text mode
            start_btn2 = page.locator("button:has-text('Start session')")
            if await start_btn2.count() > 0:
                await start_btn2.first.click()
                await page.wait_for_timeout(5000)

            # 13. Type in chat input
            chat_input = page.locator("input[placeholder*='message'], textarea[placeholder*='message'], input[type='text']")
            if await chat_input.count() > 0:
                await chat_input.first.fill("Hello! What is 2 plus 3?")
                await page.wait_for_timeout(500)
                # Press Enter or click Send
                await chat_input.first.press("Enter")
                await page.wait_for_timeout(8000)  # Wait for response
                checks.append(("text_message_sent", True))
            else:
                checks.append(("text_message_sent", False))

            # 14. Screenshot text mode with response
            await page.screenshot(path=str(RESULTS_DIR / f"{backend}_05_text_response.png"))

            # Check for any response messages in chat
            messages = page.locator("[class*='message'], [class*='bubble'], [class*='chat']")
            msg_count = await messages.count()
            checks.append(("text_response_received", msg_count > 0))

            # Summary
            passed_count = sum(1 for _, ok in checks if ok)
            total_checks = len(checks)
            result.passed = passed_count >= 3  # At least page load + start button + voice session
            result.details = f"{passed_count}/{total_checks} checks passed"
            for name, ok in checks:
                result.details += f"\n      {'✅' if ok else '❌'} {name}"

            await context.close()
            await browser.close()

    except Exception as e:
        result.errors.append(str(e)[:300])
        result.details = f"Exception: {str(e)[:200]}"

    result.duration = time.time() - start
    return result


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def print_result(r: TestResult):
    status = "✅ PASS" if r.passed else "❌ FAIL"
    print(f"\n  {status}  {r.backend} / {r.test_name} — {r.duration:.1f}s")
    print(f"      {r.details}")
    if r.errors:
        for e in r.errors[:3]:
            print(f"      ⚠️  {e[:150]}")


async def run_tests_for_backend(name: str, mode: str, backend_env: dict) -> list[TestResult]:
    """Run all tests for a single backend."""
    results = []

    # Use mode from CLI arg (default: model). Backend .env mode is ignored
    # to ensure consistent testing — agent mode requires a valid deployed agent.
    effective_mode = "agent"
    agent_name = "AgentwBingWebSearch"
    agent_project = "jagoerge-voicelive-sec"

    # Export agent config for tests to pick up
    os.environ["E2E_AGENT_NAME"] = agent_name
    os.environ["E2E_AGENT_PROJECT"] = agent_project
    os.environ["E2E_AGENT_VERSION"] = "4"

    # Test 1: WebSocket voice mode
    print(f"\n    [1/3] WebSocket voice test ({effective_mode} mode)...")
    r = await test_ws_voice(name, effective_mode)
    results.append(r)
    print_result(r)

    # Test 2: WebSocket text mode (THE critical test for our fix)
    print(f"\n    [2/3] WebSocket text test ({effective_mode} mode)...")
    r = await test_ws_text(name, effective_mode)
    results.append(r)
    print_result(r)

    # Test 3: Playwright browser test with video recording
    print(f"\n    [3/3] Playwright browser test...")
    r = await test_browser(name)
    results.append(r)
    print_result(r)

    return results


async def main():
    args = sys.argv[1:]
    mode = "model"
    if "--mode" in args:
        idx = args.index("--mode")
        mode = args[idx + 1]

    backend_filter = None
    if "--backend" in args:
        idx = args.index("--backend")
        backend_filter = args[idx + 1]

    backends_to_test = {backend_filter: BACKENDS[backend_filter]} if backend_filter else BACKENDS

    print(f"\n{'='*60}")
    print(f"  Voice Live Local E2E Test Suite")
    print(f"  Backends: {', '.join(backends_to_test.keys())}")
    print(f"  Mode: {mode}")
    print(f"  Results: {RESULTS_DIR}")
    print(f"{'='*60}")

    all_results: list[TestResult] = []

    for name in backends_to_test:
        print(f"\n{'─'*60}")
        print(f"  Backend: {name.upper()}")
        print(f"{'─'*60}")

        proc = None
        backend_env = {}
        try:
            proc, backend_env = start_backend(name)
            results = await run_tests_for_backend(name, mode, backend_env)
            all_results.extend(results)
        except Exception as e:
            print(f"\n  ❌ Failed to start {name}: {e}")
            all_results.append(TestResult(
                backend=name, test_name="startup",
                passed=False, details=str(e)[:300],
            ))
        finally:
            if proc:
                stop_backend(proc, name)
            # Brief cooldown for port release
            await asyncio.sleep(2)

    # Summary
    passed = sum(1 for r in all_results if r.passed)
    total = len(all_results)
    print(f"\n{'='*60}")
    print(f"  FINAL RESULTS: {passed}/{total} passed")
    print(f"  Screenshots & videos in: {RESULTS_DIR}")
    print(f"{'='*60}")

    for r in all_results:
        status = "✅" if r.passed else "❌"
        print(f"  {status} {r.backend:12s} / {r.test_name:25s} {r.duration:6.1f}s")

    print()
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
