import type { MitecoManifest } from "@/data/miteco";

/** Atribución de datos y cartografía. */
export function MapAttribution({
  manifest,
}: {
  manifest: MitecoManifest | null;
}) {
  return (
    <footer className="text-muted space-y-1 px-5 pt-4 pb-6 text-[0.75rem] leading-[1.15rem] shadow-[inset_0_1px_0_var(--line-soft)]">
      <p>
        Datos:{" "}
        {manifest ? (
          <a
            className="hover-fine:text-ink text-ink-2 font-semibold underline decoration-[rgb(15_29_46/30%)] underline-offset-[3px]"
            href={manifest.source.catalog}
            target="_blank"
            rel="noreferrer"
          >
            {manifest.source.attribution}
          </a>
        ) : (
          "MITECO"
        )}
        {" · "}
        <a
          className="hover-fine:text-ink text-ink-2 font-semibold underline decoration-[rgb(15_29_46/30%)] underline-offset-[3px]"
          href={
            manifest?.source.license.url ??
            "https://creativecommons.org/licenses/by/4.0/"
          }
          target="_blank"
          rel="noreferrer"
        >
          CC BY 4.0
        </a>
        . Transformados y validados por FuelShift.
      </p>
      <p>
        Cartografía:{" "}
        <a
          className="hover-fine:text-ink text-ink-2 font-semibold underline decoration-[rgb(15_29_46/30%)] underline-offset-[3px]"
          href="https://openfreemap.org/"
          target="_blank"
          rel="noreferrer"
        >
          OpenFreeMap
        </a>{" "}
        · OpenMapTiles ·{" "}
        <a
          className="hover-fine:text-ink text-ink-2 font-semibold underline decoration-[rgb(15_29_46/30%)] underline-offset-[3px]"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>
      </p>
      <p>
        Los logotipos son marcas de sus titulares y solo identifican la marca de
        cada estación.
      </p>
    </footer>
  );
}
