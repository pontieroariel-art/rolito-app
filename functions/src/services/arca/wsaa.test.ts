import { describe, it, expect, beforeAll } from 'vitest'
import * as forge from 'node-forge'
import {
  generarTRA,
  firmarTRA,
  parsearRespuestaWsaa,
  extraerTag,
  SERVICIO_WSFE,
  cuitDelCertificado,
  verificarCertificadoCoincide,
} from './wsaa'

/**
 * Genera un certificado autofirmado para probar la firma sin usar el
 * certificado fiscal real. Es RSA 2048 (en vez de 4096) solo para que los
 * tests corran rápido; el formato es el mismo.
 */
function certificadoDePrueba() {
  const par = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = par.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000)
  const attrs = [
    { name: 'commonName', value: 'RolitoTest' },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: 'Redonhielo S.A.' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(par.privateKey, forge.md.sha256.create())

  return {
    certificadoPem: forge.pki.certificateToPem(cert),
    clavePrivadaPem: forge.pki.privateKeyToPem(par.privateKey),
  }
}

describe('generarTRA', () => {
  const ahora = new Date('2026-09-10T15:00:00.000Z')

  it('arma un XML con la estructura que espera el WSAA', () => {
    const tra = generarTRA(SERVICIO_WSFE, ahora)
    expect(tra).toContain('<loginTicketRequest version="1.0">')
    expect(tra).toContain('<service>wsfe</service>')
    expect(extraerTag(tra, 'uniqueId')).toBeTruthy()
  })

  it('pide una ventana que ya empezó, para tolerar desfasaje de reloj', () => {
    const tra = generarTRA(SERVICIO_WSFE, ahora)
    const gen = new Date(extraerTag(tra, 'generationTime')!)
    const exp = new Date(extraerTag(tra, 'expirationTime')!)
    expect(gen.getTime()).toBeLessThan(ahora.getTime())
    expect(exp.getTime()).toBeGreaterThan(ahora.getTime())
  })

  it('usa un uniqueId distinto en pedidos de distinto segundo', () => {
    const a = extraerTag(generarTRA(SERVICIO_WSFE, new Date('2026-09-10T15:00:00Z')), 'uniqueId')
    const b = extraerTag(generarTRA(SERVICIO_WSFE, new Date('2026-09-10T15:00:05Z')), 'uniqueId')
    expect(a).not.toBe(b)
  })

  it('el uniqueId entra en un entero de 32 bits con signo', () => {
    const id = Number(extraerTag(generarTRA(SERVICIO_WSFE, ahora), 'uniqueId'))
    expect(id).toBeGreaterThan(0)
    expect(id).toBeLessThanOrEqual(2_147_483_647)
  })
})

describe('firmarTRA', () => {
  let cert: ReturnType<typeof certificadoDePrueba>

  beforeAll(() => { cert = certificadoDePrueba() })

  it('produce un CMS en base64 que se puede volver a parsear', () => {
    const tra = generarTRA()
    const b64 = firmarTRA(tra, cert.certificadoPem, cert.clavePrivadaPem)

    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/)          // base64 puro, sin saltos

    const der = forge.util.decode64(b64)
    const asn1 = forge.asn1.fromDer(der)
    // `type` y `rawCapture` existen en runtime pero no están en @types/node-forge.
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as unknown as { type: string }
    expect(p7.type).toBe(forge.pki.oids.signedData)
  })

  it('el mensaje firmado contiene el TRA original (no va detached)', () => {
    const tra = generarTRA()
    const b64 = firmarTRA(tra, cert.certificadoPem, cert.clavePrivadaPem)
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(forge.util.decode64(b64)),
    ) as unknown as { rawCapture: { content?: { value?: Array<{ value: string }> } } }

    const bytes = p7.rawCapture.content?.value?.[0]?.value ?? ''
    expect(bytes).toContain('<service>wsfe</service>')
  })

  it('incluye el certificado, que es como ARCA identifica al emisor', () => {
    const b64 = firmarTRA(generarTRA(), cert.certificadoPem, cert.clavePrivadaPem)
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(forge.util.decode64(b64)),
    ) as forge.pkcs7.PkcsSignedData
    expect(p7.certificates.length).toBeGreaterThan(0)
  })

  it('avisa con claridad si el certificado o la clave no son PEM válidos', () => {
    expect(() => firmarTRA(generarTRA(), 'no soy un cert', cert.clavePrivadaPem))
      .toThrow(/certificado no es un PEM válido/)
    expect(() => firmarTRA(generarTRA(), cert.certificadoPem, 'no soy una clave'))
      .toThrow(/clave privada no es un PEM válido/)
  })

  it('no filtra material de la clave privada en el mensaje de error', () => {
    const secreto = cert.clavePrivadaPem.split('\n')[1]
    try {
      firmarTRA(generarTRA(), cert.certificadoPem, cert.clavePrivadaPem.slice(0, 80))
      throw new Error('debería haber fallado')
    } catch (e) {
      expect((e as Error).message).not.toContain(secreto)
    }
  })
})

