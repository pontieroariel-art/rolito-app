// Parte PURA (sin Firebase) del parseo de importes tipeados a mano, para que
// el test no arrastre la página entera (que importa AuthContext → firebase.ts,
// y en CI no hay variables de entorno de Firebase).

// "14.644,04", "14644,04" y "14644.04" valen lo mismo. Un solo punto con hasta
// 2 decimales es decimal; si no, el punto separa miles.
export function numero(s: string | number): number {
  const t = String(s ?? '').trim()
  if (!t) return 0
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.')) || 0
  const puntos = (t.match(/\./g) ?? []).length
  if (puntos === 1 && /\.\d{1,2}$/.test(t)) return Number(t) || 0
  return Number(t.replace(/\./g, '')) || 0
}
