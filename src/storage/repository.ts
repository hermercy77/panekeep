import type { Backup } from "../shared/contracts";
import { createBackup, parseBackup, type StateSnapshot } from "../shared/backup";
import { db, readSnapshot, replaceSnapshot, type TabFridgeDatabase } from "./db";

export interface StateRepository {
  load(): Promise<StateSnapshot>;
  replace(snapshot: StateSnapshot): Promise<void>;
}

export class DexieStateRepository implements StateRepository {
  constructor(private readonly database: TabFridgeDatabase = db) {}

  load(): Promise<StateSnapshot> {
    return readSnapshot(this.database);
  }

  replace(snapshot: StateSnapshot): Promise<void> {
    return replaceSnapshot(snapshot, this.database);
  }
}

export class MemoryStateRepository implements StateRepository {
  private snapshot: StateSnapshot = { windows: [], workspaces: [], tabs: [] };

  constructor(snapshot?: StateSnapshot) {
    if (snapshot) this.snapshot = cloneSnapshot(snapshot);
  }

  async load(): Promise<StateSnapshot> {
    return cloneSnapshot(this.snapshot);
  }

  async replace(snapshot: StateSnapshot): Promise<void> {
    this.snapshot = cloneSnapshot(snapshot);
  }
}

export async function exportRepositoryBackup(
  repository: StateRepository,
  browserFamily?: string
): Promise<Backup> {
  return createBackup(await repository.load(), browserFamily);
}

export async function importRepositoryBackup(
  repository: StateRepository,
  value: unknown
): Promise<Backup> {
  const backup = parseBackup(value);
  await repository.replace({
    windows: backup.windows,
    workspaces: backup.workspaces,
    tabs: backup.tabs
  });
  return backup;
}

function cloneSnapshot(snapshot: StateSnapshot): StateSnapshot {
  return {
    windows: snapshot.windows.map((window) => ({ ...window })),
    workspaces: snapshot.workspaces.map((workspace) => ({
      ...workspace,
      tags: [...workspace.tags]
    })),
    tabs: snapshot.tabs.map((tab) => ({ ...tab }))
  };
}

