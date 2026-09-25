/** Mac et iOS affichent « ⌘ » ; les autres « Ctrl ». */
export const isApplePlatform =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

/** Libellé d'un raccourci avec la touche de commande de la plateforme : `⌘K` / `Ctrl K`. */
export const commandKey = (key: string) => (isApplePlatform ? `⌘${key}` : `Ctrl ${key}`)
