import { ReactNode } from 'react'

interface AuthLayoutProps {
  title?:    string
  subtitle?: string
  children:  ReactNode
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-[#F8F7F2] flex flex-col">

      {/* Banda superior — gradiente con isotipo */}
      <div className="flex justify-center items-end pt-10 pb-0" style={{ background: 'linear-gradient(180deg, #081C11 0%, #2D6A4F 100%)' }}>
        <div className="bg-white rounded-2xl p-2 shadow-lg mb-0 translate-y-1/2">
          <img src="/isotipo-rolito.png" alt="Rolito" className="w-16 h-16 object-contain" />
        </div>
      </div>

      {/* Banda blanca — logo */}
      <div className="bg-white flex flex-col items-center pt-12 pb-4 shadow-sm border-b border-[#E8E6DF]">
        <img src="/logo-rolito.png" alt="Rolito" className="h-24 object-contain" />
      </div>

      {/* Área principal */}
      <div className="flex-1 flex flex-col items-center px-4 pt-8 pb-10">
        <div className="w-full max-w-sm">

          {/* Separador decorativo */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-[#D3D1C7]" />
            <img src="/isotipo-rolito.png" alt="" className="w-5 h-5 object-contain opacity-30" />
            <div className="flex-1 h-px bg-[#D3D1C7]" />
          </div>

          {title && (
            <div className="text-center mb-6">
              {subtitle && (
                <p className="text-accent text-sm mb-1 tracking-wide">{subtitle}</p>
              )}
              <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
            </div>
          )}

          {/* Card */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#D3D1C7]">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
