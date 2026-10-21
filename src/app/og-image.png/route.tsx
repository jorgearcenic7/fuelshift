import { ImageResponse } from "next/og";

import { OG_IMAGE } from "@/app/site-metadata";

// Tarjeta de marca para compartir enlaces (Open Graph y X). Se genera una vez
// en el build como archivo estático (out/og-image.png): con extensión,
// Cloudflare Pages la sirve como image/png. No muestra precios ni capturas que
// pudieran quedar desfasados.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          color: "#ffffff",
          background: "linear-gradient(100deg, #0e2f52 0%, #14406f 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 96,
              height: 96,
              borderRadius: 22,
              background: "rgba(255,255,255,0.12)",
              border: "2px solid rgba(255,255,255,0.2)",
            }}
          >
            {/* Mismo icono que la cabecera de la web. */}
            <svg
              width="52"
              height="52"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 22V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v17" />
              <path d="M2 22h13M6 8h5" />
              <path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L18 5" />
            </svg>
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700 }}>
            Fuel<span style={{ color: "#7dd3fc" }}>Shift</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: -1.5,
            }}
          >
            Precios oficiales de carburantes en España
          </div>
          <div style={{ fontSize: 32, color: "#cfe2f7" }}>
            Mapa de gasolineras · Comparador · Estadísticas
          </div>
        </div>
        <div style={{ fontSize: 24, color: "#9fb8d6" }}>
          Datos del Ministerio para la Transición Ecológica (MITECO)
        </div>
      </div>
    ),
    OG_IMAGE,
  );
}
