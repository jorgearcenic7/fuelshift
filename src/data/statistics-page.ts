import type { PriceHistory } from "@/domain/price-history";

import { loadPriceHistory } from "./price-history";
import { loadPublishedDataset } from "./published-dataset";
import {
  buildStatisticsSnapshot,
  type StatisticsSnapshot,
} from "./statistics-snapshot";

export type StatisticsPageData =
  | {
      status: "ready";
      snapshot: StatisticsSnapshot;
      history: PriceHistory | null;
      historyError: string | null;
    }
  | { status: "empty" }
  | { status: "error"; message: string };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Error desconocido.";

/**
 * Se ejecuta durante el build: el navegador recibe solo los agregados. Un
 * histórico corrupto no impide mostrar las estadísticas actuales.
 */
export async function loadStatisticsPageData({
  dataRoot,
  historyFile,
}: {
  dataRoot?: string;
  historyFile?: string;
} = {}): Promise<StatisticsPageData> {
  let snapshot: StatisticsSnapshot;
  try {
    const dataset = await loadPublishedDataset(dataRoot);
    if (!dataset) return { status: "empty" };
    snapshot = buildStatisticsSnapshot(dataset);
  } catch (error) {
    return { status: "error", message: message(error) };
  }

  try {
    return {
      status: "ready",
      snapshot,
      history: await loadPriceHistory(historyFile),
      historyError: null,
    };
  } catch (error) {
    return {
      status: "ready",
      snapshot,
      history: null,
      historyError: message(error),
    };
  }
}
