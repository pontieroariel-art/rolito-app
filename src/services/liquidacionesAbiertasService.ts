import { collection, getDocs, query, where, Timestamp } from 'firebase/firestore'
import { db } from './firebase'
import type { CambioCamion, Cobranza, DescargaCamion, Liquidacion, RemitoCarga, VentaCamion } from '@/types'
import { gruposAbiertos, resumirAbierta, type LiquidacionAbierta } from '@/utils/liquidacionesAbiertas'
import { descargasVigentes } from '@/utils/rectificacionDescarga'
import { addDaysStr } from '@/utils/helpers'

// Liquidaciones abiertas (2026-09-16): consulta PUNTUAL, no un stream. Trae los
// remitos de carga, las cobranzas de calle y las liquidaciones de los últimos
// N días, arma los grupos persona + día sin cierre, y para cada uno pide los
// docs de esa persona en ese día (las mismas cuatro consultas que usa la
// pantalla de Liquidaciones) para resumir bultos y plata pendientes.

export const DIAS_ATRAS_DEFAULT = 45

const docsDe = <T>(snap: { docs: { id: string; data: () => unknown }[] }): T[] =>
  snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as T)

async function docsDelDia(choferId: string, fecha: string) {
  const desde = new Date(fecha + 'T00:00:00')
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1)
  const rango = (campo: string) => [where(campo, '==', choferId), where('fecha', '>=', Timestamp.fromDate(desde)), where('fecha', '<', Timestamp.fromDate(hasta))]
  const [ventas, cambios, descargas, cobranzas] = await Promise.all([
    getDocs(query(collection(db, 'ventasCamion'), ...rango('choferId'))),
    getDocs(query(collection(db, 'cambiosCamion'), ...rango('choferId'))),
    // Descargas por día de VIAJE (diaReparto, 2026-09-17): la contada al día siguiente cierra el día del remito.
    getDocs(query(collection(db, 'descargasCamion'), where('choferId', '==', choferId), where('diaReparto', '==', fecha))),
    getDocs(query(collection(db, 'cobranzas'), ...rango('registradoPor.uid'))),
  ])
  return {
    ventas:    docsDe<VentaCamion>(ventas),
    cambios:   docsDe<CambioCamion>(cambios),
    descargas: descargasVigentes(docsDe<DescargaCamion>(descargas)),
    cobranzas: docsDe<Cobranza>(cobranzas),
  }
}

/** Todas las liquidaciones abiertas de los últimos `diasAtras` días, resumidas. */
export async function cargarLiquidacionesAbiertas(hoy: string, diasAtras = DIAS_ATRAS_DEFAULT): Promise<LiquidacionAbierta[]> {
  const desdeStr = addDaysStr(hoy, -diasAtras)
  const desde = Timestamp.fromDate(new Date(desdeStr + 'T00:00:00'))
  const [remitos, cobranzas, liquidaciones] = await Promise.all([
    getDocs(query(collection(db, 'remitosCarga'), where('fecha', '>=', desde))),
    getDocs(query(collection(db, 'cobranzas'), where('fecha', '>=', desde))),
    getDocs(query(collection(db, 'liquidaciones'), where('fecha', '>=', desdeStr))),
  ])
  const grupos = gruposAbiertos(docsDe<RemitoCarga>(remitos), docsDe<Cobranza>(cobranzas), docsDe<Liquidacion>(liquidaciones))
  // De a pocos: cada grupo son cuatro consultas.
  const filas: LiquidacionAbierta[] = []
  for (let i = 0; i < grupos.length; i += 5) {
    const tanda = grupos.slice(i, i + 5)
    filas.push(...await Promise.all(tanda.map(async (g) => resumirAbierta(g, await docsDelDia(g.choferId, g.fecha), hoy))))
  }
  return filas
}
