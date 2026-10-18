import { loadPublishedDataset } from "./published-dataset";
import {
  buildStatisticsSnapshot,
  type StatisticsSnapshot,
} from "./statistics-snapshot";

export type StatisticsPageData =
  | { status: "ready"; snapshot: StatisticsSnapshot }
  | { status: "empty" }
  | { status: "error"; message: string };

/**
 * Se ejecuta durante el build: el navegador recibe solo los agregados. El
 * histórico se descarga aparte en el navegador, de modo que un histórico
 * ausente o corrupto nunca impide mostrar las estadísticas actuales.
 */
export async function loadStatisticsPageData({
  dataRoot,
}: { dataRoot?: string } = {}): Promise<StatisticsPageData> {
  try {
    const dataset = await loadPublishedDataset(dataRoot);
    if (!dataset) return { status: "empty" };
    return { status: "ready", snapshot: buildStatisticsSnapshot(dataset) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Error desconocido.",
    };
  }
}
