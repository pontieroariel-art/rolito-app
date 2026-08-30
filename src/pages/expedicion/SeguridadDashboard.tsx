import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldCheck, Truck } from 'lucide-react'
import Navbar from '../../components/layout/Navbar'
import Button from '../../components/ui/Button'
import { useAuth } from '../../context/AuthContext'
import { useFechaDelDia } from '../../hooks/useDiaActual'
import { subscribeRemitosCargaDelDia, marcarSalidaRemito } from '../../services/remitoCargaService'
import { subscribeVentanillaDelDia, marcarSalidaVentanilla } from '../../services/ventaVentanillaService'
import { PLANTAS, RemitoCarga, VentaVentanilla } from '../../types'

const horaDe = (t: { toDate: () => Date }) =>
  t.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

// Pantalla del rol seguridad (portón de la planta): controla lo que sale
// cargado — camiones con remito de carga ya entregado por muelle, y terceros
// de ventanilla que retiran con vehículo. Tocar "Salió" estampa quién
// controló y a qué hora. Solo salida — el regreso no se controla acá.
export default function SeguridadDashboard() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()

  const [remitos,     setRemitos]     = useState<RemitoCarga[]>([])
  const [ventanillas, setVentanillas] = useState<VentaVentanilla[]>([])
  const [error, setError] = useState('')

  useEffect(() => subscribeRemitosCargaDelDia(plantaId, fecha, setRemitos), [plantaId, fecha])
  useEffect(() => subscribeVentanillaDelDia(plantaId, fecha, setVentanillas), [plantaId, fecha])

  const camionesPorSalir  = remitos.filter((r) => r.estado === 'entregado')
  const camionesSalidos   = remitos.filter((r) => r.estado === 'salido')
  const retirosPorSalir   = ventanillas.filter((v) => v.estado === 'entregado' && !v.salida)

  const liberarCamion = async (r: RemitoCarga) => {
    if (!user) return
    setError('')
    try {
      await marcarSalidaRemito(r, { uid: user.uid, nombre: user.nombre })
    } catch (err) {
      console.error('[seguridad] error al liberar camión:', err)
      setError('No se pudo registrar la salida. Intentá de nuevo.')
    }
  }

  const liberarRetiro = async (v: VentaVentanilla) => {
    if (!user) return
    setError('')
    try {
      await marcarSalidaVentanilla(v, { uid: user.uid, nombre: user.nombre })
    } catch (err) {
      console.error('[seguridad] error al liberar retiro:', err)
      setError('No se pudo registrar la salida. Intentá de nuevo.')
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F7F2]">
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck size={24} className="text-accent" /> Control de salidas
          </h1>
          <p className="text-gray-500 text-sm">{PLANTAS[plantaId].label}</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}

        {/* ── Camiones por salir ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Truck size={18} className="text-accent" /> Camiones por salir
          </h2>
          {camionesPorSalir.length === 0 && (
            <p className="text-gray-400 text-sm">No hay camiones cargados esperando salir.</p>
          )}
          {camionesPorSalir.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{r.camionLabel}</p>
                <p className="text-xs text-gray-500">{r.codigo} · {r.choferNombre}</p>
              </div>
              <div className="text-xs text-gray-600 space-y-0.5">
                {r.items.map((i) => (
                  <div key={i.productoId} className="flex justify-between">
                    <span>{i.nombre}</span>
                    <span className="font-medium">{i.cantidad}</span>
                  </div>
                ))}
                {r.palletsCarga > 0 && (
                  <div className="flex justify-between text-gray-500">
                    <span>Pallets de carga</span><span className="font-medium">{r.palletsCarga}</span>
                  </div>
                )}
              </div>
              <Button onClick={() => liberarCamion(r)} className="w-full">Salió ✓</Button>
            </div>
          ))}
        </section>

        {/* ── Retiros de ventanilla por salir ── */}
        {retirosPorSalir.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-gray-800">Retiros de ventanilla</h2>
            {retirosPorSalir.map((v) => (
              <div key={v.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">{v.clienteNombre}</p>
                  <p className="text-xs text-gray-500">{v.items.reduce((s, i) => s + i.cantidad, 0)} bultos</p>
                </div>
                <div className="text-xs text-gray-600 space-y-0.5">
                  {v.items.map((i) => (
                    <div key={i.productoId} className="flex justify-between">
                      <span>{i.nombre}</span><span className="font-medium">{i.cantidad}</span>
                    </div>
                  ))}
                </div>
                <Button onClick={() => liberarRetiro(v)} variant="outline" className="w-full">Salió ✓</Button>
              </div>
            ))}
          </section>
        )}

        {/* ── Salidas de hoy ── */}
        <section className="space-y-2">
          <h2 className="font-semibold text-gray-800">Salidas de hoy</h2>
          {camionesSalidos.length === 0 && (
            <p className="text-gray-400 text-sm">Todavía no salió ningún camión hoy.</p>
          )}
          {camionesSalidos.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
              <CheckCircle2 size={16} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{r.camionLabel} · {r.choferNombre}</p>
                <p className="text-xs text-gray-500">
                  {r.codigo}{r.salida ? ` · salió ${horaDe(r.salida.hora)} · controló ${r.salida.nombre}` : ''}
                </p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
