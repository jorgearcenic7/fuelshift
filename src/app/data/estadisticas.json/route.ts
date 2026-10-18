import { loadPublishedDataset } from "@/data/published-dataset";
import { buildStatisticsSnapshot } from "@/data/statistics-snapshot";

// Se genera una sola vez en el build como archivo estático
// (out/data/estadisticas.json). Es la entrada de scripts/price-history.mjs.
export const dynamic = "force-static";

export async function GET() {
  const dataset = await loadPublishedDataset();
  return Response.json(dataset ? buildStatisticsSnapshot(dataset) : null);
}
