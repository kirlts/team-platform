import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import type { Proposal } from '@team-platform/client'

/**
 * Says that a proposal is a double: the example server (`dev-server.mjs`) marks the proposals it invents with `simulated`, so nobody judges
 * them as if the real analysis had written them. The real API never sends the field, so against it nothing is drawn.
 */
export function SimulatedMark({ proposal }: { proposal?: Proposal | null }) {
  const t = useT()
  if (proposal?.simulated !== true) return null
  return (
    <Badge tone="outline" className="border-dashed" title={t('analysis.simulatedHint')} data-testid="simulated-mark">
      {t('analysis.simulated')}
    </Badge>
  )
}
