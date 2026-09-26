import { useEffect, useRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { useT } from '../../i18n'
import { SidePanel } from './SidePanel'

export interface DrawerItem {
  id: string
  label: string
  detail?: string | null
  state?: 'current' | 'read' | null
  /** Niveau d'imbrication (sommaire d'un EPUB). */
  depth?: number
}

interface ChapterDrawerProps {
  open: boolean
  title: string
  items: DrawerItem[]
  onSelect: (id: string) => void
  onClose: () => void
  header?: ReactNode
  footer?: ReactNode
}

/**
 * Sommaire / liste des chapitres, accessible à tout moment. Une série peut
 * dépasser le millier de chapitres : chaque ligne hors écran est sautée par le
 * navigateur (`content-visibility`), et la liste s'ouvre sur le chapitre en cours.
 */
export function ChapterDrawer({ open, title, items, onSelect, onClose, header, footer }: ChapterDrawerProps) {
  const t = useT()
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  return (
    <SidePanel open={open} title={title} onClose={onClose} header={header} footer={footer}>
      <ul ref={listRef} className="space-y-0.5">
        {items.map((item) => {
          const current = item.state === 'current'
          return (
            <li key={item.id} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(item.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                  current ? 'bg-gold/15 text-gold' : 'text-cream/85 hover:bg-white/[0.06]'
                }`}
                style={item.depth ? { paddingLeft: `${0.75 + item.depth * 0.9}rem` } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${item.state === 'read' ? 'text-cream/45' : ''}`}>{item.label}</span>
                  {item.detail && <span className="block truncate text-[11px] text-mist">{item.detail}</span>}
                </span>
                {current && <span className="shrink-0 text-[10px] tracking-wide uppercase">{t.reader.current}</span>}
                {item.state === 'read' && <Check size={14} aria-label={t.reader.readMark} className="shrink-0 text-like/70" />}
              </button>
            </li>
          )
        })}
      </ul>
    </SidePanel>
  )
}
