import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { BANCOS, nombreBanco } from '@/constants/bancos'
import { parseImporte, formatoARS } from '@/utils/money'
import { ChequeRecibido } from '@/types'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

export function diasEntre(emision: string, acreditacion: string): number {
  const e = new Date(emision + 'T00:00:00')
  const a = new Date(acreditacion + 'T00:00:00')
  if (isNaN(e.getTime()) || isNaN(a.getTime())) return 0
  return Math.round((a.getTime() - e.getTime()) / 86_400_000)
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

// Alta de un cheque ("valores a depositar"): número, banco emisor (catálogo
// BCRA), fecha de emisión, fecha de acreditación, días entre ambas (calculado
// en vivo) e importe. Devuelve el cheque armado por onAgregar.
export default function ChequeForm({ onAgregar, onCancelar }: {
  onAgregar:  (cheque: ChequeRecibido) => void
  onCancelar: () => void
}) {
  const [numero, setNumero] = useState('')
  const [bancoCodigo, setBancoCodigo] = useState('')
  const [fechaEmision, setFechaEmision] = useState(hoyISO())
  const [fechaAcreditacion, setFechaAcreditacion] = useState(hoyISO())
  const [importeStr, setImporteStr] = useState('')
  const [esEcheq, setEsEcheq] = useState(false)
  const [error, setError] = useState('')

  const dias = useMemo(() => diasEntre(fechaEmision, fechaAcreditacion), [fechaEmision, fechaAcreditacion])
  const importe = parseImporte(importeStr)

  const agregar = () => {
    setError('')
    if (!numero.trim())          { setError('Poné el número del cheque.'); return }
    if (!bancoCodigo)            { setError('Elegí el banco emisor.'); return }
    if (!fechaEmision)           { setError('Poné la fecha de emisión.'); return }
    if (!fechaAcreditacion)      { setError('Poné la fecha de acreditación.'); return }
    if (dias < 0)                { setError('La acreditación no puede ser anterior a la emisión.'); return }
    if (importe <= 0)            { setError('Poné el importe del cheque.'); return }
    onAgregar({
      numero:            numero.trim(),
      bancoCodigo,
      bancoNombre:       nombreBanco(bancoCodigo),
      fechaEmision,
      fechaAcreditacion,
      dias,
      importe,
      ...(esEcheq ? { esEcheq: true } : {}),
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Nº de cheque</label>
          <input value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="numeric" placeholder="00000000" className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Importe</label>
          <input value={importeStr} onChange={(e) => setImporteStr(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputClass} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 mb-1 block">Banco emisor</label>
        <select value={bancoCodigo} onChange={(e) => setBancoCodigo(e.target.value)} className={inputClass}>
          <option value="">Elegir banco…</option>
          {BANCOS.map((b) => (
            <option key={b.codigo} value={b.codigo}>{b.codigo} — {b.nombre}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fecha de emisión</label>
          <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Fecha de acreditación</label>
          <input type="date" value={fechaAcreditacion} onChange={(e) => setFechaAcreditacion(e.target.value)} min={fechaEmision} className={inputClass} />
        </div>
      </div>

      <div className="flex items-center justify-between bg-[#F8F7F2] border border-[#D3D1C7] rounded-lg px-3 py-2">
        <p className="text-sm text-gray-700">
          Días para cobrar: <span className={`font-semibold ${dias < 0 ? 'text-red-500' : 'text-gray-900'}`}>{dias}</span>
        </p>
        {importe > 0 && <p className="text-sm font-semibold text-gray-900">{formatoARS(importe)}</p>}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={esEcheq} onChange={(e) => setEsEcheq(e.target.checked)} className="accent-[#1D9E75]" />
        Es e-cheq
      </label>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" type="button" onClick={onCancelar} className="flex-1">Cancelar</Button>
        <Button type="button" onClick={agregar} className="flex-1">Agregar cheque</Button>
      </div>
    </div>
  )
}
