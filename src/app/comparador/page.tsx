import type { Metadata } from "next";
import { EnergyCalculator } from "@/components/comparison/energy-calculator";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";

export const metadata: Metadata = {
  title: "Comparador de gasto energético | FuelShift",
  description:
    "Compara el coste energético de gasolina, diésel y eléctrico por kilometraje, consumo y precio.",
};

export default function ComparadorPage() {
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader active="comparador" />
      <EnergyCalculator />
    </div>
  );
}
