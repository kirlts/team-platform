export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** A reason that comes after a colon starts in lower case («No se pudo enviar: el archivo pesa…»), unless it opens with an acronym or a proper noun in capitals. */
export function afterColon(reason: string): string {
  return /^\p{Lu}\p{Ll}/u.test(reason) ? reason[0]!.toLowerCase() + reason.slice(1) : reason
}
