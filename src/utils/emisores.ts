// Datos del emisor que se imprimen en el encabezado de cada comprobante.
//
// Redonhielo es la empresa oficial (los comprobantes de ARCA salen a su nombre,
// ver facturaArcaPdf.ts). Rolito es la empresa de promo: sus comprobantes son
// internos, no oficiales, y viajan a Tango a la empresa Rolito.
//
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

// Rolito es la marca de promo de la misma empresa: mismos datos que Redonhielo
// (confirmado por Ariel, 2026-09-03); cambia solo el nombre que encabeza el papel.
export const EMISOR_ROLITO: Emisor = {
  ...EMISOR_REDONHIELO,
  razonSocial: 'Rolito',
}
