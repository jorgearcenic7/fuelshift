import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FUEL_LABELS, type FuelCode } from "@/domain/stations";

/** La escala sigue visible en escritorio; en móvil se abre desde una pastilla. */
export function MobileMapLegend({
  fuel,
  sheetExpanded,
  children,
}: {
  fuel: FuelCode;
  sheetExpanded: boolean;
  children: (
    expanded: boolean,
    onExpandedChange: (expanded: boolean) => void,
  ) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded && contentRef.current) contentRef.current.scrollTop = 0;
  }, [expanded]);
  useEffect(() => {
    const position = legendRef.current?.parentElement;
    const map = position?.closest(".map-viewport");
    if (!position || !map) return;
    const controls = [
      ...map.querySelectorAll<HTMLElement>(
        ".maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right",
      ),
    ];
    const updateClearance = () => {
      const bottom = map.getBoundingClientRect().bottom;
      const clearance = Math.max(
        0,
        ...controls.map((control) => {
          const rect = control.getBoundingClientRect();
          return rect.height ? bottom - rect.top + 8 : 0;
        }),
      );
      position.style.setProperty("--legend-clearance", `${clearance}px`);
    };
    const observer = new ResizeObserver(updateClearance);
    observer.observe(map);
    controls.forEach((control) => observer.observe(control));
    updateClearance();
    return () => observer.disconnect();
  }, [sheetExpanded]);
  return (
    <div
      ref={legendRef}
      className="map-legend-disclosure"
      data-expanded={expanded}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          expanded &&
          toggleRef.current?.offsetParent
        ) {
          setExpanded(false);
          toggleRef.current.focus();
          event.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        ref={toggleRef}
        className="mobile-legend-toggle glass press"
        aria-label={`Leyenda de precios · ${FUEL_LABELS[fuel]}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 17v-4M12 17V7M19 17V3" />
        </svg>
        <span>
          Precios ·{" "}
          {expanded ? FUEL_LABELS[fuel] : FUEL_LABELS[fuel].replace(" E5", "")}
        </span>
        <svg
          className="mobile-legend-chevron"
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        ref={contentRef}
        id={contentId}
        className="map-legend-content"
        role="group"
        aria-label="Detalles de la leyenda"
        tabIndex={expanded ? 0 : undefined}
      >
        {children(expanded, setExpanded)}
      </div>
    </div>
  );
}
