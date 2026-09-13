import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, CloudOff, Eye, EyeOff, HandCoins, History, LogOut, MapPin, MessageCircle, Package,
  Phone, Truck, Users, X,
} from 'lucide-react'
import ClienteCombobox, { type ComboItem } from '@/components/common/ClienteCombobox'
import ChipMora, { BORDE_MORA, CLASE_MORA } from '@/components/supervisor/ChipMora'
import { Plegable } from '@/components/ui/Plegable'
import { formatoARS } from '@/utils/money'
import { normalizarBusqueda } from '@/utils/busqueda'
import { urlLlamar, urlMapa, urlWhatsApp } from '@/utils/contacto'
import type { NivelMora } from '@/utils/mora'

/**
 * MAQUETA DESCARTABLE del módulo del supervisor (2026-09-13) — NO ES PRODUCCIÓN.
 *
 * Ruta pública `/mockup-supervisor-mobile`: no lee Firestore, no pide login y no
 * dispara ni una consulta a Tango. Así se abre desde el celular por red local
 * (`npm run dev -- --host`) sin emuladores, sin sembrar datos y sin cuenta de
 * supervisor, que es lo único que interesa acá: probar el diseño con el pulgar,
 * al sol, antes de tocar una sola pantalla productiva.
 *
 * Miente en los DATOS, no en el diseño: usa los componentes reales
 * (ClienteCombobox, ChipMora, Plegable) con el Tailwind del proyecto. Los datos
 * de muestra imitan el largo real de Tango (razones sociales de 45 caracteres,
 * saldos de 7 cifras, clientes que deben en las dos empresas), porque con
 * "Kiosco Pepe / $12.500" todo entra lindo y en producción se rompe.
 *
 * La barra negra de arriba es el andamio para probar: cambia de pantalla, de
 * escenario (cliente sin teléfono, sin domicilio, sin deuda, saldo cargando),
 * de estado de conexión, y de variante de la barra de acciones (arriba vs. abajo).
 *
 * SE BORRA cuando el rediseño esté aprobado y ejecutado: este archivo, su
 * entrada en src/rutas/catalogo.ts y su <Route> en src/App.tsx.
 */

// ── Datos de muestra ──────────────────────────────────────────────────────────
// Nombres e importes con el largo real de Tango (ver comentario de arriba).

interface ClienteMock {
  uid:          string
  razonSocial:  string
  codigo:       string
  cuit:         string
  direccion:    string
  localidad:    string
  telefono:     string
  saldo:        number
  comprobantes: number
  diasAtraso:   number
  /** Minutos desde la última actualización del cache de Tango. */
  cacheMin:     number
  nivel:        NivelMora
  /** Debe en las dos empresas: se muestra el desglose. */
  desglose?:    { redonhielo: number; rolito: number }
  sucursales?:  number
}

