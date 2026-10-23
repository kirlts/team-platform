import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useEventsStore, useMe } from '@team-platform/client/react'
import { screenOf, telemetry } from '@/lib/telemetry'

/**
 * Connects the panel's own events to interface telemetry (UD-091): the owner's switch, the change of screen and the
 * moment the analysis of a send reaches the screen. It draws nothing.
 */
export function TelemetryBridge() {
  const location = useLocation()
  const me = useMe().data
  const ui = me?.ui_telemetry
  const events = useEventsStore()
  const rendered = useRef<string | null>(null)
  if (rendered.current !== location.pathname) {
    rendered.current = location.pathname
    telemetry.routeRenderStarted() // while rendering: the change of screen began now
  }

  useEffect(() => {
    telemetry.configure(ui?.enabled ?? false, ui?.max_events ?? 1)
  }, [ui?.enabled, ui?.max_events])

  useEffect(() => {
    telemetry.enterScreen(screenOf(location.pathname))
  }, [location.pathname, ui?.enabled])

  useEffect(
    () => events.onDone((e) => {
      telemetry.analysisVisible()
      // The job ended by publishing (UD-070): the send is done, whether or not the own-message notice reaches this page.
      if (e.input_status === 'published') telemetry.ownMessagePublished()
    }),
    [events],
  )
  useEffect(
    () => events.onNewMessage((e) => {
      if (me?.id && e.author_id === me.id) telemetry.ownMessagePublished()
    }),
    [events, me?.id],
  )
  return null
}
