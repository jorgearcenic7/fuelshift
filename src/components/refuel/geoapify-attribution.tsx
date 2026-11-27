/**
 * Texto exacto que Geoapify pide para el uso público en producción del plan
 * Free, confirmado por escrito el 27 de noviembre de 2026 (ADR 0007). Se
 * muestra junto a cualquier dato devuelto por Geoapify: sugerencias,
 * dirección elegida y resultados de rutas.
 */
export const GEOAPIFY_ATTRIBUTION_TEXT =
  "Powered by Geoapify | © OpenStreetMap contributors";

const LINK = "text-ink-2 font-semibold underline underline-offset-[3px]";

export function GeoapifyAttribution({
  className = "text-muted mt-1 text-[0.75rem] leading-4",
}: {
  className?: string;
}) {
  // El texto visible debe coincidir exactamente con GEOAPIFY_ATTRIBUTION_TEXT;
  // lo comprueba la prueba del componente.
  return (
    <p className={className} lang="en">
      Powered by{" "}
      <a
        className={LINK}
        href="https://www.geoapify.com/"
        target="_blank"
        rel="noreferrer"
      >
        Geoapify
      </a>{" "}
      | ©{" "}
      <a
        className={LINK}
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        OpenStreetMap contributors
      </a>
    </p>
  );
}
