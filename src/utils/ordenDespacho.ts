// Orden de las paradas de un despacho (2026-09-26, pedido de logística: "la
// aplicación lo ordena automáticamente y no puedo modificarlo, por eso seguimos
// trabajando con Excel"). Lógica pura del orden manual: completar el orden con
// las paradas que no estaban y mover una parada a un número escrito a mano.

/**
 * El orden guardado, limpio y completo: solo las paradas que el camión tiene
 * hoy (un despacho en borrador puede traer una que ya se movió a otro), en el
 * orden guardado, y al final las que se sumaron después, en el orden en que
 * llegan. Así una parada agregada a un camión con orden manual no se pierde
 * al confirmar ni desordena lo que armó logística.
 */
export function ordenCompleto(orden: readonly string[] | null | undefined, presentes: readonly string[]): string[] {
  const hay = new Set(presentes)
  const vistos = new Set<string>()
  const out: string[] = []
  for (const id of orden ?? []) {
    if (hay.has(id) && !vistos.has(id)) { out.push(id); vistos.add(id) }
  }
  for (const id of presentes) if (!vistos.has(id)) { out.push(id); vistos.add(id) }
  return out
}

/**
 * Mueve una parada al número de parada escrito (1 = primera). Un número fuera
 * de rango va al extremo más cercano; un número inválido no cambia nada.
 */
export function moverAPosicion(orden: readonly string[], id: string, numero: number): string[] {
  const desde = orden.indexOf(id)
  if (desde < 0 || !Number.isFinite(numero)) return [...orden]
  const hasta = Math.min(Math.max(Math.round(numero), 1), orden.length) - 1
  if (hasta === desde) return [...orden]
  const out = orden.filter((x) => x !== id)
  out.splice(hasta, 0, id)
  return out
}
