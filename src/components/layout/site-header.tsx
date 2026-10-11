import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="bg-[#103f73] text-white shadow-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          className="inline-flex items-center gap-3 font-semibold text-white"
          href="/"
        >
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg bg-white text-sm font-bold text-[#103f73] shadow-sm"
          >
            FS
          </span>
          <span className="text-lg tracking-[-0.025em]">FuelShift</span>
        </Link>
        <nav aria-label="Navegación principal">
          <Link
            className="rounded-lg bg-white/12 px-3 py-2 text-sm font-semibold text-white"
            href="/"
            aria-current="page"
          >
            Mapa
          </Link>
        </nav>
      </div>
    </header>
  );
}
