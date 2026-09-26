import { PlantaId, ProductoHieloId } from '../types'

// Catálogo cerrado de productos de producción de hielo — confirmado por
// Redonhielo, un cambio acá es un deploy, no una pantalla de edición.
export interface ProductoHieloDef {
  id:                ProductoHieloId
  nombre:            string   // "Bolsas 10kg Rolito" — para los botones de carga
  descripcionTicket: string   // línea de descripción del ticket, ej. "HIELO EN BOLSA ROLITO 10KG"
  tamanioTicket:     string   // texto grande del ticket, ej. "10KG"
  // Palabra distintiva del producto, en grande en la grilla de carga (tablet)
  // y en el texto grande del ticket impreso. NO es tamanioTicket: cuatro
  // productos son "10KG" y tanto el operario como quien mira pallets en la
  // cámara identifican por PICADO/ESCAMA/CEMENTERA, no por el peso — pedido
  // de Ariel 2026-08-28.
  etiquetaGrilla:    string
  unidadesPorPallet: number
  unidadLabel:       'bolsas' | 'barras'
  // Color categórico para distinguir productos de un vistazo en la grilla
  // de carga (tablet de planta, "no pueden pifiar" con guantes/apuro) —
  // paleta validada anti-daltonismo (dataviz skill), nunca es el ÚNICO
  // identificador: siempre va acompañado del nombre completo en texto.
  color:             string
  // Etiqueta del pallet (2026-09-25, diseño "una banda por producto"): en la
  // cámara de frío el pallet se reconoce de lejos por el código corto en
  // blanco sobre negro y por un PATRÓN distinto por producto, que se
  // distingue sin leer. La Zebra es térmica: todo en negro.
  codigoCorto:       string        // '10', '3', 'PIC'… en el bloque negro
  nombreEtiqueta:    string        // 'BOLSA 10 KG', 'PICADO 10 KG'…
  patron:            PatronEtiqueta
  // Plantas que lo fabrican (2026-09-25, dato de Ariel: las barras se hacen
  // en Merlo, no en Torcuato). Sin el campo = las dos. La tablet de cada
  // planta muestra solo lo suyo, así nadie toca un producto que ahí no se hace.
  plantas?:          PlantaId[]
}

/** Patrón de la banda de la etiqueta: cada producto el suyo, bien distinto de lejos. */
export type PatronEtiqueta = 'liso' | 'verticales' | 'horizontales' | 'cuadros' | 'diagonales' | 'marco' | 'puntos'

export const PRODUCTOS_HIELO: Record<ProductoHieloId, ProductoHieloDef> = {
  bolsas_10kg_rolito: {
    id: 'bolsas_10kg_rolito', nombre: 'Bolsas 10kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 10KG', tamanioTicket: '10KG', etiquetaGrilla: '10KG',
    unidadesPorPallet: 88, unidadLabel: 'bolsas', color: '#2a78d6',
    codigoCorto: '10', nombreEtiqueta: 'BOLSA 10 KG', patron: 'liso',
  },
  bolsas_3kg_rolito: {
    id: 'bolsas_3kg_rolito', nombre: 'Bolsas 3kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 3KG', tamanioTicket: '3KG', etiquetaGrilla: '3KG',
    unidadesPorPallet: 315, unidadLabel: 'bolsas', color: '#eb6834',
    codigoCorto: '3', nombreEtiqueta: 'BOLSA 3 KG', patron: 'verticales',
  },
  bolsas_2kg_rolito: {
    id: 'bolsas_2kg_rolito', nombre: 'Bolsas 2kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 2KG', tamanioTicket: '2KG', etiquetaGrilla: '2KG',
    unidadesPorPallet: 460, unidadLabel: 'bolsas', color: '#1baf7a',
    codigoCorto: '2', nombreEtiqueta: 'BOLSA 2 KG', patron: 'horizontales',
  },
  picado_10kg: {
    id: 'picado_10kg', nombre: 'Hielo picado bolsa 10kg',
    descripcionTicket: 'HIELO PICADO BOLSA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'PICADO',
    unidadesPorPallet: 80, unidadLabel: 'bolsas', color: '#eda100',
    codigoCorto: 'PIC', nombreEtiqueta: 'PICADO 10 KG', patron: 'cuadros',
  },
  escama_10kg: {
    id: 'escama_10kg', nombre: 'Escama bolsa 10kg',
    descripcionTicket: 'HIELO EN ESCAMA BOLSA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'ESCAMA',
    unidadesPorPallet: 70, unidadLabel: 'bolsas', color: '#e87ba4',
    codigoCorto: 'ESC', nombreEtiqueta: 'ESCAMA 10 KG', patron: 'diagonales',
  },
  barras_hielo: {
    id: 'barras_hielo', nombre: 'Barras de hielo',
    descripcionTicket: 'BARRAS DE HIELO', tamanioTicket: 'BARRA', etiquetaGrilla: 'BARRA',
    unidadesPorPallet: 56, unidadLabel: 'barras', color: '#008300',
    codigoCorto: 'BAR', nombreEtiqueta: 'BARRAS', patron: 'marco',
    plantas: ['merlo'],
  },
  rembolsado_cementera_10kg: {
    id: 'rembolsado_cementera_10kg', nombre: 'Rembolsado cementera bolsa 10kg',
    descripcionTicket: 'HIELO REMBOLSADO CEMENTERA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'CEMENTERA',
    unidadesPorPallet: 88, unidadLabel: 'bolsas', color: '#4a3aa7',
    codigoCorto: 'CEM', nombreEtiqueta: 'CEMENTERA 10 KG', patron: 'puntos',
  },
}

export const PRODUCTOS_HIELO_LIST: ProductoHieloDef[] = Object.values(PRODUCTOS_HIELO)

/** Los productos que se fabrican en una planta, en el orden del catálogo. */
export function productosDePlanta(planta: PlantaId): ProductoHieloDef[] {
  return PRODUCTOS_HIELO_LIST.filter((p) => !p.plantas || p.plantas.includes(planta))
}
