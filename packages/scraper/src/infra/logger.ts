type Level = "debug" | "info" | "warn" | "error";

function write(stream: "stdout" | "stderr", msg: string): void {
  const out = stream === "stdout" ? Bun.stdout : Bun.stderr;
  Bun.write(out, msg + "\n");
}

export type Logger = {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

export function createLogger(enabled: boolean, minLevel: Level = "info"): Logger {
  const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = order[minLevel];
  const emit = (level: Level, msg: string): void => {
    if (!enabled) return;
    if (order[level] < threshold) return;
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level.toUpperCase()}] ${msg}`;
    write(level === "error" ? "stderr" : "stdout", line);
  };
  return {
    debug: (m) => emit("debug", m),
    info: (m) => emit("info", m),
    warn: (m) => emit("warn", m),
    error: (m) => emit("error", m),
  };
}


