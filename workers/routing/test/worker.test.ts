import { describe, expect, it } from "vitest";

import { ROUTING_LIMIT_MESSAGE } from "@/domain/refuel/road-routing";

import {
  createHarness,
  get,
  ipFor,
  madrid,
  nearbyBody,
  ORIGIN,
  post,
} from "./harness";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Límites por visitante y concurrencia muy altos para aislar el presupuesto. */
const BUDGET_ONLY = {
  visitor: {
    searchesPerMinute: 1e9,
    searchesPerDay: 1e9,
    autocompletePerMinute: 1e9,
    autocompletePerDay: 1e9,
  },
  global: {
    searchesPerMinute: 1e9,
    autocompletePerMinute: 1e9,
    maxInFlight: 1e9,
    requestsPerSecond: 1e9,
  },
};

const statusCounts = (responses: Response[]) =>
  responses.reduce<Record<number, number>>((counts, response) => {
    counts[response.status] = (counts[response.status] ?? 0) + 1;
    return counts;
  }, {});

describe("presupuesto global bajo concurrencia", () => {
  it("miles de búsquedas simultáneas desde miles de IP nunca superan el presupuesto", async () => {
    const harness = createHarness({ limits: BUDGET_ONLY });
    const responses = await Promise.all(
      Array.from({ length: 3000 }, (_, index) =>
        harness.send(post("/v1/legs", nearbyBody(), ipFor(index))),
      ),
    );

    // Cada búsqueda reserva 2 × 15 = 30 créditos de matriz (límite 1800).
    const counts = statusCounts(responses);
    expect(counts[200]).toBeGreaterThan(0);
    expect(counts[200]).toBeLessThanOrEqual(60);
    expect(
      responses.every((response) => [200, 429, 503].includes(response.status)),
    ).toBe(true);
    // La operación pendiente también puede cortar la ráfaga; después se
    // comprueba por separado que el saldo restante se agota y persiste.
    while (harness.spent("matrix") < 1800) {
      harness.advance(1001);
      await harness.send(
        post("/v1/legs", nearbyBody(), ipFor(4000 + harness.spent())),
      );
    }
    expect(harness.spent("matrix")).toBe(1800);
    expect(harness.spent()).toBeLessThanOrEqual(2400);
    expect(harness.provider.stats().charged).toBeLessThanOrEqual(1800);
    const rejected = await harness.send(
      post("/v1/legs", nearbyBody(), ipFor(9999)),
    );
    expect(await rejected.json()).toEqual({
      error: "quota",
      message: ROUTING_LIMIT_MESSAGE,
    });
  }, 30_000);

  it("agota a la vez los presupuestos de todos los endpoints sin superar ninguno", async () => {
    const harness = createHarness({ limits: BUDGET_ONLY });
    const requests = Array.from({ length: 1500 }, (_, index) => {
      const ip = ipFor(index);
      if (index % 3 === 0) return post("/v1/legs", nearbyBody(), ip);
      if (index % 3 === 1) {
        // Madrid–Toledo: sin recargo por distancia, para aislar el presupuesto.
        return post(
          "/v1/route",
          { start: madrid, end: { latitude: 39.86, longitude: -4.02 } },
          ip,
        );
      }
      return get("/v1/autocomplete?text=calle%20mayor", ip);
    });
    await Promise.all(requests.map((request) => harness.send(request)));

    expect(harness.spent("matrix")).toBeLessThanOrEqual(1800);
    expect(harness.spent("routing")).toBeLessThanOrEqual(300);
    expect(harness.spent("autocomplete")).toBeLessThanOrEqual(300);
    expect(harness.spent()).toBeLessThanOrEqual(2400);
    // Todo lo que el proveedor habría cobrado está contabilizado.
    expect(harness.provider.stats().charged).toBe(harness.spent());
  });

  it("con los límites iniciales, la concurrencia y el tope por minuto cortan antes", async () => {
    const harness = createHarness();
    const responses = await Promise.all(
      Array.from({ length: 1000 }, (_, index) =>
        harness.send(post("/v1/legs", nearbyBody(), ipFor(index))),
      ),
    );
    const counts = statusCounts(responses);
    expect(counts[200]).toBeLessThanOrEqual(30);
    expect((counts[200] ?? 0) + (counts[429] ?? 0)).toBe(1000);
    expect(harness.provider.stats().calls).toBeLessThanOrEqual(60);
  });
});

