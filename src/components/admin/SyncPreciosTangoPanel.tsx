import { useState, type ReactNode } from 'react'
import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import Button from '../ui/Button'
import { db } from '../../services/firebase'
import {
  sincronizarPreciosTangoAhora, sincronizarClientesTangoAhora, sincronizarSaldosTangoAhora,
  type ResumenSyncPrecios, type ResumenSyncClientes, type ResumenSyncSaldos,
} from '../../services/preciosTangoService'
import { tsToDate } from '../../utils/helpers'
import { reportError } from '@/services/observability'

interface CorridaInfo<R> {
  ultimaCorrida?: Timestamp | { seconds: number } | null
  origen?: string
  duracionMs?: number
  resumen?: R
}

interface ConfigTangoSync {
  clientesSync?: CorridaInfo<ResumenSyncClientes>
  preciosSync?:  CorridaInfo<ResumenSyncPrecios>
  saldosSync?:   CorridaInfo<ResumenSyncSaldos>
}

type SyncId = 'clientes' | 'precios' | 'saldos'

const EMPRESAS: { id: 'redonhielo' | 'rolito'; label: string }[] = [
  { id: 'redonhielo', label: 'Redonhielo (contado)' },
  { id: 'rolito',     label: 'Rolito (promo)' },
]

const ORIGEN_LABEL: Record<string, string> = { manual: 'manual', programada: 'programada', script: 'script' }

function fecha(info?: CorridaInfo<unknown>): string {
  const d = info?.ultimaCorrida ? tsToDate(info.ultimaCorrida) : null
  if (!d) return 'nunca'
  const origen = info?.origen ? ` (${ORIGEN_LABEL[info.origen] ?? info.origen})` : ''
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) + origen
}

// Estado de las tres sincronizaciones Tango → app (config/tango.*Sync) y los
// botones para correrlas a mano. Las programadas: clientes 5:00, precios 5:30,
// saldos cada hora de 6 a 22. Todo por Tango Connect, sin la VM.
// Prop `solo`: mostrar solo una fila (la pantalla de Precios muestra la suya).
export default function SyncPreciosTangoPanel({ solo }: { solo?: SyncId } = {}) {
  const qc = useQueryClient()
  const [corriendo, setCorriendo] = useState<SyncId | null>(null)
  const [error, setError] = useState('')
  const { data: info } = useQuery({
    queryKey: ['tango-sync-estado'],
    queryFn: async (): Promise<ConfigTangoSync> => {
      const snap = await getDoc(doc(db, 'config', 'tango'))
      const d = snap.data() ?? {}
      return { clientesSync: d.clientesSync, preciosSync: d.preciosSync, saldosSync: d.saldosSync }
    },
  })

  const correr = async (id: SyncId) => {
    setCorriendo(id)
    setError('')
    try {
      if (id === 'clientes') await sincronizarClientesTangoAhora()
      else if (id === 'precios') await sincronizarPreciosTangoAhora()
      else await sincronizarSaldosTangoAhora()
      await qc.invalidateQueries({ queryKey: ['tango-sync-estado'] })
      await qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err) {
      reportError(err, { origen: 'SyncPreciosTangoPanel', sync: id })
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar')
    } finally {
      setCorriendo(null)
    }
  }

  const filas: { id: SyncId; titulo: string; descripcion: string; info?: CorridaInfo<unknown>; detalle: ReactNode }[] = [
    {
      id: 'clientes',
      titulo: 'Clientes',
      descripcion: 'Razón social, teléfono, email, condición de venta, categoría de IVA, vendedor y domicilio de cada cliente. Todos los días a las 5:00.',
      info: info?.clientesSync,
      detalle: info?.clientesSync?.resumen && (
        <>
          {info.clientesSync.resumen.recibidos} clientes en Tango · {info.clientesSync.resumen.actualizados} actualizados · {info.clientesSync.resumen.newlyLinkedCodigoTango} vinculados nuevos · {info.clientesSync.resumen.skippedNoMatch} sin cuenta en la app
          {info.clientesSync.resumen.skippedAmbiguousCuit > 0 && <span className="text-amber-600"> · {info.clientesSync.resumen.skippedAmbiguousCuit} con CUIT ambiguo</span>}
        </>
      ),
    },
    {
      id: 'precios',
      titulo: 'Precios y listas',
      descripcion: 'Listas, precio por producto y precios especiales por cliente, por empresa. Todos los días a las 5:30.',
      info: info?.preciosSync,
      detalle: info?.preciosSync?.resumen && (
        <ul className="space-y-0.5">
          {EMPRESAS.map(({ id, label }) => {
            const e = info.preciosSync?.resumen?.empresas[id]
            if (!e) return null
            return (
              <li key={id}>
                <span className="text-gray-900">{label}:</span> {e.listas} listas, {e.productos} productos, {e.especiales} clientes con precio especial, {e.clientesConLista} clientes con lista
                {e.errores.length > 0 && <span className="text-red-500"> · {e.errores.length} errores</span>}
              </li>
            )
          })}
          <li>{info.preciosSync.resumen.usuariosActualizados} clientes de la app actualizados</li>
        </ul>
      ),
    },
    {
      id: 'saldos',
      titulo: 'Saldos de cuenta corriente',
      descripcion: 'Composición de deuda (comprobantes pendientes) de cada cliente en Redonhielo. Cada hora de 6 a 22; la pantalla de cobro además pide el saldo fresco al abrir un cliente.',
      info: info?.saldosSync,
      detalle: info?.saldosSync?.resumen && (
        <>
          {info.saldosSync.resumen.clientesConDeuda} clientes con deuda en Tango · {info.saldosSync.resumen.actualizados} actualizados · {info.saldosSync.resumen.skippedNoMatch} sin cuenta en la app · {info.saldosSync.resumen.vaciados} saldados
        </>
      ),
    },
  ]

  const visibles = solo ? filas.filter((f) => f.id === solo) : filas

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl divide-y divide-gray-100">
      {!solo && (
        <div className="p-4 pb-3">
          <p className="text-sm font-semibold text-gray-900">Sincronización con Tango</p>
          <p className="text-xs text-gray-500">Tango es la fuente maestra. Estos datos se editan en Tango y bajan a la app por Tango Connect.</p>
        </div>
      )}
      {visibles.map((f) => (
        <div key={f.id} className="p-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1 flex-1">
            <p className="text-sm font-semibold text-gray-900">{solo ? 'Precios de Tango' : f.titulo}</p>
            <p className="text-xs text-gray-500">{f.descripcion}</p>
            <p className="text-xs text-gray-500">
              Última sincronización: <span className="text-gray-900">{fecha(f.info)}</span>
            </p>
            {f.detalle && <div className="text-xs text-gray-500">{f.detalle}</div>}
          </div>
          <Button onClick={() => correr(f.id)} disabled={corriendo !== null} variant="outline" className="shrink-0">
            <RefreshCw size={14} className={corriendo === f.id ? 'animate-spin' : ''} />
            {corriendo === f.id ? 'Sincronizando…' : 'Sincronizar ahora'}
          </Button>
        </div>
      ))}
      {error && <p className="px-4 py-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
