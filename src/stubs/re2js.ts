// Reemplazo vacío de `re2js` para el build (2026-09-22, firebase 12).
//
// @firebase/firestore 4.9+ importa `re2js` (motor de expresiones regulares
// RE2, 140 KB sin comprimir, ~45 KB gz) y lo usa SOLO para evaluar en el
// cliente las expresiones `regexMatch` / `regexContains` / `like` de los
// pipelines de Firestore, que esta app no usa. Sin este alias el chunk de
// firebase del login pasaba de 130 a 185 KB gz. Si algún día se usan
// pipelines con expresiones regulares, sacar el alias de vite.config.ts.
export class RE2JS {
  static compile(_pattern: string, _flags?: number): never {
    throw new Error('re2js no está incluido en el build de Rolito (ver src/stubs/re2js.ts)')
  }
  static quote(s: string): string { return s }
}
