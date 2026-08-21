import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    manifest_version: 3,
    name: "Tab Fridge",
    description: "Local-first browser workspaces for organizing tabs safely.",
    version: "0.1.0",
    permissions: [
      "tabs",
      "windows",
      "tabGroups",
      "storage",
      "sessions",
      "sidePanel"
    ],
    action: {
      default_title: "Open Tab Fridge"
    },
    side_panel: {
      default_path: "sidepanel.html"
    }
  }
});
