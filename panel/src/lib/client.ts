// The panel's instance of the contract client (@team-platform/client): same origin, session cookie, the `/api` prefix the
// server wrote into index.html (src/lib/base.ts) and interface telemetry (UD-091) counting each call.
import { createTeamClient } from '@team-platform/client'
import { API_BASE } from '@/lib/base'
import { noteStatus } from '@/lib/session'
import { telemetry } from '@/lib/telemetry'

const noop = () => undefined

export const client = createTeamClient({
  apiPrefix: API_BASE,
  requestMarker: 'panel',
  credentials: 'include',
  // The telemetry's own send is not counted: it would be counting itself. Each answer is also looked at for the end of the session (src/lib/session.ts).
  instrument: (method, path) => {
    const counted = path === '/telemetry/ui' ? noop : telemetry.request(method, path)
    return (result) => {
      counted(result)
      noteStatus(path, result.status, method)
    }
  },
})
