// Prueba del Worker y SQLite de Durable Objects en workerd, vía Wrangler local.
// El entrypoint de prueba sustituye todas las consultas externas por fixtures.
import assert from "node:assert/strict";
import { unstable_dev } from "wrangler";

const worker = await unstable_dev("workers/routing/test/runtime-worker.ts", {
  config: "workers/routing/wrangler.toml",
  local: true,
  ip: "127.0.0.1",
  port: 0,
  persist: false,
  logLevel: "error",
  vars: {
    ROUTING_ENABLED: "true",
    GEOAPIFY_ENABLED: "true",
    GEOAPIFY_CHARGE_GUARANTEE: "confirmada-por-escrito",
    GEOAPIFY_API_KEY: "fixture-local-no-real",
    VISITOR_SALT: "fixture-local-no-real",
    ALLOWED_ORIGINS: "https://fuelshift.pages.dev",
  },
  experimental: {
    disableExperimentalWarning: true,
    disableDevRegistry: true,
    watch: false,
  },
});
try {
  const start = { latitude: 40.4, longitude: -3.7 };
  const station = { latitude: 40.41, longitude: -3.7 };
  const headers = {
    Origin: "https://fuelshift.pages.dev",
    "Content-Type": "application/json",
    "CF-Connecting-IP": "203.0.113.7",
  };
  const send = (path, body) =>
    worker.fetch(`http://localhost${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const legs = await send("/v1/legs", {
    start,
    end: start,
    locations: [station],
  });
  assert.equal(legs.status, 200);
  assert.equal((await legs.json()).toStation[0].distanceMeters, 1000);
  const route = await send("/v1/route", { start, end: start, via: station });
  assert.equal(route.status, 200);
  assert.equal((await route.json()).geometry.length, 3);
  const stats = await (await worker.fetch("http://localhost/__stats")).json();
  assert.deepEqual(
    stats.rows.map((row) => row.status),
    ["settled", "settled", "settled"],
  );
  assert.equal(
    stats.rows.reduce((sum, row) => sum + row.credits, 0),
    4,
  );
  assert.equal(stats.pending.length, 0);
  assert.equal(typeof stats.alarm, "number");
  console.log(
    "Wrangler local: matrices, ruta seleccionada, SQL, diario y alarma correctos; sin proveedores reales.",
  );
} finally {
  await worker.stop();
}
