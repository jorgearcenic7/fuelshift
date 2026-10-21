import type { Metadata } from "next";

/**
 * Origen público de la web. Debe coincidir con la variable de Actions
 * `CLOUDFLARE_PAGES_URL`; si se usa un dominio propio, se cambia aquí.
 */
export const SITE_URL = "https://fuelshift.pages.dev";
export const SITE_NAME = "FuelShift";

/** Tarjeta para compartir, generada por `og-image.png/route.tsx`. */
export const OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: "FuelShift: precios oficiales de carburantes en España, comparador y estadísticas",
};

/**
 * Metadatos de una página pública. Open Graph y X se repiten por página
 * porque Next.js no combina esos objetos con los del layout.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "es_ES",
      type: "website",
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}
