import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Mail, MailX, Send } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import Badge from '@/components/common/Badge'
import StatusStrip from '@/components/common/StatusStrip'
import HistorialTable, { BarraHistorial, type ColumnaHistorial } from '@/components/common/HistorialTable'
import { useDiaActual } from '@/hooks/useDiaActual'
import { getMailsSalientes } from '@/services/mailsSalientesService'
import { reportError } from '@/services/observability'
import { coincideBusqueda } from '@/utils/busqueda'
import {
  ETIQUETA_ESTADO, EXPLICACION_ESTADO, OPCIONES_FILTRO_ESTADO, TONO_ESTADO, pasaFiltroEstado, resumenMails, type FiltroEstado,
} from '@/utils/mailsSalientes'
import type { MailSaliente } from '@/types'

// Mails enviados (2026-09-24, para facturación): qué mandó la app, a quién,
// por dónde y —lo que importa— qué pasó después: entregado, rebotado, marcado
// como spam. Hasta hoy "enviado" solo quería decir que el proveedor lo había
// aceptado, y con la casilla de Microsoft restringida los comprobantes se
// frenaban sin que nadie se enterara. El estado real lo cuenta Resend por
// webhook (functions/triggers/resendWebhook.ts). Un rebote se corrige en el
// mail del cliente en Tango y se reenvía desde Comprobantes de clientes.

const fmtFechaHora = (t: MailSaliente['fecha']) => {
  const d = t?.toDate?.()
  return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : ''
}
const fmtFechaCsv = (t: MailSaliente['fecha']) => t?.toDate?.()?.toISOString().slice(0, 16).replace('T', ' ') ?? ''
const PROVEEDOR: Record<MailSaliente['proveedor'], string> = { resend: 'Resend', smtp: 'Microsoft 365' }

export default function MailsEnviadosPage() {
  const hoy = useDiaActual()
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [mails, setMails] = useState<MailSaliente[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const cargar = useCallback(async () => {
    setCargando(true); setError(false)
    const [y, m] = mes.split('-').map(Number) as [number, number]
    try {
      setMails(await getMailsSalientes(new Date(y, m - 1, 1), new Date(y, m, 1)))
    } catch (err) {
      reportError(err, { origen: 'MailsEnviadosPage', accion: 'cargar mails del mes' })
      setError(true)
    } finally {
      setCargando(false)
    }
  }, [mes])
  useEffect(() => { void cargar() }, [cargar])

  const resumen = useMemo(() => resumenMails(mails), [mails])
  const filas = useMemo(
    () => mails
      .filter((m) => pasaFiltroEstado(m, filtroEstado))
      .filter((m) => !filtroTipo || m.tipo === filtroTipo)
      .filter((m) => !busqueda.trim() || coincideBusqueda(busqueda, m.para.join(' '), m.asunto, m.entrega?.detalle)),
    [mails, filtroEstado, filtroTipo, busqueda],
  )

  const columnas: ColumnaHistorial<MailSaliente>[] = [
    { titulo: 'Fecha', csv: (m) => fmtFechaCsv(m.fecha), celda: (m) => <span className="tabular-nums whitespace-nowrap">{fmtFechaHora(m.fecha)}</span> },
    { titulo: 'Para', truncar: true, anchoMax: 220, csv: (m) => m.para.join(', '), celda: (m) => m.para.join(', ') },
    { titulo: 'Asunto', truncar: true, anchoMax: 320, csv: (m) => m.asunto, celda: (m) => m.asunto },
    { titulo: 'Tipo', csv: (m) => (m.tipo === 'comprobante' ? 'Comprobante' : 'Aviso interno'), celda: (m) => (
      <span className="text-secundario">{m.tipo === 'comprobante' ? 'Comprobante' : 'Aviso'}{m.adjuntos ? ` · ${m.adjuntos} PDF` : ''}</span>
    ) },
    { titulo: 'Por', csv: (m) => `${PROVEEDOR[m.proveedor]}${m.respaldo ? ' (respaldo)' : ''}`, celda: (m) => (
      <span className="whitespace-nowrap" title={m.respaldo ? `Salió por el respaldo: ${m.errorPrimero ?? 'el principal falló'}` : undefined}>
        {PROVEEDOR[m.proveedor]}
        {m.respaldo && <span className="ml-1 text-amber-700 font-semibold">respaldo</span>}
      </span>
    ) },
    { titulo: 'Estado', csv: (m) => ETIQUETA_ESTADO[m.estado], celda: (m) => (
      <Badge tono={TONO_ESTADO[m.estado]} title={EXPLICACION_ESTADO[m.estado]}>{ETIQUETA_ESTADO[m.estado]}</Badge>
    ) },
    { titulo: 'Detalle', truncar: true, anchoMax: 260, csv: (m) => m.entrega?.detalle ?? '', celda: (m) => (
      m.entrega?.detalle ? <span className="text-secundario">{m.entrega.detalle}</span> : null
    ) },
  ]

  return (
    <div className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
      <PageHeader titulo="Mails enviados" icono={<Mail size={20} />} contexto="Lo que mandó la app y qué pasó con cada mail" />

      <StatusStrip segmentos={[
        { id: 'total',      etiqueta: 'Enviados',   valor: resumen.total,      icono: <Send size={14} />,          tono: 'neutro' },
        { id: 'entregados', etiqueta: 'Entregados', valor: resumen.entregados, icono: <CheckCircle2 size={14} />,  tono: 'entregado' },
        { id: 'rebotados',  etiqueta: 'Rebotados',  valor: resumen.rebotados,  icono: <MailX size={14} />,         tono: 'cancelado', alerta: true, title: EXPLICACION_ESTADO.rebotado },
        { id: 'quejas',     etiqueta: 'Spam',       valor: resumen.quejas,     icono: <AlertTriangle size={14} />, tono: 'cancelado', alerta: true, title: EXPLICACION_ESTADO.queja },
        { id: 'demorados',  etiqueta: 'Demorados',  valor: resumen.demorados,  icono: <Clock size={14} />,         tono: 'pendiente', title: EXPLICACION_ESTADO.demorado },
        { id: 'respaldo',   etiqueta: 'Por respaldo', valor: resumen.porRespaldo, tono: 'pendiente', alerta: true, title: 'Salieron por el proveedor de respaldo porque el principal falló' },
      ]} />

      <BarraHistorial
        mes={{ valor: mes, max: hoy.slice(0, 7), onChange: setMes }}
        buscador={{ valor: busqueda, onChange: setBusqueda, placeholder: 'Buscar por mail, asunto o motivo' }}
        selects={[
          { etiqueta: 'Estado', valor: filtroEstado, onChange: (v) => setFiltroEstado(v as FiltroEstado), opciones: OPCIONES_FILTRO_ESTADO },
          { etiqueta: 'Tipo', valor: filtroTipo, onChange: setFiltroTipo, opciones: [{ value: '', label: 'Comprobantes y avisos' }, { value: 'comprobante', label: 'Comprobantes al cliente' }, { value: 'aviso', label: 'Avisos internos' }] },
        ]}
      />

      <HistorialTable
        columnas={columnas}
        filas={filas}
        claveDe={(m) => m.id}
        cargando={cargando}
        error={error}
        onReintentar={() => { void cargar() }}
        vacio="Ningún mail en este mes con esos filtros"
        porPagina={50}
        exportar={`mails-${mes}`}
        filaResaltada={(m) => m.estado === 'rebotado' || m.estado === 'queja'}
      />
    </div>
  )
}
