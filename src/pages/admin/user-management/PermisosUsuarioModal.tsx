import { useState } from 'react'
import { deleteField } from 'firebase/firestore'
import Button from '../../../components/ui/Button'
import Modal from '../../../components/ui/Modal'
import { updateUserDocument } from '../../../services/userService'
import { UserProfile } from '../../../types'
import { ROLE_SISTEMAS, SISTEMA_LABELS, Sistema } from '../../../utils/sistemas'
import { LOGISTICA_NAV_GROUPS } from '../../../utils/logisticaNav'
import { HELADERAS_NAV_GROUPS } from '../../../utils/heladerasNav'
import { NavGroup } from '../../../utils/navGroups'

const SISTEMAS_ORDEN: Sistema[] = ['logistica', 'heladeras']
// 'produccion' no tiene pestañas finas que recortar (dashboard de carga de
// un solo propósito, sin sub-navegación) — queda fuera de SISTEMAS_ORDEN, el
// array vacío solo satisface el Record completo.
const GRUPOS_POR_SISTEMA: Record<Sistema, NavGroup[]> = {
  logistica:  LOGISTICA_NAV_GROUPS,
  heladeras:  HELADERAS_NAV_GROUPS,
  produccion: [],
}

// Ítems de nav que el rol de este usuario ya puede ver en un sistema dado —
// el mismo filtro que aplican LogisticaLayout/HeladerasLayout, para que el
// checklist nunca ofrezca algo que el rol no permite.
function itemsVisiblesDelRol(rol: UserProfile['rol'], sistema: Sistema): NavGroup[] {
  return GRUPOS_POR_SISTEMA[sistema]
    .map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(rol)) }))
    .filter((g) => g.items.length > 0)
}

export function PermisosUsuarioModal({
  user, onClose, onSaved,
}: {
  user:    UserProfile
  onClose: () => void
  onSaved: () => void
}) {
  const techoSistemas = ROLE_SISTEMAS[user.rol]
  const [sistemas, setSistemas] = useState<Sistema[]>(user.sistemasPermitidos ?? techoSistemas)

  const defaultPestanas = SISTEMAS_ORDEN
    .filter((s) => techoSistemas.includes(s))
    .flatMap((s) => itemsVisiblesDelRol(user.rol, s).flatMap((g) => g.items.map((i) => i.to)))
  const [pestanas, setPestanas] = useState<string[]>(user.pestanasPermitidas ?? defaultPestanas)

  const [saving, setSaving] = useState(false)

  const toggleSistema = (s: Sistema) =>
    setSistemas((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const togglePestana = (to: string) =>
    setPestanas((prev) => (prev.includes(to) ? prev.filter((x) => x !== to) : [...prev, to]))

  const guardar = async () => {
    setSaving(true)
    try {
      await updateUserDocument(user.uid, { sistemasPermitidos: sistemas, pestanasPermitidas: pestanas })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const usarDefault = async () => {
    setSaving(true)
    try {
      await updateUserDocument(user.uid, { sistemasPermitidos: deleteField(), pestanasPermitidas: deleteField() })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Permisos de ${user.nombreContacto || user.nombre}`} wide>
      <div className="space-y-5">
        <p className="text-xs text-gray-500">
          Solo recorta lo que su rol ({user.rol}) ya permite — nunca le da acceso a algo que
          el rol no tiene.
        </p>

        {techoSistemas.length > 1 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sistemas</p>
            <div className="flex gap-4">
              {techoSistemas.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={sistemas.includes(s)} onChange={() => toggleSistema(s)} />
                  {SISTEMA_LABELS[s]}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pestañas visibles</p>
          {SISTEMAS_ORDEN.filter((s) => sistemas.includes(s) && techoSistemas.includes(s)).map((s) => (
            <div key={s} className="space-y-3">
              {techoSistemas.length > 1 && (
                <p className="text-xs font-medium text-accent">{SISTEMA_LABELS[s]}</p>
              )}
              {itemsVisiblesDelRol(user.rol, s).map((g) => (
                <div key={g.id}>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">{g.label}</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {g.items.map((item) => (
                      <label key={item.to} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <input type="checkbox" checked={pestanas.includes(item.to)} onChange={() => togglePestana(item.to)} />
                        {item.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2 border-t border-gray-100">
          <Button variant="outline" onClick={usarDefault} loading={saving} className="flex-1 text-sm">
            Usar default del rol
          </Button>
          <Button onClick={guardar} loading={saving} className="flex-1 text-sm">
            Guardar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
