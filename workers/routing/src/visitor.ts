/**
 * Identificador seudónimo del visitante para los límites por visitante. Se
 * guarda solo un hash con secreto de la red de origen, nunca la IP, y se
 * borra pasadas 48 h. Es una defensa complementaria: rotar IP la esquiva, por
 * eso el presupuesto global es el que garantiza el coste.
 */

/** IPv4 tal cual; IPv6 reducida a su /64, que un mismo cliente controla entero. */
export function visitorNetwork(ip: string | null): string | null {
  if (!ip) return null;
  const value = ip.trim();
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255) ? value : null;
  }
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(":")) return null;

  const halves = value.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.some((group) => group.length === 0 || group.length > 4))
    return null;
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":")}::/64`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function visitorId(
  network: string,
  salt: string,
): Promise<string> {
  return (await sha256Hex(`${salt}|${network}`)).slice(0, 32);
}

/** Clave de la operación para detectar duplicados del mismo visitante. */
export async function requestKey(
  visitor: string,
  path: string,
  payload: unknown,
): Promise<string> {
  return sha256Hex(`${visitor}|${path}|${JSON.stringify(payload)}`);
}