const CLIENTES: ClienteMock[] = [
  {
    uid: 'c1', razonSocial: 'GASTRONOMIA EMPRENDIMIENTOS S.A.S - (HUMBOLDT)', codigo: 'GASTRO.12',
    cuit: '30-71915509-6', direccion: 'Humboldt 1550', localidad: 'PALERMO', telefono: '11 4567-8901',
    saldo: 1480500, comprobantes: 14, diasAtraso: 62, cacheMin: 8, nivel: 'rojo', sucursales: 3,
  },
  {
    uid: 'c2', razonSocial: 'DON SATUR S.R.L.', codigo: 'V.61', cuit: '33-64337382-9',
    direccion: 'Av. San Martín 4820', localidad: 'VILLA DEVOTO', telefono: '11 4501-2233',
    saldo: 908488.75, comprobantes: 9, diasAtraso: 31, cacheMin: 4320, nivel: 'amarillo',
    desglose: { redonhielo: 745288.75, rolito: 163200 },
  },
  {
    uid: 'c3', razonSocial: '1970 SRL (KOPI NUÑEZ) - SUCURSAL CABILDO', codigo: 'COM023',
    cuit: '30-71915509-6', direccion: 'Av. Cabildo 2725', localidad: 'NUÑEZ', telefono: '11 4788-0099',
    saldo: 264602.8, comprobantes: 4, diasAtraso: 12, cacheMin: 35, nivel: 'amarillo', sucursales: 2,
  },
  {
    uid: 'c4', razonSocial: '180BURGERBAR S.R.L.', codigo: 'BI.515', cuit: '30-71484577-9',
    direccion: 'Bartolomé Mitre 980', localidad: 'CAPITAL FEDERAL', telefono: '11 5263-4400',
    saldo: 189200, comprobantes: 3, diasAtraso: 0, cacheMin: 12, nivel: 'ok',
  },
  {
    uid: 'c5', razonSocial: 'CLUB NAUTICO SAN FERNANDO ASOC. CIVIL', codigo: 'COM126',
    cuit: '20-37683139-7', direccion: 'Del Valle Iberlucea 355', localidad: 'SAN FERNANDO',
    telefono: '11 4744-1200', saldo: 137600, comprobantes: 2, diasAtraso: 0, cacheMin: 61, nivel: 'ok',
  },
  {
    uid: 'c6', razonSocial: '17 DE SEPTIEMBRE S.R.L.', codigo: 'CI.06', cuit: '30-66462880-1',
    direccion: 'Ruta 8 km 42,5', localidad: 'MARCOS PAZ', telefono: '0220 477-3311',
    saldo: 52000, comprobantes: 1, diasAtraso: 0, cacheMin: 18, nivel: 'ok',
  },
]

// Clientes sin deuda: solo aparecen por el buscador, nunca en la lista. Son la
// mitad de los casos reales y la maqueta tiene que mostrarlos.
const SIN_DEUDA: ComboItem[] = [
  { uid: 's1', label: '10 DE SEPTIEMBRE S.A.', codigo: 'V.61', cuit: '33-64337382-9', localidad: 'LOMAS DEL MIRADOR' },
  { uid: 's2', label: '13 MARKET S.A.', codigo: 'FC.591', cuit: '30-71565765-7', localidad: 'PILAR' },
  { uid: 's3', label: '2103 S.R.L. · sin CUIT (solo promo)', codigo: 'OR.238', localidad: 'JOSE C. PAZ' },
  { uid: 's4', label: '2MIL 3C SRL', codigo: 'OR.179', cuit: '30-71512545-1', localidad: 'LOMAS DE ZAMORA' },
]

const ITEMS: ComboItem[] = [
  ...CLIENTES.map((c) => ({
    uid: c.uid, label: c.razonSocial, codigo: c.codigo, cuit: c.cuit, localidad: c.localidad,
    sucursales: c.sucursales,
  })),
  ...SIN_DEUDA,
]

const COBRADO_HOY = { efectivo: 412300, transferencia: 1250000, cheques: 380000, retenciones: 47820 }
const TOTAL_HOY = COBRADO_HOY.efectivo + COBRADO_HOY.transferencia + COBRADO_HOY.cheques + COBRADO_HOY.retenciones

type Escenario = 'completo' | 'sinTelefono' | 'sinDomicilio' | 'sinDeuda' | 'cargando'
type Conexion = 'ok' | 'sinSenal' | 'cola'
type Variante = 'arriba' | 'abajo'
type Pantalla = 'home' | 'clientes' | 'ficha'

