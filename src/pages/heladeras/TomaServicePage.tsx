import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { useAuth } from '../../context/AuthContext'
import { useClientesActivos } from '../../hooks/useClientesActivos'
import { useHeladeras } from '../../hooks/useHeladeras'
import { useMotivosReparacion } from '../../hooks/useReparacionCatalogos'
import { useTicketsPorCliente } from '../../hooks/useTicketsPorCliente'
import { crearTicket } from '../../services/ticketServicioService'
import { getHeladera } from '../../services/heladeraService'
import { getUserDocument } from '../../services/userService'
import { Heladera, UserProfile } from '../../types'
import { tsToDate } from '../../utils/helpers'

const ESTADO_TICKET_LABELS: Record<string, string> = {
  abierto: 'Abierto', asignado_tecnico: 'Con técnico', asignado_chofer: 'Con chofer',
  cerrado: 'Cerrado', anulado: 'Anulado',
}

export default function TomaServicePage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const heladeraIdPrefill = params.get('heladeraId')
  const clientIdPrefill   = params.get('clientId')

  const { clientes } = useClientesActivos()
  const { heladeras, loading: loadingHeladeras } = useHeladeras()
  const { motivos } = useMotivosReparacion()

  const [modo, setModo] = useState<'cliente' | 'heladera'>('cliente')
  const [busqueda, setBusqueda] = useState('')
  const [cliente, setCliente] = useState<UserProfile | null>(null)
  const [heladera, setHeladera] = useState<Heladera | null>(null)
  const [motivoId, setMotivoId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  const { tickets: historialCliente } = useTicketsPorCliente(cliente?.uid ?? null)

  // Prefill desde el botón "Reportar problema" de la ficha (QR).
  useEffect(() => {
    if (!heladeraIdPrefill) return
    setModo('heladera')
    getHeladera(heladeraIdPrefill).then(async (h) => {
      if (!h) return
      setHeladera(h)
      if (h.clienteAsignadoId) setCliente(await getUserDocument(h.clienteAsignadoId))
    })
  }, [heladeraIdPrefill])

  // Prefill desde "Abrir ticket de servicio" en el mapa de clientes.
  useEffect(() => {
    if (!clientIdPrefill || heladeraIdPrefill) return
    setModo('cliente')
    getUserDocument(clientIdPrefill).then((c) => { if (c) setCliente(c) })
  }, [clientIdPrefill, heladeraIdPrefill])

  const resultadosCliente = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q || cliente) return []
    return clientes
      .filter((c) => c.razonSocial?.toLowerCase().includes(q) || c.nombreContacto?.toLowerCase().includes(q) || c.cuit?.includes(q))
      .slice(0, 8)
  }, [clientes, busqueda, cliente])

  const heladerasEnComodato = useMemo(() => heladeras.filter((h) => h.estado === 'en_comodato'), [heladeras])

  const resultadosHeladera = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q || heladera) return []
    return heladerasEnComodato
      .filter((h) => h.codigoInterno?.toLowerCase().includes(q) || h.numeroSerie?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [heladerasEnComodato, busqueda, heladera])

  const heladerasDelCliente = useMemo(
    () => (cliente ? heladerasEnComodato.filter((h) => h.clienteAsignadoId === cliente.uid) : []),
    [heladerasEnComodato, cliente],
  )

  const reset = () => {
    setCliente(null); setHeladera(null); setBusqueda(''); setMotivoId(''); setOk(false); setError('')
  }

  const handleCrear = async () => {
    if (!user || !cliente || !heladera || !motivoId) { setError('Completá cliente, heladera y motivo'); return }
    const motivo = motivos.find((m) => m.id === motivoId)
    if (!motivo) { setError('Elegí un motivo válido'); return }
    setSaving(true)
    setError('')
    try {
      await crearTicket({
        heladeraId:     heladera.id,
        heladeraCodigo: heladera.codigoInterno,
        clientId:       cliente.uid,
        clientName:     cliente.razonSocial,
        direccionId:    heladera.clienteAsignadoDireccionId,
        direccion:      heladera.clienteAsignadoDireccion,
        motivoId:       motivo.id,
        motivoNombre:   motivo.nombre,
        requiereChofer: !!motivo.requiereChofer,
        urgente:        !!motivo.urgente,
      }, { uid: user.uid, nombre: user.nombre })
      setOk(true)
      setHeladera(null)
      setMotivoId('')
    } catch {
      setError('No se pudo crear el ticket. Intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  if (loadingHeladeras) return <LoadingSpinner fullScreen />

  return (
    <div className="min-h-screen bg-[#F8F7F2] text-gray-900">
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Toma de service</h1>
          <p className="text-gray-500 text-sm">Buscá un cliente o una heladera para abrir un ticket</p>
        </div>

        {!cliente && !heladera && (
          <div className="flex gap-2">
            <button
              onClick={() => { setModo('cliente'); setBusqueda('') }}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium ${modo === 'cliente' ? 'bg-accent/10 text-accent border-accent/40' : 'border-[#D3D1C7] text-gray-500'}`}
            >
              Por cliente
            </button>
            <button
              onClick={() => { setModo('heladera'); setBusqueda('') }}
              className={`text-xs px-3 py-1.5 rounded-full border font-medium ${modo === 'heladera' ? 'bg-accent/10 text-accent border-accent/40' : 'border-[#D3D1C7] text-gray-500'}`}
            >
              Por heladera
            </button>
          </div>
        )}

        {!cliente && !heladera && (
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={modo === 'cliente' ? 'Buscar por razón social, contacto o CUIT…' : 'Buscar por código o número de serie…'}
              className="w-full bg-white border border-[#D3D1C7] rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {modo === 'cliente' && resultadosCliente.length > 0 && (
              <div className="bg-white border border-[#D3D1C7] rounded-lg mt-1.5 divide-y divide-gray-100">
                {resultadosCliente.map((c) => (
                  <button key={c.uid} onClick={() => { setCliente(c); setBusqueda('') }} className="w-full text-left px-3 py-2.5 hover:bg-gray-50">
                    <p className="text-sm font-medium text-gray-900">{c.razonSocial}</p>
                    <p className="text-xs text-gray-500">CUIT {c.cuit}{c.nombreContacto ? ` · ${c.nombreContacto}` : ''}</p>
                  </button>
                ))}
              </div>
            )}
            {modo === 'heladera' && resultadosHeladera.length > 0 && (
              <div className="bg-white border border-[#D3D1C7] rounded-lg mt-1.5 divide-y divide-gray-100">
                {resultadosHeladera.map((h) => (
                  <button
                    key={h.id}
                    onClick={async () => {
                      setHeladera(h)
                      if (h.clienteAsignadoId) setCliente(await getUserDocument(h.clienteAsignadoId))
                      setBusqueda('')
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50"
                  >
                    <p className="text-sm font-medium text-gray-900">{h.codigoInterno}</p>
                    <p className="text-xs text-gray-500">{h.modelo} · {h.clienteAsignadoNombre ?? 'sin cliente'}</p>
                    {h.clienteAsignadoDireccion && (
                      <p className="text-xs text-accent">{h.clienteAsignadoDireccion}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {cliente && (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-gray-900">{cliente.razonSocial}</p>
              {cliente.cuit && <p className="text-xs text-gray-500">CUIT {cliente.cuit}</p>}
            </div>
            <button onClick={reset} className="text-xs text-gray-500 hover:text-accent">Empezar de nuevo</button>
          </div>
        )}

        {cliente && !heladera && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">¿Qué heladera?</label>
            {heladerasDelCliente.length === 0 ? (
              <p className="text-gray-400 text-sm">Este cliente no tiene heladeras asignadas.</p>
            ) : (
              <div className="bg-white border border-[#D3D1C7] rounded-lg divide-y divide-gray-100">
                {heladerasDelCliente.map((h) => (
                  <button key={h.id} onClick={() => setHeladera(h)} className="w-full text-left px-3 py-2.5 hover:bg-gray-50">
                    <p className="text-sm font-medium text-gray-900">{h.codigoInterno}</p>
                    <p className="text-xs text-gray-500">{h.modelo} · serie {h.numeroSerie}</p>
                    {h.clienteAsignadoDireccion && (
                      <p className="text-xs text-accent">{h.clienteAsignadoDireccion}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {cliente && heladera && (
          <div className="space-y-4">
            <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-xl p-4 flex justify-between items-center">
              <div>
                <p className="text-sm font-medium text-gray-900">{heladera.codigoInterno}</p>
                <p className="text-xs text-gray-500">{heladera.modelo} · serie {heladera.numeroSerie}</p>
                {heladera.clienteAsignadoDireccion && (
                  <p className="text-xs text-accent">{heladera.clienteAsignadoDireccion}</p>
                )}
              </div>
              <button onClick={() => setHeladera(null)} className="text-xs text-gray-500 hover:text-accent">Cambiar</button>
            </div>

            <div>
              <label className="text-xs text-gray-500 mb-1 block">Motivo de reparación</label>
              <select
                value={motivoId}
                onChange={(e) => setMotivoId(e.target.value)}
                className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Elegí un motivo…</option>
                {motivos.filter((m) => m.activo).map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre}{m.requiereChofer ? ' (traslado)' : ''}{m.urgente ? ' — urgente' : ''}</option>
                ))}
              </select>
            </div>

            {ok && <p className="text-accent text-sm">Ticket creado — queda pendiente en Consulta de service.</p>}
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <Button onClick={handleCrear} loading={saving} className="w-full">Crear ticket de service</Button>
          </div>
        )}

        {cliente && (
          <section className="space-y-2 pt-2">
            <h2 className="text-sm font-semibold text-gray-900">Historial de service de este cliente</h2>
            {historialCliente.length === 0 ? (
              <p className="text-gray-400 text-sm">Sin tickets anteriores.</p>
            ) : (
              <div className="space-y-1.5">
                {historialCliente.map((t) => (
                  <div key={t.id} className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-gray-900">{t.heladeraCodigo} — {t.motivoNombre}</p>
                      <p className="text-xs text-gray-500">{tsToDate(t.fechaPedido).toLocaleDateString('es-AR')}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                      {ESTADO_TICKET_LABELS[t.estado] ?? t.estado}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
