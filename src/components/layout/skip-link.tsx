/** Primer elemento enfocable de cada página; lleva al `<main id="contenido">`. */
export function SkipLink() {
  return (
    <a
      href="#contenido"
      className="focus:bg-surface focus:text-ink sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
    >
      Saltar al contenido
    </a>
  );
}
