import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { subscribeRemitosCargaDelDia } from '../../services/remitoCargaService'
import { subscribeVentanillaDelDia } from '../../services/ventaVentanillaService'
import { DARSENAS_POR_PLANTA, PLANTAS, RemitoCarga, VentaVentanilla } from '../../types'

// Tablero de TV del muelle (/muelle/tv): pantalla grande de solo lectura que
// muestra en vivo qué se carga en cada dársena, la cola en espera y los
// retiros de ventanilla pendientes. Pensada para un TV con Chrome en kiosco,
// logueado UNA vez con el usuario de muelle — se actualiza sola (onSnapshot),
// sin interacción. Tipografía gigante y fondo oscuro para leerse desde la
// punta del galpón. Wake-lock para que el aparato no apague la pantalla.
export default function MuelleTvPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const darsenas = DARSENAS_POR_PLANTA[plantaId]

  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  const [ventanillas, setVentanillas] = useState<VentaVentanilla[]>([])
  const [ahora, setAhora] = useState(new Date())

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, new Date(), setRemitos), [plantaId])
  useEffect(() => subscribeVentanillaDelDia(plantaId, new Date(), setVentanillas), [plantaId])

  // Reloj + re-render periódico (también refresca el rango del día pasada la
  // medianoche en el próximo remount; suficiente para un tablero de muelle).
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Que el TV no apague la pantalla (si el navegador lo soporta).
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const pedir = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen')
      } catch { /* sin soporte o sin permiso: se configura en el aparato */ }
    }
    pedir()
    const rearmar = () => { if (document.visibilityState === 'visible') pedir() }
    document.addEventListener('visibilitychange', rearmar)
    return () => {
      document.removeEventListener('visibilitychange', rearmar)
      lock?.release().catch(() => { /* ya liberado */ })
    }
  }, [])

  const enEspera  = remitos.filter((r) => r.estado === 'emitido' && !r.darsena)
  const porDarsena = (n: number) => remitos.find((r) => r.estado === 'emitido' && r.darsena === n)
  const listos     = remitos.filter((r) => r.estado === 'entregado')
  const retiros    = ventanillas.filter((v) => v.estado === 'pendiente_entrega')

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src="/logo-rolito.png" alt="Rolito" className="h-10 w-auto brightness-0 invert" />
          <p className="text-2xl font-bold text-gray-300">Muelle · {PLANTAS[plantaId].label}</p>
        </div>
        <p className="text-4xl font-black tabular-nums">
          {ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Dársenas */}
      <div className="grid gap-4 flex-1" style={{ gridTemplateColumns: `repeat(${darsenas}, minmax(0, 1fr))` }}>
        {Array.from({ length: darsenas }, (_, i) => i + 1).map((n) => {
          const r = porDarsena(n)
          return (
            <div key={n} className={`rounded-2xl border-4 p-4 flex flex-col ${
              r ? 'border-amber-400 bg-amber-400/10' : 'border-gray-800 bg-gray-900'
            }`}>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-5xl font-black text-gray-500">{n}</p>
                {r && <p className="text-xl font-bold text-amber-300 animate-pulse">CARGANDO</p>}
              </div>
              {r ? (
                <div className="space-y-2 flex-1">
                  <p className="text-3xl font-black leading-tight">{r.camionLabel.split('·')[0].trim()}</p>
                  <p className="text-lg text-gray-300">{r.choferNombre}</p>
                  <div className="space-y-1 pt-1">
                    {r.items.map((i) => (
                      <div key={i.productoId} className="flex justify-between gap-2 text-xl leading-tight">
                        <span className="text-gray-200">{i.nombre}</span>
                        <span className="font-black tabular-nums">{i.cantidad}</span>
                      </div>
                    ))}
                  </div>
                  {r.palletsCarga > 0 && (
                    <p className="text-lg text-amber-200 font-bold pt-1">{r.palletsCarga} pallets</p>
                  )}
                </div>
              ) : (
                <p className="text-2xl text-gray-700 font-bold flex-1 flex items-center justify-center">LIBRE</p>
              )}
            </div>
          )
        })}
      </div>

      {/* Fila inferior: espera / listos / ventanilla */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl bg-gray-900 border-2 border-gray-800 p-4">
          <p className="text-xl font-bold text-gray-400 mb-2">EN ESPERA ({enEspera.length})</p>
          <div className="space-y-1">
            {enEspera.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {enEspera.slice(0, 4).map((r) => (
              <p key={r.id} className="text-2xl font-bold leading-tight">
                {r.camionLabel.split('·')[0].trim()} <span className="text-gray-400 text-lg font-medium">{r.choferNombre}</span>
              </p>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-gray-900 border-2 border-green-900 p-4">
          <p className="text-xl font-bold text-green-400 mb-2">LISTOS PARA SALIR ({listos.length})</p>
          <div className="space-y-1">
            {listos.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {listos.slice(0, 4).map((r) => (
              <p key={r.id} className="text-2xl font-bold leading-tight text-green-200">
                {r.camionLabel.split('·')[0].trim()} <span className="text-gray-400 text-lg font-medium">{r.choferNombre}</span>
              </p>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-gray-900 border-2 border-sky-900 p-4">
          <p className="text-xl font-bold text-sky-400 mb-2">VENTANILLA ({retiros.length})</p>
          <div className="space-y-1">
            {retiros.length === 0 && <p className="text-gray-700 text-lg">—</p>}
            {retiros.slice(0, 4).map((v) => (
              <p key={v.id} className="text-2xl font-bold leading-tight text-sky-200 truncate">
                {v.clienteNombre} <span className="text-gray-400 text-lg font-medium">{v.items.reduce((s, i) => s + i.cantidad, 0)} bultos</span>
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
