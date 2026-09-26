// El ayudante solo acompaña (2026-09-26, decisión de Ariel, auditoría del
// chofer C1). Ve su turno (chofer, camión, planta, paradas) y busca
// clientes, pero no vende, no cobra, no entrega ni lleva la ruta: eso queda a
// nombre del chofer titular. Antes veía los botones y las reglas le rechazaban
// la escritura en la calle.

export const esAyudante = (user: { subrol?: string } | null | undefined): boolean => user?.subrol === 'ayudante'

/** Pantallas del chofer que el ayudante no abre (por menú ni por URL). */
const SOLO_DEL_CHOFER = ['/chofer/venta', '/chofer/cobrar', '/chofer/ventas', '/chofer/entregar', '/chofer/map']

export function rutaSoloDelChofer(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '')
  return SOLO_DEL_CHOFER.some((r) => p === r || p.startsWith(r + '/'))
}
