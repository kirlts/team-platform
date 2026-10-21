// Light theme, dark theme or the system's. It is stored only as a convenience of this browser.

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'team-theme'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage blocked: the system theme is followed.
  }
  return 'system'
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref)
}

export function saveTheme(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // Without storage the theme applies to this tab.
  }
  applyTheme(pref)
  window.dispatchEvent(new Event('team-theme'))
}

/** Applies the stored theme and keeps it up to date if it is «sistema». */
export function initTheme() {
  applyTheme(readThemePref())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readThemePref() === 'system') applyTheme('system')
  })
}
