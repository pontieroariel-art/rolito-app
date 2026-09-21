import { useMemo, useState } from 'react'
import { CalendarRange, FileText } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useVisorComprobante } from '@/components/ui/VisorComprobante'
import { useAuth } from '@/context/AuthContext'
import { armarResumen, movimientosDe, sucursalesDe, type ComprobanteIndice } from '@/utils/resumenCuenta'
import { generateResumenCuentaPdf, nombreArchivoResumenCuenta } from '@/utils/resumenCuentaPdf'
import { envioDeCliente } from '@/utils/envioComprobante'
import { formatoARS } from '@/utils/money'
import { NOMBRE_EMPRESA_CORTO } from '@/utils/tangoEmpresas'
import { nombreSucursal } from '@/utils/sucursalesTango'
import { TD, TH } from '@/components/common/tabla'
import type { EmpresaTango, SaldoTango, TangoComprobantesDoc, UserProfile } from '@/types'

/**
 * RESUMEN DE CUENTA del cliente (2026-09-20, pedido de Ariel para comercial y
 * los supervisores: "es resumen de cuentas y la composición de saldos, se la
 * comparten al cliente y además les sirve verlos a ellos").
 *
 * La composición contesta "¿cuánto me debe hoy?" y sirve para cobrar. Esto
 * contesta "¿qué pasó en la cuenta?" y sirve para discutir con el cliente
 * cuando dice que algo ya lo pagó.
 *
 * El detalle es SIEMPRE de una empresa. Redonhielo y Rolito son dos cuentas
 * distintas, y un saldo corrido que las mezcle no coincide con ningún papel de
 * Tango. Los totales de las dos van juntos arriba, que es lo único que hacía
 * falta ver de a dos. (Ariel sobre la vista mezclada: "es mucha mezcla".)
 *
 * No consulta nada nuevo: sale del índice de comprobantes que ya está en
 * pantalla y del saldo en caché.
 */

const INPUT = 'bg-white border border-[#D3D1C7] rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'

const hoyISO = () => new Date().toISOString().slice(0, 10)
const haceMeses = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10) }
const primerDiaDelMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10) }
const mesPasado = () => {
  const d = new Date()
  const desde = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  const hasta = new Date(d.getFullYear(), d.getMonth(), 0)
  const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  return { desde: iso(desde), hasta: iso(hasta) }
}
const fechaCorta = (iso: string) => { const [y, m, d] = iso.split('-'); return y ? `${d}/${m}/${y}` : iso }

