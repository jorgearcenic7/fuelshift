// Portada: el mapa de gasolineras con buscador, filtros y ranking.
import { FuelMapApp } from "@/components/map/fuel-map-app";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";

export default function Home() {
  return (
    <div>
      <SkipLink />

      <SiteHeader />
      <FuelMapApp />
    </div>
  );
}
