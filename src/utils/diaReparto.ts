// Día de reparto de una descarga (2026-09-17, pedido de Ariel: la devolución de
// Mira del 16/09 contada el 17/09 a las 18:22 aparecía en la liquidación del 17).
//
// Una descarga pertenece al día del VIAJE que cierra, no al día en que el
// muelle la contó: si el camión vuelve al día siguiente, el conteo va al día
// del remito de carga. Se guarda en `descargasCamion.diaReparto` ('yyyy-MM-dd')
// al contar (el remito elegido en la tablet lo dice) y el server lo completa si
// falta; las descargas viejas se completaron con
// scripts/backfill-dia-reparto-descargas.mjs. Liquidación, Liquidaciones
// abiertas, Reparto en vivo y los tableros en vivo agrupan por este campo; la
// tablet del muelle y Tiempos del muelle siguen mirando la fecha física.

interface ConFecha { toDate(): Date }

/** 'yyyy-MM-dd' local de una fecha. */
export function claveDia(d: Date | ConFecha): string {
  const f = d instanceof Date ? d : d.toDate()
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`
}

/**
 * Día de reparto de una descarga: el guardado; si no lo tiene (doc anterior al
 * 2026-09-17 sin completar), el del remito si se conoce, y si no el del conteo.
 */
export function diaDeReparto(
  descarga: { diaReparto?: string; fecha: Date | ConFecha },
  remito?: { fecha: Date | ConFecha } | null,
): string {
  if (descarga.diaReparto && /^\d{4}-\d{2}-\d{2}$/.test(descarga.diaReparto)) return descarga.diaReparto
  return claveDia(remito?.fecha ?? descarga.fecha)
}
