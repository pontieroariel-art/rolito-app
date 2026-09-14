// Acta del sobre de rendición (rendición de fondos, 2026-09-14). Esqueleto:
// la implementación real (pdfBase: nuevoA4, encabezadoA4, finTabla, firmaA4,
// salidaPdf) la completa la Fase 1. Contrato:
//   imprimirActaSobre(sobre)            → abre el PDF para imprimir
//   imprimirActaSobre(sobre, 'compartir') → lo comparte / descarga
import type { Sobre } from '@/types'

export async function imprimirActaSobre(_sobre: Sobre, _modo: 'imprimir' | 'compartir' = 'imprimir'): Promise<void> {
  throw new Error('Acta del sobre: todavía no implementada.')
}
