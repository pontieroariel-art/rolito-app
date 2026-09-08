// Alertas de mora para el supervisor de cobranzas (2026-09-07): a partir de
// los días de atraso de la factura más vieja y del saldo total, un cliente
// queda en verde, amarillo o rojo. Los umbrales viven en config/cobranzas
// (Ajustes generales); acá los defaults y la regla, puros.

export interface AlertasMoraConfig {
  diasAmarillo: number   // desde estos días de atraso → amarillo
  diasRojo:     number   // desde estos días de atraso → rojo
  importeRojo:  number   // saldo total desde el cual, vencido, es rojo aunque no llegue a diasRojo
}

export const ALERTAS_MORA_DEFAULT: AlertasMoraConfig = { diasAmarillo: 30, diasRojo: 60, importeRojo: 500_000 }

export type NivelMora = 'ok' | 'amarillo' | 'rojo'

export function nivelMora(saldoTotal: number, atrasoMaximo: number, cfg: AlertasMoraConfig = ALERTAS_MORA_DEFAULT): NivelMora {
  if (saldoTotal <= 0 || atrasoMaximo <= 0) return 'ok'
  if (atrasoMaximo >= cfg.diasRojo) return 'rojo'
  if (atrasoMaximo >= cfg.diasAmarillo) return saldoTotal >= cfg.importeRojo ? 'rojo' : 'amarillo'
  return 'ok'
}

export const ETIQUETA_MORA: Record<NivelMora, string> = { ok: 'Al día', amarillo: 'En mora', rojo: 'Mora grave' }

/** Sanea lo que viene de Firestore: números positivos, si no el default. */
export function normalizarAlertasMora(raw: Partial<AlertasMoraConfig> | null | undefined): AlertasMoraConfig {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  const diasAmarillo = n(raw?.diasAmarillo, ALERTAS_MORA_DEFAULT.diasAmarillo)
  const diasRojo = Math.max(diasAmarillo, n(raw?.diasRojo, ALERTAS_MORA_DEFAULT.diasRojo))
  return { diasAmarillo, diasRojo, importeRojo: n(raw?.importeRojo, ALERTAS_MORA_DEFAULT.importeRojo) }
}
