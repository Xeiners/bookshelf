import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from '../../config.js'
import { prisma } from '../../db.js'
import type { UserBook } from '../../generated/prisma/client.js'
import { HttpError, notFound } from '../../lib/errors.js'
import type { Language } from '../../lib/language.js'
import { InvalidEpubError, parseEpub, type EpubMetadata } from './epub.parser.js'
import { lookupNovel } from './metadata.service.js'

/**
 * Romans importés (EPUB) : réception du fichier, lecture de ses métadonnées,
 * enrichissement en ligne, stockage, et position de lecture synchronisée.
 *
 * Disque : `BOOKS_DIR/<userId>/<sha256>.epub` (+ `.cover.<ext>`). Les chemins
 * ne viennent jamais d'une saisie (id de compte + empreinte du contenu) : pas
 * de traversée de dossier possible. Les envois en cours passent par
 * `BOOKS_DIR/.tmp`, sur le même disque, pour un déplacement atomique.
 */

export const payloadTooLarge = (message: string, code = 'file_too_large', details?: Record<string, unknown>) =>
  new HttpError(413, code, message, details)

const storagePath = (relative: string) => path.join(config.books.dir, relative)

/* ---- Réception ------------------------------------------------------------------- */

export interface ReceivedUpload {
  tempPath: string
  size: number
  sha256: string
}

/**
 * Écrit le corps de la requête dans un fichier temporaire, en calculant son
 * empreinte au passage. Coupé net au-delà de `maxBytes` : un client qui ment
 * sur `Content-Length` (ou n'en donne pas) ne remplit pas le disque.
 */
export async function receiveUpload(body: Readable, maxBytes = config.books.maxUploadBytes): Promise<ReceivedUpload> {
  const tempDir = storagePath('.tmp')
  await mkdir(tempDir, { recursive: true })
  const tempPath = path.join(tempDir, `${randomUUID()}.part`)
  const hash = createHash('sha256')
  let size = 0

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) {
        callback(payloadTooLarge(`Fichier trop volumineux (${Math.round(maxBytes / 1024 / 1024)} Mo maximum).`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(body, meter, createWriteStream(tempPath, { flags: 'wx' }))
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error instanceof HttpError ? error : new HttpError(400, 'upload_aborted', 'Envoi interrompu.')
  }
  if (size === 0) {
    await rm(tempPath, { force: true })
    throw new HttpError(400, 'empty_file', 'Fichier vide.')
  }
  return { tempPath, size, sha256: hash.digest('hex') }
}

/* ---- Import ------------------------------------------------------------------------ */

/** Nom de fichier affichable : sans dossier ni caractère de contrôle, borné. */
export function safeFileName(raw: string | undefined): string {
  let name = raw ?? ''
  try {
    name = decodeURIComponent(name)
  } catch {
    // Pas encodé : gardé tel quel.
  }
  // oxlint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  name = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return (name || 'livre.epub').slice(0, 255)
}

/** Titre lisible depuis un nom de fichier : « Un_hiver-pour_te_resister.epub » → « Un hiver-pour te resister ». */
export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || name

export async function storageUsed(userId: string): Promise<number> {
  const { _sum } = await prisma.userBook.aggregate({ where: { userId }, _sum: { fileSize: true } })
  return _sum.fileSize ?? 0
}

/** Refuse un envoi qui ferait dépasser l'espace du compte (avant même de le recevoir si sa taille est annoncée). */
export async function assertQuota(userId: string, incomingBytes: number): Promise<void> {
  const used = await storageUsed(userId)
  if (used + incomingBytes > config.books.quotaBytes) {
    throw payloadTooLarge('Espace de stockage plein : supprime des romans pour en importer d’autres.', 'quota_exceeded', {
      usedBytes: used,
      quotaBytes: config.books.quotaBytes,
    })
  }
}

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002'

/**
 * Enregistre un EPUB reçu : même fichier déjà importé → la fiche existante
 * (`duplicate`) ; sinon métadonnées du fichier, complétées en ligne (résumé,
 * couverture HD si le fichier n'en a pas, pagination, parution).
 * Le fichier temporaire est toujours consommé.
 */
export async function importBook(
  userId: string,
  upload: ReceivedUpload,
  originalName: string,
  language: Language,
): Promise<{ book: UserBook; duplicate: boolean }> {
  try {
    const existing = await prisma.userBook.findUnique({ where: { userId_sha256: { userId, sha256: upload.sha256 } } })
    if (existing) return { book: existing, duplicate: true }
    await assertQuota(userId, upload.size)

    let metadata: EpubMetadata
    try {
      metadata = parseEpub(await readFile(upload.tempPath))
    } catch (error) {
      if (error instanceof InvalidEpubError) throw new HttpError(422, 'invalid_epub', error.message)
      throw error
    }

    const title = metadata.title ?? titleFromFileName(originalName)
    const lookupLanguage = metadata.language === 'fr' || metadata.language === 'en' ? metadata.language : language
    const online = await lookupNovel({ title, author: metadata.author, isbn: metadata.isbn }, lookupLanguage)

    await mkdir(storagePath(userId), { recursive: true })
    const filePath = `${userId}/${upload.sha256}.epub`
    await rename(upload.tempPath, storagePath(filePath))
    let coverPath: string | null = null
    if (metadata.cover) {
      coverPath = `${userId}/${upload.sha256}.cover.${metadata.cover.extension}`
      await writeFile(storagePath(coverPath), metadata.cover.data)
    }

    try {
      const book = await prisma.userBook.create({
        data: {
          userId,
          title: title.slice(0, 500),
          author: (metadata.author ?? online?.authors.slice(0, 3).join(', ') ?? null)?.slice(0, 300) || null,
          // La couverture du fichier est celle de l'édition lue : elle passe avant celle trouvée en ligne.
          coverUrl: coverPath ? null : (online?.cover ?? null),
          filePath,
          coverPath,
          fileSize: upload.size,
          sha256: upload.sha256,
          originalName,
          synopsis: (metadata.description || online?.synopsis || '').slice(0, 10_000),
          language: metadata.language ?? online?.language ?? null,
          publisher: (metadata.publisher ?? online?.publisher ?? null)?.slice(0, 200) ?? null,
          year: online?.year ?? metadata.year,
          pages: online?.pages ?? null,
        },
      })
      return { book, duplicate: false }
    } catch (error) {
      // Le même fichier envoyé deux fois en même temps : le premier arrivé gagne.
      // Les fichiers ont le même chemin (même empreinte) : surtout ne pas les supprimer.
      if (!isUniqueViolation(error)) {
        // Aucune fiche ne les cite (l'empreinte est unique par compte) : pas de fichier orphelin.
        await Promise.all([filePath, coverPath].filter((file): file is string => !!file).map((file) => rm(storagePath(file), { force: true })))
        throw error
      }
      const winner = await prisma.userBook.findUnique({ where: { userId_sha256: { userId, sha256: upload.sha256 } } })
      if (!winner) throw error
      return { book: winner, duplicate: true }
    }
  } finally {
    await rm(upload.tempPath, { force: true })
  }
}

/* ---- Lecture, fiche, position -------------------------------------------------------- */

export type BookDto = ReturnType<typeof toDto>

/** Forme envoyée au front. `coverUrl` : la couverture choisie, sinon celle du fichier. */
export function toDto(book: UserBook) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl ?? (book.coverPath ? `${config.publicApiBase}/books/${book.id}/cover?v=${book.sha256.slice(0, 12)}` : null),
    synopsis: book.synopsis,
    language: book.language,
    publisher: book.publisher,
    year: book.year,
    pages: book.pages,
    format: book.format as 'EPUB',
    fileSize: book.fileSize,
    originalName: book.originalName,
    progressPercent: book.progressPercent,
    lastCfi: book.lastCfi,
    /** Horodatage client de la position (ms), `null` si jamais ouvert. */
    progressAt: book.progressAt?.getTime() ?? null,
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  }
}

