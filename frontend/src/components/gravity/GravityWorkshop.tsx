import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, ClipboardCopy, Dices, Eye, FileJson, Loader2, Play, Save, Sparkles, TriangleAlert, Wand2, X } from 'lucide-react'
import { useT } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrors'
import { START_X } from '../../lib/gravity/constants'
import { buildWorld, progressOf } from '../../lib/gravity/engine'
import { buildLevel, generateLevel, slugOf, type LengthPreset } from '../../lib/gravity/generator'
import { solveLevel, type SolveReport } from '../../lib/gravity/solver'
import { THEMES } from '../../lib/gravity/themes'
import { THEME_IDS, type GravityLevel, type ThemeId } from '../../lib/gravity/types'
import { parseLevel, parsePlan } from '../../lib/gravity/validate'
import { gravityApi, type AiProvider } from '../../services/gravityApi'
import { useUiStore } from '../../store/useUiStore'
import { LevelPreview } from './LevelPreview'

type Tab = 'generate' | 'ai' | 'import'

interface Candidate {
  level: GravityLevel
  report: SolveReport
  /** Sections posées et adoucies (générateur, plan d'IA). */
  sections?: { count: number; softened: number }
}

interface GravityWorkshopProps {
  /** IA branchées sur le serveur (Gemini, Claude) ; vide : la génération par IA est indisponible. */
  ai: AiProvider[]
  onClose: () => void
  /** Essayer un niveau (rien n'est enregistré) ; avec `solution`, le regarder joué par le solveur. */
  onTry: (level: GravityLevel, solution?: SolveReport) => void
  /** Un niveau a été enregistré. */
  onSaved: () => void
}

const LENGTHS: LengthPreset[] = ['short', 'medium', 'long']
const randomSeed = () => Math.floor(Math.random() * 1_000_000)

/**
 * L'atelier des niveaux (admins) : générer un niveau selon une difficulté, en demander le plan à
 * une IA, ou en importer un (JSON complet, ou plan). Chaque niveau est prouvé faisable par le
 * solveur avant de pouvoir être enregistré ; on peut l'essayer d'abord.
 */
