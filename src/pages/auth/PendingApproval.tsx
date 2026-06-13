import { useNavigate } from 'react-router-dom'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { logoutUser } from '../../services/authService'

export default function PendingApproval() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logoutUser()
    navigate('/login')
  }

  return (
    <AuthLayout title="Cuenta en verificación">
      <div className="text-center space-y-4">
        <div className="text-6xl py-2">⏳</div>
        <p className="text-gray-900 text-sm leading-relaxed">
          Tu cuenta está siendo verificada. Te avisaremos cuando esté activa.
        </p>
        <p className="text-gray-500 text-xs">
          Si tenés alguna consulta, contactá a nuestro equipo.
        </p>
        <Button variant="outline" onClick={handleLogout} className="w-full mt-2">
          Cerrar sesión
        </Button>
      </div>
    </AuthLayout>
  )
}
