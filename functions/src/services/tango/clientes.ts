// Padrón maestro: Tango manda (decisión de Ariel 2026-09-06). Lógica PURA de
// alta y baja automática de cuentas de cliente a partir de las filas de
// clientes de Tango; la escritura (Auth + users + cuitIndex) la hace
// triggers/tangoAltas.ts, la baja la aplica tangoSync.ts.
//
//  - ALTA: todo cliente HABILITADO de cualquiera de las dos empresas con CUIT
//    válido y sin cuenta en la app → cuenta activa, login por CUIT con
//    contraseña inicial = CUIT (el cliente la cambia si quiere; Ariel acepta
//    el riesgo de que el CUIT es público). Un CUIT = una cuenta: si el mismo
//    CUIT aparece en las dos empresas (o varias veces en una), es UNA cuenta
//    con todos los códigos en `tangoIds`.
//  - Sin CUIT válido (consumidor final, "00000000000", CUIT mal cargado): no
//    se crea — no habría cómo loguearse — y se lista en el resumen.
//  - BAJA: cuenta vinculada a Tango cuyas filas desaparecieron o están todas
//    inhabilitadas → estado 'inactivo' + Auth deshabilitado (nunca se borra
//    el doc ni el cuitIndex: conserva historial y bloquea el login). Vuelve a
//    aparecer habilitada → se reactiva sola.
//  - Circuit breaker: si Tango devolvió muchas menos filas que la corrida
//    anterior (< 80 %), esa corrida no da de baja a nadie.

import { cuitValido, soloDigitos } from './cuit'
import { agregarTangoId, EMPRESAS, type Empresa, type TangoIds } from './empresas'

export const DOMINIO_EMAIL_AUTH = 'rolito.app'
export const APROBADO_POR_TANGO = 'tango'
export const UMBRAL_CIRCUIT_BREAKER = 0.8

export interface FilaClienteTango {
  idGva14:            number
  codGva14:           string
  cuit:               string
  razonSocial?:       string
  email?:             string
  telefono1?:         string
  telefono2?:         string
  telefonoMovil?:     string
  condicionVentaDesc?: string
  categoriaIvaCodigo?: string
  categoriaIvaDesc?:   string
  vendedorCodigo?:     string
  domicilio?:          string
  localidad?:          string
  provinciaDesc?:      string
  codigoPostal?:       string
  fechaAlta?:          string
  habilitado?:         boolean
}

/** Fila deshabilitada explícitamente en Tango (si el campo no viene, se asume habilitada). */
export const filaHabilitada = (f: { habilitado?: boolean }): boolean => f.habilitado !== false

export const emailAuthDe = (cuitDigits: string) => `${cuitDigits}@${DOMINIO_EMAIL_AUTH}`

// ── Candidatos a alta ────────────────────────────────────────────────────────

export interface CandidatoAlta {
  cuit:        string          // 11 dígitos
  filas:       Array<{ empresa: Empresa; fila: FilaClienteTango }>
}

export interface MotivoSinAlta {
  empresa:  Empresa
  idGva14:  number
  codigo:   string
  cuit:     string
  nombre:   string
  motivo:   'cuit_invalido' | 'inhabilitado'
}

/**
 * Agrupa por CUIT las filas de Tango que NO tienen cuenta en la app. Devuelve
 * los candidatos (CUIT válido, al menos una fila habilitada) y los descartados
 * con su motivo, para el resumen del panel.
 */
export function candidatosAlta(sinCuenta: Array<{ empresa: Empresa; fila: FilaClienteTango }>): { candidatos: CandidatoAlta[]; descartados: MotivoSinAlta[] } {
  const porCuit = new Map<string, CandidatoAlta>()
  const descartados: MotivoSinAlta[] = []
  for (const { empresa, fila } of sinCuenta) {
    const base = { empresa, idGva14: fila.idGva14, codigo: fila.codGva14, cuit: fila.cuit, nombre: fila.razonSocial ?? '' }
    if (!filaHabilitada(fila)) { descartados.push({ ...base, motivo: 'inhabilitado' }); continue }
    const cuit = soloDigitos(fila.cuit)
    if (!cuitValido(cuit)) { descartados.push({ ...base, motivo: 'cuit_invalido' }); continue }
    if (!porCuit.has(cuit)) porCuit.set(cuit, { cuit, filas: [] })
    porCuit.get(cuit)!.filas.push({ empresa, fila })
  }
  // Redonhielo primero: manda la ficha; sus códigos son los principales.
  const orden = (e: Empresa) => EMPRESAS.indexOf(e)
  for (const c of porCuit.values()) c.filas.sort((a, b) => orden(a.empresa) - orden(b.empresa) || a.fila.idGva14 - b.fila.idGva14)
  return { candidatos: [...porCuit.values()], descartados }
}

// ── Doc de la cuenta nueva ───────────────────────────────────────────────────

function telefonoDe(f: FilaClienteTango): string {
  for (const c of [f.telefono1, f.telefonoMovil, f.telefono2]) {
    if (!c) continue
    const limpio = c.trim()
    if (/^[\d\s\-()+]{6,20}$/.test(limpio)) {
      const n = limpio.replace(/\D/g, '')
      if (n.length >= 6 && n.length <= 15) return limpio
    }
  }
  return ''
}

const pareceEmail = (e?: string): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function direccionDe(f: FilaClienteTango): string {
  return [f.domicilio, f.localidad, f.provinciaDesc].map((x) => (x ?? '').trim()).filter(Boolean).join(', ')
}

