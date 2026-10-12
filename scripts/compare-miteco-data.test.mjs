import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  deploymentDecision,
  stationDataChanged,
} from "./compare-miteco-data.mjs";

function provinceHash(price) {
  const province = {
    province: { id: "28", name: "MADRID" },
    schema_version: "1.0.0",
    stations: [{ fuels: { diesel_a: price }, id: "1" }],
  };
  return createHash("sha256").update(JSON.stringify(province)).digest("hex");
}

function manifestBytes({
  price = "1.499",
  retrievedAt = "2026-10-12T00:00:00Z",
  sourceReportedAt = "12/10/2026 02:00:00",
} = {}) {
  return Buffer.from(
    JSON.stringify({
      province_count: 1,
      provinces: [
        {
          bytes: 180,
          file: "provinces/28.json",
          id: "28",
          name: "MADRID",
          sha256: provinceHash(price),
          station_count: 1,
        },
      ],
      quality: { source_station_count: 1 },
      retrieved_at: retrievedAt,
      schema_version: "1.0.0",
      source: { reported_at: { raw: sourceReportedAt } },
      station_count: 1,
    }),
  );
}

describe("stationDataChanged", () => {
  it("considera idénticos dos conjuntos con el mismo contenido", () => {
    expect(stationDataChanged(manifestBytes(), manifestBytes())).toBe(false);
  });

  it("detecta un precio modificado", () => {
    expect(
      stationDataChanged(
        manifestBytes({ price: "1.499" }),
        manifestBytes({ price: "1.509" }),
      ),
    ).toBe(true);
  });

  it("ignora fechas de descarga y metadatos de ejecución", () => {
    expect(
      stationDataChanged(
        manifestBytes(),
        manifestBytes({
          retrievedAt: "2026-10-12T04:00:00Z",
          sourceReportedAt: "12/10/2026 06:00:00",
        }),
      ),
    ).toBe(false);
  });
});

describe("deploymentDecision", () => {
  it("publica cuando cambian los datos", () => {
    expect(
      deploymentDecision({
        dataChanged: true,
        eventName: "schedule",
        forceDeployRequested: false,
      }),
    ).toEqual({ forced: false, shouldDeploy: true });
  });

  it("permite forzar manualmente un despliegue con datos idénticos", () => {
    expect(
      deploymentDecision({
        dataChanged: false,
        eventName: "workflow_dispatch",
        forceDeployRequested: true,
      }),
    ).toEqual({ forced: true, shouldDeploy: true });
  });

  it("ignora cualquier intento de forzado en una ejecución programada", () => {
    expect(
      deploymentDecision({
        dataChanged: false,
        eventName: "schedule",
        forceDeployRequested: true,
      }),
    ).toEqual({ forced: false, shouldDeploy: false });
  });

  it("no publica datos idénticos sin una petición manual explícita", () => {
    expect(
      deploymentDecision({
        dataChanged: false,
        eventName: "workflow_dispatch",
        forceDeployRequested: false,
      }),
    ).toEqual({ forced: false, shouldDeploy: false });
  });
});
