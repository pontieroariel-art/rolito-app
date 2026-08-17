import { AreaHeladera, EstadoHeladera, EstadoTicketServicio, TipoOperacionIngreso, TipoPipelineHeladera, UserRole } from '../types'

export const ESTADO_HELADERA_LABELS: Record<EstadoHeladera, string> = {
  en_taller:   'En taller',
  disponible:  'Disponible',
  en_comodato: 'En comodato',
  baja:        'Baja',
}

export const TIPO_OPERACION_LABELS: Record<TipoOperacionIngreso, string> = {
  RETIRO: 'Retiro',
  CAMBIO: 'Cambio',
}

export const TIPO_PIPELINE_LABELS: Record<TipoPipelineHeladera, string> = {
  fabricacion:          'Fabricación',
  reacondicionamiento:  'Reacondicionamiento',
}

// Antes vivía suelto en CrearStaffModal.tsx (único lugar que lo necesitaba);
// ahora también lo usan el catálogo de pasos de taller y el tablero.
export const AREA_HELADERA_LABELS: Record<AreaHeladera, string> = {
  produccion:          'Producción',
  lijado:              'Lijado',
  pintura:             'Pintura',
  refrigeracion:       'Refrigeración',
  servicio_tecnico:    'Servicio técnico',
  plastico:            'Plástico',
  ensamble_inyectado:  'Ensamble e inyectado',
  terminacion:         'Terminación',
}

export const ESTADO_TICKET_LABELS: Record<EstadoTicketServicio, string> = {
  abierto:           'Abierto',
  asignado_tecnico:  'Con técnico',
  asignado_chofer:   'Con chofer',
  cerrado:           'Cerrado',
  anulado:           'Anulado',
}

export const ESTADO_TICKET_STYLES: Record<EstadoTicketServicio, string> = {
  abierto:           'bg-amber-100 text-amber-700 border-amber-200',
  asignado_tecnico:  'bg-blue-100 text-blue-700 border-blue-200',
  asignado_chofer:   'bg-blue-100 text-blue-700 border-blue-200',
  cerrado:           'bg-green-100 text-green-700 border-green-200',
  anulado:           'bg-gray-100 text-gray-500 border-gray-200',
}

// Sectores que hacen trabajos de reparación — sectorizan tanto a los técnicos
// (su propio perfil) como al catálogo de tipos de reparación. Subconjunto de
// AreaHeladera: no incluye los sectores de fabricación (plástico, ensamble e
// inyectado, terminación) ni producción/servicio técnico.
export const SECTORES_REPARACION: AreaHeladera[] = ['pintura', 'lijado', 'refrigeracion']

// Acceso completo al módulo heladeras (más allá del taller): encargado,
// super_admin y gerente_comercial — mismo criterio que isHeladerasFullAccess()
// en firestore.rules (esa es la que manda; esto es solo para mostrar/ocultar
// UI del lado del cliente). Antes estaba copiado a mano en 4 lugares
// distintos — un cambio de quién gestiona heladeras necesitaba acordarse de
// tocar los 4; ahora es uno solo.
const HELADERAS_FULL_ACCESS_ROLES: UserRole[] = ['heladeras_encargado', 'super_admin', 'gerente_comercial']

export function puedeGestionarHeladeras(rol: UserRole | undefined): boolean {
  return !!rol && HELADERAS_FULL_ACCESS_ROLES.includes(rol)
}
