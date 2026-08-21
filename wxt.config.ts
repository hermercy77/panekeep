import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
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
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "Open Tab Fridge"
    },
    side_panel: {
      default_path: "sidepanel.html"
    }
  }
});
