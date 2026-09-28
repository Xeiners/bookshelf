/**
 * Rendu du lecteur de romans, côté serveur (`react-dom/server`) : pas de DOM
 * dans ces tests, on vérifie le balisage produit par les composants purs.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReadingProgressBar } from '../src/components/reader/ReadingProgressBar'

const render = (ratio: number) => renderToStaticMarkup(createElement(ReadingProgressBar, { ratio, color: '#c4b5fd', label: 'Progression : 42 %' }))

describe('barre de progression du lecteur', () => {
  it('barre accessible : rôle, libellé et valeur en %', () => {
    const html = render(0.424)
    assert.match(html, /role="progressbar"/)
    assert.match(html, /aria-label="Progression : 42 %"/)
    assert.match(html, /aria-valuenow="42"/)
    assert.match(html, /aria-valuemin="0"/)
    assert.match(html, /aria-valuemax="100"/)
  })

  it('remplissage par `scaleX` (pas de relayout à chaque page), dans la couleur du thème', () => {
    const html = render(0.25)
    assert.match(html, /transform:scaleX\(0\.25\)/)
    assert.match(html, /background:#c4b5fd/)
  })

  it('valeur hors bornes ramenée entre 0 et 100 %', () => {
    assert.match(render(1.7), /aria-valuenow="100"/)
    assert.match(render(-1), /aria-valuenow="0"/)
    assert.match(render(-1), /scaleX\(0\)/)
  })
})
