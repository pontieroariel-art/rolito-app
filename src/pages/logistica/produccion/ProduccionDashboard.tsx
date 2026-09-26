import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ProduccionTicket from '@/components/produccion/ProduccionTicket'
import TileProducto from '@/components/produccion/carga/TileProducto'
import ConfirmarPallet from '@/components/produccion/carga/ConfirmarPallet'
import CambiarOperario from '@/components/produccion/carga/CambiarOperario'
import { getDispositivoProduccion } from '@/services/produccionDeviceService'
import ContadorDia from '@/components/produccion/carga/ContadorDia'
import CabeceraPlanta from '@/components/produccion/carga/CabeceraPlanta'
import { useAuth } from '@/context/AuthContext'
import { useOnline } from '@/hooks/useOnline'
import { useDiaActual } from '@/hooks/useDiaActual'
import { useProduccionPalletsHoy } from '@/hooks/useProduccionPallets'
import { useImpresoraZebra } from '@/hooks/useImpresoraZebra'
import { logoutUser } from '@/services/authService'
import { crearPallet } from '@/services/produccionService'
import { asegurarReserva, proximoNumero, ReservaAgotadaError, SinNumerosDisponiblesOfflineError } from '@/services/produccionReservaService'
import { ProduccionCounterNoInicializadoError } from '@/services/produccionCounterService'
import { hayImpresoraGuardada, impresoraConectada, imprimirZpl } from '@/services/zebraBleService'
import { usePantallaEncendida } from '@/hooks/usePantallaEncendida'
import { CheckCircle2, Printer } from 'lucide-react'
import { reportError } from '@/services/observability'
import { generateQrDataUrl } from '@/utils/qr'
import { generateBarcodeDataUrl } from '@/utils/barcode'
import { PRODUCTOS_HIELO, PRODUCTOS_HIELO_LIST } from '@/utils/produccionCatalogo'
import { PLANTA_INFO } from '@/utils/constants'
import { armar, codigoDePallet, repetidoHaceSegundos, pendientesSinConfirmar, resumenDelDia, type Armado } from '@/utils/cargaPallets'
import { armarZplPallet } from '@/utils/zplPallet'
import { TACTO, vibrar } from '@/utils/tacto'
import { PLANTAS, ProductoHieloId, PalletProduccion } from '@/types'

interface TicketData { pallet: PalletProduccion; qrDataUrl: string; barcodeDataUrl: string }

