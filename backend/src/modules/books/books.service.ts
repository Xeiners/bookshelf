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
import { BookSchema, type Book } from './book.schema.js'
import type { MatchDecision } from './epub.match.js'
import { InvalidEpubError, parseEpub, type EpubMetadata } from './epub.parser.js'
import { toBook } from './metadata.normalize.js'
import { matchNovel } from './metadata.service.js'

/**
 * Romans importés (EPUB) : réception du fichier, lecture de ses métadonnées,
 * enrichissement en ligne, rattachement à une fiche de la bibliothèque,
 * stockage, et position de lecture synchronisée.
 *
 * Chaque fichier se rattache à une fiche (`workId`, cf. `epub.match.ts`) : un
 * roman en ligne (`ol:…`, `gb:…`) reconnu d'office ou choisi par
 * l'utilisateur, sinon une fiche tirée du fichier lui-même (`novel:<id>`). La
 * fiche vit dans la bibliothèque (`LibraryEntry`, écrite par le client comme
 * toute entrée) : le livre importé y apparaît avec les mangas et les romans
 * ajoutés depuis la recherche.
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

/* ---- Rattachement à une fiche --------------------------------------------------- */

const OWN_PREFIX = 'novel:'
/** Fiche tirée du fichier lui-même : même identifiant que le livre importé. */
export const ownWorkId = (bookId: string) => `${OWN_PREFIX}${bookId}`
/** Fiches de roman en ligne auxquelles un fichier peut être rattaché (Open Library, Google Books). */
export const ONLINE_NOVEL_ID = /^(ol:OL\d+W|gb:[\w-]{1,64})$/

/**
 * Issue d'un import (ou d'un nouveau rapprochement) : la fiche à placer dans
 * la bibliothèque, ou les fiches entre lesquelles l'utilisateur doit choisir.
 * `record: null` : la fiche est déjà connue du client (import depuis sa fiche).
 */
export type ImportMatch =
  | { status: 'linked'; record: Book | null }
  | { status: 'created'; record: Book }
  | { status: 'choose'; candidates: Book[] }

/** Fiche `Book` tirée du fichier (titre, auteur, couverture, résumé de l'EPUB et de sa fiche en ligne). */
export function ownRecord(book: UserBook): Book {
  const language = book.language === 'fr' || book.language === 'en' ? book.language : null
  return {
    id: ownWorkId(book.id),
    title: book.title,
    subtitle: null,
    authors: book.author ? book.author.split(',').map((name) => name.trim()).filter(Boolean) : [],
    cover: toDto(book).coverUrl,
    synopsis: book.synopsis,
    categories: [],
    rating: null,
    ratingsCount: 0,
    pages: book.pages,
    year: book.year,
    publisher: book.publisher,
    previewLink: null,
    kind: 'book',
    languages: language ? [language] : [],
    ...(language && { lang: language }),
    synopsisLanguage: book.synopsis ? language : null,
  }
}

export const workAlreadyLinked = () =>
  new HttpError(409, 'work_already_linked', 'Un autre fichier EPUB est déjà associé à cette fiche.')

/** Rattache le fichier à une fiche. Une fiche n'a qu'un fichier : 409 si elle en a déjà un autre. */
async function setWorkId(book: UserBook, workId: string): Promise<UserBook> {
  if (book.workId === workId) return book
  try {
    return await prisma.userBook.update({ where: { id: book.id }, data: { workId } })
  } catch (error) {
    if (isUniqueViolation(error)) throw workAlreadyLinked()
    throw error
  }
}

