import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, HandCoins, RefreshCw, Truck } from 'lucide-react'
import { entregarFacturaAdeudada, entregarRemito } from '@/services/facturaAdeudadaService'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { CLASE_MORA } from '@/components/supervisor/ChipMora'
import { ETIQUETA_MORA, nivelMora } from '@/utils/mora'
import { nombreSucursal } from '@/utils/sucursalesTango'
import { Plegable } from '@/components/ui/Plegable'
import BotonesVerEnviar from '@/components/ui/BotonesVerEnviar'
import { useAuth } from '@/context/AuthContext'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { useTangoComprobantes } from '@/hooks/useTangoComprobantes'
import { haceCuanto } from '@/pages/supervisor/SupervisorClientesPage'
import { codigosTangoResumen } from '@/pages/admin/user-management/listaTango'
import { atrasoMaximo, type GrupoRecibo } from '@/utils/composicionSaldos'
import {
  armarComposicion, filtrarPorSucursal, formatoRemito, opcionesSucursal, totalPendiente, type FilaComposicion,
} from '@/utils/comprobantesTango'
import { generateComposicionSaldosPdf, nombreArchivoComposicionSaldos, type DatosComposicionSaldos } from '@/utils/composicionSaldosPdf'
import { formatoARS } from '@/utils/money'
import { NOMBRE_EMPRESA, estaVinculadoATango } from '@/utils/tangoEmpresas'
import type { EmpresaTango, UserProfile } from '@/types'

