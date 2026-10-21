import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { canRecord, startRecording, type Recording } from './recorder'

export interface LocalFile {
  key: string
  file: File
  url: string
}

/** Why a media action failed; the component turns it into a catalog string. */
export type MediaProblem = 'record' | 'microphone' | 'link'

/**
 * The media a person is about to send with a text, in a message or in a reply: files from the clip,
 * dropped or pasted, the photo from the camera, a recorded audio and links. One place keeps the
 * object URLs and the recorder, so the message bar and the reply form behave the same.
 */
export function useMediaDraft() {
  const [locals, setLocals] = useState<LocalFile[]>([])
  const [links, setLinks] = useState<string[]>([])
  const [recording, setRecording] = useState<{ seconds: number } | null>(null)
  const [problem, setProblem] = useState<MediaProblem | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const recorder = useRef<Recording | null>(null)
  const localsRef = useRef<LocalFile[]>([])
  localsRef.current = locals

  useEffect(() => () => localsRef.current.forEach((l) => URL.revokeObjectURL(l.url)), [])

  useEffect(() => {
    if (!recording) return
    const tick = setInterval(() => setRecording((r) => (r ? { seconds: r.seconds + 1 } : r)), 1000)
    return () => clearInterval(tick)
  }, [recording !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return
    setLocals((prev) => [...prev, ...files.map((file) => ({ key: `${file.name}-${file.size}-${crypto.randomUUID()}`, file, url: URL.createObjectURL(file) }))])
  }, [])

  const removeLocal = useCallback((key: string) => {
    setLocals((prev) => {
      const gone = prev.find((l) => l.key === key)
      if (gone) URL.revokeObjectURL(gone.url)
      return prev.filter((l) => l.key !== key)
    })
  }, [])

  const addLink = useCallback((raw: string): boolean => {
    try {
      const url = new URL(raw.trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
      setLinks((prev) => (prev.includes(url.href) ? prev : [...prev, url.href]))
      setProblem(null)
      return true
    } catch {
      setProblem('link')
      return false
    }
  }, [])

  const removeLink = useCallback((href: string) => setLinks((prev) => prev.filter((x) => x !== href)), [])

  const toggleRecording = useCallback(async () => {
    setProblem(null)
    if (recording && recorder.current) {
      const rec = recorder.current
      recorder.current = null
      setRecording(null)
      try {
        addFiles([await rec.stop()])
      } catch {
        setProblem('record')
      }
      return
    }
    try {
      recorder.current = await startRecording()
      setRecording({ seconds: 0 })
    } catch {
      setProblem('microphone')
    }
  }, [recording, addFiles])

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData.files)
      if (files.length > 0) {
        e.preventDefault()
        addFiles(files)
      }
    },
    [addFiles],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      addFiles(Array.from(e.dataTransfer.files))
    },
    [addFiles],
  )

  /** Empties the draft after a send; the object URLs are released. */
  const clear = useCallback(() => {
    localsRef.current.forEach((l) => URL.revokeObjectURL(l.url))
    setLocals([])
    setLinks([])
    setProblem(null)
    setLinkOpen(false)
  }, [])

  return {
    locals,
    links,
    recording,
    problem,
    setProblem,
    linkOpen,
    setLinkOpen,
    micAvailable: canRecord(),
    addFiles,
    removeLocal,
    addLink,
    removeLink,
    toggleRecording,
    onPaste,
    onDrop,
    clear,
    empty: locals.length === 0 && links.length === 0,
  }
}

export type MediaDraft = ReturnType<typeof useMediaDraft>