describe("coste sin cota verificable", () => {
  const barcelona = { latitude: 41.3874, longitude: 2.1686 };
  const trip = { start: madrid, end: barcelona };
  const tripLegs = {
    ...trip,
    locations: [
      { latitude: 40.9, longitude: -1.5 },
      { latitude: 41.2, longitude: 0.5 },
    ],
  };
  const withoutGuarantee = [
    { GEOAPIFY_CHARGE_GUARANTEE: undefined },
    { GEOAPIFY_CHARGE_GUARANTEE: "ninguna" },
    { GEOAPIFY_CHARGE_GUARANTEE: "sin-tarjeta" },
    { GEOAPIFY_CHARGE_GUARANTEE: "true" },
    // Valor del modo provisional retirado en 1.2.0: vuelve a bloquear.
    { GEOAPIFY_CHARGE_GUARANTEE: "provisional-sin-confirmacion" },
  ];

  it("sin garantía del proveedor bloquea matriz y ruta sin reservar ni llamar", async () => {
    for (const env of withoutGuarantee) {
      for (const roadFactor of [1, 2, 5, 10]) {
        const harness = createHarness({ env, roadFactor });
        for (const request of [
          post("/v1/route", trip),
          post("/v1/legs", nearbyBody()),
          post("/v1/legs", tripLegs),
        ]) {
          const response = await harness.send(request);
          expect(response.status).toBe(503);
          expect((await response.json()).error).toBe("cost-unbounded");
        }
        expect(harness.provider.stats().calls).toBe(0);
        expect(harness.provider.stats().charged).toBe(0);
        expect(harness.spent()).toBe(0);
      }
    }
  });

  it("sin garantía solo pasan los costes fijos, que nunca superan lo reservado", async () => {
    const harness = createHarness({
      limits: BUDGET_ONLY,
      env: { GEOAPIFY_CHARGE_GUARANTEE: undefined },
      roadFactor: 10,
    });
    const requests = Array.from({ length: 900 }, (_, index) => {
      const ip = ipFor(index);
      if (index % 3 === 0) return post("/v1/legs", nearbyBody(), ip);
      if (index % 3 === 1) return post("/v1/route", trip, ip);
      return get(`/v1/autocomplete?text=calle%20${index}`, ip);
    });
    await Promise.all(requests.map((request) => harness.send(request)));
    expect(harness.spent("matrix")).toBe(0);
    expect(harness.spent("routing")).toBe(0);
    expect(harness.spent("autocomplete")).toBe(300);
    expect(harness.provider.stats().charged).toBe(harness.spent());
  });

  // Madrid–Barcelona: ~505 km en línea recta. Con rodeos de 2, 5 y 10 veces,
  // la ruta mide ~1010, ~2525 y ~5050 km: 2, 5 y 10 recargos.
  for (const [roadFactor, surcharge] of [
    [2, 2],
    [5, 5],
    [10, 10],
  ]) {
    it(`con garantía contabiliza los recargos de una ruta ${roadFactor} veces la recta`, async () => {
      const harness = createHarness({ roadFactor });
      const route = await harness.send(post("/v1/route", trip));
      expect(route.status).toBe(200);
      expect(harness.spent("routing")).toBe(1 + surcharge);
      expect(harness.provider.stats().charged).toBe(harness.spent());

      // Los tramos del viaje también pagan cada distancia devuelta.
      expect((await harness.send(post("/v1/legs", tripLegs))).status).toBe(200);
      expect(harness.provider.stats().charged).toBe(harness.spent());
      expect(harness.spent("matrix")).toBeGreaterThan(4);
    });
  }

  it("con garantía, el coste real liquidado agota el presupuesto y corta lo siguiente", async () => {
    const harness = createHarness({
      limits: {
        ...BUDGET_ONLY,
        endpointCredits: { matrix: 1800, routing: 12, autocomplete: 300 },
      },
      roadFactor: 10,
    });
    expect((await harness.send(post("/v1/route", trip, ipFor(1)))).status).toBe(
      200,
    );
    expect(harness.spent("routing")).toBe(11);
    const next = await harness.send(post("/v1/route", trip, ipFor(2)));
    expect(next.status).toBe(200);
    // La reserva mínima (1) cabía, pero tras liquidar 11 + 11 ya no queda nada.
    const blocked = await harness.send(post("/v1/route", trip, ipFor(3)));
    expect(blocked.status).toBe(503);
    expect(harness.provider.stats().calls).toBe(2);
    expect(harness.provider.stats().charged).toBe(harness.spent());
  });

  it("los reintentos se reservan y contabilizan aparte", async () => {
    const harness = createHarness({ mode: "503-then-ok", roadFactor: 5 });
    expect((await harness.send(post("/v1/route", trip))).status).toBe(200);
    // Primer intento fallido: se mantiene su reserva (1). Segundo: 1 + 5 recargos.
    expect(harness.spent("routing")).toBe(1 + 6);
    expect(harness.provider.stats().calls).toBe(2);
  });

  it("el adaptador no envía opciones con recargo no contabilizado", async () => {
    const harness = createHarness();
    await harness.send(post("/v1/route", trip));
    await harness.send(post("/v1/legs", tripLegs));
    await harness.send(get("/v1/autocomplete?text=calle%20mayor"));
    const sent = harness.provider.stats().requests.join(" ");
    for (const option of [
      "avoid",
      "details",
      "elevation",
      "optimize",
      "traffic",
      "exclude",
    ]) {
      expect(sent).not.toContain(option);
    }
  });
});