// PDF de la factura (venta de la app, detalle leído de Tango o archivada por
// administración): en el celular la comparte, en una compu la descarga. Si no
// está, lo dice.
function BotonFactura({ fila, clienteNombre }: { fila: FilaComposicion; clienteNombre: string }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const correr = async () => {
    setOcupado(true)
    setAviso('')
    try {
      const modo = puedeCompartirArchivos() ? 'enviar' : 'ver'
      setAviso(await entregarFacturaAdeudada({ tipo: fila.tipo, numero: fila.numero }, fila.empresa, modo, clienteNombre))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <div className="shrink-0 flex flex-col items-end gap-0.5 max-w-[140px]">
      <button type="button" onClick={correr} disabled={ocupado} aria-label="Enviar factura"
        className="w-9 h-9 rounded-lg border border-[#D3D1C7] flex items-center justify-center text-accent active:scale-95 disabled:opacity-50">
        {ocupado ? <RefreshCw size={15} className="animate-spin" /> : <FileText size={15} />}
      </button>
      {aviso && <p className="text-[10px] text-amber-700 text-right leading-tight">{aviso}</p>}
    </div>
  )
}

// Chip de un remito: toca y sale el PDF (el de la app si lo hizo la app, con
// la firma; si no, una copia desde Tango).
function ChipRemito({ numero, empresa, clienteNombre, fecha }: { numero: string; empresa: EmpresaTango; clienteNombre: string; fecha?: string }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const correr = async () => {
    setOcupado(true)
    setAviso('')
    try {
      setAviso(await entregarRemito(numero, empresa, puedeCompartirArchivos() ? 'enviar' : 'ver', clienteNombre))
    } finally {
      setOcupado(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={correr} disabled={ocupado}
        className="inline-flex items-center gap-1 rounded-full border border-[#D3D1C7] bg-white px-2 py-0.5 text-[11px] text-gray-700 active:scale-95 disabled:opacity-50">
        {ocupado ? <RefreshCw size={11} className="animate-spin" /> : <Truck size={11} className="text-gray-400" />}
        {formatoRemito(numero)}{fecha ? <span className="text-gray-400"> · {fechaCorta(fecha)}</span> : null}
      </button>
      {aviso && <span className="text-[10px] text-amber-700 leading-tight">{aviso}</span>}
    </span>
  )
}

const fechaCorta = (iso: string | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso
}

const ESTADO_FILA = { pendiente: '', pagada: 'Pagada', anulada: 'Anulada' } as const
const claveGrupo = (g: GrupoRecibo) => `${g.empresa}|${g.codigo}`

// Saldo de cuenta corriente del cliente por empresa y código de Tango (mismo
// dato híbrido cache + consulta en vivo que usa la pantalla de cobro), con el
// remito de cada factura, el historial de 12 meses ("Todas"), selector de
// sucursal, Cobrar y Composición de saldos para compartir.
export default function SeccionSaldo({ c }: { c: UserProfile }) {
  const { user } = useAuth()
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const { saldo, cargando, refrescando, esCache } = useSaldoClienteEnVivo(c, actor)
  const { indices } = useTangoComprobantes(c)
  const alertas = useAlertasMora()
  const [modo, setModo] = useState<'pendientes' | 'todas'>('pendientes')
  const [sucursal, setSucursal] = useState<GrupoRecibo | null>(null)

  const comprobantes = useMemo(() => saldo?.comprobantes ?? [], [saldo])
  const bloquesTodos = useMemo(() => armarComposicion(comprobantes, indices, modo), [comprobantes, indices, modo])
  const opciones = useMemo(() => opcionesSucursal(c, armarComposicion(comprobantes, indices, 'todas')), [c, comprobantes, indices])
  const bloques = useMemo(() => filtrarPorSucursal(bloquesTodos, sucursal), [bloquesTodos, sucursal])
  const total = totalPendiente(bloques)
  const totalCliente = saldo?.saldoTotal ?? 0
  const atraso = atrasoMaximo(comprobantes)
  const vinculado = estaVinculadoATango(c)
  const etiquetaSucursal = sucursal ? (opciones.find((o) => claveGrupo(o.grupo) === claveGrupo(sucursal))?.etiqueta ?? '') : ''

  const datosPdf = (): DatosComposicionSaldos => ({
    cliente: { razonSocial: c.razonSocial, cuit: c.cuit || undefined, codigos: codigosTangoResumen(c) || undefined },
    bloques,
    modo,
    sucursal: etiquetaSucursal,
    datosAl: saldo?.actualizadoEn?.toDate() ?? null,
    esCache,
    generadoPor: user?.nombre ?? 'supervisor',
    fecha: new Date(),
  })

  const nivel = nivelMora(totalCliente, atraso, alertas)
  const chip = cargando ? null : totalCliente > 0
    ? <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${CLASE_MORA[nivel]}`}>{formatoARS(totalCliente)}{nivel !== 'ok' ? ` · ${ETIQUETA_MORA[nivel]}` : ''}</span>
    : <span className="text-xs font-semibold rounded-full px-2 py-0.5 border text-accent bg-accent/10 border-accent/30">Sin deuda</span>

  return (
    <Plegable titulo="Saldo" abiertoInicial extra={chip}>
      {!vinculado ? (
        <p className="text-sm text-gray-500">Este cliente no está vinculado a Tango: no tiene cuenta corriente.</p>
      ) : cargando ? (
        <p className="text-sm text-gray-500">Cargando saldo…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500 flex items-center gap-1.5">
            {refrescando && <RefreshCw size={12} className="animate-spin" />}
            {refrescando ? 'Consultando a Tango…' : esCache ? `Datos de Tango ${haceCuanto(saldo?.actualizadoEn) || 'en caché'}` : 'Datos de Tango en vivo'}
            {atraso > 0 && <span className="text-red-500">· {atraso} {atraso === 1 ? 'día' : 'días'} de atraso</span>}
          </p>

          {opciones.length > 0 && (
            <select value={sucursal ? claveGrupo(sucursal) : ''} onChange={(e) => setSucursal(opciones.find((o) => claveGrupo(o.grupo) === e.target.value)?.grupo ?? null)}
              aria-label="Sucursal"
              className="w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent">
              <option value="">Todas las sucursales</option>
              {opciones.map((o) => <option key={claveGrupo(o.grupo)} value={claveGrupo(o.grupo)}>{o.etiqueta}</option>)}
            </select>
          )}

          <div className="flex gap-1.5">
            {(['pendientes', 'todas'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setModo(m)}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${modo === m ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
                {m === 'pendientes' ? 'Pendientes' : 'Todas (12 meses)'}
              </button>
            ))}
          </div>

          {bloques.length === 0 && (
            <p className="text-sm text-gray-600">{modo === 'todas' ? 'No hay comprobantes en los últimos 12 meses.' : 'No tiene comprobantes pendientes.'}</p>
          )}

          {bloques.map((b) => (
            <div key={claveGrupo(b.grupo)} className="rounded-xl border border-[#D3D1C7] overflow-hidden">
              <div className="flex justify-between items-center px-3 py-2 bg-[#F8F7F2]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-700">{NOMBRE_EMPRESA[b.grupo.empresa]}{b.grupo.codigo ? ` · ${b.grupo.codigo}` : ''}</p>
                  {nombreSucursal(c, b.grupo.empresa, b.grupo.codigo) && <p className="text-[11px] text-gray-500 truncate">{nombreSucursal(c, b.grupo.empresa, b.grupo.codigo)}</p>}
                </div>
                <p className="text-xs font-semibold text-gray-900">{formatoARS(b.subtotalPendiente)}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {b.filas.map((f) => (
                  <div key={f.clave} className={`px-3 py-1.5 ${f.estado !== 'pendiente' ? 'bg-white' : ''}`}>
                    <div className="flex justify-between items-center gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${f.estado === 'anulada' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{f.tipo} {f.numero}</p>
                        <p className="text-[11px] text-gray-500">
                          {[fechaCorta(f.fecha) ? `Emitida ${fechaCorta(f.fecha)}` : '', fechaCorta(f.fechaVencimiento) ? `Vto. ${fechaCorta(f.fechaVencimiento)}` : ''].filter(Boolean).join(' · ')}
                          {f.diasAtraso && f.diasAtraso > 0 ? <span className="text-red-500"> · {f.diasAtraso} d de atraso</span> : null}
                          {f.estado !== 'pendiente' && <span className={f.estado === 'pagada' ? 'text-accent' : 'text-gray-400'}> · {ESTADO_FILA[f.estado]}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-medium tabular-nums ${f.estado === 'pendiente' ? 'text-gray-900' : 'text-gray-500'}`}>{formatoARS(f.pendiente ?? f.importe)}</p>
                        {f.pendiente !== null && f.pendiente !== f.importe && <p className="text-[11px] text-gray-400 tabular-nums">de {formatoARS(f.importe)}</p>}
                      </div>
                      <BotonFactura fila={f} clienteNombre={c.razonSocial} />
                    </div>
                    {f.remitos.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {f.remitos.map((r) => <ChipRemito key={r} numero={r} empresa={f.empresa} clienteNombre={c.razonSocial} />)}
                      </div>
                    )}
                  </div>
                ))}
                {b.remitosSinFacturar.length > 0 && (
                  <div className="px-3 py-2">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Remitos sin facturar</p>
                    <div className="flex flex-wrap gap-1">
                      {b.remitosSinFacturar.map((r) => <ChipRemito key={r.numero} numero={r.numero} empresa={r.empresa} clienteNombre={c.razonSocial} fecha={r.fecha} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {totalCliente > 0 && (
            <Link to={`/supervisor/cobrar?cliente=${c.uid}`}
              className="flex items-center justify-center gap-2 w-full rounded-lg bg-accent text-white px-3 py-2.5 text-sm font-semibold active:scale-[0.99] transition-transform">
              <HandCoins size={16} /> Cobrar {formatoARS(totalCliente)}
            </Link>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              {modo === 'todas' ? 'Estado de cuenta (12 meses)' : 'Composición de saldos'}{etiquetaSucursal ? ` · ${etiquetaSucursal}` : ''}
            </p>
            <BotonesVerEnviar
              generar={() => generateComposicionSaldosPdf(datosPdf(), { descargar: false }) as Promise<Blob>}
              nombreArchivo={nombreArchivoComposicionSaldos({ cliente: { razonSocial: c.razonSocial }, fecha: new Date(), modo })}
              titulo={`${modo === 'todas' ? 'Estado de cuenta' : 'Composición de saldos'} — ${c.razonSocial}`}
              texto={`${modo === 'todas' ? 'Estado de cuenta' : 'Composición de saldos'} de ${c.razonSocial}${etiquetaSucursal ? ` (${etiquetaSucursal})` : ''} al ${new Date().toLocaleDateString('es-AR')}: ${formatoARS(total)} pendientes.`}
            />
          </div>
        </div>
      )}
    </Plegable>
  )
}
