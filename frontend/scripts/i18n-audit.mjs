/**
 * Audit i18n : liste tout texte d'interface écrit en dur hors des dictionnaires.
 *
 *   npm run i18n:audit -w frontend      (code de sortie 1 s'il reste des textes)
 *
 * Analyse l'AST (Babel) de chaque fichier de `src/` et signale :
 *  - les nœuds texte JSX (`<p>Bonjour</p>`) ;
 *  - les attributs lus par l'utilisateur ou un lecteur d'écran
 *    (`aria-label`, `title`, `placeholder`, `alt`) en littéral ;
 *  - les chaînes et gabarits qui ressemblent à une phrase (espace + mot, ou
 *    lettre accentuée), hors contextes techniques (classes CSS, sélecteurs,
 *    journaux de debug…).
 *
 * Faux positif assumé ? Ajouter `// i18n-ignore` en fin de ligne (ou sur la
 * ligne précédente) avec une justification. Un fichier de données déjà
 * bilingue peut commencer par `// i18n-ignore-file`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default ?? traverseModule
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** Dossiers et fichiers dont le texte EST la traduction, ou des données. */
const SKIP = [/[\\/]i18n[\\/]/, /[\\/]generated[\\/]/, /\.d\.ts$/]

const USER_FACING_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'aria-description'])
const TECHNICAL_ATTRIBUTES = new Set(['className', 'class', 'style', 'd', 'viewBox', 'href', 'src', 'role', 'type', 'autoComplete', 'inputMode', 'key', 'id', 'htmlFor', 'rel', 'target'])
/** Appels dont les arguments sont techniques : debug, sélecteurs DOM, GSAP… */
const TECHNICAL_CALLEES = /^(console\.\w+|document\.\w+|\w*\.querySelector(All)?|\w*\.closest|gsap\.\w+|\w*\.(setAttribute|hasAttribute|removeAttribute|getProperty)|new (Error|TypeError|RangeError|URL|URLSearchParams|IntersectionObserver)|localStorage\.\w+|sessionStorage\.\w+|require|import)$/

