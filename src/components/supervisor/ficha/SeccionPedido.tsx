import { useMemo, useState } from 'react'
import { CalendarPlus, Minus, PackagePlus, Plus } from 'lucide-react'
import { Plegable } from '@/components/ui/Plegable'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { useAuth } from '@/context/AuthContext'
import { useCatalogo } from '@/hooks/useCatalogo'
import { crearPedidoDesdeSupervisor, crearVisitaDesdeSupervisor } from '@/services/supervisorPedidosService'
import { reportError } from '@/services/observability'
import type { OrderProduct, UserProfile } from '@/types'

const inputClass = 'w-full bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// El supervisor le pasa a logística un pedido (productos, sin día: entra a la
// Bandeja) o una visita puntual (sin chofer). Logística programa y asigna.
export default function SeccionPedido({ c }: { c: UserProfile }) {
  const { user } = useAuth()
  const { catalogo } = useCatalogo()
  const [modo, setModo] = useState<'pedido' | 'visita' | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const productos = useMemo<OrderProduct[]>(
    () => catalogo.filter((p) => (cantidades[p.id] ?? 0) > 0).map((p) => ({ productoId: p.id, name: p.nombre, quantity: cantidades[p.id] })),
    [catalogo, cantidades],
  )
  const cerrar = () => { setModo(null); setCantidades({}); setNotas(''); setError('') }
  const ajustar = (id: string, delta: number) => setCantidades((prev) => {
    const n = Math.max(0, (prev[id] ?? 0) + delta)
    const next = { ...prev }
    if (n > 0) next[id] = n; else delete next[id]
    return next
  })

  const enviar = async () => {
    if (!user || !modo) return
    if (modo === 'pedido' && productos.length === 0) { setError('Cargá al menos un producto.'); return }
    if (modo === 'visita' && !notas.trim()) { setError('Contale a logística para qué es la visita.'); return }
    setGuardando(true)
    setError('')
    const actor = { uid: user.uid, nombre: user.nombre }
    try {
      if (modo === 'pedido') {
        await crearPedidoDesdeSupervisor(c, productos, notas, actor)
        setAviso('Pedido enviado a logística: le van a poner día desde la Bandeja.')
      } else {
        await crearVisitaDesdeSupervisor(c, notas, actor)
        setAviso('Visita enviada a logística: la asignan desde Visitas.')
      }
      cerrar()
    } catch (err) {
      reportError(err, { origen: 'SeccionPedido', modo, uid: c.uid })
      setError('No se pudo enviar. Revisá la señal y probá de nuevo.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Plegable titulo="Pasar a logística" abiertoInicial>
      <p className="text-xs text-gray-500 mb-2">Logística elige el día y el camión. El cliente recibe los avisos de siempre.</p>
      {aviso && <p className="text-xs text-accent bg-accent/10 border border-accent/30 rounded-lg px-3 py-2 mb-2">{aviso}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setModo('pedido')}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent text-white px-3 py-2.5 text-sm font-medium active:scale-[0.98]">
          <PackagePlus size={16} /> Pedido
        </button>
        <button type="button" onClick={() => setModo('visita')}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-accent text-accent bg-white px-3 py-2.5 text-sm font-medium active:scale-[0.98]">
          <CalendarPlus size={16} /> Visita
        </button>
      </div>

      {modo && (
        <Modal open onClose={cerrar} title={modo === 'pedido' ? `Pedido para ${c.razonSocial}` : `Visita a ${c.razonSocial}`} variant="light">
          <div className="space-y-4">
            {modo === 'pedido' && (
              <div className="space-y-1.5">
                {catalogo.length === 0 && <p className="text-sm text-gray-500">Cargando catálogo…</p>}
                {catalogo.map((p) => {
                  const n = cantidades[p.id] ?? 0
                  return (
                    <div key={p.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${n > 0 ? 'border-accent bg-accent/5' : 'border-[#D3D1C7]'}`}>
                      <p className="text-sm text-gray-900 flex-1 min-w-0 truncate">{p.nombre}</p>
                      <button type="button" onClick={() => ajustar(p.id, -1)} aria-label="Menos" disabled={n === 0}
                        className="w-9 h-9 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-gray-700 disabled:opacity-30 active:scale-95"><Minus size={14} /></button>
                      <input type="number" inputMode="numeric" min={0} value={n || ''} placeholder="0"
                        onChange={(e) => ajustar(p.id, Math.max(0, Math.floor(Number(e.target.value) || 0)) - n)}
                        className="w-14 text-center bg-white border border-[#D3D1C7] rounded-lg px-1 py-1.5 text-sm tabular-nums" />
                      <button type="button" onClick={() => ajustar(p.id, 1)} aria-label="Más"
                        className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center active:scale-95"><Plus size={14} /></button>
                    </div>
                  )
                })}
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500 mb-1 block">{modo === 'pedido' ? 'Notas para logística (opcional)' : 'Para qué es la visita'}</label>
              <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} maxLength={500} className={inputClass}
                placeholder={modo === 'pedido' ? 'Horario, referencia, quién recibe…' : 'Quiere precios, reclamo, ver heladera…'} />
            </div>
            {error && <p className="text-red-500 text-xs">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={cerrar} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={enviar} loading={guardando} className="flex-1">Enviar a logística</Button>
            </div>
          </div>
        </Modal>
      )}
    </Plegable>
  )
}
