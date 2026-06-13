import { InputHTMLAttributes, ReactNode, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  rightElement?: ReactNode
}

export default function Input({ label, error, className = '', rightElement, id: propId, ...props }: InputProps) {
  const generatedId = useId()
  const inputId     = propId ?? generatedId

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`bg-white border rounded-xl px-3 py-2.5 text-gray-900 placeholder-gray-400 w-full
            focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors
            ${error ? 'border-red-400' : 'border-[#D3D1C7]'}
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
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-red-400 text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
