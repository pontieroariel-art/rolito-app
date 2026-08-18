import { test, expect } from '@playwright/test'

test('la landing carga y muestra el selector de login', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Rolito - Distribución de Hielo')
  await expect(page.getByText('Ingreso Clientes')).toBeVisible()
  await expect(page.getByText('Ingreso Choferes')).toBeVisible()
  await expect(page.getByText('Ingreso Empresa')).toBeVisible()
})
