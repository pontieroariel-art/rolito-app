import { useRef, useState } from 'react'
import { Receipt } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SignaturePad, { type SignaturePadHandle } from '@/components/common/SignaturePad'
import { formatoARS } from '@/utils/money'
import { topeVale } from '@/utils/sobres'
import type { EmpresaTango, SobrePorEmpresa } from '@/types'

// Vale de caja (2026-09-25, definiciones de Ariel: cualquier persona, sin
// autorización, sin tope, motivo escrito a mano). El cajero pone cuánto, de
// qué empresa sale, a quién (nombre y DNI) y por qué, y LE PASA LA TABLET para
// que esa persona firme que recibió la plata. Sale numerado (VC-DT-…),
// descuenta del cajón y viaja en el sobre como un papel más.

export interface DatosValeModal {
  importe: number
  empresa: EmpresaTango
  receptor: { nombre: string; dni?: string }
  motivo:  string
  firmaRecibe: string
}

const NOMBRE: Record<EmpresaTango, string> = { redonhielo: 'Redonhielo', rolito: 'Rolito' }

export default function ValeModal({ porEmpresa, guardando, error, onCancelar, onEntregar }: {
  porEmpresa: SobrePorEmpresa | undefined
  guardando: boolean
  error: string
  onCancelar: () => void
  onEntregar: (datos: DatosValeModal) => void
}) {
  const [importeTexto, setImporteTexto] = useState('')
  const [empresa, setEmpresa] = useState<EmpresaTango>('redonhielo')
  const [nombre, setNombre] = useState('')
  const [dni, setDni] = useState('')
  const [motivo, setMotivo] = useState('')
  const [falta, setFalta] = useState('')
  const firmaRef = useRef<SignaturePadHandle>(null)
  const importe = Number(importeTexto.replace(/\./g, '').replace(',', '.')) || 0
  const tope = topeVale(porEmpresa, empresa)
  const pasado = importe > tope
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

  const entregar = () => {
    setFalta('')
    if (!(importe > 0)) { setFalta('Poné el importe del vale.'); return }
    if (pasado) { setFalta(`En tu caja hay ${formatoARS(tope)} de ${NOMBRE[empresa]}: el vale no puede pasar de eso.`); return }
    if (!nombre.trim()) { setFalta('Poné el nombre de quien recibe la plata.'); return }
    if (!motivo.trim()) { setFalta('Escribí el motivo del vale.'); return }
    const firma = firmaRef.current?.toDataURL()
    if (!firma) { setFalta(`Falta la firma de ${nombre.trim()}.`); return }
    onEntregar({ importe, empresa, receptor: { nombre: nombre.trim(), ...(dni.trim() ? { dni: dni.trim() } : {}) }, motivo: motivo.trim(), firmaRecibe: firma })
  }

  return (
    <Modal open onClose={onCancelar} title="Vale de caja" variant="light" wide>
      <div className="space-y-4">
        <p className="text-sm text-secundario">Plata que sale de tu caja contra un vale. Poné cuánto, de qué empresa, a quién y por qué, y pasale la tablet para que firme que la recibió. Queda registrado en tu liquidación y el papel va en el sobre.</p>

        <div>
          <label htmlFor="vale-importe" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Importe</label>
          <input id="vale-importe" inputMode="numeric" value={importeTexto} onChange={(e) => setImporteTexto(e.target.value)} placeholder="Ej. 50.000"
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
          <p className={`text-xs mt-1 tabular-nums ${pasado ? 'text-red-700' : 'text-secundario'}`}>En tu caja hay {formatoARS(tope)} de {NOMBRE[empresa]}.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
          <div>
            <label htmlFor="vale-nombre" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Quién recibe</label>
            <input id="vale-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" className={inputClass} />
          </div>
          <div>
            <label htmlFor="vale-dni" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">DNI (opcional)</label>
            <input id="vale-dni" inputMode="numeric" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678" className={inputClass} />
          </div>
        </div>

        <div>
          <label htmlFor="vale-motivo" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Motivo</label>
          <textarea id="vale-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej. adelanto de sueldo · combustible del camión · pago a proveedor…" className={inputClass} />
        </div>

        <div className="rounded-xl border border-[#D3D1C7] bg-[#F8F7F2] p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Receipt size={16} className="text-accent" /> {nombre.trim() || 'Quien recibe'}: firmá acá que recibís {importe > 0 ? formatoARS(importe) : 'la plata'} de {NOMBRE[empresa]}</p>
          <div className="rounded-lg border border-[#D3D1C7] bg-white"><SignaturePad ref={firmaRef} /></div>
          <div className="flex justify-between">
            <p className="text-xs text-secundario">Al firmar, el vale sale numerado y se imprime para que quede en la caja.</p>
            <button type="button" onClick={() => firmaRef.current?.clear()} className="text-xs text-secundario hover:text-gray-800 whitespace-nowrap">Borrar firma</button>
          </div>
        </div>

        {(falta || error) && <p className="text-sm text-red-700">{falta || error}</p>}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={entregar} loading={guardando} disabled={!(importe > 0) || pasado} className="flex-1"><Receipt size={16} /> Entregar vale</Button>
        </div>
      </div>
    </Modal>
  )
}
