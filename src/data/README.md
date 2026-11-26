# Acceso a datos frontend

Lee y valida los artefactos estáticos del contrato `1.0.0` publicados en `public/data/miteco/`
por `npm run data:prepare`. Los fixtures de `__fixtures__/` solo se usan en pruebas y
contienen identificadores ficticios marcados como tales.

`road-routing/` traduce Geoapify al contrato de rutas de
`src/domain/refuel/road-routing.ts` (metros, segundos, null sin ruta). No incluye claves:
solo el Worker de rutas (`workers/routing/`, ADR 0007) llama a Geoapify. El navegador usa
`worker-client.ts`, que solo se activa si se compila con `NEXT_PUBLIC_ROUTING_URL`.