// "hace 5 min" / "hace 3 días" — copia local de utils (la maqueta no importa de
// una página; en producción esto se muda a utils/tiempo.ts, paso 1 de la fase 2).
const haceCuanto = (min: number): string => {
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`
}

// ── Importe con modo privacidad ───────────────────────────────────────────────

/**
 * Importe que se puede enmascarar (mostrador con gente mirando el teléfono).
 * Tocarlo lo revela unos segundos. El formulario de cobro NUNCA usa esto: ahí
 * el supervisor necesita ver lo que imputa y ocultarlo sería un riesgo con plata.
 */
function Plata({ n, privado, className = '' }: { n: number; privado: boolean; className?: string }) {
  const [revelado, setRevelado] = useState(false)
  useEffect(() => {
    if (!revelado) return
    const t = setTimeout(() => setRevelado(false), 4000)
    return () => clearTimeout(t)
  }, [revelado])
  if (!privado || revelado) return <span className={`tabular-nums ${className}`}>{formatoARS(n)}</span>
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevelado(true) }}
      className={`tabular-nums tracking-widest ${className}`} aria-label="Mostrar importe">
      $&nbsp;•••••
    </button>
  )
}

// ── Andamio ───────────────────────────────────────────────────────────────────

function BarraMaqueta({
  pantalla, setPantalla, variante, setVariante, escenario, setEscenario, conexion, setConexion,
  toqueGrande, setToqueGrande,
}: {
  pantalla: Pantalla; setPantalla: (p: Pantalla) => void
  variante: Variante; setVariante: (v: Variante) => void
  escenario: Escenario; setEscenario: (e: Escenario) => void
  conexion: Conexion; setConexion: (c: Conexion) => void
  toqueGrande: boolean; setToqueGrande: (t: boolean) => void
}) {
  const sel = 'bg-white/10 border border-white/20 rounded-md px-2 py-1.5 text-xs text-white'
  return (
    <div className="bg-gray-900 text-white px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-gray-400 shrink-0">Maqueta</span>
        <div className="flex gap-1 flex-1">
          {(['home', 'clientes', 'ficha'] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPantalla(p)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold capitalize ${pantalla === p ? 'bg-accent text-white' : 'bg-white/10 text-gray-300'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Acciones</span>
          <select value={variante} onChange={(e) => setVariante(e.target.value as Variante)} className={sel}>
            <option value="arriba">Arriba</option>
            <option value="abajo">Barra abajo</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Cliente</span>
          <select value={escenario} onChange={(e) => setEscenario(e.target.value as Escenario)} className={sel}>
            <option value="completo">Completo</option>
            <option value="sinTelefono">Sin teléfono</option>
            <option value="sinDomicilio">Sin domicilio</option>
            <option value="sinDeuda">Sin deuda</option>
            <option value="cargando">Saldo cargando</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400">Conexión</span>
          <select value={conexion} onChange={(e) => setConexion(e.target.value as Conexion)} className={sel}>
            <option value="ok">Con señal</option>
            <option value="sinSenal">Sin señal</option>
            <option value="cola">2 sin subir</option>
          </select>
        </label>
      </div>
      {/* A/B del tamaño de toque del buscador: el ✕ de limpiar y las filas de
          resultados hoy miden ~20 y ~36 px, contra los 44 px de la regla. */}
      <button type="button" onClick={() => setToqueGrande(!toqueGrande)}
        className="w-full rounded-md bg-white/10 border border-white/20 px-2 py-1.5 text-xs text-left text-gray-300">
        Buscador: toque <span className="font-semibold text-white">{toqueGrande ? '44 px (agrandado)' : 'actual (~36 px)'}</span> · tocá para comparar
      </button>
    </div>
  )
}

// ── Header (con franja de conexión + ojo de privacidad) ───────────────────────

function HeaderMock({
  titulo, back, onBack, conexion, privado, setPrivado,
}: {
  titulo?: string; back?: boolean; onBack?: () => void
  conexion: Conexion; privado: boolean; setPrivado: (p: boolean) => void
}) {
  return (
    <div className="sticky top-0 z-40">
      <header className="min-h-14 bg-white border-b border-[#D3D1C7] flex items-center gap-3 px-3">
        {back ? (
          <button type="button" onClick={onBack} aria-label="Volver"
            className="w-11 h-11 rounded-xl border border-[#D3D1C7] flex items-center justify-center active:scale-90 transition-transform">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <span className="text-accent font-bold text-sm">R</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight truncate">{titulo ?? 'Hola, Matías'}</p>
          {!back && <p className="text-xs text-secundario leading-tight">Supervisor de cobranzas</p>}
        </div>
        {/* Modo privacidad: el mostrador con gente mirando el teléfono. */}
        <button type="button" onClick={() => setPrivado(!privado)} aria-label={privado ? 'Mostrar importes' : 'Ocultar importes'}
          className={`w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${privado ? 'text-accent bg-accent/10' : 'text-secundario'}`}>
          {privado ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
        <button type="button" aria-label="Cerrar sesión"
          className="w-11 h-11 rounded-xl flex items-center justify-center text-secundario active:scale-90 transition-transform">
          <LogOut size={20} />
        </button>
      </header>
      {/* Franja de conexión: en TODAS las pantallas, no solo en el inicio.
          Cuando todo subió no se muestra nada — un verde permanente es ruido. */}
      {conexion !== 'ok' && (
        <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium ${
          conexion === 'sinSenal' ? 'bg-amber-100 text-amber-900' : 'bg-amber-50 text-amber-800'
        }`}>
          <CloudOff size={14} className="shrink-0" />
          {conexion === 'sinSenal'
            ? <span>Sin señal · lo que cobres se guarda en el teléfono</span>
            : <span>2 cobranzas guardadas en el teléfono, subiendo…</span>}
        </div>
      )}
    </div>
  )
}