describe("persistencia del contador", () => {
  it("un reinicio o despliegue del Worker no reinicia el presupuesto", async () => {
    const harness = createHarness({
      limits: {
        ...BUDGET_ONLY,
        endpointCredits: { matrix: 60, routing: 300, autocomplete: 300 },
      },
    });
    await harness.send(post("/v1/legs", nearbyBody(), ipFor(1)));
    await harness.send(post("/v1/legs", nearbyBody(), ipFor(2)));
    expect(harness.spent("matrix")).toBe(60);

    harness.restart();
    const callsBefore = harness.provider.stats().calls;
    const response = await harness.send(
      post("/v1/legs", nearbyBody(), ipFor(3)),
    );
    expect(response.status).toBe(503);
    expect(harness.provider.stats().calls).toBe(callsBefore);
  });

  it("libera créditos solo cuando salen de la ventana móvil de 24 h", async () => {
    const harness = createHarness({
      limits: {
        ...BUDGET_ONLY,
        endpointCredits: { matrix: 30, routing: 300, autocomplete: 300 },
      },
    });
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(1)))).status,
    ).toBe(200);
    harness.advance(DAY - 1);
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(2)))).status,
    ).toBe(503);
    harness.advance(2);
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(3)))).status,
    ).toBe(200);
  });
});

describe("fail-closed", () => {
  it("si falla el almacenamiento no se consulta al proveedor", async () => {
    let failing = false;
    const harness = createHarness({ failingStorage: () => failing });
    failing = true;
    const response = await harness.send(post("/v1/legs", nearbyBody()));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("unavailable");
    expect(harness.provider.stats().calls).toBe(0);
  });

  it("si el Durable Object no responde, tampoco", async () => {
    const harness = createHarness();
    harness.env.ROUTING_BUDGET.get = () => ({
      fetch: async () => {
        throw new Error("sin conexión");
      },
    });
    expect((await harness.send(post("/v1/legs", nearbyBody()))).status).toBe(
      503,
    );
    expect(harness.provider.stats().calls).toBe(0);
  });

  it("los interruptores y secretos ausentes bloquean sin llamar a nadie", async () => {
    for (const env of [
      { ROUTING_ENABLED: "false" },
      { ROUTING_ENABLED: undefined },
      { GEOAPIFY_ENABLED: "false" },
      { GEOAPIFY_API_KEY: undefined },
      { VISITOR_SALT: undefined },
    ]) {
      const harness = createHarness({ env });
      const response = await harness.send(post("/v1/legs", nearbyBody()));
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe("disabled");
      expect(harness.provider.stats().calls).toBe(0);
      expect(harness.spent()).toBe(0);
    }
  });
});

