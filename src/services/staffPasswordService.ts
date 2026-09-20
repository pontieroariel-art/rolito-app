/**
 * Restablecer la contraseña de alguien del personal (2026-09-20).
 *
 * El mail del staff es inventado (`36809554@staff.rolito.internal`), así que
 * no hay "olvidé mi contraseña" por mail y nunca lo va a haber. Cuando alguien
 * se la olvida, el super_admin se la vuelve a poner en su DNI desde Usuarios y
 * la persona la cambia de nuevo en Mi perfil.
 *
 * Cambiar la contraseña de OTRO usuario solo se puede con el Admin SDK, así
 * que el trabajo real lo hace la callable `resetearPasswordStaff`, que valida
 * quién pide, sobre quién, y lo deja anotado en `historialAdmin`.
 */
export async function resetearPasswordStaff(uid: string): Promise<{ password: string; nombre: string }> {
  const { getFunctions, httpsCallable } = await import('firebase/functions')
  const fn = httpsCallable<{ uid: string }, { password: string; nombre: string }>(
    getFunctions(),
    'resetearPasswordStaff',
  )
  const { data } = await fn({ uid })
  return data
}
