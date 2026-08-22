import JsBarcode from 'jsbarcode'

// Código de barra del ticket de producción — a diferencia de generateQrDataUrl
// (utils/qr.ts, asíncrono, librería `qrcode`), esto es SÍNCRONO y nunca toca
// la red: dibuja sobre un <canvas> en memoria, funciona 100% offline.
export function generateBarcodeDataUrl(text: string): string {
  const canvas = document.createElement('canvas')
  JsBarcode(canvas, text, {
    format: 'CODE128',
    displayValue: false,
    margin: 0,
    height: 60,
  })
  return canvas.toDataURL('image/png')
}
