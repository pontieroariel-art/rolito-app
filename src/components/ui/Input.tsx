import { InputHTMLAttributes, ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  rightElement?: ReactNode
}

export default function Input({ label, error, className = '', rightElement, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-300">{label}</label>
      )}
      <div className="relative">
        <input
          className={`bg-surface border rounded-lg px-3 py-2 text-white placeholder-muted w-full
            focus:outline-none focus:ring-2 focus:ring-accent transition-colors
            ${error ? 'border-red-500' : 'border-border'}
            ${rightElement ? 'pr-10' : ''}
            ${className}`}
          {...props}
        />
        {rightElement && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {rightElement}
          </div>
        )}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
