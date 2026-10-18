import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";
import { StatisticsDashboard } from "@/components/statistics/statistics-dashboard";
import { loadStatisticsPageData } from "@/data/statistics-page";

export const metadata: Metadata = {
  title: "Estadísticas de carburantes | FuelShift",
  description:
    "Precio medio nacional y provincial de gasolina y gasóleo calculado con los datos oficiales de MITECO.",
};

export default async function EstadisticasPage() {
  // Se resuelve en el build: el navegador recibe solo los agregados.
  const data = await loadStatisticsPageData();
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader active="estadisticas" />
      <StatisticsDashboard data={data} />
    </div>
  );
}
