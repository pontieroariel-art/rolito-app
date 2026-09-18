import { useEffect, useMemo, useState } from 'react'
import { Inbox, Search, TriangleAlert } from 'lucide-react'
import PageHeader from '@/components/common/PageHeader'
import StatusStrip from '@/components/common/StatusStrip'
import { CAMPO_FILTRO } from '@/components/common/tabla'
import BloqueSobresBuzon from '@/components/expedicion/BloqueSobresBuzon'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual } from '@/hooks/useDiaActual'
import { subscribeCierresDeReparto } from '@/services/cierreMercaderiaService'
import { subscribeLiquidacionesEnRango } from '@/services/liquidacionService'
import { armarBuzon, buscarSobre } from '@/utils/buzon'
import { INPUT_BUSQUEDA_PROPS } from '@/utils/busqueda'
import type { CierreMercaderia, Liquidacion, PlantaId } from '@/types'
import { PLANTAS } from '@/types'

// El buzón de la vuelta nocturna (2026-09-18).
//
// Muelle trabaja 24 horas y caja de 6 a 18. El chofer que vuelve a las 20
// descarga sin problema, pero no tiene a quién entregarle la plata: deja el
// sobre en el buzón con el código de la descarga escrito a mano y se va. Caja lo
// abre a la mañana, lo busca por ese código y liquida el viaje.
//
// Lo que importa acá no es lo que está: es lo que FALTA. Un sobre esperado que
// no aparece es el único control real sobre la plata de la noche, así que la
// pantalla arranca por ahí y en rojo.

/** Cuántos días de viajes contados se miran hacia atrás. Un sobre más viejo que esto ya es un problema de otra pantalla. */
const DIAS = 7

const clave = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function BuzonPage() {
  const { user } = useAuth()
  const plantaId: PlantaId = user?.planta ?? 'torcuato'
  const hoy = useDiaActual()

  const dias = useMemo(() => {
    const base = new Date(`${hoy}T12:00:00`)
    return Array.from({ length: DIAS }, (_, i) => clave(new Date(base.getFullYear(), base.getMonth(), base.getDate() - i)))
  }, [hoy])

  // Los cierres de mercadería se consultan por día de reparto (es como los
  // escribe el servidor y como los indexa la colección), uno por día de la
  // ventana. Son pocos docs por día: una decena de viajes.
  const [porDia, setPorDia] = useState<Record<string, CierreMercaderia[]>>({})
  useEffect(() => {
    setPorDia({})
    const offs = dias.map((d) => subscribeCierresDeReparto(plantaId, d, (cs) => setPorDia((prev) => ({ ...prev, [d]: cs }))))
    return () => offs.forEach((off) => off())
  }, [plantaId, dias])

  // Las liquidaciones de plata del mismo rango: un viaje con liquidación es un
  // sobre que ya se abrió y se contó.
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([])
  useEffect(() => {
    const base = new Date(`${hoy}T12:00:00`)
    const desde = dias[dias.length - 1]
    const hasta = clave(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))
    return subscribeLiquidacionesEnRango(desde, hasta, setLiquidaciones, plantaId)
  }, [dias, hoy, plantaId])

  const porRemito = useMemo(() => {
    const m = new Map<string, Liquidacion>()
    for (const l of liquidaciones) if (l.remitoId) m.set(l.remitoId, l)
    return m
  }, [liquidaciones])

  const cierres = useMemo(() => dias.flatMap((d) => porDia[d] ?? []), [dias, porDia])
  const buzon = useMemo(() => armarBuzon(cierres, porRemito), [cierres, porRemito])

  const [texto, setTexto] = useState('')
  const sinAparecer = useMemo(() => buscarSobre(buzon.sinAparecer, texto), [buzon.sinAparecer, texto])
  const esperados   = useMemo(() => buscarSobre(buzon.esperados, texto),   [buzon.esperados, texto])
  const recibidos   = useMemo(() => buscarSobre(buzon.recibidos, texto),   [buzon.recibidos, texto])
  const encontrados = sinAparecer.length + esperados.length + recibidos.length

  return (
    <main className="max-w-[1600px] mx-auto p-4 space-y-4 pb-10">
      <PageHeader
        titulo="Buzón de sobres"
        icono={<Inbox size={22} />}
        contexto={`${PLANTAS[plantaId].label} · lo que dejaron los camiones que volvieron fuera del horario de caja (últimos ${DIAS} días)`}
      />

      <StatusStrip
        titulo="Sobres de la vuelta nocturna"
        segmentos={[
          { id: 'faltan',    etiqueta: 'Sin aparecer',  valor: buzon.sinAparecer.length, tono: 'cancelado', alerta: true, title: 'Viajes contados por muelle hace más de 18 horas y todavía sin liquidar: el sobre no está.' },
          { id: 'esperados', etiqueta: 'Esperados',     valor: buzon.esperados.length,   tono: 'pendiente', title: 'Volvieron anoche: el sobre tiene que estar en el buzón.' },
          { id: 'recibidos', etiqueta: 'Recibidos hoy', valor: buzon.recibidos.length,   tono: 'entregado', title: 'Viajes ya liquidados.' },
        ]}
        pie={
          <div className="flex items-center gap-2">
            <Search size={14} className="text-secundario shrink-0" />
            <input
              {...INPUT_BUSQUEDA_PROPS}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar el código escrito en el sobre (con o sin guiones), el remito o el chofer…"
              className={`${CAMPO_FILTRO} flex-1`}
            />
            {texto && (
              <span className="text-xs text-secundario whitespace-nowrap tabular-nums">
                {encontrados} sobre{encontrados === 1 ? '' : 's'}
              </span>
            )}
          </div>
        }
      />

      {/* Avisa, nunca frena: caja liquida igual. Y no se le muestra a muelle. */}
      {buzon.conArrastre.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[#E9CE92] bg-[#FDF1D8] px-3.5 py-2.5">
          <TriangleAlert size={16} className="text-[#8A5203] mt-0.5 shrink-0" />
          <p className="text-sm text-[#8A5203]">
            <b>Sobres arrastrados</b>: {buzon.conArrastre.map((c) => `${c.choferNombre} (${c.pendientes})`).join(' · ')} {buzon.conArrastre.length === 1 ? 'acumula' : 'acumulan'} más de un viaje sin liquidar.
            Lo normal es uno, el de anoche. Esto no frena nada: liquidá igual y avisá al encargado.
          </p>
        </div>
      )}

      <BloqueSobresBuzon
        titulo="Sin aparecer"
        filas={sinAparecer}
        tono="cancelado"
        ayuda="contados hace más de 18 h y todavía sin liquidar: hay que ir a buscar el sobre"
        vacio="No falta ningún sobre."
      />
      <BloqueSobresBuzon
        titulo="Esperados"
        filas={esperados}
        tono="pendiente"
        ayuda="volvieron anoche: el sobre tiene que estar en el buzón"
        vacio="Ningún viaje contado esperando su sobre."
      />
      <BloqueSobresBuzon
        titulo="Recibidos"
        filas={recibidos}
        tono="entregado"
        ayuda="viajes ya liquidados en la ventana de los últimos días"
        vacio="Todavía no liquidaste ningún viaje de la noche."
      />
    </main>
  )
}
