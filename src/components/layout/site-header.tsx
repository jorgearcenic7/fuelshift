import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-line/80 border-b">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-6 lg:px-10">
        <Link
          className="text-ink inline-flex items-center gap-3 font-semibold"
          href="/"
        >
          <span
            aria-hidden="true"
            className="bg-accent grid size-9 place-items-center rounded-xl text-sm text-white shadow-sm"
          >
            FS
          </span>
          <span className="text-lg tracking-[-0.025em]">FuelShift</span>
        </Link>
        <span className="border-line bg-surface text-muted rounded-full border px-3 py-1.5 text-xs font-medium">
          Base técnica
        </span>
      </div>
    </header>
  );
}
