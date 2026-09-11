import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, FileText, ShieldCheck, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { Plegable } from '@/components/ui/Plegable'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { resolverAnulacion, subscribeAnulacionesEnRango, subscribeAnulacionesPendientes } from '@/services/anulacionService'
import { getVentaVentanilla } from '@/services/ventaVentanillaService'
import { getVentaCamion } from '@/services/ventaCamionService'
import { getUserDocument } from '@/services/userService'
import { reportError } from '@/services/observability'
import { addDaysStr } from '@/utils/helpers'
import { formatoARS } from '@/utils/money'
import { armarNotaCreditoDeVenta } from '@/utils/facturaDeVenta'
import { generateFacturaArcaPdf } from '@/utils/facturaArcaPdf'
import { descargarArchivo } from '@/utils/compartir'
import { MOTIVOS_ANULACION, PLANTAS, type AnulacionVentanilla, type EstadoAnulacion } from '@/types'

const LETRA: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C', 3: 'A', 8: 'B', 13: 'C' }
const nro = (pv: number, n: number) => `${String(pv).padStart(5, '0')}-${String(n).padStart(8, '0')}`
const ESTADO: Record<EstadoAnulacion, { label: string; clase: string }> = {
  pendiente: { label: 'Por autorizar', clase: 'text-amber-700' },
  aprobada:  { label: 'Aprobada · emitiendo la nota de crédito', clase: 'text-amber-700' },
  emitida:   { label: 'Nota de crédito emitida', clase: 'text-[#0F6B4E]' },
  rechazada: { label: 'Rechazada', clase: 'text-gray-600' },
  error:     { label: 'Error al emitir la nota de crédito', clase: 'text-red-700' },
}

