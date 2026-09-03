import { useState } from 'react'
import { doc, getDoc, type Timestamp } from 'firebase/firestore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import Button from '../ui/Button'
import { db } from '../../services/firebase'
import { sincronizarPreciosTangoAhora, type ResumenSyncPrecios } from '../../services/preciosTangoService'
import { tsToDate } from '../../utils/helpers'
import { reportError } from '@/services/observability'

interface PreciosSyncInfo {
  ultimaCorrida?: Timestamp | { seconds: number } | null
  origen?: string
  duracionMs?: number
  resumen?: ResumenSyncPrecios
}

const EMPRESAS: { id: 'redonhielo' | 'rolito'; label: string }[] = [
  { id: 'redonhielo', label: 'Redonhielo (contado)' },
  { id: 'rolito',     label: 'Rolito (promo)' },
]

// Estado de la sincronización de precios con Tango (config/tango.preciosSync)
// y el botón para correrla a mano. La programada corre todos los días 5:30.
export default function SyncPreciosTangoPanel() {
  const qc = useQueryClient()
  const [corriendo, setCorriendo] = useState(false)
  const [error, setError] = useState('')
  const { data: info } = useQuery({
    queryKey: ['tango-precios-sync'],
    queryFn: async (): Promise<PreciosSyncInfo | null> => {
      const snap = await getDoc(doc(db, 'config', 'tango'))
      return (snap.data()?.preciosSync as PreciosSyncInfo | undefined) ?? null
    },
  })

  const sincronizar = async () => {
    setCorriendo(true)
    setError('')
    try {
      await sincronizarPreciosTangoAhora()
      await qc.invalidateQueries({ queryKey: ['tango-precios-sync'] })
      await qc.invalidateQueries({ queryKey: ['users'] })
    } catch (err) {
      reportError(err, { origen: 'SyncPreciosTangoPanel' })
      setError(err instanceof Error ? err.message : 'No se pudo sincronizar')
    } finally {
      setCorriendo(false)
    }
  }

  const ultima = info?.ultimaCorrida ? tsToDate(info.ultimaCorrida) : null
  const empresas = info?.resumen?.empresas ?? {}

  return (
    <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-gray-900">Precios de Tango</p>
        <p className="text-xs text-gray-500">
          Los clientes vinculados a Tango venden con la lista y los precios especiales que tienen allá.
          Se sincroniza todos los días a las 5:30; si cambiaste algo en Tango, corrélo ahora.
        </p>
        <p className="text-xs text-gray-500">
          Última sincronización:{' '}
          <span className="text-gray-900">
            {ultima ? ultima.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}
          </span>
          {info?.origen && <span className="text-gray-400"> ({info.origen === 'manual' ? 'manual' : 'programada'})</span>}
        </p>
        {ultima && (
          <ul className="text-xs text-gray-500 space-y-0.5">
            {EMPRESAS.map(({ id, label }) => {
              const e = empresas[id]
              if (!e) return null
              return (
                <li key={id}>
                  <span className="text-gray-900">{label}:</span> {e.listas} listas, {e.productos} productos, {e.especiales} clientes con precio especial, {e.clientesConLista} clientes con lista
                  {e.errores.length > 0 && <span className="text-red-500"> · {e.errores.length} errores</span>}
                </li>
              )
            })}
            {info?.resumen && <li>{info.resumen.usuariosActualizados} clientes de la app actualizados</li>}
          </ul>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
      <Button onClick={sincronizar} disabled={corriendo} variant="outline" className="shrink-0">
        <RefreshCw size={14} className={corriendo ? 'animate-spin' : ''} />
        {corriendo ? 'Sincronizando…' : 'Sincronizar ahora'}
      </Button>
    </div>
  )
}
