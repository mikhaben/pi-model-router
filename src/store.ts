import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** The database lives beside pi's other agent state, at `<agentDir>/pi-model-router.db`. */
export const DB_FILENAME = "pi-model-router.db";

// Every pi session on the machine opens this one file, so writes wait out a peer's
// transaction rather than failing. 1,000 ms covers the single-row writes here.
const DEFAULT_BUSY_TIMEOUT_MS = 1_000;
// Concurrent first-opens negotiating WAL return SQLITE_BUSY immediately instead of
// honouring busy_timeout, so opening polls until the winner finishes.
const OPEN_RETRY_POLL_MS = 25;
const SLEEP_SIGNAL = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

export interface RouterEvent {
  at: string;
  provider: string;
  model: string;
  kind: "limit" | "error" | "switch";
  httpStatus?: number;
  detail?: string;
  cooldownUntil?: string;
}

interface EventRow {
  at: string;
  provider: string;
  model: string;
  kind: RouterEvent["kind"];
  http_status: number | null;
  detail: string | null;
  cooldown_until: string | null;
}

export class RouterStore {
  private readonly db: DatabaseSync;
  private readonly onError: ((message: string) => void) | undefined;

  constructor(dbPath: string, onError?: (message: string) => void) {
    this.db = openDatabase(dbPath);
    this.onError = onError;
  }

  record(event: RouterEvent): void {
    try {
      this.db.prepare(`
        INSERT INTO events(at, provider, model, kind, http_status, detail, cooldown_until)
        VALUES(?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.at,
        event.provider,
        event.model,
        event.kind,
        event.httpStatus ?? null,
        event.detail ?? null,
        event.cooldownUntil ?? null,
      );
    } catch (error) {
      this.reportError(error);
    }
  }

  activeCooldowns(nowIso: string): Map<string, string> {
    const rows = this.db.prepare(`
      SELECT provider, model, MAX(cooldown_until) AS until
      FROM events
      WHERE kind = 'limit' AND cooldown_until > ?
      GROUP BY provider, model
    `).all(nowIso) as unknown as Array<{ provider: string; model: string; until: string }>;

    return new Map(rows.map((row) => [`${row.provider}/${row.model}`, row.until]));
  }

  recentEvents(sinceIso: string): RouterEvent[] {
    const rows = this.db.prepare(`
      SELECT at, provider, model, kind, http_status, detail, cooldown_until
      FROM events
      WHERE at >= ?
      ORDER BY id
    `).all(sinceIso) as unknown as EventRow[];

    return rows.map((row) => {
      const event: RouterEvent = {
        at: row.at,
        provider: row.provider,
        model: row.model,
        kind: row.kind,
      };
      if (row.http_status !== null) event.httpStatus = Number(row.http_status);
      if (row.detail !== null) event.detail = row.detail;
      if (row.cooldown_until !== null) event.cooldownUntil = row.cooldown_until;
      return event;
    });
  }

  close(): void {
    this.db.close();
  }

  private reportError(error: unknown): void {
    if (!this.onError) return;
    try {
      this.onError(errorMessage(error));
    } catch {
      // A tracking notification must not turn a failed write into a routing failure.
    }
  }
}

export function openStore(
  dbPath: string,
  onError?: (message: string) => void,
): { store: RouterStore } | { error: string } {
  try {
    return { store: new RouterStore(dbPath, onError) };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const started = performance.now();

  for (;;) {
    const db = new DatabaseSync(dbPath, { timeout: DEFAULT_BUSY_TIMEOUT_MS });
    try {
      db.exec(`PRAGMA busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);
      // First-open WAL negotiation can return SQLITE_BUSY before the configured
      // timeout; retry the whole setup within the same lock budget.
      db.exec("PRAGMA journal_mode = WAL");
      initializeSchema(db);
      return db;
    } catch (error) {
      try {
        db.close();
      } catch {
        // Preserve the setup error if closing a partially opened database fails.
      }

      const elapsed = performance.now() - started;
      if (!isSqliteBusy(error) || elapsed >= DEFAULT_BUSY_TIMEOUT_MS) {
        throw error;
      }
      const remaining = DEFAULT_BUSY_TIMEOUT_MS - elapsed;
      Atomics.wait(SLEEP_SIGNAL, 0, 0, Math.min(OPEN_RETRY_POLL_MS, remaining));
    }
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      kind TEXT NOT NULL,
      http_status INTEGER,
      detail TEXT,
      cooldown_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
  `);
}

function isSqliteBusy(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "errcode" in error
    && typeof error.errcode === "number") {
    const resultCode = error.errcode & 0xff;
    return resultCode === 5 || resultCode === 6;
  }
  return error instanceof Error && /^database is (?:locked|busy)$/i.test(error.message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
