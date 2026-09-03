// Smoke de login por rol, contra el emulador (npm run emulators + npm run
// seed:emulator). Un login que falla a las 6 de la mañana es un día perdido:
// cada test entra con las credenciales del seed y verifica que aterriza en su
// home con la pantalla renderizada, sin ErrorBoundary.
//
// Credenciales: ver scripts/seed-emulator.mjs (las imprime al correr).
import { test, expect, type Page } from '@playwright/test'

const PASSWORD = 'test1234'

async function sinPantallaDeError(page: Page) {
  await expect(page.getByText('Algo salió mal')).toHaveCount(0)
}

async function loginEmpresa(page: Page, dni: string, password = PASSWORD) {
  await page.goto('/empresa')
  await page.getByLabel('DNI').fill(dni)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: /ingresar/i }).click()
}

test.describe('login por rol', () => {
  test('super_admin entra al selector de sistema', async ({ page }) => {
    await loginEmpresa(page, '20000001')
    await page.waitForURL('**/sistema')
    await expect(page.locator('h2').first()).toBeVisible()
    await sinPantallaDeError(page)
  })

  test('caja entra a expedición', async ({ page }) => {
    await loginEmpresa(page, '20000003')
    await page.waitForURL('**/caja/**')
    await expect(page.locator('h1').first()).toBeVisible()
    await sinPantallaDeError(page)
  })

  test('muelle ve su tablero', async ({ page }) => {
    await loginEmpresa(page, '20000004')
    await page.waitForURL('**/muelle')
    await expect(page.getByRole('heading', { name: 'Muelle' })).toBeVisible()
    await sinPantallaDeError(page)
  })

  test('seguridad ve el control de salidas', async ({ page }) => {
    await loginEmpresa(page, '20000005')
    await page.waitForURL('**/seguridad')
    await expect(page.getByRole('heading', { name: /control de salidas/i })).toBeVisible()
    await sinPantallaDeError(page)
  })

  test('chofer entra por DNI + PIN', async ({ page }) => {
    await page.goto('/choferes')
    await page.getByLabel('DNI').fill('11111111')
    await page.getByLabel('PIN').fill('1234')
    await page.getByRole('button', { name: /ingresar/i }).click()
    await page.waitForURL('**/chofer')
    await expect(page.getByRole('heading', { name: /entregas de hoy|sin turno asignado/i })).toBeVisible()
    await sinPantallaDeError(page)
  })

  test('chofer con PIN incorrecto ve el mensaje y no entra', async ({ page }) => {
    await page.goto('/choferes')
    await page.getByLabel('DNI').fill('11111111')
    await page.getByLabel('PIN').fill('9999')
    await page.getByRole('button', { name: /ingresar/i }).click()
    await expect(page.getByText('DNI o PIN incorrecto')).toBeVisible()
    await expect(page).toHaveURL(/\/choferes$/)
  })

  test('cliente entra por CUIT', async ({ page }) => {
    await page.goto('/clientes')
    await page.getByLabel('CUIT').fill('30111111118')
    await page.getByLabel('Contraseña').fill(PASSWORD)
    await page.getByRole('button', { name: /ingresar/i }).click()
    // El cliente del seed tiene varias sucursales: primero elige desde cuál
    // pide (ClientBranchGuard → /sucursal) y recién ahí ve su tablero.
    const picker = page.getByText('¿Desde qué sucursal vas a pedir?')
    await expect(picker.or(page.locator('h1').first())).toBeVisible({ timeout: 15_000 })
    if (await picker.isVisible()) {
      await page.getByRole('button', { name: /→/ }).first().click()
    }
    await page.waitForURL('**/dashboard')
    await expect(page.locator('h1').first()).toBeVisible()
    await sinPantallaDeError(page)
  })
})
