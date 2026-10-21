const dateFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
const shortFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' })

/** «20 de octubre de 2026» */
export function longDate(d: Date): string {
  return dateFmt.format(d)
}

export function clock(d: Date): string {
  return timeFmt.format(d)
}

/** Date and time of a row: «hoy 14:30», «ayer 09:05» or «20 oct 14:30». */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  const hour = clock(d)
  if (diff === 0) return `hoy ${hour}`
  if (diff === 1) return `ayer ${hour}`
  return `${shortFmt.format(d).replace('.', '')} ${hour}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function fileSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
