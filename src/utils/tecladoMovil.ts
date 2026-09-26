// El teclado del celular tapa el campo (relevamiento de responsividad, 2026-09-26).
// En Android e iOS el teclado achica la pantalla visible pero no mueve los modales
// ni las barras fijas: el campo que se está escribiendo (la cantidad en Vender, el
// motivo de una anulación, el importe de un vale) quedaba abajo del teclado.
// Con puntero táctil, cuando un campo toma el foco y el teclado termina de abrir,
// se lo lleva al centro de lo que queda visible. Además publica `--alto-teclado`
// en <html> para que una barra fija pueda subirse si lo necesita.
// En escritorio (mouse) no hace nada.

const ESCRIBIBLE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]'

export function instalarAyudaTeclado(): void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return
  const vv = window.visualViewport

  const acomodar = () => {
    const el = document.activeElement
    if (!(el instanceof HTMLElement) || !el.matches(ESCRIBIBLE)) return
    const r = el.getBoundingClientRect()
    const alto = vv ? vv.height + vv.offsetTop : window.innerHeight
    // Solo si quedó tapado o pegado al borde: no mover lo que ya se ve.
    if (r.bottom > alto - 16 || r.top < (vv?.offsetTop ?? 0) + 8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  let espera: ReturnType<typeof setTimeout> | undefined
  document.addEventListener('focusin', () => {
    clearTimeout(espera)
    // El teclado tarda ~300 ms en abrir; el resize de visualViewport vuelve a mirar.
    espera = setTimeout(acomodar, 350)
  })

  if (vv) {
    const publicar = () => {
      const tapado = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.documentElement.style.setProperty('--alto-teclado', `${Math.round(tapado)}px`)
    }
    // Solo cuando la pantalla visible se ACHICA (abrió el teclado), no al agrandar con dos dedos.
    let altoAnterior = vv.height
    vv.addEventListener('resize', () => {
      publicar()
      if (vv.height < altoAnterior - 80 && vv.scale <= 1.01) acomodar()
      altoAnterior = vv.height
    })
    publicar()
  }
}
