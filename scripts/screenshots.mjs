/**
 * Régénère les captures du README dans docs/screenshots/.
 *
 * Prérequis (non installé par défaut, ~115 Mo) :
 *   npm i -D playwright && npx playwright install chromium
 *
 * Puis, serveur de dev lancé à part :
 *   node scripts/screenshots.mjs http://localhost:5173/
 *
 * Le script peuple d'abord la bibliothèque avec de vrais livres via de vrais
 * gestes, sinon les vues Bibliothèque et Profil seraient vides.
 */
import { chromium } from 'playwright'

const URL = process.argv[2]
const OUT = 'docs/screenshots' // relatif à la racine du dépôt

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-card]', { timeout: 90000 })
console.log('couvertures deck :', await waitForCovers(page, 4))
await page.waitForTimeout(1200)


/** Attend que N couvertures soient réellement décodées (archive.org est lent). */
async function waitForCovers(target, count, timeout = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ready = await target.evaluate(
      () => [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
    )
    if (ready >= count) return ready
    await target.waitForTimeout(1000)
  }
  return -1
}

async function cardCenter() {
  const box = await page.locator('[data-card]').first().boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function swipeRight() {
  const { x, y } = await cardCenter()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(x + i * 40, y)
  await page.mouse.up()
  await page.waitForTimeout(720)
}

// ── Capture héro : carte tenue en plein geste, tampon « Wishlist » révélé ──
{
  const { x, y } = await cardCenter()
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(x + i * 14, y - i * 3)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/swipe.png` })
  await page.mouse.move(x, y) // annule le geste
  await page.mouse.up()
  await page.waitForTimeout(900)
}

await page.screenshot({ path: `${OUT}/discover.png` })

// ── Peupler la bibliothèque avec de vrais livres ──
for (let i = 0; i < 14; i += 1) await swipeRight()
for (let i = 0; i < 6; i += 1) {
  await page.getByRole('button', { name: "Je l'ai déjà lu" }).click()
  await page.waitForTimeout(720)
}

const stored = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('bookshelf:library:v1')).state
  const by = { wishlist: 0, read: 0, reading: 0 }
  for (const e of Object.values(s.entries)) by[e.status] += 1
  return by
})
console.log('bibliothèque :', JSON.stringify(stored))

await page.getByRole('button', { name: 'Ma biblio' }).click()
await page.waitForTimeout(2500)
await page.screenshot({ path: `${OUT}/library.png` })

await page.getByRole('button', { name: 'Recherche' }).click()
await page.waitForTimeout(800)
await page.getByRole('searchbox', { name: 'Rechercher un livre' }).fill('tolkien')
console.log('couvertures recherche :', await waitForCovers(page, 6))
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/search.png` })

await page.getByRole('button', { name: 'Profil' }).click()
await page.waitForTimeout(1000)
// Chrome headless n'émet pas `beforeinstallprompt` : on le simule pour montrer
// l'état réel que voit un utilisateur Chrome / Edge.
await page.evaluate(() => {
  const event = new Event('beforeinstallprompt')
  Object.assign(event, {
    platforms: ['web'],
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
  })
  window.dispatchEvent(event)
})
await page.waitForTimeout(1800)
await page.screenshot({ path: `${OUT}/profile.png` })

// ── Desktop : même état, rail latéral, densité de pixels 1 ──
const state = await ctx.storageState()
const deskCtx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  storageState: state,
})
const desk = await deskCtx.newPage()
await desk.goto(URL, { waitUntil: 'domcontentloaded' })
await desk.waitForTimeout(4500)
await desk.getByRole('button', { name: 'Ma biblio' }).click()
await desk.waitForTimeout(2500)
await desk.screenshot({ path: `${OUT}/desktop.png` })

console.log('erreurs JS :', errors.length ? errors : 'aucune')
await browser.close()