describe("validación estricta antes de reservar", () => {
  const tampered: [string, Request][] = [
    ["matriz de 16 puntos", post("/v1/legs", nearbyBody(16))],
    ["sin puntos", post("/v1/legs", { ...nearbyBody(), locations: [] })],
    ["clave extra", post("/v1/legs", { ...nearbyBody(), apiKey: "x" })],
    [
      "coordenada como texto",
      post("/v1/legs", {
        ...nearbyBody(1),
        start: { latitude: "40", longitude: -3.7 },
      }),
    ],
    [
      "punto con clave extra",
      post("/v1/legs", { ...nearbyBody(1), start: { ...madrid, extra: 1 } }),
    ],
    [
      "fuera de España",
      post("/v1/route", {
        start: madrid,
        end: { latitude: 48.85, longitude: 2.35 },
      }),
    ],
    [
      "península y Canarias",
      post("/v1/route", {
        start: madrid,
        end: { latitude: 28.1, longitude: -15.4 },
      }),
    ],
    [
      "cerca de mí a más de 50 km",
      post("/v1/legs", {
        ...nearbyBody(1),
        locations: [{ latitude: 41.0, longitude: -3.7 }],
      }),
    ],
    ["JSON no válido", post("/v1/legs", "{")],
    [
      "cuerpo de más de 4 KB",
      post("/v1/legs", JSON.stringify({ relleno: "x".repeat(5000) })),
    ],
    [
      "tipo de contenido",
      post("/v1/legs", nearbyBody(), undefined, {
        "Content-Type": "text/plain",
      }),
    ],
    ["texto corto", get("/v1/autocomplete?text=ab")],
    ["parámetro extra", get("/v1/autocomplete?text=calle&limit=100")],
    ["caracteres no permitidos", get("/v1/autocomplete?text=%3Cscript%3E")],
    ["ruta no autorizada", post("/v1/routematrix", nearbyBody())],
    ["método no autorizado", get("/v1/legs")],
  ];

  it.each(tampered)("rechaza %s sin gastar presupuesto", async (_, request) => {
    const harness = createHarness();
    const response = await harness.send(request);
    expect([400, 404]).toContain(response.status);
    expect(harness.provider.stats().calls).toBe(0);
    expect(harness.spent()).toBe(0);
  });

  it("exige origen permitido e IP del visitante", async () => {
    const harness = createHarness();
    const foreign = post("/v1/legs", nearbyBody(), undefined, {
      Origin: "https://otro.example",
    });
    expect((await harness.send(foreign)).status).toBe(403);
    const noIp = post("/v1/legs", nearbyBody(), "no-es-una-ip");
    expect((await harness.send(noIp)).status).toBe(403);
    expect(harness.provider.stats().calls).toBe(0);
  });

  it("responde al preflight CORS solo para el origen permitido", async () => {
    const harness = createHarness();
    const preflight = new Request("https://rutas.example/v1/legs", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN },
    });
    const response = await harness.send(preflight);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });
});

describe("errores del proveedor", () => {
  it("un 429 pausa el proveedor, no devuelve créditos y muestra el aviso de límite", async () => {
    const harness = createHarness({ mode: "429" });
    const first = await harness.send(post("/v1/legs", nearbyBody(), ipFor(1)));
    expect(first.status).toBe(503);
    expect((await first.json()).message).toBe(ROUTING_LIMIT_MESSAGE);
    expect(harness.spent()).toBe(30);

    harness.provider.setMode("ok");
    const callsBefore = harness.provider.stats().calls;
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(2)))).status,
    ).toBe(503);
    expect(harness.provider.stats().calls).toBe(callsBefore);

    harness.advance(15 * MINUTE + 1);
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(3)))).status,
    ).toBe(200);
  });

  it("una clave rechazada también pausa el proveedor", async () => {
    const harness = createHarness({ mode: "401" });
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(1)))).status,
    ).toBe(503);
    harness.provider.setMode("ok");
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(), ipFor(2)))).status,
    ).toBe(503);
  });

  it("reintenta una sola vez un 5xx, con una reserva nueva y sin devolver la primera", async () => {
    const harness = createHarness({ mode: "503" });
    const response = await harness.send(post("/v1/legs", nearbyBody()));
    expect(response.status).toBe(503);
    // Dos intentos de dos matrices cada uno; ambos intentos cuentan.
    expect(harness.provider.stats().calls).toBe(4);
    expect(harness.spent()).toBe(60);
  });

  it("devuelve el resultado si el reintento tiene éxito", async () => {
    const harness = createHarness({ mode: "503-then-ok" });
    const response = await harness.send(
      post("/v1/route", {
        start: madrid,
        end: { latitude: 40.0, longitude: -3.6 },
      }),
    );
    expect(response.status).toBe(200);
    expect(harness.spent("routing")).toBe(2);
  });

  it("no reintenta si no queda presupuesto para reservar otra vez", async () => {
    const harness = createHarness({
      mode: "503",
      limits: {
        endpointCredits: { matrix: 30, routing: 300, autocomplete: 300 },
      },
    });
    await harness.send(post("/v1/legs", nearbyBody()));
    expect(harness.provider.stats().calls).toBe(2);
    expect(harness.spent()).toBe(30);
  });

  it("trata un tiempo agotado como consumido y reintenta una vez", async () => {
    const harness = createHarness({
      mode: "hang",
      limits: { providerTimeoutMs: 10 },
    });
    const response = await harness.send(post("/v1/legs", nearbyBody()));
    expect(response.status).toBe(503);
    expect(harness.provider.stats().calls).toBe(4);
    expect(harness.spent()).toBe(60);
  });

  it("si se agota el único proveedor permitido no se recurre a otros", async () => {
    const harness = createHarness({
      limits: { ...BUDGET_ONLY, providerCredits: { geoapify: 30 } },
    });
    await harness.send(post("/v1/legs", nearbyBody(), ipFor(1)));
    const exhausted = await harness.send(
      post("/v1/legs", nearbyBody(), ipFor(2)),
    );
    expect(exhausted.status).toBe(503);
    expect(harness.provider.stats().hosts).toEqual(["api.geoapify.com"]);
  });
});

