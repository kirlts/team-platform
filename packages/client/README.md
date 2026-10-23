# @team-platform/client

Cliente del contrato de Team Platform (`GET /api/openapi.json`). Contiene lo que el panel hace al llamar a la API. Funciones tipadas por operación, claves de caché, invalidaciones, versión al editar (reintento ante `edit_conflict`), multipart, subida con progreso, deshacer, flujo de eventos y el error `TeamApiError`. Otra interfaz lo usa en lugar de copiar esa lógica (UD-010, UD-254).

El núcleo no depende de React ni de ninguna librería. `@team-platform/client/react` agrega los hooks de TanStack Query.

| Entrada | Contenido | Requiere |
|---|---|---|
| `@team-platform/client` | `createTeamClient`, `TeamApiError`, `queryKeys`, `INVALIDATE`, `createQueries`, `sendVersioned`, `createUndoCore`, `EventsStore`, filtros de mensajes, tipos | Nada |
| `@team-platform/client/react` | `TeamClientProvider`, `EventsProvider` y un hook por lectura y por cambio (`useMe`, `usePatchMessage`…) | `react` y `@tanstack/react-query` |
| `@team-platform/client/openapi.json` | El contrato con el que se generaron los tipos | Nada |

## Uso mínimo

Una página en otro framework, sin React:

```js
import { createTeamClient, isEditConflict, TeamApiError } from '@team-platform/client'

const team = createTeamClient({
  baseUrl: 'https://team.example.org', // vacío si la página y la API comparten origen
  apiPrefix: '/api',                   // API_PREFIX del servidor
  cookieMode: 'cross-origin',          // COOKIE_MODE del servidor
})

await team.auth.login({ email, password })
const mensajes = await team.messages.list({ query: { filters: [], q: '' }, meId: (await team.me.get()).id })

try {
  await team.messages.patch(id, { title: 'Nuevo título' }) // lleva `version`; ante edit_conflict lee de nuevo y reintenta una vez
} catch (err) {
  if (err instanceof TeamApiError) console.log(err.status, err.code, err.details)
}
```

Con TanStack Query de cualquier framework, las claves y las lecturas salen del cliente y la política de invalidación de una tabla:

```js
import { createQueries, invalidate } from '@team-platform/client'

const q = createQueries(team)
const areas = useQuery(q.areas())                        // { queryKey: ['areas'], queryFn }
await team.areas.delete(id)
await invalidate(queryClient, 'deleteArea')              // areas, templates, messages, message
```

Con React:

```jsx
import { TeamClientProvider, useMessages, usePatchMessage } from '@team-platform/client/react'

<QueryClientProvider client={queryClient}>
  <TeamClientProvider client={team}><App /></TeamClientProvider>
</QueryClientProvider>
```

## Opciones de `createTeamClient`

| Opción | Valor por omisión | Efecto |
|---|---|---|
| `baseUrl` | `''` | Origen de la API |
| `apiPrefix` | `/api` | Prefijo de la API bajo `baseUrl` |
| `cookieMode` | `same-origin` | `cross-origin` envía la cookie con `credentials: 'include'` |
| `credentials` | según `cookieMode` | Fuerza `fetch`, la subida y el flujo de eventos |
| `requestMarker` | `client` | Valor de `X-Team-Request`, que el servidor exige en toda petición no segura con sesión |
| `headers` | ninguno | Objeto o función; para `Authorization: Bearer` de un anfitrión con JWT |
| `fetch` | `globalThis.fetch` | Otro `fetch` (pruebas, Node con cookies) |
| `instrument` | ninguno | `(método, ruta) => (resultado) => void`; la telemetría de la interfaz cuenta las llamadas con él |
| `eventSource` | `EventSource` global | Fábrica del flujo de eventos en un entorno sin `EventSource` |
| `xhr` | `XMLHttpRequest` global | Fábrica de la subida con progreso |

## Qué hace el cliente por la interfaz

| Tema | Comportamiento |
|---|---|
| Errores | Todo cuerpo no 2xx pasa a `TeamApiError { status, code, message, details }`. Sin cuerpo, `code` es `http_<estado>`. `status` 0 con código `network` es una falla antes de la respuesta. `REQUEST_ERROR_CODES` lista los códigos del servidor, generada de su código |
| Versión al editar | `messages.patch`, `messages.addAttachments` y `replies.edit` envían la versión del caché (`Versioning.cached`); sin ella leen la actual. Ante 409 `edit_conflict` leen de nuevo, guardan lo leído (`Versioning.remember`) y reenvían una vez |
| Multipart | `inputs.create`, `inputs.upload` (con progreso), `replies.create` con archivos o enlaces, `messages.addAttachments`, `project.save({ file })`. `asMemberId` envía en nombre de otro miembro (UD-255) |
| Deshacer | `createUndoCore` con `deletion` y `edit`; el inverso de cada borrado es su `restore` |
| Eventos | `team.events.connect(store)` alimenta un `EventsStore`; `watchEvents` además invalida los listados |
| Archivos | `team.attachmentUrl(id)`, `replyAttachmentUrl(id)`, `transcriptUrl(id)` |

## Tipos y contrato

`openapi.json` es el contrato que sirve el servidor, generado con la aplicación de pruebas. `src/generated/schema.ts` lo traduce con `openapi-typescript` 7.13.0 (MIT). `src/routes.ts` lista las operaciones que el cliente llama. Una ruta o un método ausente del contrato no compila. `test/contract.test.ts` falla si una operación del contrato no está llamada ni declarada en `NOT_IN_CLIENT`.

```sh
npm run gen:client           # reescribe openapi.json, schema.ts y error-codes.ts desde el servidor
npm run gen:client:check     # sale con 1 si alguno difiere
```

Desde la raíz del repositorio: `npm run gen:client`. La prueba `src/client-contract.test.js` de la raíz falla si el servidor cambió y los archivos no se regeneraron.

## Pruebas

```sh
npm install        # en packages/client
npm test           # vitest: núcleo, API real por HTTP, hooks con jsdom
npm run build      # dist/ con declaraciones; lo hace también `npm pack`
```

Las pruebas levantan la API del repositorio en proceso, en un puerto de 8750 a 8759.

## Cómo lo consume el panel

El panel compila el cliente desde sus fuentes con un alias de Vite y de TypeScript (`panel/vite.config.ts`, `panel/tsconfig.json`), sin pasar por `dist/`. Su instancia está en `panel/src/lib/client.ts`.