const LETTER = /\p{L}/u
const ACCENT = /[À-ÖØ-öø-ÿŒœ’«»…]/u
/** Une phrase : au moins deux mots dont un de 2+ lettres, ou un caractère typographique français. */
const looksLikeProse = (text) => {
  const value = text.trim()
  if (!LETTER.test(value)) return false
  if (ACCENT.test(value)) return true
  return /\p{L}{2,}/u.test(value) && /\s/.test(value) && /\p{L}{2,}\s+\p{L}{2,}/u.test(value)
}
/** Chaîne manifestement technique : CSS, easing, sélecteur, URL, format de date… */
const looksTechnical = (text) =>
  /^(\s*[\w-]+\s*:\s*[^;]+;?)+$/.test(text) || // déclarations CSS
  /(^|\s)(px|rem|em|vh|vw|deg|%)(\s|$)|\d(px|rem|em|vh|vw|deg|%)/.test(text) ||
  /^(linear|radial)-gradient|^(rgb|hsl)a?\(|^inset\(|^var\(|^url\(/.test(text.trim()) ||
  /^[.#[][\w-]+(\[[^\]]+\])?(\s*[>,+~]?\s*[.#[]?[\w-]+(\[[^\]]+\])?)*$/.test(text.trim()) || // sélecteurs
  /^[a-z]+(,\s*[a-z]+)+$/.test(text.trim()) || // listes de balises : 'input, textarea'
  /^(https?:|\/|\.\/|\.\.\/)/.test(text.trim()) ||
  /^[\w.-]+\.(tsx?|jsx?|css|json|png|svg|webmanifest)$/.test(text.trim())

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

function isIgnored(lines, line) {
  return /i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '')
}

/** `console.warn`, `gsap.to`, `el.querySelector`… (le hub Babel n'a pas le source). */
function calleeName(node) {
  if (!node) return ''
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const object = node.object.type === 'Identifier' ? node.object.name : node.object.type === 'ThisExpression' ? 'this' : ''
    const property = node.property.type === 'Identifier' ? node.property.name : ''
    return object ? `${object}.${property}` : `.${property}`
  }
  return ''
}

/** Remonte l'arbre : le littéral est-il dans un contexte technique ? */
function inTechnicalContext(path) {
  for (let current = path.parentPath; current; current = current.parentPath) {
    const node = current.node
    if (current.isJSXAttribute()) {
      const name = typeof node.name.name === 'string' ? node.name.name : ''
      if (TECHNICAL_ATTRIBUTES.has(name) || name.startsWith('data-')) return true
      return false
    }
    if (current.isCallExpression() || current.isNewExpression()) {
      const callee = calleeName(node.callee)
      const label = current.isNewExpression() ? `new ${callee}` : callee
      if (TECHNICAL_CALLEES.test(label)) return true
    }
    // Chemin de module (`from '…'`) ; le reste d'un `export const` est du code normal.
    if ((current.isImportDeclaration() || current.isExportDeclaration()) && node.source === path.node) return true
    if (current.isImportDeclaration()) return true
    if (current.isTSType?.() || current.isTSLiteralType?.()) return true
    if (current.isObjectProperty()) {
      const key = node.key.name ?? node.key.value
      if (['className', 'ease', 'transformOrigin', 'clipPath', 'background', 'stagger'].includes(key)) return true
    }
    // Une clé de propriété n'est jamais affichée.
    if (current.isObjectProperty() && current.node.key === path.node) return true
    if (current.isFunction() || current.isProgram()) break
  }
  return false
}

const findings = []

for (const file of listFiles(ROOT)) {
  if (SKIP.some((pattern) => pattern.test(file))) continue
  const code = readFileSync(file, 'utf8')
  const lines = code.split(/\r?\n/)
  // Fichier de données déjà traduit (champs par langue) : `// i18n-ignore-file` en tête.
  if (/^\/\/ i18n-ignore-file/.test(lines[0] ?? '')) continue
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })

  const report = (node, kind, text) => {
    const line = node.loc?.start.line ?? 0
    if (isIgnored(lines, line)) return
    findings.push({ file: relative(join(ROOT, '..'), file), line, kind, text: text.trim().replace(/\s+/g, ' ').slice(0, 90) })
  }

  traverse(ast, {
    JSXText(path) {
      const text = path.node.value
      if (/\p{L}{2,}/u.test(text)) report(path.node, 'jsx-text', text)
    },
    JSXAttribute(path) {
      const name = typeof path.node.name.name === 'string' ? path.node.name.name : ''
      const value = path.node.value
      if (USER_FACING_ATTRIBUTES.has(name) && value?.type === 'StringLiteral' && LETTER.test(value.value)) {
        report(value, `attr:${name}`, value.value)
      }
    },
    StringLiteral(path) {
      if (path.parentPath.isJSXAttribute()) return // traité ci-dessus
      const text = path.node.value
      if (looksTechnical(text) || inTechnicalContext(path)) return
      if (looksLikeProse(text)) {
        report(path.node, 'string', text)
        return
      }
      // Libellé d'un seul mot dans un objet (`read: 'Lus'`, `label: 'Manga'`) :
      // une majuscule suivie de minuscules trahit un texte affiché.
      const isValue = path.parentPath.isObjectProperty() && path.parentPath.node.value === path.node
      if (isValue && /^\p{Lu}\p{Ll}{2,}/u.test(text)) report(path.node, 'label', text)
    },
    TemplateLiteral(path) {
      const parts = path.node.quasis.map((quasi) => quasi.value.cooked ?? '')
      // Les parties interpolées valent un mot neutre : elles ne font pas une phrase à elles seules.
      const text = parts.join('x')
      // Sélecteur d'attribut construit : `[data-card="${id}"]`.
      if (/^\[[\w-]+(=")?/.test(parts[0] ?? '')) return
      if (!looksLikeProse(text) || looksTechnical(text) || inTechnicalContext(path)) return
      report(path.node, 'template', text)
    },
  })
}

if (findings.length === 0) {
  console.log('i18n : aucun texte d’interface en dur. ✔')
  process.exit(0)
}

for (const { file, line, kind, text } of findings) console.log(`${file}:${line}  [${kind}]  ${text}`)
console.log(`\n${findings.length} texte(s) en dur à passer par le dictionnaire (ou à marquer // i18n-ignore).`)
process.exit(1)