describe("límites por visitante y duplicados", () => {
  it("permite tres búsquedas por minuto y diez al día por visitante", async () => {
    const harness = createHarness();
    const search = (offset: number) =>
      harness.send(post("/v1/legs", nearbyBody(3, offset), "198.51.100.7"));

    for (let index = 0; index < 3; index += 1) {
      expect((await search(index)).status).toBe(200);
      harness.advance(1001);
    }
    expect((await search(3)).status).toBe(429);
    // Otro visitante no se ve afectado.
    expect(
      (await harness.send(post("/v1/legs", nearbyBody(3), "198.51.100.8")))
        .status,
    ).toBe(200);

    for (let index = 3; index < 10; index += 1) {
      harness.advance(MINUTE);
      expect((await search(index)).status).toBe(200);
    }
    harness.advance(MINUTE);
    const eleventh = await search(10);
    expect(eleventh.status).toBe(429);
    expect(eleventh.headers.get("Retry-After")).toBe("60");
  });

  it("agrupa las IPv6 de una misma red /64", async () => {
    const harness = createHarness();
    for (let index = 1; index <= 3; index += 1) {
      await harness.send(
        post("/v1/legs", nearbyBody(3, index), `2001:db8:1:2::${index}`),
      );
    }
    const sameNetwork = await harness.send(
      post("/v1/legs", nearbyBody(3, 9), "2001:db8:1:2:ffff::1"),
    );
    expect(sameNetwork.status).toBe(429);
  });

  it("rechaza la misma búsqueda repetida de inmediato", async () => {
    const harness = createHarness();
    const [first, second] = await Promise.all([
      harness.send(post("/v1/legs", nearbyBody())),
      harness.send(post("/v1/legs", nearbyBody())),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(harness.provider.stats().calls).toBe(2);
  });

  it("admite matrices con una ruta en caché sin permisos consumibles y limita cada operación", async () => {
    const harness = createHarness();
    const destination = { latitude: 40.9, longitude: -3.7 };
    const legs = {
      start: madrid,
      end: destination,
      locations: [{ latitude: 40.6, longitude: -3.7 }],
    };

    expect((await harness.send(post("/v1/legs", legs))).status).toBe(200);
    harness.advance(1001);
    expect(
      (
        await harness.send(
          post("/v1/route", { start: madrid, end: destination }),
        )
      ).status,
    ).toBe(200);
    expect((await harness.send(post("/v1/legs", legs))).status).toBe(409);
    harness.advance(30_001);
    const response = await harness.send(post("/v1/legs", legs));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toStation).toHaveLength(1);
    expect(body.fromStation[0].distanceMeters).toBeGreaterThan(0);
    harness.advance(1001);
    // Una matriz distinta no exige repetir la ruta; sí consume su propio límite.
    const again = { ...legs, locations: [{ latitude: 40.7, longitude: -3.7 }] };
    expect((await harness.send(post("/v1/legs", again))).status).toBe(429);
    harness.advance(MINUTE);
    expect((await harness.send(post("/v1/legs", again))).status).toBe(200);
  });

  it("contabiliza el autocompletado y limita sus resultados", async () => {
    const harness = createHarness();
    const response = await harness.send(
      get("/v1/autocomplete?text=Calle%20Mayor"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([
      { label: "Calle Mayor, Madrid", latitude: 40.415, longitude: -3.708 },
    ]);
    expect(harness.spent("autocomplete")).toBe(1);
  });
});
