import {
  collection, doc, getCountFromServer, getDocs, limit, onSnapshot, query, where, type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { reportError } from './observability'
import { tsToDate } from '@/utils/helpers'

// Lecturas del panel de control del super_admin (`/admin`, 2026-09-10).
// Regla de oro: no bajar colecciones enteras para mostrar un número. Los
// contadores usan getCountFromServer (solo viaja el conteo, como
// getHeladerasStats) y lo que necesita tiempo real se suscribe a queries
// acotadas (ver hooks/useEstadoBackoffice.ts). Cada conteo falla por separado
// y devuelve null ("sin dato"), así un índice que falta no tira todo el panel.

export interface ConteosBackoffice {
  usuariosPendientes:  number | null
  clientesSinTango:    number | null
  ticketsAbiertos:     number | null
  ticketsUrgentes:     number | null
  outboxEnCurso:       number | null
  outboxError:         number | null
  consultasPendientes: number | null
  consultasError:      number | null
  altasError:          number | null
  arcaRechazadas:      number | null
  arcaInciertas:       number | null
  cotPendientes:       number | null
  cotError:            number | null
}

async function contar(nombre: string, q: ReturnType<typeof query>): Promise<number | null> {
  try {
    return (await getCountFromServer(q)).data().count
  } catch (err) {
    reportError(err, { servicio: 'backofficeEstadoService', conteo: nombre })
    return null
  }
}

export async function contarEstadoBackoffice(): Promise<ConteosBackoffice> {
  const c = (n: string) => collection(db, n)
  const [
    usuariosPendientes, clientesSinTango, ticketsAbiertos, ticketsUrgentes,
    outboxEnCurso, outboxError, consultasPendientes, consultasError, altasError,
    arcaRechazadas, arcaInciertas, cotPendientes, cotError,
  ] = await Promise.all([
    contar('usuariosPendientes',  query(c('users'), where('rol', '==', 'cliente'), where('estado', '==', 'pendiente'))),
    contar('clientesSinTango',    query(c('clientesIndex'), where('estado', '==', 'activo'), where('vinculadoTango', '==', false))),
    contar('ticketsAbiertos',     query(c('ticketsServicio'), where('estado', 'in', ['abierto', 'asignado_tecnico', 'asignado_chofer']))),
    contar('ticketsUrgentes',     query(c('ticketsServicio'), where('estado', 'in', ['abierto', 'asignado_tecnico', 'asignado_chofer']), where('urgente', '==', true))),
    contar('outboxEnCurso',       query(c('tango-outbox'), where('estado', 'in', ['pendiente', 'enviado']))),
    contar('outboxError',         query(c('tango-outbox'), where('estado', '==', 'error'))),
    contar('consultasPendientes', query(c('tango-consultas'), where('estado', '==', 'pendiente'))),
    contar('consultasError',      query(c('tango-consultas'), where('estado', '==', 'error'))),
    contar('altasError',          query(c('tango-altas'), where('estado', '==', 'error'))),
    contar('arcaRechazadas',      query(c('facturasArca'), where('estado', '==', 'rechazada'))),
    contar('arcaInciertas',       query(c('facturasArca'), where('estado', '==', 'incierta'))),
    contar('cotPendientes',       query(c('remitosCarga'), where('cot.estado', '==', 'pendiente'))),
    contar('cotError',            query(c('remitosCarga'), where('cot.estado', '==', 'error'))),
  ])
  return {
    usuariosPendientes, clientesSinTango, ticketsAbiertos, ticketsUrgentes,
    outboxEnCurso, outboxError, consultasPendientes, consultasError, altasError,
    arcaRechazadas, arcaInciertas, cotPendientes, cotError,
  }
}

// ── config/tango: sincronizaciones y heartbeat del bridge ────────────────────

export interface ConfigTangoEstado {
  /** Última señal del listener del bridge en la VM (cada pocos minutos). */
  bridgeLastSeen: Date | null
  clientes:       Date | null
  precios:        Date | null
  saldos:         Date | null
  altas:          Date | null
  comprobantes:   { ultima: Date | null; ok: boolean | null; error: string | null }
  enabled:        boolean | null
}

type TsLike = Timestamp | { seconds: number } | null | undefined
const fecha = (ts: TsLike): Date | null => (ts ? tsToDate(ts) : null)

export const subscribeConfigTangoEstado = (cb: (e: ConfigTangoEstado) => void, onError?: (err: Error) => void): (() => void) =>
  onSnapshot(
    doc(db, 'config', 'tango'),
    (snap) => {
      const d = (snap.data() ?? {}) as Record<string, unknown>
      const sync = (k: string) => fecha((d[k] as { ultimaCorrida?: TsLike } | undefined)?.ultimaCorrida)
      const comp = (d.comprobantesSync ?? {}) as { ultimaCorrida?: TsLike; ok?: boolean; error?: string | null }
      cb({
        bridgeLastSeen: fecha(d.bridgeListenerLastSeen as TsLike),
        clientes:       sync('clientesSync'),
        precios:        sync('preciosSync'),
        saldos:         sync('saldosSync'),
        altas:          sync('altasSync'),
        comprobantes:   { ultima: fecha(comp.ultimaCorrida), ok: typeof comp.ok === 'boolean' ? comp.ok : null, error: comp.error ?? null },
        enabled:        typeof d.enabled === 'boolean' ? d.enabled : null,
      })
    },
    (err) => { reportError(err, { subscription: 'backoffice:config/tango' }); onError?.(err) },
  )

// ── config/arca ───────────────────────────────────────────────────────────────

export interface ConfigArcaEstado { habilitado: boolean | null }

export const subscribeConfigArca = (cb: (e: ConfigArcaEstado) => void, onError?: (err: Error) => void): (() => void) =>
  onSnapshot(
    doc(db, 'config', 'arca'),
    (snap) => {
      const h = snap.data()?.habilitado
      cb({ habilitado: typeof h === 'boolean' ? h : null })
    },
    (err) => { reportError(err, { subscription: 'backoffice:config/arca' }); onError?.(err) },
  )

// ── Detalle de errores (desplegables) ─────────────────────────────────────────

export interface OutboxError {
  id:            string
  entidad:       string
  origenId:      string
  empresa:       string
  intentos:      number
  ultimoError:   string
  actualizadoEn: Date | null
}

export async function getOutboxEnError(limitN = 10): Promise<OutboxError[]> {
  try {
    const snap = await getDocs(query(collection(db, 'tango-outbox'), where('estado', '==', 'error'), limit(limitN)))
    return snap.docs.map((d) => {
      const x = d.data()
      return {
        id:            d.id,
        entidad:       String(x.entidad ?? ''),
        origenId:      String(x.origenId ?? ''),
        empresa:       String(x.empresa ?? ''),
        intentos:      Number(x.intentos ?? 0),
        ultimoError:   String(x.ultimoError ?? ''),
        actualizadoEn: fecha(x.actualizadoEn as TsLike),
      }
    })
  } catch (err) {
    reportError(err, { servicio: 'backofficeEstadoService', op: 'getOutboxEnError' })
    return []
  }
}

export interface FacturaArcaProblema {
  id:         string
  ventaId:    string
  estado:     string
  tipo:       string
  motivo:     string
  puntoVenta: number | null
  numero:     number | null
}

export async function getFacturasArcaConProblema(limitN = 10): Promise<FacturaArcaProblema[]> {
  try {
    const snap = await getDocs(query(collection(db, 'facturasArca'), where('estado', 'in', ['rechazada', 'incierta']), limit(limitN)))
    return snap.docs.map((d) => {
      const x = d.data()
      return {
        id:         d.id,
        ventaId:    String(x.ventaId ?? d.id),
        estado:     String(x.estado ?? ''),
        tipo:       String(x.tipo ?? ''),
        motivo:     String(x.motivo ?? ''),
        puntoVenta: typeof x.puntoVenta === 'number' ? x.puntoVenta : null,
        numero:     typeof x.numero === 'number' ? x.numero : null,
      }
    })
  } catch (err) {
    reportError(err, { servicio: 'backofficeEstadoService', op: 'getFacturasArcaConProblema' })
    return []
  }
}
