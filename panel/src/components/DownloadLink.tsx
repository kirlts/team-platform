import { Download } from '@/components/icons'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The way to save an attachment with its original name: an icon whose accessible name is «Descargar <nombre>». The server answers
 * `?download=1` with `Content-Disposition: attachment`, so it downloads in Safari of an iPhone too, where `download` alone is not enough.
 */
export function DownloadLink({ href, name, className }: { href?: string; name?: string; className?: string }) {
  const t = useT()
  if (!href) return null
  const label = t('media.download', { name: name ?? t('media.attachments') })
  return (
    <a
      href={href}
      download={name}
      aria-label={label}
      title={label}
      data-testid="download-attachment"
      className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-accent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', className)}
    >
      <Download size={16} aria-hidden />
    </a>
  )
}
