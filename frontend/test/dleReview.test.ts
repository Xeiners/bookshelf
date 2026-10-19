/** Revue des images d'énigme : l'issue d'un geste sur la carte (valider à droite, bannir à gauche). */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stampOpacity, verdictOf } from '../src/lib/dleReview'

describe('revue des images — geste', () => {
  it('glisser loin à droite valide, loin à gauche bannit', () => {
    assert.equal(verdictOf(180, 0, 360), 'approve')
    assert.equal(verdictOf(-180, 0, 360), 'ban')
  })

  it('un geste court revient au centre', () => {
    assert.equal(verdictOf(60, 0.1, 360), null)
    assert.equal(verdictOf(-60, -0.1, 360), null)
    assert.equal(verdictOf(0, 0, 360), null)
  })

  it('un coup de doigt rapide vaut décision, pourvu qu’il ait quitté le centre', () => {
    assert.equal(verdictOf(70, 0.9, 360), 'approve')
    assert.equal(verdictOf(-70, -0.9, 360), 'ban')
    assert.equal(verdictOf(10, 2, 360), null, 'trop près du centre')
    assert.equal(verdictOf(70, -0.9, 360), null, 'vitesse en sens contraire')
  })

  it('le seuil s’adapte à la largeur de la carte, sans dépasser 140 px', () => {
    assert.equal(verdictOf(150, 0, 800), 'approve', 'plafonné à 140')
    assert.equal(verdictOf(120, 0, 800), null)
    assert.equal(verdictOf(65, 0, 200), 'approve', 'carte étroite : 60 px au moins')
  })

  it('le tampon s’affiche du côté de la décision, de plus en plus net', () => {
    assert.equal(stampOpacity(0, 'approve'), 0)
    assert.ok(stampOpacity(60, 'approve') > 0 && stampOpacity(60, 'approve') < 1)
    assert.equal(stampOpacity(200, 'approve'), 1)
    assert.equal(stampOpacity(-200, 'ban'), 1)
    assert.equal(stampOpacity(-200, 'approve'), 0, 'pas le tampon opposé')
  })
})
