import { randomUUID } from 'node:crypto'
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Request } from 'express'
import { config } from '../../config.js'
import { HttpError, notFound } from '../../lib/errors.js'

export const AVATAR_MAX_BYTES = 8 * 1024 * 1024

const FORMATS = {
  jpg: { contentType: 'image/jpeg' },
  png: { contentType: 'image/png' },
  webp: { contentType: 'image/webp' },
} as const

type AvatarExtension = keyof typeof FORMATS

function avatarDirectory(): string {
  return path.join(config.books.dir, 'avatars')
}

function safeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function detectFormat(data: Buffer): AvatarExtension | null {
  const at = (offset: number, bytes: number[]) => bytes.every((byte, index) => data[offset + index] === byte)
  if (at(0, [0xff, 0xd8, 0xff])) return 'jpg'
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp'
  return null
}

/** Lit le corps brut sans jamais conserver plus que la limite autorisée. */
export async function receiveAvatar(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > AVATAR_MAX_BYTES) {
      req.resume()
      throw new HttpError(413, 'avatar_too_large', 'La photo dépasse la limite de 8 Mo.')
    }
    chunks.push(buffer)
  }
  if (size === 0) throw new HttpError(400, 'empty_avatar', 'La photo est vide.')
  return Buffer.concat(chunks, size)
}

/** Écriture atomique et remplacement des anciennes variantes de la photo. */
export async function storeAvatar(userId: string, data: Buffer): Promise<string> {
  const extension = detectFormat(data)
  if (!extension) throw new HttpError(415, 'unsupported_avatar', 'Utilise une image JPEG, PNG ou WebP.')

  const directory = avatarDirectory()
  const stem = safeUserId(userId)
  const target = path.join(directory, `${stem}.${extension}`)
  const temporary = path.join(directory, `.${stem}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, data, { flag: 'wx' })
  try {
    await Promise.all((Object.keys(FORMATS) as AvatarExtension[]).map((ext) => rm(path.join(directory, `${stem}.${ext}`), { force: true })))
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return `/api/profile/avatar-image?v=${Date.now()}`
}

export async function storedAvatar(userId: string): Promise<{ file: string; contentType: string }> {
  const stem = safeUserId(userId)
  for (const [extension, format] of Object.entries(FORMATS) as [AvatarExtension, (typeof FORMATS)[AvatarExtension]][]) {
    const file = path.join(avatarDirectory(), `${stem}.${extension}`)
    try {
      await access(file)
      return { file, contentType: format.contentType }
    } catch {
      // Essaie le format suivant.
    }
  }
  throw notFound('Photo de profil introuvable.')
}
