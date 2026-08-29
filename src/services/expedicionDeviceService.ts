// Marca de dispositivo del módulo expedición — mismo patrón que
// produccionAuthService.marcarDispositivoProduccion: la tablet del mostrador
// se marca UNA vez como "puesto de cobranza" (localStorage) y desde entonces,
// sin importar qué usuario de caja se loguee (los turnos rotan, cada persona
// entra con SU usuario), en ese aparato solo se ve la pantalla de Cobranzas.
// La restricción es del aparato, no de la cuenta: en la PC los mismos
// usuarios ven todo. super_admin queda exento (administra desde donde sea).

const KEY = 'cobranzaDevice'

export function marcarDispositivoCobranza(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* storage bloqueado: sin marca */ }
}

export function desmarcarDispositivoCobranza(): void {
  try { localStorage.removeItem(KEY) } catch { /* idem */ }
}

export function esDispositivoCobranza(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
