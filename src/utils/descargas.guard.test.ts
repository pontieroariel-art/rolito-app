import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// Guardián del visor de comprobantes (2026-09-15, pedido de Ariel: "erradicar la
// descarga automática forzada"). Ningún papel se baja solo: se abre en el visor
// (`components/ui/VisorComprobante.tsx`) y descargar es un clic explícito adentro.
// Este test lee `src/` como texto y falla si aparece una descarga fuera de los
// pocos lugares que la tienen por decisión: así, agregar una nueva obliga a
// pensarla (y a sumarla acá con su porqué), en vez de volver a la costumbre vieja.

const RAIZ = resolve(__dirname, '..')

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return archivos(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

const rel = (p: string) => relative(RAIZ, p).replace(/\\/g, '/')

/** Dónde puede aparecer cada primitiva de descarga, y por qué. */
const PERMITIDOS: Record<string, { patron: RegExp; en: string[] }> = {
  'doc.save(': {
    patron: /\bdoc\.save\(/,
    en: ['utils/pdfBase.ts'], // salidaPdf: único lugar que baja un jsPDF, y solo con descargar === true
  },
  'descargarArchivo(s)(': {
    patron: /\bdescargarArchivos?\(/,
    en: [
      'utils/compartir.ts',                                  // la primitiva y el fallback de compartir
      'components/ui/VisorComprobante.tsx',                  // el botón Descargar del visor
      'components/ui/MenuCompartirPdf.tsx',                  // opción "Descargar" elegida a mano en el menú
      'pages/comercial/facturacion/ComprobantesClientesPage.tsx', // descarga en lote, el botón dice "Descargar"
      'utils/ticketTermico.ts',                              // ventanilla sin impresora: Ariel pidió dejarla como está
    ],
  },
  'descargar: true': {
    patron: /\bdescargar:\s*true\b/,
    en: ['pages/comercial/facturacion/RecuperoFacturasPage.tsx'], // "Descargar las N": lote a pedido; una sola factura va al visor
  },
  'a.download =': {
    patron: /\.download\s*=/,
    en: ['utils/compartir.ts', 'utils/csv.ts'], // CSV/Excel no son comprobantes: quedan como descarga directa
  },
}

describe('descargas: ningún comprobante se baja solo', () => {
  const todos = archivos(RAIZ)

  for (const [nombre, { patron, en }] of Object.entries(PERMITIDOS)) {
    it(`${nombre} solo en los archivos permitidos`, () => {
      const fuera = todos.filter((p) => patron.test(readFileSync(p, 'utf8')) && !en.includes(rel(p))).map(rel)
      expect(fuera, `Apareció "${nombre}" fuera de la lista. Abrilo en el visor (useVisorComprobante) o, si es una descarga en lote a pedido, sumalo a PERMITIDOS con el porqué.`).toEqual([])
    })
  }

  it('los permitidos existen (si se mueve un archivo, actualizar la lista)', () => {
    const existentes = new Set(todos.map(rel))
    for (const { en } of Object.values(PERMITIDOS)) for (const p of en) expect(existentes.has(p), p).toBe(true)
  })
})
