import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { useCopiasTicketVentanilla } from '@/hooks/useCopiasTicketVentanilla'
import { guardarCopiasTicket, type CopiasTicketPorPlanta } from '@/services/ventanillaConfigService'
import { reportError } from '@/services/observability'
import { COPIAS_TICKET } from '@/utils/ventanillaTicket'
import { PLANTAS, type PlantaId } from '@/types'

const selectClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Copias del comprobante de turno que imprime caja (config/ventanilla).
// Triplicado mientras muelle y seguridad controlen en papel; cuando pasen a
// la app se baja acá, sin deploy.
export default function VentanillaPanel() {
  const cfg = useCopiasTicketVentanilla()
  const [form, setForm] = useState<CopiasTicketPorPlanta>(cfg)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { setForm(cfg) }, [cfg])

  const guardar = async () => {
    setGuardando(true)
    setMsg('')
    try {
      await guardarCopiasTicket(form)
      setMsg('Guardado.')
    } catch (err) {
      reportError(err, { origen: 'VentanillaPanel' })
      setMsg('No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const etiquetas = ['Solo original (cliente)', 'Original + duplicado (muelle)', 'Original + duplicado + triplicado (seguridad)']

  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Ventanilla: copias del comprobante de turno</h2>
        <p className="text-sm text-gray-500">
          Cuántas copias del comprobante imprime caja en cada venta. {COPIAS_TICKET.map((c) => c.leyenda).join(' · ')}.
          Cada copia lleva su leyenda y su renglón de firma. La factura electrónica sale una sola vez.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {(Object.keys(PLANTAS) as PlantaId[]).map((p) => (
          <label key={p} className="block">
            <span className="text-xs text-gray-500 mb-1 block">{PLANTAS[p].label}</span>
            <select value={form[p]} onChange={(e) => setForm({ ...form, [p]: Number(e.target.value) })} className={selectClass}>
              {etiquetas.map((t, i) => <option key={i + 1} value={i + 1}>{i + 1} — {t}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={guardar} loading={guardando}>Guardar</Button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </section>
  )
}
