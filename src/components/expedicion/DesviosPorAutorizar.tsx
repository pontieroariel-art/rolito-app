import { useEffect, useState } from 'react'
import { Check, PackageX, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { resolverDesvio, subscribeDesviosPendientes } from '@/services/desvioDescargaService'
import { reportError } from '@/services/observability'
import { MOTIVOS_DESVIO_DESCARGA, PLANTAS, type DesvioDescarga } from '@/types'

// Faltantes de mercadería esperando autorización (2026-09-13, paso 7 del control
// de fugas). Vive en la misma bandeja que las anulaciones: quien tiene el
// permiso entra a un solo lugar a resolver lo que quedó pendiente.
//
// Aprobar no "perdona" el faltante: dice que alguien con responsabilidad lo
// miró y el cierre puede salir. Rechazar exige decir qué hacer (recontar,
// buscar la mercadería) — si nadie contesta, caja cierra igual con desvío
// observado y el cierre queda marcado en rojo.
export default function DesviosPorAutorizar({ puedeAutorizar }: { puedeAutorizar: boolean }) {
  const { user } = useAuth()
  const [pendientes, setPendientes] = useState<DesvioDescarga[]>([])
  const [resolviendo, setResolviendo] = useState<{ d: DesvioDescarga; estado: 'aprobada' | 'rechazada' } | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeDesviosPendientes(setPendientes), [])

  const resolver = async () => {
    if (!user || !resolviendo) return
    if (resolviendo.estado === 'rechazada' && !nota.trim()) { setError('Para rechazarlo hay que decir qué hacer con el faltante.'); return }
    setGuardando(true); setError('')
    try {
      await resolverDesvio(resolviendo.d.id, resolviendo.estado, { uid: user.uid, nombre: user.nombre }, nota.trim())
      setResolviendo(null); setNota('')
    } catch (err) {
      reportError(err, { origen: 'DesviosPorAutorizar', accion: 'error al resolver' })
      setError('No se pudo guardar. ¿Ya lo resolvió otro, o es tu propio pedido?')
    } finally {
      setGuardando(false)
    }
  }

  if (pendientes.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">
        Faltantes de mercadería por autorizar ({pendientes.length})
      </h2>
      {pendientes.map((d) => {
        const propio = d.solicitadoPor.uid === user?.uid
        return (
          <div key={d.id} className="bg-white rounded-2xl border border-red-300 shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-gray-800 flex items-center gap-1.5">
                  <PackageX size={16} className="text-red-600 shrink-0" />
                  Faltan <b className="text-base tabular-nums">{d.bolsasFaltantes} bolsas</b> · {d.depositoTango ? `${d.depositoTango} · ` : ''}<b>{d.choferNombre}</b>
                </p>
                <p className="text-xs text-secundario">
                  {PLANTAS[d.plantaId].label} · día {d.fecha} · umbral {d.umbral} · pidió <b>{d.solicitadoPor.nombre}</b>{' '}
                  el {d.solicitadaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full border font-medium bg-red-100 text-red-700 border-red-200">Por autorizar</span>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
              <p className="text-gray-900">
                <b>{MOTIVOS_DESVIO_DESCARGA[d.motivo] ?? d.motivo}</b>{d.nota ? <span className="text-gray-700"> · {d.nota}</span> : null}
              </p>
              <p className="text-xs text-secundario tabular-nums">
                {d.productos.map((p) => `${p.nombre} -${p.faltan}`).join(' · ')}
              </p>
            </div>
            {puedeAutorizar && (
              <div className="flex flex-wrap justify-end gap-2">
                {propio && <p className="w-full text-right text-xs text-amber-700">Es tu propio pedido: lo tiene que autorizar otra persona.</p>}
                <Button variant="outline" onClick={() => { setError(''); setNota(''); setResolviendo({ d, estado: 'rechazada' }) }} disabled={propio}>
                  <X size={16} className="mr-1.5" /> Rechazar
                </Button>
                <Button onClick={() => { setError(''); setNota(''); setResolviendo({ d, estado: 'aprobada' }) }} disabled={propio}>
                  <Check size={16} className="mr-1.5" /> Autorizar el cierre
                </Button>
              </div>
            )}
          </div>
        )
      })}

      {resolviendo && (
        <Modal open onClose={() => setResolviendo(null)} title={resolviendo.estado === 'aprobada' ? 'Autorizar el cierre con este faltante' : 'Rechazar el faltante'}>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {resolviendo.d.choferNombre} · faltan <b>{resolviendo.d.bolsasFaltantes} bolsas</b> del {resolviendo.d.fecha}.
            </p>
            <p className="text-xs text-secundario">
              {resolviendo.estado === 'aprobada'
                ? 'Caja va a poder cerrar la liquidación con tu autorización. El faltante queda registrado igual: autorizar no lo borra.'
                : 'Decile a caja qué hacer: que el muelle recuente, que busquen la mercadería en el camión, que espere a que el chofer suba las ventas.'}
            </p>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3}
              placeholder={resolviendo.estado === 'aprobada' ? 'Nota (opcional)' : 'Qué hay que hacer (obligatorio)'}
              className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent" />
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2"><p className="text-red-600 text-sm">{error}</p></div>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setResolviendo(null)} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={resolver} loading={guardando} className="flex-1">
                {resolviendo.estado === 'aprobada' ? 'Autorizar' : 'Rechazar'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
