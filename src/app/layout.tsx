// Plantilla común de todas las páginas: idioma, metadatos y estilos globales.
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

import { pageMetadata, SITE_NAME, SITE_URL } from "./site-metadata";

// Overpass (OFL) autoalojada: solo el subconjunto latino y el eje de peso
// recortado a lo que se usa (400–800). Un único archivo variable de ~29 KB;
// el navegador no pide nada a terceros. Véase fonts/README.md.
const overpass = localFont({
  src: "./fonts/overpass-latin-wght-400-800.woff2",
  weight: "400 800",
  style: "normal",
  display: "swap",
  variable: "--font-overpass",
});

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

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es" className={overpass.variable}>
      <body>{children}</body>
    </html>
  );
}
