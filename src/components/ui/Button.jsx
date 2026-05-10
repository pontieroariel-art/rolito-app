export default function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  ...props
}) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-all focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary: 'bg-accent text-bg hover:bg-accent/90 focus:ring-accent/50',
    outline: 'border border-accent text-accent hover:bg-accent/10 focus:ring-accent/50',
    danger:  'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/50',
    ghost:   'text-muted hover:text-white hover:bg-surface',
    success: 'bg-success text-bg hover:bg-success/90 focus:ring-success/50',
  }

  return (
    <button
      className={`${base} ${variants[variant] ?? variants.primary} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  )
}