/** Fiche déjà rattachée, telle que la bibliothèque du compte la connaît. */
async function linkedRecord(book: UserBook): Promise<Book | null> {
  if (!book.workId) return null
  if (book.workId === ownWorkId(book.id)) return ownRecord(book)
  const entry = await prisma.libraryEntry.findUnique({
    where: { userId_workId: { userId: book.userId, workId: book.workId } },
    select: { snapshot: true },
  })
  if (!entry) return null
  try {
    const parsed = BookSchema.safeParse(JSON.parse(entry.snapshot))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Applique une décision de rapprochement. Fiche en ligne sûre mais déjà
 * occupée par un autre fichier du compte (deux éditions du même roman) :
 * celui-ci garde sa propre fiche plutôt que d'en déloger l'autre.
 */
async function applyDecision(book: UserBook, decision: MatchDecision, language: Language, interactive: boolean): Promise<{ book: UserBook; match: ImportMatch }> {
  if (decision.kind === 'confident') {
    try {
      const linked = await setWorkId(book, decision.item.id)
      return { book: linked, match: { status: 'linked', record: toBook(decision.item, language) } }
    } catch (error) {
      if (!(error instanceof HttpError && error.code === 'work_already_linked')) throw error
    }
  }
  if (decision.kind === 'choose' && interactive) {
    return { book, match: { status: 'choose', candidates: decision.candidates.map((item) => toBook(item, language)) } }
  }
  const own = await setWorkId(book, ownWorkId(book.id))
  return { book: own, match: { status: 'created', record: ownRecord(own) } }
}

/**
 * Enregistre un EPUB reçu : même fichier déjà importé → la fiche existante
 * (`duplicate`) ; sinon métadonnées du fichier, complétées en ligne (résumé,
 * couverture HD si le fichier n'en a pas, pagination, parution).
 *
 * Rattachement : `target` (import depuis la fiche d'un roman) l'impose ;
 * sinon il est décidé d'après les fiches en ligne (cf. `epub.match.ts`).
 * Le fichier temporaire est toujours consommé.
 */
export async function importBook(
  userId: string,
  upload: ReceivedUpload,
  originalName: string,
  language: Language,
  target: string | null = null,
): Promise<{ book: UserBook; duplicate: boolean; match: ImportMatch }> {
  try {
    const existing = await prisma.userBook.findUnique({ where: { userId_sha256: { userId, sha256: upload.sha256 } } })
    if (existing) {
      if (target) return { book: await setWorkId(existing, target), duplicate: true, match: { status: 'linked', record: null } }
      const record = await linkedRecord(existing)
      if (existing.workId && record) return { book: existing, duplicate: true, match: { status: 'linked', record } }
      const found = await matchNovel({ title: existing.title, author: existing.author, isbn: null }, language)
      return { ...(await applyDecision(existing, found.decision, language, true)), duplicate: true }
    }
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
    // Fiche imposée : la recherche ne sert qu'à compléter les métadonnées du fichier.
    const found = await matchNovel({ title, author: metadata.author, isbn: metadata.isbn }, lookupLanguage)
    const online = found.enrich

    await mkdir(storagePath(userId), { recursive: true })
    const filePath = `${userId}/${upload.sha256}.epub`
    await rename(upload.tempPath, storagePath(filePath))
    let coverPath: string | null = null
    if (metadata.cover) {
      coverPath = `${userId}/${upload.sha256}.cover.${metadata.cover.extension}`
      await writeFile(storagePath(coverPath), metadata.cover.data)
    }

    let book: UserBook
    try {
      book = await prisma.userBook.create({
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
      return { book: winner, duplicate: true, match: { status: 'linked', record: await linkedRecord(winner) } }
    }

    if (target) {
      try {
        return { book: await setWorkId(book, target), duplicate: false, match: { status: 'linked', record: null } }
      } catch (error) {
        // Fiche déjà dotée d'un fichier : l'import est gardé, rattaché à sa propre fiche, et le client prévenu.
        if (!(error instanceof HttpError && error.code === 'work_already_linked')) throw error
        await setWorkId(book, ownWorkId(book.id))
        throw error
      }
    }
    return { ...(await applyDecision(book, found.decision, lookupLanguage, true)), duplicate: false }
  } finally {
    await rm(upload.tempPath, { force: true })
  }
}

/**
 * Rattache un livre importé à la fiche choisie par l'utilisateur (parmi les
 * propositions, ou une recherche), ou à une fiche tirée du fichier (`own`).
 */
export async function linkBook(
  userId: string,
  id: string,
  choice: { record: Book } | { own: true },
): Promise<{ book: UserBook; record: Book }> {
  const book = await getBook(userId, id)
  if ('own' in choice) {
    const own = await setWorkId(book, ownWorkId(book.id))
    return { book: own, record: ownRecord(own) }
  }
  if (!ONLINE_NOVEL_ID.test(choice.record.id) || choice.record.kind !== 'book') {
    throw new HttpError(400, 'not_a_novel', 'Seule une fiche de roman peut recevoir un fichier EPUB.')
  }
  return { book: await setWorkId(book, choice.record.id), record: choice.record }
}

/**
 * Nouveau rapprochement d'un livre importé : pour les imports d'avant le
 * rattachement (`auto` : jamais de question, une fiche propre au fichier en
 * cas de doute), ou pour revoir les propositions (`interactive`).
 */
export async function matchBook(
  userId: string,
  id: string,
  language: Language,
  mode: 'auto' | 'interactive',
): Promise<{ book: UserBook; match: ImportMatch }> {
  const book = await getBook(userId, id)
  if (book.workId && mode === 'auto') {
    return { book, match: { status: 'linked', record: (await linkedRecord(book)) ?? ownRecord(book) } }
  }
  const found = await matchNovel({ title: book.title, author: book.author, isbn: null }, language)
  return applyDecision(book, found.decision, language, mode === 'interactive')
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
    /** Fiche de la bibliothèque rattachée (`ol:…`, `gb:…`, `novel:<id>`), `null` si pas encore rattaché. */
    workId: book.workId,
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
