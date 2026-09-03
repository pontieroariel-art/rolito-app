import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import type { CaiRemito } from '../utils/comprobanteInterno'

// CAI del talonario de remitos oficiales de Redonhielo. Lo pide la oficina a
// ARCA para el punto de venta de remitos (régimen de autoimpresor) y lo carga
// en config/remitoOficial = { cai: '12345678901234', vencimiento: 'YYYY-MM-DD' }.
// Con esto cargado y vigente, el remito de cuenta corriente sale con letra R;
// sin esto, sale X (nunca se inventa un CAI).
//
// El chofer lo necesita en la calle, sin señal: se cachea en localStorage la
// última lectura buena.

const KEY = 'remitoOficialCai'

interface Guardado { cai: string; vencimiento: string }

function parsear(raw: Guardado | undefined | null): CaiRemito | null {
  if (!raw?.cai || !raw.vencimiento) return null
  const [y, m, d] = String(raw.vencimiento).split('-').map(Number)
  if (!y || !m || !d) return null
  return { cai: String(raw.cai), vencimiento: new Date(y, m - 1, d) }
}

export function caiRemitoOficialCacheado(): CaiRemito | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parsear(JSON.parse(raw) as Guardado) : null
  } catch {
    return null
  }
}

/** Lee el CAI vigente; si no hay red devuelve el último cacheado. */
export async function getCaiRemitoOficial(): Promise<CaiRemito | null> {
  try {
    const snap = await getDoc(doc(db, 'config', 'remitoOficial'))
    const data = snap.data() as Guardado | undefined
    const cai = parsear(data)
    try {
      if (cai && data) localStorage.setItem(KEY, JSON.stringify({ cai: data.cai, vencimiento: data.vencimiento }))
      else localStorage.removeItem(KEY)
    } catch { /* sin storage, sin cache */ }
    return cai
  } catch (err) {
    reportError(err, { servicio: 'remitoOficialConfigService', op: 'getCaiRemitoOficial' })
    return caiRemitoOficialCacheado()
  }
}