// ── Pantalla 1: Home ──────────────────────────────────────────────────────────

function TarjetaHome({ icono, titulo, bajada, onClick, extra }: {
  icono: React.ReactNode; titulo: string; bajada: string; onClick?: () => void; extra?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm">
      <button type="button" onClick={onClick} className="w-full text-left p-4 active:scale-[0.99] transition-transform">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">{icono}</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">{titulo}</p>
            <p className="text-xs text-secundario">{bajada}</p>
          </div>
        </div>
      </button>
      {extra}
    </div>
  )
}

function HomeMock({ privado, irA }: { privado: boolean; irA: (p: Pantalla) => void }) {
  return (
    <main className="max-w-md mx-auto p-4 space-y-3 pb-16">
      <TarjetaHome icono={<Users size={22} className="text-accent" />} titulo="Clientes" onClick={() => irA('clientes')}
        bajada="Buscá cualquier cliente, mirá quién debe y cobrá desde su ficha" />
      <TarjetaHome icono={<Truck size={22} className="text-accent" />} titulo="Reparto en vivo"
        bajada="Qué cargó, qué bajó y qué le queda a cada camión, con sus ventas" />
      <TarjetaHome icono={<History size={22} className="text-accent" />} titulo="Mis cobranzas"
        bajada={`Hoy ${formatoARS(TOTAL_HOY)} · 7 recibos · últimos 30 días`} />
      {/* Condicional: solo el supervisor con depósito de Tango vinculado. */}
      <TarjetaHome icono={<Package size={22} className="text-accent" />} titulo="Vender"
        bajada="Entregas a demanda desde tu depósito 07 · MATIAS VINJOY"
        extra={
          <div className="border-t border-[#E7E5DC] px-4 py-2.5">
            <button type="button" className="text-xs font-medium text-accent">Mis ventas — entregá el comprobante →</button>
          </div>
        } />

      {/* Cobrado hoy. OJO: StatusStrip formatea con toLocaleString (sin $), que
          sirve para CONTEOS y no para plata. Acá va la misma tira con importes. */}
      <section className="pt-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1.5">Cobrado hoy</h2>
        <div className="bg-white border border-[#D3D1C7] rounded-xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#E7E5DC] flex items-baseline justify-between">
            <p className="text-xs font-medium text-secundario">Total</p>
            <Plata n={TOTAL_HOY} privado={privado} className="text-2xl font-bold leading-none text-gray-900" />
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-[#E7E5DC]">
            {([['Efectivo', COBRADO_HOY.efectivo], ['Transferencia', COBRADO_HOY.transferencia],
              ['Cheques', COBRADO_HOY.cheques], ['Retenciones', COBRADO_HOY.retenciones]] as const).map(([k, v]) => (
              <div key={k} className="px-3.5 py-2">
                <p className="text-xs text-secundario truncate">{k}</p>
                <Plata n={v} privado={privado} className="text-base font-semibold text-gray-900" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-secundario mb-1">Mi rendición de hoy</h2>
        <p className="text-sm text-gray-600">
          Todavía no rendiste hoy. Cuando caja cierre tu liquidación la vas a ver acá con la firma de quien te recibió.
        </p>
      </section>
    </main>
  )
}

// ── Pantalla 2: Clientes ──────────────────────────────────────────────────────

type FiltroLista = 'deuda' | 'vencidos' | 'mora'

function ClientesMock({ privado, toqueGrande, abrirFicha }: { privado: boolean; toqueGrande: boolean; abrirFicha: (uid: string) => void }) {
  const [filtro, setFiltro] = useState<FiltroLista>('deuda')
  const [texto, setTexto] = useState('')

  const vencidos = CLIENTES.filter((c) => c.diasAtraso > 0).length
  const enMora = CLIENTES.filter((c) => c.nivel !== 'ok').length

  // Orden por mora: nivel → días de atraso → importe. Lo urgente primero, sin
  // esconder a nadie detrás de un filtro activo por defecto.
  const PESO: Record<NivelMora, number> = { rojo: 0, amarillo: 1, ok: 2 }
  const lista = useMemo(() => {
    const base = filtro === 'deuda' ? CLIENTES
      : filtro === 'vencidos' ? CLIENTES.filter((c) => c.diasAtraso > 0)
        : CLIENTES.filter((c) => c.nivel !== 'ok')
    // El filtro se aplica SIEMPRE, haya o no texto escrito. En producción hoy
    // hay un bug acá: con el buscador vacío, "En mora" muestra todos los vencidos.
    const q = normalizarBusqueda(texto)
    const filtrada = q ? base.filter((c) => normalizarBusqueda(`${c.razonSocial} ${c.codigo}`).includes(q)) : base
    return [...filtrada].sort((a, b) => PESO[a.nivel] - PESO[b.nivel] || b.diasAtraso - a.diasAtraso || b.saldo - a.saldo)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- PESO es una constante literal
  }, [filtro, texto])

  const total = lista.reduce((t, c) => t + c.saldo, 0)

  return (
    <main className="max-w-md mx-auto p-4 space-y-3 pb-16">
      {/* Buscador: TODOS los clientes (los que deben y los que no).
          `toqueGrande` agranda el ✕ de limpiar (hoy ~20 px) y las filas de
          resultados (hoy ~36 px) hasta los 44 px de la regla táctil, DESDE AFUERA
          con variantes arbitrarias: el componente es compartido por ~8 pantallas,
          varias de escritorio, y no se toca hasta que Ariel confirme con el dedo. */}
      <div className={toqueGrande
        ? "[&_button[aria-label='Borrar búsqueda']]:w-11 [&_button[aria-label='Borrar búsqueda']]:h-11 [&_button[aria-label='Borrar búsqueda']]:right-0 [&_input]:pr-12 [&_li[role='option']]:py-3.5"
        : ''}>
        <ClienteCombobox
          modo="busqueda"
          items={ITEMS}
          value=""
          onChange={(uid) => uid && abrirFicha(uid)}
          placeholder="Nombre, código, CUIT o dirección…"
          listaClassName="max-h-[50vh]"
        />
      </div>

      <div className="flex gap-2">
        {([['deuda', `Con deuda (${CLIENTES.length})`], ['vencidos', `Vencidos (${vencidos})`], ['mora', `En mora (${enMora})`]] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFiltro(id)}
            className={`flex-1 h-11 rounded-lg border px-2 text-xs font-medium ${filtro === id ? 'bg-accent text-white border-accent' : 'bg-white text-gray-700 border-[#D3D1C7]'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-secundario">{lista.length} {lista.length === 1 ? 'cliente' : 'clientes'}</p>
        <p className="text-xs text-secundario">Deuda: <Plata n={total} privado={privado} className="font-semibold text-gray-900" /></p>
      </div>

      <div className="space-y-2">
        {lista.map((c) => (
          <div key={c.uid} className={`flex bg-white rounded-xl border shadow-sm overflow-hidden ${BORDE_MORA[c.nivel]}`}>
            {/* La fila entera abre la FICHA: el cobro se decide ahí, con el saldo completo. */}
            {/* El nombre se lleva la primera línea ENTERA: las razones sociales de
                Tango tienen 45 caracteres y, compartiendo línea con el importe y
                el chip, en un celular quedaban en "GASTRONOMIA E…". El importe va
                abajo, grande, con el chip de mora al lado. */}
            <button type="button" onClick={() => abrirFicha(c.uid)} className="block flex-1 min-w-0 p-3 text-left active:bg-gray-50">
              <p className="text-sm font-medium text-gray-900 truncate" title={c.razonSocial}>{c.razonSocial}</p>
              <div className="flex items-center gap-2 mt-1">
                <Plata n={c.saldo} privado={privado} className="text-base font-bold text-gray-900" />
                <ChipMora nivel={c.nivel} />
              </div>
              <p className="text-xs text-secundario truncate mt-0.5">
                {c.comprobantes} {c.comprobantes === 1 ? 'comprobante' : 'comprobantes'} · cód. {c.codigo}
                {c.diasAtraso > 0 && <span className="text-red-600"> · {c.diasAtraso} días de atraso</span>}
              </p>
              {c.desglose && (
                <p className="text-xs text-secundario truncate">
                  Redonhielo {formatoARS(c.desglose.redonhielo)} · Rolito {formatoARS(c.desglose.rolito)}
                </p>
              )}
              {/* El dato viejo tiene que incomodar: a partir de un día, ámbar. */}
              <p className={`text-xs mt-0.5 ${c.cacheMin >= 1440 ? 'text-amber-700 font-medium' : 'text-secundario'}`}>
                Saldo de Tango {haceCuanto(c.cacheMin)}
              </p>
            </button>
            {/* Atajo directo a cobrar, 44px, para el que ya sabe a qué va. */}
            <button type="button" aria-label={`Cobrar a ${c.razonSocial}`}
              className="flex flex-col items-center justify-center gap-0.5 px-3 min-w-[56px] border-l border-[#D3D1C7] text-accent active:bg-accent/10">
              <HandCoins size={18} />
              <span className="text-[10px] font-medium">Cobrar</span>
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}

// ── Pantalla 3: Ficha ─────────────────────────────────────────────────────────

const PLANTILLAS = (c: ClienteMock) => [
  { id: 'visita', label: 'Aviso de visita', texto: `Hola, soy Matías de Rolito. Paso hoy por ${c.direccion} a cobrar. ¿Está bien el horario de la mañana?` },
  { id: 'retencion', label: 'Comprobante de retención', texto: `Hola, ¿nos pueden enviar el comprobante de la retención aplicada en el pago? Gracias.` },
  { id: 'vacio', label: 'Escribir yo', texto: '' },
]

function HojaWhatsApp({ cliente, onCerrar }: { cliente: ClienteMock; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onCerrar}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md mx-auto bg-white rounded-t-2xl p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-gray-900">WhatsApp a {cliente.razonSocial.split(' ')[0]}</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="w-11 h-11 flex items-center justify-center text-secundario">
            <X size={20} />
          </button>
        </div>
        {PLANTILLAS(cliente).map((p) => (
          <a key={p.id} href={urlWhatsApp(cliente.telefono, p.texto || undefined) ?? undefined}
            target="_blank" rel="noopener noreferrer" onClick={onCerrar}
            className="block rounded-xl border border-[#D3D1C7] px-3 py-3 active:bg-[#F8F7F2]">
            <p className="text-sm font-medium text-gray-900">{p.label}</p>
            {p.texto && <p className="text-xs text-secundario mt-0.5 line-clamp-2">{p.texto}</p>}
          </a>
        ))}
      </div>
    </div>
  )
}

function BotonAccion({ icono, label, href, onClick, disabled }: {
  icono: React.ReactNode; label: string; href?: string | null; onClick?: () => void; disabled?: boolean
}) {
  const clase = `flex-1 h-11 inline-flex items-center justify-center gap-1.5 rounded-lg border text-sm font-medium active:scale-[0.98] transition-transform ${
    disabled ? 'border-[#D3D1C7] text-inerte bg-gray-50 pointer-events-none' : 'border-accent text-accent bg-white'
  }`
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={clase}>{icono} {label}</a>
  return <button type="button" onClick={onClick} disabled={disabled} className={clase}>{icono} {label}</button>
}

function FichaMock({
  cliente, escenario, variante, privado, onVolver,
}: {
  cliente: ClienteMock; escenario: Escenario; variante: Variante; privado: boolean; onVolver: () => void
}) {
  const [wa, setWa] = useState(false)
  const sinTelefono = escenario === 'sinTelefono'
  const sinDomicilio = escenario === 'sinDomicilio'
  const sinDeuda = escenario === 'sinDeuda'
  const cargando = escenario === 'cargando'
  const saldo = sinDeuda ? 0 : cliente.saldo
  const telefono = sinTelefono ? '' : cliente.telefono
  const mapa = sinDomicilio ? null : urlMapa({ address: `${cliente.direccion}, ${cliente.localidad}` })

  const acciones = (
    <div className="flex gap-2">
      <BotonAccion icono={<Phone size={15} />} label="Llamar" href={urlLlamar(telefono)} disabled={!telefono} />
      <BotonAccion icono={<MessageCircle size={15} />} label="WhatsApp" onClick={() => setWa(true)} disabled={!telefono} />
      {mapa && <BotonAccion icono={<MapPin size={15} />} label="Cómo llegar" href={mapa} />}
    </div>
  )

  const cobrar = cargando
    ? <div className="h-11 rounded-lg border border-[#D3D1C7] bg-gray-50 flex items-center justify-center text-sm text-secundario">Cargando saldo…</div>
    : saldo > 0
      ? (
        <button type="button" className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-accent text-white text-sm font-semibold active:scale-[0.99] transition-transform">
          <HandCoins size={16} /> Cobrar <Plata n={saldo} privado={privado} />
        </button>
      )
      : <p className="text-sm text-accent font-medium text-center py-2">Sin deuda en Tango</p>

  return (
    <>
      <main className={`max-w-md mx-auto p-4 space-y-3 ${variante === 'abajo' ? 'pb-40' : 'pb-16'}`}>
        <div className="px-1">
          <h1 className="text-lg font-bold text-gray-900 leading-tight">{cliente.razonSocial}</h1>
          <p className="text-xs text-secundario">
            Redonhielo {cliente.codigo}{cliente.sucursales ? ` · ${cliente.sucursales} sucursales` : ''} · CUIT {cliente.cuit}
          </p>
        </div>

        {/* Variante A: las acciones arriba (se ven al entrar, lejos del pulgar). */}
        {variante === 'arriba' && (
          <section className="bg-white rounded-2xl border border-[#D3D1C7] shadow-sm p-3 space-y-2">
            {!sinDeuda && !cargando && (
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 border ${CLASE_MORA[cliente.nivel]}`}>
                  {cliente.diasAtraso > 0 ? `${cliente.diasAtraso} días de atraso` : 'Al día'}
                </span>
                <span className={`text-xs ${cliente.cacheMin >= 1440 ? 'text-amber-700 font-medium' : 'text-secundario'}`}>
                  Saldo de Tango {haceCuanto(cliente.cacheMin)}
                </span>
              </div>
            )}
            {cobrar}
            {acciones}
          </section>
        )}

        <Plegable titulo="Saldo y composición" abiertoInicial={false}
          extra={!cargando && saldo > 0 ? <Plata n={saldo} privado={privado} className="text-sm font-semibold text-gray-900" /> : undefined}>
          <p className="text-sm text-secundario">Facturas pendientes, remitos y el PDF para enviar. (Maqueta: contenido real en producción.)</p>
        </Plegable>
        <Plegable titulo="Contacto"><p className="text-sm text-secundario">Teléfonos por sucursal y mail.</p></Plegable>
        <Plegable titulo="Domicilios"><p className="text-sm text-secundario">Direcciones con horario y "Ir" a Maps.</p></Plegable>
        <Plegable titulo="Heladeras"><p className="text-sm text-secundario">Equipos, service y comodato.</p></Plegable>
        <Plegable titulo="Pedido a logística"><p className="text-sm text-secundario">Pasar un pedido o una visita.</p></Plegable>
        <Plegable titulo="Historial"><p className="text-sm text-secundario">Ventas, cobranzas y pedidos del último año.</p></Plegable>
        <Plegable titulo="Datos"><p className="text-sm text-secundario">CUIT, condición de IVA, vendedor, notas.</p></Plegable>
      </main>

      {/* Variante B: barra fija abajo, donde caen los pulgares. */}
      {variante === 'abajo' && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#D3D1C7] pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-md mx-auto p-3 space-y-2">
            {cobrar}
            {acciones}
          </div>
        </div>
      )}

      {wa && <HojaWhatsApp cliente={{ ...cliente, telefono }} onCerrar={() => setWa(false)} />}
      <button type="button" onClick={onVolver} className="sr-only">Volver</button>
    </>
  )
}

