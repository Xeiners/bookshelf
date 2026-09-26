import { prisma } from '../../db.js'
import { notFound } from '../../lib/errors.js'
import {
  rebuildProfile,
  recordFeedback,
  recordReappraisal,
} from '../../services/recommendation/preference.service.js'
import { likeWeight } from '../../services/recommendation/scoring.js'
import { BookSchema, type Book } from '../books/book.schema.js'
import {
  ReadingPositionSchema,
  type EntryInput,
  type LibrarySnapshot,
  type PatchEntryInput,
  type ProgressInput,
  type ReadingPosition,
  type ReadingStatus,
  type SwipeInput,
} from './library.schemas.js'

/** Format renvoyé au front : identique à son `LibraryEntry`, dates en ms. */
export interface LibraryEntryDto {
  book: Book
  status: ReadingStatus
  progress: number
  favorite: boolean
  /** Note personnelle 0,5 → 5, ou `null`. */
  userRating: number | null
  /** Chapitres lus dans le lecteur intégré. */
  chaptersRead: number
  /** Dernière position dans le lecteur, `null` s'il n'a jamais servi. */
  position: ReadingPosition | null
  addedAt: number
  updatedAt: number
}

export interface LibraryDto {
  entries: LibraryEntryDto[]
  skipped: string[]
}

interface EntryRow {
  workId: string
  status: string
  progress: number
  favorite: boolean
  userRating: number | null
  chaptersRead: number
  position: string | null
  snapshot: string
  addedAt: Date
  updatedAt: Date
}

/** Instantané stocké → `Book`, ou `null` s'il est illisible. */
function bookOf(snapshot: string): Book | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(snapshot)
  } catch {
    return null
  }
  const book = BookSchema.safeParse(parsed)
  return book.success ? book.data : null
}

