export const validOrganizationResponse = {
  groups: [
    {
      id: "research",
      name: "Research",
      description: "Reference material",
      tags: ["research"],
      existingWorkspaceId: null,
      tabIds: ["tab-1", "tab-2"]
    }
  ],
  unclassifiedTabIds: ["tab-3"]
} as const;

export const tabsFixture = [
  {
    id: "tab-1",
    windowKey: "window-1",
    workspaceId: null,
    kind: "normal" as const,
    url: "https://example.com/docs",
    title: "Docs",
    index: 0,
    pinned: false
  },
  {
    id: "tab-2",
    windowKey: "window-1",
    workspaceId: null,
    kind: "normal" as const,
    url: "https://example.com/research",
    title: "Research",
    index: 1,
    pinned: false
  },
  {
    id: "tab-3",
    windowKey: "window-1",
    workspaceId: null,
    kind: "normal" as const,
    url: "https://example.com/other",
    title: "Other",
    index: 2,
    pinned: false
  }
] as const;
