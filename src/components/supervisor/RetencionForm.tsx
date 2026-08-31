import { useState } from 'react'
import Button from '@/components/ui/Button'
import { parseImporte, formatoARS } from '@/utils/money'
import { RetencionRecibida, TipoRetencion } from '@/types'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

export const RETENCION_LABELS: Record<TipoRetencion, string> = {
  ganancias: 'Ret. Ganancias',
  iva:       'Ret. IVA',
  iibb_caba: 'Ret. IIBB CABA',
  iibb_pba:  'Ret. IIBB Prov. Bs. As.',
  suss:      'Ret. SUSS',
}

const TIPOS: TipoRetencion[] = ['ganancias', 'iva', 'iibb_caba', 'iibb_pba', 'suss']

// Alta de una retención impositiva que el cliente entrega junto con el pago:
// tipo (Ganancias / IVA / IIBB CABA / IIBB PBA / SUSS), número de certificado
// (obligatorio — sin él no se puede imputar el crédito fiscal) e importe.
export default function RetencionForm({ onAgregar, onCancelar }: {
  onAgregar:  (retencion: RetencionRecibida) => void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState<TipoRetencion | ''>('')
  const [nroCertificado, setNroCertificado] = useState('')
  const [importeStr, setImporteStr] = useState('')
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState('')

  const importe = parseImporte(importeStr)

  const agregar = () => {
    setError('')
    if (!tipo)                   { setError('Elegí el tipo de retención.'); return }
    if (!nroCertificado.trim())  { setError('Poné el número de certificado.'); return }
    if (importe <= 0)            { setError('Poné el importe de la retención.'); return }
    onAgregar({
      tipo,
      nroCertificado: nroCertificado.trim(),
      importe,
      ...(fecha ? { fecha } : {}),
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Tipo de retención</label>
        <div className="grid grid-cols-2 gap-2">
          {TIPOS.map((t) => (
            <button key={t} type="button" onClick={() => setTipo(t)}
              className={`py-2 px-2 rounded-lg text-sm font-medium border transition-colors ${
                tipo === t ? 'bg-accent/10 border-accent text-accent' : 'bg-white border-[#D3D1C7] text-gray-600 hover:bg-gray-50'
              }`}>
              {RETENCION_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nº de certificado</label>
          <input value={nroCertificado} onChange={(e) => setNroCertificado(e.target.value)} placeholder="0000-00000000" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Importe</label>
          <input value={importeStr} onChange={(e) => setImporteStr(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Fecha del certificado (opcional)</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputClass} />
      </div>

      {importe > 0 && (
        <div className="bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2">
          <p className="text-sm text-gray-700">
            {tipo ? RETENCION_LABELS[tipo] : 'Retención'}: <span className="font-semibold text-gray-900">{formatoARS(importe)}</span>
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" type="button" onClick={onCancelar} className="flex-1">Cancelar</Button>
        <Button type="button" onClick={agregar} className="flex-1">Agregar retención</Button>
      </div>
    </div>
  )
}
