// i18n-ignore-file : les noms des niveaux sont des données (enregistrées en base, comme ceux de l'atelier), pas des textes d'interface.
import type { LevelPlan, PlanSection, SectionKind } from './generator'

/*
 * Les niveaux intégrés de Gravity Ninja, écrits comme des plans : chacun introduit un mécanisme
 * de plus (pics, murs, îlots, lune, sceaux, puis dalles fragiles, shurikens, plateformes mobiles),
 * et la difficulté monte de niveau en niveau. `npm run gravity:levels` les bâtit (générateur +
 * preuve du solveur) et les écrit pour le serveur.
 */

export interface CampaignLevel {
  id: string
  /** Graine du générateur : même graine, même niveau. */
  seed: number
  plan: LevelPlan
}

const s = (kind: SectionKind, intensity: number): PlanSection => ({ kind, intensity })

export const CAMPAIGN: CampaignLevel[] = [
  {
    id: 'premiers-pas',
    seed: 11,
    plan: {
      name: 'Premiers pas',
      theme: 'konoha',
      difficulty: 1,
      sections: [s('switch', 1), s('runway', 1), s('switch', 1), s('spikes', 1), s('switch', 1), s('runway', 1), s('wall', 1), s('switch', 2), s('spikes', 2), s('runway', 1), s('islands', 1), s('switch', 2), s('spikes', 2), s('runway', 1), s('wall', 2), s('switch', 2)],
    },
  },
  {
    id: 'foret-des-chasseurs',
    seed: 23,
    plan: {
      name: 'Forêt des chasseurs',
      theme: 'hunter',
      difficulty: 3,
      sections: [s('switch', 2), s('spikes', 2), s('islands', 2), s('runway', 2), s('wall', 3), s('pad', 2), s('switch', 3), s('moon', 2), s('runway', 2), s('zigzag', 2), s('spikes', 3), s('islands', 3), s('wall', 3), s('runway', 2), s('switch', 3), s('pad', 3), s('spikes', 3), s('zigzag', 3)],
    },
  },
  {
    id: 'nuit-des-lucioles',
    seed: 37,
    plan: {
      name: 'Nuit des lucioles',
      theme: 'night',
      difficulty: 5,
      sections: [s('switch', 4), s('zigzag', 4), s('spikes', 5), s('crumble', 3), s('runway', 4), s('islands', 5), s('shuriken', 4), s('wall', 5), s('moon', 4), s('runway', 4), s('zigzag', 5), s('crumble', 5), s('pad', 5), s('spikes', 5), s('islands', 5), s('shuriken', 5), s('runway', 4), s('zigzag', 6), s('switch', 6)],
    },
  },
  {
    id: 'lune-de-sang',
    seed: 41,
    plan: {
      name: 'Lune de sang',
      theme: 'halloween',
      difficulty: 7,
      sections: [s('spikes', 6), s('zigzag', 6), s('shuriken', 6), s('crumble', 6), s('mover', 5), s('runway', 6), s('islands', 7), s('wall', 7), s('zigzag', 7), s('moon', 6), s('crumble', 7), s('shuriken', 7), s('runway', 6), s('mover', 7), s('pad', 7), s('zigzag', 7), s('spikes', 8), s('islands', 7), s('shuriken', 8)],
    },
  },
  {
    id: 'tempete-de-neige',
    seed: 53,
    plan: {
      name: 'Tempête de neige',
      theme: 'christmas',
      difficulty: 9,
      sections: [s('zigzag', 8), s('crumble', 8), s('shuriken', 8), s('mover', 8), s('spikes', 9), s('islands', 9), s('runway', 8), s('zigzag', 9), s('moon', 8), s('crumble', 9), s('shuriken', 9), s('wall', 9), s('mover', 9), s('runway', 8), s('zigzag', 9), s('islands', 9), s('crumble', 10), s('shuriken', 10), s('zigzag', 10), s('spikes', 10)],
    },
  },
]
