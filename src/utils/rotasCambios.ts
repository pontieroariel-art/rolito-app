// Rotas y cambios en palabras (2026-09-26, muelle: "la bolsa que se rompió en
// el camión me da faltante"). La regla es la misma que va a Tango: con el conteo
// del muelle, lo que falta = salió − vendió − rotas − sanas. Cada bolsa rota va a
// merma venga de donde venga (de un cambio o rota en el camión); un cambio sin
// su bolsa rota es faltante.

/** "7 rotas: 5 de los cambios + 2 rotas en el camión". null si no hay nada que explicar. */
export function explicarRotas(cambios: number, rotas: number): string | null {
  if (cambios <= 0 && rotas <= 0) return null
  const b = (n: number) => `${n} ${n === 1 ? 'bolsa' : 'bolsas'}`
  if (rotas === cambios) return `${b(rotas)} ${rotas === 1 ? 'rota' : 'rotas'}: ${rotas === 1 ? 'la del cambio' : 'las de los cambios'}. A merma.`
  if (rotas > cambios) {
    const enCamion = rotas - cambios
    return cambios > 0
      ? `${b(rotas)} rotas: ${cambios} de los cambios + ${enCamion} ${enCamion === 1 ? 'rota' : 'rotas'} en el camión. Todas a merma, no son faltante.`
      : `${b(rotas)} ${rotas === 1 ? 'rota' : 'rotas'} en el camión. A merma, no ${rotas === 1 ? 'es' : 'son'} faltante.`
  }
  const sinRota = cambios - rotas
  return `${cambios} ${cambios === 1 ? 'cambio' : 'cambios'} pero ${rotas === 1 ? 'volvió 1 rota' : `volvieron ${rotas} rotas`}: ${sinRota} ${sinRota === 1 ? 'cambio sin su bolsa rota cuenta' : 'cambios sin su bolsa rota cuentan'} como faltante.`
}

export interface ItemDescarga { productoId: string; nombre: string; cantidad: number }

/**
 * Lo que va a pasar con la descarga, para la confirmación del muelle. Se arma
 * solo con lo que cargó el muellero (el conteo sigue ciego). `dudosos` son los
 * productos con varias rotas y ninguna sana: casi siempre es mercadería sana
 * anotada en el casillero equivocado, y se iría a merma.
 */
export function resumenDescarga(sanas: ItemDescarga[], rotas: ItemDescarga[], minimoDudoso = 5) {
  const sana = new Map(sanas.map((i) => [i.productoId, i.cantidad]))
  return {
    aPlanta: sanas.filter((i) => i.cantidad > 0),
    aMerma: rotas.filter((i) => i.cantidad > 0),
    dudosos: rotas.filter((i) => i.cantidad >= minimoDudoso && !(sana.get(i.productoId) ?? 0)),
  }
}
