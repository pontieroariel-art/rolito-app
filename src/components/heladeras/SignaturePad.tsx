import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

export interface SignaturePadHandle {
  clear: () => void
  toDataURL: () => string | null   // null si no se dibujó nada
}

// Canvas de resolución fija (se muestra responsive vía CSS, las coordenadas
// del puntero se reescalan proporcionalmente) — mantiene el PNG exportado
// liviano y consistente sin importar el tamaño de pantalla.
const CANVAS_W = 500
const CANVAS_H = 180

const SignaturePad = forwardRef<SignaturePadHandle, { className?: string }>(({ className }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing   = useRef(false)
  const dirty     = useRef(false)
  const [empty, setEmpty] = useState(true)

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      y: (e.clientY - rect.top) * (CANVAS_H / rect.height),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = getCtx()
    if (!ctx) return
    drawing.current = true
    const { x, y } = pointFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = getCtx()
    if (!ctx) return
    const { x, y } = pointFromEvent(e)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111'
    ctx.lineTo(x, y)
    ctx.stroke()
    dirty.current = true
    setEmpty(false)
  }

  const handlePointerUp = () => {
    drawing.current = false
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      const ctx = getCtx()
      if (ctx) ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      dirty.current = false
      setEmpty(true)
    },
    toDataURL: () => (dirty.current ? canvasRef.current?.toDataURL('image/png') ?? null : null),
  }))

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="w-full h-[45vw] max-h-[180px] bg-white border border-[#D3D1C7] rounded-lg touch-none cursor-crosshair"
      />
      {empty && <p className="text-xs text-gray-400 mt-1">Firmá con el dedo o el mouse en el recuadro de arriba.</p>}
    </div>
  )
})

SignaturePad.displayName = 'SignaturePad'
export default SignaturePad
