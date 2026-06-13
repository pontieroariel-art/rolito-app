import { useEffect, useRef, ReactNode, useId } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  variant?: 'dark' | 'light'
  wide?: boolean
}

export default function Modal({ open, onClose, title, children, variant = 'dark', wide = false }: ModalProps) {
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
        className={`rounded-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} shadow-2xl outline-none flex flex-col max-h-[90vh] ${
          variant === 'light'
            ? 'bg-white border border-[#D3D1C7]'
            : 'bg-white border border-[#D3D1C7]'
        }`}
      >
        <div className="flex justify-between items-center p-6 pb-4 shrink-0">
          <h2 id={titleId} className={`text-lg font-semibold ${variant === 'light' ? 'text-gray-900' : ''}`}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className={`transition-colors w-8 h-8 flex items-center justify-center rounded-lg ${
              variant === 'light'
                ? 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                : 'text-gray-500 hover:text-gray-700 hover:bg-[#F8F7F2]'
            }`}
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 pb-6">{children}</div>
      </div>
    </div>
  )
}
