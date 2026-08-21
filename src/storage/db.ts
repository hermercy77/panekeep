import Dexie, { type Table } from "dexie";
import type { TabRecord, WindowState, Workspace } from "../shared/contracts";
import type { StateSnapshot } from "../shared/backup";

export const TAB_FRIDGE_DATABASE_NAME = "tab-fridge";
export const TAB_FRIDGE_DATABASE_VERSION = 1;

export interface StoredMeta {
  key: string;
  value: string;
}

/** IndexedDB database for browser state. API keys are intentionally not stored here. */
export class TabFridgeDatabase extends Dexie {
  windows!: Table<WindowState, string>;
  workspaces!: Table<Workspace, string>;
  tabs!: Table<TabRecord, string>;
  meta!: Table<StoredMeta, string>;

  constructor(name = TAB_FRIDGE_DATABASE_NAME) {
    super(name);
    this.version(TAB_FRIDGE_DATABASE_VERSION).stores({
      windows: "&key,nativeId,order",
      workspaces: "&id,windowKey,order,groupId",
      tabs: "&id,windowKey,workspaceId,kind,index,groupId,lastActivatedAt",
      meta: "&key"
    });
  }
}

export const db = new TabFridgeDatabase();

export async function readSnapshot(database: TabFridgeDatabase = db): Promise<StateSnapshot> {
  const [windows, workspaces, tabs] = await Promise.all([
    database.windows.toArray(),
    database.workspaces.toArray(),
    database.tabs.toArray()
  ]);
  return { windows, workspaces, tabs };
}

export async function replaceSnapshot(
  snapshot: StateSnapshot,
  database: TabFridgeDatabase = db
): Promise<void> {
  await database.transaction("rw", database.windows, database.workspaces, database.tabs, async () => {
    await Promise.all([database.windows.clear(), database.workspaces.clear(), database.tabs.clear()]);
    if (snapshot.windows.length > 0) await database.windows.bulkPut(snapshot.windows);
    if (snapshot.workspaces.length > 0) await database.workspaces.bulkPut(snapshot.workspaces);
    if (snapshot.tabs.length > 0) await database.tabs.bulkPut(snapshot.tabs);
  });
}

