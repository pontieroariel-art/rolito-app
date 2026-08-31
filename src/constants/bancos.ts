// Catálogo de bancos argentinos (código de entidad BCRA de 3 dígitos) para el
// alta de cheques en la cobranza de supervisor. Los de uso más frecuente
// primero; '000 Otro' como escape para entidades que no estén en la lista.

export interface Banco {
  codigo: string
  nombre: string
}

export const BANCOS: Banco[] = [
  { codigo: '011', nombre: 'Banco Nación' },
  { codigo: '014', nombre: 'Banco Provincia de Bs. As.' },
  { codigo: '007', nombre: 'Banco Galicia' },
  { codigo: '072', nombre: 'Banco Santander' },
  { codigo: '017', nombre: 'BBVA' },
  { codigo: '015', nombre: 'ICBC' },
  { codigo: '285', nombre: 'Banco Macro' },
  { codigo: '191', nombre: 'Banco Credicoop' },
  { codigo: '029', nombre: 'Banco Ciudad' },
  { codigo: '034', nombre: 'Banco Patagonia' },
  { codigo: '027', nombre: 'Banco Supervielle' },
  { codigo: '044', nombre: 'Banco Hipotecario' },
  { codigo: '259', nombre: 'Banco Itaú' },
  { codigo: '299', nombre: 'Banco Comafi' },
  { codigo: '158', nombre: 'Galicia Más (ex HSBC)' },
  { codigo: '016', nombre: 'Citibank' },
  { codigo: '322', nombre: 'Banco Industrial' },
  { codigo: '330', nombre: 'Nuevo Banco de Santa Fe' },
  { codigo: '386', nombre: 'Nuevo Banco de Entre Ríos' },
  { codigo: '268', nombre: 'Banco de Tierra del Fuego' },
  { codigo: '097', nombre: 'Banco Provincia del Neuquén' },
  { codigo: '093', nombre: 'Banco de La Pampa' },
  { codigo: '020', nombre: 'Banco de Córdoba (Bancor)' },
  { codigo: '045', nombre: 'Banco de San Juan' },
  { codigo: '309', nombre: 'Banco Rioja' },
  { codigo: '311', nombre: 'Banco del Chubut' },
  { codigo: '198', nombre: 'Banco Emprendedor' },
  { codigo: '247', nombre: 'Banco Roela' },
  { codigo: '254', nombre: 'Banco Mariva' },
  { codigo: '389', nombre: 'Banco Columbia' },
  { codigo: '426', nombre: 'Banco Bica' },
  { codigo: '435', nombre: 'Banco Voii' },
  { codigo: '448', nombre: 'Banco Dino' },
  { codigo: '000', nombre: 'Otro' },
]

export function nombreBanco(codigo: string): string {
  return BANCOS.find((b) => b.codigo === codigo)?.nombre ?? 'Otro'
}
