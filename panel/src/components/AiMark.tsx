import { Sparkles } from '@/components/icons'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Origin mark of what a model generated (UD-026): the sparkle with the word «IA», as the design systems
 * that mark AI output pair them, and the full name «Generado por IA» as its accessible name and tooltip.
 * It goes in the header of a surface that is model output; one mark per group, not one per item.
 */
export function AiMark({ className }: { className?: string }) {
  const t = useT()
  return (
    <span role="img" aria-label={t('ai.name')} title={t('ai.name')} className={cn('inline-flex shrink-0 items-center gap-1 rounded-full bg-ai-edge/15 px-1.5 py-0.5 text-[11px] font-bold leading-none tracking-wide text-ai-fg', className)}>
      <Sparkles size={12} aria-hidden />
      <span aria-hidden>{t('ai.label')}</span>
    </span>
  )
}
