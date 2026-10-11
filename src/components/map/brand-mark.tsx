"use client";

import { useState } from "react";

import type { BrandIdentity } from "@/domain/brands";

const SIZES = {
  sm: "size-7 rounded-lg text-[0.625rem]",
  lg: "size-12 rounded-xl text-base",
} as const;

/**
 * Marca visual decorativa: logotipo local si existe, monograma con el color
 * de la marca o, para estaciones sin rótulo, un icono genérico. El nombre se
 * muestra siempre como texto junto a ella.
 */
export function BrandMark({
  identity,
  size = "sm",
}: {
  identity: BrandIdentity;
  size?: keyof typeof SIZES;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const base = `grid shrink-0 place-items-center overflow-hidden font-bold tracking-[-0.02em] ${SIZES[size]}`;

  if (identity.logo && !logoFailed) {
    return (
      <span className={`${base} ring-line bg-white ring-1`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- recurso local estático */}
        <img
          src={identity.logo}
          alt=""
          className="size-full object-contain p-1"
          onError={() => setLogoFailed(true)}
        />
      </span>
    );
  }

  if (!identity.mark) {
    return (
      <span
        className={`${base} bg-canvas text-muted ring-line ring-1`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className={size === "lg" ? "size-5" : "size-3.5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 22V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v17" />
          <path d="M2 22h13M6 8h5" />
          <path d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8.5L18 5" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={base}
      style={{ backgroundColor: identity.color, color: identity.onColor }}
      aria-hidden="true"
    >
      {identity.mark}
    </span>
  );
}
