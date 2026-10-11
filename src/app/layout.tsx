import type { Metadata } from "next";
import type { ReactNode } from "react";

import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mapa de gasolineras | FuelShift",
  description:
    "Consulta gasolineras y precios oficiales de carburantes publicados por MITECO en España.",
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
