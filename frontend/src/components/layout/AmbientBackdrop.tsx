import { useUiStore } from '../../store/useUiStore'

/**
 * Halos de couleur + grain filmique, IMMOBILES. Ils dérivaient en boucle (pilotés en
 * JavaScript, image par image) sous tous les écrans : le téléphone recomposait tout l'écran en
 * permanence, même à l'arrêt — de quoi faire chauffer et ralentir les GPU modestes (Galaxy S22
 * à puce Exynos). Peints une fois, ils ne coûtent plus rien.
 */
export function AmbientBackdrop() {
  // L'onglet Activités pose son propre fond, opaque : celui-ci, caché dessous, n'est pas dessiné.
  const covered = useUiStore((state) => state.view === 'activities')

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-void" style={covered ? { visibility: 'hidden' } : undefined}>
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-36 -left-32 size-[28rem] rounded-full bg-[radial-gradient(circle,rgb(124_92_255/0.3)_0%,rgb(124_92_255/0.12)_34%,transparent_70%)]" />
        <div className="absolute top-1/4 -right-40 size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(29_92_255/0.22)_0%,rgb(29_92_255/0.08)_36%,transparent_70%)]" />
        <div className="absolute -bottom-40 left-[8%] size-[30rem] rounded-full bg-[radial-gradient(circle,rgb(63_224_160/0.12)_0%,rgb(63_224_160/0.04)_38%,transparent_72%)]" />
      </div>

      {/* Casse le banding des dégradés */}
      <div className="grain absolute inset-0 opacity-[0.05]" />

      <div className="absolute inset-0 bg-[radial-gradient(125%_85%_at_50%_5%,transparent_30%,var(--color-void)_100%)]" />
    </div>
  )
}
