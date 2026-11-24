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
      void this.flush().catch(() => undefined);
    }, this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.running) return this.running;
    if (!this.pending) return;

    this.running = Promise.resolve().then(async () => {
      try {
        while (this.pending) {
          this.pending = false;
          await this.saveOperation();
        }
      } catch (error) {
        this.pending = true;
        throw error;
      } finally {
        this.running = undefined;
      }
    });
    return this.running;
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }
}