/** Position stockée → objet validé, ou `null` (absente ou illisible). */
function positionOf(raw: string | null): ReadingPosition | null {
  if (!raw) return null
  try {
    const parsed = ReadingPositionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function toDto(row: EntryRow): LibraryEntryDto | null {
  // Un instantané illisible est ignoré plutôt que de faire échouer toute la bibliothèque.
  const book = bookOf(row.snapshot)
  if (!book) return null

  return {
    book,
    status: row.status as ReadingStatus,
    progress: row.progress,
    favorite: row.favorite,
    userRating: row.userRating,
    chaptersRead: row.chaptersRead,
    position: positionOf(row.position),
    addedAt: row.addedAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Un horodatage client ne peut pas être dans le futur : il gagnerait toutes les fusions. */
function clientTime(value: number | undefined, now = Date.now()): Date {
  return new Date(Math.min(value ?? now, now))
}

const snapshotOf = (book: Book) => ({ snapshot: JSON.stringify(book), title: book.title })

export async function getLibrary(userId: string): Promise<LibraryDto> {
  const [rows, skips] = await Promise.all([
    prisma.libraryEntry.findMany({ where: { userId }, orderBy: { addedAt: 'desc' } }),
    prisma.skippedWork.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { workId: true } }),
  ])

  return {
    entries: rows.map(toDto).filter((entry): entry is LibraryEntryDto => entry !== null),
    skipped: skips.map((skip) => skip.workId),
  }
}

/**
 * Fusion « Guest-First » : l'état local d'un invité rejoint son compte.
 *
 * - Aucun doublon possible : la clé (userId, workId) est unique, on fait des upserts.
 * - Conflit sur une même œuvre : la modification la plus récente gagne
 *   (`updatedAt`, à défaut `addedAt`) ; la date d'ajout garde la plus ancienne.
 * - Un skip ne rétrograde jamais une œuvre enregistrée ; enregistrer une œuvre
 *   la retire des skips (même règle que le store du front).
 *
 * Tout se fait dans une transaction : une fusion est appliquée entièrement ou pas du tout.
 */
export async function mergeLibrary(userId: string, snapshot: LibrarySnapshot): Promise<LibraryDto> {
  const now = Date.now()

  // Doublons dans la charge utile elle-même : on garde la version la plus récente.
  const incoming = new Map<string, EntryInput>()
  for (const entry of snapshot.entries) {
    const previous = incoming.get(entry.book.id)
    const stamp = entry.updatedAt ?? entry.addedAt ?? 0
    const previousStamp = previous ? (previous.updatedAt ?? previous.addedAt ?? 0) : -1
    if (stamp >= previousStamp) incoming.set(entry.book.id, entry)
  }

  await prisma.$transaction(
    async (tx) => {
      const existing = new Map(
        (
          await tx.libraryEntry.findMany({
            where: { userId },
            select: { workId: true, addedAt: true, updatedAt: true, chaptersRead: true },
          })
        ).map((row) => [row.workId, row]),
      )

      for (const [workId, entry] of incoming) {
        const addedAt = clientTime(entry.addedAt, now)
        const updatedAt = clientTime(entry.updatedAt ?? entry.addedAt, now)
        const current = existing.get(workId)

        if (!current) {
          await tx.libraryEntry.create({
            data: {
              userId,
              workId,
              status: entry.status,
              progress: entry.progress,
              favorite: entry.favorite,
              userRating: entry.userRating,
              chaptersRead: entry.chaptersRead,
              position: entry.position ? JSON.stringify(entry.position) : null,
              addedAt,
              updatedAt,
              ...snapshotOf(entry.book),
            },
          })
          continue
        }

        const newer = updatedAt > current.updatedAt
        const older = addedAt < current.addedAt
        // Le compteur de chapitres ne recule jamais, même face à un état plus récent.
        const moreChapters = entry.chaptersRead > current.chaptersRead
        if (!newer && !older && !moreChapters) continue

        await tx.libraryEntry.update({
          where: { userId_workId: { userId, workId } },
          data: {
            ...(newer && {
              status: entry.status,
              progress: entry.progress,
              favorite: entry.favorite,
              userRating: entry.userRating,
              position: entry.position ? JSON.stringify(entry.position) : null,
              updatedAt,
              ...snapshotOf(entry.book),
            }),
            ...(older && { addedAt }),
            ...(moreChapters && { chaptersRead: entry.chaptersRead }),
          },
        })
      }

      const saved = new Set([...existing.keys(), ...incoming.keys()])

      if (incoming.size > 0) {
        await tx.skippedWork.deleteMany({ where: { userId, workId: { in: [...incoming.keys()] } } })
      }

      const alreadySkipped = new Set(
        (await tx.skippedWork.findMany({ where: { userId }, select: { workId: true } })).map(
          (skip) => skip.workId,
        ),
      )
      const newSkips = [...new Set(snapshot.skipped)].filter(
        (workId) => !saved.has(workId) && !alreadySkipped.has(workId),
      )
      if (newSkips.length > 0) {
        await tx.skippedWork.createMany({ data: newSkips.map((workId) => ({ userId, workId })) })
      }
    },
    // SQLite sérialise les écritures : une grosse bibliothèque invitée peut prendre un moment.
    { timeout: 20_000 },
  )

  // L'historique invité rejoint le compte : le profil de goûts est recalculé en entier.
  await rebuildProfile(userId)
  return getLibrary(userId)
}

/**
 * Action du deck (ou de la fiche) : idempotente, rejouable sans effet de bord.
 * Renvoie l'entrée à jour, ou `null` pour un skip.
 */
export async function applySwipe(userId: string, swipe: SwipeInput): Promise<LibraryEntryDto | null> {
  const workId = swipe.mangaId
  const at = clientTime(swipe.at)

  if (swipe.action === 'skipped') {
    const saved = await prisma.libraryEntry.findUnique({
      where: { userId_workId: { userId, workId } },
      select: { workId: true },
    })
    // Une œuvre déjà enregistrée n'est jamais rétrogradée par un skip.
    if (!saved) {
      const already = await prisma.skippedWork.findUnique({
        where: { userId_workId: { userId, workId } },
        select: { workId: true },
      })
      await prisma.skippedWork.upsert({
        where: { userId_workId: { userId, workId } },
        create: { userId, workId, createdAt: at },
        update: {},
      })
      // Rejouer un skip (file d'envoi) ne pénalise pas deux fois.
      if (!already) await recordFeedback(userId, workId, 'skip')
    }
    return null
  }

  // Garanti par le schéma de validation.
  const book = swipe.book as Book
  const status = swipe.action

  const { row, isNew, wasSkipped } = await prisma.$transaction(async (tx) => {
    const previous = await tx.libraryEntry.findUnique({
      where: { userId_workId: { userId, workId } },
      select: { progress: true },
    })
    const skipped = await tx.skippedWork.findUnique({
      where: { userId_workId: { userId, workId } },
      select: { workId: true },
    })
    // Même règle que le front : « lu » verrouille la progression à 100 %.
    const progress = status === 'read' ? 1 : (previous?.progress ?? 0)

    const entry = await tx.libraryEntry.upsert({
      where: { userId_workId: { userId, workId } },
      create: { userId, workId, status, progress, addedAt: at, updatedAt: at, ...snapshotOf(book) },
      update: { status, progress, updatedAt: at, ...snapshotOf(book) },
    })
    await tx.skippedWork.deleteMany({ where: { userId, workId } })
    return { row: entry, isNew: previous === null, wasSkipped: skipped !== null }
  })

  // Profil de goûts : seulement à l'entrée en bibliothèque (changer de statut ne recompte pas).
  if (isNew) {
    if (wasSkipped) await recordFeedback(userId, workId, 'skip', { sign: -1 })
    await recordFeedback(userId, workId, 'like', { book })
  }
  return toDto(row)
}

export async function patchEntry(
  userId: string,
  workId: string,
  patch: PatchEntryInput,
): Promise<LibraryEntryDto> {
  const where = { userId_workId: { userId, workId } }
  const before = await prisma.libraryEntry.findUnique({ where, select: { favorite: true, userRating: true } })
  if (!before) throw notFound('Cette œuvre n’est pas dans ta bibliothèque.')

  const row = await prisma.libraryEntry.update({
    where,
    data: {
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.progress !== undefined && { progress: patch.progress }),
      ...(patch.favorite !== undefined && { favorite: patch.favorite }),
      ...(patch.userRating !== undefined && { userRating: patch.userRating }),
      updatedAt: clientTime(patch.at),
    },
  })

  const dto = toDto(row)
  if (!dto) throw notFound()
  // Favori ou note changés : le profil de goûts suit (seul l'écart est appliqué).
  if (before.favorite !== row.favorite || before.userRating !== row.userRating) {
    await recordReappraisal(userId, workId, before, row, dto.book)
  }
  return dto
}

/**
 * Position du lecteur intégré (`PATCH /library/progress`).
 *
 * - La position la plus récente gagne : un envoi en retard (file hors-ligne
 *   d'un autre appareil) ne ramène pas le lecteur en arrière.
 * - `chaptersRead` ne fait que croître, quel que soit l'ordre d'arrivée.
 * - L'œuvre doit déjà être en bibliothèque : le front l'y ajoute (« En cours »)
 *   dès l'ouverture du lecteur, et sa file d'envoi garde l'ordre des opérations.
 */
export async function saveProgress(userId: string, input: ProgressInput): Promise<LibraryEntryDto> {
  const where = { userId_workId: { userId, workId: input.workId } }
  const before = await prisma.libraryEntry.findUnique({
    where,
    select: { chaptersRead: true, updatedAt: true },
  })
  if (!before) throw notFound('Cette œuvre n’est pas dans ta bibliothèque.')

  const at = clientTime(input.at ?? input.position.at)
  const fresh = at >= before.updatedAt
  const chaptersRead = Math.max(before.chaptersRead, input.chaptersRead ?? 0)

  const row = await prisma.libraryEntry.update({
    where,
    data: {
      chaptersRead,
      ...(fresh && {
        position: JSON.stringify(input.position),
        ...(input.progress !== undefined && { progress: input.progress }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: at,
      }),
    },
  })

  const dto = toDto(row)
  if (!dto) throw notFound()
  return dto
}

/**
 * Oublie l'œuvre : entrée ET « skip ». C'est aussi l'annulation d'un choix du
 * deck (« Retour ») : l'œuvre redevient neuve. Idempotent : supprimer une
 * entrée absente n'est pas une erreur.
 */
export async function removeEntry(userId: string, workId: string): Promise<void> {
  const where = { userId_workId: { userId, workId } }
  const [entry, skip] = await Promise.all([
    prisma.libraryEntry.findUnique({ where, select: { snapshot: true, favorite: true, userRating: true } }),
    prisma.skippedWork.findUnique({ where, select: { workId: true } }),
  ])
  await prisma.$transaction([
    prisma.libraryEntry.deleteMany({ where: { userId, workId } }),
    prisma.skippedWork.deleteMany({ where: { userId, workId } }),
  ])

  // Le choix est annulé : son effet sur le profil de goûts aussi.
  if (entry) {
    await recordFeedback(userId, workId, 'like', {
      book: bookOf(entry.snapshot) ?? undefined,
      sign: -1,
      // Tout son poids : favori et note compris.
      weight: likeWeight(entry),
    })
  }
  if (skip) await recordFeedback(userId, workId, 'skip', { sign: -1 })
}

export async function resetLibrary(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.libraryEntry.deleteMany({ where: { userId } }),
    prisma.skippedWork.deleteMany({ where: { userId } }),
    prisma.userPreference.deleteMany({ where: { userId } }),
  ])
}
