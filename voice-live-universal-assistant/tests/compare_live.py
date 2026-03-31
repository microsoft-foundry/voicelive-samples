"""Compare the Foundry Portal reference with our deployed version pixel-by-pixel."""
from playwright.sync_api import sync_playwright
import time
import os

SCREENSHOT_DIR = r"C:\Users\jagoerge\.copilot\session-state\ae1280b1-1da5-4560-bbd0-d5dace33770a\files"
REFERENCE_URL = "https://ai.azure.com/nextgen/r/LC5tEE5IQP2PTdn7dw0MbQ,rg-jagoerge-voicelive-eval-sec,,ai-vh7j24h6z2pgw,jagoerge-voicelive-eval-sec/agents/voicelive-evaluation-agent-cloud/preview?version=9"
OUR_URL = "https://ca-web-6gid4mrqdtsmw.salmonglacier-1408708f.eastus2.azurecontainerapps.io"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # Screenshot reference
    print("Loading reference...")
    ref_page = browser.new_page(viewport={"width": 1440, "height": 900})
    try:
        ref_page.goto(REFERENCE_URL, wait_until="networkidle", timeout=30000)
        time.sleep(3)
        ref_page.screenshot(path=os.path.join(SCREENSHOT_DIR, "compare-reference.png"), full_page=False)
        print(f"  Reference title: {ref_page.title()}")
        
        # Extract key CSS values from reference
        ref_styles = ref_page.evaluate("""() => {
            const body = document.body;
            const cs = getComputedStyle(body);
            const root = document.documentElement;
            const rootCs = getComputedStyle(root);
            
            // Try to find Fluent token values
            const tokens = {};
            const tokenNames = [
                '--colorBrandBackground',
                '--colorBrandForeground1', 
                '--colorNeutralForeground1',
                '--colorNeutralForeground2',
                '--colorNeutralBackground1',
                '--colorNeutralBackground3',
                '--colorNeutralStroke1',
                '--fontFamilyBase',
                '--nextGenBackground5',
                '--nextGenForegroundBrand',
                '--colorBrandBackgroundHover',
            ];
            
            // Search for Fluent provider element
            const fluentEl = document.querySelector('[class*="fui-FluentProvider"]') || root;
            const fluentCs = getComputedStyle(fluentEl);
            
            for (const name of tokenNames) {
                tokens[name] = fluentCs.getPropertyValue(name).trim();
            }
            
            return {
                tokens,
                bodyFont: cs.fontFamily,
                bodyFontSize: cs.fontSize,
                bodyColor: cs.color,
                bodyBg: cs.backgroundColor,
            };
        }""")
        print("\n  === REFERENCE FLUENT TOKENS ===")
        for k, v in ref_styles.get("tokens", {}).items():
            if v:
                print(f"    {k}: {v}")
        print(f"    body font: {ref_styles.get('bodyFont', 'N/A')}")
        print(f"    body fontSize: {ref_styles.get('bodyFontSize', 'N/A')}")
        print(f"    body color: {ref_styles.get('bodyColor', 'N/A')}")
        print(f"    body bg: {ref_styles.get('bodyBg', 'N/A')}")
    except Exception as e:
        print(f"  Reference failed (may need auth): {e}")
    ref_page.close()

    # Screenshot ours
    print("\nLoading ours...")
    our_page = browser.new_page(viewport={"width": 1440, "height": 900})
    our_page.goto(OUR_URL, wait_until="networkidle", timeout=30000)
    time.sleep(2)
    our_page.screenshot(path=os.path.join(SCREENSHOT_DIR, "compare-ours.png"), full_page=False)
    print(f"  Our title: {our_page.title()}")
    
    our_styles = our_page.evaluate("""() => {
        const fluentEl = document.querySelector('[class*="fui-FluentProvider"]') || document.documentElement;
        const cs = getComputedStyle(fluentEl);
        const tokens = {};
        const tokenNames = [
            '--colorBrandBackground',
            '--colorBrandForeground1',
            '--colorNeutralForeground1', 
            '--colorNeutralForeground2',
            '--colorNeutralBackground1',
            '--colorNeutralBackground3',
            '--colorNeutralStroke1',
            '--fontFamilyBase',
            '--voice-primary',
        ];
        for (const name of tokenNames) {
            tokens[name] = cs.getPropertyValue(name).trim();
        }
        const body = document.body;
        const bodyCs = getComputedStyle(body);
        return {
            tokens,
            bodyFont: bodyCs.fontFamily,
            bodyFontSize: bodyCs.fontSize,
            bodyColor: bodyCs.color,
            bodyBg: bodyCs.backgroundColor,
        };
    }""")
    print("\n  === OUR FLUENT TOKENS ===")
    for k, v in our_styles.get("tokens", {}).items():
        if v:
            print(f"    {k}: {v}")
    print(f"    body font: {our_styles.get('bodyFont', 'N/A')}")
    print(f"    body fontSize: {our_styles.get('bodyFontSize', 'N/A')}")
    print(f"    body color: {our_styles.get('bodyColor', 'N/A')}")
    print(f"    body bg: {our_styles.get('bodyBg', 'N/A')}")
    
    our_page.close()
    browser.close()
    print("\nDone. Screenshots saved.")
