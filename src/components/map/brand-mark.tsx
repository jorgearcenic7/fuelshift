"use client";

import { useState } from "react";

import type { BrandIdentity } from "@/domain/brands";

// Cada tamaño reserva el mismo ancho para logotipos y monogramas, de modo que
// los textos de las listas queden alineados.
const SIZES = {
  sm: {
    slot: "w-16 h-7",
    logo: "w-16 h-7 rounded-md px-1 py-0.5",
    square: "size-7 rounded-lg text-[0.625rem]",
    icon: "size-3.5",
  },
  lg: {
    slot: "w-20 h-12",
    logo: "w-20 h-12 rounded-xl p-1.5",
    square: "size-12 rounded-xl text-base",
    icon: "size-5",
  },
} as const;

/**
 * Marca visual decorativa: logotipo local verificado si existe, monograma con
 * el color de la marca o, para estaciones sin rótulo, un icono genérico. El
 * nombre se muestra siempre como texto junto a ella.
 */
export function BrandMark({
  identity,
  size = "sm",
}: {
  identity: BrandIdentity;
  size?: keyof typeof SIZES;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const styles = SIZES[size];
  const logo =
    identity.logo && identity.logo !== failedLogo ? identity.logo : null;

  let content;
  if (logo) {
    content = (
      <span
        className={`ring-line flex items-center justify-center overflow-hidden bg-white ring-1 ${styles.logo}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- recurso local estático */}
        <img
          src={logo}
          alt=""
          className="block h-full w-full object-contain"
          loading="lazy"
          decoding="async"
          onError={() => setFailedLogo(logo)}
        />
      </span>
    );
  } else if (identity.mark) {
    content = (
      <span
        className={`grid place-items-center font-bold tracking-[-0.02em] ${styles.square}`}
        style={{ backgroundColor: identity.color, color: identity.onColor }}
      >
        {identity.mark}
      </span>
    );
  } else {
    content = (
      <span
        className={`bg-canvas text-muted ring-line grid place-items-center ring-1 ${styles.square}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={styles.icon}
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
      className={`flex shrink-0 items-center justify-center ${styles.slot}`}
      aria-hidden="true"
    >
      {content}
    </span>
  );
}
