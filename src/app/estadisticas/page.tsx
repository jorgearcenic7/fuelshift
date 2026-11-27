// Página de estadísticas. Los datos se leen y calculan en el build, así que el
// HTML ya llega con las cifras y no depende de JavaScript para mostrarlas.
import type { Metadata } from "next";

import { pageMetadata } from "@/app/site-metadata";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";
import { StatisticsDashboard } from "@/components/statistics/statistics-dashboard";
import { loadStatisticsPageData } from "@/data/statistics-page";

export const metadata: Metadata = pageMetadata({
  title: "Estadísticas de carburantes | FuelShift",
  description:
    "Precio medio nacional y provincial de gasolina y gasóleo calculado con los datos oficiales de MITECO.",
  path: "/estadisticas/",
});

export default async function EstadisticasPage() {
  // Se resuelve en el build: el navegador recibe solo los agregados.
  const data = await loadStatisticsPageData();
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader active="estadisticas" />
      <StatisticsDashboard data={data} />
      <SiteFooter />
    </div>
  );
}
