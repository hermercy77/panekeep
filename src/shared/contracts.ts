import { z } from "zod";

export const tabKindSchema = z.enum(["normal", "special", "fixed"]);
export type TabKind = z.infer<typeof tabKindSchema>;

export const tabRecordSchema = z.object({
  id: z.string(),
  windowKey: z.string(),
  workspaceId: z.string().nullable(),
  kind: tabKindSchema,
  url: z.string(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  index: z.number().int().nonnegative(),
  pinned: z.boolean(),
  groupId: z.number().int().optional(),
  lastActivatedAt: z.number().optional(),
  specialReason: z.string().optional()
});
export type TabRecord = z.infer<typeof tabRecordSchema>;

export const workspaceSchema = z.object({
  id: z.string(),
  windowKey: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  tags: z.array(z.string()).default([]),
  color: z.string().default("grey"),
  groupId: z.number().int().optional(),
  order: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  updatedAt: z.number()
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const windowStateSchema = z.object({
  key: z.string(),
  nativeId: z.number().int(),
  name: z.string().default(""),
  order: z.number().int().nonnegative().default(0),
  isCurrent: z.boolean().default(false),
  expanded: z.boolean().default(false)
});
export type WindowState = z.infer<typeof windowStateSchema>;

export const specialTabSchema = tabRecordSchema.extend({
  kind: z.literal("special")
});
export type SpecialTab = z.infer<typeof specialTabSchema>;

export const aiConfigSchema = z.object({
  baseUrl: z.string().url().default("https://api.openai.com/v1"),
  apiKey: z.string().default(""),
  model: z.string().default("")
});
export type AIConfig = z.infer<typeof aiConfigSchema>;

export const organizationModeSchema = z.enum(["purpose", "type"]);
export type OrganizationMode = z.infer<typeof organizationModeSchema>;

export const organizationPreviewSchema = z.object({
  mode: organizationModeSchema,
  sourceTabIds: z.array(z.string()),
  /** Local-only fingerprint used to reject a stale preview at confirmation. */
  sourceFingerprint: z.string().min(1),
  groups: z.array(z.object({
    id: z.string(),
    name: z.string().min(1),
    description: z.string().default(""),
    tags: z.array(z.string()).default([]),
    existingWorkspaceId: z.string().nullable(),
    tabIds: z.array(z.string())
  })),
  unclassifiedTabIds: z.array(z.string())
});
export type OrganizationPreview = z.infer<typeof organizationPreviewSchema>;

export const backupSchema = z.object({
  schemaVersion: z.literal(1),
  product: z.literal("tab-fridge"),
  browserFamily: z.string(),
  exportedAt: z.string(),
  windows: z.array(windowStateSchema),
  workspaces: z.array(workspaceSchema),
  tabs: z.array(tabRecordSchema)
});
export type Backup = z.infer<typeof backupSchema>;
