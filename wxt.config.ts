import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "zh_CN",
    version: "0.1.0",
    permissions: [
      "tabs",
      "tabGroups",
      "storage",
      "sidePanel"
    ],
    optional_host_permissions: [
      "https://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*"
    ],
    action: {
      default_title: "__MSG_actionTitle__"
    },
    side_panel: {
      default_path: "sidepanel.html"
    }
  }
});
