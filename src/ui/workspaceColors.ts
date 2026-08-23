import { normalizeGroupColor } from "../shared/constants";

export const WORKSPACE_COLOR_OPTIONS = [
  ["grey", "石板"],
  ["blue", "蓝色"],
  ["cyan", "青色"],
  ["green", "绿色"],
  ["yellow", "琥珀"],
  ["pink", "玫瑰"],
  ["purple", "紫色"]
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
