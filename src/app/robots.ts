import type { MetadataRoute } from "next";

import { SITE_URL } from "@/app/site-metadata";

export const dynamic = "force-static";

// No se bloquea /data/: los buscadores necesitan esos JSON para representar
// el mapa y las estadísticas. Que no se indexen como páginas lo indica la
// cabecera X-Robots-Tag de public/_headers.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
