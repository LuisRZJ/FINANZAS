## Objetivo
- Mostrar claramente la dirección de la predicción (Compra/Venta) en cada tarjeta del historial de operaciones, manteniendo coherencia visual y sin romper funcionalidad.

## Cambios de UI
- Añadir una insignia “Compra”/“Venta” con color en el encabezado de cada tarjeta, cerca del activo y la hora, para lectura rápida.
- Incluir un nuevo ítem “Dirección” en la cuadrícula de detalles de la tarjeta, con una etiqueta consistente (verde para Compra, rojo para Venta, neutro si faltante).
- Mantener alineación y tipografía actuales (Tailwind) y el chip de “Resultado” ya existente.

## Cambios en JS/HTML (dentro del mismo archivo)
- Editar la plantilla de `renderTradesHistory` en `modulo-trading/registros-ftt.html:1334–1392` para:
  - Definir mapeo de estilos por dirección: Compra → `bg-green-100 text-green-700`; Venta → `bg-red-100 text-red-700`; Desconocido → `bg-gray-100 text-gray-700`.
  - Renderizar la insignia de dirección en el encabezado junto a activo/hora.
  - Ajustar la cuadrícula de detalles a `grid-cols-2 sm:grid-cols-4` e insertar el campo “Dirección” como primer bloque de la fila.
  - Mantener “Estrategia” con `col-span-2 sm:col-span-4` para ocupar toda la fila.
- No modificar la lógica de guardado/edición, que ya persiste `tipo` en `handleFormSubmit` (`registros-ftt.html:854–863`) y se rellena en edición (`registros-ftt.html:899–914`).

## Responsivo y coherencia
- Usar las mismas clases Tailwind ya presentes; no introducir dependencias nuevas.
- Validar que el chip y el bloque “Dirección” se adapten en móviles (2 columnas) y en pantallas ≥ sm (4 columnas), manteniendo espaciados.

## Validación
- Registrar dos operaciones nuevas (Compra y Venta) y verificar que la dirección aparece en el encabezado y en el detalle.
- Confirmar que operaciones históricas muestran `tipo` si existe; si falta, mostrar “N/A” con estilo neutro sin errores.
- Revisar que el scroll del contenedor `#trades-card-container` y el agrupado por fecha se mantienen.

## Impactos y riesgos
- Datos legacy sin `tipo`: mitigado mostrando “N/A”.
- Cambio de columnas podría modificar el wrapping: se comprobará en tamaños móviles y escritorio.
- No se tocan cálculos de P/L ni estadísticas.

## Entregables
- Modificación puntual en `modulo-trading/registros-ftt.html` (función `renderTradesHistory`).

## Preferencia de entrega
- ¿Prefieres que implemente los cambios paso a paso explicando cada edición, o que entregue directamente el resultado final listo para revisar?