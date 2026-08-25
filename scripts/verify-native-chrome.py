#!/usr/bin/env python3
"""Run an isolated native-Chromium smoke test for the built PaneKeep extension."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, Playwright, sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension", type=Path, default=ROOT / ".output/chrome-mv3")
    parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts/native-e2e")
    parser.add_argument("--screenshots", type=Path, default=ROOT / "store-assets/screenshots")
    parser.add_argument("--executable", type=Path, help="Chromium-compatible executable; defaults to Playwright Chromium")
    return parser.parse_args()


def launch_context(playwright: Playwright, profile: Path, extension: Path, executable: Path | None) -> BrowserContext:
    options = {
        "user_data_dir": str(profile),
        "headless": True,
        "args": [
            f"--disable-extensions-except={extension}",
            f"--load-extension={extension}",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        "viewport": {"width": 1280, "height": 800},
        "locale": "zh-CN",
        "color_scheme": "light",
    }
    if executable:
        options["executable_path"] = str(executable)
    else:
        options["channel"] = "chromium"
    return playwright.chromium.launch_persistent_context(**options)


def extension_id(context: BrowserContext) -> str:
    workers = context.service_workers
    worker = workers[0] if workers else context.wait_for_event("serviceworker", timeout=20_000)
    match = re.match(r"chrome-extension://([^/]+)/", worker.url)
    if not match:
        raise RuntimeError(f"Unexpected service worker URL: {worker.url}")
    return match.group(1)


def attach_diagnostics(page: Page, diagnostics: list[dict[str, str]]) -> None:
    page.on("pageerror", lambda error: diagnostics.append({"level": "pageerror", "message": str(error)}))
    page.on(
        "console",
        lambda message: diagnostics.append({"level": message.type, "message": message.text})
        if message.type in {"error", "warning"}
        else None,
    )


def goto_fixture(page: Page, url: str) -> None:
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20_000)
    except Exception:
        # The tab URL and title are the state-engine inputs; a remote page failing
        # to finish loading should not invalidate the isolated extension smoke test.
        pass


def create_native_workspace(page: Page) -> dict:
    return page.evaluate(
        r"""async () => {
          const tabs = (await chrome.tabs.query({})).filter((tab) => /^https:\/\//.test(tab.url || ""));
          if (tabs.length < 2) throw new Error(`Expected two HTTPS fixture tabs, found ${tabs.length}`);
          const workspace = await chrome.runtime.sendMessage({
            type: "panekeep/create-workspace",
            windowId: tabs[0].windowId,
            name: "发布准备",
            description: "Chrome 原生验收",
            tags: ["验收", "发布"],
            color: "blue",
            icon: "shield",
            tabIds: [String(tabs[0].id)]
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
          const stateEnvelope = await chrome.runtime.sendMessage({ source: "panekeep-ui", action: "snapshot" });
          const stateAfterCreate = stateEnvelope?.snapshot;
          const canonicalWorkspace = stateAfterCreate?.workspaces.find((candidate) =>
            candidate.groupId === workspace.groupId || candidate.name === workspace.name
          );
          if (!canonicalWorkspace) throw new Error("Native workspace was not present after creation");
          const moveResult = await chrome.runtime.sendMessage({
            source: "panekeep-ui",
            action: "tabs.move",
            payload: {
              tabIds: [String(tabs[1].id)],
              workspaceId: canonicalWorkspace.id
            }
          });
          if (!moveResult || moveResult.ok === false) throw new Error(moveResult?.error || "tabs.move returned no response");
          const backupResponse = await chrome.runtime.sendMessage({ type: "panekeep/export-backup", asJson: true });
          const nativeGroup = await chrome.tabGroups.get(workspace.groupId);
          const groupedTabs = moveResult.snapshot.tabs.filter((tab) => tab.workspaceId === canonicalWorkspace.id);
          const nativeGroupedTabs = await chrome.tabs.query({ groupId: nativeGroup.id });
          return {
            workspace: { id: canonicalWorkspace.id, name: canonicalWorkspace.name, groupId: canonicalWorkspace.groupId },
            nativeGroup: { id: nativeGroup.id, title: nativeGroup.title, color: nativeGroup.color },
            groupedTabCount: nativeGroupedTabs.length,
            snapshotGroupedTabCount: groupedTabs.length,
            movedTabIds: moveResult.result?.movedTabIds || [],
            skippedTabIds: moveResult.result?.skippedTabIds || [],
            backupProduct: backupResponse.backup.product,
            backupContainsApiKey: JSON.stringify(backupResponse.backup).includes("apiKey")
          };
        }"""
    )


def main() -> None:
    args = parse_args()
    extension = args.extension.resolve()
    if not (extension / "manifest.json").is_file():
        raise SystemExit(f"Build PaneKeep first; manifest not found at {extension / 'manifest.json'}")
    args.artifacts.mkdir(parents=True, exist_ok=True)
    args.screenshots.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="panekeep-chrome-profile-"))
    diagnostics: list[dict[str, str]] = []
    evidence: dict = {
        "testedAt": datetime.now(timezone.utc).isoformat(),
        "extensionPath": str(extension.relative_to(ROOT)) if extension.is_relative_to(ROOT) else str(extension),
        "isolatedProfile": True,
    }

    try:
        with sync_playwright() as playwright:
            context = launch_context(playwright, profile, extension, args.executable)
            try:
                identifier = extension_id(context)
                evidence["extensionId"] = identifier
                evidence["browserVersion"] = context.browser.version if context.browser else "unknown"

                first = context.new_page()
                second = context.new_page()
                goto_fixture(first, "https://example.com/?panekeep=research")
                goto_fixture(second, "https://example.org/?panekeep=release")

                manage = context.new_page()
                attach_diagnostics(manage, diagnostics)
                manage.goto(f"chrome-extension://{identifier}/manage.html", wait_until="networkidle")
                manage.get_by_role("heading", name="PaneKeep").wait_for()

                native = create_native_workspace(manage)
                assert native["groupedTabCount"] == 2, native
                assert native["nativeGroup"]["title"] == "发布准备", native
                assert native["backupProduct"] == "panekeep", native
                assert native["backupContainsApiKey"] is False, native
                evidence["nativeWorkspace"] = native

                manage.reload(wait_until="networkidle")
                manage.get_by_text("发布准备", exact=True).wait_for()
                manage.screenshot(path=args.screenshots / "zh-CN-workspaces.png")

                language = manage.locator(".language-control select")
                language.select_option("en")
                manage.get_by_text("Workspace management", exact=True).wait_for()
                update = manage.evaluate(
                    """async (workspaceId) => chrome.runtime.sendMessage({
                      source: "panekeep-ui",
                      action: "workspace.update",
                      payload: {
                        id: workspaceId,
                        draft: {
                          name: "Release readiness",
                          description: "Native Chrome acceptance",
                          tags: ["release", "review"]
                        }
                      }
                    })""",
                    native["workspace"]["id"],
                )
                if not update or update.get("ok") is False:
                    raise RuntimeError(update.get("error", "workspace.update returned no response") if update else "workspace.update returned no response")
                manage.reload(wait_until="networkidle")
                manage.get_by_text("Release readiness", exact=True).wait_for()
                manage.locator("#ai-settings").scroll_into_view_if_needed()
                manage.screenshot(path=args.screenshots / "en-ai-settings.png")

                sidepanel = context.new_page()
                attach_diagnostics(sidepanel, diagnostics)
                sidepanel.goto(f"chrome-extension://{identifier}/sidepanel.html", wait_until="networkidle")
                sidepanel.get_by_role("heading", name="PaneKeep").wait_for()
                sidepanel.get_by_text("Release readiness", exact=True).wait_for()
                evidence["uiSmoke"] = {
                    "manageZhCN": True,
                    "manageEnglish": True,
                    "sidepanel": True,
                }
            finally:
                context.close()

            # Reopen the same isolated profile to prove the packaged extension and
            # background worker can start cleanly after a browser restart.
            restarted = launch_context(playwright, profile, extension, args.executable)
            try:
                restarted_id = extension_id(restarted)
                page = restarted.new_page()
                attach_diagnostics(page, diagnostics)
                page.goto(f"chrome-extension://{restarted_id}/manage.html", wait_until="networkidle")
                page.get_by_role("heading", name="PaneKeep").wait_for()
                evidence["restartSmoke"] = restarted_id == evidence["extensionId"]
            finally:
                restarted.close()

        errors = [entry for entry in diagnostics if entry["level"] in {"error", "pageerror"}]
        evidence["diagnostics"] = diagnostics
        evidence["passed"] = not errors and evidence.get("restartSmoke") is True
        (args.artifacts / "chrome-smoke.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        if not evidence["passed"]:
            raise SystemExit(f"Native Chrome smoke test failed: {errors}")
        print(json.dumps(evidence, ensure_ascii=False, indent=2))
    finally:
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
