import type { MitecoManifest } from "@/data/miteco";

/** Atribución de datos y cartografía. */
export function MapAttribution({
  manifest,
}: {
  manifest: MitecoManifest | null;
}) {
  return (
    <footer className="border-line bg-surface text-muted order-5 space-y-1 px-4 py-4 text-[0.6875rem] leading-5 sm:px-[max(1.5rem,calc((100%-48rem)/2))] xl:col-start-1 xl:row-start-2 xl:border-t xl:border-r xl:px-5 xl:py-3">
      <p>
        Datos:{" "}
        {manifest ? (
          <a
            className="hover:text-ink font-medium underline underline-offset-2"
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
          className="hover:text-ink font-medium underline underline-offset-2"
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
          className="hover:text-ink font-medium underline underline-offset-2"
          href="https://openfreemap.org/"
          target="_blank"
          rel="noreferrer"
        >
          OpenFreeMap
        </a>{" "}
        · OpenMapTiles ·{" "}
        <a
          className="hover:text-ink font-medium underline underline-offset-2"
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
