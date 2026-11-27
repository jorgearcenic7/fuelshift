/**
 * Subconjunto de las APIs de Cloudflare que usa el Worker. Se declaran aquí
 * para no añadir dependencias de tipos y para poder probar el código en Node
 * con implementaciones equivalentes (SQLite de Node para el almacenamiento).
 * Firmas según https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/.
 */
export type SqlValue = string | number | null;

export interface SqlCursor {
  toArray(): Record<string, SqlValue>[];
}

export interface SqlStorage {
  exec(query: string, ...bindings: SqlValue[]): SqlCursor;
}

export interface DurableObjectStorageLike {
  sql: SqlStorage;
  /** Ejecuta el callback en una transacción; si lanza, se revierte. */
  transactionSync<T>(callback: () => T): T;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export interface DurableObjectStubLike {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface Env {
  /** Interruptor general: cualquier valor distinto de "true" lo desactiva. */
  ROUTING_ENABLED?: string;
  /** Interruptor de emergencia del proveedor. */
  GEOAPIFY_ENABLED?: string;
  /**
   * Solo el valor exacto `CHARGE_GUARANTEE_CONFIRMED` de costs.ts (garantía
   * escrita del proveedor) habilita matriz y ruta.
   */
  GEOAPIFY_CHARGE_GUARANTEE?: string;
  /** Secreto de Wrangler; nunca en el repositorio ni en el navegador. */
  GEOAPIFY_API_KEY?: string;
  /** Secreto para seudonimizar la IP del visitante. */
  VISITOR_SALT?: string;
  /** Orígenes permitidos separados por comas. */
  ALLOWED_ORIGINS?: string;
  ROUTING_BUDGET: DurableObjectNamespaceLike;
}
