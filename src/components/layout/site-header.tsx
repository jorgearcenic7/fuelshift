import type { ReactNode } from "react";

// Enlaces HTML: la exportación estática no necesita un servidor de Next para
// resolver fragmentos RSC. El mapa y sus datos se cargan al visitar la ruta.
const MAP_HREF = "/";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const NAV_ITEMS: readonly {
  id: "mapa" | "comparador" | "estadisticas";
  href: string;
  label: string;
  icon: ReactNode;
}[] = [
  {
    id: "mapa",
    href: MAP_HREF,
    label: "Mapa",
    icon: (
      <svg {...ICON_PROPS} className="size-[1.375rem]">
        <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    ),
  },
  {
    id: "comparador",
    href: "/comparador/",
    label: "Comparador",
    icon: (
      <svg {...ICON_PROPS} className="size-[1.375rem]">
        <path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7ZM8 21h8" />
      </svg>
    ),
  },
  {
    id: "estadisticas",
    href: "/estadisticas/",
    label: "Estadísticas",
    icon: (
      <svg {...ICON_PROPS} className="size-[1.375rem]">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
];

type SectionId = (typeof NAV_ITEMS)[number]["id"];

export function SiteHeader({
  active = "mapa",
}: {
  /** `null` en páginas que no son una sección, como la de error. */
  active?: SectionId | null;
}) {
  return (
    <>
      <header className="site-header border-line relative z-30 h-[var(--header-h)] border-b bg-white">
        <div className="mx-auto grid h-full w-full grid-cols-[1fr_auto] items-center gap-2 px-4 md:grid-cols-[1fr_auto_1fr] md:px-5">
          <a
            className="site-brand press text-ink inline-flex h-11 items-center gap-2.5 justify-self-start rounded-lg text-[1.1875rem] font-extrabold tracking-[-0.02em]"
            href={MAP_HREF}
          >
            <span
              aria-hidden="true"
              className="bg-navy grid size-[1.875rem] place-items-center rounded-[0.5625rem] text-white"
            >
              <svg {...ICON_PROPS} className="size-[1.125rem]">
                <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" />
                <path d="M3 21h13M7 8h5" />
                <path d="M15 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L19 5" />
              </svg>
            </span>
            <span className="optical">
              Fuel<span className="text-accent">Shift</span>
            </span>
          </a>
          {/* Escritorio y tableta: navegación en la cabecera. En móvil la
              misma navegación pasa a la barra inferior. */}
          <nav
            aria-label="Navegación principal"
            className="desktop-nav hidden items-center gap-1 md:flex"
          >
            {NAV_ITEMS.map(({ id, href, label, icon }) => (
              <a
                key={id}
                className={`nav-link group relative flex items-center px-3.5 text-[0.9375rem] font-bold transition-colors duration-150 ${active === id ? "text-ink" : "text-muted hover-fine:text-ink"}`}
                href={href}
                aria-current={active === id ? "page" : undefined}
              >
                {icon}
                <span className="nav-label transition-colors duration-150">
                  {label}
                </span>
              </a>
            ))}
          </nav>
          <span className="header-country text-muted hidden justify-self-end text-sm font-semibold md:block">
            España
          </span>
        </div>
      </header>

      <nav
        aria-label="Navegación principal"
        className="tabbar fixed inset-x-0 bottom-0 z-50 grid grid-cols-3 border-t border-[rgb(15_29_46/8%)] bg-white/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-[18px] backdrop-saturate-150 md:hidden"
      >
        {NAV_ITEMS.map(({ id, href, label, icon }) => (
          <a
            key={id}
            className={`press flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-1 text-[0.75rem] font-bold ${active === id ? "text-accent" : "text-muted"}`}
            href={href}
            aria-current={active === id ? "page" : undefined}
          >
            {icon}
            <span className="tab-label">{label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
