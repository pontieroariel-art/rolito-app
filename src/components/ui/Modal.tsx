import { useEffect, useRef, ReactNode, useId } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  variant?: 'dark' | 'light'
}

export default function Modal({ open, onClose, title, children, variant = 'dark' }: ModalProps) {
  const titleId    = useId()
  const panelRef   = useRef<HTMLDivElement>(null)

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Focus trap básico: mover el foco al panel al abrir
  useEffect(() => {
    if (!open) return
    const el = panelRef.current
    if (el) el.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`rounded-2xl w-full max-w-md p-6 shadow-2xl outline-none ${
          variant === 'light'
            ? 'bg-white border border-[#D3D1C7]'
            : 'bg-surface border border-border'
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id={titleId} className={`text-lg font-semibold ${variant === 'light' ? 'text-gray-900' : ''}`}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className={`transition-colors w-8 h-8 flex items-center justify-center rounded-lg ${
              variant === 'light'
                ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                : 'text-muted hover:text-white hover:bg-bg'
            }`}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
