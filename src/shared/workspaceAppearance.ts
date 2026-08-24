import { normalizeGroupColor } from "./constants";

export const WORKSPACE_ICON_KEYS = [
  "folder",
  "briefcase",
  "code",
  "book",
  "search",
  "file-text",
  "palette",
  "message",
  "calendar",
  "plane",
  "shopping-cart",
  "wallet",
  "chart",
  "megaphone",
  "media",
  "music",
  "home",
  "shield"
] as const;

export type WorkspaceIconKey = (typeof WORKSPACE_ICON_KEYS)[number];

export const AUTO_WORKSPACE_COLORS = ["blue", "cyan", "green", "yellow", "pink", "purple"] as const;

const ICON_KEYWORDS: ReadonlyArray<readonly [WorkspaceIconKey, readonly string[]]> = [
  ["shield", ["security", "privacy", "\u5b89\u5168", "\u9690\u79c1"]],
  ["plane", ["travel", "trip", "flight", "hotel", "\u65c5\u884c", "\u51fa\u5dee", "\u822a\u73ed"]],
  ["shopping-cart", ["shopping", "purchase", "cart", "product", "\u8d2d\u7269", "\u91c7\u8d2d", "\u5546\u54c1"]],
  ["wallet", ["finance", "budget", "bank", "expense", "\u8d22\u52a1", "\u9884\u7b97", "\u94f6\u884c", "\u8d39\u7528"]],
  ["megaphone", ["marketing", "campaign", "promotion", "event", "\u8425\u9500", "\u63a8\u5e7f", "\u6d3b\u52a8"]],
  ["palette", ["design", "figma", "creative", "\u8bbe\u8ba1", "\u521b\u610f"]],
  ["message", ["communication", "email", "mail", "slack", "meeting", "\u6c9f\u901a", "\u90ae\u4ef6", "\u4f1a\u8bae"]],
  ["calendar", ["calendar", "schedule", "deadline", "\u65e5\u7a0b", "\u6392\u671f", "\u622a\u6b62"]],
  ["chart", ["analytics", "dashboard", "report", "data", "spreadsheet", "sheet", "table", "\u5206\u6790", "\u6570\u636e", "\u62a5\u8868", "\u8868\u683c"]],
  ["media", ["video", "podcast", "film", "recording", "\u89c6\u9891", "\u64ad\u5ba2", "\u5f55\u5236"]],
  ["music", ["music", "audio", "\u97f3\u4e50", "\u97f3\u9891"]],
  ["home", ["home", "renovation", "kitchen", "\u5bb6\u5ead", "\u88c5\u4fee", "\u5bb6\u5c45"]],
  ["code", ["development", "developer", "engineering", "code", "github", "\u5f00\u53d1", "\u7f16\u7a0b", "\u5de5\u7a0b"]],
  ["file-text", ["documentation", "document", "reference", "docs", "\u6587\u6863", "\u8d44\u6599", "\u53c2\u8003"]],
  ["book", ["learn", "study", "course", "reading", "\u5b66\u4e60", "\u8bfe\u7a0b", "\u9605\u8bfb"]],
  ["search", ["research", "investigation", "\u8c03\u7814", "\u7814\u7a76"]],
  ["briefcase", ["work", "office", "project", "\u5de5\u4f5c", "\u529e\u516c", "\u9879\u76ee"]]
];

export function normalizeWorkspaceIcon(value: unknown): WorkspaceIconKey {
  return typeof value === "string" && (WORKSPACE_ICON_KEYS as readonly string[]).includes(value)
    ? value as WorkspaceIconKey
    : "folder";
}

export function inferWorkspaceIcon(parts: readonly string[]): WorkspaceIconKey {
  const haystack = parts.join(" ").trim().toLowerCase();
  if (!haystack) return "folder";
  return ICON_KEYWORDS.find(([, keywords]) => keywords.some((keyword) => haystack.includes(keyword)))?.[0] ?? "folder";
}

/**
 * Assign colors within one browser window. Unused chromatic colors come first;
 * once exhausted, the least-used color wins. Stable palette order keeps a
 * regenerated preview visually consistent.
 */
export function assignWorkspaceColors(existingColors: readonly unknown[], count: number): string[] {
  const usage = new Map<string, number>(AUTO_WORKSPACE_COLORS.map((color) => [color, 0]));
  for (const rawColor of existingColors) {
    const color = normalizeGroupColor(rawColor);
    if (usage.has(color)) usage.set(color, (usage.get(color) ?? 0) + 1);
  }

  const assigned: string[] = [];
  for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
    const color = [...AUTO_WORKSPACE_COLORS].sort((left, right) =>
      (usage.get(left) ?? 0) - (usage.get(right) ?? 0)
      || AUTO_WORKSPACE_COLORS.indexOf(left) - AUTO_WORKSPACE_COLORS.indexOf(right)
    )[0];
    assigned.push(color);
    usage.set(color, (usage.get(color) ?? 0) + 1);
  }
  return assigned;
}
