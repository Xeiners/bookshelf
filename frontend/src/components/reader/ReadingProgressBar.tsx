/**
 * Fine barre d'avancement en bas de page, dans la couleur des liens du thème.
 * Purement présentationnelle (ni store ni i18n) : rendue telle quelle dans les
 * tests (`frontend/test/readerRender.test.ts`).
 */
export function ReadingProgressBar({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  const clamped = Math.min(1, Math.max(0, ratio))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className="pointer-events-none absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] h-[3px] overflow-hidden"
      style={{ background: `${color}26` }}
    >
      {/* `scaleX` plutôt que `width` : la barre bouge à chaque page sans relayout. */}
      <div className="h-full w-full origin-left" style={{ background: color, transform: `scaleX(${clamped})` }} />
    </div>
  )
}