// Carga de pallets de producción desde la tablet de planta (rehecha el
// 2026-09-14 sobre la maqueta aprobada por Ariel). Reglas de la pantalla:
// - un toque en la tarjeta abre la ventana de confirmación y un toque en
//   CONFIRMAR carga e imprime (2026-09-25, Ariel: "prefiero que se abra una
//   ventana"; antes se confirmaba adentro de la tarjeta y en vertical no
//   entraba);
// - la tablet es vieja: todo responde en pointerdown, las tarjetas y el
//   contador están en memo, el stream trae solo los pallets de hoy, y el
//   contador sube en el acto (el pallet se escribe en segundo plano);
// - la impresión sale al confirmar, fuera del camino del toque. Con la Zebra
//   conectada por Bluetooth va en ZPL directo (sin diálogo); si no, por el
//   diálogo de impresión del navegador como siempre.
// Sin trabas (2026-09-25, pedido de Ariel: "extremadamente práctica, ágil y
// rápida"): la pantalla no se apaga, pasa a pantalla completa al primer
// toque, una etiqueta que no pudo salir espera en una cola y sale sola cuando
// la Zebra vuelve (que se reconecta sola), el último pallet se reimprime con
// un toque y cada pallet cargado se confirma en grande arriba.
export default function ProduccionDashboard() {
  const { user } = useAuth()
  const online = useOnline()
  const navigate = useNavigate()
  const dia = useDiaActual()
  const inicioDia = useMemo(() => new Date(`${dia}T00:00:00`), [dia])
  const { pallets, loading } = useProduccionPalletsHoy(user?.planta, dia)
  const impresora = useImpresoraZebra()
  usePantallaEncendida()

  const [reservaLista, setReservaLista] = useState(false)
  const [error, setError] = useState('')
  const [armado, setArmado] = useState<Armado | null>(null)
  const [codigoProximo, setCodigoProximo] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<PalletProduccion[]>([])
  const [ticketData, setTicketData] = useState<TicketData | null>(null)
  /** Etiquetas que no pudieron salir: esperan a la Zebra y salen solas. */
  const [porImprimir, setPorImprimir] = useState<PalletProduccion[]>([])
  /** Confirmación grande del último pallet cargado o reimpreso (1,8 s). */
  const [hecho, setHecho] = useState<{ texto: string; codigo: string; color: string } | null>(null)
  /** Mismo producto cargado hace menos de un minuto: la ventana lo pregunta. */
  const [repetido, setRepetido] = useState<number | null>(null)
  /** Ventana de cambio de operario abierta. */
  const [cambiando, setCambiando] = useState(false)
  // Los pallets de hoy en una referencia, para que `onTap` sea estable (las tarjetas están en memo).
  const listasRef = useRef<PalletProduccion[][]>([[], []])
  listasRef.current = [pallets, pendientes]

  useEffect(() => {
    if (!user?.uid || !user.planta) return
    setError('')
    asegurarReserva(user.uid, user.planta, online)
      .then(() => setReservaLista(true))
      .catch((err) => {
        setReservaLista(false)
        if (err instanceof SinNumerosDisponiblesOfflineError) {
          setError('Sin conexión y sin números disponibles. Reconectate para seguir cargando.')
        } else if (err instanceof ProduccionCounterNoInicializadoError) {
          setError(err.message)
        } else {
          setError('No se pudo preparar la numeración. Reintentá en unos segundos.')
        }
      })
  }, [user?.uid, user?.planta, online])

  // La tarjeta armada vuelve sola a la normalidad si nadie confirma a tiempo.
  useEffect(() => {
    if (!armado) return
    const id = setTimeout(() => setArmado(null), Math.max(0, armado.hasta - Date.now()))
    return () => clearTimeout(id)
  }, [armado])

  // Los pallets recién confirmados acá salen de "pendientes" cuando el
  // servidor los devuelve en el snapshot (createdAt es serverTimestamp).
  useEffect(() => {
    setPendientes((prev) => pendientesSinConfirmar(prev, pallets))
  }, [pallets])

  const resumen = useMemo(() => resumenDelDia(pallets, pendientes, inicioDia), [pallets, pendientes, inicioDia])
  const ultimo = useMemo(() => resumen.ultimo && ({
    etiqueta: PRODUCTOS_HIELO[resumen.ultimo.productoId].etiquetaGrilla,
    hora:     resumen.ultimo.hora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }),
    codigo:   resumen.ultimo.codigo,
  }), [resumen.ultimo])

  // Respaldo sin Zebra conectada: dispara la impresión del navegador apenas
  // hay un ticket listo (QR/barcode ya generados); imprime la pestaña actual
  // con el ticket renderizado (oculto) y el resto escondido vía CSS de
  // impresión (wrapper "print:hidden").
  useEffect(() => {
    if (!ticketData) return
    const id = setTimeout(() => window.print(), 300)
    return () => clearTimeout(id)
  }, [ticketData])

  // Limpia el ticket apenas se cierra el diálogo de impresión (impreso o
  // cancelado): deja la pantalla lista para el próximo pallet.
  useEffect(() => {
    const limpiar = () => setTicketData(null)
    window.addEventListener('afterprint', limpiar)
    return () => window.removeEventListener('afterprint', limpiar)
  }, [])

  const uid = user?.uid
  const planta = user?.planta
  const nombre = user?.nombre ?? ''

  const encolar = useCallback((pallet: PalletProduccion) => {
    setPorImprimir((prev) => prev.some((p) => p.id === pallet.id) ? prev : [...prev, pallet])
  }, [])

  const imprimir = useCallback((pallet: PalletProduccion) => {
    if (impresoraConectada()) {
      imprimirZpl(armarZplPallet(pallet)).catch((err) => {
        reportError(err, { origen: 'ProduccionDashboard.zpl', palletId: pallet.id, silencioso: true })
        encolar(pallet)
      })
      return
    }
    // La tablet ya usa la Zebra pero justo no está: la etiqueta espera y sale
    // sola cuando vuelva, en vez de abrir el diálogo de Android.
    if (hayImpresoraGuardada()) { encolar(pallet); return }
    // QR y código de barras se generan fuera del toque; el ticket sale cuando están.
    generateQrDataUrl(pallet.codigo)
      .then((qrDataUrl) => setTicketData({ pallet, qrDataUrl, barcodeDataUrl: generateBarcodeDataUrl(pallet.codigo) }))
      .catch((err) => {
        reportError(err, { origen: 'ProduccionDashboard.ticket', palletId: pallet.id })
        setError(`El pallet ${pallet.codigo} quedó cargado pero no se pudo armar la etiqueta. Tocá REIMPRIMIR.`)
      })
  }, [encolar])

  // La cola sale sola, de a una, apenas la Zebra está conectada.
  const vaciando = useRef(false)
  useEffect(() => {
    if (impresora.estado !== 'conectada' || porImprimir.length === 0 || vaciando.current) return
    vaciando.current = true
    const siguiente = porImprimir[0]!
    imprimirZpl(armarZplPallet(siguiente))
      .then(() => setPorImprimir((prev) => prev.filter((p) => p.id !== siguiente.id)))
      .catch((err) => reportError(err, { origen: 'ProduccionDashboard.cola', palletId: siguiente.id, silencioso: true }))
      .finally(() => { vaciando.current = false })
  }, [impresora.estado, porImprimir])

  // La confirmación grande se va sola.
  useEffect(() => {
    if (!hecho) return
    const id = setTimeout(() => setHecho(null), 1800)
    return () => clearTimeout(id)
  }, [hecho])

  // Pantalla completa al primer toque: sin barras del navegador, más lugar para
  // las tarjetas y nada que tocar por error. Chrome solo lo permite con un gesto.
  useEffect(() => {
    const entrar = () => {
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
      document.documentElement.requestFullscreen().catch(() => { /* sin permiso: sigue igual */ })
    }
    document.addEventListener('pointerdown', entrar, { once: true })
    return () => document.removeEventListener('pointerdown', entrar)
  }, [])

  const confirmar = useCallback((productoId: ProductoHieloId) => {
    if (!uid || !planta) return
    try {
      const { pallet } = crearPallet({ plantaId: planta, productoId }, { uid, nombre }, online)
      // Optimista: el contador sube ya; el setDoc viaja en segundo plano.
      setPendientes((prev) => [...prev, pallet])
      setArmado(null)
      setError('')
      vibrar(TACTO.exito)
      const prod = PRODUCTOS_HIELO[productoId]
      setHecho({ texto: `${prod.etiquetaGrilla} cargado`, codigo: pallet.codigo, color: prod.color })
      imprimir(pallet)
    } catch (err) {
      vibrar(TACTO.error)
      setArmado(null)
      if (err instanceof ReservaAgotadaError) {
        setReservaLista(false)
        setError('Se agotaron los números reservados. Esperá a que vuelva la conexión.')
      } else {
        reportError(err, { origen: 'ProduccionDashboard.confirmar' })
        setError('No se pudo cargar el pallet. Intentá de nuevo.')
      }
    }
  }, [uid, planta, nombre, online, imprimir])

  // Un toque en la tarjeta abre la ventana (la ventana tapa la grilla, así
  // que no hay segundo toque sobre las tarjetas).
  const onTap = useCallback((productoId: ProductoHieloId) => {
    const ahora = Date.now()
    vibrar(TACTO.toque)
    setRepetido(repetidoHaceSegundos(productoId, listasRef.current, ahora))
    const numero = uid && planta ? proximoNumero(uid, planta) : null
    setCodigoProximo(numero !== null && planta ? codigoDePallet(PLANTA_INFO[planta].prefijoCodigo, numero) : null)
    setArmado(armar(productoId, ahora))
  }, [uid, planta])

  // Reimprimir el último pallet de hoy: un toque. Una etiqueta de más no rompe
  // nada; una que falta sí.
  const reimprimirUltimo = useCallback(() => {
    const codigo = resumen.ultimo?.codigo
    if (!codigo) return
    const pallet = [...pendientes, ...pallets].find((p) => p.codigo === codigo)
    if (!pallet) return
    vibrar(TACTO.cambio)
    setHecho({ texto: 'Reimprimiendo', codigo, color: '#1D9E75' })
    imprimir(pallet)
  }, [resumen.ultimo?.codigo, pendientes, pallets, imprimir])

  const salir = useCallback(async () => {
    await logoutUser()
    void navigate('/')
  }, [navigate])

  const abrirCambio = useCallback(() => { setArmado(null); setCambiando(true) }, [])

  // Si con "Cambiar operario" entró un legajo de OTRA planta, no puede cargar
  // acá (el pallet se le atribuiría a su planta): se cierra la sesión y vuelve
  // al ingreso de esta tablet, que explica el motivo.
  useEffect(() => {
    const disp = getDispositivoProduccion()
    if (!disp || !user?.planta || user.planta === disp) return
    logoutUser()
      .then(() => navigate(`/produccion-${disp}`, { replace: true }))
      .catch((err) => reportError(err, { origen: 'ProduccionDashboard', accion: 'operario de otra planta' }))
  }, [user?.planta, navigate])

  const cabeceraImpresora = useMemo(() => ({
    estado: impresora.estado, nombre: impresora.nombre, onConectar: impresora.conectar, onProbar: impresora.probar,
  }), [impresora.estado, impresora.nombre, impresora.conectar, impresora.probar])

  if (!user) return <LoadingSpinner fullScreen />

  if (!user.planta) {
    return (
      <main className="max-w-lg mx-auto p-6">
        <p className="text-red-500 text-sm">Tu cuenta no tiene una planta asignada. Contactá al administrador.</p>
      </main>
    )
  }

  const impar = PRODUCTOS_HIELO_LIST.length % 2 === 1
  const aviso = error || impresora.error

  return (
    <>
      {/* Todo entra SIN scrollear en una tablet chica en vertical (Galaxy Tab
          A11 de 8,7"): flex-1 min-h-0 + grilla de filas 1fr. */}
      <div className="h-dvh flex flex-col overflow-hidden bg-[#F8F7F2] text-gray-900 print:hidden">
        <main className="flex-1 min-h-0 flex flex-col p-3 gap-3 overflow-hidden">
          <CabeceraPlanta
            nombre={nombre.split(' ')[0] || 'operario'}
            planta={PLANTAS[user.planta].label}
            online={online}
            impresora={cabeceraImpresora}
            onCambiar={abrirCambio}
          />

          <ContadorDia total={resumen.total} cargando={loading} ultimo={ultimo} onReimprimir={reimprimirUltimo} />

          {porImprimir.length > 0 && (
            <div className="shrink-0 flex items-center gap-3 bg-amber-500/15 border-2 border-amber-500 rounded-xl px-4 py-2">
              <Printer size={26} className="text-amber-700 shrink-0" />
              <p className="flex-1 text-amber-900 text-base font-bold leading-snug">
                {porImprimir.length === 1 ? '1 etiqueta espera' : `${porImprimir.length} etiquetas esperan`} a la impresora
                <span className="block text-sm font-semibold">Salen solas cuando se conecte. Podés seguir cargando.</span>
              </p>
              {impresora.estado !== 'conectada' && impresora.estado !== 'imprimiendo' && (
                <button type="button" onClick={() => void impresora.conectar()}
                  className="h-11 px-4 rounded-xl bg-amber-600 text-white text-base font-bold touch-manipulation active:opacity-90">
                  Conectar
                </button>
              )}
            </div>
          )}

          {aviso && (
            <div className="shrink-0 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5">
              <p className="text-red-600 text-sm font-medium leading-snug">{aviso}</p>
            </div>
          )}

          <div
            className="flex-1 min-h-0 grid grid-cols-2 gap-3"
            style={{ gridTemplateRows: `repeat(${Math.ceil(PRODUCTOS_HIELO_LIST.length / 2)}, minmax(0, 1fr))` }}
          >
            {PRODUCTOS_HIELO_LIST.map((p, i) => {
              return (
                <TileProducto
                  key={p.id}
                  producto={p}
                  hoy={resumen.porProducto[p.id] ?? 0}
                  seleccionada={armado?.productoId === p.id}
                  disabled={!reservaLista}
                  spanDos={impar && i === PRODUCTOS_HIELO_LIST.length - 1}
                  onTap={onTap}
                />
              )
            })}
          </div>
        </main>
      </div>

      {armado && (
        <ConfirmarPallet
          producto={PRODUCTOS_HIELO[armado.productoId]}
          codigoProximo={codigoProximo}
          abiertaDesde={armado.desde}
          repetidoHaceSeg={repetido}
          onConfirmar={() => confirmar(armado.productoId)}
          onCancelar={() => setArmado(null)}
        />
      )}

      {cambiando && (
        <CambiarOperario
          onListo={() => { setCambiando(false); vibrar(TACTO.exito) }}
          onCerrar={() => setCambiando(false)}
          onSalir={() => void salir()}
        />
      )}

      {/* Confirmación grande: se ve de reojo, no tapa ni frena el próximo toque. */}
      {hecho && (
        <div className="fixed inset-x-0 top-3 z-50 flex justify-center pointer-events-none print:hidden" role="status" aria-live="polite">
          <div className="flex items-center gap-4 rounded-2xl bg-white shadow-2xl px-7 py-4 border-[5px]" style={{ borderColor: hecho.color }}>
            <CheckCircle2 size={44} style={{ color: hecho.color }} />
            <div className="leading-tight">
              <p className="text-[clamp(1.5rem,3.4vh,2.25rem)] font-black text-gray-900">{hecho.texto}</p>
              <p className="text-lg font-bold text-secundario tabular-nums">{hecho.codigo}</p>
            </div>
          </div>
        </div>
      )}

      {/* Oculto en pantalla, es lo único visible al imprimir (ver print:hidden arriba) */}
      {ticketData && (
        <div className="hidden print:block produccion-ticket-page">
          <ProduccionTicket pallet={ticketData.pallet} qrDataUrl={ticketData.qrDataUrl} barcodeDataUrl={ticketData.barcodeDataUrl} />
        </div>
      )}
    </>
  )
}
