import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, LayoutDashboard, Snowflake, Briefcase, Shield } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useSistema } from '../../context/SistemaContext'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { homesDeUsuario, ROLE_HOME, SISTEMA_LABELS, SISTEMA_DESCRIPCIONES, Sistema } from '../../utils/sistemas'

const ICONOS: Record<Sistema, typeof LayoutDashboard> = {
  logistica: LayoutDashboard,
  heladeras: Snowflake,
  comercial: Briefcase,
  admin:     Shield,
}

// Picker de dominio (Logística / Heladeras / Comercial / Administración).
// Es el home del super_admin y adonde vuelve quien toca "cambiar de dominio";
// el resto de los roles entra directo a su home y cambia de dominio desde la
// cabecera del shell (DominioLayout).
export default function SeleccionSistemaPage() {
  const { user } = useAuth()
  const { sistemasDisponibles, sistemaActual, elegirSistema } = useSistema()
  const navigate = useNavigate()

  // Memoizado: es dependencia del efecto de redirección (un objeto nuevo por render lo dispararía siempre).
  const homes = useMemo(() => (user ? homesDeUsuario(user) : undefined), [user])

  // Ya había una elección persistida → saltear el picker. Con un solo dominio
  // (`homes` undefined) esta pantalla no aplica: a su home.
  useEffect(() => {
    if (!user) return
    if (!homes) { navigate(ROLE_HOME[user.rol] ?? '/', { replace: true }); return }
    if (sistemaActual && homes[sistemaActual]) navigate(homes[sistemaActual]!, { replace: true })
  }, [user, sistemaActual, homes, navigate])

  if (!user || sistemaActual || !homes) return <LoadingSpinner fullScreen />

  const handlePick = (s: Sistema) => {
    elegirSistema(s)
    navigate(homes[s] ?? '/', { replace: true })
  }

  return (
    <div className="min-h-screen min-h-dvh bg-[#F8F7F2] flex flex-col">
      <div
        className="flex justify-center items-end pt-10 pb-0"
        style={{ background: 'linear-gradient(180deg, #1a6b52 0%, #1D9E75 100%)' }}
      >
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      <div className="bg-white flex flex-col items-center pt-12 pb-5 shadow-sm">
        <img src="/logo-rolito.png" alt="Rolito" width={235} height={80} className="h-20 w-auto object-contain" />
      </div>

      <div className="flex-1 flex flex-col items-center px-4 pt-7 pb-8 gap-4">
        <p className="text-gray-500 text-sm text-center">¿Por dónde querés entrar?</p>

        <div className="w-full max-w-sm space-y-3">
          {sistemasDisponibles.map((s) => {
            const Icon = ICONOS[s]
            return (
              <button
                key={s}
                onClick={() => handlePick(s)}
                className="w-full flex items-center gap-4 bg-white rounded-2xl border border-[#D3D1C7] shadow-sm hover:border-accent hover:shadow-md active:scale-[0.98] transition-all p-4 group text-left"
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-gray-100 text-gray-500 group-hover:bg-accent/10 group-hover:text-accent transition-colors">
                  <Icon size={20} strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold text-gray-900 group-hover:text-accent transition-colors leading-tight">
                    {SISTEMA_LABELS[s]}
                  </h2>
                  <p className="text-gray-500 text-xs mt-0.5 leading-snug">{SISTEMA_DESCRIPCIONES[s]}</p>
                </div>
                <ChevronRight size={20} className="shrink-0 transition-all group-hover:translate-x-0.5 text-gray-300 group-hover:text-accent" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
