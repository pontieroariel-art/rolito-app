import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeft, CircleHelp, LogOut } from 'lucide-react'
import { waitForPendingWrites } from 'firebase/firestore'
import { useAuth } from '../../context/AuthContext'
import { logoutUser } from '../../services/authService'
import { db } from '@/services/firebase'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'

// ¿Quedó algo sin subir? (2026-09-26, auditoría del chofer, M5). Se le da un
// segundo y medio a Firestore para subir lo pendiente; si no terminó (sin señal),
// hay escrituras encoladas: ventas, cobranzas o entregas que caja todavía no ve.
async function todoSubido(): Promise<boolean> {
  return Promise.race([
    waitForPendingWrites(db).then(() => true),
    new Promise<boolean>((res) => setTimeout(() => res(false), 1500)),
  ])
}

// Header compacto del chofer (reemplaza al Navbar genérico). En Inicio muestra
// el saludo + camión + salir; en las tareas (Ruta, etc.) muestra una flecha
// para volver al Inicio. Alto 56px más la zona segura de arriba (en iPhone
// instalado como app la barra de estado tapaba el saludo y el botón de salir);
// el mapa descuenta los mismos 56px + env(safe-area-inset-top).
export default function ChoferHeader({ title, back = false }: { title?: string; back?: boolean }) {
  const { user } = useAuth()
  // Ayuda (2026-09-26): el manual del chofer a un toque desde cualquier pantalla.
  const enManual = useLocation().pathname === '/chofer/manual'
  const [chequeando, setChequeando] = useState(false)
  const [pendiente, setPendiente] = useState(false)
  // Salir con ventas o cobranzas sin subir las dejaba atrapadas en el teléfono
  // hasta volver a entrar en ese mismo teléfono, y caja no las veía (M5).
  const salir = async () => {
    setChequeando(true)
    try {
      if (await todoSubido()) void logoutUser()
      else setPendiente(true)
    } finally {
      setChequeando(false)
    }
  }
  return (
    <header className="min-h-14 pt-[env(safe-area-inset-top)] bg-white border-b border-[#D3D1C7] flex items-center gap-3 px-3 sticky top-0 z-30">
      {back ? (
        <Link to="/chofer" aria-label="Volver al inicio"
          className="w-10 h-10 rounded-xl border border-[#D3D1C7] flex items-center justify-center active:scale-90 transition-transform">
          <ArrowLeft size={20} />
        </Link>
      ) : (
        <img src="/isotipo-rolito.webp" alt="Rolito" className="w-9 h-9 rounded-lg object-contain" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-tight truncate">
          {title ?? `Hola, ${user?.nombre?.split(' ')[0] ?? 'chofer'}`}
        </p>
        {!back && user?.camionPatente && (
          <p className="text-xs text-secundario leading-tight">Camión {user.camionPatente}</p>
        )}
      </div>
      {!enManual && (
        <Link to="/chofer/manual" aria-label="Manual del chofer" title="Manual del chofer"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-secundario hover:text-gray-700 active:scale-90 transition-transform">
          <CircleHelp size={21} />
        </Link>
      )}
      <button onClick={() => { void salir() }} disabled={chequeando} aria-label="Cerrar sesión"
        className="w-10 h-10 rounded-xl flex items-center justify-center text-secundario hover:text-gray-700 active:scale-90 transition-transform">
        <LogOut size={20} />
      </button>
      <Modal open={pendiente} onClose={() => setPendiente(false)} title="Tenés cosas sin subir" variant="light">
        <p className="text-sm text-gray-700">Hay ventas, cobranzas o entregas que todavía no llegaron a la oficina, seguramente por falta de señal.</p>
        <p className="text-sm text-gray-700 mt-2">Si salís ahora, quedan guardadas en este teléfono y se suben recién cuando vuelvas a entrar acá. Caja no las va a ver hasta entonces.</p>
        <div className="flex flex-col gap-2 mt-5">
          <Button onClick={() => setPendiente(false)} className="w-full h-12">Quedarme hasta que suban</Button>
          <Button variant="outline" onClick={() => { setPendiente(false); void logoutUser() }} className="w-full h-12">Salir igual</Button>
        </div>
      </Modal>
    </header>
  )
}
