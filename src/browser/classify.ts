import type { TabKind } from "../shared/contracts";
import { isSpecialPageUrl, nativeGroupId, specialPageReason } from "../shared/constants";

export interface BrowserTabLike {
  id?: number;
  windowId?: number;
  groupId?: number;
  index?: number;
  pinned?: boolean;
  active?: boolean;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

export function classifyBrowserTab(tab: BrowserTabLike): TabKind {
  // Browser-controlled pages win over pinned status. They are never eligible
  // for workspace operations even if a browser reports them as pinned.
  if (isSpecialPageUrl(tab.url)) return "special";
  if (tab.pinned === true) return "fixed";
  return "normal";
}

export function browserTabGroupId(tab: BrowserTabLike): number | undefined {
  return nativeGroupId(tab.groupId);
}

export function browserTabSpecialReason(tab: BrowserTabLike): string | undefined {
  return specialPageReason(tab.url);
}

