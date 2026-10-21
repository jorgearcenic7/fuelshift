# 0001. Exportación estática de Next.js en Cloudflare Pages Free

Estado: Aceptada.

## Contexto

FuelShift debe ser público con un coste operativo de 0 €/mes y sin servicios facturables
(`AGENTS.md`). Los precios de MITECO cambian a lo largo del día, pero no hace falta mostrarlos en
tiempo real: basta con revisarlos de forma periódica y publicarlos cuando cambian.

## Decisión

- Next.js genera un sitio estático (`output: "export"` en `next.config.ts`).
- GitHub Actions descarga y valida MITECO, construye `out/` y lo publica con Wrangler mediante
  Direct Upload en Cloudflare Pages Free. No hay Pages Functions, Workers ni servidores.
- El workflow se ejecuta cada cuatro horas y bajo demanda, y solo publica si cambia el contenido
  normalizado de las estaciones.

Detalle operativo: [`docs/deployment-cloudflare.md`](../deployment-cloudflare.md).

## Alternativas descartadas

- **Servidor Next.js con renderizado bajo demanda**: requiere cómputo en ejecución, que no cabe en
  el objetivo de 0 €/mes sin depender de cuotas gratuitas con límites de ejecución.
- **Integración Git de Cloudflare**: dejaría un segundo camino de publicación fuera de las
  validaciones del workflow. Se desactiva expresamente.

## Consecuencias

- La frescura del dato está acotada por la frecuencia del cron y sus retrasos, que GitHub no
  garantiza. La web muestra siempre la antigüedad del conjunto publicado.
- Cualquier fallo anterior a Wrangler deja intacta la publicación vigente.
- No hay API en servidor: todo lo que la web consume es un archivo estático generado en el build
  (por ejemplo, `src/app/data/estadisticas.json/route.ts` se prerenderiza).
- Los secretos de Cloudflare solo se inyectan en el paso final de despliegue.

## Revisar si

- Se necesita una funcionalidad que dependa de cada petición (búsquedas en servidor, datos por
  usuario) o una frescura inferior a la del cron.
- Cambian las condiciones del plan gratuito de Cloudflare Pages o de GitHub Actions.
