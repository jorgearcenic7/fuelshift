import { FuelMapApp } from "@/components/map/fuel-map-app";
import { SiteHeader } from "@/components/layout/site-header";

export default function Home() {
  return (
    <div className="min-h-screen">
      <a
        className="focus:bg-surface focus:text-ink sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
        href="#contenido"
      >
        Saltar al contenido
      </a>

      <SiteHeader />
      <FuelMapApp />
    </div>
  );
}
