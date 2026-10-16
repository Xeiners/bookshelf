import { moved } from '../geometry'
import type { Op } from '../history'
import type { CanvasObject } from '../types'
import type { ToolContext } from './context'

/*
 * Actions sur la sélection, valables quel que soit l'outil : supprimer, dupliquer, déplacer
 * d'un cran, avancer / reculer dans l'empilement. Seuls les objets que l'on peut modifier sont
 * touchés ; chaque action est une entrée d'historique (annulable d'un coup).
 */

export function selectedObjects(ctx: ToolContext): CanvasObject[] {
  return ctx
    .state()
    .selection.map((id) => ctx.scene.get(id))
    .filter((object): object is CanvasObject => object !== undefined)
}

export const editable = (ctx: ToolContext) => selectedObjects(ctx).filter((object) => ctx.canEdit(object))

export function deleteSelected(ctx: ToolContext): boolean {
  const targets = editable(ctx)
  if (targets.length === 0) return false
  ctx.commit({
    undo: targets.map((object): Op => ({ k: 'c', id: object.id, o: object.data })),
    redo: targets.map((object): Op => ({ k: 'd', id: object.id })),
  })
  ctx.select([])
  return true
}

export function duplicateSelected(ctx: ToolContext): boolean {
  const targets = selectedObjects(ctx).filter((object) => object.data.t !== 'f')
  if (targets.length === 0 || !ctx.canDraw()) return false
  const offset = 24 / ctx.camera.zoom
  const copies = targets.map((object) => ({ id: ctx.newId(), data: moved(object.data, offset, offset) }))
  ctx.commit({
    undo: copies.map((copy): Op => ({ k: 'd', id: copy.id })),
    redo: copies.map((copy): Op => ({ k: 'c', id: copy.id, o: copy.data })),
  })
  ctx.select(copies.map((copy) => copy.id))
  return true
}

export function nudgeSelected(ctx: ToolContext, dx: number, dy: number): boolean {
  const targets = editable(ctx)
  if (targets.length === 0) return false
  ctx.commit({
    undo: targets.map((object): Op => ({ k: 'u', id: object.id, o: object.data })),
    redo: targets.map((object): Op => ({ k: 'u', id: object.id, o: moved(object.data, dx, dy) })),
  })
  return true
}

export function restackSelected(ctx: ToolContext, to: 'front' | 'back'): boolean {
  const targets = editable(ctx)
  if (targets.length === 0) return false
  // L'ordre d'empilement ne s'annule pas pas à pas : l'opposé suffit (derrière ↔ devant).
  ctx.commit({
    undo: targets.map((object): Op => ({ k: 'z', id: object.id, to: to === 'front' ? 'back' : 'front' })),
    redo: targets.map((object): Op => ({ k: 'z', id: object.id, to })),
  })
  return true
}

/** Sélectionne tout ce que je peux modifier dans la vue. */
export function selectAllEditable(ctx: ToolContext): void {
  const view = ctx.camera.bounds()
  ctx.select(
    ctx.scene
      .find(view)
      .filter((object) => ctx.canEdit(object) && object.data.t !== 'f')
      .map((object) => object.id),
  )
}
