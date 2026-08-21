export type DebugLogLevel = "debug" | "info" | "warn" | "error";

export interface DebugLogEntry {
  level: DebugLogLevel;
  event: string;
  data?: unknown;
  at: number;
}

export interface DebugLogger {
  readonly enabled: boolean;
  debug(event: string, data?: unknown): void;
  info(event: string, data?: unknown): void;
  warn(event: string, data?: unknown): void;
  error(event: string, data?: unknown): void;
}

export interface DebugLoggerOptions {
  enabled?: boolean;
  sink?: (entry: DebugLogEntry) => void;
  now?: () => number;
}

const SENSITIVE_KEY = /(?:api[-_ ]?key|authorization|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|credential|cookie)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi;
const OPENAI_KEY = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g;

function redactString(value: string): string {
  return value.replace(BEARER, "Bearer [REDACTED]").replace(OPENAI_KEY, "[REDACTED]");
}

/** Deeply redact secrets before they reach console, test sinks, or snapshots. */
export function redactSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {})
    };
  }
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSecrets(entry, seen);
  }
  return result;
}

class RedactingDebugLogger implements DebugLogger {
  readonly enabled: boolean;
  private readonly sink: (entry: DebugLogEntry) => void;
  private readonly now: () => number;

  constructor(options: DebugLoggerOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.sink = options.sink ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  private write(level: DebugLogLevel, event: string, data?: unknown): void {
    if (!this.enabled) return;
    this.sink({
      level,
      event: redactString(event),
      ...(data === undefined ? {} : { data: redactSecrets(data) }),
      at: this.now()
    });
  }

  debug(event: string, data?: unknown): void {
    this.write("debug", event, data);
  }

  info(event: string, data?: unknown): void {
    this.write("info", event, data);
  }

  warn(event: string, data?: unknown): void {
    this.write("warn", event, data);
  }

  error(event: string, data?: unknown): void {
    this.write("error", event, data);
  }
}

export function createDebugLogger(options: DebugLoggerOptions = {}): DebugLogger {
  return new RedactingDebugLogger(options);
}

export class DeveloperDebugMode {
  private logger: DebugLogger;

  constructor(enabled = false, sink?: (entry: DebugLogEntry) => void) {
    this.logger = createDebugLogger({ enabled, sink });
  }

  get enabled(): boolean {
    return this.logger.enabled;
  }

  getLogger(): DebugLogger {
    return this.logger;
  }

  setEnabled(enabled: boolean, sink?: (entry: DebugLogEntry) => void): void {
    this.logger = createDebugLogger({ enabled, sink });
  }
}

export const createDeveloperDebugLogger = createDebugLogger;
