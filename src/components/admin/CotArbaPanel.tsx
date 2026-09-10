import { useEffect, useMemo, useState } from 'react'
import Button from '../ui/Button'
import { useCotConfig } from '@/hooks/useCotConfig'
import { useCatalogo } from '@/hooks/useCatalogo'
import { guardarCotConfig } from '@/services/cotConfigService'
import { reportError } from '@/services/observability'
import { CODIGO_ARBA_AGUA, CODIGO_ARBA_HIELO, pesoSugerido } from '@/utils/cot'
import { formatoARS } from '@/utils/money'
import { PLANTAS, type CotConfig, type CotDomicilio, type PlantaId } from '@/types'

const input = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-xs text-gray-500 mb-1 block'

// Configuración del COT de ARBA (config/cot): interruptor y ambiente, umbrales,
// talonario del remito R que respalda la carga, domicilio y recorrido de cada
// planta y peso / código de ARBA por producto del catálogo. La clave CIT no va
// acá (secret ARBA_CIT de las functions). Ver docs/arba/COT.md.
export default function CotArbaPanel() {
  const { cfg, cargado } = useCotConfig()
  const { catalogo } = useCatalogo()
  const [form, setForm] = useState<CotConfig>(cfg)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { if (cargado) setForm(cfg) }, [cfg, cargado])

  // Productos del catálogo con lo cargado (o el peso que sugiere el nombre y el código del hielo).
  const filasProductos = useMemo(() => catalogo.map((p) => {
    const c = form.productos[p.id]
    return { id: p.id, nombre: p.nombre, pesoKg: c?.pesoKg ?? pesoSugerido(p), codigoArba: c?.codigoArba ?? (/agua/i.test(p.nombre) ? CODIGO_ARBA_AGUA : CODIGO_ARBA_HIELO), descripcion: c?.descripcion ?? p.nombre.toUpperCase().slice(0, 40), cargado: !!c }
  }), [catalogo, form.productos])

  const setProducto = (id: string, parte: Partial<CotConfig['productos'][string]>) => {
    const fila = filasProductos.find((f) => f.id === id)!
    // `fila` ya refleja lo cargado en form.productos[id] o lo sugerido.
    setForm({ ...form, productos: { ...form.productos, [id]: { pesoKg: fila.pesoKg, codigoArba: fila.codigoArba, descripcion: fila.descripcion, ...parte } } })
  }
  const setPlanta = (id: PlantaId, parte: Partial<CotConfig['plantas'][PlantaId]>) =>
    setForm({ ...form, plantas: { ...form.plantas, [id]: { ...form.plantas[id], ...parte } } })
  const setDomicilio = (id: PlantaId, parte: Partial<CotDomicilio>) =>
    setPlanta(id, { domicilio: { ...form.plantas[id].domicilio, ...parte } })

  const guardar = async () => {
    setGuardando(true)
    setMsg('')
    try {
      // Los productos que no se tocaron se guardan con lo sugerido, así el server tiene el peso de todos.
      const productos = { ...form.productos }
      for (const f of filasProductos) if (!productos[f.id]) productos[f.id] = { pesoKg: f.pesoKg, codigoArba: f.codigoArba, descripcion: f.descripcion }
      await guardarCotConfig({ ...form, productos })
      setMsg('Guardado.')
    } catch (err) {
      reportError(err, { origen: 'CotArbaPanel' })
      setMsg('No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">COT de ARBA (remito de carga)</h2>
        <p className="text-sm text-gray-500">
          Código de Operación de Traslado. Obligatorio cuando la carga que sale de la planta supera los {form.umbralKg.toLocaleString('es-AR')} kg o {formatoARS(form.umbralImporte)}.
          Caja lo declara al emitir el remito de carga y el sistema lo presenta a ARBA. La clave CIT vive en el servidor (secret ARBA_CIT).
        </p>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-800 sm:col-span-2">
          <input type="checkbox" checked={form.habilitado} onChange={(e) => setForm({ ...form, habilitado: e.target.checked })} className="accent-[#1D9E75]" />
          Presentar a ARBA al emitir el remito
        </label>
        <label className="block">
          <span className={label}>Ambiente</span>
          <select value={form.ambiente} onChange={(e) => setForm({ ...form, ambiente: e.target.value as CotConfig['ambiente'] })} className={input}>
            <option value="produccion">Producción</option>
            <option value="prueba">Prueba (homologación)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={form.bloqueaSalida} onChange={(e) => setForm({ ...form, bloqueaSalida: e.target.checked })} className="accent-[#1D9E75]" />
          Seguridad no libera sin COT
        </label>
      </div>

      <div className="grid sm:grid-cols-4 gap-3">
        <label className="block"><span className={label}>CUIT empresa</span><input value={form.cuit} onChange={(e) => setForm({ ...form, cuit: e.target.value.replace(/\D/g, '') })} className={input} /></label>
        <label className="block"><span className={label}>Razón social (como en ARBA)</span><input value={form.razonSocial} onChange={(e) => setForm({ ...form, razonSocial: e.target.value })} className={input} /></label>
        <label className="block"><span className={label}>Umbral en kilos</span><input type="number" value={form.umbralKg} onChange={(e) => setForm({ ...form, umbralKg: Number(e.target.value) })} className={input} /></label>
        <label className="block"><span className={label}>Umbral en pesos</span><input type="number" value={form.umbralImporte} onChange={(e) => setForm({ ...form, umbralImporte: Number(e.target.value) })} className={input} /></label>
        <label className="block"><span className={label}>Remito R que respalda: talonario (pto. de venta)</span><input type="number" value={form.respaldo.prefijo} onChange={(e) => setForm({ ...form, respaldo: { ...form.respaldo, prefijo: Number(e.target.value) } })} className={input} /></label>
        <label className="block"><span className={label}>Código ARBA del comprobante</span><input value={form.respaldo.codigoComprobante} onChange={(e) => setForm({ ...form, respaldo: { ...form.respaldo, codigoComprobante: e.target.value } })} className={input} placeholder="091 = Remito R" /></label>
        <label className="block"><span className={label}>Importe sugerido por kilo ($)</span><input type="number" value={form.importePorKg} onChange={(e) => setForm({ ...form, importePorKg: Number(e.target.value) })} className={input} /></label>
        <label className="block"><span className={label}>CUIT transportista (propio = el de la empresa)</span><input value={form.transportista.cuit} onChange={(e) => setForm({ ...form, transportista: { cuit: e.target.value.replace(/\D/g, '') } })} className={input} /></label>
      </div>

      {(Object.keys(form.plantas) as PlantaId[]).map((id) => {
        const p = form.plantas[id]
        return (
          <div key={id} className="border border-[#D3D1C7] rounded-xl p-3 space-y-2">
            <p className="text-sm font-semibold text-gray-800">{PLANTAS[id].label}</p>
            <div className="grid sm:grid-cols-6 gap-2">
              <label className="block sm:col-span-2"><span className={label}>Calle</span><input value={p.domicilio.calle} onChange={(e) => setDomicilio(id, { calle: e.target.value })} className={input} /></label>
              <label className="block"><span className={label}>Número (0 = S/N)</span><input type="number" value={p.domicilio.numero} onChange={(e) => setDomicilio(id, { numero: Number(e.target.value) })} className={input} /></label>
              <label className="block"><span className={label}>C.P.</span><input value={p.domicilio.cp} onChange={(e) => setDomicilio(id, { cp: e.target.value })} className={input} /></label>
              <label className="block sm:col-span-2"><span className={label}>Localidad</span><input value={p.domicilio.localidad} onChange={(e) => setDomicilio(id, { localidad: e.target.value })} className={input} /></label>
              <label className="block"><span className={label}>Planta (ARBA)</span><input value={p.codigoPlanta} onChange={(e) => setPlanta(id, { codigoPlanta: e.target.value.replace(/\D/g, '').slice(0, 3) })} className={input} /></label>
              <label className="block"><span className={label}>Puerta</span><input value={p.puerta} onChange={(e) => setPlanta(id, { puerta: e.target.value.replace(/\D/g, '').slice(0, 3) })} className={input} /></label>
              <label className="block sm:col-span-2"><span className={label}>Recorrido urbano (localidad)</span><input value={p.recorrido.localidad} onChange={(e) => setPlanta(id, { recorrido: { ...p.recorrido, localidad: e.target.value } })} className={input} /></label>
              <label className="block sm:col-span-2"><span className={label}>Recorrido rural (ruta principal)</span><input value={p.recorrido.ruta} onChange={(e) => setPlanta(id, { recorrido: { ...p.recorrido, ruta: e.target.value } })} className={input} /></label>
            </div>
          </div>
        )
      })}

      <div>
        <p className="text-sm font-semibold text-gray-800 mb-1">Productos: peso por unidad y código de ARBA</p>
        <p className="text-xs text-gray-500 mb-2">Los kilos de la carga se calculan con esto. Código del nomenclador COT (NCM de 6 dígitos): hielo {CODIGO_ARBA_HIELO}, agua de mesa {CODIGO_ARBA_AGUA}.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-100"><th className="text-left py-1.5">Producto</th><th className="text-left py-1.5">kg por unidad</th><th className="text-left py-1.5">Código ARBA</th><th className="text-left py-1.5">Descripción (máx. 40)</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filasProductos.map((f) => (
                <tr key={f.id} className={f.cargado ? '' : 'text-gray-500'}>
                  <td className="py-1.5 pr-2">{f.nombre}{!f.cargado && <span className="ml-1 text-[11px] text-amber-600">(sugerido)</span>}</td>
                  <td className="py-1.5 pr-2"><input type="number" step="0.5" value={f.pesoKg} onChange={(e) => setProducto(f.id, { pesoKg: Number(e.target.value) })} className={`${input} w-24`} /></td>
                  <td className="py-1.5 pr-2"><input value={f.codigoArba} onChange={(e) => setProducto(f.id, { codigoArba: e.target.value.replace(/\D/g, '').slice(0, 6) })} className={`${input} w-28`} /></td>
                  <td className="py-1.5"><input value={f.descripcion} onChange={(e) => setProducto(f.id, { descripcion: e.target.value.toUpperCase().slice(0, 40) })} className={input} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={guardar} loading={guardando}>Guardar</Button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </section>
  )
}
