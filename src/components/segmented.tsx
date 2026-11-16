import type { CSSProperties } from "react";

// Controles de elección única de toda la web: radios reales (teclado y
// lectores de pantalla nativos) con dos aspectos, segmentado y chips.

type Option<T extends string> = readonly [T, string];

/** Control segmentado con una pastilla que se desliza a la opción elegida. */
export function Segmented<T extends string>({
  name,
  legend,
  legendClassName = "sr-only",
  options,
  value,
  onChange,
  className = "",
}: {
  name: string;
  legend: string;
  legendClassName?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex(([option]) => option === value),
  );
  return (
    <fieldset className="min-w-0">
      <legend className={legendClassName}>{legend}</legend>
      <div
        className={`seg ${className}`}
        style={{ "--n": options.length, "--i": index } as CSSProperties}
      >
        <span className="seg-thumb" aria-hidden="true" />
        {options.map(([option, label]) => (
          <label key={option} className="seg-option">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            <span className="optical">{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Chips: para más de tres opciones o etiquetas largas que deben poder saltar de línea. */
export function ChipRadios<T extends string>({
  name,
  legend,
  legendClassName = "text-muted mb-1.5 block text-[0.75rem] font-bold",
  options,
  value,
  onChange,
  disabled = [],
  disabledTitle,
}: {
  name: string;
  legend: string;
  legendClassName?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Opciones visibles pero no elegibles. */
  disabled?: readonly T[];
  disabledTitle?: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={legendClassName}>{legend}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map(([option, label]) => {
          const off = disabled.includes(option);
          return (
            <label
              key={option}
              className="chip-option"
              title={off ? disabledTitle : undefined}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                disabled={off}
                onChange={() => onChange(option)}
                className="sr-only"
              />
              <span className="optical">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
