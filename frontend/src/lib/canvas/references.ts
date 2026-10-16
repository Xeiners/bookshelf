/*
 * Images de référence : des photos ou des dessins qu'on pose sur la toile pour calquer dessus.
 * Elles restent PRIVÉES (sur cet appareil, dans IndexedDB) : le serveur n'en reçoit jamais rien,
 * personne d'autre ne les voit. On les place, les agrandit, les tourne, on baisse leur opacité,
 * on les met sous ou sur ses dessins, on les verrouille pour dessiner sans les déplacer.
 */

export const MAX_REFERENCES = 8
/** Plus grand côté gardé (px) : une photo de téléphone ne pèse pas des dizaines de Mo en mémoire. */
const MAX_SIDE = 2048
const MAX_FILE_BYTES = 25 * 1024 * 1024

export interface Reference {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** Rotation (radians) autour du centre. */
  r: number
  opacity: number
  visible: boolean
  locked: boolean
  /** Dessinée par-dessus les objets (sinon dessous : comme un calque posé sous le papier). */
  above: boolean
  bitmap: ImageBitmap
  /** Vignette pour la liste (URL d'objet). */
  thumb: string
  createdAt: number
}

export type ReferencePatch = Partial<Pick<Reference, 'x' | 'y' | 'w' | 'h' | 'r' | 'opacity' | 'visible' | 'locked' | 'above'>>

interface Stored {
  id: string
  blob: Blob
  x: number
  y: number
  w: number
  h: number
  r: number
  opacity: number
  visible: boolean
  locked: boolean
  above: boolean
  createdAt: number
}

/* ---- IndexedDB (facultatif : sans lui, les images vivent le temps de la page) -------------- */

const STORE = 'refs'

function open(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

const request = <T,>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> =>
  new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, mode)
      const result = run(transaction.objectStore(STORE))
      result.onsuccess = () => resolve(result.result)
      result.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })

/** Réduit l'image et la réencode (WebP si le navigateur sait, sinon PNG). */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (file.size > MAX_FILE_BYTES || !file.type.startsWith('image/')) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/webp', 0.9))
  const png = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'))
  return png ? { blob: png, width, height } : null
}

