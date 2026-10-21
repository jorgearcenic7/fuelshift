import { PRICE_UNIT_NAMES, type PriceUnit } from "@/domain/fuel-units";

/**
 * Unidad de un precio: abreviada a la vista y completa para lectores de
 * pantalla, que no leerían bien «€/L». Con `visuallyHidden` solo se anuncia,
 * para filas en las que la unidad ya se indica en la cabecera.
 */
export function PriceUnitLabel({
  unit,
  className = "",
  visuallyHidden = false,
}: {
  unit: PriceUnit;
  className?: string;
  visuallyHidden?: boolean;
}) {
  return (
    <>
      {visuallyHidden ? null : (
        <span aria-hidden="true" className={className}>
          {" "}
          {unit}
        </span>
      )}
      <span className="sr-only"> {PRICE_UNIT_NAMES[unit]}</span>
    </>
  );
}
