# Dominio frontend

Tipos y reglas de negocio consumidos por la interfaz: estaciones, combustibles, búsqueda,
filtros, ordenación, superficie de precios del mapa de calor y cálculo del gasto energético
del comparador (incluido el enlace que transfiere un precio desde el mapa). No depende de React
ni del acceso a datos.

`refuel/` contiene el motor de repostaje por carretera: contrato común de proveedores de
rutas, preselección de candidatas, coste y ahorro neto frente a una referencia, y
orquestación de «cerca de mí» (ida y vuelta) y «durante un viaje» (desvío incremental).
