import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CATALOGO, NAVBAR, PANEL, SIDEBARS,
  gruposDe, gruposVisibles, linksNavbarDe, accesosDelPanel, pathsEnMenus, pathDe, rutaDe, homeDeSistema, sistemaDeRuta,
} from './catalogo'
import { ROLES } from '@/utils/roles'
import { ROLE_SISTEMAS, ROLE_HOME, SISTEMAS } from '@/utils/sistemas'
import type { Sistema, UserRole } from '@/types'

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

const usuario = (rol: UserRole) => ({ rol, rolesExtra: undefined })

// Pantallas con ícono a las que un rol puede entrar pero que, a propósito, no
// tiene en ningún menú (se abren por link contextual, QR o URL).
const SIN_MENU: Partial<Record<UserRole, string[]>> = {
  comercial:            ['/produccion/listado'],          // link contextual, no tiene dominio Logística
  gerente_general:      ['/heladeras/informes', '/heladeras/mapa'], // "Ver informes" desde el panel de directores
  heladeras_encargado:  ['/anulaciones'],                 // permiso individual: la bandeja llega por push
  produccion_encargado: ['/anulaciones'],
  tesoreria:            ['/anulaciones'],                 // tiene /tesoreria/anulaciones en su menú
  supervisor:           ['/anulaciones'],
  muelle:               ['/muelle/tv'],                   // kiosco: se abre por URL en la TV
}

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
    expect(() => SISTEMAS.forEach((s) => gruposDe(s))).not.toThrow()
    expect(() => ROLES.forEach((r) => linksNavbarDe(r))).not.toThrow()
    expect(() => accesosDelPanel()).not.toThrow()
  })

  it('un menú no lista dos veces el mismo path', () => {
    for (const [s, grupos] of Object.entries(SIDEBARS)) {
      const paths = grupos.flatMap((g) => g.entradas.map(pathDe))
      expect(new Set(paths).size, s).toBe(paths.length)
    }
    for (const [rol, paths] of Object.entries(NAVBAR)) expect(new Set(paths).size, rol).toBe(paths.length)
    const panel = PANEL.flatMap((g) => g.entradas.map(pathDe))
    expect(new Set(panel).size).toBe(panel.length)
  })

  it('el menuGroup de cada ruta es un grupo que la lista, y toda entrada de sidebar tiene menuGroup', () => {
    for (const r of CATALOGO) {
      if (!r.menuGroup) continue
      const listada = Object.values(SIDEBARS).some((gs) => gs.some((g) => g.id === r.menuGroup && g.entradas.some((e) => pathDe(e) === r.path)))
      expect(listada, `${r.path}: menuGroup ${r.menuGroup} no lo lista`).toBe(true)
    }
    for (const gs of Object.values(SIDEBARS)) for (const g of gs) for (const e of g.entradas) {
      expect(rutaDe(pathDe(e)).menuGroup, `${pathDe(e)} está en un sidebar sin menuGroup`).toBeDefined()
    }
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

describe('dominios por rol', () => {
  it('ningún dominio de un rol queda vacío', () => {
    for (const rol of ROLES) {
      for (const s of ROLE_SISTEMAS[rol]) {
        expect(gruposVisibles(usuario(rol), s).length, `${rol} en ${s}`).toBeGreaterThan(0)
      }
    }
  })

  it('cada rol llega por algún menú a todo lo que puede abrir (salvo las excepciones documentadas)', () => {
    for (const rol of ROLES) {
      const alcanzables = new Set<string>([
        ...NAVBAR[rol],
        ...ROLE_SISTEMAS[rol].flatMap((s) => SIDEBARS[s].flatMap((g) => g.entradas.map(pathDe))),
        // El selector de dominio de la cabecera lleva al home de cada dominio (p. ej. /heladeras).
        ...ROLE_SISTEMAS[rol].map((s) => homeDeSistema(s, usuario(rol))),
        ...(rol === 'super_admin' ? PANEL.flatMap((g) => g.entradas.map(pathDe)) : []),
        ...(SIN_MENU[rol] ?? []),
      ])
      const faltan = CATALOGO
        .filter((r) => r.icon && r.roles.includes(rol) && !alcanzables.has(r.path))
        .map((r) => r.path)
      expect(faltan, `${rol} puede abrir estas pantallas pero no las tiene en ningún menú`).toEqual([])
    }
  })

  it('el home de cada rol está en el catálogo y es suyo; el de cada dominio también', () => {
    for (const rol of ROLES) {
      const home = ROLE_HOME[rol]
      if (home === '/sistema') continue
      const r = rutaDe(home)
      expect(r.roles, `${rol} → ${home}`).toContain(rol)
      for (const s of ROLE_SISTEMAS[rol]) {
        const h = homeDeSistema(s, usuario(rol))
        expect(rutaDe(h).roles, `${rol} en ${s} → ${h}`).toContain(rol)
      }
    }
  })

  it('las rutas del sidebar resuelven a su dominio', () => {
    for (const s of Object.keys(SIDEBARS) as Sistema[]) {
      for (const e of SIDEBARS[s].flatMap((g) => g.entradas)) {
        expect(SISTEMAS, `${pathDe(e)}`).toContain(sistemaDeRuta(pathDe(e)))
      }
    }
    expect(sistemaDeRuta('/caja')).toBe('logistica')
    expect(sistemaDeRuta('/comercial/pedidos')).toBe('comercial')
    expect(sistemaDeRuta('/dashboard')).toBeNull()
  })
})