export function listBooks(userId: string): Promise<UserBook[]> {
  // Derniers lus (ou modifiés) d'abord.
  return prisma.userBook.findMany({ where: { userId }, orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }] })
}

/** Le livre d'un compte ; 404 pour celui d'un autre compte (son existence ne fuit pas). */
export async function getBook(userId: string, id: string): Promise<UserBook> {
  const book = await prisma.userBook.findFirst({ where: { id, userId } })
  if (!book) throw notFound('Livre introuvable.')
  return book
}

export interface ProgressInput {
  cfi: string
  percent: number
  /** Horodatage client (ms) de cette position. */
  at: number
}

/**
 * Position de lecture. Entre deux appareils, la plus récente gagne : une
 * position plus ancienne que celle enregistrée (téléphone resté hors-ligne
 * qui se reconnecte) est ignorée, `applied: false`, et la réponse porte celle
 * qui fait foi. Mise à jour conditionnelle en une requête : deux envois
 * simultanés ne peuvent pas s'écraser dans le mauvais ordre.
 */
export async function saveProgress(userId: string, id: string, input: ProgressInput): Promise<{ applied: boolean; book: UserBook }> {
  // Une horloge d'appareil en avance ne doit pas figer la position pour tous les autres.
  const at = new Date(Math.min(input.at, Date.now()))
  const { count } = await prisma.userBook.updateMany({
    where: { id, userId, OR: [{ progressAt: null }, { progressAt: { lt: at } }] },
    data: { lastCfi: input.cfi, progressPercent: input.percent, progressAt: at },
  })
  return { applied: count > 0, book: await getBook(userId, id) }
}

export interface MetadataPatch {
  title?: string
  author?: string | null
  synopsis?: string
  coverUrl?: string | null
  publisher?: string | null
  year?: number | null
  pages?: number | null
}

/** Corrige la fiche (souvent : une fiche choisie parmi les résultats de la recherche). */
export async function updateMetadata(userId: string, id: string, patch: MetadataPatch): Promise<UserBook> {
  await getBook(userId, id)
  return prisma.userBook.update({ where: { id }, data: patch })
}

export async function deleteBook(userId: string, id: string): Promise<void> {
  const book = await getBook(userId, id)
  await prisma.userBook.delete({ where: { id } })
  await Promise.all([book.filePath, book.coverPath].filter((file): file is string => !!file).map((file) => rm(storagePath(file), { force: true })))
}
