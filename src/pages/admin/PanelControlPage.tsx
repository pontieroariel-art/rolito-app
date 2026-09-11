import { useEffect, useState } from 'react'
import { Activity, Eye, RefreshCw } from 'lucide-react'
import TileEstado, { COLOR_TONO, TEXTO_TONO } from '@/components/admin/TileEstado'
import AuditoriaReciente from '@/components/admin/AuditoriaReciente'
import SeccionAccesos from '@/components/admin/SeccionAccesos'
import VerComoUsuario from '@/components/admin/VerComoUsuario'
import { Plegable } from '@/components/ui/Plegable'
import { useEstadoBackoffice } from '@/hooks/useEstadoBackoffice'
import {
  getFacturasArcaConProblema, getOutboxEnError, type FacturaArcaProblema, type OutboxError,
} from '@/services/backofficeEstadoService'
import {
  atrasoSaldos, atrasoSync, estadoBridge, haceTexto, pedidosHoy, peorTono, rendicionesSinValidar,
  resumenArca, resumenCot, resumenOutbox, tonoConteo, UMBRALES, type Tono,
} from '@/utils/backofficeEstado'
import { PLANTAS } from '@/types'

// Panel de control del super_admin (`/admin`, 2026-09-10). Reemplaza al
// BackofficeHome de 37 tarjetas: primero lo que requiere acción, después el
// estado de las integraciones (Tango, ARCA, ARBA), la operación de hoy, el
// lanzador de "Ver como usuario" y, plegados, los accesos a cada pantalla.

const fmtHora = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

