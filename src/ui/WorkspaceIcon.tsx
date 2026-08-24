import {
  BarChart3,
  BookOpen,
  Briefcase,
  CalendarDays,
  Code2,
  FileText,
  Film,
  Folder,
  Home,
  Megaphone,
  MessageSquare,
  Music2,
  Palette,
  Plane,
  Search,
  ShieldCheck,
  ShoppingCart,
  Wallet
} from "lucide-react";
import type { WorkspaceIconKey } from "../shared/workspaceAppearance";

const ICONS = {
  folder: Folder,
  briefcase: Briefcase,
  code: Code2,
  book: BookOpen,
  search: Search,
  "file-text": FileText,
  palette: Palette,
  message: MessageSquare,
  calendar: CalendarDays,
  plane: Plane,
  "shopping-cart": ShoppingCart,
  wallet: Wallet,
  chart: BarChart3,
  megaphone: Megaphone,
  media: Film,
  music: Music2,
  home: Home,
  shield: ShieldCheck
} satisfies Record<WorkspaceIconKey, typeof Folder>;

export function WorkspaceIcon({ icon, size = 14 }: { icon: WorkspaceIconKey; size?: number }) {
  const Icon = ICONS[icon] ?? Folder;
  return <Icon aria-hidden="true" size={size} strokeWidth={1.9} />;
}
