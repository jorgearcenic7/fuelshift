import type { Metadata } from "next";
import type { ReactNode } from "react";

import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

import { pageMetadata, SITE_NAME, SITE_URL } from "./site-metadata";

// Son también los metadatos del mapa, la página de inicio.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  ...pageMetadata({
    title: "Mapa de gasolineras | FuelShift",
    description:
      "Consulta gasolineras y precios oficiales de carburantes publicados por MITECO en España.",
    path: "/",
  }),
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