// Bandeja de anulaciones de facturas de ventanilla (2026-09-09): lo que los
// cajeros piden anular. Aprueba o rechaza quien tiene el permiso individual
// `autorizaAnulaciones` (o super_admin); el resto entra en modo lectura. Con la
// aprobación, el server emite la nota de crédito en ARCA (ver
// functions/triggers/anulacionesVentanilla) y acá se ve el resultado y su PDF.
export default function AnulacionesPage() {
  const { user } = useAuth()
  const hoy = useDiaActual()
  const [pendientes, setPendientes] = useState<AnulacionVentanilla[]>([])
  const [delMes, setDelMes] = useState<AnulacionVentanilla[]>([])
  const [resolviendo, setResolviendo] = useState<{ a: AnulacionVentanilla; estado: 'aprobada' | 'rechazada' } | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => subscribeAnulacionesPendientes(setPendientes), [])
  useEffect(() => subscribeAnulacionesEnRango(`${hoy.slice(0, 7)}-01`, addDaysStr(hoy, 1), setDelMes), [hoy])

  const puedeAutorizar = !!user && (user.autorizaAnulaciones === true || user.rol === 'super_admin')
  const ordenadas = useMemo(() => pendientes.slice().sort((a, b) => a.solicitadaEn.toMillis() - b.solicitadaEn.toMillis()), [pendientes])
  const resueltas = useMemo(() => delMes.filter((a) => a.estado !== 'pendiente').sort((a, b) => (b.resueltaEn?.toMillis() ?? 0) - (a.resueltaEn?.toMillis() ?? 0)), [delMes])

  const resolver = async () => {
    if (!user || !resolviendo) return
    if (resolviendo.estado === 'rechazada' && !nota.trim()) { setError('Para rechazar hay que explicar el motivo.'); return }
    setGuardando(true); setError('')
    try {
      await resolverAnulacion(resolviendo.a.id, resolviendo.estado, { uid: user.uid, nombre: user.nombre }, nota)
      setResolviendo(null); setNota('')
    } catch (err) {
      reportError(err, { origen: 'AnulacionesPage', accion: 'error al resolver' })
      setError('No se pudo guardar. ¿Ya la resolvió otro, o es tu propia solicitud?')
    } finally {
      setGuardando(false)
    }
  }

  const verNotaCredito = async (a: AnulacionVentanilla) => {
    setAviso('')
    try {
      // La venta anulada vive en ventanilla o en el camión (2026-09-11).
      const venta = a.coleccion === 'ventasCamion' ? await getVentaCamion(a.ventaId) : await getVentaVentanilla(a.ventaId)
      if (!venta) { setAviso('No se encontró la venta.'); return }
      // El perfil del cliente completa el papel (CUIT, condición de IVA, domicilio);
      // si este usuario no puede leerlo, el PDF sale con lo que trae la venta.
      const cliente = venta.clienteId ? await getUserDocument(venta.clienteId).catch(() => null) ?? undefined : undefined
      const armado = armarNotaCreditoDeVenta(venta, cliente)
      if (!armado.ok) { setAviso(armado.motivo); return }
      const blob = (await generateFacturaArcaPdf({ ...armado.datos, descargar: false })) as Blob
      descargarArchivo(blob, `nota-credito-${nro(armado.datos.puntoVenta, armado.datos.numero)}.pdf`)
    } catch (err) {
      reportError(err, { origen: 'AnulacionesPage', accion: 'error al generar la NC' })
      setAviso('No se pudo generar el PDF de la nota de crédito.')
    }
  }

  const inputClass = 'w-full bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-accent'
  const th = 'text-left text-[11px] uppercase tracking-wider text-gray-500 font-semibold px-2 py-1.5 border-b border-[#D3D1C7]'
  const td = 'px-2 py-1.5 border-b border-gray-100 text-sm'
  const btn = 'inline-flex items-center gap-1 rounded-lg border border-[#D3D1C7] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-accent hover:text-accent'

  return (
    <main className="max-w-5xl mx-auto p-4 space-y-4 pb-10">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Ban size={22} className="text-accent" /> Anulaciones de facturas</h1>
        <p className="text-gray-500 text-sm">Lo que los cajeros de ventanilla piden anular. Con la aprobación sale la nota de crédito en ARCA por el total y la venta deja de contar.</p>
      </div>
      {!puedeAutorizar && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">Estás en modo lectura: no tenés el permiso para autorizar anulaciones (lo asigna el administrador desde Usuarios).</p>}
      {aviso && <p className="text-xs text-amber-700">{aviso}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Por autorizar ({ordenadas.length})</h2>
        {ordenadas.length === 0 && <p className="text-sm text-gray-500 bg-white rounded-2xl border border-[#D3D1C7] shadow-sm px-4 py-3">No hay anulaciones esperando.</p>}
        {ordenadas.map((a) => {
          const propia = a.solicitadoPor.uid === user?.uid
          return (
            <div key={a.id} className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-gray-800">
                    Factura <b className="text-base">{LETRA[a.facturaOriginal.cbteTipo] ?? ''} {nro(a.facturaOriginal.puntoVenta, a.facturaOriginal.numero)}</b> · <b>{formatoARS(a.facturaOriginal.total)}</b> · {a.clienteNombre}
                  </p>
                  <p className="text-xs text-gray-500">{a.coleccion === 'ventasCamion' ? <span className="font-semibold text-gray-700">Camión · {a.choferNombre ?? 'chofer'} · </span> : 'Ventanilla · '}{PLANTAS[a.plantaId].label} · pidió <b>{a.solicitadoPor.nombre}</b> el {a.solicitadaEn.toDate().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · venta del {a.fechaVenta}</p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full border font-medium bg-amber-100 text-amber-700 border-amber-200">Por autorizar</span>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-sm">
                <p className="text-gray-900"><b>{MOTIVOS_ANULACION[a.motivo] ?? a.motivo}</b>{a.nota ? <span className="text-gray-700"> · {a.nota}</span> : null}</p>
                {a.items?.length ? <p className="text-xs text-gray-500 mt-1">{a.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(' · ')}</p> : null}
              </div>
              {puedeAutorizar && (
                <div className="flex flex-wrap justify-end gap-2">
                  {propia && <p className="w-full text-right text-xs text-amber-700">Es tu propia solicitud: la tiene que autorizar otra persona.</p>}
                  <Button variant="outline" onClick={() => { setError(''); setNota(''); setResolviendo({ a, estado: 'rechazada' }) }} disabled={propia}><X size={16} className="mr-1.5" /> Rechazar</Button>
                  <Button onClick={() => { setError(''); setNota(''); setResolviendo({ a, estado: 'aprobada' }) }} disabled={propia}><Check size={16} className="mr-1.5" /> Aprobar anulación</Button>
                </div>
              )}
            </div>
          )
        })}
      </section>

      <Plegable titulo={`Resueltas este mes (${resueltas.length})`} abiertoInicial={ordenadas.length === 0}>
        <table className="w-full min-w-[820px]">
          <thead><tr>{['Factura', 'Cliente', 'Total', 'Caja', 'Motivo', 'Estado', 'Nota de crédito', 'Resolvió', ''].map((h, i) => <th key={h || 'x'} className={`${th} ${i === 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
          <tbody>
            {resueltas.map((a) => (
              <tr key={a.id}>
                <td className={`${td} font-medium`}>{LETRA[a.facturaOriginal.cbteTipo] ?? ''} {nro(a.facturaOriginal.puntoVenta, a.facturaOriginal.numero)}</td>
                <td className={td}>{a.clienteNombre}</td>
                <td className={`${td} text-right tabular-nums`}>{formatoARS(a.facturaOriginal.total)}</td>
                <td className={td}>{a.cajaNombre} <span className="text-gray-400">· {PLANTAS[a.plantaId].label.replace('Planta ', '')}</span></td>
                <td className={`${td} text-gray-600`}>{MOTIVOS_ANULACION[a.motivo] ?? a.motivo}</td>
                <td className={`${td} text-xs ${ESTADO[a.estado].clase}`}>{ESTADO[a.estado].label}{a.estado === 'rechazada' && a.notaResolucion ? <span className="block text-gray-500">{a.notaResolucion}</span> : null}{a.estado === 'error' && a.ultimoError ? <span className="block text-gray-500">{a.ultimoError}</span> : null}</td>
                <td className={`${td} text-xs`}>{a.notaCredito?.estado === 'emitida' ? <span>NC {LETRA[a.notaCredito.cbteTipo] ?? ''} {nro(a.notaCredito.puntoVenta, a.notaCredito.numero)}<span className="block text-gray-500">CAE {a.notaCredito.cae}</span>{a.tango?.estado === 'confirmado' ? <span className="block text-[#0F6B4E]">Tango ✓ {a.tango.numero}</span> : a.tango?.estado === 'error' ? <span className="block text-red-600" title={a.tango.ultimoError}>Tango: {a.tango.ultimoError ?? 'error'}</span> : a.tango?.estado === 'pendiente' ? <span className="block text-amber-700">Pendiente en Tango</span> : <span className="block text-gray-400">Sin registrar en Tango</span>}</span> : a.notaCredito?.estado === 'incierta' ? <span className="text-amber-700">en revisión en ARCA</span> : '—'}</td>
                <td className={`${td} text-xs`}>{a.resueltaPor ? <span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-[#0F6B4E]" /> {a.resueltaPor.nombre}</span> : ''}</td>
                <td className={td}>{a.estado === 'emitida' && <button type="button" onClick={() => verNotaCredito(a)} className={btn} title="PDF de la nota de crédito"><FileText size={12} /> PDF</button>}</td>
              </tr>
            ))}
            {resueltas.length === 0 && <tr><td className={`${td} text-gray-500`} colSpan={9}>Sin anulaciones resueltas este mes.</td></tr>}
          </tbody>
        </table>
      </Plegable>

      {resolviendo && (
        <Modal open onClose={() => setResolviendo(null)} title={resolviendo.estado === 'aprobada' ? 'Aprobar anulación' : 'Rechazar anulación'}>
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Factura <b>{LETRA[resolviendo.a.facturaOriginal.cbteTipo] ?? ''} {nro(resolviendo.a.facturaOriginal.puntoVenta, resolviendo.a.facturaOriginal.numero)}</b> · {resolviendo.a.clienteNombre} · {formatoARS(resolviendo.a.facturaOriginal.total)}
            </p>
            <p className="text-sm text-gray-600">{MOTIVOS_ANULACION[resolviendo.a.motivo] ?? resolviendo.a.motivo}{resolviendo.a.nota ? ` · ${resolviendo.a.nota}` : ''} (pidió {resolviendo.a.solicitadoPor.nombre})</p>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder={resolviendo.estado === 'aprobada' ? 'Nota (opcional)' : 'Por qué se rechaza (obligatorio)'} className={inputClass} />
            <p className="text-xs text-gray-500">
              {resolviendo.estado === 'aprobada'
                ? 'Al aprobar, la app emite la nota de crédito en ARCA por el total de la factura. Queda registrado con tu nombre y hora y no se puede deshacer.'
                : 'La factura sigue vigente y el cajero recibe el aviso con tu motivo. Puede volver a pedir la anulación.'}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setResolviendo(null)} className="flex-1" disabled={guardando}>Cancelar</Button>
              <Button onClick={resolver} loading={guardando} className="flex-1">{resolviendo.estado === 'aprobada' ? <><Check size={16} className="mr-1.5" /> Aprobar</> : <><X size={16} className="mr-1.5" /> Rechazar</>}</Button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}
