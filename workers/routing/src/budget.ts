import {
  ACTIONS,
  DEFAULT_LIMITS,
  ENDPOINTS,
  type Action,
  type BillableProvider,
  type Endpoint,
  type RoutingLimits,
} from "./limits";
import type { DurableObjectStateLike, DurableObjectStorageLike } from "./types";

/**
 * Presupuesto global, persistente y atómico. Vive en un único Durable Object
 * con almacenamiento SQLite (plan Free): sobrevive a despliegues y reinicios,
 * y todas las comprobaciones de una reserva se ejecutan en una transacción
 * síncrona, sin `await` intermedio, de modo que dos peticiones concurrentes
 * nunca pueden ver el mismo saldo.
 *
 * Reglas económicas:
 * - se reserva el coste máximo antes de llamar al proveedor;
 * - los créditos reservados no se devuelven nunca: un timeout o un error no
 *   demuestra que el proveedor no los haya cobrado;
 * - la liquidación solo puede subir el coste (si el real supera la cota);
 * - cualquier error del almacenamiento hace fallar la reserva (fail-closed).
 */
export type DenyReason =
  | "invalid"
  | "cooldown"
  | "duplicate"
  | "visitor-minute"
  | "visitor-day"
  | "global-minute"
  | "global-second"
  | "concurrency"
  | "budget"
  | "retry-unavailable";

export interface ReserveInput {
  visitor: string;
  provider: BillableProvider;
  action: Action;
  requestKey: string;
  items: { endpoint: Endpoint; credits: number }[];
}

export type ReserveResult =
  | { ok: true; ids: number[] }
  | { ok: false; reason: DenyReason };

