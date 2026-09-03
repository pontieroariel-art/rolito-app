// Datos del emisor que se imprimen en el encabezado de cada comprobante.
//
// Redonhielo es la empresa oficial (los comprobantes de ARCA salen a su nombre,
// ver facturaArcaPdf.ts). Rolito es la empresa de promo: sus comprobantes son
// internos, no oficiales, y viajan a Tango a la empresa Rolito.
//
// ⚠️ Los datos de Rolito hay que completarlos con los reales (razón social
// exacta, CUIT, domicilio, condición frente al IVA). Hasta entonces el papel
// sale con lo que hay acá.
import { EMISOR_ARCA } from './facturaArcaPdf'

export interface Emisor {
  razonSocial:     string
  domicilio:       string
  telefono:        string
  email:           string
  condicionIva:    string
  cuit:            string
  ingresosBrutos:  string
  inicioActividad: string
}

export const EMISOR_REDONHIELO: Emisor = {
  razonSocial:     EMISOR_ARCA.razonSocial,
  domicilio:       EMISOR_ARCA.domicilio,
  telefono:        EMISOR_ARCA.telefono,
  email:           EMISOR_ARCA.email,
  condicionIva:    EMISOR_ARCA.condicionIva,
  cuit:            EMISOR_ARCA.cuit,
  ingresosBrutos:  EMISOR_ARCA.ingresosBrutos,
  inicioActividad: EMISOR_ARCA.inicioActividad,
}

export const EMISOR_ROLITO: Emisor = {
  razonSocial:     'Rolito',
  domicilio:       EMISOR_ARCA.domicilio,
  telefono:        EMISOR_ARCA.telefono,
  email:           EMISOR_ARCA.email,
  condicionIva:    '',
  cuit:            '',
  ingresosBrutos:  '',
  inicioActividad: '',
}
