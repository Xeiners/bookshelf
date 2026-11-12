// i18n-ignore-file : les noms des niveaux sont des données (enregistrées en base, comme ceux de l'atelier), pas des textes d'interface.
import type { LevelPlan, PlanSection, SectionKind } from './generator'

/*
 * Les niveaux intégrés de Gravity Ninja, écrits comme des plans et rangés par difficulté (quatre
 * paliers : facile, moyen, difficile, extrême, cf. `tierOf`). Chacun a son idée : un mécanisme mis
 * en avant (tunnels du mini-ninja, bûches de substitution, dalles fragiles, shurikens…), un thème,
 * un rythme. `npm run gravity:levels` les bâtit (générateur + preuve du solveur, d'une traite) et
 * les écrit pour le serveur.
 */

export interface CampaignLevel {
  id: string
  /** Graine du générateur : même graine, même niveau. */
  seed: number
  plan: LevelPlan
}

const s = (kind: SectionKind, intensity: number): PlanSection => ({ kind, intensity })

export const CAMPAIGN: CampaignLevel[] = [
  /* ---- Facile ---- */
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
    // La bûche, en douceur : un filet de sécurité avant chaque passage un peu plus vif.
    id: 'pont-des-lanternes',
    seed: 61,
    plan: {
      name: 'Pont des lanternes',
      theme: 'konoha',
      difficulty: 1,
      sections: [s('switch', 1), s('runway', 1), s('spikes', 1), s('islands', 1), s('kawarimi', 1), s('runway', 1), s('wall', 1), s('switch', 2), s('pad', 1), s('islands', 2), s('kawarimi', 1), s('spikes', 2), s('switch', 2), s('islands', 2)],
    },
  },
  {
    // Les premiers tunnels du mini-ninja, dans la brume.
    id: 'brume-du-matin',
    seed: 67,
    plan: {
      name: 'Brume du matin',
      theme: 'mist',
      difficulty: 2,
      sections: [s('switch', 1), s('runway', 1), s('mini', 1), s('switch', 2), s('spikes', 2), s('islands', 2), s('mini', 2), s('pad', 2), s('switch', 2), s('mini', 2), s('wall', 2), s('spikes', 2), s('islands', 2), s('mini', 3)],
    },
  },
  {
    // Des dunes en îlots, deux lunes pour planer, une bûche au milieu.
    id: 'dunes-chantantes',
    seed: 71,
    plan: {
      name: 'Dunes chantantes',
      theme: 'sand',
      difficulty: 2,
      sections: [s('switch', 2), s('islands', 2), s('moon', 2), s('spikes', 2), s('islands', 2), s('kawarimi', 2), s('pad', 2), s('islands', 3), s('moon', 2), s('wall', 2), s('switch', 2), s('islands', 3), s('spikes', 3)],
    },
  },

  /* ---- Moyen ---- */
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
    // Sous les racines : tunnel sur tunnel, des zigzags pour reprendre son souffle.
    id: 'terriers-du-renard',
    seed: 73,
    plan: {
      name: 'Terriers du renard',
      theme: 'hunter',
      difficulty: 4,
      sections: [s('switch', 3), s('mini', 3), s('zigzag', 3), s('mini', 4), s('spikes', 4), s('islands', 4), s('mini', 4), s('crumble', 3), s('mini', 4), s('wall', 4), s('zigzag', 4), s('mini', 5), s('switch', 4)],
    },
  },
  {
    // Des étals qui s'effondrent, la lune et deux bûches pour les mauvais pas.
    id: 'marche-aux-citrouilles',
    seed: 79,
    plan: {
      name: 'Marché aux citrouilles',
      theme: 'halloween',
      difficulty: 4,
      sections: [s('spikes', 3), s('crumble', 3), s('islands', 4), s('moon', 3), s('kawarimi', 4), s('crumble', 4), s('shuriken', 3), s('pad', 4), s('zigzag', 4), s('moon', 4), s('kawarimi', 4), s('crumble', 4), s('islands', 4), s('spikes', 4)],
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
    // Le vent emporte tout : plateformes mobiles, shurikens, tunnels sous le sable.
    id: 'tempete-de-sable',
    seed: 83,
    plan: {
      name: 'Tempête de sable',
      theme: 'sand',
      difficulty: 5,
      sections: [s('switch', 4), s('shuriken', 4), s('mover', 4), s('mini', 5), s('spikes', 5), s('mover', 5), s('kawarimi', 5), s('islands', 5), s('shuriken', 5), s('mini', 5), s('zigzag', 5), s('mover', 5), s('spikes', 6)],
    },
  },

  /* ---- Difficile ---- */
  {
    // Un dédale : zigzags serrés et tunnels, sans répit.
    id: 'dedale-des-bambous',
    seed: 89,
    plan: {
      name: 'Le dédale des bambous',
      theme: 'night',
      difficulty: 6,
      sections: [s('zigzag', 5), s('mini', 6), s('spikes', 6), s('zigzag', 6), s('islands', 6), s('mini', 6), s('pad', 6), s('zigzag', 6), s('mini', 7), s('shuriken', 6), s('islands', 6), s('zigzag', 7), s('mini', 7)],
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
    // Une forteresse : murs et shurikens en rangs serrés ; les bûches y sont précieuses.
    id: 'forteresse-de-brume',
    seed: 97,
    plan: {
      name: 'Forteresse de brume',
      theme: 'mist',
      difficulty: 7,
      sections: [s('wall', 6), s('shuriken', 6), s('kawarimi', 6), s('wall', 7), s('spikes', 7), s('shuriken', 7), s('mover', 6), s('wall', 7), s('kawarimi', 7), s('shuriken', 7), s('zigzag', 7), s('pad', 7), s('islands', 7), s('wall', 8), s('spikes', 8), s('shuriken', 8)],
    },
  },
  {
    // La neige cède sous les pas : dalles fragiles, plateformes mobiles, tunnels de glace.
    id: 'col-des-avalanches',
    seed: 101,
    plan: {
      name: 'Col des avalanches',
      theme: 'christmas',
      difficulty: 8,
      sections: [s('crumble', 7), s('islands', 7), s('mini', 7), s('crumble', 8), s('mover', 7), s('crumble', 8), s('moon', 7), s('mini', 8), s('zigzag', 8), s('crumble', 8), s('mover', 8), s('kawarimi', 8), s('islands', 8), s('crumble', 9)],
    },
  },

  /* ---- Extrême ---- */
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
  {
    // Une pluie de lames : shurikens partout, deux bûches, un seul tunnel.
    id: 'danse-des-lames',
    seed: 103,
    plan: {
      name: 'Danse des lames',
      theme: 'konoha',
      difficulty: 9,
      sections: [s('shuriken', 8), s('zigzag', 9), s('kawarimi', 9), s('shuriken', 9), s('spikes', 9), s('shuriken', 9), s('mini', 9), s('zigzag', 9), s('shuriken', 10), s('kawarimi', 9), s('zigzag', 10), s('shuriken', 10), s('spikes', 10)],
    },
  },
  {
    // Sous la terre, presque tout se fait minuscule.
    id: 'terrier-sans-fin',
    seed: 107,
    plan: {
      name: 'Le terrier sans fin',
      theme: 'halloween',
      difficulty: 10,
      sections: [s('mini', 9), s('zigzag', 9), s('mini', 10), s('crumble', 9), s('mini', 10), s('spikes', 10), s('mini', 10), s('islands', 9), s('mini', 10), s('kawarimi', 10), s('mini', 10), s('zigzag', 10), s('mini', 10)],
    },
  },
  {
    // L'épreuve finale : tous les mécanismes, au plus dur.
    id: 'eclipse',
    seed: 109,
    plan: {
      name: 'Éclipse',
      theme: 'night',
      difficulty: 10,
      sections: [s('zigzag', 9), s('shuriken', 9), s('mini', 9), s('mover', 9), s('crumble', 10), s('kawarimi', 10), s('islands', 10), s('moon', 9), s('mini', 10), s('wall', 10), s('shuriken', 10), s('mover', 10), s('zigzag', 10), s('crumble', 10), s('mini', 10), s('spikes', 10)],
    },
  },
]
