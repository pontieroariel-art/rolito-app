import { useEffect, useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import CobranzaCompleta from '@/components/cobranzas/CobranzaCompleta'
import { CobranzaSupervisorCard } from '@/components/supervisor/CobranzaSupervisorCard'
import AbrirTurnoPanel, { TurnoAbiertoChip } from '@/components/expedicion/AbrirTurnoPanel'
import { useAuth } from '@/context/AuthContext'
import { useDiaActual, useFechaDelDia } from '@/hooks/useDiaActual'
import { useSesionAbierta } from '@/hooks/useCajaSesion'
import { delTurno } from '@/utils/turnoCaja'
import { subscribeCobranzasCajaDelDia } from '@/services/cobranzaService'
import {
  desmarcarDispositivoCobranza, esDispositivoCobranza, marcarDispositivoCobranza,
} from '@/services/expedicionDeviceService'
import { generateReciboCobranza } from '@/utils/pdf'
import { formatoARS } from '@/utils/money'
import { Cobranza, PLANTAS } from '@/types'
import { reportError } from '@/services/observability'

// Cobranza al público (caja): clientes de cuenta corriente que vienen al
// mostrador a pagar. Desde el 2026-09-05 es la misma cobranza completa del
// supervisor (composición de saldos de Tango, imputación, efectivo /
// transferencia / cheques / retenciones, recibo numerado → Tango). Las
// cobranzas simples anteriores se siguen mostrando y reimprimiendo.
export default function CobranzasPage() {
  const { user } = useAuth()
  const plantaId = user?.planta ?? 'torcuato'
  const fecha = useFechaDelDia()
  const dia = useDiaActual()
  // Turno de caja (rendición de fondos, 2026-09-14): sin turno abierto no se
  // cobra en el mostrador (las reglas lo exigen); cada cobranza lleva el turno.
  const { sesion, loading: cargandoSesion } = useSesionAbierta(user?.uid, dia)

  const [cobranzas,  setCobranzas]  = useState<Cobranza[]>([])
  const [tabletFija, setTabletFija] = useState(esDispositivoCobranza())

  useEffect(() => subscribeCobranzasCajaDelDia(plantaId, fecha, setCobranzas), [plantaId, fecha])

  const ordenadas = useMemo(() => cobranzas.slice().sort((a, b) => b.fecha.toMillis() - a.fecha.toMillis()), [cobranzas])
  const totalDia = cobranzas.reduce((s, c) => s + c.importe, 0)
  const miasDelTurno = useMemo(() => (sesion && user ? delTurno(cobranzas.filter((c) => c.registradoPor.uid === user.uid), sesion).length : 0), [cobranzas, sesion, user])

  const imprimirSimple = (c: Cobranza) =>
    generateReciboCobranza({
      id:            c.id,
      plantaId,
      clienteNombre: c.clienteNombre,
      importe:       c.importe,
      formaPago:     c.formaPago,
      referencia:    c.referencia,
      registradoPor: c.registradoPor.nombre,
      fecha:         c.fecha.toDate(),
    }).catch((err) => reportError(err, { origen: 'CobranzasPage', accion: 'error al generar el recibo' }))

  return (
    <main className="max-w-3xl mx-auto pb-10">
      <div className="p-4 pb-0 space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Cobranzas</h1>
        <p className="text-secundario text-sm">{PLANTAS[plantaId].label} · pagos de cuenta corriente en mostrador</p>
        {sesion && <TurnoAbiertoChip sesion={sesion} ventas={-1} cobranzas={miasDelTurno} />}
      </div>

      {!cargandoSesion && !sesion && <div className="p-4"><AbrirTurnoPanel fecha={dia} /></div>}
      {sesion && <CobranzaCompleta origen="caja" plantaId={plantaId} cajaSesionId={sesion.id} volverA="/caja" ancho="3xl" />}

      <section className="px-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Cobranzas de hoy</h2>
          {cobranzas.length > 0 && <p className="text-sm font-semibold text-gray-900">{formatoARS(totalDia)}</p>}
        </div>
        {cobranzas.length === 0 && <p className="text-secundario text-sm">Todavía no se registraron cobranzas hoy.</p>}
        {ordenadas.map((c) => c.medios ? (
          <CobranzaSupervisorCard key={c.id} c={c} />
        ) : (
          <div key={c.id} className="bg-white rounded-xl border border-[#D3D1C7] shadow-sm p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{c.clienteNombre}</p>
              <p className="text-xs text-secundario">
                {formatoARS(c.importe)} · {c.formaPago === 'contado_efectivo' ? 'Efectivo' : 'Transferencia'}
                {c.referencia ? ` · ${c.referencia}` : ''} · cobranza simple (no viaja a Tango)
              </p>
            </div>
            <button onClick={() => imprimirSimple(c)} title="Reimprimir recibo" className="text-secundario hover:text-accent transition-colors p-2 rounded-lg hover:bg-accent/10">
              <Printer size={16} />
            </button>
          </div>
        ))}
      </section>

      {/* Puesto de cobranza: marca del APARATO (localStorage), no del usuario —
          los turnos rotan en la misma tablet, cada persona con su login. */}
      <p className="text-center pt-6">
        {tabletFija ? (
          <span className="text-xs text-secundario">
            Este dispositivo está fijo en Cobranzas ·{' '}
            <button
              onClick={() => { desmarcarDispositivoCobranza(); setTabletFija(false) }}
              className="underline hover:text-accent"
            >
              desfijar
            </button>
          </span>
        ) : (
          <button
            onClick={() => { marcarDispositivoCobranza(); setTabletFija(true) }}
            className="text-xs text-secundario underline hover:text-accent"
          >
            Fijar este dispositivo solo para cobranzas (tablet de mostrador)
          </button>
        )}
      </p>
    </main>
  )
}
