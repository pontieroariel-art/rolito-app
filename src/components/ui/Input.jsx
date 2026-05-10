export default function Input({ label, error, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-300">{label}</label>
      )}
      <input
        className={`bg-surface border rounded-lg px-3 py-2 text-white placeholder-muted
          focus:outline-none focus:ring-2 focus:ring-accent transition-colors
          ${error ? 'border-red-500' : 'border-border'}
          ${className}`}
        {...props}
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
