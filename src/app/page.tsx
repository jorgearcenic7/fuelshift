import { FuelMapApp } from "@/components/map/fuel-map-app";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";

export default function Home() {
  return (
    <div className="min-h-screen">
      <SkipLink />

      <SiteHeader />
      <FuelMapApp />
    </div>
  );
}