/**
 * Ficha `users/{uid}` de una cuenta creada desde Tango. Modelo `emailAuth`
 * (como scripts/import-clientes.mjs): la credencial es <cuit>@rolito.app y
 * `email` es solo de contacto. Nace ACTIVA, con `aprobadoPor: 'tango'` y SIN
 * `creadoPor`, para no disparar los emails de onUserRegistered /
 * onClienteCreadoPorStaff / onUserApproved (functions/src/triggers/users.ts).
 * `ahora` = FieldValue.serverTimestamp() desde el trigger.
 */
export function docCuentaDesdeTango(candidato: CandidatoAlta, ahora: unknown): Record<string, unknown> {
  const principal = candidato.filas[0].fila
  const emailAuth = emailAuthDe(candidato.cuit)
  const razonSocial = (principal.razonSocial ?? '').trim() || `Cliente ${principal.codGva14}`
  const telefono = telefonoDe(principal)
  const direccion = direccionDe(principal)
  const tangoIds: TangoIds = {}
  for (const { empresa, fila } of candidato.filas) {
    tangoIds[empresa] = agregarTangoId(tangoIds[empresa], { idGva14: fila.idGva14, codigo: fila.codGva14 })
  }
  const rh = tangoIds.redonhielo?.[0]
  // Una dirección por código de Tango (addresses[].id = código, como en las
  // importaciones): la primera es la principal.
  const addresses = candidato.filas.map(({ fila }, i) => ({
    id: fila.codGva14,
    nombre: i === 0 ? 'Principal' : (fila.razonSocial ?? '').trim() || fila.codGva14,
    address: direccionDe(fila) || direccion,
    lat: null, lng: null, horarioApertura: '', horarioCierre: '', contactoNombre: '', contactoTelefono: '',
    esPrincipal: i === 0,
  })).filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i)
  const doc: Record<string, unknown> = {
    rol: 'cliente',
    estado: 'activo',
    emailAuth,
    email: pareceEmail(principal.email) ? principal.email.trim() : emailAuth,
    cuit: candidato.cuit,
    razonSocial,
    nombre: razonSocial,
    nombreContacto: razonSocial,
    telefono,
    phone: telefono,
    address: addresses[0]?.address ?? '',
    codigoCliente: principal.codGva14,
    addresses,
    tangoIds,
    ...(rh ? { codigoTango: rh.codigo, idGva14Tango: rh.idGva14 } : {}),
    ...(principal.condicionVentaDesc ? { condicionVenta: principal.condicionVentaDesc } : {}),
    ...(principal.categoriaIvaCodigo ? { categoriaIvaTango: principal.categoriaIvaCodigo } : {}),
    ...(principal.categoriaIvaDesc ? { categoriaIvaTangoDesc: principal.categoriaIvaDesc } : {}),
    ...(principal.vendedorCodigo ? { codVendedor: principal.vendedorCodigo } : {}),
    ...(principal.domicilio ? { domicilioTango: principal.domicilio } : {}),
    ...(principal.localidad ? { localidadTango: principal.localidad } : {}),
    ...(principal.provinciaDesc ? { provinciaTango: principal.provinciaDesc } : {}),
    ...(principal.codigoPostal ? { codigoPostalTango: principal.codigoPostal } : {}),
    fechaCreacion: ahora,
    fechaAprobacion: ahora,
    aprobadoPor: APROBADO_POR_TANGO,
    tangoUltimaSync: ahora,
  }
  return doc
}

// ── Baja / reactivación ──────────────────────────────────────────────────────

export interface EstadoVinculo {
  /** Por empresa: la cuenta tiene identidad ahí. */
  vinculada:   Partial<Record<Empresa, boolean>>
  /** Por empresa: al menos una de sus filas apareció HABILITADA en la corrida. */
  habilitada:  Partial<Record<Empresa, boolean>>
  /** Por empresa: la corrida de esa empresa se pudo usar para dar de baja (no cortó el circuit breaker ni falló). */
  corridaOk:   Partial<Record<Empresa, boolean>>
}

export type DecisionBaja = { accion: 'baja'; motivo: string } | { accion: 'reactivar' } | { accion: 'nada' }

/**
 * Qué hacer con una cuenta vinculada a Tango después de una corrida completa.
 *  - Está habilitada en alguna empresa → si tenía baja de la sync, se reactiva; si no, nada.
 *  - No está habilitada en ninguna y TODAS sus empresas tuvieron corrida OK → baja.
 *  - Si alguna de sus empresas no tuvo corrida OK, no se decide (nada).
 */
export function decidirBaja(estado: EstadoVinculo, perfil: { estado?: unknown; bajaTango?: unknown }): DecisionBaja {
  const empresas = EMPRESAS.filter((e) => estado.vinculada[e])
  if (empresas.length === 0) return { accion: 'nada' }
  if (empresas.some((e) => estado.habilitada[e])) {
    return perfil.bajaTango && perfil.estado === 'inactivo' ? { accion: 'reactivar' } : { accion: 'nada' }
  }
  if (!empresas.every((e) => estado.corridaOk[e])) return { accion: 'nada' }
  if (perfil.estado === 'inactivo') return { accion: 'nada' }   // ya estaba de baja (por la sync o a mano)
  const inhabilitadas = empresas.filter((e) => estado.habilitada[e] === false)
  return { accion: 'baja', motivo: inhabilitadas.length ? 'inhabilitado en Tango' : 'no figura en Tango' }
}

/** Circuit breaker: ¿esta corrida trajo suficientes filas como para confiar en las ausencias? */
export function corridaConfiable(recibidas: number, anteriores: number | undefined | null): boolean {
  if (!anteriores || anteriores <= 0) return recibidas > 0
  return recibidas >= anteriores * UMBRAL_CIRCUIT_BREAKER
}
