// i18n-ignore-file : les noms des niveaux sont des données (enregistrées en base, comme ceux de l'atelier), pas des textes d'interface.
import type { LevelPlan, PlanSection, SectionKind } from './generator'

/*
 * Les niveaux intégrés de Gravity Ninja, écrits comme des plans et rangés par difficulté (quatre
 * paliers : facile, moyen, difficile, extrême, cf. `tierOf`). Chacun a son idée : un mécanisme mis
 * en avant (tunnels du mini-ninja, bûches de substitution, dalles fragiles, shurikens, téléportation
 * Hiraishin, jets de flammes, dalles spectrales, roues de lames…), un thème, un rythme. Un niveau
 * ajouté se range à sa difficulté, sans changer ceux d'avant (la progression des joueurs y tient). `npm run gravity:levels` les bâtit (générateur + preuve du solveur, d'une traite) et
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
    // Les premiers tremplins : se laisser porter au-dessus des pics.
    id: 'premier-bond',
    seed: 229,
    plan: {
      name: 'Premier bond',
      theme: 'konoha',
      difficulty: 1,
      sections: [s('switch', 1), s('runway', 1), s('spring', 1), s('switch', 1), s('spring', 1), s('runway', 1), s('spikes', 1), s('spring', 2), s('switch', 1), s('switch', 1), s('runway', 1), s('spring', 1), s('switch', 1), s('spring', 1), s('runway', 1), s('spikes', 1), s('spring', 2)],
    },
  },
  {
    // Les nuages, en douceur : monter au travers, puis s’y poser.
    id: 'mer-de-nuages',
    seed: 233,
    plan: {
      name: 'Mer de nuages',
      theme: 'mist',
      difficulty: 1,
      sections: [s('switch', 1), s('cloud', 1), s('runway', 1), s('switch', 1), s('cloud', 1), s('islands', 1), s('cloud', 2), s('switch', 1), s('cloud', 1)],
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
  {
    // Le kekkai découvert : aller chercher le talisman en face.
    id: 'jardin-des-talismans',
    seed: 239,
    plan: {
      name: 'Le jardin des talismans',
      theme: 'konoha',
      difficulty: 2,
      sections: [s('switch', 1), s('kekkai', 1), s('runway', 1), s('spikes', 2), s('kekkai', 2), s('islands', 2), s('kekkai', 2), s('switch', 2), s('switch', 1), s('kekkai', 1), s('runway', 1), s('spikes', 2), s('kekkai', 2)],
    },
  },
  {
    // Des tremplins et un nuage le long des bambous.
    id: 'sentier-des-bambous',
    seed: 241,
    plan: {
      name: 'Le sentier des bambous',
      theme: 'hunter',
      difficulty: 2,
      sections: [s('spring', 2), s('switch', 2), s('spikes', 2), s('spring', 2), s('cloud', 2), s('runway', 1), s('spring', 2), s('islands', 2), s('spring', 2), s('switch', 2), s('spikes', 2), s('spring', 2), s('cloud', 2)],
    },
  },
  {
    // Nuages, sceaux et un premier talisman.
    id: 'temple-des-nuages',
    seed: 251,
    plan: {
      name: 'Le temple des nuages',
      theme: 'mist',
      difficulty: 2,
      sections: [s('cloud', 2), s('pad', 2), s('cloud', 2), s('kekkai', 2), s('switch', 2), s('cloud', 2), s('spikes', 2), s('cloud', 2), s('pad', 2)],
    },
  },
  {
    // Un peu de tout ce qui est nouveau, sous les lanternes.
    id: 'fete-des-lanternes',
    seed: 257,
    plan: {
      name: 'La fête des lanternes',
      theme: 'night',
      difficulty: 2,
      sections: [s('switch', 2), s('spring', 2), s('kekkai', 2), s('cloud', 2), s('islands', 2), s('spring', 2), s('moon', 2), s('switch', 2), s('switch', 2), s('spring', 2), s('kekkai', 2), s('cloud', 2)],
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
    // Les premières volées de kunaï : inverser avant ou après.
    id: 'archers-de-l-ombre',
    seed: 263,
    plan: {
      name: 'Les archers de l’ombre',
      theme: 'night',
      difficulty: 3,
      sections: [s('switch', 3), s('kunai', 2), s('spikes', 3), s('kunai', 3), s('islands', 3), s('kunai', 3), s('zigzag', 3), s('switch', 3), s('kunai', 2), s('spikes', 3), s('kunai', 3), s('islands', 3), s('kunai', 3)],
    },
  },
  {
    // Des tremplins à la chaîne, et les premiers pièges.
    id: 'cascade-de-ressorts',
    seed: 269,
    plan: {
      name: 'Cascade de ressorts',
      theme: 'sand',
      difficulty: 3,
      sections: [s('spring', 3), s('zigzag', 3), s('spring', 3), s('crumble', 3), s('spring', 4), s('islands', 3), s('spring', 4), s('spring', 3), s('zigzag', 3), s('spring', 3)],
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
    // Une ville bâtie sur les nuages.
    id: 'cite-celeste',
    seed: 271,
    plan: {
      name: 'La cité céleste',
      theme: 'mist',
      difficulty: 4,
      sections: [s('cloud', 3), s('islands', 4), s('cloud', 4), s('mover', 3), s('cloud', 4), s('zigzag', 4), s('cloud', 4), s('spikes', 4), s('cloud', 3), s('islands', 4)],
    },
  },
  {
    // Quatre barrières, quatre talismans à aller chercher.
    id: 'sanctuaire-scelle',
    seed: 277,
    plan: {
      name: 'Le sanctuaire scellé',
      theme: 'konoha',
      difficulty: 4,
      sections: [s('kekkai', 3), s('spikes', 4), s('kekkai', 4), s('mini', 4), s('kekkai', 4), s('zigzag', 4), s('kekkai', 4), s('pad', 4), s('kekkai', 3), s('spikes', 4), s('kekkai', 4)],
    },
  },
  {
    // Kunaï et shurikens : une bûche pour souffler.
    id: 'nid-de-frelons',
    seed: 281,
    plan: {
      name: 'Le nid de frelons',
      theme: 'hunter',
      difficulty: 4,
      sections: [s('kunai', 3), s('shuriken', 4), s('kunai', 4), s('kawarimi', 4), s('kunai', 4), s('zigzag', 4), s('kunai', 5), s('kunai', 3), s('shuriken', 4), s('kunai', 4), s('kawarimi', 4), s('kunai', 4), s('zigzag', 4)],
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
  {
    // De nuage en nuage, portés par les tremplins.
    id: 'nuit-des-cerfs-volants',
    seed: 283,
    plan: {
      name: 'La nuit des cerfs-volants',
      theme: 'night',
      difficulty: 5,
      sections: [s('cloud', 4), s('spring', 4), s('cloud', 5), s('kunai', 4), s('cloud', 5), s('moon', 4), s('spring', 5), s('cloud', 5), s('cloud', 4), s('spring', 4)],
    },
  },
  {
    // Talismans au milieu des flammes.
    id: 'forge-du-kekkai',
    seed: 293,
    plan: {
      name: 'La forge du kekkai',
      theme: 'sand',
      difficulty: 5,
      sections: [s('kekkai', 4), s('flames', 4), s('kekkai', 5), s('crumble', 5), s('kekkai', 5), s('flames', 5), s('kunai', 5), s('kekkai', 4), s('flames', 4), s('kekkai', 5), s('crumble', 5)],
    },
  },
  {
    // Des tremplins, des spectres, une barrière.
    id: 'citrouilles-sauteuses',
    seed: 307,
    plan: {
      name: 'Les citrouilles sauteuses',
      theme: 'halloween',
      difficulty: 5,
      sections: [s('spring', 4), s('crumble', 5), s('spring', 5), s('ghost', 4), s('spring', 5), s('kekkai', 5), s('zigzag', 5), s('spring', 5), s('spring', 4), s('crumble', 5), s('spring', 5), s('ghost', 4)],
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
    // Le Hiraishin, découvert : des barrières que seul le sceau doré franchit, de plus en plus haut perché.
    id: 'sceau-du-dieu-eclair',
    seed: 113,
    plan: {
      name: 'Le sceau du dieu de l’éclair',
      theme: 'konoha',
      difficulty: 6,
      sections: [s('switch', 5), s('hiraishin', 3), s('spikes', 6), s('islands', 6), s('hiraishin', 5), s('zigzag', 6), s('runway', 5), s('hiraishin', 6), s('wall', 6), s('pad', 6), s('hiraishin', 7), s('zigzag', 7), s('spikes', 7), s('islands', 7), s('hiraishin', 7)],
    },
  },
  {
    // Les premiers jets de flammes : chaque voie finit par cracher, il faut la quitter à temps.
    id: 'forges-de-la-montagne',
    seed: 127,
    plan: {
      name: 'Les forges de la montagne',
      theme: 'sand',
      difficulty: 6,
      sections: [s('switch', 5), s('flames', 4), s('runway', 5), s('spikes', 6), s('flames', 5), s('islands', 6), s('zigzag', 6), s('flames', 6), s('pad', 6), s('flames', 7), s('wall', 6), s('zigzag', 7)],
    },
  },
  {
    // Les dalles spectrales, en douceur : se poser quand elles brillent, repartir avant qu'elles ne s'effacent.
    id: 'lanternes-spectrales',
    seed: 131,
    plan: {
      name: 'Lanternes spectrales',
      theme: 'mist',
      difficulty: 6,
      sections: [s('switch', 5), s('ghost', 4), s('islands', 6), s('spikes', 6), s('ghost', 5), s('zigzag', 6), s('crumble', 6), s('ghost', 6), s('runway', 5), s('mini', 6), s('ghost', 7), s('zigzag', 7)],
    },
  },
  {
    // Une averse de kunaï, entre deux zigzags.
    id: 'pluie-de-kunai',
    seed: 311,
    plan: {
      name: 'Pluie de kunaï',
      theme: 'konoha',
      difficulty: 6,
      sections: [s('kunai', 5), s('zigzag', 6), s('kunai', 6), s('spikes', 6), s('kunai', 6), s('islands', 6), s('kunai', 7), s('zigzag', 7), s('kunai', 5), s('zigzag', 6), s('kunai', 6), s('spikes', 6), s('kunai', 6), s('islands', 6), s('kunai', 7)],
    },
  },
  {
    // Nuages, spectres et tremplins au-dessus du vide.
    id: 'royaume-des-nuages',
    seed: 313,
    plan: {
      name: 'Le royaume des nuages',
      theme: 'mist',
      difficulty: 6,
      sections: [s('cloud', 6), s('spring', 6), s('cloud', 6), s('ghost', 6), s('cloud', 6), s('kekkai', 6), s('cloud', 7), s('zigzag', 7), s('cloud', 6), s('spring', 6), s('cloud', 6), s('ghost', 6)],
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
    // Les roues de lames : attendre que la roue s'ouvre, entre deux passages plus classiques.
    id: 'moulin-a-lames',
    seed: 137,
    plan: {
      name: 'Le moulin à lames',
      theme: 'hunter',
      difficulty: 7,
      sections: [s('switch', 6), s('orbit', 5), s('spikes', 6), s('zigzag', 6), s('orbit', 6), s('kawarimi', 6), s('islands', 7), s('orbit', 7), s('shuriken', 7), s('wall', 7), s('orbit', 7), s('zigzag', 7), s('islands', 7), s('orbit', 8)],
    },
  },
  {
    // Tout brûle : des jets partout, des étals qui s'effondrent, deux bûches pour souffler.
    id: 'village-en-flammes',
    seed: 139,
    plan: {
      name: 'Le village en flammes',
      theme: 'halloween',
      difficulty: 7,
      sections: [s('spikes', 6), s('flames', 6), s('crumble', 6), s('kawarimi', 6), s('flames', 7), s('zigzag', 7), s('islands', 7), s('flames', 7), s('moon', 6), s('crumble', 7), s('flames', 8)],
    },
  },
  {
    // Un pont qui n'existe qu'à moitié : dalles spectrales, plateformes qui montent et descendent, la lune.
    id: 'pont-des-ames',
    seed: 149,
    plan: {
      name: 'Le pont des âmes',
      theme: 'night',
      difficulty: 7,
      sections: [s('switch', 6), s('ghost', 6), s('mover', 6), s('islands', 7), s('ghost', 7), s('moon', 6), s('zigzag', 7), s('ghost', 7), s('mover', 7), s('spikes', 7), s('ghost', 8), s('zigzag', 8), s('ghost', 8)],
    },
  },
  {
    // Un temple de sceaux : téléportations, sceaux d'inversion et passages pour mini-ninja.
    id: 'temple-des-sceaux',
    seed: 151,
    plan: {
      name: 'Le temple des sceaux',
      theme: 'mist',
      difficulty: 7,
      sections: [s('wall', 6), s('hiraishin', 6), s('mini', 6), s('pad', 7), s('hiraishin', 7), s('zigzag', 7), s('spikes', 7), s('hiraishin', 7), s('mini', 7), s('islands', 7), s('hiraishin', 8)],
    },
  },
  {
    // Barrières et téléportations en alternance.
    id: 'labyrinthe-de-sceaux',
    seed: 317,
    plan: {
      name: 'Le labyrinthe de sceaux',
      theme: 'night',
      difficulty: 7,
      sections: [s('kekkai', 6), s('hiraishin', 6), s('kekkai', 7), s('mini', 7), s('kekkai', 7), s('hiraishin', 7), s('kekkai', 7), s('zigzag', 7), s('kekkai', 6), s('hiraishin', 6), s('kekkai', 7), s('mini', 7)],
    },
  },
  {
    // Bondir entre les jets de flammes.
    id: 'tremplins-de-feu',
    seed: 331,
    plan: {
      name: 'Les tremplins de feu',
      theme: 'halloween',
      difficulty: 7,
      sections: [s('spring', 6), s('flames', 6), s('spring', 7), s('crumble', 7), s('spring', 7), s('flames', 7), s('kunai', 7), s('spring', 7), s('spring', 6), s('flames', 6), s('spring', 7)],
    },
  },
  {
    // Nuages de neige, glace qui cède, kunaï dans la tempête.
    id: 'ciel-de-neige',
    seed: 337,
    plan: {
      name: 'Ciel de neige',
      theme: 'christmas',
      difficulty: 7,
      sections: [s('cloud', 6), s('crumble', 7), s('cloud', 7), s('ghost', 7), s('spring', 7), s('cloud', 7), s('kunai', 7), s('islands', 7), s('cloud', 6), s('crumble', 7), s('cloud', 7), s('ghost', 7)],
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
  {
    // Une nuit polaire : la glace qui cède, des dalles de lumière qui vont et viennent, des roues de lames.
    id: 'aurore-boreale',
    seed: 157,
    plan: {
      name: 'Aurore boréale',
      theme: 'christmas',
      difficulty: 8,
      sections: [s('crumble', 7), s('ghost', 7), s('orbit', 7), s('islands', 8), s('ghost', 8), s('zigzag', 8), s('orbit', 8), s('crumble', 8), s('ghost', 8), s('spikes', 8), s('mover', 8), s('orbit', 8), s('crumble', 9), s('ghost', 9)],
    },
  },
  {
    // Le désert chauffé à blanc : jets de flammes, shurikens et roues de lames.
    id: 'fournaise-du-desert',
    seed: 163,
    plan: {
      name: 'La fournaise du désert',
      theme: 'sand',
      difficulty: 8,
      sections: [s('switch', 7), s('flames', 7), s('shuriken', 7), s('orbit', 7), s('zigzag', 8), s('flames', 8), s('mini', 7), s('orbit', 8), s('flames', 8), s('wall', 8), s('zigzag', 8)],
    },
  },
  {
    // Les quatre nouveautés à la suite, avant le palier Extrême.
    id: 'chasse-de-nuit',
    seed: 167,
    plan: {
      name: 'Chasse de nuit',
      theme: 'hunter',
      difficulty: 8,
      sections: [s('zigzag', 7), s('hiraishin', 7), s('flames', 7), s('ghost', 7), s('orbit', 8), s('kawarimi', 8), s('islands', 8), s('hiraishin', 8), s('flames', 8), s('ghost', 8), s('zigzag', 8)],
    },
  },
  {
    // Les gardes tirent, les lames tournent, les portes sont scellées.
    id: 'garde-du-temple',
    seed: 347,
    plan: {
      name: 'La garde du temple',
      theme: 'mist',
      difficulty: 8,
      sections: [s('kunai', 7), s('kekkai', 7), s('orbit', 7), s('kunai', 8), s('kekkai', 8), s('shuriken', 8), s('kunai', 8), s('zigzag', 8), s('kunai', 7), s('kekkai', 7), s('orbit', 7), s('kunai', 8), s('kekkai', 8), s('shuriken', 8), s('kunai', 8), s('zigzag', 8), s('kunai', 8), s('kekkai', 8)],
    },
  },
  {
    // Grimper de tremplin en nuage jusqu’au sommet.
    id: 'ascension-du-mont',
    seed: 349,
    plan: {
      name: 'L’ascension du mont',
      theme: 'sand',
      difficulty: 8,
      sections: [s('spring', 7), s('cloud', 8), s('spring', 8), s('mover', 7), s('cloud', 8), s('spring', 8), s('kekkai', 8), s('cloud', 8), s('zigzag', 8), s('spring', 7), s('cloud', 8), s('spring', 8)],
    },
  },
  {
    // Toutes les nouveautés, avant le palier Extrême.
    id: 'tour-de-guet',
    seed: 353,
    plan: {
      name: 'La tour de guet',
      theme: 'hunter',
      difficulty: 8,
      sections: [s('kunai', 8), s('cloud', 8), s('kekkai', 8), s('spring', 8), s('ghost', 8), s('kunai', 8), s('hiraishin', 8), s('zigzag', 8), s('kunai', 8), s('cloud', 8), s('kekkai', 8), s('spring', 8), s('ghost', 8)],
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
    // Un brasier sans répit : les jets s'enchaînent, la roue tourne, une seule bûche.
    id: 'enfer-de-cendres',
    seed: 173,
    plan: {
      name: 'L’enfer de cendres',
      theme: 'halloween',
      difficulty: 9,
      sections: [s('flames', 8), s('zigzag', 9), s('flames', 9), s('crumble', 9), s('flames', 9), s('orbit', 9), s('islands', 9), s('flames', 9), s('kawarimi', 9), s('flames', 10), s('zigzag', 10)],
    },
  },
  {
    // Rien n'est solide longtemps : dalle spectrale après dalle spectrale.
    id: 'cimetiere-des-spectres',
    seed: 179,
    plan: {
      name: 'Le cimetière des spectres',
      theme: 'night',
      difficulty: 9,
      sections: [s('ghost', 8), s('zigzag', 9), s('ghost', 9), s('mover', 9), s('ghost', 9), s('spikes', 9), s('mini', 9), s('ghost', 9), s('islands', 9), s('ghost', 10), s('zigzag', 10)],
    },
  },
  {
    // La technique du quatrième Hokage, en rafale : barrière sur barrière, sceaux perchés.
    id: 'eclair-jaune',
    seed: 181,
    plan: {
      name: 'L’éclair jaune',
      theme: 'konoha',
      difficulty: 9,
      sections: [s('hiraishin', 8), s('zigzag', 9), s('hiraishin', 9), s('spikes', 9), s('hiraishin', 9), s('islands', 9), s('shuriken', 9), s('hiraishin', 9), s('wall', 9), s('zigzag', 10), s('hiraishin', 10), s('islands', 10), s('shuriken', 10), s('hiraishin', 10), s('zigzag', 10)],
    },
  },
  {
    // Le vent de sable fait tourner les lames : roues et shurikens à la chaîne.
    id: 'tourbillon-de-lames',
    seed: 191,
    plan: {
      name: 'Tourbillon de lames',
      theme: 'sand',
      difficulty: 9,
      sections: [s('orbit', 8), s('shuriken', 9), s('orbit', 9), s('kawarimi', 9), s('zigzag', 9), s('orbit', 9), s('shuriken', 10), s('orbit', 9), s('mini', 9), s('orbit', 10), s('spikes', 10), s('zigzag', 10), s('orbit', 10), s('kawarimi', 10), s('shuriken', 10), s('orbit', 10)],
    },
  },
  {
    // Dans la tempête, la glace se brise et les dalles de lumière s'éteignent : la lune aide un peu.
    id: 'blizzard-spectral',
    seed: 193,
    plan: {
      name: 'Blizzard spectral',
      theme: 'christmas',
      difficulty: 9,
      sections: [s('crumble', 9), s('ghost', 9), s('moon', 8), s('ghost', 9), s('crumble', 9), s('islands', 9), s('ghost', 10), s('orbit', 9), s('crumble', 10), s('ghost', 10), s('mini', 9), s('ghost', 10), s('zigzag', 10), s('crumble', 10), s('ghost', 10)],
    },
  },
  {
    // Kunaï, roues et shurikens : l’acier vole de partout.
    id: 'tempete-d-acier',
    seed: 359,
    plan: {
      name: 'Tempête d’acier',
      theme: 'konoha',
      difficulty: 9,
      sections: [s('kunai', 9), s('orbit', 9), s('kunai', 9), s('shuriken', 9), s('kunai', 9), s('zigzag', 9), s('kunai', 10), s('spikes', 10), s('kunai', 10), s('kunai', 9), s('orbit', 9), s('kunai', 9), s('shuriken', 9), s('kunai', 9), s('zigzag', 9), s('kunai', 10), s('spikes', 10), s('kunai', 10), s('kunai', 10), s('orbit', 10), s('kunai', 10), s('shuriken', 10), s('kunai', 10), s('zigzag', 10)],
    },
  },
  {
    // Des îles de nuages, très loin du sol.
    id: 'archipel-celeste',
    seed: 367,
    plan: {
      name: 'L’archipel céleste',
      theme: 'mist',
      difficulty: 9,
      sections: [s('cloud', 9), s('spring', 9), s('cloud', 9), s('ghost', 9), s('cloud', 9), s('mover', 9), s('cloud', 10), s('spring', 10), s('cloud', 10), s('cloud', 9), s('spring', 9), s('cloud', 9), s('ghost', 9)],
    },
  },
  {
    // Sept barrières, sept talismans, sans répit.
    id: 'les-sept-sceaux',
    seed: 373,
    plan: {
      name: 'Les sept sceaux',
      theme: 'night',
      difficulty: 9,
      sections: [s('kekkai', 9), s('zigzag', 9), s('kekkai', 9), s('flames', 9), s('kekkai', 9), s('mini', 9), s('kekkai', 9), s('hiraishin', 9), s('kekkai', 10), s('kekkai', 10), s('kekkai', 10), s('kekkai', 9), s('zigzag', 9), s('flames', 9)],
    },
  },
  {
    // Tremplins piégés au-dessus des braises.
    id: 'rebonds-infernaux',
    seed: 379,
    plan: {
      name: 'Rebonds infernaux',
      theme: 'halloween',
      difficulty: 9,
      sections: [s('spring', 9), s('flames', 9), s('spring', 9), s('crumble', 9), s('spring', 10), s('kunai', 9), s('spring', 10), s('ghost', 9), s('spring', 10), s('spring', 9), s('flames', 9)],
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
    // Tous les mécanismes d'origine, au plus dur.
    id: 'eclipse',
    seed: 109,
    plan: {
      name: 'Éclipse',
      theme: 'night',
      difficulty: 10,
      sections: [s('zigzag', 9), s('shuriken', 9), s('mini', 9), s('mover', 9), s('crumble', 10), s('kawarimi', 10), s('islands', 10), s('moon', 9), s('mini', 10), s('wall', 10), s('shuriken', 10), s('mover', 10), s('zigzag', 10), s('crumble', 10), s('mini', 10), s('spikes', 10)],
    },
  },
  {
    // Le dernier rempart : des murs, des barrières à téléportation et des jets qui gardent chaque voie.
    id: 'dernier-rempart',
    seed: 197,
    plan: {
      name: 'Le dernier rempart',
      theme: 'mist',
      difficulty: 10,
      sections: [s('wall', 9), s('hiraishin', 9), s('flames', 9), s('wall', 10), s('hiraishin', 10), s('flames', 10), s('shuriken', 10), s('hiraishin', 10), s('zigzag', 10), s('flames', 10), s('wall', 10), s('hiraishin', 10), s('islands', 10), s('flames', 10), s('hiraishin', 10)],
    },
  },
  {
    // Feux follets : dalles spectrales et jets de flammes en alternance, au rythme le plus serré.
    id: 'danse-des-feux-follets',
    seed: 199,
    plan: {
      name: 'La danse des feux follets',
      theme: 'hunter',
      difficulty: 10,
      sections: [s('ghost', 9), s('flames', 9), s('zigzag', 10), s('ghost', 10), s('flames', 10), s('islands', 10), s('ghost', 10), s('flames', 10), s('kawarimi', 10), s('ghost', 10), s('zigzag', 10)],
    },
  },
  {
    // Sous la lune, les roues de lames tournent : planer entre elles, se faufiler en mini-ninja.
    id: 'cercles-de-lune',
    seed: 211,
    plan: {
      name: 'Les cercles de la lune',
      theme: 'night',
      difficulty: 10,
      sections: [s('orbit', 9), s('moon', 9), s('orbit', 10), s('mini', 10), s('zigzag', 10), s('orbit', 10), s('moon', 10), s('islands', 10), s('orbit', 10), s('mini', 10), s('orbit', 10), s('zigzag', 10), s('orbit', 10), s('spikes', 10)],
    },
  },
  {
    // Une forteresse hantée : téléportations, spectres, flammes, lames, tunnels et dalles fissurées.
    id: 'citadelle-des-ombres',
    seed: 223,
    plan: {
      name: 'La citadelle des ombres',
      theme: 'halloween',
      difficulty: 10,
      sections: [s('zigzag', 10), s('hiraishin', 10), s('ghost', 10), s('flames', 10), s('orbit', 10), s('mini', 10), s('crumble', 10), s('hiraishin', 10), s('ghost', 10), s('flames', 10), s('orbit', 10), s('spikes', 10)],
    },
  },
  {
    // L'épreuve finale : tous les mécanismes, anciens et nouveaux, au plus dur et sans répit.
    id: 'le-dernier-sceau',
    seed: 227,
    plan: {
      name: 'Le dernier sceau',
      theme: 'konoha',
      difficulty: 10,
      sections: [s('flames', 10), s('zigzag', 10), s('hiraishin', 10), s('orbit', 10), s('ghost', 10), s('shuriken', 10), s('mini', 10), s('flames', 10), s('hiraishin', 10), s('crumble', 10), s('ghost', 10), s('orbit', 10), s('kawarimi', 10), s('zigzag', 10), s('flames', 10), s('hiraishin', 10)],
    },
  },
  {
    // Les kunaï filent dans la neige.
    id: 'blizzard-de-kunai',
    seed: 383,
    plan: {
      name: 'Blizzard de kunaï',
      theme: 'christmas',
      difficulty: 10,
      sections: [s('kunai', 9), s('crumble', 10), s('kunai', 10), s('cloud', 9), s('kunai', 10), s('ghost', 10), s('kunai', 10), s('zigzag', 10), s('kunai', 9), s('crumble', 10), s('kunai', 10), s('cloud', 9), s('kunai', 10), s('ghost', 10), s('kunai', 10), s('zigzag', 10), s('kunai', 10), s('crumble', 10), s('kunai', 10), s('cloud', 10), s('kunai', 10)],
    },
  },
  {
    // Une forteresse sur les nuages, gardée et scellée.
    id: 'citadelle-celeste',
    seed: 389,
    plan: {
      name: 'La citadelle céleste',
      theme: 'sand',
      difficulty: 10,
      sections: [s('cloud', 10), s('kekkai', 10), s('spring', 10), s('cloud', 10), s('kunai', 10), s('orbit', 10), s('cloud', 10), s('hiraishin', 10), s('zigzag', 10), s('cloud', 10), s('kekkai', 10), s('spring', 10), s('cloud', 10), s('kunai', 10), s('orbit', 10), s('cloud', 10), s('hiraishin', 10)],
    },
  },
  {
    // Tous les pièges de la forêt, au plus dur.
    id: 'chasseur-d-ombres',
    seed: 397,
    plan: {
      name: 'Le chasseur d’ombres',
      theme: 'hunter',
      difficulty: 10,
      sections: [s('kekkai', 10), s('kunai', 10), s('spring', 10), s('ghost', 10), s('flames', 10), s('cloud', 10), s('mini', 10), s('kunai', 10), s('kekkai', 10), s('zigzag', 10), s('kekkai', 10), s('kunai', 10), s('spring', 10), s('ghost', 10), s('flames', 10)],
    },
  },
  {
    // L’épreuve ultime : tous les mécanismes, sans exception, au plus dur.
    id: 'la-voie-du-ninja',
    seed: 401,
    plan: {
      name: 'La voie du ninja',
      theme: 'konoha',
      difficulty: 10,
      sections: [s('zigzag', 10), s('spring', 10), s('cloud', 10), s('kekkai', 10), s('kunai', 10), s('hiraishin', 10), s('flames', 10), s('ghost', 10), s('orbit', 10), s('mini', 10), s('crumble', 10), s('kawarimi', 10), s('kunai', 10), s('spring', 10), s('cloud', 10), s('kekkai', 10), s('zigzag', 10)],
    },
  },
]