// ── Maqueta ───────────────────────────────────────────────────────────────────

export default function MockupSupervisorMobile() {
  const [pantalla, setPantalla] = useState<Pantalla>('home')
  const [variante, setVariante] = useState<Variante>('arriba')
  const [escenario, setEscenario] = useState<Escenario>('completo')
  const [conexion, setConexion] = useState<Conexion>('ok')
  const [privado, setPrivado] = useState(false)
  const [toqueGrande, setToqueGrande] = useState(true)
  const [uid, setUid] = useState('c1')

  const cliente = CLIENTES.find((c) => c.uid === uid) ?? CLIENTES[0]
  const abrirFicha = (u: string) => { setUid(CLIENTES.some((c) => c.uid === u) ? u : 'c4'); setPantalla('ficha') }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2]">
      <BarraMaqueta
        pantalla={pantalla} setPantalla={setPantalla}
        variante={variante} setVariante={setVariante}
        escenario={escenario} setEscenario={setEscenario}
        conexion={conexion} setConexion={setConexion}
        toqueGrande={toqueGrande} setToqueGrande={setToqueGrande}
      />
      <HeaderMock
        titulo={pantalla === 'clientes' ? 'Clientes' : pantalla === 'ficha' ? cliente.razonSocial : undefined}
        back={pantalla !== 'home'}
        // El "Volver" de la ficha vuelve A LA LISTA, no al inicio: el recorrido
        // real es lista → ficha → volver → otro cliente, diez veces por mañana.
        onBack={() => setPantalla(pantalla === 'ficha' ? 'clientes' : 'home')}
        conexion={conexion} privado={privado} setPrivado={setPrivado}
      />
      {pantalla === 'home' && <HomeMock privado={privado} irA={setPantalla} />}
      {pantalla === 'clientes' && <ClientesMock privado={privado} toqueGrande={toqueGrande} abrirFicha={abrirFicha} />}
      {pantalla === 'ficha' && (
        <FichaMock cliente={cliente} escenario={escenario} variante={variante} privado={privado}
          onVolver={() => setPantalla('clientes')} />
      )}
      <p className="max-w-md mx-auto px-4 pb-6 text-center text-[11px] text-inerte">
        Maqueta con datos inventados · no toca Firestore ni Tango · se borra al aprobar el rediseño
      </p>
    </div>
  )
}
