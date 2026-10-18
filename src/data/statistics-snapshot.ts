import {
  computeFuelStatistics,
  type FuelStatistics,
} from "@/domain/fuel-statistics";
import { PRIMARY_FUELS } from "@/domain/stations";

import type { PublishedDataset } from "./published-dataset";

export const STATISTICS_SCHEMA_VERSION = "1.0.0";

export type StatisticsFuel = (typeof PRIMARY_FUELS)[number];

/** Resumen calculado por FuelShift a partir del conjunto oficial publicado. */
export interface StatisticsSnapshot {
  schema_version: string;
  retrieved_at: string;
  reported_at: { raw: string; local: string };
  source: { attribution: string; catalog: string; license_url: string };
  station_count: number;
  province_count: number;
  fuels: Record<StatisticsFuel, FuelStatistics>;
}

export function buildStatisticsSnapshot({
  manifest,
  provinces,
}: PublishedDataset): StatisticsSnapshot {
  const statisticsProvinces = provinces.map(({ province, stations }) => ({
    id: province.id,
    name: province.name,
    stations,
  }));
  return {
    schema_version: STATISTICS_SCHEMA_VERSION,
    retrieved_at: manifest.retrieved_at,
    reported_at: {
      raw: manifest.source.reported_at.raw,
      local: manifest.source.reported_at.local,
    },
    source: {
      attribution: manifest.source.attribution,
      catalog: manifest.source.catalog,
      license_url: manifest.source.license.url,
    },
    station_count: manifest.station_count,
    province_count: manifest.province_count,
    fuels: Object.fromEntries(
      PRIMARY_FUELS.map((fuel) => [
        fuel,
        computeFuelStatistics(statisticsProvinces, fuel),
      ]),
    ) as Record<StatisticsFuel, FuelStatistics>,
  };
}
