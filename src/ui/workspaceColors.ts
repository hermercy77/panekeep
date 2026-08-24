import { normalizeGroupColor } from "../shared/constants";

export const WORKSPACE_COLOR_OPTIONS = [
  ["grey", "color.grey"],
  ["blue", "color.blue"],
  ["cyan", "color.cyan"],
  ["green", "color.green"],
  ["yellow", "color.yellow"],
  ["pink", "color.pink"],
  ["purple", "color.purple"]
] as const;

export function workspaceColorClass(color: unknown): "slate" | "blue" | "cyan" | "green" | "amber" | "rose" | "violet" {
  switch (normalizeGroupColor(color)) {
    case "blue": return "blue";
    case "cyan": return "cyan";
    case "green": return "green";
    case "orange":
    case "yellow": return "amber";
    case "pink":
    case "red": return "rose";
    case "purple": return "violet";
    default: return "slate";
  }
}
