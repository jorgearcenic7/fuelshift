import { useEffect, useRef } from "react";

const MOBILE_QUERY = "(max-width: 47.999rem)";
/** Movimiento mínimo antes de decidir si el gesto mueve la hoja o el contenido. */
const START_THRESHOLD = 6;
/** Distancia o velocidad a partir de la cual se completa el cambio de estado. */
const COMMIT_DISTANCE = 56;
const COMMIT_VELOCITY = 0.45;

/**
 * Hoja inferior arrastrable en móvil: hacia arriba la abre y hacia abajo la
 * cierra. Asomada, cualquier deslizamiento hacia arriba la abre; abierta, solo
 * se cierra al arrastrar hacia abajo desde el inicio de su contenido, de modo
 * que el desplazamiento de la lista sigue funcionando.
 */
export function useSheetDrag(
  expanded: boolean,
  setExpanded: (expanded: boolean) => void,
) {
  const sheetRef = useRef<HTMLElement>(null);
  const expandedRef = useRef(expanded);
  const setExpandedRef = useRef(setExpanded);

  useEffect(() => {
    expandedRef.current = expanded;
    setExpandedRef.current = setExpanded;
  });

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    let startY = 0;
    let startTime = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let scrollAtTop = true;
    let state: "idle" | "pending" | "dragging" | "ignored" = "idle";

    // --peek es una expresión CSS: un elemento invisible con esa altura da su
    // valor en píxeles.
    const probe = sheet.querySelector<HTMLElement>("[data-peek-probe]");
    const travel = () =>
      Math.max(0, sheet.offsetHeight - (probe?.offsetHeight ?? 160));

    const reset = () => {
      sheet.removeAttribute("data-dragging");
      sheet.style.removeProperty("transform");
      state = "idle";
    };

    const onStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        !window.matchMedia(MOBILE_QUERY).matches
      )
        return;
      const target = event.target as HTMLElement;
      // Los campos y deslizadores conservan su propio gesto.
      if (target.closest("input, select, textarea, [role='slider']")) {
        state = "ignored";
        return;
      }
      const scroller = target.closest<HTMLElement>(".panel-scroll");
      scrollAtTop = !scroller || scroller.scrollTop <= 0;
      startY = lastY = event.touches[0].clientY;
      startTime = lastTime = event.timeStamp;
      velocity = 0;
      state = "pending";
    };

    const onMove = (event: TouchEvent) => {
      if (state === "idle" || state === "ignored") return;
      const y = event.touches[0].clientY;
      const dy = y - startY;
      const dt = event.timeStamp - lastTime;
      if (dt > 0) velocity = (y - lastY) / dt;
      lastY = y;
      lastTime = event.timeStamp;

      if (state === "pending") {
        if (Math.abs(dy) < START_THRESHOLD) return;
        const open = expandedRef.current;
        const movesSheet = open ? dy > 0 && scrollAtTop : dy < 0;
        if (!movesSheet) {
          state = "ignored";
          return;
        }
        state = "dragging";
        sheet.setAttribute("data-dragging", "true");
      }

      event.preventDefault();
      const distance = travel();
      const offset = expandedRef.current
        ? Math.min(Math.max(dy, 0), distance)
        : distance + Math.max(Math.min(dy, 0), -distance);
      sheet.style.transform = `translateY(${offset}px)`;
    };

    const onEnd = () => {
      if (state !== "dragging") {
        state = "idle";
        return;
      }
      const dy = lastY - startY;
      const quick =
        lastTime - startTime < 300 && Math.abs(velocity) > COMMIT_VELOCITY;
      const open = expandedRef.current;
      const commit = open
        ? dy > COMMIT_DISTANCE || (quick && velocity > 0)
        : dy < -COMMIT_DISTANCE || (quick && velocity < 0);
      // Se reactiva la transición antes de soltar la posición manual para que
      // la hoja termine el recorrido animada.
      sheet.removeAttribute("data-dragging");
      void sheet.offsetHeight;
      sheet.style.removeProperty("transform");
      state = "idle";
      // Tras un arrastre no debe contar el toque sobre el asa ni sobre una fila.
      const suppressClick = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      sheet.addEventListener("click", suppressClick, {
        capture: true,
        once: true,
      });
      window.setTimeout(
        () =>
          sheet.removeEventListener("click", suppressClick, { capture: true }),
        400,
      );
      if (commit) setExpandedRef.current(!open);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", reset);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", reset);
    };
  }, []);

  return sheetRef;
}
