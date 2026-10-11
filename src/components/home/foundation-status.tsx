const foundations = [
  {
    title: "Web estática",
    description:
      "Next.js, TypeScript estricto y Tailwind CSS preparados para despliegue estático.",
  },
  {
    title: "Pipeline aislado",
    description:
      "Python dispone de límites separados para descargar, validar, normalizar y publicar.",
  },
  {
    title: "Calidad automatizada",
    description:
      "CI comprueba formato, lint, tipos, tests y la generación final del sitio.",
  },
] as const;

export function FoundationStatus() {
  return (
    <aside
      aria-labelledby="estado-base"
      className="border-line bg-surface/90 relative rounded-[2rem] border p-3 shadow-[0_24px_70px_-38px_rgba(16,42,42,0.45)] backdrop-blur"
    >
      <div className="rounded-[1.4rem] bg-slate-950 p-7 text-white sm:p-9">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full bg-emerald-400"
          />
          <p className="text-sm font-medium text-emerald-100">Fase actual</p>
        </div>
        <h2
          className="mt-5 text-3xl font-semibold tracking-[-0.035em]"
          id="estado-base"
        >
          Cimientos listos para crecer
        </h2>
        <ul className="mt-8 space-y-6">
          {foundations.map(({ title, description }) => (
            <li className="grid grid-cols-[auto_1fr] gap-4" key={title}>
              <span
                aria-hidden="true"
                className="mt-1 grid size-6 place-items-center rounded-full bg-emerald-300/15 text-xs text-emerald-300"
              >
                ✓
              </span>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
