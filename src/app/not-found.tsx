import type { Metadata } from "next";
import Link from "next/link";

import { OG_IMAGE, SITE_NAME } from "@/app/site-metadata";
import { SiteHeader } from "@/components/layout/site-header";
import { SkipLink } from "@/components/layout/skip-link";

const title = "Página no encontrada | FuelShift";
const description =
  "La dirección no corresponde a ninguna página de FuelShift.";

// La exportación estática la publica como /404.html, que Cloudflare Pages
// sirve con estado 404 para cualquier ruta inexistente. Next.js ya añade
// `noindex`; aquí se evita heredar la URL canónica y la tarjeta del mapa.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: null },
  openGraph: { title, description, siteName: SITE_NAME, images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title, description },
};

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <SkipLink />
      <SiteHeader active={null} />
      <main
        id="contenido"
        className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6 sm:py-24"
      >
        <p className="text-accent text-xs font-semibold tracking-widest uppercase">
          Error 404
        </p>
        <h1 className="text-ink mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          Página no encontrada
        </h1>
        <p className="text-muted mt-3 text-sm leading-6">
          La dirección que has abierto no existe o ha cambiado. Puedes volver al
          mapa de gasolineras o consultar el resto de secciones.
        </p>
        {/* El mapa no se precarga: descarga MapLibre y unos 4 MB de datos. */}
        <Link
          href="/"
          prefetch={false}
          className="bg-accent hover:bg-accent-strong mt-8 inline-flex h-11 items-center justify-center rounded-[0.625rem] px-5 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgb(31_98_176/70%)] transition-colors"
        >
          Volver al mapa
        </Link>
        <p className="text-muted mt-6 text-sm">
          <Link
            href="/comparador"
            className="text-accent hover:text-accent-strong font-medium underline underline-offset-2"
          >
            Comparador
          </Link>
          <span aria-hidden="true"> · </span>
          <Link
            href="/estadisticas"
            className="text-accent hover:text-accent-strong font-medium underline underline-offset-2"
          >
            Estadísticas
          </Link>
        </p>
      </main>
    </div>
  );
}
