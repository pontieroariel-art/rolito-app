import { useEffect, useMemo, useState, useCallback } from 'react'
import { FileCheck2 } from 'lucide-react'
import ClienteCombobox from '@/components/common/ClienteCombobox'
import type { ClienteIndex } from '@/types'
import { useClienteSeleccionado } from '@/hooks/useClienteSeleccionado'
import { sucursalesDe, etiquetaSucursal } from '@/utils/sucursalesTango'
import { cuitLimpio, domicilioDeCliente, otraPlanta, parsearCalleNumero } from '@/utils/cot'
import { formatoARS } from '@/utils/money'
import { PLANTAS, type CotConfig, type CotDestinoPlan, type CotDomicilio, type CotTipoRecorrido, type PlantaId } from '@/types'

// Destino del COT en el BORRADOR de carga (2026-09-18).
//
// Es el hermano de `CotCargaForm` (que sigue intacto para el remito que emite
// muelle) con dos diferencias que importan:
//
//  1. SIN fecha ni hora de salida, y sin número de remito R. Eso se sabe recién
//     cuando el camión se va, y lo completa muelle al aceptar el borrador. Antes
//     caja emitía a las 17 el remito del camión que salía a las 4 y el COT
//     viajaba con una hora de traslado que no era la real, que es justo lo que
//     ARBA mira en la ruta.
//  2. Se pide SIEMPRE, no solo cuando la carga planificada supera el umbral: si
//     muelle corrige la carga hacia arriba y la cruza, el COT tiene que poder
//     salir sin ir a buscar al destinatario a las 4 de la mañana. Si al final no
//     hace falta, el destino simplemente no se usa.

const input = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
const label = 'text-xs text-secundario mb-1 block'

/** Qué le falta al destino para que el COT pueda salir. Vacío = está completo. */
export function faltantesDestinoPlan(plan: CotDestinoPlan | null): string[] {
  if (!plan) return ['Elegí a dónde va la carga (cliente destinatario o la otra planta): el COT se declara siempre.']
  const faltan: string[] = []
  if (plan.destino.tipo === 'cliente') {
    if (!plan.destino.razonSocial) faltan.push('Falta el cliente destinatario del COT.')
    if (!plan.destino.domicilio.localidad || !plan.destino.domicilio.calle) faltan.push('Falta el domicilio de destino del COT.')
    if (!plan.respaldo.importe) faltan.push('Falta el importe a declarar en el COT.')
  }
  return faltan
}

