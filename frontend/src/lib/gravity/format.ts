/** Temps de course lisible : 1:23.4 */
export function formatTime(ms: number): string {
  const tenths = Math.round(ms / 100)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}
