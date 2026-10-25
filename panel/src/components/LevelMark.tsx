import { BLOOM_LEVELS, BLOOM_TIER, type BloomLevel, type BloomTier, type Message } from '@team-platform/client'
import { useMe, useSetLevel } from '@team-platform/client/react'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'

const TIERS: BloomTier[] = ['direct', 'complex', 'person']

/**
 * The level of a message in the revised Bloom taxonomy (UD-292): the analyzer's reading, as a badge on the card. The badge is the control: an active person
 * of the team picks another level in it and it saves on change (the model of the next session of the message follows it). The levels are grouped by who may work
 * them, so the groups say what each level does without a sentence: a direct fix, a complex one, or only a person. Someone who is not a person of the team sees
 * the word. A message published before the level existed shows nothing to anyone but a person, who can set it.
 */
export function LevelMark({ message, className }: { message: Pick<Message, 'id' | 'bloom_level'>; className?: string }) {
  const t = useT()
  const me = useMe().data
  const setLevel = useSetLevel()
  const level = (message.bloom_level ?? null) as BloomLevel | null
  const canSet = !!me && me.kind !== 'agent' && me.active !== false
  const word = level ? t(`level.${level}` as MessageKey) : t('level.none')
  if (!canSet) return level ? <span data-testid="level-mark" data-level={level} data-tier={BLOOM_TIER[level]} className={cn('level-mark', className)}>{word}</span> : null
  return (
    <select
      data-testid="level-mark"
      data-level={level ?? undefined}
      data-tier={level ? BLOOM_TIER[level] : undefined}
      aria-label={t('level.label')}
      title={level ? t(`level.tier.${BLOOM_TIER[level]}` as MessageKey) : undefined}
      value={level ?? ''}
      disabled={setLevel.isPending}
      onChange={(e) => setLevel.mutate({ id: message.id, level: e.target.value as BloomLevel })}
      className={cn('level-mark level-mark-control relative z-10', !level && 'text-muted', className)}
    >
      {!level && <option value="" disabled>{word}</option>}
      {TIERS.map((tier) => (
        <optgroup key={tier} label={t(`level.tier.${tier}` as MessageKey)}>
          {BLOOM_LEVELS.filter((l) => BLOOM_TIER[l] === tier).map((l) => <option key={l} value={l}>{t(`level.${l}` as MessageKey)}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
