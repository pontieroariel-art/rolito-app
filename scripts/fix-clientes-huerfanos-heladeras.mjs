/**
 * fix-clientes-huerfanos-heladeras.mjs — cuentas duplicadas de la importación de heladeras.
 *
 * El 2026-08-25 la importación de heladeras creó una cuenta de cliente por cada
 * código de Tango que no encontró en la app (sin CUIT, `aprobadoPor:
 * 'importacion-heladeras'`). Después el padrón automático vinculó esos mismos
 * códigos como SUCURSALES de la cuenta principal del CUIT (Grupo 2000 suc. 68 →
 * cuenta Grupo 2000), así que quedaron 15 cuentas activas sin vínculo con Tango,
 * elegibles en los buscadores y nunca evaluadas para la baja (2026-09-11).
 *
 * Por cada cuenta huérfana (activa, sin tangoIds, creada por esa importación):
 *   - si otro cliente tiene ese código en `tangoIds`: las heladeras que la
 *     apuntan (`clienteAsignadoId`) pasan a esa cuenta con la sucursal
 *     (`clienteAsignadoDireccionId` = código) y la huérfana queda `inactivo`
 *     con `bajaTango: { motivo: 'duplicada: sucursal de otra cuenta' }`;
 *   - si nadie tiene el código (no existe más en Tango): solo se desactiva; sus
 *     heladeras quedan como están, para revisarlas a mano.
 *
 * Uso:  node scripts/fix-clientes-huerfanos-heladeras.mjs            → dry-run
 *       node scripts/fix-clientes-huerfanos-heladeras.mjs --commit
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'
const require   = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const admin     = require('../functions/node_modules/firebase-admin/lib/index.js')
const sa = JSON.parse(readFileSync(path.join(__dirname, 'serviceAccount.json'), 'utf8'))
admin.initializeApp({ credential: admin.credential.cert(sa) })
const db = admin.firestore()
const { FieldValue } = admin.firestore
const COMMIT = process.argv.includes('--commit')

const clientes = (await db.collection('users').where('rol', '==', 'cliente').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
const huerfanas = clientes.filter((u) => u.aprobadoPor === 'importacion-heladeras' && u.estado === 'activo' && !(u.tangoIds?.redonhielo?.length || u.tangoIds?.rolito?.length))
const duenoDeCodigo = new Map()
for (const u of clientes) for (const e of ['redonhielo', 'rolito']) for (const t of (u.tangoIds?.[e] ?? [])) if (!duenoDeCodigo.has(t.codigo)) duenoDeCodigo.set(t.codigo, u)

console.log(`Cuentas huérfanas: ${huerfanas.length}\n`)
let heladerasMovidas = 0, desactivadas = 0
for (const h of huerfanas) {
  const codigo = String(h.codigoCliente ?? '').trim()
  const dueno = duenoDeCodigo.get(codigo)
  const heladeras = (await db.collection('heladeras').where('clienteAsignadoId', '==', h.id).get()).docs
  if (dueno) {
    const dir = (dueno.addresses ?? []).find((a) => a.id === codigo)
    console.log(`${codigo.padEnd(8)} ${(h.razonSocial ?? '').slice(0, 40).padEnd(41)} → ${dueno.razonSocial} (${dueno.id})${dir ? ` · sucursal "${dir.nombre ?? dir.address}"` : ' · SIN dirección con ese código en la cuenta'} · ${heladeras.length} heladera(s)`)
    for (const d of heladeras) {
      heladerasMovidas++
      if (!COMMIT) continue
      await d.ref.update({
        clienteAsignadoId: dueno.id,
        clienteAsignadoNombre: dueno.razonSocial ?? dueno.nombre ?? '',
        ...(dir ? { clienteAsignadoDireccionId: codigo, clienteAsignadoDireccion: dir.address ?? '' } : {}),
      })
    }
  } else {
    console.log(`${codigo.padEnd(8)} ${(h.razonSocial ?? '').slice(0, 40).padEnd(41)} → nadie tiene el código (no está en Tango) · ${heladeras.length} heladera(s) quedan apuntando a la cuenta inactiva: revisar a mano`)
  }
  desactivadas++
  if (COMMIT) await db.doc(`users/${h.id}`).update({ estado: 'inactivo', bajaTango: { fecha: FieldValue.serverTimestamp(), motivo: dueno ? 'duplicada: sucursal de otra cuenta' : 'no figura en Tango' } })
}
console.log(`\n${desactivadas} cuentas a desactivar · ${heladerasMovidas} heladeras a reasignar`)
console.log(COMMIT ? 'APLICADO' : 'DRY-RUN — correr con --commit para aplicar')
process.exit(0)
