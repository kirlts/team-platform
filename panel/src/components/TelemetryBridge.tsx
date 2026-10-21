import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { useEventsStore } from '@/lib/events'
import { useMe } from '@/lib/queries'
import { screenOf, telemetry } from '@/lib/telemetry'

/**
 * Connects the panel's own events to interface telemetry (UD-091): the owner's switch, the change of screen and the
 * moment the analysis of a send reaches the screen. It draws nothing.
 */
export function TelemetryBridge() {
  const location = useLocation()
  const ui = useMe().data?.ui_telemetry
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

  useEffect(() => events.onDone(() => telemetry.analysisVisible()), [events])
  return null
}
