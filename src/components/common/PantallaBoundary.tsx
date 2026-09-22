import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { reportError } from '@/services/observability'

/**
 * ErrorBoundary por PANTALLA (auditoría 2026-09-22). Hasta ahora había uno
 * solo en la raíz: un error de render en cualquier componente desmontaba la
 * app entera, y la tablet del muelle o el chofer en la calle perdían el shell,
 * el estado y el visor abierto. Este se monta alrededor de las rutas, con la
 * ruta como `key`: un error deja la tarjeta en el lugar de la pantalla, con
 * "Reintentar" (vuelve a montar esa pantalla) y "Volver al inicio"; navegar a
 * otra ruta lo resetea solo. El de la raíz sigue para lo que pase fuera de las
 * rutas (proveedores, chunk viejo tras un deploy).
 */
class Boundary extends Component<{ ruta: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack, boundary: 'pantalla', ruta: this.props.ruta })
  }
  render() {
    const error = this.state.error
    if (!error) return this.props.children
    // Un chunk viejo después de un deploy lo resuelve el boundary de la raíz
    // recargando: acá se relanza para que llegue hasta él.
    if (error.message?.includes('Failed to fetch dynamically imported module') || error.message?.includes('Importing a module script failed')) throw error
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#D3D1C7] rounded-xl p-6 text-gray-900">
          <p className="text-base font-semibold mb-1">Esta pantalla falló</p>
          <p className="text-sm text-secundario mb-4">
            El resto de la app sigue andando. Si vuelve a pasar, avisá con la hora y qué estabas haciendo.
          </p>
          <p className="text-xs text-secundario mb-5 break-words">{error.message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="h-11 px-5 rounded-lg bg-accent text-white font-semibold text-sm"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/' }}
              className="h-11 px-5 rounded-lg border border-[#D3D1C7] bg-white text-gray-900 font-semibold text-sm"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }
}

/** Envuelve las rutas: la `key` por ruta hace que navegar resetee el error. */
export default function PantallaBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <Boundary key={pathname} ruta={pathname}>{children}</Boundary>
}
