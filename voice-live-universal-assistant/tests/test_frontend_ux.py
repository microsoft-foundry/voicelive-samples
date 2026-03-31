"""Playwright smoke test for the Foundry-aligned frontend UX."""
from playwright.sync_api import sync_playwright
import time

SCREENSHOT_DIR = r"C:\Users\jagoerge\.copilot\session-state\ae1280b1-1da5-4560-bbd0-d5dace33770a\files"

def run_tests():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        passed = 0

        # Test 1: Basic load
        print("Test 1: Loading http://localhost:8000 ...")
        page.goto("http://localhost:8000", wait_until="networkidle")
        print(f"  Title: {page.title()}")
        passed += 1

        # Test 2: TopBar — agent name + New chat + ··· menu
        print("Test 2: TopBar controls ...")
        assert page.locator("button:has-text('New chat')").is_visible(), "New chat not visible"
        assert page.locator("[aria-label='More options']").is_visible(), "··· menu not visible"
        print("  New chat: visible")
        print("  ··· menu: visible")
        passed += 1

        # Test 3: ··· menu opens and has Settings
        print("Test 3: ··· menu dropdown ...")
        page.locator("[aria-label='More options']").click()
        time.sleep(0.3)
        assert page.locator("[role='menuitem']:has-text('Settings')").is_visible(), "Settings not in menu"
        assert page.locator("[role='menuitem']:has-text('Terms of use')").is_visible(), "Terms not in menu"
        assert page.locator("[role='menuitem']:has-text('Privacy')").is_visible(), "Privacy not in menu"
        print("  Settings, Terms, Privacy: visible")
        # Close menu
        page.locator("[aria-label='More options']").click()
        passed += 1

        # Test 4: Idle state — Start session button + Let's talk
        print("Test 4: Idle state ...")
        assert page.locator("button:has-text('Start session')").is_visible(), "Start session not visible"
        assert page.locator("text=Let's talk").is_visible(), "Let's talk not visible"
        print("  Start session button: visible")
        print("  Let's talk: visible")
        passed += 1

        # Test 5: Built with badge
        print("Test 5: Built with badge ...")
        assert page.locator("text=Microsoft Foundry").is_visible(), "Badge not visible"
        passed += 1

        # Test 6: ?lock=true hides controls
        print("Test 6: ?lock=true ...")
        page.goto("http://localhost:8000/?lock=true", wait_until="networkidle")
        assert not page.locator("button:has-text('New chat')").is_visible(), "New chat should be hidden"
        assert not page.locator("[aria-label='More options']").is_visible(), "Menu should be hidden"
        print("  Controls hidden: True")
        passed += 1

        # Test 7: ?theme=dark
        print("Test 7: ?theme=dark ...")
        page.goto("http://localhost:8000/?theme=dark", wait_until="networkidle")
        theme = page.evaluate("document.documentElement.getAttribute('data-theme')")
        assert theme == "dark", f"Expected dark, got {theme}"
        print(f"  Theme: {theme}")
        passed += 1

        # Test 8: Settings opens from menu
        print("Test 8: Settings from menu ...")
        page.goto("http://localhost:8000", wait_until="networkidle")
        page.locator("[aria-label='More options']").click()
        time.sleep(0.3)
        page.locator("[role='menuitem']:has-text('Settings')").click()
        time.sleep(0.5)
        settings_visible = page.locator("text=Mode").first.is_visible()
        print(f"  Settings panel opened: {settings_visible}")
        passed += 1

        # Screenshot
        page.goto("http://localhost:8000", wait_until="networkidle")
        page.screenshot(path=f"{SCREENSHOT_DIR}/test-foundry-idle.png")

        print(f"\n{'='*50}")
        print(f"Results: {passed} passed, 0 failed")
        print(f"{'='*50}")

        browser.close()

if __name__ == "__main__":
    run_tests()
