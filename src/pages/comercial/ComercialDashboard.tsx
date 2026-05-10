import { Link } from 'react-router-dom'
import Navbar from '../../components/layout/Navbar'
import { useAuth } from '../../context/AuthContext'

export default function ComercialDashboard() {
  const { user } = useAuth()

  return (
    <>
      <Navbar />
      <main className="max-w-2xl mx-auto p-4 space-y-6 pb-10">
        <div>
          <h1 className="text-2xl font-bold">
            Hola, {user?.nombre?.split(' ')[0] ?? 'Comercial'} 👋
          </h1>
          <p className="text-muted text-sm mt-1">Panel comercial</p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Link
            to="/usuarios"
            className="bg-surface border border-border rounded-xl p-5 hover:border-accent transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">👥</span>
              <div>
                <p className="font-semibold group-hover:text-accent transition-colors">
                  Gestión de usuarios
                </p>
                <p className="text-muted text-sm mt-0.5">
                  Aprobar nuevos clientes, gestionar roles y estados
                </p>
              </div>
            </div>
          </Link>
        </div>
      </main>
    </>
  )
}
