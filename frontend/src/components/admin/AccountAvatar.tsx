/** Teinte stable d'un compte (hash de l'id) : chaque initiale a sa couleur, d'une visite à l'autre. */
function hueOf(id: string): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}

interface AccountAvatarProps {
  user: { id: string; displayName: string | null; email: string }
  size: number
  /** Photo personnelle (route d'administration), sinon l'initiale. */
  photo?: string | null
}

/** Avatar d'un compte dans l'administration : sa photo, ou son initiale sur une pastille à sa couleur. */
export function AccountAvatar({ user, size, photo = null }: AccountAvatarProps) {
  const initial = (user.displayName?.trim() || user.email).charAt(0).toUpperCase()
  const hue = hueOf(user.id)
  if (photo) return <img src={photo} alt="" aria-hidden className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-display text-cream"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        background: `linear-gradient(140deg, hsl(${hue} 55% 38%), hsl(${(hue + 40) % 360} 60% 22%))`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.35)`,
      }}
    >
      {initial}
    </span>
  )
}
