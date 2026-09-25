import { useRef, useState } from 'react'
import { Handshake } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/common/SignaturePad'
import { formatoARS } from '@/utils/money'
import { topeAnticipo } from '@/utils/sobres'
import type { ReceptorTesoreria } from '@/components/expedicion/EntregarSobreModal'
import type { EmpresaTango, SobrePorEmpresa } from '@/types'

// Anticipo a tesorería (2026-09-23, pedido de Ariel: "muchas veces hay vales de
// anticipo de caja, por ejemplo $1.000.000 a tesorería antes del cierre"). El
// cajero pone el monto, de qué empresa sale (Redonhielo por defecto) y a quién
// se lo da, y LE PASA LA TABLET para que esa persona firme que lo recibió. El
// tope es lo que hay en el cajón de esa empresa. Queda numerado (VA-DT-…),
// descuenta del cajón y aparece al instante en Sobres de tesorería.

export interface DatosAnticipoModal {
  monto:   number
  empresa: EmpresaTango
  recibio: ReceptorTesoreria
  firmaRecibe: string
}

const NOMBRE: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }

export default function AnticipoModal({ porEmpresa, receptores, guardando, error, onCancelar, onEntregar }: {
  porEmpresa: SobrePorEmpresa | undefined
  receptores: ReceptorTesoreria[]
  guardando: boolean
  error: string
  onCancelar: () => void
  onEntregar: (datos: DatosAnticipoModal) => void
}) {
  const [montoTexto, setMontoTexto] = useState('')
  const [empresa, setEmpresa] = useState<EmpresaTango>('redonhielo')
  const [uid, setUid] = useState(receptores.length === 1 ? receptores[0].uid : '')
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)
  const receptor = receptores.find((r) => r.uid === uid)
  const monto = Number(montoTexto.replace(/\./g, '').replace(',', '.')) || 0
  const tope = topeAnticipo(porEmpresa, empresa)
  const pasado = monto > tope
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  const entregar = () => {
    setFalta('')
    if (!(monto > 0)) { setFalta('Poné el monto del anticipo.'); return }
    if (pasado) { setFalta(`En tu caja hay ${formatoARS(tope)} de ${NOMBRE[empresa]}: el anticipo no puede pasar de eso.`); return }
    if (!receptor) { setFalta('Elegí quién recibe el anticipo.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta(`Falta la firma de ${receptor.nombre}.`); return }
    onEntregar({ monto, empresa, recibio: receptor, firmaRecibe: firma })
  }

  return (
    <Modal open onClose={onCancelar} title="Anticipo a tesorería" variant="light" wide>
      <div className="space-y-4">
        <p className="text-sm text-secundario">Plata que sale de tu caja antes de cerrar el turno. Elegí cuánto, de qué empresa y a quién se lo das, y pasale la tablet para que firme que lo recibió.</p>

        <div>
          <label htmlFor="anticipo-monto" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Monto</label>
          <input id="anticipo-monto" inputMode="numeric" value={montoTexto} onChange={(e) => setMontoTexto(e.target.value)} placeholder="Ej. 1.000.000"
            className={`${inputClass} text-2xl font-bold tabular-nums h-14 ${pasado ? 'border-red-400' : ''}`} />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Empresa</p>
          <div className="grid grid-cols-2 gap-2">
            {(['redonhielo', 'rolito'] as const).map((e) => (
              <button key={e} type="button" onClick={() => setEmpresa(e)}
                className={`h-11 rounded-lg border text-sm font-semibold ${empresa === e ? 'border-[#1D9E75] bg-[#E6F5EF] text-[#178760]' : 'border-[#D3D1C7] bg-white text-gray-700'}`}>
                {NOMBRE[e]}
              </button>
            ))}
          </div>
          <p className={`text-xs mt-1 tabular-nums ${pasado ? 'text-red-700' : 'text-secundario'}`}>
            En tu caja hay {formatoARS(tope)} de {NOMBRE[empresa]}: el anticipo no puede pasar de eso.
          </p>
        </div>

        <div>
          <label htmlFor="anticipo-receptor" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Quién recibe (tesorería)</label>
          {receptores.length === 0
            ? <p className="text-sm text-red-700">No hay usuarios de tesorería activos. Avisá al administrador.</p>
            : (
              <select id="anticipo-receptor" value={uid} onChange={(e) => setUid(e.target.value)} className={inputClass}>
                <option value="">Elegir…</option>
                {receptores.map((r) => <option key={r.uid} value={r.uid}>{r.nombre}</option>)}
              </select>
            )}
        </div>

        {receptor && (
          <div className="rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Handshake size={16} className="text-accent" /> {receptor.nombre}: firmá acá que recibís {monto > 0 ? formatoARS(monto) : 'el anticipo'} de {NOMBRE[empresa]}</p>
            <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
            <div className="flex justify-between">
              <p className="text-xs text-secundario">Al firmar, la plata pasa a {receptor.nombre}. Después la cuenta en Sobres.</p>
              <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
            </div>
          </div>
        )}

        {(falta || error) && <p className="text-sm text-red-700">{falta || error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={entregar} loading={guardando} disabled={!receptor || !(monto > 0) || pasado} className="flex-1"><Handshake size={16} /> Entregar anticipo</Button>
        </div>
      </div>
    </Modal>
  )
}
