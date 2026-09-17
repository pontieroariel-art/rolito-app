// Prueba la casilla SMTP (Microsoft 365, o la que diga functions/.env) ANTES de cargar el secret y desplegar
// (2026-09-17). Manda un mail de prueba con la misma configuración que usa
// functions/src/email.ts (host/puerto/usuario de functions/.env).
//
//   set SMTP_PASSWORD=<contraseña de la casilla>   (PowerShell: $env:SMTP_PASSWORD='...')
//   node scripts/probar-smtp.mjs destinatario@dominio.com
//
// Para probar OTRO servidor sin tocar functions/.env (p. ej. Hostinger):
//   $env:SMTP_HOST='smtp.hostinger.com'; $env:SMTP_PORT='465'; $env:SMTP_USER='casilla@dominio'
//
// La contraseña se lee SOLO de la variable de entorno: nunca en el comando ni
// en un archivo del repo. Si el mail llega, cargar el secret con
//   firebase functions:secrets:set SMTP_PASSWORD
// y desplegar las functions de mail (ver CLAUDE.md, "Deploy manual").
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(raiz, 'functions', 'package.json'))
const nodemailer = require('nodemailer')

const env = Object.fromEntries(
  readFileSync(path.join(raiz, 'functions', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)

const para = process.argv[2]
const pass = process.env.SMTP_PASSWORD
if (!para) { console.error('Uso: node scripts/probar-smtp.mjs destinatario@dominio.com'); process.exit(1) }
if (!pass) { console.error('Falta la variable de entorno SMTP_PASSWORD'); process.exit(1) }

const host = process.env.SMTP_HOST ?? env.SMTP_HOST ?? 'smtp.office365.com'
const port = Number(process.env.SMTP_PORT ?? env.SMTP_PORT ?? 587)
const user = process.env.SMTP_USER ?? env.SMTP_USER ?? 'WebMail@redonhielo.com.ar'
console.log(`Conectando a ${host}:${port} como ${user}…`)

const transporte = nodemailer.createTransport({
  host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass },
  connectionTimeout: 15_000, greetingTimeout: 15_000,
})
try {
  await transporte.verify()
  console.log('Login SMTP OK. Mandando mail de prueba…')
  const info = await transporte.sendMail({
    from: process.env.SMTP_HOST ? user : (env.FROM_EMAIL ?? user),
    to: para,
    subject: 'Prueba SMTP de la app de Rolito',
    html: `<p>Este mail salió por SMTP desde <b>${user}</b> el ${new Date().toLocaleString('es-AR')}.</p><p>Si lo estás leyendo, la casilla está lista para la app.</p>`,
    attachments: [{ filename: 'prueba.txt', content: Buffer.from('Adjunto de prueba de la app de Rolito.\n') }],
  })
  console.log('Enviado. messageId:', info.messageId, '| respuesta:', info.response)
} catch (e) {
  console.error('FALLÓ:', e?.message ?? e)
  process.exitCode = 1
} finally {
  transporte.close()
}
