import { ReactNode } from 'react'
import { Check, PackageCheck, Truck } from 'lucide-react'
import Badge from '@/components/common/Badge'
import HistorialTable, { type ColumnaHistorial } from '@/components/common/HistorialTable'
import { RETENCION_LABELS } from '@/components/supervisor/RetencionForm'
import { formatoARS } from '@/utils/money'
import { antiguedadHoras } from '@/utils/sobres'
import { horaCorta } from '@/utils/turnoCaja'
import { MOTIVOS_DIFERENCIA_LIQUIDACION, type ChequeRendido, type RetencionRendida, type Sobre, type TipoRetencion } from '@/types'

// Piezas del sobre que se repiten del lado de caja (2026-09-14): el badge del
// estado de recepción, la tabla de sobres del historial y el texto de cada
// valor en papel. Glosario: "A rendir" es SOLO el teórico del sistema;
// "Declaré" lo que contó el cajero; "Contado por tesorería" lo que contó
// tesorería; estados "En camino" y "Recibida". Nada de "validación".

export const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

export const haceCuanto = (horas: number): string =>
  horas < 1 ? 'hace minutos' : horas < 48 ? `hace ${Math.round(horas)} h` : `hace ${Math.round(horas / 24)} días`

/** Diferencia con color: cero en gris secundario (es información, no se lava), faltante en rojo, sobrante en ámbar. */
export const dif = (n: number): ReactNode => (
  <span className={`font-semibold tabular-nums ${n === 0 ? 'text-secundario' : n < 0 ? 'text-red-600' : 'text-amber-700'}`}>{n > 0 ? '+' : ''}{formatoARS(n)}</span>
)

export const textoCheque = (ch: ChequeRendido) => `Cheque${ch.esEcheq ? ' electrónico' : ''} ${ch.numero} · ${ch.bancoNombre}`
export const textoRetencion = (re: RetencionRendida) => `Retención ${RETENCION_LABELS[re.tipo as TipoRetencion] ?? re.tipo.toUpperCase()} · cert. ${re.nroCertificado}`

/** "Recibida por Yanina 18:32 · conforme" / "con diferencia −$X (motivo)". */
export function textoRecepcion(s: Sobre): string {
  const r = s.recepcion
  if (!r) return `En camino · ${haceCuanto(antiguedadHoras(s, Date.now()))}`
  const base = `Recibida por ${r.recibio.nombre} ${horaCorta(r.en)}`
  if (r.conformidad === 'conforme') return `${base} · conforme`
  const d = r.diferencia
  const partes = [
    d && d.efectivo !== 0 ? `${d.efectivo > 0 ? '+' : ''}${formatoARS(d.efectivo)}` : '',
    d && d.valoresFaltantes.cantidad ? `${d.valoresFaltantes.cantidad} valor(es) sin recibir` : '',
  ].filter(Boolean).join(', ')
  return `${base} · con diferencia ${partes}${d ? ` (${MOTIVOS_DIFERENCIA_LIQUIDACION[d.motivo]}${d.nota ? `: ${d.nota}` : ''})` : ''}`
}

export function BadgeRecepcion({ sobre, detalle = false }: { sobre: Sobre; detalle?: boolean }) {
  const r = sobre.recepcion
  if (!r) {
    const h = antiguedadHoras(sobre, Date.now())
    return <Badge tono={h >= 12 ? 'aviso' : 'pendiente'} icono={<Truck />} title="Rendida, todavía no la recibió tesorería">En camino{detalle ? ` · ${haceCuanto(h)}` : ''}</Badge>
  }
  const conforme = r.conformidad === 'conforme'
  return (
    <Badge tono={conforme ? 'entregado' : 'cancelado'} icono={conforme ? <PackageCheck /> : <Check />} title={textoRecepcion(sobre)}>
      Recibida{detalle ? ` por ${r.recibio.nombre} ${horaCorta(r.en)}` : ''}{conforme ? ' · conforme' : ' · con diferencia'}
    </Badge>
  )
}

/** Historial de sobres de un cajero (Mi turno e Historial de cierres). */
export function TablaSobres({ sobres, cargando, titulo = 'Mis rendiciones', exportar, acciones, porPagina = 30, className }: {
  sobres: Sobre[]
  cargando?: boolean
  titulo?: string
  exportar?: string
  /** Botones por fila (reimprimir, enviar). */
  acciones?: (s: Sobre) => ReactNode
  porPagina?: number
  className?: string
}) {
  const columnas: ColumnaHistorial<Sobre>[] = [
    { titulo: 'Fecha',  csv: (s) => s.fecha, celda: (s) => <span className="tabular-nums whitespace-nowrap">{diaMes(s.fecha)} {horaCorta(s.cerradaEn)}</span> },
    { titulo: 'Código', csv: (s) => s.codigo, celda: (s) => <span className="tabular-nums whitespace-nowrap font-medium">{s.codigo}</span> },
    { titulo: 'A rendir', alinear: 'der', csv: (s) => s.sistema.efectivo, celda: (s) => formatoARS(s.sistema.efectivo) },
    { titulo: 'Declaré',  alinear: 'der', csv: (s) => s.declarado.efectivo, celda: (s) => formatoARS(s.declarado.efectivo) },
    { titulo: 'Dif. de caja', alinear: 'der', csv: (s) => s.diferenciaDeclarada.efectivo, celda: (s) => dif(s.diferenciaDeclarada.efectivo) },
    { titulo: 'Valores', alinear: 'der', csv: (s) => s.sistema.cheques.length + s.sistema.retenciones.length, celda: (s) => {
      const n = s.sistema.cheques.length + s.sistema.retenciones.length
      const faltan = s.diferenciaDeclarada.valoresFaltantes.cantidad
      return n ? <span>{n}{faltan ? <span className="text-red-600 font-semibold"> (−{faltan})</span> : null}</span> : <span className="text-secundario">0</span>
    } },
    { titulo: 'Contado por tesorería', alinear: 'der', csv: (s) => s.recepcion?.efectivoContado ?? '', celda: (s) => (s.recepcion ? formatoARS(s.recepcion.efectivoContado) : <span className="text-secundario">—</span>) },
    { titulo: 'Recepción', anchoMax: 260, csv: (s) => textoRecepcion(s), celda: (s) => (
      <div className="flex items-center gap-1.5 min-w-0">
        <BadgeRecepcion sobre={s} />
        {s.recepcion && <span className="truncate text-secundario text-xs" title={textoRecepcion(s)}>{s.recepcion.recibio.nombre} {horaCorta(s.recepcion.en)}</span>}
      </div>
    ) },
    ...(acciones ? [{ titulo: '', sinCsv: true, celda: acciones } as ColumnaHistorial<Sobre>] : []),
  ]
  return (
    <HistorialTable
      className={className}
      titulo={titulo}
      columnas={columnas}
      filas={sobres}
      claveDe={(s) => s.id}
      cargando={cargando}
      vacio="Todavía no rendiste ningún sobre."
      anchoMinimo={860}
      compacta
      porPagina={porPagina}
      exportar={exportar}
    />
  )
}
