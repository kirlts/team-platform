import type { ReactNode } from 'react'
import { ChevronDown } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** One entry of the menu: an action, or an option that is on or off (then `checked` and `onCheckedChange` come together). */
export type MoreItem = {
  key: string
  label: string
  icon?: ReactNode
  /** The action destroys something: its text is red, never its fill. */
  danger?: boolean
  testId?: string
} & ({ onSelect: () => void; checked?: undefined } | { checked: boolean; onCheckedChange: (on: boolean) => void })

/**
 * «Más»: the actions of a screen that are used now and then, in one menu so the one that is used every time stands out.
 * The trigger is a quiet button with its name; the menu is a 16 px box with 8 px of margin, so its options curve at 8 px.
 */
export function MoreMenu({ items, className }: { items: MoreItem[]; className?: string }) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-testid="more-menu" className={className}>
          {t('more.label')}
          <ChevronDown size={16} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="p-2">
        {items.map((item) =>
          item.checked === undefined ? (
            <DropdownMenuItem key={item.key} data-testid={item.testId} className={cn('pointer-coarse:min-h-11', item.danger && 'text-danger data-[highlighted]:text-danger')} onSelect={item.onSelect}>
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuCheckboxItem key={item.key} data-testid={item.testId} className="pointer-coarse:min-h-11" checked={item.checked} onCheckedChange={item.onCheckedChange}>
              {item.label}
            </DropdownMenuCheckboxItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
