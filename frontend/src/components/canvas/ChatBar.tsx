import { useState } from 'react'
import { MessageCircle, Send, Smile } from 'lucide-react'
import { useT } from '../../i18n'
import { getEngine } from '../../lib/canvas/current'
import { useCanvasStore } from '../../store/useCanvasStore'

/** Bulle de texte à côté de son curseur, et réactions : les artistes proches les voient. */
export function ChatBar() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const limits = useCanvasStore((state) => state.limits)
  const reactions = limits?.reactions ?? []
  const canTalk = useCanvasStore((state) => state.me?.draw ?? false)

  const send = () => {
    const value = text.trim()
    if (!value) return
    getEngine()?.sendChat(value)
    setText('')
  }

  return (
    <div className="pointer-events-auto flex items-end gap-1.5">
      {open && (
        <div className="glass flex max-w-[calc(100vw-5.5rem)] flex-col gap-1.5 rounded-2xl p-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
          <div className="flex gap-1">
            {reactions.map((emoji) => (
              <button key={emoji} type="button" aria-label={`${t.canvas.chat.react} ${emoji}`} onClick={() => getEngine()?.react(emoji)} className="grid size-9 place-items-center rounded-xl text-xl transition-transform hover:bg-white/10 active:scale-125">
                {emoji}
              </button>
            ))}
          </div>
          {canTalk && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                send()
              }}
              className="flex items-center gap-1.5"
            >
              <input
                value={text}
                maxLength={80}
                onChange={(event) => setText(event.target.value)}
                placeholder={t.canvas.chat.placeholder}
                aria-label={t.canvas.chat.placeholder}
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-cream outline-none focus:border-glow"
              />
              <button type="submit" aria-label={t.canvas.chat.send} disabled={!text.trim()} className="grid size-8 shrink-0 place-items-center rounded-xl bg-glow text-white disabled:opacity-40">
                <Send size={14} aria-hidden />
              </button>
            </form>
          )}
        </div>
      )}
      <button type="button" title={t.canvas.chat.open} aria-label={t.canvas.chat.open} aria-pressed={open} onClick={() => setOpen((state) => !state)} className={`glass grid size-10 place-items-center rounded-full shadow-[0_6px_20px_rgba(0,0,0,0.45)] active:scale-95 ${open ? 'bg-glow text-white' : 'text-cream/80'}`}>
        {open ? <Smile size={18} aria-hidden /> : <MessageCircle size={18} aria-hidden />}
      </button>
    </div>
  )
}
