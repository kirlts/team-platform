// Light, dark or system theme. Stored only as a convenience of this browser.

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'team-theme'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage blocked: carries on with the system theme.
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
    // Without storage the theme only holds for this tab.
  }
  applyTheme(pref)
  window.dispatchEvent(new Event('team-theme'))
}

/** Applies the saved theme and keeps it up to date if it is «sistema». */
export function initTheme() {
  applyTheme(readThemePref())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readThemePref() === 'system') applyTheme('system')
  })
}
