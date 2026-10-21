import { Pause, Play } from '@/components/icons'
import { useEffect, useRef, useState } from 'react'
import { useT } from '@/i18n'
import { mmss } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Audio player with the product's skin: play or pause, progress and time. Replaces the browser's native control. */
export function AudioPlayer({ src, name, className }: { src: string; name: string; className?: string }) {
  const t = useT()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const onTime = () => setTime(el.currentTime)
    const onMeta = () => setLength(Number.isFinite(el.duration) ? el.duration : 0)
    const onEnd = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('ended', onEnd)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
      el.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().then(() => setPlaying(true))
    else {
      el.pause()
      setPlaying(false)
    }
  }

  return (
    <div className={cn('well flex items-center gap-3 rounded-full px-2 py-1', className)}>
      <audio ref={audio} src={src} preload="metadata" />
      <button type="button" onClick={toggle} aria-label={playing ? t('audio.pause', { name }) : t('audio.play', { name })} className="btn btn-gel h-8 w-8 shrink-0 justify-center">
        {playing ? <Pause size={14} aria-hidden /> : <Play size={14} fill="currentColor" aria-hidden />}
      </button>
      <input
        type="range"
        min={0}
        max={length || 1}
        step={0.1}
        value={Math.min(time, length || 1)}
        aria-label={t('audio.position', { name })}
        onChange={(e) => {
          const el = audio.current
          if (el) el.currentTime = Number(e.target.value)
          setTime(Number(e.target.value))
        }}
        className="h-1 min-w-0 flex-1 accent-[var(--color-accent)]"
      />
      <span className="shrink-0 pr-1 text-xs tabular-nums text-muted">
        {mmss(time)} / {mmss(length)}
      </span>
    </div>
  )
}
