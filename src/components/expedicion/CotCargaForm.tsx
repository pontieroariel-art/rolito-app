import { useEffect, useMemo, useState, useCallback } from 'react'
import { FileCheck2 } from 'lucide-react'
import ClienteCombobox from '@/components/common/ClienteCombobox'
import type { ClienteIndex } from '@/types'
import { useClientesIndex } from '@/hooks/useClientesIndex'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { sucursalesDe, etiquetaSucursal } from '@/utils/sucursalesTango'
import { cuitLimpio, domicilioDeCliente, formatoRespaldo, otraPlanta, parsearCalleNumero, salidaSugerida } from '@/utils/cot'
import { formatoARS } from '@/utils/money'
import { PLANTAS, type CotConfig, type CotDomicilio, type CotSolicitud, type CotTipoRecorrido, type PlantaId } from '@/types'

// Bloque "COT de ARBA" del remito de carga (2026-09-10): aparece cuando la carga
// supera los umbrales (kilos / importe). Caja declara a dónde va (un cliente de
// la zona de reparto, con su sucursal, o la otra planta), el remito R que
// respalda el traslado, el importe, el recorrido y la hora de salida. El
// resultado es una CotSolicitud que viaja en el remito y que el server presenta
// a ARBA al emitir. Ver docs/arba/COT.md.

const input = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-xs text-gray-500 mb-1 block'