export default function PanelControlPage() {
  const { estado, loading, refrescando, ultimoRefresco, refrescar } = useEstadoBackoffice()
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const c = estado.conteos
  const sinValidar = rendicionesSinValidar(estado.rendiciones)
  const entregasSinConfirmar = estado.entregas.length
  const anulacionesPend = estado.anulaciones.length
  const anulacionMasVieja = estado.anulaciones.reduce<Date | null>((acc, a) => {
    const d = a.solicitadaEn?.toDate?.() ?? null
    return d && (!acc || d < acc) ? d : acc
  }, null)

  const outbox = resumenOutbox({
    enCurso: c?.outboxEnCurso ?? null, error: c?.outboxError ?? null,
    consultasPendientes: c?.consultasPendientes ?? null, consultasError: c?.consultasError ?? null, altasError: c?.altasError ?? null,
  })
  const t = estado.configTango
  const bridge  = estadoBridge(t.bridgeLastSeen, ahora)
  const syncCli = atrasoSync(t.clientes, ahora, UMBRALES.clientesHoras)
  const syncPre = atrasoSync(t.precios, ahora, UMBRALES.preciosHoras)
  const syncSal = atrasoSaldos(t.saldos, ahora)
  const compTono: Tono = t.comprobantes.ok === false ? 'error' : t.comprobantes.ok === true ? 'ok' : 'neutro'
  const tonoSyncs = peorTono(bridge.tono, syncCli.tono, syncPre.tono, syncSal.tono, compTono)

  const arca = resumenArca(estado.configArca.habilitado, c?.arcaRechazadas ?? null, c?.arcaInciertas ?? null)
  const cot  = resumenCot(estado.configCot.habilitado, c?.cotPendientes ?? null, c?.cotError ?? null)
  const ped  = pedidosHoy(estado.rollupHoy)

  const [outboxErrores, setOutboxErrores] = useState<OutboxError[] | null>(null)
  const [arcaProblemas, setArcaProblemas] = useState<FacturaArcaProblema[] | null>(null)

  return (
    <main className="max-w-6xl mx-auto p-4 space-y-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Activity size={22} className="text-accent" /> Panel de control</h1>
          <p className="text-gray-500 text-sm">Qué hay pendiente, qué está roto y cómo van las integraciones. Los accesos a cada pantalla, abajo.</p>
        </div>
        <div className="flex items-center gap-3">
          {ultimoRefresco && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#0F6B4E]">
              <span className="w-2 h-2 rounded-full bg-[#1D9E75] animate-pulse" /> en vivo · {fmtHora(ultimoRefresco)}
            </span>
          )}
          <button
            onClick={() => { void refrescar() }}
            disabled={refrescando}
            className="inline-flex items-center gap-1.5 bg-white border border-[#D3D1C7] rounded-lg px-3 py-2 text-sm text-gray-700 hover:border-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={refrescando ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* A. Requiere acción */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Requiere acción</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TileEstado
            titulo="Usuarios por aprobar"
            tono={tonoConteo(c?.usuariosPendientes)}
            valor={c?.usuariosPendientes ?? null}
            lineas={[['Clientes en borrador', c?.usuariosPendientes ?? '—']]}
            to="/usuarios" toLabel="Ver clientes"
          />
          <TileEstado
            titulo="Anulaciones por autorizar"
            tono={tonoConteo(anulacionesPend)}
            valor={anulacionesPend}
            lineas={[
              ['Más antigua', anulacionMasVieja ? haceTexto(anulacionMasVieja, ahora) : '—'],
              ...(Object.keys(PLANTAS) as Array<keyof typeof PLANTAS>).map((p): [string, number] => [PLANTAS[p].label, estado.anulaciones.filter((a) => a.plantaId === p).length]),
            ]}
            to="/anulaciones" toLabel="Ver bandeja"
          />
          <TileEstado
            titulo="Tesorería"
            tono={tonoConteo(sinValidar + entregasSinConfirmar)}
            valor={sinValidar + entregasSinConfirmar}
            lineas={[[`Cierres sin validar (${7} d)`, sinValidar], ['Entregas sin confirmar', entregasSinConfirmar]]}
            to="/tesoreria/rendiciones" toLabel="Ver tesorería"
          />
          <TileEstado
            titulo="Service de heladeras"
            tono={peorTono(tonoConteo(c?.ticketsAbiertos), tonoConteo(c?.ticketsUrgentes, true))}
            valor={c?.ticketsAbiertos ?? null}
            sufijo="abiertos"
            lineas={[['Urgentes', c?.ticketsUrgentes ?? '—']]}
            to="/heladeras/consulta-service" toLabel="Ver tickets"
          />
        </div>
      </section>

      {/* B. Integraciones */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Integraciones</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <TileEstado
            titulo="Tango · cola"
            tono={outbox.tono}
            valor={c ? outbox.errores : null}
            sufijo="en error"
            lineas={[
              ['En curso', c?.outboxEnCurso ?? '—'],
              ['Consultas pendientes', c?.consultasPendientes ?? '—'],
              ['Altas en error', c?.altasError ?? '—'],
            ]}
            to="/admin/general" toLabel="Ajustes de Tango"
          >
            {outbox.errores > 0 && (
              <Desplegable
                label={`Ver ${Math.min(outbox.errores, 10)} errores`}
                onAbrir={() => { if (!outboxErrores) getOutboxEnError(10).then(setOutboxErrores) }}
              >
                {outboxErrores === null ? <p className="text-xs text-gray-400">Cargando…</p> : (
                  <ul className="text-xs space-y-1">
                    {outboxErrores.map((e) => (
                      <li key={e.id} className="border-l-2 border-red-300 pl-2">
                        <b>{e.entidad}</b> · {e.empresa} · {e.origenId.slice(0, 12)} · {e.intentos} intentos
                        <p className="text-gray-500 break-words">{e.ultimoError || 'sin detalle'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Desplegable>
            )}
          </TileEstado>
          <TileEstado
            titulo="Tango · sincronizaciones"
            tono={tonoSyncs}
            valor={TEXTO_TONO[tonoSyncs]}
            lineas={[
              ['Bridge (VM)', <Tonito key="b" tono={bridge.tono}>{bridge.texto}</Tonito>],
              ['Clientes', <Tonito key="c" tono={syncCli.tono}>{syncCli.texto}</Tonito>],
              ['Precios', <Tonito key="p" tono={syncPre.tono}>{syncPre.texto}</Tonito>],
              ['Saldos', <Tonito key="s" tono={syncSal.tono}>{syncSal.texto}</Tonito>],
              ['Comprobantes', <Tonito key="k" tono={compTono}>{t.comprobantes.ok === false ? 'con error' : haceTexto(t.comprobantes.ultima, ahora)}</Tonito>],
            ]}
            to="/admin/general" toLabel="Ajustes de Tango"
          />
          <TileEstado
            titulo="ARCA · facturación"
            tono={arca.tono}
            valor={c ? arca.problemas : null}
            sufijo="con problemas"
            lineas={[
              ['Habilitado', estado.configArca.habilitado === null ? '—' : estado.configArca.habilitado ? 'sí' : 'no'],
              ['Rechazadas', c?.arcaRechazadas ?? '—'],
              ['Inciertas', c?.arcaInciertas ?? '—'],
            ]}
          >
            {arca.problemas > 0 && (
              <Desplegable
                label={`Ver ${Math.min(arca.problemas, 10)} facturas`}
                onAbrir={() => { if (!arcaProblemas) getFacturasArcaConProblema(10).then(setArcaProblemas) }}
              >
                {arcaProblemas === null ? <p className="text-xs text-gray-400">Cargando…</p> : (
                  <ul className="text-xs space-y-1">
                    {arcaProblemas.map((f) => (
                      <li key={f.id} className="border-l-2 border-red-300 pl-2">
                        <b>{f.estado}</b> · venta {f.ventaId.slice(0, 12)}{f.tipo ? ` · ${f.tipo}` : ''}
                        <p className="text-gray-500 break-words">{f.motivo || 'sin motivo'}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Desplegable>
            )}
          </TileEstado>
          <TileEstado
            titulo="COT de ARBA"
            tono={cot.tono}
            valor={c ? (c.cotError ?? 0) : null}
            sufijo="en error"
            lineas={[
              ['Habilitado', estado.configCot.habilitado ? 'sí' : 'no'],
              ['Pendientes de presentar', c?.cotPendientes ?? '—'],
            ]}
            to="/caja/remitos" toLabel="Ver remitos de carga"
          />
        </div>
      </section>

      {/* C. Operación de hoy */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Operación de hoy · {estado.hoy}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TileEstado
            titulo="Pedidos de hoy"
            tono={ped.total > 0 ? 'ok' : 'neutro'}
            valor={ped.total}
            lineas={[
              ['Pendientes', ped.porEstado.pendiente],
              ['Confirmados', ped.porEstado.confirmado],
              ['En camino', ped.porEstado.en_camino],
              ['Entregados', ped.porEstado.entregado],
            ]}
            to="/logistica" toLabel="Ver despacho"
          />
          <TileEstado
            titulo="Clientes sin Tango"
            tono={tonoConteo(c?.clientesSinTango)}
            valor={c?.clientesSinTango ?? null}
            lineas={[['Activos sin vincular', c?.clientesSinTango ?? '—']]}
            to="/usuarios" toLabel="Ver clientes"
          />
          <div className="rounded-xl border border-[#D3D1C7] bg-white p-3 md:row-span-1" style={{ borderTop: `4px solid ${COLOR_TONO.neutro}` }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Últimas acciones</p>
            {loading && estado.historial.length === 0
              ? <p className="text-xs text-gray-400">Cargando…</p>
              : <AuditoriaReciente eventos={estado.historial} ahora={ahora} />}
          </div>
        </div>
      </section>

      {/* D. Ver como usuario */}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-violet-900 flex items-center gap-2"><Eye size={16} /> Ver la app como otro usuario</h2>
        <VerComoUsuario />
      </section>

      {/* E. Accesos */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accesos</h2>
        <SeccionAccesos />
      </section>

      <Plegable titulo="Cómo leer este panel">
        <ul className="text-xs text-gray-600 space-y-1 list-disc pl-4 pt-1">
          <li>Los contadores se actualizan al entrar, cada minuto con la pestaña visible y con el botón Actualizar; anulaciones, tesorería, pedidos y configuración son en tiempo real.</li>
          <li>Tango: el bridge de la VM manda una señal cada pocos minutos (más de {UMBRALES.bridgeMin} min sin señal = caído). Clientes y precios corren a diario; saldos cada hora de {UMBRALES.saldosDesde} a {UMBRALES.saldosHasta}.</li>
          <li>ARCA: las facturas rechazadas o inciertas son acumuladas (no tienen fecha); una vez resueltas en Tango dejan de contar cuando se corrige su estado.</li>
        </ul>
      </Plegable>
    </main>
  )
}

function Tonito({ tono, children }: { tono: Tono; children: React.ReactNode }) {
  return <span style={{ color: COLOR_TONO[tono] }}>{children}</span>
}

function Desplegable({ label, onAbrir, children }: { label: string; onAbrir: () => void; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={() => { setAbierto((a) => !a); if (!abierto) onAbrir() }}
        className="text-xs text-red-700 underline underline-offset-2"
      >
        {abierto ? 'Ocultar' : label}
      </button>
      {abierto && <div className="mt-1.5 max-h-48 overflow-y-auto">{children}</div>}
    </div>
  )
}
