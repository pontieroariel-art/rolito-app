// Antigüedad de un dato en palabras. Vive acá y no en una pantalla (hasta el
// 2026-09-13 estaba en SupervisorClientesPage y la importaban cuatro módulos de
// tres dominios distintos, incluido el de facturación).
//
// Para qué: el supervisor necesita saber qué tan fresco es el saldo de Tango
// antes de confiar en él y salir a cobrar; la ventanilla, lo mismo con su cache.

/** "recién" / "hace 5 min" / "hace 3 h" / "hace 2 días" ('' si no hay fecha). */
export function haceCuanto(ts: { toDate(): Date } | undefined | null, ahora: Date = new Date()): string {
  if (!ts) return ''
  const ms = ahora.getTime() - ts.toDate().getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

/**
 * Un dato de más de un día ya no se mira igual: la pantalla lo destaca en vez
 * de dejarlo en gris chico. Un saldo de hace tres días puede hacer que el
 * supervisor cobre de menos o reclame algo que el cliente ya pagó.
 */
export const esDatoViejo = (ts: { toDate(): Date } | undefined | null, ahora: Date = new Date()): boolean =>
  !!ts && ahora.getTime() - ts.toDate().getTime() >= 24 * 60 * 60 * 1000
