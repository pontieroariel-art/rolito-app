import { useMemo, useRef, useState } from 'react'
import { Wrench, Package } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SignaturePad, { SignaturePadHandle } from '../../components/heladeras/SignaturePad'
import TipoReparacionChecklist from '../../components/heladeras/TipoReparacionChecklist'
import { useAuth } from '../../context/AuthContext'
import { useTicketsAsignadosAMi } from '../../hooks/useTicketsAsignadosAMi'
import { usePanolMovimientosAsignadosA } from '../../hooks/usePanolMovimientos'
import { useTiposReparacion } from '../../hooks/useReparacionCatalogos'
import { registrarTrabajoTecnico } from '../../services/ticketServicioService'
import { confirmarRecepcionTecnico } from '../../services/panolService'
import { toggleTipoFavorito } from '../../services/userService'
import { AREA_HELADERA_LABELS } from '../../utils/heladeraLabels'
import { TicketServicio, PanolMovimiento } from '../../types'
import { tsToDate } from '../../utils/helpers'

function ConfirmarMaterialesModal({ movimiento, onClose }: { movimiento: PanolMovimiento; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const padRef = useRef<SignaturePadHandle>(null)

  const handleSubmit = async () => {
    const firma = padRef.current?.toDataURL()
    if (!firma) { setError('Falta la firma'); return }
    setSaving(true)
    setError('')
    try {
      await confirmarRecepcionTecnico(movimiento.id, firma)
      onClose()
    } catch {
      setError('No se pudo confirmar. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Confirmar recepción">
      <div className="space-y-4">
        <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg p-3">
          {movimiento.articulos.map((a) => (
            <p key={a.articuloId} className="text-sm text-gray-900">{a.cantidad}x {a.nombre}</p>
          ))}
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Firma</label>
          <SignaturePad ref={padRef} />
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} className="flex-1">Confirmar</Button>
        </div>
      </div>
    </Modal>
  )
}

function RegistrarTrabajoModal({ ticket, onClose }: { ticket: TicketServicio; onClose: () => void }) {
  const { user } = useAuth()
  const { tipos } = useTiposReparacion()
  const [seleccionados, setSeleccionados] = useState<string[]>([])
  const [notas, setNotas]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const tiposDeMiSector = tipos.filter((t) => t.activo && t.area === user?.area)
  const toggle = (id: string) => setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const handleSubmit = async () => {
    if (!user || seleccionados.length === 0) { setError('Tildá al menos un arreglo'); return }
    setSaving(true)
    setError('')
    try {
      const trabajos = tiposDeMiSector.filter((t) => seleccionados.includes(t.id)).map((t) => ({ tipoId: t.id, tipoNombre: t.nombre }))
      await registrarTrabajoTecnico(ticket.id, { uid: user.uid, nombre: user.nombre }, trabajos, notas.trim() || undefined)
      onClose()
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.')
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Registrar trabajo — ${ticket.heladeraCodigo}`}>
      <div className="space-y-4">
        {!user?.area ? (
          <p className="text-amber-600 text-sm">
            Tu cuenta no tiene sector asignado — pedile al encargado que te asigne uno
            (pintura, lijado o refrigeración) para poder elegir el tipo de reparación.
          </p>
        ) : (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Qué le hiciste · {AREA_HELADERA_LABELS[user.area]}</label>
            <TipoReparacionChecklist
              tipos={tiposDeMiSector}
              seleccionados={seleccionados}
              onToggle={toggle}
              showSearch
              favoritos={user.tiposFavoritos ?? []}
              onToggleFavorito={(id) => toggleTipoFavorito(user.uid, id, (user.tiposFavoritos ?? []).includes(id))}
            />
          </div>
        )}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Notas adicionales (opcional)</label>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Algo que no esté en la lista de arriba"
            className="w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
        {error && <p className="text-red-500 text-xs">{error}</p>}
        <p className="text-xs text-gray-400">El encargado revisa y cierra el ticket desde Consulta de service.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button onClick={handleSubmit} loading={saving} disabled={!user?.area} className="flex-1">Guardar</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function TecnicoDashboard() {
  const { user } = useAuth()
  const { tickets, loading } = useTicketsAsignadosAMi(user?.uid ?? null)
  const { movimientos, loading: loadingMateriales } = usePanolMovimientosAsignadosA(user?.uid ?? null)
  const [seleccionado, setSeleccionado] = useState<TicketServicio | null>(null)
  const [confirmando, setConfirmando] = useState<PanolMovimiento | null>(null)

  const pendientes = useMemo(() => tickets.filter((t) => t.estado === 'asignado_tecnico'), [tickets])
  const historial   = useMemo(() => tickets.filter((t) => t.estado === 'cerrado' || t.estado === 'anulado').slice(0, 10), [tickets])
  const materialesPendientes = useMemo(() => movimientos.filter((m) => !m.confirmado), [movimientos])

  if (loading || loadingMateriales) return <><Navbar /><LoadingSpinner fullScreen /></>

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <Navbar />
      <main className="max-w-lg mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hola, {user?.nombre?.split(' ')[0] ?? 'técnico'}</h1>
          <p className="text-gray-500 text-sm">Tus service asignados</p>
        </div>

        {pendientes.length === 0 ? (
          <div className="bg-white border border-[#D3D1C7] rounded-xl p-8 text-center">
            <Wrench className="mx-auto text-gray-300 mb-3" size={32} />
            <p className="text-gray-500 text-sm">Todavía no tenés service asignados.</p>
            <p className="text-gray-400 text-xs mt-1">Cuando el encargado te asigne uno, va a aparecer acá.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendientes.map((t) => (
              <div key={t.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                <div>
                  <p className="font-bold text-sm text-gray-900">{t.heladeraCodigo} — {t.clientName}</p>
                  {t.direccion && <p className="text-xs text-gray-600">{t.direccion}</p>}
                  <p className="text-xs text-gray-500">{t.motivoNombre} · {tsToDate(t.fechaPedido).toLocaleDateString('es-AR')}</p>
                  {t.trabajoRealizado && <p className="text-xs text-accent mt-1">Ya registraste: {t.trabajoRealizado}</p>}
                </div>
                <Button size="sm" onClick={() => setSeleccionado(t)}>Registrar trabajo</Button>
              </div>
            ))}
          </div>
        )}

        {materialesPendientes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">Materiales recibidos</h2>
            <div className="space-y-2">
              {materialesPendientes.map((m) => (
                <div key={m.id} className="bg-white border border-[#D3D1C7] rounded-xl p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <Package size={16} className="text-gray-400 shrink-0 mt-0.5" />
                    <div>
                      {m.articulos.map((a) => (
                        <p key={a.articuloId} className="text-sm text-gray-900">{a.cantidad}x {a.nombre}</p>
                      ))}
                      <p className="text-xs text-gray-500 mt-1">{tsToDate(m.fecha).toLocaleDateString('es-AR')}</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setConfirmando(m)}>Firmar y confirmar</Button>
                </div>
              ))}
            </div>
          </section>
        )}

        {historial.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">Historial</h2>
            <div className="space-y-1.5">
              {historial.map((t) => (
                <div key={t.id} className="bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-700">{t.heladeraCodigo} — {t.motivoNombre}</p>
                  <span className="text-xs text-gray-400">{t.estado === 'cerrado' ? 'Cerrado' : 'Anulado'}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {seleccionado && <RegistrarTrabajoModal ticket={seleccionado} onClose={() => setSeleccionado(null)} />}
      {confirmando && <ConfirmarMaterialesModal movimiento={confirmando} onClose={() => setConfirmando(null)} />}
    </div>
  )
}
