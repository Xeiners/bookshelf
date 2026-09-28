import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Plus, UserRound, X } from 'lucide-react'
import { useCollection } from '../../hooks/useCollection'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import type { CollectionCard } from '../../lib/boosters'
import { vibrate } from '../../lib/haptics'
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  FEATURED_MAX,
  TITLE_IDS,
  type ProfileCard,
  type ProfileData,
  type ProfilePatch,
  type TitleId,
} from '../../services/profileApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useProfileStore } from '../../store/useProfileStore'
import { useUiStore } from '../../store/useUiStore'
import { Pressable } from '../ui/Pressable'
import { Sheet } from '../ui/Sheet'
import { CardAvatar } from './CardAvatar'
import { CardPicker } from './CardPicker'
import { BookAvatarPickerModal } from './BookAvatarPickerModal'

interface Draft {
  displayName: string
  bio: string
  avatarCardId: string | null
  avatarUrl: string | null
  /** Toujours `FEATURED_MAX` emplacements ; `null` = libre. */
  featured: (string | null)[]
  activeTitle: TitleId | null
}

type Picking = { mode: 'featured'; slot: number }

type CardLike = Pick<ProfileCard, 'id' | 'imageUrl' | 'rarity' | 'name' | 'title'>

const draftOf = ({ profile }: ProfileData): Draft => ({
  displayName: profile.displayName ?? '',
  bio: profile.bio ?? '',
  avatarCardId: profile.avatar?.id ?? null,
  avatarUrl: profile.avatarUrl,
  featured: Array.from({ length: FEATURED_MAX }, (_, slot) => profile.featured[slot]?.id ?? null),
  activeTitle: profile.activeTitle,
})

/** Champs modifiés seulement : l'API ne revalide que ce qui change. */
function patchOf(before: Draft, after: Draft): ProfilePatch {
  const featured = after.featured.filter((id): id is string => id !== null)
  return {
    ...(after.displayName.trim() !== before.displayName.trim() && { displayName: after.displayName.trim() || null }),
    ...(after.bio.trim() !== before.bio.trim() && { bio: after.bio.trim() || null }),
    ...(after.avatarCardId !== before.avatarCardId && { avatarCardId: after.avatarCardId }),
    ...(after.avatarUrl !== before.avatarUrl && { avatarUrl: after.avatarUrl }),
    ...(featured.join('|') !== before.featured.filter(Boolean).join('|') && { featuredCardIds: featured }),
    ...(after.activeTitle !== before.activeTitle && { activeTitle: after.activeTitle }),
  }
}

const labelClass = 'text-[10px] font-semibold tracking-[0.22em] text-mist uppercase'
/** Champ de saisie (mêmes classes que la feuille de connexion). */
const fieldClass =
  'glass w-full rounded-2xl px-4 py-3 text-sm text-cream placeholder:text-mist/60 focus:ring-2 focus:ring-glow/60 focus:outline-none' // i18n-ignore : classes CSS

/**
 * Édition du profil : pseudo, bio, titre affiché, avatar et vitrine (cartes
 * possédées uniquement : le serveur le vérifie aussi). Un seul envoi, avec les
 * seuls champs modifiés.
 */
