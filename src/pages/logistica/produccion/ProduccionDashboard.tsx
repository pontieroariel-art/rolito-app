import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ProduccionTicket from '@/components/produccion/ProduccionTicket'
import TileProducto from '@/components/produccion/carga/TileProducto'
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
import { impresoraConectada, imprimirZpl } from '@/services/zebraBleService'
import { reportError } from '@/services/observability'
import { generateQrDataUrl } from '@/utils/qr'
import { generateBarcodeDataUrl } from '@/utils/barcode'
import { PRODUCTOS_HIELO, PRODUCTOS_HIELO_LIST } from '@/utils/produccionCatalogo'
import { PLANTA_INFO } from '@/utils/constants'
import { accionDelToque, armar, codigoDePallet, pendientesSinConfirmar, resumenDelDia, type Armado } from '@/utils/cargaPallets'
import { armarZplPallet } from '@/utils/zplPallet'
import { TACTO, vibrar } from '@/utils/tacto'
import { PLANTAS, ProductoHieloId, PalletProduccion } from '@/types'

interface TicketData { pallet: PalletProduccion; qrDataUrl: string; barcodeDataUrl: string }

// Carga de pallets de producción desde la tablet de planta (rehecha el
// 2026-09-14 sobre la maqueta aprobada por Ariel). Reglas de la pantalla:
// - un toque arma la tarjeta (muestra CONFIRMAR E IMPRIMIR adentro), el
//   segundo toque en la misma tarjeta confirma; nada de modales ni barras;
// - la tablet es vieja: todo responde en pointerdown, las tarjetas y el
//   contador están en memo, el stream trae solo los pallets de hoy, y el
//   contador sube en el acto (el pallet se escribe en segundo plano);
// - la impresión sale al confirmar, fuera del camino del toque. Con la Zebra
//   conectada por Bluetooth va en ZPL directo (sin diálogo); si no, por el
//   diálogo de impresión del navegador como siempre. Si algo falla al
//   imprimir, el pallet ya existe y se reimprime desde el listado.
export default function ProduccionDashboard() {
  const { user } = useAuth()
  const online = useOnline()
  const navigate = useNavigate()
  const dia = useDiaActual()
  const inicioDia = useMemo(() => new Date(`${dia}T00:00:00`), [dia])
  const { pallets, loading } = useProduccionPalletsHoy(user?.planta, dia)
  const impresora = useImpresoraZebra()

  const [reservaLista, setReservaLista] = useState(false)
  const [error, setError] = useState('')
  const [armado, setArmado] = useState<Armado | null>(null)
  const [codigoProximo, setCodigoProximo] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<PalletProduccion[]>([])
  const [ticketData, setTicketData] = useState<TicketData | null>(null)
  // Espejo del armado para que `onTap` sea estable (las tarjetas están en memo).
  const armadoRef = useRef<Armado | null>(null)
  armadoRef.current = armado

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

  const imprimir = useCallback((pallet: PalletProduccion) => {
    if (impresoraConectada()) {
      imprimirZpl(armarZplPallet(pallet)).catch((err) => {
        reportError(err, { origen: 'ProduccionDashboard.zpl', palletId: pallet.id })
        setError(`El pallet ${pallet.codigo} quedó cargado pero la impresora no respondió. Volvé a conectarla y reimprimilo desde el listado.`)
      })
      return
    }
    // QR y código de barras se generan fuera del toque; el ticket sale cuando están.
    generateQrDataUrl(pallet.codigo)
      .then((qrDataUrl) => setTicketData({ pallet, qrDataUrl, barcodeDataUrl: generateBarcodeDataUrl(pallet.codigo) }))
      .catch((err) => {
        reportError(err, { origen: 'ProduccionDashboard.ticket', palletId: pallet.id })
        setError(`El pallet ${pallet.codigo} quedó cargado pero no se pudo armar el ticket. Reimprimilo desde el listado.`)
      })
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

  const onTap = useCallback((productoId: ProductoHieloId) => {
    const ahora = Date.now()
    const accion = accionDelToque(armadoRef.current, productoId, ahora)
    if (accion === 'ignorar') return
    if (accion === 'confirmar') { confirmar(productoId); return }
    vibrar(TACTO.toque)
    const numero = uid && planta ? proximoNumero(uid, planta) : null
    setCodigoProximo(numero !== null && planta ? codigoDePallet(PLANTA_INFO[planta].prefijoCodigo, numero) : null)
    setArmado(armar(productoId, ahora))
  }, [uid, planta, confirmar])

  const salir = useCallback(async () => {
    await logoutUser()
    void navigate('/')
  }, [navigate])

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
            onSalir={salir}
          />

          <ContadorDia total={resumen.total} cargando={loading} ultimo={ultimo} />

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
              const esArmado = armado?.productoId === p.id
              return (
                <TileProducto
                  key={p.id}
                  producto={p}
                  hoy={resumen.porProducto[p.id] ?? 0}
                  armado={esArmado}
                  codigoProximo={esArmado ? codigoProximo : null}
                  disabled={!reservaLista}
                  spanDos={impar && i === PRODUCTOS_HIELO_LIST.length - 1}
                  onTap={onTap}
                />
              )
            })}
          </div>
        </main>
      </div>

      {/* Oculto en pantalla, es lo único visible al imprimir (ver print:hidden arriba) */}
      {ticketData && (
        <div className="hidden print:block produccion-ticket-page">
          <ProduccionTicket pallet={ticketData.pallet} qrDataUrl={ticketData.qrDataUrl} barcodeDataUrl={ticketData.barcodeDataUrl} />
        </div>
      )}
    </>
  )
}
