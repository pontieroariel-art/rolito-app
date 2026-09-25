import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { formatoARS } from '@/utils/money'
import { FORMAS_CIERRE_VALE, type FormaCierreVale, type ValeCaja } from '@/types'

// Tesorería cierra un vale de caja (2026-09-25): con el comprobante del gasto,
// con un descuento de sueldo o porque devolvieron la plata. Queda escrito
// quién lo cerró, cómo y con qué nota; el vale deja de figurar como abierto.
export default function CerrarValeModal({ vale, guardando, error, onCancelar, onCerrar }: {
  vale: ValeCaja
  guardando: boolean
  error: string
  onCancelar: () => void
  onCerrar: (datos: { forma: FormaCierreVale; nota: string }) => void
}) {
  const [forma, setForma] = useState<FormaCierreVale | ''>('')
  const [nota, setNota] = useState('')
  const [falta, setFalta] = useState('')
  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const cerrar = () => {
    setFalta('')
    if (!forma) { setFalta('Elegí cómo se cierra el vale.'); return }
    if (forma !== 'devolucion' && !nota.trim()) { setFalta(forma === 'comprobante' ? 'Anotá qué comprobante trajo (tipo y número).' : 'Anotá en qué liquidación de sueldo se descuenta.'); return }
    onCerrar({ forma, nota: nota.trim() })
  }
  return (
    <Modal open onClose={onCancelar} title={`Cerrar el vale ${vale.codigo}`} variant="light">
      <div className="space-y-4">
        <p className="text-sm text-gray-800"><b className="tabular-nums">{formatoARS(vale.importe)}</b> de {vale.empresa === 'rolito' ? 'Rolito' : 'Redonhielo'} a <b>{vale.receptor.nombre}</b>{vale.receptor.dni ? ` (DNI ${vale.receptor.dni})` : ''} · {vale.motivo}<br /><span className="text-secundario">Lo dio {vale.emitio.nombre} el {vale.fecha.slice(8, 10)}/{vale.fecha.slice(5, 7)}.</span></p>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Cómo se cierra</p>
          <div className="space-y-1.5">
            {(Object.keys(FORMAS_CIERRE_VALE) as FormaCierreVale[]).map((f) => (
              <button key={f} type="button" onClick={() => setForma(f)}
                className={`w-full text-left h-11 rounded-lg border px-3 text-sm font-semibold ${forma === f ? 'border-[#1D9E75] bg-[#E6F5EF] text-[#178760]' : 'border-[#D3D1C7] bg-white text-gray-700'}`}>
                {FORMAS_CIERRE_VALE[f]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="vale-cierre-nota" className="block text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Nota{forma === 'devolucion' ? ' (opcional)' : ''}</label>
          <textarea id="vale-cierre-nota" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} className={inputClass}
            placeholder={forma === 'comprobante' ? 'Factura B 0003-00012345 de YPF…' : forma === 'descuento_sueldo' ? 'Se descuenta en la liquidación de octubre…' : 'Devolvió la plata en mano…'} />
        </div>
        {(falta || error) && <p className="text-sm text-red-700">{falta || error}</p>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancelar} className="flex-1" disabled={guardando}>Cancelar</Button>
          <Button type="button" onClick={cerrar} loading={guardando} className="flex-1"><CheckCircle2 size={16} /> Cerrar vale</Button>
        </div>
      </div>
    </Modal>
  )
}