const uid = () => {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class ReferenceLayer {
  items: Reference[] = []
  /** Incrémenté à chaque changement visible : le moteur redessine. */
  revision = 0
  private db: IDBDatabase | null = null
  private name = ''
  private readonly onChange: () => void
  private saving = new Map<string, ReturnType<typeof setTimeout>>()
  private blobs = new Map<string, Blob>()

  constructor(onChange: () => void) {
    this.onChange = onChange
  }

  /** Charge les images de ce compte (à la connexion). */
  async attach(userId: string): Promise<void> {
    const name = `bookshelf-canvas-${userId}`
    if (this.name === name) return
    this.dispose()
    this.name = name
    this.db = await open(name)
    if (!this.db) return
    const rows = (await request<Stored[]>(this.db, 'readonly', (store) => store.getAll())) ?? []
    for (const row of rows.sort((a, b) => a.createdAt - b.createdAt)) {
      try {
        this.items.push(await this.revive(row))
        this.blobs.set(row.id, row.blob)
      } catch {
        // Image illisible : ignorée.
      }
    }
    this.touch()
  }

  private async revive(row: Stored): Promise<Reference> {
    const bitmap = await createImageBitmap(row.blob)
    return { id: row.id, x: row.x, y: row.y, w: row.w, h: row.h, r: row.r, opacity: row.opacity, visible: row.visible, locked: row.locked, above: row.above, bitmap, thumb: URL.createObjectURL(row.blob), createdAt: row.createdAt }
  }

  private touch(): void {
    this.revision += 1
    this.onChange()
  }

  get(id: string): Reference | undefined {
    return this.items.find((item) => item.id === id)
  }

  /** Ajoute une image : réduite, posée au centre de la vue, à la taille d'un bon morceau de l'écran. */
  async add(file: Blob, center: [number, number], span: number): Promise<Reference | 'limit' | 'failed'> {
    if (this.items.length >= MAX_REFERENCES) return 'limit'
    const prepared = await prepareImage(file)
    if (!prepared) return 'failed'
    const bitmap = await createImageBitmap(prepared.blob)
    const scale = span / Math.max(prepared.width, prepared.height)
    const w = prepared.width * scale
    const h = prepared.height * scale
    const item: Reference = { id: uid(), x: center[0] - w / 2, y: center[1] - h / 2, w, h, r: 0, opacity: 0.5, visible: true, locked: false, above: true, bitmap, thumb: URL.createObjectURL(prepared.blob), createdAt: Date.now() }
    this.items.push(item)
    this.blobs.set(item.id, prepared.blob)
    this.persist(item)
    this.touch()
    return item
  }

  update(id: string, patch: ReferencePatch): void {
    const item = this.get(id)
    if (!item) return
    Object.assign(item, patch)
    this.persist(item)
    this.touch()
  }

  /** Remonte une image au-dessus des autres (la dernière dessinée est au-dessus). */
  raise(id: string): void {
    const index = this.items.findIndex((item) => item.id === id)
    if (index < 0 || index === this.items.length - 1) return
    const [item] = this.items.splice(index, 1)
    this.items.push(item!)
    this.touch()
  }

  remove(id: string): void {
    const item = this.get(id)
    if (!item) return
    item.bitmap.close()
    URL.revokeObjectURL(item.thumb)
    this.items = this.items.filter((entry) => entry.id !== id)
    this.blobs.delete(id)
    const timer = this.saving.get(id)
    if (timer) clearTimeout(timer)
    this.saving.delete(id)
    if (this.db) void request(this.db, 'readwrite', (store) => store.delete(id))
    this.touch()
  }

  /** Écrit l'image dans IndexedDB (regroupé : un déplacement ne réécrit pas à chaque image). */
  private persist(item: Reference): void {
    if (!this.db) return
    const known = this.saving.get(item.id)
    if (known) clearTimeout(known)
    this.saving.set(
      item.id,
      setTimeout(() => {
        this.saving.delete(item.id)
        const blob = this.blobs.get(item.id)
        if (!this.db || !blob || !this.get(item.id)) return
        const row: Stored = { id: item.id, blob, x: item.x, y: item.y, w: item.w, h: item.h, r: item.r, opacity: item.opacity, visible: item.visible, locked: item.locked, above: item.above, createdAt: item.createdAt }
        void request(this.db, 'readwrite', (store) => store.put(row))
      }, 350),
    )
  }

  /** Dessine les images (le contexte est dans le repère du monde) : celles du dessus, ou celles du dessous. */
  draw(ctx: CanvasRenderingContext2D, above: boolean): void {
    for (const item of this.items) {
      if (!item.visible || item.above !== above) continue
      ctx.save()
      ctx.globalAlpha = item.opacity
      ctx.translate(item.x + item.w / 2, item.y + item.h / 2)
      ctx.rotate(item.r)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(item.bitmap, -item.w / 2, -item.h / 2, item.w, item.h)
      ctx.restore()
    }
  }

  /** L'image visible et déverrouillée sous ce point (la plus haute). */
  hit(x: number, y: number): Reference | null {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index]!
      if (!item.visible || item.locked) continue
      const cos = Math.cos(-item.r)
      const sin = Math.sin(-item.r)
      const dx = x - (item.x + item.w / 2)
      const dy = y - (item.y + item.h / 2)
      if (Math.abs(dx * cos - dy * sin) <= item.w / 2 && Math.abs(dx * sin + dy * cos) <= item.h / 2) return item
    }
    return null
  }

  dispose(): void {
    for (const timer of this.saving.values()) clearTimeout(timer)
    this.saving.clear()
    for (const item of this.items) {
      item.bitmap.close()
      URL.revokeObjectURL(item.thumb)
    }
    this.items = []
    this.blobs.clear()
    this.db?.close()
    this.db = null
    this.name = ''
  }
}
