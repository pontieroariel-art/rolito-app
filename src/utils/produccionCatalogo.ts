import { ProductoHieloId } from '../types'

// Catálogo cerrado de productos de producción de hielo — confirmado por
// Redonhielo, un cambio acá es un deploy, no una pantalla de edición.
export interface ProductoHieloDef {
  id:                ProductoHieloId
  nombre:            string   // "Bolsas 10kg Rolito" — para los botones de carga
  descripcionTicket: string   // línea de descripción del ticket, ej. "HIELO EN BOLSA ROLITO 10KG"
  tamanioTicket:     string   // texto grande del ticket, ej. "10KG"
  // Texto grande del botón en la grilla de carga (tablet). NO es tamanioTicket:
  // cuatro productos son "10KG" y el operario en el campo elige por la palabra
  // distintiva (PICADO/ESCAMA/CEMENTERA), no por el peso — pedido de Ariel
  // 2026-08-28 tras ver la grilla con cuatro botones gritando "10KG".
  etiquetaGrilla:    string
  unidadesPorPallet: number
  unidadLabel:       'bolsas' | 'barras'
  // Color categórico para distinguir productos de un vistazo en la grilla
  // de carga (tablet de planta, "no pueden pifiar" con guantes/apuro) —
  // paleta validada anti-daltonismo (dataviz skill), nunca es el ÚNICO
  // identificador: siempre va acompañado del nombre completo en texto.
  color:             string
}

export const PRODUCTOS_HIELO: Record<ProductoHieloId, ProductoHieloDef> = {
  bolsas_10kg_rolito: {
    id: 'bolsas_10kg_rolito', nombre: 'Bolsas 10kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 10KG', tamanioTicket: '10KG', etiquetaGrilla: '10KG',
    unidadesPorPallet: 88, unidadLabel: 'bolsas', color: '#2a78d6',
  },
  bolsas_3kg_rolito: {
    id: 'bolsas_3kg_rolito', nombre: 'Bolsas 3kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 3KG', tamanioTicket: '3KG', etiquetaGrilla: '3KG',
    unidadesPorPallet: 315, unidadLabel: 'bolsas', color: '#eb6834',
  },
  bolsas_2kg_rolito: {
    id: 'bolsas_2kg_rolito', nombre: 'Bolsas 2kg Rolito',
    descripcionTicket: 'HIELO EN BOLSA ROLITO 2KG', tamanioTicket: '2KG', etiquetaGrilla: '2KG',
    unidadesPorPallet: 460, unidadLabel: 'bolsas', color: '#1baf7a',
  },
  picado_10kg: {
    id: 'picado_10kg', nombre: 'Hielo picado bolsa 10kg',
    descripcionTicket: 'HIELO PICADO BOLSA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'PICADO',
    unidadesPorPallet: 80, unidadLabel: 'bolsas', color: '#eda100',
  },
  escama_10kg: {
    id: 'escama_10kg', nombre: 'Escama bolsa 10kg',
    descripcionTicket: 'HIELO EN ESCAMA BOLSA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'ESCAMA',
    unidadesPorPallet: 70, unidadLabel: 'bolsas', color: '#e87ba4',
  },
  barras_hielo: {
    id: 'barras_hielo', nombre: 'Barras de hielo',
    descripcionTicket: 'BARRAS DE HIELO', tamanioTicket: 'BARRA', etiquetaGrilla: 'BARRA',
    unidadesPorPallet: 56, unidadLabel: 'barras', color: '#008300',
  },
  rembolsado_cementera_10kg: {
    id: 'rembolsado_cementera_10kg', nombre: 'Rembolsado cementera bolsa 10kg',
    descripcionTicket: 'HIELO REMBOLSADO CEMENTERA 10KG', tamanioTicket: '10KG', etiquetaGrilla: 'CEMENTERA',
    unidadesPorPallet: 88, unidadLabel: 'bolsas', color: '#4a3aa7',
  },
}

export const PRODUCTOS_HIELO_LIST: ProductoHieloDef[] = Object.values(PRODUCTOS_HIELO)
