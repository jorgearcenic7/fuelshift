// sitemap.xml con las páginas públicas; se genera estático en el build.
import type { MetadataRoute } from "next";

import { SITE_URL } from "@/app/site-metadata";

export const dynamic = "force-static";

/** Solo las páginas públicas: los JSON de datos no son contenido indexable. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/estadisticas/`, changeFrequency: "daily" },
    { url: `${SITE_URL}/comparador/`, changeFrequency: "monthly" },
    { url: `${SITE_URL}/privacidad/`, changeFrequency: "yearly" },
  ];
}