export default function CotDestinoForm({ plantaId, cfg, kg, patente, valor, onChange }: {
  plantaId: PlantaId
  cfg:      CotConfig
  /** Kilos de la carga planificada: solo para sugerir el importe y avisar si ya cruza el umbral. */
  kg:       number
  patente:  string
  /** Para reabrir un borrador y corregirlo. */
  valor?:   CotDestinoPlan | null
  onChange: (plan: CotDestinoPlan | null) => void
}) {
  const plantaCfg = cfg.plantas[plantaId]
  const inicial = valor?.destino
  const uidInicial = inicial?.tipo === 'cliente' ? inicial.clienteUid : ''
  const [tipo, setTipo] = useState<'cliente' | 'planta'>(inicial?.tipo === 'planta' ? 'planta' : 'cliente')
  const [clienteUid, setClienteUid] = useState(inicial?.tipo === 'cliente' ? inicial.clienteUid : '')
  const [codigoSucursal, setCodigoSucursal] = useState(inicial?.tipo === 'cliente' ? (inicial.codigoTango ?? '') : '')
  const [consumidorFinal, setConsumidorFinal] = useState(inicial?.tipo === 'cliente' ? inicial.consumidorFinal : false)
  const [importe, setImporte] = useState(valor?.respaldo.importe ? String(valor.respaldo.importe) : '')
  const [tipoRecorrido, setTipoRecorrido] = useState<CotTipoRecorrido>(valor?.recorrido.tipo ?? plantaCfg.recorrido.tipo)
  const [localidad, setLocalidad] = useState(valor?.recorrido.localidad ?? plantaCfg.recorrido.localidad)
  const [ruta, setRuta] = useState(valor?.recorrido.ruta ?? plantaCfg.recorrido.ruta)
  const [domicilioEditado, setDomicilioEditado] = useState<CotDomicilio | null>(inicial?.tipo === 'cliente' ? inicial.domicilio : null)

  // Solo clientes que Tango conoce: el COT necesita el código de la cuenta.
  const soloVinculados = useCallback((c: ClienteIndex) => c.vinculadoTango, [])
  const { cliente } = useClienteSeleccionado(clienteUid || null)
  const sucursales = useMemo(() => (cliente ? sucursalesDe(cliente, 'redonhielo') : []), [cliente])

  // Al cambiar de cliente: sucursal principal, consumidor final si no tiene CUIT válido, domicilio de la ficha.
  const uidCliente = cliente?.uid
  useEffect(() => {
    if (!uidCliente || uidCliente === uidInicial) return
    setCodigoSucursal('')
    setDomicilioEditado(null)
    if (cliente) setConsumidorFinal(!/^\d{11}$/.test(cuitLimpio(cliente.cuit)))
    // el domicilio se recalcula desde la ficha; `inicial` solo marca el borrador que se está editando
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidCliente])

  // Importe sugerido por los kilos (config/cot.importePorKg) mientras caja no lo toque.
  useEffect(() => {
    if (cfg.importePorKg > 0 && importe === '') setImporte(String(Math.round(kg * cfg.importePorKg)))
    // solo al cambiar los kilos o la config
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, cfg.importePorKg])

  const domicilioFicha = useMemo<CotDomicilio | null>(() => (cliente ? domicilioDeCliente(cliente, codigoSucursal || null) : null), [cliente, codigoSucursal])
  const domicilio = domicilioEditado ?? domicilioFicha

  useEffect(() => {
    const respaldo = { codigoComprobante: cfg.respaldo.codigoComprobante, prefijo: cfg.respaldo.prefijo, importe: Number(importe.replace(/[^\d.]/g, '')) || 0 }
    const recorrido = { tipo: tipoRecorrido, localidad, ruta }
    if (tipo === 'planta') {
      onChange({ destino: { tipo: 'planta', plantaId: otraPlanta(plantaId) }, respaldo: { ...respaldo, importe: 0 }, patente, recorrido })
      return
    }
    if (!cliente || !domicilio) { onChange(null); return }
    onChange({
      destino: {
        tipo: 'cliente', clienteUid: cliente.uid, ...(codigoSucursal ? { codigoTango: codigoSucursal } : {}),
        razonSocial: cliente.razonSocial, cuit: cuitLimpio(cliente.cuit), consumidorFinal, domicilio,
      },
      respaldo, patente, recorrido,
    })
  }, [tipo, cliente, codigoSucursal, consumidorFinal, domicilio, importe, tipoRecorrido, localidad, ruta, patente, plantaId, cfg.respaldo, onChange])

  const editarDomicilio = (parte: Partial<CotDomicilio> & { calleNumero?: string }) => {
    const base = domicilio ?? { calle: '', numero: 0, cp: '', localidad: '', provincia: 'B' }
    const { calleNumero, ...resto } = parte
    const cn = calleNumero !== undefined ? parsearCalleNumero(calleNumero) : {}
    setDomicilioEditado({ ...base, ...cn, ...resto })
  }
  const calleNumeroTexto = domicilio ? `${domicilio.calle}${domicilio.numero > 0 ? ` ${domicilio.numero}` : ''}` : ''
  const cruzaUmbral = kg >= cfg.umbralKg

  return (
    <div className="bg-blue-50/60 border border-blue-200 rounded-lg px-3 py-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5"><FileCheck2 size={16} className="text-blue-600" /> Destino para el COT de ARBA</p>
        <p className="text-xs text-secundario">
          Se declara siempre, pese o no {cfg.umbralKg.toLocaleString('es-AR')} kg: si muelle corrige la carga hacia arriba, el COT sale sin llamar a nadie a las 4 de la mañana.
          {kg > 0 && <> La carga planificada pesa <b>{kg.toLocaleString('es-AR')} kg</b>{cruzaUmbral ? ' y ya supera el umbral.' : '.'}</>}
        </p>
        <p className="text-xs text-secundario mt-0.5">El número del remito R, la fecha y la hora de salida los pone muelle cuando el camión efectivamente se va.</p>
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

      <div className="grid sm:grid-cols-4 gap-2">
        {tipo === 'cliente' && (
          <div>
            <label className={label}>Importe a declarar</label>
            <input value={importe} onChange={(e) => setImporte(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="$" className={input} />
            {importe && <p className="text-[11px] text-secundario mt-0.5">{formatoARS(Number(importe))}</p>}
          </div>
        )}
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
      </div>
    </div>
  )
}
