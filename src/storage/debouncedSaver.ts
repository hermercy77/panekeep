export type SaveOperation = () => Promise<void> | void;

/** Coalesces browser event bursts into one IndexedDB write. */
export class DebouncedSaver {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private running: Promise<void> | undefined;

  constructor(
    private readonly saveOperation: SaveOperation,
    private readonly delayMs = 250
  ) {}

  schedule(): void {
    this.pending = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.pending) {
      await this.running;
      return;
    }
    this.pending = false;
    const operation = Promise.resolve(this.saveOperation());
    this.running = operation;
    try {
      await operation;
    } finally {
      if (this.running === operation) this.running = undefined;
      if (this.pending) await this.flush();
    }
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }
}

