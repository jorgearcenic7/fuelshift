import { useId, useRef, useState } from "react";

import { PinIcon, SearchIcon } from "@/components/map/icons";
import type { AddressSuggestion } from "@/data/road-routing/worker-client";
import { describeRefuelOutcome } from "@/domain/refuel/outcome";
import { RoutingError } from "@/domain/refuel/road-routing";

// Dirección elegida de una lista de sugerencias. La consulta sale al pulsar
// «Buscar» (o Intro), no al escribir: cada consulta gasta presupuesto.

type Phase =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; suggestions: AddressSuggestion[] }
  | { status: "error"; message: string };

function errorMessage(error: unknown): string {
  if (error instanceof RoutingError) {
    if (error.kind === "invalid-request") return error.message;
    const notice = describeRefuelOutcome(
      { status: "error", error },
      "gasoline_95_e5",
      "detour",
    );
    if (notice) return notice.message;
  }
  return "No se ha podido buscar la dirección. Inténtalo más tarde.";
}

export function AddressField({
  label,
  value,
  onChange,
  search,
  disabled = false,
}: {
  label: string;
  value: AddressSuggestion | null;
  onChange: (value: AddressSuggestion | null) => void;
  /** `null` si el servicio está desactivado. */
  search: ((text: string) => Promise<AddressSuggestion[]>) | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const unavailable = disabled || search === null;

  async function runSearch() {
    if (!search || phase.status === "loading") return;
    setPhase({ status: "loading" });
    try {
      const suggestions = await search(text);
      setPhase({ status: "results", suggestions });
    } catch (error) {
      if (error instanceof RoutingError && error.kind === "aborted") return;
      setPhase({ status: "error", message: errorMessage(error) });
    }
  }

  function choose(suggestion: AddressSuggestion) {
    onChange(suggestion);
    setPhase({ status: "idle" });
    // Tras elegir, el foco pasa al botón que permite cambiarla.
    requestAnimationFrame(() => changeRef.current?.focus());
  }

  if (value) {
    return (
      <div>
        <span className="text-muted mb-1.5 block text-[0.75rem] font-bold">
          {label}
        </span>
        <div className="bg-mist flex items-center gap-2 rounded-xl px-3 py-2">
          <PinIcon className="text-accent-strong size-4 shrink-0" />
          <span className="text-ink min-w-0 flex-1 text-[0.875rem] leading-5 [overflow-wrap:anywhere]">
            {value.label}
          </span>
          <button
            ref={changeRef}
            type="button"
            className="link-action press shrink-0"
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Cambiar<span className="sr-only"> {label.toLowerCase()}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="text-muted mb-1.5 block text-[0.75rem] font-bold"
      >
        {label}
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id={id}
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Intro busca la dirección en lugar de enviar el formulario entero.
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
          className="control min-w-0 flex-1"
          placeholder="Calle, municipio o lugar"
          autoComplete="off"
          maxLength={80}
          disabled={unavailable}
          aria-describedby={`${id}-status`}
        />
        <button
          type="button"
          className="btn btn-soft shrink-0"
          onClick={() => void runSearch()}
          disabled={unavailable || text.trim().length < 3}
          aria-busy={phase.status === "loading"}
        >
          <SearchIcon className="size-4" />
          <span className="optical">Buscar</span>
        </button>
      </div>
      <p
        id={`${id}-status`}
        className={`mt-1.5 text-[0.75rem] leading-4 ${phase.status === "error" ? "font-bold text-rose-800" : "text-muted"}`}
        role="status"
        aria-live="polite"
      >
        {phase.status === "loading"
          ? "Buscando direcciones…"
          : phase.status === "error"
            ? phase.message
            : phase.status === "results"
              ? phase.suggestions.length === 0
                ? "Sin resultados en España. Prueba con otro texto."
                : `${phase.suggestions.length} sugerencias. Elige una.`
              : "Mínimo 3 caracteres."}
      </p>
      {phase.status === "results" && phase.suggestions.length > 0 ? (
        <ul
          className="-mx-1 mt-1"
          aria-label={`Sugerencias para ${label.toLowerCase()}`}
        >
          {phase.suggestions.map((suggestion) => (
            <li
              key={`${suggestion.location.latitude},${suggestion.location.longitude}`}
            >
              <button
                type="button"
                className="station-row flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[0.875rem]"
                onClick={() => choose(suggestion)}
              >
                <PinIcon className="text-muted size-4 shrink-0" />
                <span className="text-ink min-w-0 [overflow-wrap:anywhere]">
                  {suggestion.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
