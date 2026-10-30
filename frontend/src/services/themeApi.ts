import { api } from './api'

/** Thème saisonnier (cf. `backend/src/modules/theme/`) : l'app habillée pour une fête, pour tout le monde. */
export const SITE_THEMES = ['none', 'halloween'] as const
export type SiteTheme = (typeof SITE_THEMES)[number]

export const isSiteTheme = (value: unknown): value is SiteTheme => (SITE_THEMES as readonly unknown[]).includes(value)

export const themeApi = {
  current: (signal?: AbortSignal) => api<{ theme: SiteTheme }>('/theme', { signal }).then((response) => response.theme),
  /** Administration : change le thème pour tout le monde. */
  set: (theme: SiteTheme) => api<{ theme: SiteTheme }>('/admin/theme', { method: 'POST', body: { theme } }).then((response) => response.theme),
}
