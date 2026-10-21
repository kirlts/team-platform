import { Camera, Link2, Mic, Paperclip, Send, Square } from '@/components/icons'
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { mmss } from '@/lib/format'
import { canRecord, startRecording, type Recording } from '@/lib/recorder'
import { kindFromMime, uploadInput, UploadError, type CreatedInput } from '@/lib/upload'
import { cn } from '@/lib/utils'
import { Thumb } from './Thumb'

interface Local {
  key: string
  file: File
  url: string
}

/**
 * New message bar: text, attachments (clip, drag, paste), camera photo,
 * recorded audio and links. A single multipart submission with upload progress.
 */
export function ComposeBar({ onCreated, disabled }: { onCreated: (created: CreatedInput) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const [locals, setLocals] = useState<Local[]>([])
  const [links, setLinks] = useState<string[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState<{ seconds: number } | null>(null)
  const recorder = useRef<Recording | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const localsRef = useRef<Local[]>([])
  localsRef.current = locals

  const uploading = progress !== null
  const busy = uploading || !!disabled
  const empty = !text.trim() && locals.length === 0 && links.length === 0
  const micOk = canRecord()

  useEffect(() => () => localsRef.current.forEach((l) => URL.revokeObjectURL(l.url)), [])

  // The field grows with its text up to a maximum and from there it scrolls inside.
  useEffect(() => {
    const el = textArea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setRecording((r) => (r ? { seconds: r.seconds + 1 } : r)), 1000)
    return () => clearInterval(t)
  }, [recording !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    setLocals((prev) => [
      ...prev,
      ...files.map((file) => ({ key: `${file.name}-${file.size}-${crypto.randomUUID()}`, file, url: URL.createObjectURL(file) })),
    ])
  }, [])

  const removeLocal = (key: string) =>
    setLocals((prev) => {
      const gone = prev.find((l) => l.key === key)
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter((l) => l.key !== key)
    })

  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  const addLink = () => {
    const raw = linkDraft.trim()
    if (!raw) {
      setLinkOpen(false)
      return
    }
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      setLinks((prev) => (prev.includes(url.href) ? prev : [...prev, url.href]))
      setLinkDraft('')
      setLinkError(null)
      setLinkOpen(false)
    } catch {
      setLinkError('Dirección inválida')
    }
  }

  const toggleRecording = async () => {
    setError(null)
    if (recording && recorder.current) {
      const rec = recorder.current
      recorder.current = null
      setRecording(null)
      try {
        addFiles([await rec.stop()])
      } catch {
        setError('No se pudo grabar')
      }
      return
    }
    try {
      recorder.current = await startRecording()
      setRecording({ seconds: 0 })
    } catch {
      setError('Sin acceso al micrófono')
    }
  }

  const send = async () => {
    if (empty || busy || recording) return
    setError(null)
    setProgress(0)
    try {
      const created = await uploadInput({ text, files: locals.map((l) => l.file), links }, setProgress)
      locals.forEach((l) => URL.revokeObjectURL(l.url))
      setText('')
      setLocals([])
      setLinks([])
      setLinkOpen(false)
      onCreated(created)
    } catch (err) {
      setError(err instanceof UploadError ? `No se pudo enviar: ${err.message}` : 'No se pudo enviar')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'glass leaf transition-colors duration-150 focus-within:border-accent',
        dragging && '!border-accent !bg-accent-soft',
        busy && 'opacity-70',
      )}
    >
      <div className="flex items-end gap-1.5 p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Adjuntar" disabled={busy}>
              <Paperclip size={18} aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
              <Paperclip size={15} aria-hidden /> Archivo
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
              <Link2 size={15} aria-hidden /> Enlace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />

        {recording ? (
          <div className="flex min-h-8 flex-1 items-center gap-2 px-2 text-sm" role="status" aria-label="Grabando audio">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
            <span className="tabular-nums">{mmss(recording.seconds)}</span>
          </div>
        ) : (
          <textarea
            ref={textArea}
            rows={1}
            value={text}
            disabled={busy}
            aria-label="Nuevo mensaje"
            placeholder="Encargo, idea o retroalimentación"
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
            }}
            className="max-h-[200px] min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 placeholder:text-faint focus-visible:outline-none"
          />
        )}

        <Button variant="ghost" size="icon" aria-label="Tomar foto" disabled={busy || !!recording} onClick={() => cameraInput.current?.click()}>
          <Camera size={18} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={recording ? 'Detener grabación' : 'Grabar audio'}
          title={micOk ? undefined : 'La grabación requiere HTTPS'}
          disabled={busy || !micOk}
          onClick={() => void toggleRecording()}
          className={cn(recording && 'text-danger')}
        >
          {recording ? <Square size={16} fill="currentColor" aria-hidden /> : <Mic size={18} aria-hidden />}
        </Button>
        <Button variant="primary" size="icon" aria-label="Enviar" title="Enviar (Ctrl+Enter)" disabled={empty || busy || !!recording} onClick={() => void send()}>
          <Send size={16} aria-hidden />
        </Button>
      </div>

      {linkOpen && (
        <form
          className="flex items-center gap-2 border-t border-line px-2 py-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            addLink()
          }}
        >
          <Input
            autoFocus
            type="url"
            inputMode="url"
            aria-label="Enlace"
            placeholder="https://"
            value={linkDraft}
            onChange={(e) => {
              setLinkDraft(e.target.value)
              setLinkError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setLinkOpen(false)
            }}
            className="h-7 flex-1"
          />
          <Button type="submit" size="sm">
            Agregar
          </Button>
          {linkError && (
            <span role="alert" className="text-xs text-danger">
              {linkError}
            </span>
          )}
        </form>
      )}

      {(locals.length > 0 || links.length > 0) && (
        <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-2.5 py-2">
          {locals.map((l) => (
            <Thumb
              key={l.key}
              item={{ kind: kindFromMime(l.file.type), src: l.url, name: l.file.name, size: l.file.size }}
              px={44}
              onRemove={busy ? undefined : () => removeLocal(l.key)}
            />
          ))}
          {links.map((href) => (
            <span key={href} className="inline-flex max-w-56 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs">
              <Link2 size={13} aria-hidden className="shrink-0 text-muted" />
              <span className="truncate">{href}</span>
              {!busy && (
                <button type="button" aria-label={`Quitar ${href}`} className="text-muted hover:text-danger" onClick={() => setLinks((p) => p.filter((x) => x !== href))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {uploading && (
        <div
          role="progressbar"
          aria-label="Subida"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="meter mx-3 mb-3 h-2"
        >
          <div className="meter-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs text-danger">
          <span>{error}</span>
          {!uploading && !empty && (
            <Button size="sm" variant="secondary" onClick={() => void send()}>
              Reintentar
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
