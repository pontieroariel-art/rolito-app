import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CATALOGO, NAVBAR, PANEL, IR_A, SIDEBARS,
  gruposDe, linksNavbarDe, accesosDelPanel, grupoIrA, pathsEnMenus, rutaDe,
} from './catalogo'
import { ROLES } from '@/utils/roles'

// App.tsx leído como texto: cada <Route path> con el allowedRoles del
// <ProtectedRoute> que lo envuelve (rolesDe('<path>'), o sin lista = requiereAuth).
type RutaApp = { path: string; roles: string[] | null; protegida: boolean }

function rutasDeApp(): RutaApp[] {
  const src = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8').split(/\r?\n/)
  const pila: Array<{ roles: string[] | null } | null> = []
  const rutas: RutaApp[] = []
  for (const l of src) {
    if (/^\s*<Route\b/.test(l) && !/\bpath=/.test(l)) {
      const m = l.match(/allowedRoles=\{rolesDe\('([^']+)'\)\}/)
      if (m) pila.push({ roles: rutaDe(m[1]).roles })
      else if (/allowedRoles=/.test(l)) throw new Error(`allowedRoles a mano en App.tsx: ${l.trim()}`)
      else if (/<ProtectedRoute\b/.test(l)) pila.push({ roles: null })
      else pila.push(null)
      continue
    }
    if (/^\s*<\/Route>/.test(l)) { pila.pop(); continue }
    const r = l.match(/<Route\s+path="([^"]+)"/)
    if (!r || r[1] === '*') continue
    const guard = [...pila].reverse().find((p) => p !== null) ?? null
    rutas.push({ path: r[1], roles: guard?.roles ?? null, protegida: guard !== null })
  }
  return rutas
}

const pathDe = (e: string | { path: string }) => (typeof e === 'string' ? e : e.path)

describe('catálogo de rutas', () => {
  it('no repite paths y todos empiezan con /', () => {
    const paths = CATALOGO.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((p) => p.startsWith('/'))).toBe(true)
  })

  it('solo usa roles que existen', () => {
    for (const r of CATALOGO) {
      for (const rol of [...r.roles, ...(r.rolesMenu ?? [])]) expect(ROLES, `${r.path}: ${rol}`).toContain(rol)
    }
  })

  it('rolesMenu nunca ofrece el link a un rol que la ruta no deja pasar', () => {
    for (const r of CATALOGO) {
      for (const rol of r.rolesMenu ?? []) expect(r.roles, `${r.path}: ${rol}`).toContain(rol)
    }
  })

  it('requiereAuth va sin lista de roles', () => {
    for (const r of CATALOGO) if (r.requiereAuth) expect(r.roles, r.path).toEqual([])
  })

  it('coincide con App.tsx: mismas rutas y mismos roles', () => {
    const app = rutasDeApp()
    expect(app.length).toBeGreaterThan(90)
    const enApp = new Set(app.map((r) => r.path))
    const enCatalogo = new Set(CATALOGO.map((r) => r.path))
    expect([...enApp].filter((p) => !enCatalogo.has(p)), 'en App.tsx y no en el catálogo').toEqual([])
    expect([...enCatalogo].filter((p) => !enApp.has(p)), 'en el catálogo y no en App.tsx').toEqual([])
    for (const r of app) {
      const c = rutaDe(r.path)
      if (!r.protegida) {
        expect(c.roles, `${r.path} es pública en App.tsx`).toEqual([])
        expect(c.requiereAuth ?? false, r.path).toBe(false)
      } else if (r.roles === null) {
        expect(c.requiereAuth, `${r.path} es <ProtectedRoute> sin roles`).toBe(true)
      } else {
        // El bloque de App.tsx toma los roles de su primera ruta: todas las del
        // bloque tienen que declarar exactamente esos roles en el catálogo.
        expect(c.roles, `${r.path} comparte bloque con otra ruta de roles distintos`).toEqual(r.roles)
      }
    }
  })
})

describe('menús derivados', () => {
  it('cada entrada de menú apunta a una ruta del catálogo con ícono', () => {
    for (const p of pathsEnMenus()) expect(rutaDe(p).icon, `${p} sin ícono`).toBeDefined()
    expect(() => (Object.keys(SIDEBARS) as Array<keyof typeof SIDEBARS>).forEach((s) => gruposDe(s))).not.toThrow()
    expect(() => ROLES.forEach((r) => linksNavbarDe(r))).not.toThrow()
    expect(() => accesosDelPanel()).not.toThrow()
    expect(() => grupoIrA()).not.toThrow()
  })

  it('un menú no lista dos veces el mismo path', () => {
    for (const [s, grupos] of Object.entries(SIDEBARS)) {
      const paths = grupos.flatMap((g) => g.paths)
      expect(new Set(paths).size, s).toBe(paths.length)
    }
    for (const [rol, paths] of Object.entries(NAVBAR)) expect(new Set(paths).size, rol).toBe(paths.length)
    const panel = PANEL.flatMap((g) => g.entradas.map(pathDe))
    expect(new Set(panel).size).toBe(panel.length)
    const irA = IR_A.map(pathDe)
    expect(new Set(irA).size).toBe(irA.length)
  })

  it('el Navbar de un rol solo lleva a rutas que ese rol puede abrir', () => {
    for (const rol of ROLES) {
      for (const p of NAVBAR[rol]) expect(rutaDe(p).roles, `${rol} → ${p}`).toContain(rol)
    }
  })

  it('las pantallas de detalle (deepLink) no están en ningún menú', () => {
    const enMenus = new Set(pathsEnMenus())
    for (const r of CATALOGO) if (r.deepLink) expect(enMenus.has(r.path), r.path).toBe(false)
  })

  it('toda pantalla con ícono aparece en algún menú', () => {
    const enMenus = new Set(pathsEnMenus())
    const sueltas = CATALOGO.filter((r) => r.icon && !enMenus.has(r.path)).map((r) => r.path)
    expect(sueltas).toEqual([])
  })
})
