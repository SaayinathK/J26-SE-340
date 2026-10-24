# tests/e2e/lead_intel_e2e.py - the Lead Intelligence screens work end to end, in a real browser,
# through the frontend -> gateway -> lead-intel path (the whole Docker stack must be running).
# Run (repo root):  pip install playwright ; python -m playwright install chromium
#                   python tests/e2e/lead_intel_e2e.py            (E2E_URL, E2E_EMAIL, E2E_PASSWORD to change)
import os
import sys

from playwright.sync_api import sync_playwright

URL = os.getenv("E2E_URL", "http://localhost:3000")
EMAIL = os.getenv("E2E_EMAIL", "admin@tenant-a.com")
PASSWORD = os.getenv("E2E_PASSWORD", "Test@12345")
failed = []


def check(name, ok):
    print(("PASS " if ok else "FAIL ") + name)
    if not ok:
        failed.append(name)


with sync_playwright() as p:
    page = p.chromium.launch().new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.fill("#email", EMAIL)
    page.fill("#password", PASSWORD)
    page.click("button.btn")
    page.wait_for_selector("button.nav-btn", timeout=20000)
    check("sign in", True)

    page.click('button.nav-btn:has-text("Leads")')
    page.wait_for_selector("tbody tr", timeout=20000)
    tabs = page.inner_text(".page")
    check("lead list shows hot, warm and cold groups", all(w in tabs for w in ("Hot", "Warm", "Cold")))
    page.click("tbody tr >> nth=0")
    page.wait_for_selector("text=What should we do next?", timeout=10000)
    check("lead drawer opens with the next step", True)
    page.keyboard.press("Escape")

    page.click('button.nav-btn:has-text("Check a new lead")')
    page.fill("#total_visits", "0")
    page.fill("#time_on_site_sec", "600")
    check("impossible input is refused before sending",
          page.is_disabled('button:has-text("Check this lead")') and page.is_visible(".field-error"))
    page.fill("#total_visits", "4")
    page.click('button:has-text("Check this lead")')
    page.wait_for_selector(".gauge-num b", timeout=20000)
    score = int(page.inner_text(".gauge-num b"))
    check(f"a new lead gets a score from 0 to 100 ({score})", 0 <= score <= 100)

    page.click('button.nav-btn:has-text("Score check")')
    page.wait_for_selector("text=leads the model never saw", timeout=20000)
    check("accuracy on unseen leads is shown", "0.8" in page.inner_text(".q-grid"))
    check("no browser errors", not errors)

print(f"\n{'ALL PASSED' if not failed else str(len(failed)) + ' FAILED'}")
sys.exit(1 if failed else 0)
