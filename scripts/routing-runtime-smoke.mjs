// Prueba del Worker y SQLite de Durable Objects en workerd, vía Wrangler local.
// El entrypoint de prueba sustituye todas las consultas externas por fixtures:
// ninguna petición sale hacia Geoapify ni hacia otra red.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { unstable_dev } from "wrangler";

const ORIGIN = "https://fuelshift.pages.dev";
const FIXTURE_SECRETS = {
  GEOAPIFY_API_KEY: "fixture-local-no-real",
  VISITOR_SALT: "fixture-local-no-real",
};
const ACTIVE = {
  ROUTING_ENABLED: "true",
  GEOAPIFY_ENABLED: "true",
  ALLOWED_ORIGINS: ORIGIN,
  ...FIXTURE_SECRETS,
};

/** Arranca workerd. Con `persistTo`, el SQLite sobrevive a `stop()` como en un reinicio. */
function start(vars, persistTo) {
  return unstable_dev("workers/routing/test/runtime-worker.ts", {
    config: "workers/routing/wrangler.toml",
    local: true,
    ip: "127.0.0.1",
    port: 0,
    ...(persistTo ? { persistTo } : { persist: false }),
    logLevel: "error",
    vars,
    experimental: {
      disableExperimentalWarning: true,
      disableDevRegistry: true,
      watch: false,
    },
  });
}

const headers = (ip) => ({
  Origin: ORIGIN,
  "Content-Type": "application/json",
  "CF-Connecting-IP": ip,
});
const post = (worker, route, body, ip = "203.0.113.7") =>
  worker.fetch(`http://localhost${route}`, {
    method: "POST",
    headers: headers(ip),
    body: JSON.stringify(body),
  });
const autocomplete = (worker, index) =>
  worker.fetch(`http://localhost/v1/autocomplete?text=calle%20${index}`, {
    headers: headers(`198.51.100.${index}`),
  });
const stats = async (worker) =>
  (await worker.fetch("http://localhost/__stats")).json();
const spent = (rows, endpoint) =>
  rows
    .filter((row) => !endpoint || row.endpoint === endpoint)
    .reduce((sum, row) => sum + row.credits, 0);

// 1. Confirmación escrita: presupuesto de producción, matrices, ruta, diario y alarma.
{
  const worker = await start({
    ...ACTIVE,
    GEOAPIFY_CHARGE_GUARANTEE: "confirmada-por-escrito",
  });
  try {
    const origin = { latitude: 40.4, longitude: -3.7 };
    const station = { latitude: 40.41, longitude: -3.7 };
    const legs = await post(worker, "/v1/legs", {
      start: origin,
      end: origin,
      locations: [station],
    });
    assert.equal(legs.status, 200);
    assert.equal((await legs.json()).toStation[0].distanceMeters, 1000);
    const route = await post(worker, "/v1/route", {
      start: origin,
      end: origin,
      via: station,
    });
    assert.equal(route.status, 200);
    assert.equal((await route.json()).geometry.length, 3);
    const result = await stats(worker);
    assert.equal(result.providerCredits, 2400);
    assert.deepEqual(result.endpointCredits, {
      matrix: 1800,
      routing: 300,
      autocomplete: 300,
    });
    assert.deepEqual(
      result.rows.map((row) => row.status),
      ["settled", "settled", "settled"],
    );
    assert.equal(spent(result.rows), 4);
    assert.equal(result.pending.length, 0);
    assert.equal(typeof result.alarm, "number");
  } finally {
    await worker.stop();
  }
}

const persistTo = await mkdtemp(path.join(tmpdir(), "fuelshift-rutas-"));
// Solo el entrypoint de prueba lee esta variable: reduce el presupuesto del
// autocompletado a 10 créditos para comprobar el corte sin 300 peticiones.
const SMOKE_BUDGET = {
  ...ACTIVE,
  GEOAPIFY_CHARGE_GUARANTEE: "confirmada-por-escrito",
  SMOKE_AUTOCOMPLETE_CREDITS: "10",
};
try {
  // 2. Corte del presupuesto en workerd. Pausa de 250 ms para respetar 5 llamadas/s.
  let worker = await start(SMOKE_BUDGET, persistTo);
  try {
    const statuses = [];
    for (let index = 1; index <= 11; index += 1) {
      const response = await autocomplete(worker, index);
      statuses.push(response.status);
      if (index === 11) {
        assert.equal((await response.json()).error, "quota");
      } else {
        await response.arrayBuffer();
      }
      await sleep(250);
    }
    assert.deepEqual(statuses, [...Array(10).fill(200), 503]);
    const result = await stats(worker);
    assert.equal(result.endpointCredits.autocomplete, 10);
    assert.equal(spent(result.rows, "autocomplete"), 10);
    assert.equal(result.pending.length, 0);
  } finally {
    await worker.stop();
  }

  // 3. Reinicio sobre el mismo almacenamiento: el gasto persiste y sigue cortando.
  worker = await start(SMOKE_BUDGET, persistTo);
  try {
    const response = await autocomplete(worker, 12);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "quota");
    const result = await stats(worker);
    assert.equal(spent(result.rows, "autocomplete"), 10);
    assert.equal(result.rows.length, 10);
  } finally {
    await worker.stop();
  }

  // 4. El valor del modo provisional retirado ya no habilita matriz ni ruta.
  worker = await start(
    { ...ACTIVE, GEOAPIFY_CHARGE_GUARANTEE: "provisional-sin-confirmacion" },
    persistTo,
  );
  try {
    const response = await post(worker, "/v1/legs", {
      start: { latitude: 40.4, longitude: -3.7 },
      end: { latitude: 40.4, longitude: -3.7 },
      locations: [{ latitude: 40.41, longitude: -3.7 }],
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "cost-unbounded");
    assert.equal((await stats(worker)).rows.length, 10);
  } finally {
    await worker.stop();
  }

  // 5. Clave restaurada con los valores seguros de wrangler.toml: no hay tráfico
  // ni reservas, aunque el secreto esté presente.
  worker = await start(FIXTURE_SECRETS, persistTo);
  try {
    for (const response of [
      await autocomplete(worker, 43),
      await post(worker, "/v1/legs", {
        start: { latitude: 40.4, longitude: -3.7 },
        end: { latitude: 40.4, longitude: -3.7 },
        locations: [{ latitude: 40.41, longitude: -3.7 }],
      }),
    ]) {
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, "disabled");
    }
    assert.equal((await stats(worker)).rows.length, 10);
  } finally {
    await worker.stop();
  }
} finally {
  await rm(persistTo, { recursive: true, force: true });
}

console.log(
  "Wrangler local: presupuesto de producción (2400), corte del presupuesto, persistencia tras reinicio, valor provisional retirado bloqueado y estado seguro con clave restaurada; sin proveedores reales.",
);
