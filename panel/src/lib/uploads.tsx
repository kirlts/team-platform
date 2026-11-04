import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import type { SendDraft } from '@/components/ComposeBar'
import { useErrorText, useT } from '@/i18n'
import { afterColon } from '@/lib/format'
import { useNotices } from '@/lib/notices'
import { noteLostFiles, saveDraftText } from '@/lib/session'
import { invalidateRoots, isTeamApiError } from '@team-platform/client'
import { useMe, useTeamClient } from '@team-platform/client/react'

/** One send that is going up to the server: what was sent, how far it is and why it failed, if it did. */
export interface Upload {
  key: string
  draft: SendDraft
  at: string
  progress: number
  error?: string
  /** The id the server gave the input once it answered: from then on the upload and that input are ONE send. */
  landed?: string
}

interface UploadsApi {
  uploads: readonly Upload[]
  /** Starts the upload of a send and returns the key the panel gave it. */
  start: (draft: SendDraft) => string
  /** Tries a failed upload again. */
  retry: (key: string) => void
  /** Drops an upload from the list (the person discarded it). */
  discard: (key: string) => void
  /** The input each upload became, by the key the panel gave it. */
  landedAs: MutableRefObject<Map<string, string>>
  /** True while a screen is showing the failure of an upload in its own place (Inicio with the drawer open): then no notice repeats it. */
  watching: MutableRefObject<boolean>
}

const UploadsContext = createContext<UploadsApi | null>(null)

/**
 * The uploads of the sends live above the screens (TP-05). They used to be state of Inicio: with the send going up, a link of the sidebar unmounted
 * Inicio, and an upload that then failed had no row to show it and no text to retry — the text and the files existed only in that state. Under the
 * shell the upload goes on, fails or lands whichever screen is open, and the failed one stays in the list until Inicio shows it (with its Reintentar)
 * and the bell says it from any screen.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const queryClient = useQueryClient()
  const team = useTeamClient()
  const me = useMe().data
  const [uploads, setUploads] = useState<Upload[]>([])
  const landedAs = useRef(new Map<string, string>())
  const watching = useRef(false)
  // The callbacks of an upload outlive the render that made them: what they read is read from here, at the moment they need it.
  const latest = useRef({ t, errorText, notices, meId: me?.id })
  latest.current = { t, errorText, notices, meId: me?.id }

  const upload = useCallback(
    async (key: string, draft: SendDraft) => {
      setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: undefined, progress: 0 } : u)))
      try {
        const created = await team.inputs.upload({ text: draft.text, files: draft.files, links: draft.links, asMemberId: draft.asMemberId, recipientIds: draft.recipientIds }, (progress) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, progress } : u))))
        // The upload learns which input it became: the tray draws that send once, as the upload until the server's list has the input and as the input from then on
        // (the list can bring it before the upload leaves, and both were drawn for a moment: two options for one send).
        landedAs.current.set(key, created.input_id)
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, landed: created.input_id } : u)))
        // The server's list first, then the upload leaves: the send passes from one to the other without a moment in which it is neither.
        await invalidateRoots(queryClient, ['inputs'])
        setUploads((list) => list.filter((u) => u.key !== key))
      } catch (err) {
        const now = latest.current
        // The session ended under the page: the entry replaces the panel and the failed row goes with it, so the text goes back to the bar's storage and comes back after signing in.
        if (isTeamApiError(err) && err.status === 401) {
          saveDraftText(draft.text, now.meId)
          noteLostFiles(draft.files.length)
        }
        const reason = now.errorText(err)
        setUploads((list) => list.map((u) => (u.key === key ? { ...u, error: reason } : u)))
        // With the drawer of Inicio open the failed send says so in its own pane, with Reintentar; anywhere else the notice carries the same way out.
        if (!watching.current) now.notices.show({ tone: 'danger', text: now.t('compose.sendFailed', { reason: afterColon(reason) }), action: { label: now.t('common.retry'), run: () => void upload(key, draft) } })
      }
    },
    [queryClient, team],
  )

  const start = useCallback(
    (draft: SendDraft) => {
      const key = crypto.randomUUID()
      setUploads((list) => [...list, { key, draft, at: new Date().toISOString(), progress: 0 }])
      void upload(key, draft)
      return key
    },
    [upload],
  )
  const retry = useCallback(
    (key: string) => {
      const found = uploadsRef.current.find((u) => u.key === key)
      if (found) void upload(key, found.draft)
    },
    [upload],
  )
  const uploadsRef = useRef<readonly Upload[]>(uploads)
  uploadsRef.current = uploads
  const discard = useCallback((key: string) => setUploads((list) => list.filter((u) => u.key !== key)), [])

  const api = useMemo(() => ({ uploads, start, retry, discard, landedAs, watching }), [uploads, start, retry, discard])
  return <UploadsContext.Provider value={api}>{children}</UploadsContext.Provider>
}

/** Outside a provider (a test of one component) there are no uploads and nothing starts. */
const NONE: UploadsApi = { uploads: [], start: () => '', retry: () => undefined, discard: () => undefined, landedAs: { current: new Map() }, watching: { current: false } }

export function useUploads(): UploadsApi {
  return useContext(UploadsContext) ?? NONE
}
