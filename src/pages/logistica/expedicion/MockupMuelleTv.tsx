import { useEffect, useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { RemitoCarga, VentaVentanilla } from '@/types'
import { DARSENAS_POR_PLANTA, DARSENAS_VENTANILLA } from '@/types'
import { DarsenaCamion, DarsenaRetorno, DarsenaVentanilla, Retornos, Siguen } from './MuelleTvPage'

/**
 * MAQUETA del televisor del muelle — NO ES PRODUCCIÓN (2026-09-13, rehecha 2026-09-15).
 *
 * Ruta pública `/mockup-muelle-tv`: sin Firestore, sin login, con datos de
 * muestra adentro. Sirve para ver el tablero con situaciones inventadas (un camión
 * cargando, uno que volvió, turnos de ventanilla, uno esperando boca) sin
 * depender de lo que esté pasando en la planta. Desde el 2026-09-15 dibuja con
 * las MISMAS tarjetas que MuelleTvPage (importadas), así lo que se ve acá es lo
 * que va a mostrar la tele: la maqueta solo inventa los datos.
 *
 * Layout: cinco dársenas en una fila, en el orden físico visto desde la tele
 * (5 4 3 2 1; 4 y 5 son de clientes/revendedores); abajo los que volvieron y
 * esperan boca, PARA JUNTAR y SIGUEN.
 */

// ── Datos de muestra (patentes, choferes y clientes con el largo real) ────────

const min = (n: number) => Timestamp.fromMillis(Date.now() - n * 60_000)
const item = (productoId: string, nombre: string, cantidad: number) => ({ productoId, nombre, cantidad })
const POR_PALLET: Record<string, number> = { bolsa_2kg: 240, bolsa_3kg: 180, bolsa_10kg: 70, escamas_10kg: 70, barra: 30, agua_6l: 84 }

/** Remito de carga inventado: cargando en una boca, en espera, o que volvió. */
function remito(x: {
  id: string; patente: string; chofer: string; items: ReturnType<typeof item>[]
  darsena?: number; minutos?: number; regreso?: { hace: number; darsena?: number }
}): RemitoCarga {
  return {
    id: x.id, codigo: x.id, camionLabel: `${x.patente} · Iveco`, choferId: x.id, choferNombre: x.chofer,
    items: x.items, plantaId: 'torcuato',
    fecha: min(x.minutos ?? 0),
    estado: x.regreso ? 'salido' : 'emitido',
    ...(x.darsena ? { darsena: x.darsena } : {}),
    ...(x.regreso ? { regreso: { uid: x.id, nombre: x.chofer, hora: min(x.regreso.hace), ...(x.regreso.darsena ? { darsena: x.regreso.darsena } : {}) } } : {}),
  } as unknown as RemitoCarga
}

/** Turno de ventanilla inventado: llamado a una boca, preparado o en espera. */
function turno(x: { turno: number; cliente: string; items: ReturnType<typeof item>[]; darsena?: number; preparado?: boolean; factura?: number; promo?: boolean }): VentaVentanilla {
  return {
    id: `t${x.turno}`, turno: x.turno, clienteNombre: x.cliente, items: x.items, plantaId: 'torcuato',
    fecha: min(15), estado: 'pendiente_entrega', total: 100_000,
    canal: x.promo ? 'promo' : 'contado', formaPago: 'contado_efectivo',
    turnoEstado: x.darsena ? 'llamado' : x.preparado ? 'preparado' : 'en_espera',
    ...(x.darsena ? { darsena: x.darsena } : {}),
    // Ticket: factura A de ARCA (pto. de venta 1104) o factura X de promo.
    ...(x.factura && !x.promo ? { factura: { estado: 'emitida', numero: x.factura, puntoVenta: 1104, cbteTipo: 1, cae: '7', caeFchVto: '' } } : {}),
    ...(x.factura && x.promo ? { comprobanteInterno: { tipo: 'facturaX', puntoVenta: 1, numero: x.factura } } : {}),
  } as unknown as VentaVentanilla
}

const CARGANDO = [
  remito({ id: 'RC-DT-000231', patente: 'AF985DC', chofer: 'González Gustavo Adrián', darsena: 1, minutos: 12, items: [item('bolsa_2kg', '2kg', 920), item('bolsa_10kg', '10kg', 40), item('bolsa_3kg', '3kg', 15), item('escamas_10kg', 'ESCAMA', 3), item('barra', 'BARRA', 14), item('agua_6l', 'AGUA', 20), item('anticongelante', 'ANTIC.', 50)] }),   // siete productos: renglones compactos a dos columnas
  remito({ id: 'RC-DT-000232', patente: 'AH954MH', chofer: 'Gallo Braian Agustin', darsena: 2, minutos: 34, items: [item('bolsa_3kg', '3kg', 540), item('escamas_10kg', 'ESCAMA', 85), item('barra', 'BARRA', 12), item('agua_6l', 'AGUA', 90), item('anticongelante', 'ANTIC.', 25)] }),   // cinco productos: renglones compactos
  remito({ id: 'RC-DT-000233', patente: 'AD772KR', chofer: 'Morinigo Raul Martin', minutos: 4, items: [item('bolsa_3kg', '3kg', 360)] }),   // en espera de boca
]
const VOLVIERON = [
  remito({ id: 'RC-DT-000219', patente: 'AC119PL', chofer: 'Gerez Ricardo Fabián', regreso: { hace: 48, darsena: 3 }, items: [item('bolsa_3kg', '3kg', 400)] }),
  remito({ id: 'RC-DT-000224', patente: 'AB223XC', chofer: 'Primiterra Cristian O.', regreso: { hace: 9 }, items: [item('bolsa_2kg', '2kg', 500)] }),          // sin boca libre
  remito({ id: 'RC-DT-000227', patente: 'AA884JD', chofer: 'Álvarez Sergio Jesús', regreso: { hace: 3 }, items: [item('bolsa_10kg', '10kg', 90)] }),
]
const TURNOS = [
  turno({ turno: 12, cliente: 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)', darsena: 4, factura: 12345, items: [item('bolsa_3kg', '3kg', 40), item('bolsa_10kg', '10kg', 6), item('picado_10kg', 'PICADO', 2), item('escamas_10kg', 'ESCAMA', 8)] }),   // cuatro productos: la tarjeta de ventanilla pasa a compacto desde tres
  turno({ turno: 13, cliente: 'DON SATUR S.R.L.', darsena: 5, factura: 431, promo: true, items: [item('bolsa_2kg', '2kg', 25)] }),
  turno({ turno: 14, cliente: 'CLUB NAUTICO SAN FERNANDO', preparado: true, items: [item('bolsa_3kg', '3kg', 30)] }),
  turno({ turno: 15, cliente: '180BURGERBAR S.R.L.', items: [item('escamas_10kg', 'ESCAMA', 12)] }),
  turno({ turno: 16, cliente: '1970 SRL (KOPI NUÑEZ)', items: [item('bolsa_3kg', '3kg', 20)] }),
  turno({ turno: 17, cliente: '17 DE SEPTIEMBRE S.R.L.', items: [item('bolsa_10kg', '10kg', 8)] }),
  turno({ turno: 18, cliente: 'PALITO', items: [item('bolsa_2kg', '2kg', 15)] }),
]

type Escenario = 'normal' | 'saturado' | 'vacio'

export default function MockupMuelleTv() {
  const [escenario, setEscenario] = useState<Escenario>('normal')
  const [llamando, setLlamando] = useState(false)
  const [escala, setEscala] = useState(1)
  const [ahora, setAhora] = useState(Date.now())
  const totalDarsenas = DARSENAS_POR_PLANTA.torcuato
  const dVentanilla = DARSENAS_VENTANILLA.torcuato
  const ordenFisico = Array.from({ length: totalDarsenas }, (_, i) => totalDarsenas - i)

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])
  // Se dibuja a 1920×1080 lógicos y se escala entero, igual que MuelleTvPage.
  useEffect(() => {
    const ajustar = () => setEscala(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    ajustar()
    window.addEventListener('resize', ajustar)
    return () => window.removeEventListener('resize', ajustar)
  }, [])

  const { remitos, ventanillas } = useMemo(() => {
    if (escenario === 'vacio') return { remitos: [] as RemitoCarga[], ventanillas: [] as VentaVentanilla[] }
    if (escenario === 'saturado') return { remitos: [...CARGANDO, ...VOLVIERON], ventanillas: TURNOS }
    return { remitos: [CARGANDO[1], VOLVIERON[0], VOLVIERON[1]], ventanillas: TURNOS.slice(1, 4) }
  }, [escenario])

  const camionEnDarsena = (n: number) => remitos.find((r) => r.estado === 'emitido' && r.darsena === n)
  const turnoEnDarsena  = (n: number) => ventanillas.find((v) => v.turnoEstado === 'llamado' && v.darsena === n)
  const retornos = remitos.filter((r) => r.regreso)
  const retornoEnDarsena = (n: number) => retornos.find((r) => r.regreso?.darsena === n)
  const retornosSinDarsena = retornos.filter((r) => !r.regreso?.darsena)
  const camionesEnEspera = remitos.filter((r) => r.estado === 'emitido' && !r.darsena)
  const colaTurnos = ventanillas.filter((v) => v.turnoEstado !== 'llamado')
  const desglose = (productoId: string, cantidad: number) => {
    const upp = POR_PALLET[productoId] ?? 0
    return upp > 0 ? { pallets: Math.floor(cantidad / upp), sueltas: cantidad % upp } : { pallets: 0, sueltas: cantidad }
  }

  return (
    <div className="h-screen h-dvh w-screen overflow-hidden bg-gray-950 relative">
      <div className="bg-gray-950 text-white p-6 flex flex-col gap-4 absolute left-1/2 top-1/2"
        style={{ width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${escala})` }}>

        {/* Header: igual que la tele */}
        <div className="flex items-center gap-4 h-[84px] shrink-0">
          <p className="text-2xl font-bold text-gray-500 shrink-0">MUELLE · DON TORCUATO</p>
          {llamando ? (
            <div className="flex-1 bg-green-600 rounded-2xl text-center py-2 animate-pulse" style={{ boxShadow: '0 0 40px rgba(22,163,74,0.45)' }}>
              <span className="text-[54px] font-black leading-none">TURNO 14 → DÁRSENA 5</span>
            </div>
          ) : <div className="flex-1" />}
          <p className="text-[40px] font-black tabular-nums shrink-0">
            {new Date(ahora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
        </div>

        {/* Las cinco dársenas, 5 4 3 2 1: las tarjetas son las de MuelleTvPage */}
        <div className="grid gap-4" style={{ height: 540, gridTemplateColumns: `repeat(${totalDarsenas}, minmax(0, 1fr))` }}>
          {ordenFisico.map((n) => {
            const volvio = retornoEnDarsena(n)
            if (volvio) return <DarsenaRetorno key={n} n={n} r={volvio} ahora={ahora} />
            if (dVentanilla.includes(n)) return <DarsenaVentanilla key={n} n={n} v={turnoEnDarsena(n)} />
            const r = camionEnDarsena(n)
            return <DarsenaCamion key={n} n={n} r={r} desglose={desglose} ahora={r ? ahora : 0} />
          })}
        </div>

        <div className="flex gap-4 flex-1 min-h-0">
          <Retornos retornos={retornosSinDarsena} ahora={ahora} />
          <Siguen cola={colaTurnos} ausentes={[]} camionesEnEspera={camionesEnEspera} listosParaSalir={[]} />
        </div>
      </div>

      {/* Andamio de la maqueta: NO va en producción. */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white px-4 py-2 flex items-center gap-3 text-xs">
        <span className="uppercase tracking-widest text-gray-500">Maqueta</span>
        {(['normal', 'saturado', 'vacio'] as const).map((e) => (
          <button key={e} onClick={() => setEscenario(e)}
            className={`rounded px-3 py-1.5 font-semibold capitalize ${escenario === e ? 'bg-accent' : 'bg-white/10 text-gray-300'}`}>
            {e}
          </button>
        ))}
        <button onClick={() => setLlamando((v) => !v)}
          className={`rounded px-3 py-1.5 font-semibold ${llamando ? 'bg-green-600' : 'bg-white/10 text-gray-300'}`}>
          Llamando turno
        </button>
        <span className="ml-auto text-gray-500">
          ventana {typeof window === 'undefined' ? '?' : `${window.innerWidth}×${window.innerHeight}`} · escala {escala.toFixed(2)} · zoom {typeof window === 'undefined' ? '?' : Math.round(window.devicePixelRatio * 100)}% · datos inventados
        </span>
      </div>
    </div>
  )
}