export default function ResumenCuentaPanel({ cliente, indices, saldo, datosAl }: {
  cliente:  UserProfile
  /** Los índices de comprobantes de Tango del cliente (uno por empresa y código). */
  indices:  TangoComprobantesDoc[]
  saldo:    SaldoTango | null
  datosAl:  Date | null
}) {
  const { user } = useAuth()
  const { abrir } = useVisorComprobante()
  const [desde, setDesde]       = useState(haceMeses(3))
  const [hasta, setHasta]       = useState(hoyISO())
  const [sucursal, setSucursal] = useState('')          // '' = todas
  const [generando, setGenerando] = useState(false)
  const [error, setError]       = useState('')

  // Las sucursales son la UNIÓN de las dos empresas: no siempre coinciden
  // (verificado el 20/09: 40 clientes tienen alguna sucursal en una sola, y
  // uno las tiene todas distintas).
  const sucursales = useMemo(() => sucursalesDe({
    redonhielo: indices.filter((i) => i.empresa === 'redonhielo').map((i) => i.codigo),
    rolito:     indices.filter((i) => i.empresa === 'rolito').map((i) => i.codigo),
  }), [indices])

  // Empresas en las que este cliente tiene cuenta, respetando la sucursal elegida.
  const empresas = useMemo(() => {
    const conDatos = indices.filter((i) => !sucursal || i.codigo === sucursal)
    return (['redonhielo', 'rolito'] as EmpresaTango[]).filter((e) => conDatos.some((i) => i.empresa === e))
  }, [indices, sucursal])

  const [empresa, setEmpresa] = useState<EmpresaTango | null>(null)
  const empresaActiva = (empresa && empresas.includes(empresa) ? empresa : empresas[0]) ?? null

  /** Saldo de HOY de esa empresa (y sucursal), desde el caché de saldos. */
  const saldoDe = (emp: EmpresaTango): number =>
    (saldo?.comprobantes ?? [])
      .filter((c) => (c.empresa ?? 'redonhielo') === emp && (!sucursal || (c.codigoTango ?? '') === sucursal))
      .reduce((s, c) => s + (c.saldoPendiente ?? 0), 0)

  /** Movimientos de una empresa en el período (y los posteriores, para cerrar el saldo). */
  const resumenDe = (emp: EmpresaTango) => {
    const comprobantes: Record<string, ComprobanteIndice> = {}
    for (const i of indices) {
      if (i.empresa !== emp) continue
      if (sucursal && i.codigo !== sucursal) continue
      // Un cliente con varias sucursales suma los comprobantes de todas.
      for (const [k, v] of Object.entries(i.facturas ?? {})) comprobantes[`${i.codigo}|${k}`] = v as ComprobanteIndice
    }
    const dentro    = movimientosDe(comprobantes, desde, hasta)
    const despues   = movimientosDe(comprobantes, siguienteDia(hasta), '9999-12-31')
    return armarResumen(dentro, saldoDe(emp), despues)
  }

  const resumen = empresaActiva ? resumenDe(empresaActiva) : null

  const verPdf = async () => {
    setError('')
    setGenerando(true)
    try {
      const secciones = empresas.map((emp) => ({ emp, r: resumenDe(emp) }))
        // Solo la que se está mirando, salvo que el cliente tenga una sola.
        .filter(({ emp }) => empresas.length === 1 || emp === empresaActiva)
        .map(({ emp, r }) => ({ empresa: emp, codigo: sucursal, resumen: r }))
      const datos = {
        cliente: { razonSocial: cliente.razonSocial || cliente.nombre || '', cuit: cliente.cuit },
        secciones, desde, hasta,
        sucursal: sucursal ? [sucursal, nombreSucursal(cliente, empresaActiva, sucursal)].filter(Boolean).join(' · ') : '',
        datosAl,
        generadoPor: user?.nombre ?? '',
        fecha: new Date(),
      }
      const blob = await generateResumenCuentaPdf(datos)
      abrir({
        blob,
        nombre: nombreArchivoResumenCuenta(datos),
        titulo: 'Resumen de cuenta',
        subtitulo: `${fechaCorta(desde)} al ${fechaCorta(hasta)}`,
        envio: envioDeCliente(cliente, {
          tipo: 'Resumen de cuenta', numero: '',
          titulo: 'Resumen de cuenta',
          mensaje: `Hola, te mando el resumen de cuenta del ${fechaCorta(desde)} al ${fechaCorta(hasta)}.`,
        }),
      })
    } catch {
      setError('No se pudo armar el PDF. Probá de nuevo.')
    } finally {
      setGenerando(false)
    }
  }

  if (!empresaActiva || !resumen) {
    return <p className="text-sm text-secundario">Este cliente no tiene cuenta corriente en Tango.</p>
  }

  return (
    <section className="space-y-3">
      {/* Los saldos de las dos, que es lo único que hace falta ver junto. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        {(['redonhielo', 'rolito'] as EmpresaTango[]).filter((e) => empresas.includes(e)).map((e) => (
          <span key={e} className="text-secundario">
            {NOMBRE_EMPRESA_CORTO[e]} <strong className="text-gray-900 tabular-nums">{formatoARS(saldoDe(e))}</strong>
          </span>
        ))}
        {empresas.length > 1 && (
          <span className="text-gray-900">
            Total <strong className="tabular-nums">{formatoARS(empresas.reduce((s, e) => s + saldoDe(e), 0))}</strong>
          </span>
        )}
      </div>

      {/* Filtros, pegados a la tabla. */}
      <div className="flex flex-wrap items-center gap-2">
        {empresas.length > 1 && (
          <div className="flex rounded-lg border border-[#D3D1C7] overflow-hidden">
            {empresas.map((e) => (
              <button key={e} type="button" onClick={() => setEmpresa(e)}
                className={`px-3 min-h-9 text-sm ${e === empresaActiva ? 'bg-accent text-white' : 'bg-white text-gray-700 hover:bg-accent/10'}`}>
                {NOMBRE_EMPRESA_CORTO[e]}
              </button>
            ))}
          </div>
        )}

        {sucursales.length > 1 && (
          <select className={INPUT} value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {[s.codigo, nombreSucursal(cliente, s.empresas[0], s.codigo)].filter(Boolean).join(' · ')}
                {s.empresas.length === 1 ? ` (solo ${NOMBRE_EMPRESA_CORTO[s.empresas[0]]})` : ''}
              </option>
            ))}
          </select>
        )}

        <span className="text-secundario text-sm flex items-center gap-1"><CalendarRange size={14} /> Desde</span>
        <input type="date" className={INPUT} value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        <span className="text-secundario text-sm">Hasta</span>
        <input type="date" className={INPUT} value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />

        <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setDesde(primerDiaDelMes()); setHasta(hoyISO()) }}>Este mes</button>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => { const m = mesPasado(); setDesde(m.desde); setHasta(m.hasta) }}>Mes pasado</button>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setDesde(haceMeses(12)); setHasta(hoyISO()) }}>12 meses</button>

        <Button onClick={verPdf} disabled={generando} className="ml-auto text-xs py-1.5 px-3 flex items-center gap-1.5">
          <FileText size={14} /> {generando ? 'Armando…' : 'Ver PDF'}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Sin sucursal elegida, el saldo corrido es la suma de varias cuentas de
          Tango (allá la cuenta corriente es por código). Se dice, para que nadie
          lo confunda con el saldo de una cuenta. */}
      {!sucursal && sucursales.length > 1 && (
        <p className="text-xs text-secundario">
          Consolidado de las {sucursales.length} sucursales en {NOMBRE_EMPRESA_CORTO[empresaActiva]}. En Tango cada sucursal es una cuenta aparte.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Fecha</th>
              <th className={TH}>Comprobante</th>
              <th className={`${TH} text-right`}>Debe</th>
              <th className={`${TH} text-right`}>Haber</th>
              <th className={`${TH} text-right`}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#F8F7F2]">
              <td className={TD}>{fechaCorta(desde)}</td>
              <td className={`${TD} text-secundario`}>Saldo anterior</td>
              <td className={TD} /><td className={TD} />
              <td className={`${TD} text-right tabular-nums`}>{formatoARS(resumen.saldoInicial)}</td>
            </tr>
            {resumen.movimientos.map((m) => (
              <tr key={`${m.tipo}-${m.numero}-${m.fecha}`} className="border-t border-[#E7E5DC]">
                <td className={`${TD} tabular-nums`}>{fechaCorta(m.fecha)}</td>
                <td className={TD}>{m.tipo} {m.numero}</td>
                <td className={`${TD} text-right tabular-nums`}>{m.debe ? formatoARS(m.debe) : ''}</td>
                <td className={`${TD} text-right tabular-nums text-accent`}>{m.haber ? formatoARS(m.haber) : ''}</td>
                <td className={`${TD} text-right tabular-nums`}>{formatoARS(m.saldo)}</td>
              </tr>
            ))}
            {resumen.movimientos.length === 0 && (
              <tr><td className={`${TD} text-secundario`} colSpan={5}>Sin movimientos en el período.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#D3D1C7] font-semibold">
              <td className={TD} />
              <td className={TD}>Saldo al {fechaCorta(hasta)}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatoARS(resumen.totalDebe)}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatoARS(resumen.totalHaber)}</td>
              <td className={`${TD} text-right tabular-nums`}>{formatoARS(resumen.saldoFinal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

/** El día siguiente a `iso`, para separar el período de lo que vino después. */
function siguienteDia(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
