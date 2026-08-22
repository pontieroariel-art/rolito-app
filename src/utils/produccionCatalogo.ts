import { ProductoHieloId } from '../types'

// Catálogo cerrado de productos de producción de hielo — confirmado por
// Redonhielo, un cambio acá es un deploy, no una pantalla de edición.
export interface ProductoHieloDef {
  id:                ProductoHieloId
  nombre:            string   // "Bolsas 10kg Rolito" — para los botones de carga
  descripcionTicket: string   // línea de descripción del ticket, ej. "HIELO EN BOLSA ROLITO 10KG"
  tamanioTicket:     string   // texto grande del ticket, ej. "10KG"
  unidadesPorPallet: number
  unidadLabel:       'bolsas' | 'barras'
}

export const PRODUCTOS_HIELO: Record<ProductoHieloId, ProductoHieloDef> = {
  bolsas_10kg_rolito: {
    id: 'bolsas_10kg_rolito', nombre: 'Bolsas 10kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 10KG', tamanioTicket: '10KG',
    unidadesPorPallet: 88, unidadLabel: 'bolsas',
  },
  bolsas_3kg_rolito: {
    id: 'bolsas_3kg_rolito', nombre: 'Bolsas 3kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 3KG', tamanioTicket: '3KG',
    unidadesPorPallet: 315, unidadLabel: 'bolsas',
  },
  bolsas_2kg_rolito: {
    id: 'bolsas_2kg_rolito', nombre: 'Bolsas 2kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 2KG', tamanioTicket: '2KG',
    unidadesPorPallet: 460, unidadLabel: 'bolsas',
  },
  picado_10kg: {
    id: 'picado_10kg', nombre: 'Hielo picado bolsa 10kg',
    descripcionTicket: 'HIELO PICADO BOLSA 10KG', tamanioTicket: '10KG',
    unidadesPorPallet: 80, unidadLabel: 'bolsas',
  },
  escama_10kg: {
    id: 'escama_10kg', nombre: 'Escama bolsa 10kg',
    descripcionTicket: 'HIELO EN ESCAMA BOLSA 10KG', tamanioTicket: '10KG',
    unidadesPorPallet: 70, unidadLabel: 'bolsas',
  },
  barras_hielo: {
    id: 'barras_hielo', nombre: 'Barras de hielo',
    descripcionTicket: 'BARRAS DE HIELO', tamanioTicket: 'BARRA',
    unidadesPorPallet: 56, unidadLabel: 'barras',
  },
  rembolsado_cementera_10kg: {
    id: 'rembolsado_cementera_10kg', nombre: 'Rembolsado cementera bolsa 10kg',
    descripcionTicket: 'HIELO REMBOLSADO CEMENTERA 10KG', tamanioTicket: '10KG',
    unidadesPorPallet: 88, unidadLabel: 'bolsas',
  },
}

export const PRODUCTOS_HIELO_LIST: ProductoHieloDef[] = Object.values(PRODUCTOS_HIELO)
