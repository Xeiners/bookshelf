/**
 * Point d'entrée unique de GSAP : aucun composant n'importe `gsap` directement.
 * Les plugins sont enregistrés ici, une seule fois.
 */
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'
import { Draggable } from 'gsap/Draggable'
import { InertiaPlugin } from 'gsap/InertiaPlugin'

gsap.registerPlugin(useGSAP, Draggable, InertiaPlugin)

/*
 * Contournement d'un bug de GSAP (VelocityTracker) : `track(cible, 'x,y')` chaîne les propriétés à
 * l'envers, et `untrack(cible, 'x,y')` retire alors la tête de chaîne sans la faire avancer — le
 * suivi ne s'arrête jamais et réveille le ticker à chaque image, pour toujours (toute l'app
 * recalculée sans arrêt). Les retirer dans l'ordre inverse de leur ajout garde la chaîne d'aplomb.
 * Draggable passe aussi par ici : il appelle `InertiaPlugin.untrack` quand il se désactive.
 */
const untrackVelocity = InertiaPlugin.untrack.bind(InertiaPlugin)
InertiaPlugin.untrack = (target, properties) => untrackVelocity(target, properties?.split(',').reverse().join(','))

gsap.defaults({ ease: 'power3.out', duration: 0.6 })
gsap.config({ nullTargetWarn: false })

/** Vocabulaire d'easings partagé, pour un mouvement cohérent d'un écran à l'autre. */
export const EASE = {
  swift: 'power4.out',
  snap: 'back.out(1.6)',
  spring: 'elastic.out(1, 0.62)',
  exit: 'power2.in',
  glide: 'expo.out',
} as const

/** Durées de référence, en secondes. */
export const DUR = {
  micro: 0.22,
  fast: 0.36,
  base: 0.56,
  slow: 0.9,
  hero: 1.4,
} as const

export { gsap, useGSAP, Draggable, InertiaPlugin }
