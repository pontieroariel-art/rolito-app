import { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, X, Send, Loader2, RotateCcw } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { chatWithGemini, GeminiMsg } from '../../services/aiService'

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

// ── Roles con acceso ──────────────────────────────────────────────────────────

const ROLES_CON_ASISTENTE = ['super_admin', 'logistica', 'gerente_comercial', 'comercial', 'chofer']

// ── Cargar contexto de Firestore ──────────────────────────────────────────────

async function loadContext(role: string): Promise<string> {
  if (!['super_admin', 'logistica', 'gerente_comercial', 'comercial'].includes(role)) return ''
  try {
    const { getOrdersInRange } = await import('../../services/orderService')
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tmrw  = new Date(today); tmrw.setDate(today.getDate() + 1)
    const todayOrders = await getOrdersInRange(today, tmrw)

    const cnt = (s: string) => todayOrders.filter((o) => o.status === s).length
    const sinAsignar = todayOrders.filter((o) => !o.driverId && !['entregado','cancelado'].includes(o.status)).length

    const todayCtx = `Pedidos de hoy: ${todayOrders.length} total — pendientes ${cnt('pendiente')}, confirmados ${cnt('confirmado')}, en camino ${cnt('en_camino')}, entregados ${cnt('entregado')}, cancelados ${cnt('cancelado')}. Sin asignar: ${sinAsignar}.`

    if (role === 'comercial' || role === 'gerente_comercial') {
      const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() || 7)
      const weekOrders = await getOrdersInRange(weekStart, tmrw)
      return `${todayCtx}\nPedidos esta semana: ${weekOrders.length}.`
    }
    return todayCtx
  } catch {
    return ''
  }
}

// ── System prompts por rol ────────────────────────────────────────────────────

function buildSystemPrompt(role: string, context: string): string {
  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const base  = `Sos el asistente de Rolito, empresa argentina de distribución de hielo. Hoy es ${fecha}. Respondé siempre en español rioplatense, de forma concisa y directa. No uses markdown con asteriscos, respondé en texto plano.`

  if (role === 'super_admin' || role === 'logistica') {
    return `${base}
Tu especialidad es logística operativa: pedidos, despachos, asignación de choferes, rutas y entregas.
Podés ayudar con redistribución de carga, análisis del día y procedimientos operativos.
${context ? `\nContexto actual:\n${context}` : ''}`
  }

  if (role === 'gerente_comercial' || role === 'comercial') {
    return `${base}
Tu especialidad es el área comercial: análisis de clientes, visitas, pedidos, listas de precios y relaciones comerciales.
Podés ayudar con seguimiento de clientes, análisis de ventas y estrategia comercial.
${context ? `\nContexto actual:\n${context}` : ''}`
  }

  if (role === 'chofer') {
    return `${base}
Ayudás a los choferes con el uso de la app: cómo registrar entregas, marcar entrega parcial, postponer una parada, reportar incidencias y usar el mapa.
Respondé de forma muy simple y clara, como si le explicaras a alguien que usa el celular mientras trabaja.`
  }

  return base
}

// ── Saludos iniciales ─────────────────────────────────────────────────────────

const GREETINGS: Record<string, string> = {
  super_admin:       '¡Hola! Puedo ayudarte con la operación del día: pedidos, despachos, choferes y rutas. ¿Qué necesitás?',
  logistica:         '¡Hola! Puedo ayudarte con pedidos, despachos y distribución del día. ¿En qué te ayudo?',
  gerente_comercial: '¡Hola! Puedo ayudarte con análisis de clientes, visitas y pedidos. ¿Qué necesitás saber?',
  comercial:         '¡Hola! Puedo ayudarte con pedidos, clientes y visitas. ¿En qué te ayudo?',
  chofer:            '¡Hola! ¿Tenés alguna duda con la app o con el proceso de entrega?',
}

// ── Sugerencias rápidas por rol ───────────────────────────────────────────────

