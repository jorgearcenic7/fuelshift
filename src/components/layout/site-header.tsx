import Link from "next/link";

export function SiteHeader({
  active = "mapa",
}: {
  active?: "mapa" | "comparador";
}) {
  return (
    <header className="bg-navy relative z-30 bg-[linear-gradient(100deg,#0e2f52_0%,#14406f_100%)] text-white shadow-[0_1px_0_rgb(255_255_255/6%),0_6px_20px_-12px_rgb(14_47_82/60%)]">
      <div className="flex h-14 w-full items-center justify-between px-4 sm:px-6">
        <Link
          className="inline-flex items-center gap-2.5 rounded-lg font-semibold text-white"
          href="/"
        >
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-white/12 ring-1 ring-white/20"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 22V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v17" />
              <path d="M2 22h13M6 8h5" />
              <path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L18 5" />
            </svg>
          </span>
          <span className="text-[1.05rem] tracking-[-0.02em]">
            Fuel<span className="text-sky-300">Shift</span>
          </span>
        </Link>
        <nav aria-label="Navegación principal">
          <Link
            className="rounded-full bg-white/12 px-3.5 py-1.5 text-sm font-medium text-white ring-1 ring-white/15 transition-colors hover:bg-white/18"
            href="/"
            aria-current={active === "mapa" ? "page" : undefined}
          >
            Mapa
          </Link>
          <Link
            className={`ml-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-white transition-colors ${active === "comparador" ? "bg-white/12 ring-1 ring-white/15" : "hover:bg-white/12"}`}
            href="/comparador"
            aria-current={active === "comparador" ? "page" : undefined}
          >
            Comparador
          </Link>
        </nav>
      </div>
    </header>
  );
}
