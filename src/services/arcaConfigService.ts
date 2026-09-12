import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'

// Lo poco de `config/arca` que la UI necesita leer. El doc lo escribe solo el
// Admin SDK (ver firestore.rules); staff lo lee.

/**
 * Tope (IVA incluido) hasta el cual un consumidor final del mostrador puede
 * facturarse sin CUIT ni DNI. Lo fija ARCA y se carga a mano en
 * `config/arca.topeConsumidorFinalSinIdentificar`. 0 = siempre identificar.
 * Si no se pudo leer, devuelve 0: ante la duda, pedir el documento.
 */
/**
 * ¿Los precios de lista traen el IVA adentro? (`config/arca.preciosIncluyenIva`,
 * definición del negocio: hoy false, los precios de Tango son netos). La
 * pantalla de venta lo usa para mostrar el total con IVA que va a facturar. Si
 * no se pudo leer, se asume false (netos), que es lo configurado en prod.
 */
// config/arca se lee UNA vez por sesión y las dos consultas comparten la
// promesa (2026-09-12): antes el tope se releía en cada apertura de ventanilla.
// Un fallo de red no se cachea: la próxima llamada vuelve a intentar.
let configArca: Promise<Record<string, unknown>> | null = null
function leerConfigArca(): Promise<Record<string, unknown>> {
  if (!configArca) {
    configArca = getDoc(doc(db, 'config', 'arca')).then((snap) => snap.data() ?? {})
    configArca.catch(() => { configArca = null })
  }
  return configArca
}

export async function getPreciosIncluyenIva(): Promise<boolean> {
  try {
    return (await leerConfigArca()).preciosIncluyenIva === true
  } catch (err) {
    reportError(err, { servicio: 'arcaConfigService', op: 'getPreciosIncluyenIva' })
    return false
  }
}

export async function getTopeConsumidorFinalSinIdentificar(): Promise<number> {
  try {
    const v = Number((await leerConfigArca()).topeConsumidorFinalSinIdentificar ?? 0)
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch (err) {
    reportError(err, { servicio: 'arcaConfigService', op: 'getTopeConsumidorFinalSinIdentificar' })
    return 0
  }
}
