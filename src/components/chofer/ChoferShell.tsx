import { Link, Outlet, useLocation } from 'react-router-dom'
import { GpsChoferProvider } from '@/hooks/useGpsChofer'
import { useAuth } from '@/context/AuthContext'
import ChoferHeader from '@/components/chofer/ChoferHeader'
import { esAyudante, rutaSoloDelChofer } from '@/utils/ayudante'

// Contenedor de las rutas /chofer/* (2026-09-26, auditoría del chofer, A6): lo
// que tiene que seguir vivo mientras el chofer va de una pantalla a otra, como el
// GPS, se monta acá una sola vez en vez de en cada pantalla.
export default function ChoferShell() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  // El ayudante solo acompaña (C1): vender, cobrar, facturas y entregar son del
  // chofer titular. Si llega por un link o una URL vieja, se lo dice en vez de
  // dejarlo cargar algo que las reglas le van a rechazar en la calle.
  const bloqueada = esAyudante(user) && rutaSoloDelChofer(pathname)
  return (
    <GpsChoferProvider>
      {bloqueada ? <SoloDelChofer /> : <Outlet />}
    </GpsChoferProvider>
  )
}

function SoloDelChofer() {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] text-gray-900">
      <ChoferHeader />
      <main className="max-w-2xl mx-auto p-4">
        <div className="bg-white border border-[#D3D1C7] rounded-2xl p-5 space-y-3 shadow-sm text-center">
          <p className="text-lg font-bold">Esto lo hace el chofer</p>
          <p className="text-secundario text-sm">
            Como ayudante ves tu turno del día y podés buscar clientes. Vender, cobrar, entregar y la ruta los lleva el chofer en su teléfono.
          </p>
          <Link to="/chofer" className="flex h-12 items-center justify-center rounded-xl bg-accent text-white font-bold">
            Volver al inicio
          </Link>
        </div>
      </main>
    </div>
  )
}
