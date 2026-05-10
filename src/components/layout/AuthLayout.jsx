export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Marca */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent/10 border border-accent/30 rounded-2xl mb-3">
            <span className="text-3xl">🧊</span>
          </div>
          <h1 className="text-3xl font-bold text-accent tracking-tight">Rolito</h1>
          <p className="text-muted text-sm mt-1">Distribución de Hielo</p>
          {title && <h2 className="text-xl font-semibold mt-6 text-white">{title}</h2>}
          {subtitle && <p className="text-muted text-sm mt-1">{subtitle}</p>}
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  )
}
