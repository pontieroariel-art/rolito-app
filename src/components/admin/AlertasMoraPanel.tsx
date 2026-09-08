import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { guardarAlertasMora } from '@/services/moraConfigService'
import { reportError } from '@/services/observability'
import { nivelMora, type AlertasMoraConfig } from '@/utils/mora'
import { formatoARS } from '@/utils/money'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Umbrales de las alertas de mora que ve el supervisor en Clientes con deuda
// y en la ficha (config/cobranzas.alertasMora).
export default function AlertasMoraPanel() {
  const cfg = useAlertasMora()
  const [form, setForm] = useState<AlertasMoraConfig>(cfg)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { setForm(cfg) }, [cfg])

  const guardar = async () => {
    setGuardando(true)
    setMsg('')
    try {
      await guardarAlertasMora(form)
      setMsg('Guardado.')
    } catch (err) {
      reportError(err, { origen: 'AlertasMoraPanel' })
      setMsg('No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const campo = (k: keyof AlertasMoraConfig, label: string, sufijo: string) => (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" min={1} value={form[k]} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} className={inputClass} />
        <span className="text-xs text-gray-500 shrink-0">{sufijo}</span>
      </div>
    </label>
  )

  const ejemplo = nivelMora(form.importeRojo, form.diasAmarillo, form)
  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Alertas de mora (supervisores)</h2>
        <p className="text-sm text-gray-500">
          Con cuántos días de atraso un cliente pasa a amarillo y a rojo en "Clientes con deuda" y en la ficha.
          Un cliente vencido con un saldo grande es rojo aunque no llegue a los días de rojo.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {campo('diasAmarillo', 'Amarillo desde', 'días de atraso')}
        {campo('diasRojo', 'Rojo desde', 'días de atraso')}
        {campo('importeRojo', 'Rojo por importe', '$ de saldo vencido')}
      </div>
      <p className="text-xs text-gray-500">
        Ejemplo: {form.diasAmarillo} días de atraso con {formatoARS(form.importeRojo)} de saldo → <b>{ejemplo === 'rojo' ? 'rojo' : ejemplo === 'amarillo' ? 'amarillo' : 'al día'}</b>.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={guardar} loading={guardando}>Guardar</Button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </section>
  )
}
