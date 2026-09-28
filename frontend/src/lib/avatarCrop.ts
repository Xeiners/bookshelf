export type AvatarMask = 'circle' | 'hexagon'

export interface AvatarCrop {
  zoom: number
  x: number
  y: number
  mask: AvatarMask
}

export const DEFAULT_AVATAR_CROP: AvatarCrop = { zoom: 1, x: 50, y: 38, mask: 'circle' }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Le fragment reste côté navigateur : il décrit le cadrage sans modifier l'URL distante. */
export function avatarUrlWithCrop(url: string, crop: AvatarCrop): string {
  const base = url.split('#')[0]!
  const values = [clamp(crop.zoom, 1, 2).toFixed(2), Math.round(clamp(crop.x, 0, 100)), Math.round(clamp(crop.y, 0, 100)), crop.mask]
  return `${base}#bookshelf-avatar=${values.join(',')}`
}

export function parseAvatarUrl(value: string): { src: string; crop: AvatarCrop } {
  const [src, fragment = ''] = value.split('#', 2)
  const match = /^bookshelf-avatar=([\d.]+),(\d+),(\d+),(circle|hexagon)$/.exec(fragment)
  if (!match) return { src: src!, crop: DEFAULT_AVATAR_CROP }
  return {
    src: src!,
    crop: {
      zoom: clamp(Number(match[1]), 1, 2),
      x: clamp(Number(match[2]), 0, 100),
      y: clamp(Number(match[3]), 0, 100),
      mask: match[4] as AvatarMask,
    },
  }
}

export const avatarMaskStyle = (mask: AvatarMask) =>
  mask === 'hexagon' ? 'polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%)' : 'circle(50%)'