describe('verificarCertificadoCoincide', () => {
  /** Certificado de prueba con un CUIT en el serialNumber, como los de ARCA. */
  function certConCuit(cuit: string) {
    const par = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = par.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 365 * 86400000)
    const attrs = [
      { name: 'commonName', value: 'App Rolito' },
      { name: 'serialNumber', value: `CUIT ${cuit}` },
    ]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(par.privateKey, forge.md.sha256.create())
    return forge.pki.certificateToPem(cert)
  }

  it('lee el CUIT del subject', () => {
    expect(cuitDelCertificado(certConCuit('30697668973'))).toBe('30697668973')
  })

  it('pasa cuando el certificado y la configuración coinciden', () => {
    expect(() => verificarCertificadoCoincide(certConCuit('30697668973'), '30697668973')).not.toThrow()
  })

  it('tolera el CUIT con guiones en la configuración', () => {
    expect(() => verificarCertificadoCoincide(certConCuit('30697668973'), '30-69766897-3')).not.toThrow()
  })

  it('detecta el cruce típico: cert de homologación con ambiente de producción', () => {
    // El de homologación está a nombre de una persona física (prefijo 20).
    expect(() => verificarCertificadoCoincide(certConCuit('20128494651'), '30697668973'))
      .toThrow(/es del CUIT 20128494651, pero config\/arca dice 30697668973/)
  })
})

describe('parsearRespuestaWsaa', () => {
  const respuestaOk = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <loginCmsResponse>
      <loginCmsReturn>&lt;?xml version="1.0"?&gt;
&lt;loginTicketResponse version="1.0"&gt;
  &lt;header&gt;
    &lt;expirationTime&gt;2026-09-10T15:00:00.000-03:00&lt;/expirationTime&gt;
  &lt;/header&gt;
  &lt;credentials&gt;
    &lt;token&gt;TOKEN_DE_PRUEBA&lt;/token&gt;
    &lt;sign&gt;FIRMA_DE_PRUEBA&lt;/sign&gt;
  &lt;/credentials&gt;
&lt;/loginTicketResponse&gt;</loginCmsReturn>
    </loginCmsResponse>
  </soapenv:Body>
</soapenv:Envelope>`

  it('extrae token, sign y expiración desde el XML escapado', () => {
    const ta = parsearRespuestaWsaa(respuestaOk)
    expect(ta.token).toBe('TOKEN_DE_PRUEBA')
    expect(ta.sign).toBe('FIRMA_DE_PRUEBA')
    expect(ta.expiracion.toISOString()).toBe('2026-09-10T18:00:00.000Z')
  })

  it('convierte un SOAP Fault en un error legible', () => {
    const fault = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
      <soapenv:Body><soapenv:Fault>
        <faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring>
      </soapenv:Fault></soapenv:Body></soapenv:Envelope>`
    expect(() => parsearRespuestaWsaa(fault)).toThrow(/ya posee un TA valido/)
  })

  it('falla claro si la respuesta no tiene la forma esperada', () => {
    expect(() => parsearRespuestaWsaa('<vacio/>')).toThrow(/no trae loginCmsReturn/)
  })
})