export function GravityWorkshop({ ai, onClose, onTry, onSaved }: GravityWorkshopProps) {
  const t = useT()
  const w = t.gravity.workshop
  const notify = useUiStore((state) => state.notify)
  const [tab, setTab] = useState<Tab>('generate')
  const [difficulty, setDifficulty] = useState(5)
  const [length, setLength] = useState<LengthPreset>('medium')
  const [theme, setTheme] = useState<ThemeId>('konoha')
  const [aiTheme, setAiTheme] = useState<ThemeId | null>(null)
  const [seed, setSeed] = useState(randomSeed)
  const [prompt, setPrompt] = useState('')
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [chosenProvider, setProvider] = useState<AiProvider | null>(null)
  const provider = chosenProvider && ai.includes(chosenProvider) ? chosenProvider : (ai[0] ?? null)

  /** Laisse l'interface afficher l'attente avant un calcul lourd (génération, preuve). */
  const compute = (work: () => Candidate) => {
    setBusy(true)
    setError(null)
    window.setTimeout(() => {
      try {
        const next = work()
        setCandidate(next)
        setName(next.level.name)
      } catch {
        setError(w.failed)
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  const generate = () =>
    compute(() => {
      const result = generateLevel({ difficulty, theme, seed, length, name: w.defaultName(t.gravity.themes[theme], difficulty) })
      return { level: result.level, report: result.report, sections: { count: result.sections, softened: result.softened } }
    })

  const askAi = async () => {
    setBusy(true)
    setError(null)
    try {
      const { plan } = await gravityApi.plan({ prompt, difficulty, theme: aiTheme ?? undefined, length, provider: provider ?? undefined })
      setBusy(false)
      compute(() => {
        const result = buildLevel(plan, seed)
        return { level: result.level, report: result.report, sections: { count: result.sections, softened: result.softened } }
      })
    } catch (reason) {
      setBusy(false)
      setError(apiErrorMessage(reason, t))
    }
  }

  const copyPrompt = async () => {
    try {
      const { prompt: text } = await gravityApi.prompt({ prompt, difficulty, theme: aiTheme ?? undefined, length })
      await navigator.clipboard.writeText(text)
      notify(w.promptCopied, 'like')
    } catch (reason) {
      notify(apiErrorMessage(reason, t), 'nope')
    }
  }

  const importJson = () => {
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      setError(w.badJson)
      return
    }
    const plan = parsePlan(data)
    if (plan) {
      compute(() => {
        const result = buildLevel(plan, seed)
        return { level: result.level, report: result.report, sections: { count: result.sections, softened: result.softened } }
      })
      return
    }
    const parsed = parseLevel(data)
    if (!parsed.ok) {
      setError(w.invalid(parsed.issues.slice(0, 4).join(', ')))
      return
    }
    compute(() => ({ level: parsed.level, report: solveLevel(buildWorld(parsed.level)) }))
  }

  const save = async () => {
    if (!candidate || saving) return
    const title = name.trim().slice(0, 40) || candidate.level.name
    const level: GravityLevel = { ...candidate.level, name: title, id: `${slugOf(title)}-${Math.random().toString(36).slice(2, 6)}` }
    setSaving(true)
    try {
      await gravityApi.save(level)
      notify(w.saved(title), 'like')
      onSaved()
      setCandidate(null)
    } catch (reason) {
      notify(apiErrorMessage(reason, t), 'nope')
    } finally {
      setSaving(false)
    }
  }

  const copyJson = async () => {
    if (!candidate) return
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...candidate.level, name: name.trim() || candidate.level.name }))
      notify(w.jsonCopied, 'like')
    } catch {
      notify(w.copyFailed, 'nope')
    }
  }

  const world = candidate ? buildWorld(candidate.level) : null
  const seconds = candidate ? Math.round((candidate.level.length - START_X) / candidate.level.speed) : 0

  return createPortal(
    <div className="fixed inset-0 z-[92] flex flex-col bg-[#0d0818]/97 text-cream" role="dialog" aria-modal="true" aria-label={w.title}>
      <header className="flex items-center gap-3 px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-3">
        <Wand2 size={18} className="text-[#ff8a6b]" aria-hidden />
        <h2 className="flex-1 font-display text-xl">{w.title}</h2>
        <button type="button" onClick={onClose} aria-label={t.gravity.close} className="grid size-10 place-items-center rounded-full bg-white/[0.06]">
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] [&>*]:shrink-0">
        <div className="grid grid-cols-3 gap-1 rounded-full bg-white/[0.05] p-1" role="tablist" aria-label={w.title}>
          {(['generate', 'ai', 'import'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key)
                setError(null)
              }}
              className={`h-9 rounded-full text-xs font-semibold transition-colors ${tab === key ? 'bg-cream text-void' : 'text-cream/70'}`}
            >
              {w.tabs[key]}
            </button>
          ))}
        </div>

        {/* Réglages communs : difficulté, longueur, graine. */}
        {tab !== 'import' && (
          <section className="flex flex-col gap-3 rounded-[1.25rem] border border-white/8 bg-white/[0.03] p-4">
            <label className="flex flex-col gap-1.5 text-xs text-cream/70">
              <span className="flex justify-between">
                {w.difficulty}
                <span className="font-bold text-cream tabular-nums">{difficulty}/10</span>
              </span>
              <input type="range" min={1} max={10} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} className="accent-[#ff8a6b]" />
            </label>
            <div className="flex flex-col gap-1.5 text-xs text-cream/70">
              {w.length}
              <div className="grid grid-cols-3 gap-1.5">
                {LENGTHS.map((key) => (
                  <button key={key} type="button" onClick={() => setLength(key)} className={`h-9 rounded-xl text-xs font-semibold ${length === key ? 'bg-[#ff8a6b] text-void' : 'bg-white/[0.06] text-cream/80'}`}>
                    {w.lengths[key]}
                  </button>
                ))}
              </div>
            </div>
            <ThemePicker
              label={tab === 'ai' ? w.themeAi : w.theme}
              value={tab === 'ai' ? aiTheme : theme}
              allowAny={tab === 'ai'}
              anyLabel={w.themeAny}
              onChange={(next) => (tab === 'ai' ? setAiTheme(next) : next && setTheme(next))}
            />
            <div className="flex items-center gap-2 text-xs text-cream/70">
              <span className="flex-1">{w.seed}</span>
              <input
                type="number"
                value={seed}
                onChange={(event) => setSeed(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                aria-label={w.seed}
                className="h-9 w-28 rounded-xl border border-white/10 bg-black/30 px-3 text-right text-sm text-cream tabular-nums"
              />
              <button type="button" onClick={() => setSeed(randomSeed())} aria-label={w.reroll} className="grid size-9 place-items-center rounded-xl bg-white/[0.06]">
                <Dices size={16} aria-hidden />
              </button>
            </div>
          </section>
        )}

        {tab === 'generate' && (
          <button type="button" onClick={generate} disabled={busy} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff8a6b] text-sm font-bold text-void disabled:opacity-60">
            {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Wand2 size={17} aria-hidden />}
            {w.generate}
          </button>
        )}

        {tab === 'ai' && (
          <section className="flex flex-col gap-3">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value.slice(0, 1000))}
              rows={3}
              placeholder={w.promptPlaceholder}
              aria-label={w.prompt}
              className="resize-none rounded-2xl border border-white/10 bg-black/30 px-3.5 py-3 text-sm text-cream outline-none placeholder:text-cream/35 focus:border-[#ff8a6b]/60"
            />
            {ai.length === 0 && <p className="rounded-xl bg-white/[0.05] px-3 py-2 text-xs leading-relaxed text-cream/65">{w.aiOff}</p>}
            {ai.length > 1 && (
              <div className="flex items-center gap-2 text-xs text-cream/70" role="radiogroup" aria-label={w.provider}>
                <span className="flex-1">{w.provider}</span>
                {ai.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={provider === key}
                    onClick={() => setProvider(key)}
                    className={`h-8 rounded-full px-3.5 text-xs font-semibold ${provider === key ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80'}`}
                  >
                    {w.providers[key]}
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => void askAi()} disabled={busy || !provider} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff8a6b] text-sm font-bold text-void disabled:opacity-50">
              {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
              {provider ? w.askProvider(w.providers[provider]) : w.askAi}
            </button>
            <button type="button" onClick={() => void copyPrompt()} className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/12 text-xs font-semibold text-cream/80">
              <ClipboardCopy size={15} aria-hidden />
              {w.copyPrompt}
            </button>
          </section>
        )}

        {tab === 'import' && (
          <section className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-cream/60">{w.importHint}</p>
            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              rows={7}
              placeholder={w.jsonPlaceholder}
              aria-label={w.json}
              spellCheck={false}
              className="resize-none rounded-2xl border border-white/10 bg-black/30 px-3.5 py-3 font-mono text-xs text-cream outline-none placeholder:text-cream/35 focus:border-[#ff8a6b]/60"
            />
            <button type="button" onClick={importJson} disabled={busy || !json.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff8a6b] text-sm font-bold text-void disabled:opacity-50">
              {busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <FileJson size={17} aria-hidden />}
              {w.import}
            </button>
          </section>
        )}

        {error && <p className="rounded-xl bg-nope/15 px-3 py-2 text-xs text-nope">{error}</p>}

        {candidate && world && (
          <section className="flex flex-col gap-3 rounded-[1.25rem] border border-[#ff8a6b]/25 bg-white/[0.03] p-4">
            <LevelPreview level={candidate.level} report={candidate.report} className="block h-20 w-full rounded-xl" />
            <p className={`flex items-center gap-2 text-sm font-semibold ${candidate.report.ok ? 'text-like' : 'text-nope'}`}>
              {candidate.report.ok ? <CheckCircle2 size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
              {candidate.report.ok ? w.solvable : w.blocked(progressOf(world, candidate.report.reached))}
            </p>
            <ul className="grid grid-cols-2 gap-1.5 text-xs text-cream/70">
              <li className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">{w.stats.duration(seconds)}</li>
              <li className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">{w.stats.difficulty(candidate.level.difficulty)}</li>
              <li className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">{w.stats.checkpoints(world.checkpoints.length)}</li>
              <li className="rounded-lg bg-white/[0.04] px-2.5 py-1.5">{t.gravity.themes[candidate.level.theme]}</li>
              {candidate.sections && <li className="col-span-2 rounded-lg bg-white/[0.04] px-2.5 py-1.5">{w.stats.sections(candidate.sections.count, candidate.sections.softened)}</li>}
            </ul>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 40))}
              aria-label={w.name}
              placeholder={w.name}
              className="h-11 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-cream outline-none focus:border-[#ff8a6b]/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onTry({ ...candidate.level, name: name.trim() || candidate.level.name })} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/15 text-sm font-semibold text-cream">
                <Play size={15} aria-hidden />
                {w.try}
              </button>
              <button type="button" onClick={() => void save()} disabled={saving || !candidate.report.ok} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cream text-sm font-bold text-void disabled:opacity-50">
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
                {w.save}
              </button>
            </div>
            {candidate.report.ok && (
              <button type="button" onClick={() => onTry({ ...candidate.level, name: name.trim() || candidate.level.name }, candidate.report)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/10 text-xs font-semibold text-cream/80">
                <Eye size={15} aria-hidden />
                {w.watch}
              </button>
            )}
            <button type="button" onClick={() => void copyJson()} className="inline-flex h-9 items-center justify-center gap-2 rounded-full text-xs font-semibold text-cream/65">
              <ClipboardCopy size={14} aria-hidden />
              {w.copyJson}
            </button>
          </section>
        )}
      </div>
    </div>,
    document.body,
  )
}

function ThemePicker({ label, value, allowAny, anyLabel, onChange }: { label: string; value: ThemeId | null; allowAny: boolean; anyLabel: string; onChange: (next: ThemeId | null) => void }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-1.5 text-xs text-cream/70">
      {label}
      <div className="flex flex-wrap gap-1.5">
        {allowAny && (
          <button type="button" onClick={() => onChange(null)} className={`h-8 rounded-full px-3 text-xs font-semibold ${value === null ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80'}`}>
            {anyLabel}
          </button>
        )}
        {THEME_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${value === id ? 'bg-cream text-void' : 'bg-white/[0.06] text-cream/80'}`}
          >
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: `linear-gradient(135deg, ${THEMES[id].sky[1]}, ${THEMES[id].sky[2]})` }} />
            {t.gravity.themes[id]}
          </button>
        ))}
      </div>
    </div>
  )
}