const SUGERENCIAS: Record<string, string[]> = {
  super_admin:       ['¿Cuántos pedidos hay hoy?', '¿Hay pedidos sin asignar?', '¿Cómo redistribuyo paradas?'],
  logistica:         ['¿Cuántos pedidos hay hoy?', '¿Hay pedidos sin asignar?', '¿Cómo confirmo un despacho?'],
  gerente_comercial: ['¿Qué hago si un cliente pide cambio de precio?', '¿Cuántos pedidos hubo esta semana?'],
  comercial:         ['¿Cuántos pedidos hay hoy?', '¿Cómo agrego una visita puntual?'],
  chofer:            ['¿Cómo registro una entrega?', '¿Cómo postpono una parada?', '¿Qué hago si el cliente no está?'],
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function AIChatWidget() {
  const { user } = useAuth()
  const role     = user?.rol ?? ''

  const [open,     setOpen]     = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [context,  setContext]  = useState('')
  const [ctxLoaded, setCtxLoaded] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLInputElement>(null)

  const apiKey = import.meta.env.VITE_GEMINI_KEY as string | undefined

  // No mostrar si el rol no tiene acceso, no hay key, o es el placeholder
  if (!ROLES_CON_ASISTENTE.includes(role) || !apiKey || apiKey === 'PEGAR_TU_KEY_AQUI') return null

  const isChofer = role === 'chofer'

  // Cargar contexto al abrir por primera vez
  useEffect(() => {
    if (!open || ctxLoaded) return
    loadContext(role).then((ctx) => { setContext(ctx); setCtxLoaded(true) })
  }, [open, role, ctxLoaded])

  // Saludo inicial
  useEffect(() => {
    if (open && messages.length === 0 && ctxLoaded) {
      setMessages([{ role: 'assistant', text: GREETINGS[role] ?? '¡Hola! ¿En qué te ayudo?' }])
    }
  }, [open, messages.length, ctxLoaded, role])

  // Scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus en el input al abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const toGeminiHistory = useCallback((msgs: ChatMessage[]): GeminiMsg[] =>
    msgs
      .filter((_, i) => i > 0) // omitir saludo inicial
      .map((m) => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }],
      })),
  [])

  const sendMessage = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim()
    if (!userText || loading || !apiKey) return
    setInput('')
    const newMessages = [...messages, { role: 'user' as const, text: userText }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const systemPrompt = buildSystemPrompt(role, context)
      const history      = toGeminiHistory(newMessages.slice(0, -1))
      const reply        = await chatWithGemini(history, systemPrompt, userText, apiKey)
      setMessages((prev) => [...prev, { role: 'assistant', text: reply }])
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      console.error('[Asistente IA] Error:', detail)
      setMessages((prev) => [...prev, {
        role: 'assistant',
        text: `No pude conectarme al asistente.\n\nError: ${detail}`,
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, role, context, apiKey, toGeminiHistory])

  const handleReset = () => {
    setMessages([])
    setCtxLoaded(false)
    setContext('')
  }

  return (
    <>
      {/* Botón flotante */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed z-40 flex items-center gap-2 bg-accent text-white rounded-full shadow-xl hover:bg-accent/90 active:scale-95 transition-all font-medium text-sm px-4 py-2.5 ${
            isChofer ? 'bottom-[72px] right-4' : 'bottom-6 right-6'
          }`}
        >
          <Bot size={17} />
          Asistente IA
        </button>
      )}

      {/* Panel de chat */}
      {open && (
        <div className={`fixed z-50 bg-white shadow-2xl border border-gray-200 flex flex-col ${
          isChofer
            ? 'inset-x-2 top-14 bottom-16 rounded-2xl'
            : 'bottom-6 right-6 w-[380px] h-[540px] rounded-2xl'
        }`}>

          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-accent rounded-t-2xl shrink-0">
            <Bot size={17} className="text-white" />
            <p className="text-white font-semibold text-sm flex-1">Asistente Rolito</p>
            <button onClick={handleReset} className="text-white/60 hover:text-white transition-colors p-1" title="Nueva conversación">
              <RotateCcw size={14} />
            </button>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white transition-colors p-1">
              <X size={17} />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {/* Sugerencias después del saludo */}
            {messages.length === 1 && !loading && (
              <div className="flex flex-col gap-1.5 pt-1">
                {(SUGERENCIAS[role] ?? []).map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 rounded-xl px-3 py-2 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-gray-100 flex gap-2 shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder="Escribí tu consulta..."
              disabled={loading}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center hover:bg-accent/90 disabled:opacity-40 transition-colors shrink-0 self-end"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
