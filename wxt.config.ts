import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "zh_CN",
    version: "0.1.1",
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
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png"
    },
    action: {
      default_title: "__MSG_actionTitle__",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png"
      }
    },
    side_panel: {
      default_path: "sidepanel.html"
    }
  }
});
