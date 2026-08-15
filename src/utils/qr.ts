import QRCode from 'qrcode'

export const generateQrDataUrl = (text: string): Promise<string> =>
  QRCode.toDataURL(text, { margin: 0, errorCorrectionLevel: 'M', width: 300 })