export function ProfileEditor() {
  const t = useT()
  const close = useUiStore((state) => state.closeProfileEditor)
  const notify = useUiStore((state) => state.notify)
  const profile = useProfileStore((state) => state.data)
  const load = useProfileStore((state) => state.load)
  const update = useProfileStore((state) => state.update)
  const { data: album } = useCollection()

  const [initial, setInitial] = useState<Draft | null>(() => (profile ? draftOf(profile) : null))
  const [draft, setDraft] = useState<Draft | null>(initial)
  const [picking, setPicking] = useState<Picking | null>(null)
  const [saving, setSaving] = useState(false)
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ouvert avant le chargement du profil : le brouillon part de la réponse.
  useEffect(() => {
    if (!profile) void load()
  }, [profile, load])
  if (profile && !initial) {
    const next = draftOf(profile)
    setInitial(next)
    setDraft(next)
  }

  /** Fiches connues : l'album (toutes les cartes possédées) et les cartes déjà exposées. */
  const cardsById = useMemo(() => {
    const map = new Map<string, CardLike>()
    for (const card of profile?.profile.featured ?? []) map.set(card.id, card)
    if (profile?.profile.avatar) map.set(profile.profile.avatar.id, profile.profile.avatar)
    for (const card of album?.cards ?? []) if (card.owned) map.set(card.id, card)
    return map
  }, [profile, album])

  const unlocked = useMemo(
    () => new Set(profile?.titles.filter((title) => title.unlocked).map((title) => title.id)),
    [profile],
  )

  const patch = initial && draft ? patchOf(initial, draft) : {}
  const dirty = Object.keys(patch).length > 0

  const edit = (change: Partial<Draft>) => {
    setError(null)
    setDraft((current) => (current ? { ...current, ...change } : current))
  }

  const pick = (card: CollectionCard) => {
    if (!draft || !picking) return
    vibrate(6)
    edit({ featured: draft.featured.map((id, slot) => (slot === picking.slot ? card.id : id)) })
    setPicking(null)
  }

  const save = async (dismiss: () => void) => {
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      const data = await update(patch)
      // Le pseudo s'affiche aussi ailleurs (barre latérale, e-mails) : la session suit.
      useAuthStore.setState((state) =>
        state.user ? { user: { ...state.user, displayName: data.profile.displayName } } : state,
      )
      vibrate(10)
      notify(t.profile.editor.saved, 'like')
      dismiss()
    } catch (reason) {
      setError(apiErrorMessage(reason, t))
      setSaving(false)
    }
  }

  const avatar = draft?.avatarCardId ? (cardsById.get(draft.avatarCardId) ?? null) : null
  const initialLetter = (draft?.displayName.trim() || profile?.profile.email || '?').charAt(0).toUpperCase()

  return (
    <Sheet
      label={t.profile.editor.heading}
      title={t.profile.editor.heading}
      onClose={close}
      footer={(dismiss) =>
        picking === null && (
          <>
            {error && (
              <p role="alert" className="mb-3 text-center text-xs text-nope">
                {error}
              </p>
            )}
            <Pressable
              onClick={() => void save(dismiss)}
              disabled={!dirty || saving}
              press={0.96}
              className="w-full rounded-full bg-cream py-3 text-sm font-medium text-void disabled:opacity-40"
            >
              {saving ? t.profile.editor.saving : t.profile.editor.save}
            </Pressable>
          </>
        )
      }
    >
      {!draft ? (
        <div className="space-y-3 pt-2">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-14 overflow-hidden rounded-2xl bg-cream/5">
              <div className="animate-shimmer h-full w-1/2 bg-linear-to-r from-transparent via-white/[0.05] to-transparent" />
            </div>
          ))}
        </div>
      ) : picking ? (
        <CardPicker
          heading={t.profile.editor.pickFeatured(picking.slot + 1)}
          cards={album?.cards ?? []}
          loading={!album}
          selectedId={draft.featured[picking.slot]!}
          unavailableIds={new Set(draft.featured.filter((id, slot): id is string => id !== null && slot !== picking.slot))}
          onPick={pick}
          onBack={() => setPicking(null)}
        />
      ) : (
        <div className="space-y-6 pt-1">
          <div className="flex items-center gap-4">
            <CardAvatar card={avatar} avatarUrl={draft.avatarUrl} initial={initialLetter} size={72} />
            <div className="min-w-0 flex-1">
              <p className={labelClass}>{t.profile.editor.avatar}</p>
              <p className="mt-1 text-[11px] leading-snug text-mist">{t.profile.editor.avatarHint}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLibraryPickerOpen(true)}
                  className="glass flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] text-cream/85"
                >
                  <UserRound size={12} />
                  {t.profile.editor.chooseProfilePhoto}
                </button>
                {(draft.avatarCardId || draft.avatarUrl) && (
                  <button
                    type="button"
                    onClick={() => edit({ avatarCardId: null, avatarUrl: null })}
                    className="rounded-full px-3 py-1.5 text-[11px] text-nope/80"
                  >
                    {t.profile.editor.removeAvatar}
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="block">
            <span className={labelClass}>{t.profile.editor.displayName}</span>
            <input
              value={draft.displayName}
              onChange={(event) => edit({ displayName: event.target.value })}
              maxLength={DISPLAY_NAME_MAX}
              placeholder={t.profile.editor.displayNamePlaceholder}
              autoComplete="nickname"
              className={`${fieldClass} mt-2`}
            />
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between">
              <span className={labelClass}>{t.profile.editor.bio}</span>
              <span className="text-[10px] text-mist tabular-nums">{t.profile.editor.counter(draft.bio.length, BIO_MAX)}</span>
            </span>
            <textarea
              value={draft.bio}
              onChange={(event) => edit({ bio: event.target.value })}
              maxLength={BIO_MAX}
              rows={3}
              placeholder={t.profile.editor.bioPlaceholder}
              className={`${fieldClass} mt-2 resize-none leading-relaxed`}
            />
          </label>

          <div>
            <p className={labelClass}>{t.profile.editor.showcase}</p>
            <p className="mt-1 text-[11px] text-mist">{t.profile.editor.showcaseHint}</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {draft.featured.map((id, slot) => {
                const card = id ? cardsById.get(id) : undefined
                return (
                  <div key={slot} className="relative">
                    <button
                      type="button"
                      onClick={() => setPicking({ mode: 'featured', slot })}
                      aria-label={card ? card.name || card.title : t.profile.editor.slot(slot + 1)}
                      className="relative block aspect-[63/88] w-full overflow-hidden rounded-xl border-2 border-dashed border-cream/15 bg-cream/[0.03] text-cream/40"
                    >
                      {card ? (
                        <img src={card.imageUrl} alt="" draggable={false} className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full flex-col items-center justify-center gap-1.5">
                          <Plus size={20} />
                          <span className="text-[10px]">{t.profile.editor.slot(slot + 1)}</span>
                        </span>
                      )}
                    </button>
                    {card && (
                      <button
                        type="button"
                        onClick={() => edit({ featured: draft.featured.map((current, index) => (index === slot ? null : current)) })}
                        aria-label={t.profile.editor.removeCard(card.name || card.title)}
                        className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-void text-cream/80 ring-1 ring-white/20"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <p className={labelClass}>{t.profile.editor.titleLabel}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => edit({ activeTitle: null })}
                aria-pressed={draft.activeTitle === null}
                className={`rounded-full px-3.5 py-1.5 text-[11px] ${
                  draft.activeTitle === null ? 'bg-cream text-void' : 'glass text-cream/70'
                }`}
              >
                {t.profile.editor.noTitle}
              </button>
              {TITLE_IDS.map((id) => {
                const available = unlocked.has(id)
                const active = draft.activeTitle === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => edit({ activeTitle: id })}
                    disabled={!available}
                    aria-pressed={active}
                    title={t.profile.titleHints[id]}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] disabled:opacity-40 ${
                      active ? 'bg-gold text-void' : 'glass text-cream/75'
                    }`}
                  >
                    {!available && <Lock size={10} />}
                    {t.profile.titles[id]}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {libraryPickerOpen && createPortal(
        <BookAvatarPickerModal
          onClose={() => setLibraryPickerOpen(false)}
          onPick={(avatarUrl) => {
            edit({ avatarUrl, avatarCardId: null })
            setLibraryPickerOpen(false)
          }}
        />,
        document.body,
      )}
    </Sheet>
  )
}