export default function CotCargaForm({ plantaId, cfg, kg, patente, respaldoAuto = false, onChange }: {
  plantaId: PlantaId
  cfg:      CotConfig
  kg:       number
  patente:  string
  /** La app numera el remito R al emitir (talonario con CAI vigente): no se pide el número. */
  respaldoAuto?: boolean
  onChange: (s: CotSolicitud | null) => void
}) {
  const plantaCfg = cfg.plantas[plantaId]
  const [tipo, setTipo] = useState<'cliente' | 'planta'>('cliente')
  const [clienteUid, setClienteUid] = useState('')
  const [codigoSucursal, setCodigoSucursal] = useState('')
  const [consumidorFinal, setConsumidorFinal] = useState(false)
  const [numeroR, setNumeroR] = useState('')
  const [importe, setImporte] = useState('')
  const [tipoRecorrido, setTipoRecorrido] = useState<CotTipoRecorrido>(plantaCfg.recorrido.tipo)
  const [localidad, setLocalidad] = useState(plantaCfg.recorrido.localidad)
  const [ruta, setRuta] = useState(plantaCfg.recorrido.ruta)
  const [salida, setSalida] = useState(() => salidaSugerida())
  const [domicilioEditado, setDomicilioEditado] = useState<CotDomicilio | null>(null)

  // Solo clientes que Tango conoce: el COT necesita el código de la cuenta.
  const soloVinculados = useCallback((c: ClienteIndex) => c.vinculadoTango, [])
  const { cliente } = useClienteSeleccionado(clienteUid || null)
  const sucursales = useMemo(() => (cliente ? sucursalesDe(cliente, 'redonhielo') : []), [cliente])

  // Al cambiar de cliente: sucursal principal, consumidor final si no tiene CUIT válido, domicilio de la ficha.
  useEffect(() => {
    setCodigoSucursal('')
    setDomicilioEditado(null)
    if (cliente) setConsumidorFinal(!/^\d{11}$/.test(cuitLimpio(cliente.cuit)))
  }, [cliente])
  useEffect(() => { setDomicilioEditado(null) }, [codigoSucursal])

  // Importe sugerido por los kilos (config/cot.importePorKg) mientras caja no lo toque.
  useEffect(() => {
    if (cfg.importePorKg > 0 && importe === '') setImporte(String(Math.round(kg * cfg.importePorKg)))
    // solo al cambiar los kilos o la config
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, cfg.importePorKg])

  const domicilioFicha = useMemo<CotDomicilio | null>(() => (cliente ? domicilioDeCliente(cliente, codigoSucursal || null) : null), [cliente, codigoSucursal])
  const domicilio = domicilioEditado ?? domicilioFicha

  useEffect(() => {
    const respaldo = { codigoComprobante: cfg.respaldo.codigoComprobante, prefijo: cfg.respaldo.prefijo, numero: parseInt(numeroR.replace(/\D/g, ''), 10) || 0, importe: Number(importe.replace(/[^\d.]/g, '')) || 0 }
    const recorrido = { tipo: tipoRecorrido, localidad, ruta }
    if (tipo === 'planta') {
      onChange({ destino: { tipo: 'planta', plantaId: otraPlanta(plantaId) }, respaldo: { ...respaldo, importe: 0 }, patente, recorrido, ...salida })
      return
    }
    if (!cliente || !domicilio) { onChange(null); return }
    onChange({
      destino: {
        tipo: 'cliente', clienteUid: cliente.uid, ...(codigoSucursal ? { codigoTango: codigoSucursal } : {}),
        razonSocial: cliente.razonSocial, cuit: cuitLimpio(cliente.cuit), consumidorFinal, domicilio,
      },
      respaldo, patente, recorrido, ...salida,
    })
  }, [tipo, cliente, codigoSucursal, consumidorFinal, domicilio, numeroR, importe, tipoRecorrido, localidad, ruta, salida, patente, plantaId, cfg.respaldo, onChange])

  const editarDomicilio = (parte: Partial<CotDomicilio> & { calleNumero?: string }) => {
    const base = domicilio ?? { calle: '', numero: 0, cp: '', localidad: '', provincia: 'B' }
    const { calleNumero, ...resto } = parte
    const cn = calleNumero !== undefined ? parsearCalleNumero(calleNumero) : {}
    setDomicilioEditado({ ...base, ...cn, ...resto })
  }
  const calleNumeroTexto = domicilio ? `${domicilio.calle}${domicilio.numero > 0 ? ` ${domicilio.numero}` : ''}` : ''

  return (
    <div className="bg-blue-50/60 border border-blue-200 rounded-lg px-3 py-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><FileCheck2 size={16} className="text-blue-600" /> COT de ARBA</p>
          <p className="text-xs text-gray-500">La carga pesa <b>{kg.toLocaleString('es-AR')} kg</b>: supera el umbral y necesita Código de Operación de Traslado. Se pide a ARBA al emitir el remito.</p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {(['cliente', 'planta'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTipo(t)}
            className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${tipo === t ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
            {t === 'cliente' ? 'Reparto a clientes' : `Traslado a ${PLANTAS[otraPlanta(plantaId)].label}`}
          </button>
        ))}
      </div>

      {tipo === 'cliente' ? (
        <div className="space-y-2">
          <div>
            <label className={label}>Cliente destinatario (uno de la zona de reparto)</label>
            <ClienteCombobox filtro={soloVinculados} value={clienteUid} onChange={setClienteUid} placeholder="Buscar cliente…" />
          </div>
          {sucursales.length > 1 && (
            <div>
              <label className={label}>Sucursal</label>
              <select value={codigoSucursal} onChange={(e) => setCodigoSucursal(e.target.value)} className={input}>
                <option value="">Principal ({cliente?.codigoTango ?? sucursales[0]?.codigo})</option>
                {sucursales.map((s) => <option key={s.codigo} value={s.codigo}>{etiquetaSucursal(s)}</option>)}
              </select>
            </div>
          )}
          {cliente && domicilio && (
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2">
                <label className={label}>Domicilio de destino (calle y número)</label>
                <input value={calleNumeroTexto} onChange={(e) => editarDomicilio({ calleNumero: e.target.value })} className={input} />
              </div>
              <div>
                <label className={label}>Localidad</label>
                <input value={domicilio.localidad} onChange={(e) => editarDomicilio({ localidad: e.target.value.toUpperCase() })} className={input} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>C.P.</label>
                  <input value={domicilio.cp} onChange={(e) => editarDomicilio({ cp: e.target.value.replace(/\D/g, '').slice(0, 8) })} inputMode="numeric" className={input} />
                </div>
                <div>
                  <label className={label}>Provincia</label>
                  <select value={domicilio.provincia} onChange={(e) => editarDomicilio({ provincia: e.target.value })} className={input}>
                    <option value="B">Buenos Aires</option>
                    <option value="C">CABA</option>
                  </select>
                </div>
              </div>
              <label className="sm:col-span-2 flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={consumidorFinal} onChange={(e) => setConsumidorFinal(e.target.checked)} className="accent-[#1D9E75]" />
                Consumidor final{cliente.cuit ? ` · CUIT ${cliente.cuit}` : ' · sin CUIT en la ficha'}
              </label>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-600">
          Origen y destinatario Redonhielo, destino {cfg.plantas[otraPlanta(plantaId)].domicilio.calle} {cfg.plantas[otraPlanta(plantaId)].domicilio.numero || 'S/N'}, {cfg.plantas[otraPlanta(plantaId)].domicilio.localidad}. Importe 0 (traslado entre depósitos propios).
        </p>
      )}

      <div className="grid sm:grid-cols-3 gap-2">
        <div>
          <label className={label}>Remito R que respalda (talonario {String(cfg.respaldo.prefijo).padStart(5, '0')})</label>
          {respaldoAuto ? (
            <p className="text-sm text-gray-700 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2">Lo numera la app al emitir (remito R "PARA REPARTO" con CAI).</p>
          ) : (
            <>
              <input value={numeroR} onChange={(e) => setNumeroR(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder="Nº del talonario" className={input} />
              {numeroR && <p className="text-[11px] text-gray-400 mt-0.5">{formatoRespaldo({ prefijo: cfg.respaldo.prefijo, numero: Number(numeroR) })}</p>}
            </>
          )}
        </div>
        {tipo === 'cliente' && (
          <div>
            <label className={label}>Importe a declarar</label>
            <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="$" className={input} />
            {importe && <p className="text-[11px] text-gray-400 mt-0.5">{formatoARS(Number(importe))}</p>}
          </div>
        )}
        <div>
          <label className={label}>Patente</label>
          <input value={patente} readOnly className={`${input} bg-gray-50 text-gray-600`} />
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-2">
        <div>
          <label className={label}>Recorrido</label>
          <select value={tipoRecorrido} onChange={(e) => setTipoRecorrido(e.target.value as CotTipoRecorrido)} className={input}>
            <option value="M">Mixto</option>
            <option value="U">Urbano</option>
            <option value="R">Rural</option>
          </select>
        </div>
        <div>
          <label className={label}>Localidad (urbano)</label>
          <input value={localidad} onChange={(e) => setLocalidad(e.target.value.toUpperCase())} className={input} />
        </div>
        <div>
          <label className={label}>Ruta (rural)</label>
          <input value={ruta} onChange={(e) => setRuta(e.target.value.toUpperCase())} className={input} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Sale</label>
            <input type="date" value={salida.fechaSalida} onChange={(e) => setSalida({ ...salida, fechaSalida: e.target.value })} className={`${input} px-2`} />
          </div>
          <div>
            <label className={label}>Hora</label>
            <input type="time" value={salida.horaSalida} onChange={(e) => setSalida({ ...salida, horaSalida: e.target.value })} className={`${input} px-2`} />
          </div>
        </div>
      </div>
    </div>
  )
}
