import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import { useUmbralFaltantes } from '@/hooks/useUmbralFaltantes'
import { guardarUmbralFaltantes } from '@/services/faltantesConfigService'
import { reportError } from '@/services/observability'
import type { UmbralFaltantes } from '@/utils/faltantes'

const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

// Umbral desde el que un faltante en la descarga contada es grave
// (config/liquidacion.faltantes). El muelle no lo ve nunca: cuenta a ciegas y
// la tablet no lo retiene. Lo usan la marca que escribe el servidor sobre la
// descarga y el cierre de la liquidación en caja.
export default function FaltantesLiquidacionPanel() {
  const cfg = useUmbralFaltantes()
  const [form, setForm] = useState<UmbralFaltantes>(cfg)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { setForm(cfg) }, [cfg])

  const guardar = async () => {
    setGuardando(true)
    setMsg('')
    try {
      await guardarUmbralFaltantes(form)
      setMsg('Guardado.')
    } catch (err) {
      reportError(err, { origen: 'FaltantesLiquidacionPanel' })
      setMsg('No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Faltantes en la descarga del camión</h2>
        <p className="text-sm text-secundario">
          Cuando lo que el muelle contó al volver el camión no llega a lo que tendría que haber vuelto
          (carga menos ventas menos cambios), desde cuántas bolsas el desvío es grave y hay que resolverlo
          antes de cerrar la liquidación del repartidor. Lo que sobra no compensa lo que falta.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-secundario mb-1 block">Desvío grave desde</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={form.bolsas}
              onChange={(e) => setForm({ ...form, bolsas: Number(e.target.value) })}
              className={inputClass}
            />
            <span className="text-xs text-secundario shrink-0">bolsas faltantes</span>
          </div>
        </label>
        <label className="flex items-center gap-2 sm:mt-6">
          <input
            type="checkbox"
            checked={form.habilitado}
            onChange={(e) => setForm({ ...form, habilitado: e.target.checked })}
            className="w-4 h-4 accent-accent"
          />
          <span className="text-sm text-gray-900">Control activo</span>
        </label>
      </div>
      <p className="text-xs text-secundario">
        {form.habilitado
          ? <>Hoy: un camión que vuelve con {form.bolsas} bolsas de menos queda marcado para revisar. Con menos que eso se asienta y listo.</>
          : <>Control apagado: los faltantes se siguen calculando y se ven en la liquidación, pero ninguno traba el cierre.</>}
      </p>
      <p className="text-xs text-secundario">
        Conviene arrancar flojo y ajustarlo con los primeros días reales. Un umbral que traba todos los días
        termina en que alguien apruebe todo sin mirar, y el control queda de adorno.
      </p>
      <div className="flex items-center gap-3">
        <Button onClick={guardar} loading={guardando}>Guardar</Button>
        {msg && <span className="text-sm text-secundario">{msg}</span>}
      </div>
    </section>
  )
}