export interface SettleInput {
  ids: number[];
  credits: number[];
  /** La pausa y el coste se confirman en la misma transacción. */
  pauseMs?: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pending_settlements (
     id INTEGER PRIMARY KEY, credits INTEGER NOT NULL, pause_until INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reservations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     provider TEXT NOT NULL,
     endpoint TEXT NOT NULL,
     credits INTEGER NOT NULL CHECK (credits > 0),
     status TEXT NOT NULL,
     request_key TEXT NOT NULL,
     attempt INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS reservations_window
     ON reservations (provider, endpoint, created_at)`,
  `CREATE INDEX IF NOT EXISTS reservations_key ON reservations (request_key)`,
  `CREATE TABLE IF NOT EXISTS visitor_events (
     visitor TEXT NOT NULL,
     kind TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS visitor_events_window
     ON visitor_events (kind, visitor, created_at)`,
  `CREATE TABLE IF NOT EXISTS cooldowns (
     provider TEXT PRIMARY KEY,
     until INTEGER NOT NULL
   )`,
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const isText = (value: unknown, max = 128): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export class BudgetLedger {
  constructor(
    private readonly storage: DurableObjectStorageLike,
    private readonly limits: RoutingLimits = DEFAULT_LIMITS,
    private readonly now: () => number = Date.now,
  ) {
    for (const statement of SCHEMA) storage.sql.exec(statement);
  }

  private number(query: string, ...bindings: (string | number)[]): number {
    const [row] = this.storage.sql.exec(query, ...bindings).toArray();
    const value = row ? Object.values(row)[0] : 0;
    return typeof value === "number" ? value : 0;
  }

  private isValid(input: ReserveInput): boolean {
    const { items } = input;
    return (
      isText(input.visitor) &&
      isText(input.requestKey, 256) &&
      input.provider in this.limits.providerCredits &&
      ACTIONS.includes(input.action) &&
      Array.isArray(items) &&
      items.length >= 1 &&
      items.length <= 4 &&
      items.every(
        (item) =>
          ENDPOINTS.includes(item.endpoint) &&
          Number.isInteger(item.credits) &&
          item.credits >= 1 &&
          item.credits <= this.limits.maxCreditsPerReservation,
      )
    );
  }

  cleanup(now = this.now()): void {
    const before = now - this.limits.retentionMs;
    this.storage.transactionSync(() => {
      this.storage.sql.exec(
        "DELETE FROM reservations WHERE created_at <= ? AND status = 'settled'",
        before,
      );
      // Una deuda nunca caduca, pero su identificador se elimina igualmente.
      this.storage.sql.exec(
        "UPDATE reservations SET request_key = '' WHERE created_at <= ? AND request_key != ''",
        before,
      );
      this.storage.sql.exec(
        "DELETE FROM visitor_events WHERE created_at <= ?",
        before,
      );
    });
  }

  nextCleanup(): number | null {
    const at = this.number(`SELECT MIN(created_at) FROM (
      SELECT created_at FROM reservations WHERE request_key != ''
      UNION ALL SELECT created_at FROM visitor_events)`);
    // MIN(NULL) se distingue de un registro creado en el instante cero.
    const count =
      this.number("SELECT COUNT(*) FROM reservations WHERE request_key != ''") +
      this.number("SELECT COUNT(*) FROM visitor_events");
    return count
      ? Math.max(this.now() + 1, at + this.limits.retentionMs)
      : null;
  }

  private eventCount(kind: string, since: number, visitor?: string): number {
    return visitor
      ? this.number(
          "SELECT COUNT(*) FROM visitor_events WHERE kind = ? AND visitor = ? AND created_at > ?",
          kind,
          visitor,
          since,
        )
      : this.number(
          "SELECT COUNT(*) FROM visitor_events WHERE kind = ? AND created_at > ?",
          kind,
          since,
        );
  }

  private denyByRate(input: ReserveInput, now: number): DenyReason | null {
    const { visitor: v, global: g } = this.limits;
    const kind =
      input.action === "nearby" ||
      input.action === "trip-route" ||
      input.action === "trip-legs" ||
      input.action === "selected-route"
        ? "search"
        : input.action === "autocomplete"
          ? "autocomplete"
          : null;
    if (!kind) return null;
    const [perMinute, perDay, globalPerMinute] =
      kind === "search"
        ? [v.searchesPerMinute, v.searchesPerDay, g.searchesPerMinute]
        : [
            v.autocompletePerMinute,
            v.autocompletePerDay,
            g.autocompletePerMinute,
          ];
    if (this.eventCount(kind, now - MINUTE, input.visitor) >= perMinute) {
      return "visitor-minute";
    }
    if (this.eventCount(kind, now - DAY, input.visitor) >= perDay) {
      return "visitor-day";
    }
    if (this.eventCount(kind, now - MINUTE) >= globalPerMinute) {
      return "global-minute";
    }
    return null;
  }

  private exceedsBudget(input: ReserveInput, now: number): boolean {
    const since = now - this.limits.windowMs;
    const requested = new Map<Endpoint, number>();
    for (const item of input.items) {
      requested.set(
        item.endpoint,
        (requested.get(item.endpoint) ?? 0) + item.credits,
      );
    }
    for (const [endpoint, credits] of requested) {
      const spent = this.number(
        "SELECT COALESCE(SUM(credits), 0) FROM reservations WHERE provider = ? AND endpoint = ? AND created_at > ?",
        input.provider,
        endpoint,
        since,
      );
      if (spent + credits > this.limits.endpointCredits[endpoint]) return true;
    }
    const total = [...requested.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    const spentByProvider = this.number(
      "SELECT COALESCE(SUM(credits), 0) FROM reservations WHERE provider = ? AND created_at > ?",
      input.provider,
      since,
    );
    return (
      spentByProvider + total > this.limits.providerCredits[input.provider]
    );
  }

  reserve(input: ReserveInput): ReserveResult {
    if (!this.isValid(input)) return { ok: false, reason: "invalid" };
    this.reconcile();
    this.cleanup();

    return this.storage.transactionSync((): ReserveResult => {
      const now = this.now();

      const cooldown = this.number(
        "SELECT COALESCE(MAX(until), 0) FROM cooldowns WHERE provider = ?",
        input.provider,
      );
      if (cooldown > now) return { ok: false, reason: "cooldown" };

      const recentWithKey = this.number(
        "SELECT COUNT(*) FROM reservations WHERE request_key = ? AND created_at > ?",
        input.requestKey,
        now - this.limits.duplicateWindowMs,
      );
      if (input.action === "retry") {
        // Un único reintento por operación y solo tras un primer intento reciente.
        const retried = this.number(
          "SELECT COUNT(*) FROM reservations WHERE request_key = ? AND attempt = 2",
          input.requestKey,
        );
        if (recentWithKey === 0 || retried > 0) {
          return { ok: false, reason: "retry-unavailable" };
        }
      } else if (recentWithKey > 0) {
        return { ok: false, reason: "duplicate" };
      }

      const rate = this.denyByRate(input, now);
      if (rate) return { ok: false, reason: rate };

      const inFlight = this.number(
        "SELECT COUNT(*) FROM reservations WHERE status = 'in_flight'",
      );
      // Una sola operación atómica a la vez (hasta cuatro llamadas). No podemos
      // distinguir una llamada activa de una liquidación perdida en tránsito:
      // cualquier pendiente bloquea nuevas operaciones hasta reconciliarse.
      if (inFlight > 0 || input.items.length > this.limits.global.maxInFlight) {
        return { ok: false, reason: "concurrency" };
      }

      const recentCalls = this.number(
        "SELECT COUNT(*) FROM reservations WHERE created_at > ?",
        now - 1000,
      );
      if (
        recentCalls + input.items.length >
        this.limits.global.requestsPerSecond
      )
        return { ok: false, reason: "global-second" };

      if (this.exceedsBudget(input, now))
        return { ok: false, reason: "budget" };

      // Todo comprobado: se registra en la misma transacción.
      const attempt = input.action === "retry" ? 2 : 1;
      const ids = input.items.map((item) =>
        this.number(
          `INSERT INTO reservations (provider, endpoint, credits, status, request_key, attempt, created_at)
           VALUES (?, ?, ?, 'in_flight', ?, ?, ?) RETURNING id`,
          input.provider,
          item.endpoint,
          item.credits,
          input.requestKey,
          attempt,
          now,
        ),
      );
      if (
        input.action === "nearby" ||
        input.action === "trip-route" ||
        input.action === "trip-legs" ||
        input.action === "selected-route"
      ) {
        this.storage.sql.exec(
          "INSERT INTO visitor_events (visitor, kind, created_at) VALUES (?, 'search', ?)",
          input.visitor,
          now,
        );
      } else if (input.action === "autocomplete") {
        this.storage.sql.exec(
          "INSERT INTO visitor_events (visitor, kind, created_at) VALUES (?, 'autocomplete', ?)",
          input.visitor,
          now,
        );
      }
      return { ok: true, ids };
    });
  }

  /** Cierra reservas; el coste solo sube si el real supera lo reservado. */
  settle({ ids, credits, pauseMs = 0 }: SettleInput): void {
    if (
      !Array.isArray(ids) ||
      !Array.isArray(credits) ||
      ids.length !== credits.length ||
      !Number.isFinite(pauseMs) ||
      pauseMs < 0 ||
      ![...ids, ...credits].every(
        (value) => Number.isInteger(value) && value >= 0,
      )
    ) {
      throw new Error("Liquidación no válida.");
    }
    // Diario persistente antes de aplicar coste y pausa. Si el segundo paso
    // falla, reserve() lo reconciliará antes de conceder una nueva operación.
    this.storage.transactionSync(() => {
      ids.forEach((id, index) => {
        const [row] = this.storage.sql
          .exec("SELECT id FROM reservations WHERE id = ?", id)
          .toArray();
        if (!row) throw new Error("Reserva desconocida.");
        this.storage.sql.exec(
          `INSERT INTO pending_settlements (id, credits, pause_until) VALUES (?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET credits = MAX(credits, excluded.credits), pause_until = MAX(pause_until, excluded.pause_until)`,
          id,
          credits[index],
          pauseMs > 0 ? this.now() + pauseMs : 0,
        );
      });
    });
    this.reconcile();
  }

  reconcile(): void {
    this.storage.transactionSync(() => {
      const rows = this.storage.sql
        .exec(
          `SELECT p.id, p.credits, p.pause_until, r.provider
        FROM pending_settlements p JOIN reservations r ON r.id = p.id`,
        )
        .toArray();
      for (const row of rows) {
        if (Number(row.pause_until) > 0) {
          this.storage.sql.exec(
            `INSERT INTO cooldowns (provider, until) VALUES (?, ?)
            ON CONFLICT (provider) DO UPDATE SET until = MAX(until, excluded.until)`,
            row.provider,
            row.pause_until,
          );
        }
        this.storage.sql.exec(
          "UPDATE reservations SET status = 'settled', credits = MAX(credits, ?) WHERE id = ?",
          row.credits,
          row.id,
        );
        this.storage.sql.exec(
          "DELETE FROM pending_settlements WHERE id = ?",
          row.id,
        );
      }
    });
  }

  /** Pausa el proveedor (por ejemplo, tras un 429). Nunca acorta una pausa vigente. */
  pause(provider: BillableProvider, durationMs: number): void {
    if (!(provider in this.limits.providerCredits)) {
      throw new Error("Proveedor desconocido.");
    }
    const until = this.now() + Math.max(0, durationMs);
    this.storage.sql.exec(
      `INSERT INTO cooldowns (provider, until) VALUES (?, ?)
       ON CONFLICT (provider) DO UPDATE SET until = MAX(until, excluded.until)`,
      provider,
      until,
    );
  }

  /** Créditos consumidos en la ventana vigente, para pruebas y diagnóstico. */
  spent(provider: BillableProvider): number {
    return this.number(
      "SELECT COALESCE(SUM(credits), 0) FROM reservations WHERE provider = ? AND created_at > ?",
      provider,
      this.now() - this.limits.windowMs,
    );
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Durable Object. Solo lo invoca el Worker por su binding: no tiene ruta
 * pública. Cualquier excepción devuelve 500 y el Worker bloquea la consulta.
 */
export class RoutingBudget {
  private ledger: BudgetLedger | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    _env?: unknown,
    private readonly limits: RoutingLimits = DEFAULT_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  private getLedger(): BudgetLedger {
    this.ledger ??= new BudgetLedger(this.state.storage, this.limits, this.now);
    return this.ledger;
  }

  private async scheduleCleanup() {
    const next = this.getLedger().nextCleanup();
    if (next === null) await this.state.storage.deleteAlarm();
    else await this.state.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    this.getLedger().cleanup();
    await this.scheduleCleanup();
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      const body = (await request.json()) as Record<string, unknown>;
      const ledger = this.getLedger();
      if (pathname === "/reserve") {
        // Programar antes de devolver la reserva: sin alarma no sale ninguna
        // petición. Una reserva persistida sin respuesta sigue bloqueando.
        const result = ledger.reserve(body as unknown as ReserveInput);
        await this.scheduleCleanup();
        return json(result);
      }
      if (pathname === "/settle") {
        ledger.settle(body as unknown as SettleInput);
        return json({ ok: true });
      }
      if (pathname === "/pause") {
        ledger.pause(
          body.provider as BillableProvider,
          Number(body.durationMs) || 0,
        );
        return json({ ok: true });
      }
      return json({ ok: false }, 404);
    } catch {
      return json({ ok: false }, 500);
    }
  }
}
