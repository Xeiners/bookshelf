import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, Lock, ShoppingBag } from 'lucide-react'
import moonUrl from '../../assets/moon-soul-eater.svg'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { vibrate } from '../../lib/haptics'
import { JUMP_CHARACTERS, type JumpCharacterId } from '../../lib/jump/characters'
import { jumpApi, type JumpCharacters } from '../../services/jumpApi'
import { useAuthStore } from '../../store/useAuthStore'
import { useDleStore } from '../../store/useDleStore'
import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../ui/Sheet'
import { paintCharacter } from './characters'

/** La vitrine, du moins cher au plus cher (la Lune, offerte, en tête). */
const BY_PRICE = [...JUMP_CHARACTERS].sort((a, b) => a.price - b.price)

/** Le portrait d'un personnage : la Lune (image), ou son dessin au canvas, net à toute densité d'écran. */
export function CharacterPortrait({ id, size }: { id: JumpCharacterId; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * ratio)
    canvas.height = Math.round(size * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size, size)
    // Un peu de marge au-dessus (cheveux, oreilles), comme en jeu.
    ctx.translate(size * 0.09, size * 0.16)
    paintCharacter(ctx, id, size * 0.82)
  }, [id, size])
  if (id === 'moon') return <img src={moonUrl} alt="" draggable={false} className="block object-contain" style={{ width: size, height: size }} />
  return <canvas ref={ref} aria-hidden className="block" style={{ width: size, height: size }} />
}

/**
 * Les personnages de Page Jump : une vitrine (la Lune offerte, les autres contre des ✦). Un
 * personnage possédé se choisit d'un toucher ; un autre ouvre la fiche d'achat.
 */
export function CharacterShop({ characters, onChange }: { characters: JumpCharacters | null; onChange: (next: JumpCharacters) => void }) {
  const t = useT()
  const copy = t.jump.characters
  const notify = useUiStore((state) => state.notify)
  const openAuth = useUiStore((state) => state.openAuth)
  const signedIn = useAuthStore((state) => state.user !== null)
  const [buying, setBuying] = useState<JumpCharacterId | null>(null)
  const [selecting, setSelecting] = useState<JumpCharacterId | null>(null)
  const owned = new Set(characters?.owned ?? ['moon'])
  const selected = characters?.selected ?? 'moon'

  const pick = async (id: JumpCharacterId) => {
    vibrate(8)
    if (id === selected) return
    if (!owned.has(id)) {
      if (!signedIn) openAuth()
      else setBuying(id)
      return
    }
    if (!signedIn) return
    setSelecting(id)
    try {
      onChange(await jumpApi.selectCharacter(id))
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setSelecting(null)
    }
  }

  return (
    <section data-jump-in className="flex shrink-0 flex-col gap-3 rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-mist uppercase">{copy.title}</p>
        <p className="mt-0.5 text-xs text-cream/55">{signedIn ? copy.subtitle : copy.guest}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {BY_PRICE.map(({ id, price, tint }) => {
          const mine = owned.has(id)
          const chosen = id === selected
          return (
            <button
              key={id}
              type="button"
              onClick={() => void pick(id)}
              aria-pressed={chosen}
              aria-label={copy.names[id]}
              className={`relative flex min-w-0 flex-col items-center gap-1 overflow-hidden rounded-2xl border px-1.5 pt-2 pb-2 transition-transform active:scale-[0.97] ${chosen ? 'border-[#ffd35c]' : 'border-white/10'}`}
              style={{ background: `radial-gradient(80% 60% at 50% 35%, ${tint}${mine ? '40' : '1c'}, transparent 75%), #110d18` }}
            >
              <span className={mine ? '' : 'opacity-70'}>
                <CharacterPortrait id={id} size={64} />
              </span>
              <span className="w-full truncate text-center text-xs font-semibold text-cream">{copy.names[id]}</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${chosen ? 'bg-[#ffd35c] text-[#2a1404]' : mine ? 'bg-white/10 text-cream/80' : 'bg-black/40 text-gold'}`}
              >
                {selecting === id ? (
                  <Loader2 size={10} className="animate-spin" aria-hidden />
                ) : chosen ? (
                  <Check size={10} aria-hidden />
                ) : mine ? null : (
                  <Lock size={10} aria-hidden />
                )}
                {chosen ? copy.selected : mine ? copy.choose : `${price.toLocaleString()} ✦`}
              </span>
            </button>
          )
        })}
      </div>
      {buying && (
        <BuySheet
          id={buying}
          onClose={() => setBuying(null)}
          onBought={(next) => {
            onChange(next)
            notify(copy.bought(copy.names[buying]), 'like')
          }}
        />
      )}
    </section>
  )
}

/** La fiche d'achat : le portrait en grand, le prix, le solde, « Acheter et jouer avec ». */
function BuySheet({ id, onClose, onBought }: { id: JumpCharacterId; onClose: () => void; onBought: (next: JumpCharacters) => void }) {
  const t = useT()
  const copy = t.jump.characters
  const notify = useUiStore((state) => state.notify)
  const balance = useDleStore((state) => state.overview?.stardust ?? 0)
  const price = JUMP_CHARACTERS.find((character) => character.id === id)?.price ?? 0
  const tint = JUMP_CHARACTERS.find((character) => character.id === id)?.tint ?? '#ffd35c'
  const [busy, setBusy] = useState(false)
  const affordable = balance >= price

  const buy = async (dismiss: () => void) => {
    if (busy || !affordable) return
    setBusy(true)
    try {
      const result = await jumpApi.buyCharacter(id)
      useDleStore.getState().setStardust(result.balance)
      vibrate([10, 40, 18])
      onBought({ owned: result.owned, selected: result.selected })
      dismiss()
    } catch (error) {
      notify(apiErrorMessage(error, t), 'nope')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <Sheet
      label={copy.names[id]}
      title={copy.names[id]}
      subtitle={copy.buySubtitle}
      onClose={onClose}
      footer={(dismiss) => (
        <button
          type="button"
          disabled={busy || !affordable}
          onClick={() => void buy(dismiss)}
          className="btn-cta inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <ShoppingBag size={17} aria-hidden />}
          {copy.buy(price)}
        </button>
      )}
    >
      <div className="flex flex-col items-center gap-3 pb-1">
        <span className="grid size-40 place-items-center rounded-full" style={{ background: `radial-gradient(closest-side, ${tint}55, transparent)` }}>
          <CharacterPortrait id={id} size={132} />
        </span>
        <p className="text-center text-xs text-cream/55 tabular-nums">{affordable ? t.activities.shop.balance(balance) : t.activities.shop.short(price - balance)}</p>
      </div>
    </Sheet>,
    document.body,
  )
}
