import { FoundationStatus } from "@/components/home/foundation-status";
import { SiteHeader } from "@/components/layout/site-header";

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden">
      <a
        className="focus:bg-surface focus:text-ink sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
        href="#contenido"
      >
        Saltar al contenido
      </a>

      <SiteHeader />

      <main id="contenido">
        <section className="mx-auto grid w-full max-w-7xl gap-14 px-6 pt-16 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-10 lg:pt-24 lg:pb-28">
          <div className="max-w-3xl">
            <p className="text-accent mb-6 text-sm font-semibold tracking-[0.18em] uppercase">
              Información pública · decisiones claras
            </p>
            <h1 className="text-ink text-5xl leading-[0.98] font-semibold tracking-[-0.055em] text-balance sm:text-6xl lg:text-7xl">
              La base para entender el coste real de moverse.
            </h1>
            <p className="text-muted mt-8 max-w-2xl text-lg leading-8 sm:text-xl">
              FuelShift se está preparando para publicar precios oficiales de
              carburantes en España con su origen y antigüedad visibles. Esta
              primera fase establece una base técnica verificable; todavía no
              muestra estaciones ni precios.
            </p>
            <div
              className="mt-10 flex flex-wrap gap-3"
              aria-label="Principios del proyecto"
            >
              {[
                "Datos oficiales",
                "Acceso público",
                "Coste operativo inicial 0 €",
              ].map((principle) => (
                <span
                  className="border-line bg-surface/70 text-ink rounded-full border px-4 py-2 text-sm"
                  key={principle}
                >
                  {principle}
                </span>
              ))}
            </div>
          </div>

          <FoundationStatus />
        </section>

        <section
          aria-labelledby="proximos-pasos"
          className="border-line bg-surface/60 border-y"
        >
          <div className="mx-auto w-full max-w-7xl px-6 py-14 lg:px-10">
            <div className="max-w-2xl">
              <p className="text-accent text-sm font-semibold tracking-[0.16em] uppercase">
                Hoja de ruta
              </p>
              <h2
                className="text-ink mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl"
                id="proximos-pasos"
              >
                Lo que vendrá después de esta base
              </h2>
            </div>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 md:grid-cols-3">
              {[
                [
                  "01",
                  "Datos",
                  "Verificar el contrato oficial de MITECO y construir una ingesta trazable.",
                ],
                [
                  "02",
                  "Consulta",
                  "Publicar estaciones y precios vigentes con estados de carga y antigüedad.",
                ],
                [
                  "03",
                  "Análisis",
                  "Incorporar el mapa, el comparador y estadísticas basadas en datos validados.",
                ],
              ].map(([number, title, description]) => (
                <li className="bg-surface p-7" key={number}>
                  <span className="text-accent text-sm font-semibold">
                    {number}
                  </span>
                  <h3 className="text-ink mt-5 text-xl font-semibold">
                    {title}
                  </h3>
                  <p className="text-muted mt-3 leading-7">{description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <p>FuelShift · Proyecto en construcción</p>
        <p>Sin datos simulados ni servicios de pago</p>
      </footer>
    </div>
  );
}
