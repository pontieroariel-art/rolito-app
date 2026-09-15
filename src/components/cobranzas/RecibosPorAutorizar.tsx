import { useEffect, useState } from 'react'
import { Check, Receipt, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useAuth } from '@/context/AuthContext'
import { resolverAnulacionRecibo, subscribeAnulacionesReciboPendientes } from '@/services/anulacionCobranzaService'
import { reportError } from '@/services/observability'
import { formatoARS } from '@/utils/money'
import { MOTIVOS_ANULACION_RECIBO, PLANTAS, type AnulacionCobranza } from '@/types'

const ORIGEN: Record<AnulacionCobranza['origen'], string> = { supervisor: 'Supervisor', cobrador: 'Chofer en la calle', caja: 'Mostrador' }

// Recibos de cobranza esperando autorización para anularse (2026-09-15). Vive
// en la misma bandeja que las anulaciones de facturas y los faltantes: quien
// tiene el permiso entra a un solo lugar. Aprobar hace que el recibo deje de
// contar (rendición, liquidación, tesorería, saldos) y avisa al que cobró para
// que haga el correcto; en Tango lo anula la oficina.
export default function RecibosPorAutorizar({ puedeAutorizar }: { puedeAutorizar: boolean }) {
  const { user } = useAuth()
  const [pendientes, setPendientes] = useState<AnulacionCobranza[]>([])
  const [resolviendo, setResolviendo] = useState<{ a: AnulacionCobranza; estado: 'aprobada' | 'rechazada' } | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => subscribeAnulacionesReciboPendientes(setPendientes), [])

  const resolver = async () => {
    if (!user || !resolviendo) return
    if (resolviendo.estado === 'rechazada' && !nota.trim()) { setError('Para rechazar hay que explicar el motivo.'); return }
    setGuardando(true); setError('')
    try {
      await resolverAnulacionRecibo(resolviendo.a.id, resolviendo.estado, { uid: user.uid, nombre: user.nombre }, nota)
      setResolviendo(null); setNota('')
    } catch (err) {
      reportError(err, { origen: 'RecibosPorAutorizar', accion: 'error al resolver' })
      setError('No se pudo guardar. ¿Ya la resolvió otro, o es tu propia solicitud?')
    } finally {
      setGuardando(false)
    }
  }

  if (pendientes.length === 0) return null
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const ordenadas = pendientes.slice().sort((a, b) => a.solicitadaEn.toMillis() - b.solicitadaEn.toMillis())

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-secundario uppercase tracking-wide">Recibos de cobranza por anular ({ordenadas.length})</h2>
      {ordenadas.map((a) => {
        const propia = a.solicitadoPor.uid === user?.uid
        const r = a.resumen
        return (
          <div key={a.id} className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-gray-800 flex items-center gap-1.5">
                  <Receipt size={16} className="text-accent shrink-0" />
                  Recibo <b className="text-base">{a.numeroRecibo ?? 'sin número'}</b>{a.reciboTango ? <span className="text-secundario">· Tango {a.reciboTango}</span> : null} · <b>{formatoARS(a.importe)}</b> · {a.clienteNombre}
                </p>
                <p className="text-xs text-secundario">
                  <span className="font-semibold text-gray-700">{ORIGEN[a.origen]} · {a.cobradorNombre}</span>{a.plantaId ? ` · ${PLANTAS[a.plantaId].label}` : ''} · pidió <b>{a.solicitadoPor.nombre}</b> el {a.solicitadaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · recibo del {a.fechaCobranza}
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full border font-medium bg-amber-100 text-amber-700 border-amber-200">Por autorizar</span>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
              <p className="text-gray-900"><b>{MOTIVOS_ANULACION_RECIBO[a.motivo] ?? a.motivo}</b>{a.nota ? <span className="text-gray-700"> · {a.nota}</span> : null}</p>
              <p className="text-xs text-secundario">
                {[
                  r.efectivo > 0 ? `Efectivo ${formatoARS(r.efectivo)}` : '',
                  r.transferencia > 0 ? `Transferencia ${formatoARS(r.transferencia)}` : '',
                  ...r.cheques.map((c) => `Cheque ${c}`),
                  r.retenciones > 0 ? `Retenciones ${formatoARS(r.retenciones)}` : '',
                  r.aCuenta > 0 ? `A cuenta ${formatoARS(r.aCuenta)}` : '',
                ].filter(Boolean).join(' · ')}
              </p>
              {r.facturas.length > 0 && <p className="text-xs text-secundario">Imputa: {r.facturas.join(' · ')}</p>}
            </div>
            {puedeAutorizar && (
              <div className="flex flex-wrap justify-end gap-2">
                {propia && <p className="w-full text-right text-xs text-amber-700">Es tu propia solicitud: la tiene que autorizar otra persona.</p>}
                <Button variant="outline" onClick={() => { setError(''); setNota(''); setResolviendo({ a, estado: 'rechazada' }) }} disabled={propia}><X size={16} className="mr-1.5" /> Rechazar</Button>
                <Button onClick={() => { setError(''); setNota(''); setResolviendo({ a, estado: 'aprobada' }) }} disabled={propia}><Check size={16} className="mr-1.5" /> Aprobar anulación</Button>
              </div>
            )}
          </div>
        )
      })}

      {resolviendo && (
        <Modal open onClose={() => setResolviendo(null)} title={resolviendo.estado === 'aprobada' ? 'Aprobar anulación del recibo' : 'Rechazar anulación del recibo'}>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">Recibo <b>{resolviendo.a.numeroRecibo ?? 'sin número'}</b> · {resolviendo.a.clienteNombre} · {formatoARS(resolviendo.a.importe)}</p>
            <p className="text-sm text-gray-600">{MOTIVOS_ANULACION_RECIBO[resolviendo.a.motivo] ?? resolviendo.a.motivo}{resolviendo.a.nota ? ` · ${resolviendo.a.nota}` : ''} (pidió {resolviendo.a.solicitadoPor.nombre})</p>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder={resolviendo.estado === 'aprobada' ? 'Nota (opcional)' : 'Por qué se rechaza (obligatorio)'} className={inputClass} />
            <p className="text-xs text-secundario">
              {resolviendo.estado === 'aprobada'
                ? 'Al aprobar, el recibo deja de contar en la rendición, la liquidación, tesorería y el saldo del cliente, y facturación recibe el aviso para anularlo en Tango. Queda registrado con tu nombre y hora y no se puede deshacer.'
                : 'El recibo sigue vigente y el que cobró recibe el aviso con tu motivo. Puede volver a pedir la anulación.'}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setResolviendo(null)} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={resolver} loading={guardando} className="flex-1">{resolviendo.estado === 'aprobada' ? <><Check size={16} className="mr-1.5" /> Aprobar</> : <><X size={16} className="mr-1.5" /> Rechazar</>}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
