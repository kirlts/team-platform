// Tema claro, oscuro o el del sistema. Se guarda sólo como comodidad de este navegador.

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'team-theme'

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Almacenamiento bloqueado: se sigue con el sistema.
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
    // Sin almacenamiento el tema vale para esta pestaña.
  }
  applyTheme(pref)
  window.dispatchEvent(new Event('team-theme'))
}

/** Aplica el tema guardado y lo mantiene al día si es «sistema». */
export function initTheme() {
  applyTheme(readThemePref())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readThemePref() === 'system') applyTheme('system')
  })
}
