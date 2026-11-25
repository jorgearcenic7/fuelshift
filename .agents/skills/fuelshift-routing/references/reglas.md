# Contratos de rutas y ahorro

Estas reglas orientan tareas posteriores autorizadas; no aprueban proveedor,
infraestructura, algoritmo ni una fórmula económica definitiva.

- Distinguir coordenadas de la fuente, coordenadas del proveedor y orden de ejes;
  documentar su sistema de referencia y validar rangos. No mezclar grados y metros.
- Una distancia geodésica o a una polilínea puede preseleccionar estaciones, pero no
  acredita acceso por carretera, sentido de circulación ni desvío real.
- Comparar trayecto base y trayecto pasando por la estación bajo las mismas
  condiciones. Declarar distancia y tiempo adicionales, disponibilidad de ruta y
  límites: medianas, enlaces, peajes, ferris, islas, puntos duplicados y rutas imposibles.
- Separar el ahorro bruto del coste incremental del desvío. Acordar precio de
  referencia, cantidad repostada, consumo, unidades y precio del combustible
  consumido; evitar doble contabilización. No ocultar ahorro cero o negativo.
  El valor del tiempo y los peajes requieren supuestos explícitos y aceptación.
- No combinar €/kg con consumos en L/100 km. Declarar precisión, redondeo y valores
  ausentes; mantener el precio oficial exacto en su contrato de origen.
- Etiquetar supuestos del usuario, cálculos de FuelShift y datos del proveedor por
  separado. Conservar procedencia y antigüedad de precios y respuestas de rutas;
  un fallo de rutas no invalida ni reemplaza los precios oficiales disponibles.
- Tratar origen y destino como información sensible: consentimiento para ubicación,
  destinatario de coordenadas explícito y mínima retención. No registrar ni persistir
  trayectos por defecto ni exponer claves privadas en el navegador.
- Antes de aprobar una integración, verificar condiciones gratuitas, cuotas, límites,
  atribución, CORS y política de datos; definir cancelación, timeout, reintentos
  acotados y degradación explícita. Sin presupuestos ni estimaciones ficticias.

El contrato propuesto debe permitir probar, sin red, estaciones cercanas pero
inaccesibles, desvíos no rentables, precios ausentes, unidades incompatibles y fallos
del servicio. Proveedor y Workers quedan sujetos a una ADR posterior.
