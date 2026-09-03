// Parte PURA de la numeración interna (sin Firebase) para que los utils que
// arman comprobantes — y sus tests — no arrastren la inicialización de
// Firestore. La reserva de lotes y el contador viven en
// services/numeracionInternaService.ts, que re-exporta esto.

export interface NumeroInterno { puntoVenta: number; numero: number }

/** "00002-00000015", como el resto de los comprobantes. */
export function codigoComprobanteInterno(n: NumeroInterno): string {
  return `${String(n.puntoVenta).padStart(5, '0')}-${String(n.numero).padStart(8, '0')}`
}
