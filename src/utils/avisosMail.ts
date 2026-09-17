// Avisos internos que la app manda por mail a la oficina (2026-09-17, pedido
// de Ariel: "que se manden a donde deberían ir", no todo a su Gmail). Cada
// tipo tiene su lista de destinatarios en configuracion/notificaciones.avisos
// .<tipo>; un tipo sin lista propia cae en la lista general `emails`. Espejo
// de `TipoAviso` en functions/src/email.ts (destinatariosAviso).

export type TipoAviso = 'nuevoPedido' | 'nuevoCliente' | 'backoffice' | 'padronIIBB'

export const TIPOS_AVISO: TipoAviso[] = ['nuevoPedido', 'nuevoCliente', 'backoffice', 'padronIIBB']

export const AVISOS: Record<TipoAviso, { titulo: string; descripcion: string }> = {
  nuevoPedido:  { titulo: 'Nuevo pedido',   descripcion: 'Cuando un cliente carga un pedido en la app.' },
  nuevoCliente: { titulo: 'Nuevo cliente',  descripcion: 'Cuando alguien del staff crea un cliente nuevo.' },
  backoffice:   { titulo: 'Backoffice',     descripcion: 'Cambios de alto riesgo (roles, altas y bajas, "Ver como") al instante y el resumen diario de las 7.' },
  padronIIBB:   { titulo: 'Padrón de IIBB', descripcion: 'Cuando el padrón de percepciones está por vencer o venció.' },
}

/** Campo de Firestore donde vive la lista: `emails` (general) o `avisos.<tipo>`. */
export const campoDeAviso = (tipo?: TipoAviso): string => (tipo ? `avisos.${tipo}` : 'emails')

/** Lista de un tipo leída del doc `configuracion/notificaciones`, sin resolver el respaldo. */
export const listaDeAviso = (data: Record<string, unknown> | undefined, tipo?: TipoAviso): string[] => {
  if (!data) return []
  const cruda = tipo ? (data.avisos as Partial<Record<TipoAviso, unknown>> | undefined)?.[tipo] : data.emails
  return Array.isArray(cruda) ? cruda.filter((e): e is string => typeof e === 'string') : []
}
