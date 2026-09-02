/**
 * Aviso de vencimiento del padrón de IIBB de CABA.
 *
 * Redonhielo es agente de percepción: AGIP publica todos los meses un padrón con
 * la alícuota que le corresponde a cada CUIT, y la app la guarda en cada cliente
 * junto con su vigencia (`scripts/arca/importar-padron-iibb.mjs`).
 *
 * El problema que resuelve este aviso: el padrón vence el último día del mes. Si
 * nadie importa el nuevo, `percepcionVigente` empieza a rechazar las facturas de
 * los ~347 clientes con percepción — falla ruidosa y correcta, pero que frena la
 * operación en el peor momento, con el chofer en la calle. Avisar antes cuesta
 * un mail.
 *
 * No se puede resolver solo: importar el padrón es un trámite manual (hay que
 * bajarlo de AGIP). Por eso esto avisa y no intenta arreglar nada.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { sendEmail, APP_URL, resendApiKey } from '../email'

const TZ = 'America/Argentina/Buenos_Aires'

/** Días antes del vencimiento en que empieza a avisar. */
const DIAS_AVISO = 7

export const RUTA_PADRON = 'config/arcaPadronIIBB'

interface EstadoPadron {
  vigenciaDesde?: string          // YYYY-MM-DD
  vigenciaHasta?: string
  archivo?: string
  clientesConPercepcion?: number
  ultimoAviso?: { tipo: string; fecha: string }
}

/** Día calendario argentino en formato YYYY-MM-DD. */
export function hoyEnAr(ahora: Date): string {
  const enAr = new Date(ahora.toLocaleString('en-US', { timeZone: TZ }))
  return `${enAr.getFullYear()}-${String(enAr.getMonth() + 1).padStart(2, '0')}-${String(enAr.getDate()).padStart(2, '0')}`
}

/** Diferencia en días entre dos fechas YYYY-MM-DD, sin que moleste el horario. */
export function diasHasta(desde: string, hasta: string): number {
  const dia = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((dia(hasta) - dia(desde)) / 86_400_000)
}

export type Aviso = { tipo: 'vencido' | 'por-vencer' | 'sin-padron'; dias: number } | null

/**
 * Decide si hay que avisar hoy.
 *
 * Vencido avisa TODOS los días: mientras siga así, no se le puede facturar a
 * ningún cliente con percepción. "Por vencer" avisa una sola vez, para no
 * convertirse en ruido que se ignora.
 */
export function decidirAviso(estado: EstadoPadron | undefined, hoy: string): Aviso {
  if (!estado?.vigenciaHasta) return { tipo: 'sin-padron', dias: 0 }

  const dias = diasHasta(hoy, estado.vigenciaHasta)
  if (dias < 0) return { tipo: 'vencido', dias }
  if (dias > DIAS_AVISO) return null

  // Ya se avisó por este mismo padrón: no repetir.
  if (estado.ultimoAviso?.tipo === 'por-vencer' &&
      diasHasta(estado.ultimoAviso.fecha, estado.vigenciaHasta) <= DIAS_AVISO) {
    return null
  }
  return { tipo: 'por-vencer', dias }
}

function cuerpo(aviso: NonNullable<Aviso>, estado: EstadoPadron | undefined): { asunto: string; html: string } {
  const clientes = estado?.clientesConPercepcion ?? 0
  const comando  = 'node scripts/arca/importar-padron-iibb.mjs &lt;padron.TXT&gt; --escribir'

  const pie = `
    <p style="margin:18px 0 6px">Qué hay que hacer:</p>
    <ol style="margin:0;padding-left:20px;color:#3A3A36">
      <li>Bajar el padrón del mes de AGIP y descomprimirlo.</li>
      <li>Correr el simulacro para revisarlo.</li>
      <li>Aplicarlo: <code style="background:#F2F1EA;padding:2px 5px;border-radius:4px">${comando}</code></li>
    </ol>
    <p style="margin-top:18px;color:#6E6C63;font-size:13px">
      Padrón cargado hoy: ${estado?.archivo ?? '(ninguno)'} ·
      vigencia ${estado?.vigenciaDesde ?? '?'} → ${estado?.vigenciaHasta ?? '?'}<br>
      <a href="${APP_URL}" style="color:#1D9E75">Rolito</a>
    </p>`

  if (aviso.tipo === 'vencido') {
    return {
      asunto: `Padrón de IIBB VENCIDO — no se puede facturar a ${clientes} clientes`,
      html: `
        <h2 style="color:#B3402F;margin:0 0 10px">El padrón de IIBB de CABA está vencido</h2>
        <p style="color:#3A3A36">Venció el <b>${estado?.vigenciaHasta}</b>, hace ${Math.abs(aviso.dias)} día(s).</p>
        <p style="color:#3A3A36">
          Mientras siga así, las facturas de los <b>${clientes} clientes con percepción</b> se van a
          rechazar: la app no emite con una alícuota que ya no está vigente.
        </p>${pie}`,
    }
  }

  if (aviso.tipo === 'sin-padron') {
    return {
      asunto: 'No hay padrón de IIBB cargado',
      html: `
        <h2 style="color:#B4741A;margin:0 0 10px">Todavía no se importó ningún padrón de IIBB</h2>
        <p style="color:#3A3A36">
          Sin él, la app factura sin percibirle a nadie — y Redonhielo es agente de percepción de
          CABA.
        </p>${pie}`,
    }
  }

  return {
    asunto: `El padrón de IIBB vence en ${aviso.dias} día(s)`,
    html: `
      <h2 style="color:#B4741A;margin:0 0 10px">Hay que renovar el padrón de IIBB</h2>
      <p style="color:#3A3A36">
        El padrón vigente vence el <b>${estado?.vigenciaHasta}</b>, en ${aviso.dias} día(s).
        Después de esa fecha no se va a poder facturar a los <b>${clientes} clientes con
        percepción</b> hasta importar el nuevo.
      </p>${pie}`,
  }
}

// Todos los días a las 9 de la mañana: si algo hay que hacer a mano, mejor
// enterarse temprano y no a las 11 de la noche.
export const avisarPadronIIBB = onSchedule(
  { schedule: '0 9 * * *', timeZone: TZ, secrets: [resendApiKey] },
  async () => {
    const db = getFirestore()
    const snap = await db.doc(RUTA_PADRON).get()
    const estado = snap.data() as EstadoPadron | undefined

    const hoy = hoyEnAr(new Date())
    const aviso = decidirAviso(estado, hoy)
    if (!aviso) return

    const cfg = await db.doc('configuracion/notificaciones').get()
    const emails = (cfg.data()?.emails ?? []) as string[]
    if (emails.length === 0) {
      console.warn('[avisarPadronIIBB] no hay destinatarios en configuracion/notificaciones')
      return
    }

    const { asunto, html } = cuerpo(aviso, estado)
    await sendEmail(emails, asunto, html)

    // Deja constancia para no repetir el aviso de "por vencer" todos los días.
    await db.doc(RUTA_PADRON).set(
      { ultimoAviso: { tipo: aviso.tipo, fecha: hoy }, avisadoEn: FieldValue.serverTimestamp() },
      { merge: true },
    )
    console.log(`[avisarPadronIIBB] aviso "${aviso.tipo}" enviado a ${emails.length} destinatario(s)`)
  },
)
