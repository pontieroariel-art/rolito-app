// qrcode (23 KB) se carga al generar el primer QR y no con el módulo
// (2026-09-26, auditoría del chofer, R9): Rolldown ponía este archivo en el
// mismo chunk que emisores.ts, y así Vender, Entregar, Mis ventas y Cobrar
// bajaban la librería aunque no dibujaran ningún QR.
export const generateQrDataUrl = async (text: string): Promise<string> => {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(text, { margin: 0, errorCorrectionLevel: 'M', width: 300 })
}
