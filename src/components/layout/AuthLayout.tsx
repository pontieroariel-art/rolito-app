import { ReactNode } from 'react'

interface AuthLayoutProps {
  title?:    string
  subtitle?: string
  children:  ReactNode
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-bg flex flex-col">

      {/* Banda superior — gradiente con isotipo */}
      <div className="flex justify-center items-end pt-10 pb-0" style={{ background: 'linear-gradient(180deg, #081C11 0%, #2D6A4F 100%)' }}>
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      {/* Banda blanca — logo imagen */}
      <div className="bg-white flex flex-col items-center pt-12 pb-4 shadow-sm">
        <img src="/logo-rolito.png" alt="Rolito" className="h-24 object-contain" />
      </div>

      {/* Área principal */}
      <div className="flex-1 flex flex-col items-center px-4 pt-8 pb-10">
        <div className="w-full max-w-sm">

          {/* Separador decorativo */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border" />
            <img src="/isotipo-rolito.png" alt="" className="w-5 h-5 object-contain opacity-50" />
            <div className="flex-1 h-px bg-border" />
          </div>

          {title && (
            <div className="text-center mb-6">
              {subtitle && (
                <p className="text-success text-sm mb-1 tracking-wide">{subtitle}</p>
              )}
              <h2 className="text-2xl font-bold text-white">{title}</h2>
            </div>
          )}

          {/* Card glassmorphism */}
          <div className="rounded-2xl p-6 shadow-xl border border-white/10"
            style={{ background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(12px)' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
