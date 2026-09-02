// ¿Se le puede facturar a este cliente?
//
// Sirve para avisarle al chofer ANTES de cerrar una venta contado, que es la que
// dispara la factura electrónica. Sin esto la venta se cierra igual, el chofer
// entrega y se va, y la factura rebota después — con la mercadería ya en poder
// del cliente y el comprobante colgado.
//
// ⚠️ Esto NO decide nada fiscal: la autoridad es `validarReceptor` en
// `functions/src/services/arca/comprobante.ts`, que corre en el servidor y es
// quien acepta o rechaza. Acá se replican sus mismas reglas para poder avisar a
// tiempo. Si allá se agrega una condición de IVA nueva, hay que reflejarla acá
// o el chofer va a ver un bloqueo que el backend ya no aplica.

/** Códigos de categoría de IVA de Tango que la app sabe facturar. */
const CATEGORIAS_FACTURABLES: Record<string, { descripcion: string; clase: 'A' | 'B' }> = {
  RI: { descripcion: 'Responsable Inscripto', clase: 'A' },
  RS: { descripcion: 'Responsable Monotributo', clase: 'A' },
  EX: { descripcion: 'Sujeto Exento', clase: 'A' },
  CF: { descripcion: 'Consumidor Final', clase: 'B' },
  NC: { descripcion: 'Sujeto No Categorizado', clase: 'B' },
  NA: { descripcion: 'IVA No Alcanzado', clase: 'B' },
}

/** Categorías que existen en Tango pero no corresponden a una venta de calle. */
const CATEGORIAS_QUE_NO_APLICAN: Record<string, string> = {
  EXE: 'está marcado como exportación',
}

/** CUIT con dígito verificador válido (mismo algoritmo que usa ARCA). */
export function esCuitValido(cuit: string): boolean {
  const d = String(cuit ?? '').replace(/\D/g, '')
  if (d.length !== 11) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((s, p, i) => s + p * Number(d[i]), 0)
  const resto = 11 - (suma % 11)
  const dv = resto === 11 ? 0 : resto === 10 ? 9 : resto
  return dv === Number(d[10])
}

export interface DatosFiscalesCliente {
  razonSocial?:       string
  cuit?:              string
  categoriaIvaTango?: string
}

export type ResultadoFacturable =
  | { facturable: true; clase: 'A' | 'B' }
  | { facturable: false; motivos: string[] }

/**
 * Los motivos se escriben para que los lea un chofer, no un contador: dicen qué
 * le falta al cliente, no el código del error.
 */
export function esClienteFacturable(cliente: DatosFiscalesCliente): ResultadoFacturable {
  const motivos: string[] = []

  const codigo = (cliente.categoriaIvaTango ?? '').trim().toUpperCase()
  let clase: 'A' | 'B' | null = null

  if (!codigo) {
    motivos.push('no tiene cargada la condición frente al IVA')
  } else if (CATEGORIAS_QUE_NO_APLICAN[codigo]) {
    motivos.push(CATEGORIAS_QUE_NO_APLICAN[codigo])
  } else if (!CATEGORIAS_FACTURABLES[codigo]) {
    motivos.push(`tiene una condición frente al IVA que no reconocemos ("${codigo}")`)
  } else {
    clase = CATEGORIAS_FACTURABLES[codigo].clase
  }

  const cuit = String(cliente.cuit ?? '').replace(/\D/g, '')
  if (!cuit) motivos.push('no tiene CUIT cargado')
  else if (!esCuitValido(cuit)) motivos.push(`tiene un CUIT inválido (${cuit})`)

  // Solo razón social, sin caer al nombre de fantasía: el trigger del servidor
  // manda `perfil.razonSocial` tal cual, así que un cliente cargado solo con
  // nombre igual va a ser rechazado. Avisarlo acá es el punto de todo esto.
  if (!String(cliente.razonSocial ?? '').trim()) {
    motivos.push('no tiene razón social')
  }

  if (motivos.length > 0 || !clase) return { facturable: false, motivos }
  return { facturable: true, clase }
}
