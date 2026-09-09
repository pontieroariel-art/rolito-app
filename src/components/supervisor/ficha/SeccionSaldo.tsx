import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, HandCoins, RefreshCw } from 'lucide-react'
import { entregarFacturaAdeudada } from '@/services/facturaAdeudadaService'
import { puedeCompartirArchivos } from '@/utils/compartir'
import { useAlertasMora } from '@/hooks/useAlertasMora'
import { CLASE_MORA } from '@/components/supervisor/ChipMora'
import { ETIQUETA_MORA, nivelMora } from '@/utils/mora'
import { nombreSucursal } from '@/utils/sucursalesTango'
import { Plegable } from '@/components/ui/Plegable'
import BotonesVerEnviar from '@/components/ui/BotonesVerEnviar'
import { useAuth } from '@/context/AuthContext'
import { useSaldoClienteEnVivo } from '@/hooks/useSaldoClienteEnVivo'
import { haceCuanto } from '@/pages/supervisor/SupervisorClientesPage'
import { codigosTangoResumen } from '@/pages/admin/user-management/listaTango'
import { agruparPorEmpresaYCodigo, atrasoMaximo, claveComp } from '@/utils/composicionSaldos'
import { generateComposicionSaldosPdf, nombreArchivoComposicionSaldos, type DatosComposicionSaldos } from '@/utils/composicionSaldosPdf'
import { formatoARS } from '@/utils/money'
import { NOMBRE_EMPRESA, estaVinculadoATango } from '@/utils/tangoEmpresas'
import type { ComprobanteSaldoTango, EmpresaTango, UserProfile } from '@/types'

// PDF de la factura adeudada (venta de la app o archivada por administración):
// en el celular la comparte, en una compu la descarga. Si no está, lo dice.
function BotonFactura({ comp, empresa, clienteNombre }: { comp: ComprobanteSaldoTango; empresa: EmpresaTango; clienteNombre: string }) {
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const correr = async () => {
    setOcupado(true)
    setAviso('')
    try {
      const modo = puedeCompartirArchivos() ? 'enviar' : 'ver'
      setAviso(await entregarFacturaAdeudada(comp, empresa, modo, clienteNombre))
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

const fechaCorta = (iso: string | undefined) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y.slice(2)}` : iso
}

// Saldo de cuenta corriente del cliente por empresa y código de Tango (mismo
// dato híbrido cache + consulta en vivo que usa la pantalla de cobro), con
// Cobrar y Composición de saldos para compartir.
export default function SeccionSaldo({ c }: { c: UserProfile }) {
  const { user } = useAuth()
  const actor = useMemo(() => (user ? { uid: user.uid, nombre: user.nombre } : null), [user])
  const { saldo, cargando, refrescando, esCache } = useSaldoClienteEnVivo(c, actor)
  const alertas = useAlertasMora()
  const comprobantes = useMemo(() => saldo?.comprobantes ?? [], [saldo])
  const bloques = useMemo(() => agruparPorEmpresaYCodigo(comprobantes), [comprobantes])
  const total = saldo?.saldoTotal ?? 0
  const atraso = atrasoMaximo(comprobantes)
  const vinculado = estaVinculadoATango(c)

  const datosPdf = (): DatosComposicionSaldos => ({
    cliente: { razonSocial: c.razonSocial, cuit: c.cuit || undefined, codigos: codigosTangoResumen(c) || undefined },
    comprobantes,
    datosAl: saldo?.actualizadoEn?.toDate() ?? null,
    esCache,
    generadoPor: user?.nombre ?? 'supervisor',
    fecha: new Date(),
  })

  const nivel = nivelMora(total, atraso, alertas)
  const chip = cargando ? null : total > 0
    ? <span className={`text-xs font-semibold rounded-full px-2 py-0.5 border ${CLASE_MORA[nivel]}`}>{formatoARS(total)}{nivel !== 'ok' ? ` · ${ETIQUETA_MORA[nivel]}` : ''}</span>
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

          {bloques.length === 0 && <p className="text-sm text-gray-600">No tiene comprobantes pendientes.</p>}

          {bloques.map((b) => (
            <div key={`${b.grupo.empresa}|${b.grupo.codigo}`} className="rounded-xl border border-[#D3D1C7] overflow-hidden">
              <div className="flex justify-between items-center px-3 py-2 bg-[#F8F7F2]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-700">{NOMBRE_EMPRESA[b.grupo.empresa]}{b.grupo.codigo ? ` · ${b.grupo.codigo}` : ''}</p>
                  {nombreSucursal(c, b.grupo.empresa, b.grupo.codigo) && <p className="text-[11px] text-gray-500 truncate">{nombreSucursal(c, b.grupo.empresa, b.grupo.codigo)}</p>}
                </div>
                <p className="text-xs font-semibold text-gray-900">{formatoARS(b.subtotal)}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {b.comprobantes.map((comp) => (
                  <div key={claveComp(comp)} className="flex justify-between items-center gap-2 px-3 py-1.5">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 truncate">{comp.tipo} {comp.numero}</p>
                      <p className="text-[11px] text-gray-500">
                        {[fechaCorta(comp.fechaEmision) ? `Emitida ${fechaCorta(comp.fechaEmision)}` : '', fechaCorta(comp.fechaVencimiento) ? `Vto. ${fechaCorta(comp.fechaVencimiento)}` : ''].filter(Boolean).join(' · ')}
                        {comp.diasAtraso && comp.diasAtraso > 0 ? <span className="text-red-500"> · {comp.diasAtraso} d de atraso</span> : null}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-gray-900 tabular-nums">{formatoARS(comp.saldoPendiente)}</p>
                      {comp.saldoPendiente !== comp.importeOriginal && <p className="text-[11px] text-gray-400 tabular-nums">de {formatoARS(comp.importeOriginal)}</p>}
                    </div>
                    {comp.tipo === 'FAC' && <BotonFactura comp={comp} empresa={b.grupo.empresa} clienteNombre={c.razonSocial} />}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {total > 0 && (
            <Link to={`/supervisor/cobrar?cliente=${c.uid}`}
              className="flex items-center justify-center gap-2 w-full rounded-lg bg-accent text-white px-3 py-2.5 text-sm font-semibold active:scale-[0.99] transition-transform">
              <HandCoins size={16} /> Cobrar {formatoARS(total)}
            </Link>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Composición de saldos</p>
            <BotonesVerEnviar
              generar={() => generateComposicionSaldosPdf(datosPdf(), { descargar: false }) as Promise<Blob>}
              nombreArchivo={nombreArchivoComposicionSaldos({ cliente: { razonSocial: c.razonSocial }, fecha: new Date() })}
              titulo={`Composición de saldos — ${c.razonSocial}`}
              texto={`Composición de saldos de ${c.razonSocial} al ${new Date().toLocaleDateString('es-AR')}: ${formatoARS(total)} pendientes.`}
            />
          </div>
        </div>
      )}
    </Plegable>
  )
}
