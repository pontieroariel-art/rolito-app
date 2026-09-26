// Clave del índice de login del chofer (dniIndex). El índice sale del CUIT
// (dígitos 3 a 10), así que un DNI de 7 dígitos queda guardado con un 0
// adelante: 20-07123456-3 → '07123456'. El chofer escribe su DNI como lo conoce,
// '7123456', y antes el login lo rechazaba por no tener 8 dígitos (auditoría
// del chofer, 2026-09-26).
export function claveDniChofer(dni: string): string | null {
  const digitos = dni.replace(/\D/g, '')
  const clave = digitos.length === 7 ? digitos.padStart(8, '0') : digitos
  return clave.length === 8 ? clave : null
}
