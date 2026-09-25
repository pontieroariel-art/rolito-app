// Arma los manuales de caja y tesorería (2026-09-24) a partir del maestro
// docs/manuales/manual-caja-tesoreria.html: escribe public/manuales/{caja,tesoreria}.html
// (se ven dentro de la app en /caja/manual y /tesoreria/manual, con las capturas de
// public/manuales/img) y el PDF de cada uno con Chrome sin interfaz. `npm run manuales`.
// Al cambiar una pantalla de caja o tesorería: actualizar el maestro (texto y captura) y correr esto.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..')
const dir = path.join(raiz, 'docs', 'manuales')
const master = fs.readFileSync(path.join(dir, 'manual-caja-tesoreria.html'), 'utf8')
const destino = path.join(raiz, 'public', 'manuales')
fs.mkdirSync(destino, { recursive: true })

const entre = (desde, hasta) => {
  const i = master.indexOf(desde); const j = master.indexOf(hasta, i + desde.length)
  if (i < 0 || j < 0) throw new Error('marca no encontrada: ' + desde.slice(0, 40) + ' / ' + hasta.slice(0, 40))
  return master.slice(i, j)
}
const head = master.slice(0, master.indexOf('<div class="portada">'))
  .replace('<title>Manual de caja y tesorería</title>', '<title>__TITULO__</title>')
  .replace('</style>', `  /* En pantalla (dentro de la app): sin portada a página entera, ancho de lectura. */
  @media screen {
    html { font-size: 15px; }
    body { max-width: 860px; margin: 0 auto; padding: 8px 20px 40px; background: white; }
    .portada { height: auto; padding: 28px 0 8px; margin-bottom: 8px; border-bottom: 2px solid #1D9E75; }
    .parte { page-break-before: auto; margin-top: 28px; }
    figure img { max-width: 100%; }
  }
</style>`)
const seccion1 = entre('<h2 style="margin-top:20pt">1 · Cómo se mueve la plata</h2>', '<!-- ───────────────────────────── PARTE 1 · CAJA')
const parteCaja = entre('<!-- ───────────────────────────── PARTE 1 · CAJA', '<!-- ───────────────────────────── PARTE 2 · TESORERÍA')
const parteTeso = entre('<!-- ───────────────────────────── PARTE 2 · TESORERÍA', '<!-- ───────────────────────────── AVISOS')
const avisos = entre('<h2>3 · Avisos automáticos</h2>', '<h2 style="margin-top:22pt">4 · Preguntas frecuentes</h2>')
const faqTodo = entre('<h2 style="margin-top:22pt">4 · Preguntas frecuentes</h2>', '<div class="pie">')
const faqs = [...faqTodo.matchAll(/<p><b>[\s\S]*?<\/p>/g)].map((m) => m[0])
const faqDe = (claves) => faqs.filter((f) => claves.some((k) => f.includes(k))).join('\n')

const FAQ_CAJA = ['me equivoqué en un billete', 'no está para firmar', 'volvió tarde', 'no me lo entregó', 'el que recibe soy yo', 'Falta mercadería', 'plata que sigue en la calle']
const FAQ_TESO = ['un solo total', 'no está para firmar', 'el que recibe soy yo', 'plata que sigue en la calle', 'me equivoqué en un billete']

const manuales = {
  caja: {
    titulo: 'Manual de caja', archivo: 'caja',
    sub: 'Tu turno en la ventanilla, la liquidación de choferes y cobradores, y cómo cerrás y entregás tu Liquidación de caja.',
    contenido: `<ol class="indice">
  <li>Cómo se mueve la plata <ul><li>Los cuatro lugares</li><li>Las tres firmas</li></ul></li>
  <li>Caja <ul><li>Abrir el turno</li><li>Durante el día: ventas, cobranzas y liquidar a choferes y cobradores</li><li>Leer tu Liquidación de caja</li><li>Anticipo a tesorería</li><li>Cerrar la liquidación</li><li>Entregar la liquidación a tesorería, en mano</li><li>Después de entregar</li></ul></li>
  <li>Avisos automáticos</li>
  <li>Preguntas frecuentes</li>
</ol>`,
    parte: parteCaja.replace('<div class="n">Parte 1</div>', '<div class="n">Parte 2</div>'),
    faq: faqDe(FAQ_CAJA),
  },
  tesoreria: {
    titulo: 'Manual de tesorería', archivo: 'tesoreria',
    sub: 'Dónde está la plata hoy, cómo recibís las liquidaciones de caja en mano y cómo las contás y validás.',
    contenido: `<ol class="indice">
  <li>Cómo se mueve la plata <ul><li>Los cuatro lugares</li><li>Las tres firmas</li></ul></li>
  <li>Tesorería <ul><li>La pantalla de entrada: ¿dónde está la plata hoy?</li><li>Los tres carriles de Recepción</li><li>Recibir en mano</li><li>Contar y validar</li><li>Anticipos</li><li>Las otras pantallas</li></ul></li>
  <li>Avisos automáticos</li>
  <li>Preguntas frecuentes</li>
</ol>`,
    parte: parteTeso,
    faq: faqDe(FAQ_TESO),
  },
}

for (const m of Object.values(manuales)) {
  const html = `${head.replace('__TITULO__', m.titulo)}
<div class="portada">
  <div class="marca">Rolito · Distribución de hielo</div>
  <h1>${m.titulo}</h1>
  <div class="sub">${m.sub}</div>
  <div class="meta">Versión del 24 de septiembre de 2026 · corresponde a la app en producción desde esa fecha.</div>
</div>

<h2>Contenido</h2>
${m.contenido}

${seccion1}
${m.parte}
<div class="parte">
${avisos}
<h2 style="margin-top:22pt">4 · Preguntas frecuentes</h2>
${m.faq}
<div class="pie">Rolito · app de gestión · ${m.titulo.toLowerCase()} · 24/09/2026. Las pantallas pueden cambiar de detalle; el circuito (cerrar → entregar en mano → contar y validar) es el que manda.</div>
</div>

</body>
</html>
`
  fs.writeFileSync(path.join(destino, `${m.archivo}.html`), html)

  const pdf = path.join(destino, `${m.archivo}.pdf`)
  try { fs.unlinkSync(pdf) } catch {}
  execFileSync('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=8000',
    `--print-to-pdf=${pdf}`, 'file:///' + path.join(destino, `${m.archivo}.html`).replace(/\\/g, '/'),
  ], { stdio: 'ignore' })
  console.log(m.archivo, 'html', Math.round(fs.statSync(path.join(destino, `${m.archivo}.html`)).size / 1024), 'KB · pdf', Math.round(fs.statSync(pdf).size / 1024), 'KB')
}
console.log('listo: public/manuales')
