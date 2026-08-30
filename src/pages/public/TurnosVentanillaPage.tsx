import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { Bell, CheckCircle2 } from 'lucide-react'
import { auth, db } from '../../services/firebase'
import { PLANTAS, PlantaId } from '../../types'

interface TurnoPublico { n: number; estado: string; darsena?: number }

// Página PÚBLICA de turnos de ventanilla — la abre el QR impreso en el
// comprobante de caja (/turnos/{planta}?turno=N). Sin login: usa una sesión
// anónima de Firebase solo para leer turnosPublicos/{plantaId}, un documento
// sanitizado (números de turno + estado + dársena, nada más — lo publica una
// Cloud Function). El papel es la identificación, como el número de la
// fiambrería: el QR ya trae el turno adentro.
export default function TurnosVentanillaPage() {
  const { plantaId: plantaParam } = useParams()
  const [params] = useSearchParams()
  const miTurno = parseInt(params.get('turno') ?? '', 10) || null
  const plantaId: PlantaId = plantaParam === 'merlo' ? 'merlo' : 'torcuato'

  const [turnos, setTurnos] = useState<TurnoPublico[] | null>(null)
  const [error,  setError]  = useState(false)
  const [avisar, setAvisar] = useState(false)
  const avisadoRef = useRef(false)

  // Sesión anónima (si no hay ninguna) + suscripción al tablero público.
  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelado = false
    const conectar = async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth)
        if (cancelado) return
        unsub = onSnapshot(
          doc(db, 'turnosPublicos', plantaId),
          (snap) => setTurnos((snap.data()?.turnos as TurnoPublico[]) ?? []),
          () => setError(true),
        )
      } catch {
        setError(true)
      }
    }
    conectar()
    return () => { cancelado = true; unsub?.() }
  }, [plantaId])

  const mio = useMemo(
    () => turnos?.find((t) => t.n === miTurno) ?? null,
    [turnos, miTurno],
  )
  const adelante = useMemo(
    () => (turnos && miTurno)
      ? turnos.filter((t) => t.n < miTurno && ['en_espera', 'preparado', 'llamado'].includes(t.estado)).length
      : 0,
    [turnos, miTurno],
  )
  const enDarsena = turnos?.filter((t) => t.estado === 'llamado' && t.darsena) ?? []
  const proximos  = turnos?.filter((t) => ['en_espera', 'preparado'].includes(t.estado)).slice(0, 6) ?? []

  // Aviso local cuando pasa a "llamado" (si el cliente lo activó y la página
  // está abierta). Vibración donde el navegador la soporte (Android).
  useEffect(() => {
    if (!avisar || !mio || mio.estado !== 'llamado' || avisadoRef.current) return
    avisadoRef.current = true
    try { navigator.vibrate?.([300, 150, 300, 150, 300]) } catch { /* sin soporte */ }
    try {
      if (Notification.permission === 'granted') {
        new Notification('¡Es tu turno!', {
          body: `Pasá a la dársena ${mio.darsena} con tu comprobante.`,
          icon: '/isotipo-rolito.png',
        })
      }
    } catch { /* sin soporte */ }
  }, [avisar, mio])

  const activarAviso = async () => {
    try {
      const p = await Notification.requestPermission()
      setAvisar(p === 'granted')
      if (p !== 'granted') setAvisar(true)   // sin permiso igual vibra/resalta en pantalla
    } catch {
      setAvisar(true)
    }
  }

  const estadoPropio = () => {
    if (!miTurno) return null
    if (!mio) {
      return (
        <div className="bg-white rounded-2xl border border-[#D3D1C7] p-6 text-center">
          <p className="text-lg font-semibold text-gray-800">Turno {miTurno} no encontrado</p>
          <p className="text-sm text-gray-500 mt-1">Puede ser de otro día — consultá en caja con tu comprobante.</p>
        </div>
      )
    }
    switch (mio.estado) {
      case 'llamado':
        return (
          <div className="bg-green-600 rounded-2xl p-8 text-center text-white animate-pulse">
            <p className="text-xl font-bold">¡ES TU TURNO!</p>
            <p className="text-6xl font-black my-2">DÁRSENA {mio.darsena}</p>
            <p className="text-sm opacity-90">Acercate con el vehículo y tu comprobante.</p>
          </div>
        )
      case 'preparado':
        return (
          <div className="bg-amber-100 border-2 border-amber-400 rounded-2xl p-6 text-center">
            <p className="text-4xl font-black text-gray-900">Turno {mio.n}</p>
            <p className="text-lg font-bold text-amber-700 mt-1">¡Tu pedido ya está listo — preparate!</p>
            {adelante > 0 && <p className="text-sm text-gray-600 mt-1">{adelante} adelante tuyo</p>}
          </div>
        )
      case 'ausente':
        return (
          <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-6 text-center">
            <p className="text-4xl font-black text-gray-900">Turno {mio.n}</p>
            <p className="text-lg font-bold text-red-600 mt-1">Te llamamos y no estabas</p>
            <p className="text-sm text-gray-600 mt-1">Acercate a muelle con tu comprobante y te atendemos.</p>
          </div>
        )
      case 'entregado':
        return (
          <div className="bg-white rounded-2xl border border-[#D3D1C7] p-6 text-center">
            <CheckCircle2 size={40} className="text-accent mx-auto mb-2" />
            <p className="text-lg font-bold text-gray-800">Turno {mio.n} — ¡Entregado!</p>
            <p className="text-sm text-gray-500 mt-1">Gracias por tu compra.</p>
          </div>
        )
      default:
        return (
          <div className="bg-white rounded-2xl border border-[#D3D1C7] p-6 text-center">
            <p className="text-6xl font-black text-gray-900">Turno {mio.n}</p>
            <p className="text-xl font-semibold text-gray-700 mt-2">
              {adelante === 0 ? 'Sos el próximo' : `${adelante} adelante tuyo`}
            </p>
          </div>
        )
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <div className="bg-white border-b border-[#D3D1C7] px-4 py-3 flex items-center justify-between">
        <img src="/logo-rolito.png" alt="Rolito" className="h-8 w-auto" />
        <p className="text-sm text-gray-500">{PLANTAS[plantaId].label}</p>
      </div>

      <main className="max-w-md mx-auto p-4 space-y-4 pb-10">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">No se pudo conectar. Revisá tu señal y recargá la página.</p>
          </div>
        )}
        {!turnos && !error && <p className="text-center text-gray-400 pt-8">Cargando…</p>}

        {turnos && (
          <>
            {estadoPropio()}

            {miTurno && mio && !['llamado', 'entregado'].includes(mio.estado) && !avisar && (
              <button
                onClick={activarAviso}
                className="w-full flex items-center justify-center gap-2 bg-accent text-white rounded-xl py-3 font-semibold active:scale-[0.98]"
              >
                <Bell size={18} /> Avisame cuando sea mi turno
              </button>
            )}
            {avisar && mio && !['llamado', 'entregado'].includes(mio.estado) && (
              <p className="text-center text-xs text-gray-500">
                🔔 Aviso activado — dejá esta página abierta para recibirlo.
              </p>
            )}

            <section className="bg-white rounded-2xl border border-[#D3D1C7] p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">En dársena ahora</p>
              {enDarsena.length === 0 && <p className="text-gray-400 text-sm">—</p>}
              <div className="flex flex-wrap gap-2">
                {enDarsena.map((t) => (
                  <span key={t.n} className="bg-green-100 text-green-800 border border-green-300 rounded-lg px-3 py-1.5 text-sm font-bold">
                    T-{t.n} → D{t.darsena}
                  </span>
                ))}
              </div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-4 mb-2">Próximos</p>
              {proximos.length === 0 && <p className="text-gray-400 text-sm">—</p>}
              <div className="flex flex-wrap gap-2">
                {proximos.map((t) => (
                  <span
                    key={t.n}
                    className={`rounded-lg px-3 py-1.5 text-sm font-bold border ${
                      t.n === miTurno
                        ? 'bg-accent text-white border-accent'
                        : 'bg-gray-100 text-gray-700 border-gray-200'
                    }`}
                  >
                    T-{t.n}
                  </span>
                ))}
              </div>
            </section>

            <p className="text-center text-xs text-gray-400">
              Esta página se actualiza sola. Tené el comprobante a mano.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
