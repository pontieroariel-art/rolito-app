import { useRef, useState } from 'react'
import { Handshake } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/common/SignaturePad'
import { horaCorta } from '@/utils/turnoCaja'
import type { DatosEntregaSobre } from '@/services/sobreService'
import type { Sobre } from '@/types'

// Entrega en mano del sobre a tesorería (2026-09-16, pedido de Ariel): el
// cajero elige a quién se lo da y LE PASA LA TABLET; esa persona firma en la
// pantalla del cajero que recibió el sobre cerrado. Una sola acción, dos
// personas presentes, hora exacta. Contar es después, en Recepción, a ciegas.
// Siempre se entrega en mano: no hay "lo dejé sin que nadie lo reciba".

export interface ReceptorTesoreria { uid: string; nombre: string }

export default function EntregarSobreModal({ sobre, receptores, guardando, error, onCancelar, onEntregar }: {
  sobre: Sobre
  receptores: ReceptorTesoreria[]
  guardando: boolean
  error: string
  onCancelar: () => void
  onEntregar: (datos: DatosEntregaSobre) => void
}) {
  const [uid, setUid] = useState(receptores.length === 1 ? receptores[0].uid : '')
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)
  const receptor = receptores.find((r) => r.uid === uid)
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  const entregar = () => {
    setFalta('')
    if (!receptor) { setFalta('Elegí quién recibe el sobre.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta(`Falta la firma de ${receptor.nombre}.`); return }
    onEntregar({ recibio: { uid: receptor.uid, nombre: receptor.nombre, rol: 'tesoreria' }, firmaRecibe: firma, firmanteRecibe: receptor.nombre })
  }

  return (
    <Modal open onClose={onCancelar} title={`Entregar ${sobre.codigo} a tesorería`} variant="light" wide>
      <div className="space-y-4">
        <p className="text-sm text-secundario">Sobre cerrado a las {horaCorta(sobre.cerradaEn)} por <b className="text-gray-900">{sobre.firmanteRinde}</b>. Elegí a quién se lo entregás y pasale la tablet para que firme que lo recibió cerrado. Contar es después, en Recepción.</p>

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Quién recibe (tesorería)</label>
          {receptores.length === 0
            ? <p className="text-sm text-red-700">No hay usuarios de tesorería activos. Avisá al administrador.</p>
            : (
              <select value={uid} onChange={(e) => setUid(e.target.value)} className={inputClass}>
                <option value="">Elegir…</option>
                {receptores.map((r) => <option key={r.uid} value={r.uid}>{r.nombre}</option>)}
              </select>
            )}
        </div>

        {receptor && (
          <div className="rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Handshake size={16} className="text-accent" /> {receptor.nombre}: firmá acá que recibís el sobre {sobre.codigo} cerrado</p>
            <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
            <div className="flex justify-between">
              <p className="text-xs text-secundario">Al firmar, la custodia de la plata pasa a {receptor.nombre}. Después la cuenta a ciegas en Recepción.</p>
              <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
            </div>
          </div>
        )}

        {(falta || error) && <p className="text-sm text-red-700">{falta || error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancelar} className="flex-1">Cancelar</Button>
          <Button type="button" onClick={entregar} loading={guardando} disabled={!receptor} className="flex-1"><Handshake size={16} /> Entregar y firmar</Button>
        </div>
      </div>
    </Modal>
  )
}
