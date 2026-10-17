import type { Metadata } from "next";
import { EnergyCalculator } from "@/components/comparison/energy-calculator";
import { SiteHeader } from "@/components/layout/site-header";

export const metadata: Metadata = {
  title: "Comparador de gasto energético | FuelShift",
  description:
    "Compara el coste energético de gasolina, diésel y eléctrico por kilometraje, consumo y precio.",
};

export default function ComparadorPage() {
  return (
    <div className="min-h-screen">
      <a
        href="#contenido"
        className="focus:bg-surface focus:text-ink sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Saltar al contenido
      </a>
      <SiteHeader active="comparador" />
      <EnergyCalculator />
    </div>
  );
}
