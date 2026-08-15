import { AreaHeladera, EstadoHeladera, TipoOperacionIngreso, TipoPipelineHeladera } from '../types'

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

// Sectores que hacen trabajos de reparación — sectorizan tanto a los técnicos
// (su propio perfil) como al catálogo de tipos de reparación. Subconjunto de
// AreaHeladera: no incluye los sectores de fabricación (plástico, ensamble e
// inyectado, terminación) ni producción/servicio técnico.
export const SECTORES_REPARACION: AreaHeladera[] = ['pintura', 'lijado', 'refrigeracion']
