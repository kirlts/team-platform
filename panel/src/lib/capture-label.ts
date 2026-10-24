/**
 * The short label of a capture that came with its role in the name: the closing reply of a work names its screenshots «Antes - <alt>» and
 * «Después - <alt>» (or «Before» and «After»). The thread shows the label over the picture and the rest as its description, not the file name.
 */
const CAPTURE_NAME = /^(Antes|Después|Propuesta|Before|After|Proposal) - (.+)$/

export function captureLabel(name: string | undefined): { label: string; alt: string } | null {
  const m = name ? CAPTURE_NAME.exec(name) : null
  return m ? { label: m[1], alt: m[2] } : null
}
