# Soft-locks de la interfaz de Team Platform

Alcance: `/home/kirlts/team-platform/panel/src` (React 19, React Router, radix-ui) y `packages/client/src`. Sólo lectura.

Método: lectura del enrutador y de cada pantalla, modal y componente de acción; cada hallazgo se intentó refutar buscando el manejador, la URL o la compensación que lo cubriera. Las pruebas de render no se corrieron: el gancho de la sesión rechaza `vitest` en este equipo. Todo lo de abajo está confirmado por lectura de código, con archivo y línea; lo que además pedía ejecutarse queda en «Sin confirmar».

Mapa de navegación: `panel/src/App.tsx:129-141`. Rutas `/`, `/messages`, `/messages/:id`, `/areas/:areaId?`, `/connections/:kind?`, `/team`, `/settings`, `*`. El `Shell` (cabecera, barra lateral o menú en teléfono, `NoticeHost`) envuelve todas, de modo que ninguna pantalla queda sin salida de navegación (clases 1 y 5 sin hallazgos de peso). `NotFound`, `AreaNotFound`, el 404 de un mensaje y `Areas` para un rol sin permiso traen su propio camino de vuelta. Lo que sí hay son acciones sin camino de vuelta (clase 3), estado atascado o perdido (clase 4), estado sólo en memoria (clase 2) y detalles de teclado (clase 6).

## 1. Tabla resumen

| Id | Clase | Pantalla / ruta | Severidad | Arreglo en una línea |
|---|---|---|---|---|
| TP-01 | 3 | Inicio (envío abierto), Mensajes publicados, Configuración > Cola: «Borrar» y «Borrar todo» de un envío | alta | Borrado diferido con Deshacer (retener el borrado real unos minutos) o confirmación de un paso para «Borrar todo» |
| TP-02 | 3 | Equipo > Acciones > «Eliminar» miembro | alta | Eliminación diferida y restaurable, o confirmación con el nombre |
| TP-03 | 3 | Configuración > Datos: «Vaciar contenido» y «Vaciar todo» | alta | Confirmación escrita (nombre del proyecto) para «Todo»; «Contenido» con ventana de restauración |
| TP-04 | 4 | Inicio (barra «Nuevo mensaje») y Mensaje > respuesta | alta | Persistir el borrador (sessionStorage por mensaje o por barra) y avisar al salir con texto sin enviar |
| TP-05 | 4 | Inicio, envío que falla después de salir de Inicio | alta | Subir el estado `uploads` a un contexto del `Shell`, o abortar la subida al desmontar y avisar |
| TP-06 | 4 | Inicio > propuesta del análisis: «Enviar N» | media | Limpiar `missing[i]` al desmontarse la fila, o derivar `missingTotal` de las filas vivas |
| TP-07 | 3 | Inicio > propuesta: «Descartar» y «Cancelar» | media | Lista «Descartados» en Inicio (el endpoint `restore` ya existe) |
| TP-08 | 3 | Mensaje > hilo: papelera de una respuesta | media | Filtro «Respuestas borradas» o aviso con Deshacer de 8 s además de la fila |
| TP-09 | 3 | Mensaje > hilo: ✕ de un adjunto de la propia respuesta | media | Pasar por la pila de Deshacer, como el adjunto de un mensaje |
| TP-10 | 3 | Configuración > Proveedores: «Retirar clave» y «Eliminar» | media | Confirmación de un paso que nombra el proveedor (la clave no se puede recuperar) |
| TP-11 | 3 | Configuración > Encuadre del análisis: «Restablecer» | media | Registrar el reset en la pila de Deshacer de la pantalla |
| TP-12 | 4 | Mensaje > Deshacer / Ctrl+Z al pasar de un mensaje a otro | media | `key={id}` en `MessageDetail` o `undo.clear()` al cambiar de `id` |
| TP-13 | 4 | Inicio y Mensaje: grabación de audio en curso al salir de la pantalla | media | Cancelar el `Recording` en el cleanup de `useMediaDraft` |
| TP-14 | 2 | Todas las listas, ventanas y el menú del teléfono | media | Página de la lista en la URL; cerrar una ventana con el atrás del navegador |
| TP-15 | 6 | Ventanas con campo de texto (`FormDialog`, Reenviar, plantilla nueva) | baja | Escape en un campo de una ventana sin edición propia cierra la ventana |
| TP-16 | 4 | Edición en el lugar (`EditableText`) en pantalla táctil | baja | Botón «Cancelar» visible mientras el campo está abierto con error |
| TP-17 | 4 | Borrar mensaje, borrar en lote, áreas, Deshacer | baja | Un solo manejador de errores de mutación (`MutationCache.onError`) que muestre el aviso |
| TP-18 | 2 | Mensajes y vista de área: filtros y estados | baja | Decidirlo: `replace` sólo para la búsqueda, `push` para filtros y estados |
| TP-19 | 4 | Ventanas de formulario: clic fuera pierde lo escrito | baja | Pedir confirmación si hay campos modificados, o bloquear `onInteractOutside` con cambios |

Totales: 5 altas, 9 medias, 5 bajas.

## 2. Detalle

### TP-01 · Borrar un envío no tiene confirmación ni camino de vuelta (clase 3, alta)

Archivos: `panel/src/components/DeleteSend.tsx:22-41`; se dibuja en `AnalysisPanel.tsx:123` (envío en análisis o con propuesta), `PublishedPane.tsx:73` (envío publicado) y `QueuePanel.tsx:178` (Configuración > Cola, cualquier envío de cualquier persona). Servidor: `src/domain/inputs.js:405-437` (`deleteInput`).

Pasos: abrir Inicio con un envío en el cajón, pulsar «Borrar» (o «Borrar todo» si ya publicó mensajes). El `onClick` llama `run()` sin diálogo (`DeleteSend.tsx:36,40`). El servidor ejecuta `DELETE FROM inputs`, `DELETE FROM attachments`, y con `with_messages=true` `DELETE FROM messages` con sus respuestas, y libera los archivos del volumen. El comentario del servidor lo dice: «Borrado real, sin restauración». El aviso sólo informa («Envío borrado»), no ofrece Deshacer (`DeleteSend.tsx:34`). «Borrar» y «Borrar todo» están contiguos, mismo tamaño y mismo color, y el segundo borra los mensajes publicados y sus hilos.

Refutación intentada: ¿hay Deshacer? No: `run` no usa la pila ni pasa `action` al aviso. ¿Hay `restore`? Existe `POST /inputs/:id/restore` pero sólo para cancelados (`useRestoreInput`), no para borrados. `docs/CAPACIDADES-1.0.md:53` ya lo declara: «Borrar envío borra sin Deshacer», estado «rechazada». El diseño UD-253 («sin confirmaciones») es deliberado para borrados con Deshacer; éste es la excepción que no lo tiene.

Arreglo: hacer el borrado diferido (el servidor marca `deleted_at` y un barrido real lo elimina pasado un plazo declarado) y ofrecer Deshacer en el aviso, igual que mensajes, áreas y plantillas. Mientras tanto, «Borrar todo» detrás de una confirmación de un paso. Prohibición: ver 3.A.

### TP-02 · Eliminar un miembro es inmediato y no se restaura (clase 3, alta)

Archivos: `panel/src/pages/Team.tsx:121-131` (`deleteMember`), `:245-254` (ítem del menú «Eliminar»). Servidor: UD-292 (`CAPACIDADES-1.0.md:53`: «eliminar un miembro no se restaura»).

Pasos: Equipo > «Acciones» de una fila > «Eliminar». `onSelect` llama `deleteMember` sin confirmación. El ítem está dos filas debajo de «Desactivar», separado sólo por una línea, en un menú que se abre con un clic. La cuenta queda con el autor «Miembro eliminado»; la persona pierde su acceso y el equipo no tiene botón para devolverlo (se debe crear de nuevo, con otra identidad y sin su historial asociado).

Refutación: ¿hay Deshacer? El aviso sólo cuenta cuánto se conserva (`Team.tsx:125-126`); no lleva acción. ¿Pasa por `undo.run`? No (a diferencia de rol, nombre y activo, que sí). «Desactivar» existe y es reversible, pero el menú los presenta como hermanos.

Arreglo: eliminación diferida con Deshacer, o confirmación que nombra a la persona. Si el producto mantiene «sin confirmaciones», el ítem debe pedir un segundo clic dentro del mismo menú («Confirmar eliminar a Ana»).

### TP-03 · «Vaciar contenido» y «Vaciar todo» sin confirmación ni retorno (clase 3, alta)

Archivo: `panel/src/components/DataReset.tsx:50,61` (`reset.mutate('content' | 'everything')`). Servidor: `src/domain/reset.js:53`, `src/api/routes/ops.js:183`.

Pasos: Configuración (Editor) > Datos > «Vaciar» en cualquiera de las dos filas. Un clic borra envíos, mensajes, respuestas y adjuntos de todo el equipo; con «Todo» además quita a los demás miembros y restablece las áreas (`keepMemberId` conserva sólo a quien pulsa). Los dos botones son `variant="danger"`, en filas consecutivas de 3 filas iguales (la tercera es «Ejemplos»). El aviso informa cantidades. No hay Deshacer (el propio doc del componente: «Nothing comes back»).

Refutación: la fila trae un texto que describe qué borra (`hint.data.content`, `hint.data.everything`), pero es un texto, no una puerta. El borde de acceso (Editor) reduce la exposición, no la quita: el único dato que protege es el del equipo entero.

Arreglo: «Todo» exige escribir el nombre del proyecto en la propia fila (campo en el lugar, no ventana); «Contenido» con una ventana de restauración (mismo diferido de TP-01). Prohibición 3.A.

### TP-04 · Los borradores sólo viven en memoria (clase 4, alta)

Archivos: `panel/src/components/ComposeBar.tsx:60-79` (`text`, `draft`, `recipients`, `sendAs` son `useState`), `ReplyForm.tsx:20-23` (`body`, `draft`, `picked`), `lib/useMediaDraft.ts:19-24` (`locals`, `links`). Una búsqueda de `beforeunload`, `useBlocker`, `localStorage` y `sessionStorage` en `panel/src` devuelve sólo tema, barra lateral y cierre de sesión.

Pasos: escribir (o dictar y adjuntar archivos) en «Nuevo mensaje» de Inicio, o una respuesta larga en un mensaje; pulsar un enlace de la barra lateral, de la cabecera, la campana o una fila de la lista; o pulsar Atrás. El componente se desmonta y el texto, los archivos adjuntos y los destinatarios desaparecen sin aviso. También ocurre al volver a la entrada por una sesión vencida (TP-sin-confirmar 1).

Refutación: ¿lo evita el `Shell`? El `Outlet` desmonta la ruta. ¿Se guarda por otra vía? No. La confirmación «Enviar» sí persiste en el servidor, pero el borrador anterior al envío no.

Arreglo: guardar el borrador en `sessionStorage` con clave por barra / por mensaje (texto, destinatarios, enviar como; los `File` no se serializan, así que ante archivos se avisa al salir) y mostrarlo al volver; `useBlocker` (o `beforeunload`) cuando hay texto o archivos sin enviar. Prohibición 3.B.

### TP-05 · Un envío cuya subida falla después de salir de Inicio se pierde en silencio (clase 4, alta)

Archivos: `panel/src/pages/Home.tsx:73` (`uploads` en estado de `Home`), `:184-203` (`upload`), `:81-82` (`drawerRef`), `:200` (el aviso de error sólo sale `if (!drawerRef.current)`).

Pasos: enviar un mensaje con un archivo grande; con el cajón abierto (se abre solo al enviar, `Home.tsx:214`), navegar a otra pantalla mientras sube; la red cae o el servidor responde 5xx. `Home` ya está desmontado: `setUploads` no tiene efecto, `drawerRef.current` conserva `true` del último render y el aviso de error no se muestra; el texto y los archivos sólo vivían en `uploads` y se pierden. Con el cajón plegado el aviso sí sale, pero dura 8 s (`notices.tsx:NOTICE_ACTION_MS`) y su «Reintentar» reintenta una subida que ya no tiene fila visible.

Refutación: la propia `upload()` comenta «A failure keeps the draft in its row so the text is never lost»; eso vale mientras `Home` esté montado. No hay `AbortController` ni estado elevado.

Arreglo: elevar `uploads` y su ciclo al `Shell` (o a un contexto bajo `EventsProvider`) para que sobrevivan a la navegación y la campana/estado de la cabecera los muestre; o cancelar la subida en el cleanup con aviso inmediato. Prohibición 3.B.

### TP-06 · «Enviar N» queda deshabilitado para siempre tras quitar un mensaje con campos obligatorios vacíos (clase 4, media)

Archivos: `panel/src/components/AnalysisPanel.tsx:296` (`missing: Record<number, string[]>`), `:363` (`onMissing` sólo escribe), `:455` (`useEffect(() => onMissing(...), [missingNames])`, sin función de limpieza), `:297` (`missingTotal` suma todas las entradas), `:415` (`disabled={... || missingTotal > 0}`). Las filas usan `key={i}` (`:353`).

Pasos: la propuesta trae 2 mensajes; el segundo (índice 1) tiene un campo obligatorio de plantilla sin llenar: `missing[1] = ['campo']`, aparece «Falta 1» y «Enviar» se apaga. El usuario pulsa «Quitar» en ese mensaje (el botón existe cuando hay más de uno, `:501`). La fila 1 se desmonta pero `missing[1]` no se borra (el efecto no devuelve limpieza y no hay otro punto que lo haga): `missingTotal` sigue en 1, «Enviar 1» permanece apagado y «Faltan 1» sigue visible sin nada que llenar. Con la variante de quitar el mensaje 0 cuando el 1 tenía faltantes, el total queda en 2 aunque el hecho real sea 1, y arreglar el campo restante no lo baja a 0.

Salida actual: «Deshacer» (el mensaje vuelve y se puede llenar), «Volver a analizar», «Descartar», o crear un mensaje nuevo desde «Sin acción» en ese mismo índice (el efecto de montaje recalcula). Ninguna es evidente.

Refutación: busqué otro lugar que reinicie `missing` (cambio de input, `key` del editor): `ProposalEditor` va con `key={input.id}`, no cambia al quitar. No ejecuté la prueba (ver preámbulo); la secuencia sale directamente del código citado.

Arreglo: derivar `missingTotal` sólo de los índices vivos (`Object.entries(missing).filter(([i]) => Number(i) < count)`) y limpiar en el cleanup del efecto (`return () => onMissing([])`); mejor, usar `key` por identidad del mensaje y no por posición. Prohibición: `un-boton-apagado-dice-que-falta-algo-que-existe.test.tsx`: quitar la fila con faltantes deja el botón habilitado.

### TP-07 · Descartar un envío sólo se deshace en 8 segundos o mientras Inicio siga montado (clase 3, media)

Archivos: `AnalysisPanel.tsx:40-58` (`useDiscard`), `:161` y `:379` («Descartar» rojo junto a «Enviar»), `Home.tsx:293-310` (`discarded` en estado de `Home`). Lista: `useTray` (`hooks.ts:110`) no devuelve cancelados; no existe pantalla «Descartados» en el panel actual (búsqueda de `Descartad` y `useRestoreInput` en `panel/src`: sólo el aviso y el marcador de Inicio).

Pasos: abrir un envío con propuesta, pulsar «Descartar» (un clic; el original que escribió o dictó la persona). Deshacer aparece como aviso de 8 s o como marcador en el cajón mientras Inicio siga montado. Si pasan 8 s con el cajón plegado, o se navega a otra pantalla (el marcador es estado local), el envío ya no está en ninguna lista de la interfaz. Queda `restore` en el servidor, sin pantalla que lo llame. El CHANGELOG (`docs/CHANGELOG.md:154`) anuncia «La lista «Descartados» de Inicio (UD-253)»; en el panel de `HEAD` no está.

Refutación: ¿el aviso lleva la acción? Sí, pero expira; y el contenido (texto, audio, fotos) es del autor, no regenerable.

Arreglo: la lista «Descartados» anunciada, con Restaurar. Prohibición: toda acción destructiva con Deshacer temporal tiene además una lista de restauración (3.A).

### TP-08 · Una respuesta borrada no se puede recuperar desde la interfaz después de salir del mensaje (clase 3, media)

Archivos: `panel/src/components/ReplyThread.tsx:56` (`removed` en estado), `:87-92` (`remove`: `undo.run` sin `announce`), `:57` (`showRemoved`), `:216` (la papelera). `useRestoreReply` sólo se importa aquí (`grep` en `panel/src`). La lista «Borrados» de Mensajes (`filter.deleted`) trae mensajes, no respuestas.

Pasos: abrir un mensaje con respuestas; pulsar la papelera de 14 px de una respuesta; no hay aviso (sin `announce`), sólo la fila con Deshacer, que desaparece al hacer cualquier otra operación del historial (`showRemoved` exige `undo.undoCount === removed.mark`) o al salir del mensaje (`useUndoStack` vive en `MessageDetail`). La respuesta (con texto o audio) queda soft-deleted en el servidor, sin ruta de interfaz para restaurarla.

Arreglo: sumar un aviso de 8 s con Deshacer (`announce`), y un filtro o sección «Respuestas borradas» por mensaje que llame `useRestoreReply`.

### TP-09 · Quitar un adjunto de la propia respuesta no se deshace (clase 3, media)

Archivo: `panel/src/components/ReplyTools.tsx:34-40` (`edit.mutate({ remove_attachment_ids })`, sin `undo.run`). Servidor: `src/api/routes/messages.js:200-207` y `src/domain` (`onRemoved` entrega los `sha256` para liberar el volumen).

Pasos: en una respuesta propia con foto o audio, pulsar el ✕ del adjunto. Se borra la fila y el archivo del volumen. El adjunto de un mensaje, en cambio, sí pasa por la pila (`MessageDetail.tsx:158`, `removeAttachment`).

Arreglo: el archivo ya se libera al quitar, así que una reversa en la pila no tiene qué restaurar. Diferir la liberación del archivo del volumen mientras la respuesta pueda deshacerse y pasar el ✕ por `undo.run`, como el adjunto de un mensaje.

### TP-10 · «Retirar clave» y «Eliminar» proveedor son de un clic y la clave no vuelve (clase 3, media)

Archivos: `panel/src/components/ProviderConnections.tsx:130-137`, `ProviderRemoval.tsx:21-33` (`useProviderRemoval`: «happens with one click (UD-253)»).

Pasos: Configuración > Proveedores > fila de un proveedor con clave > «Retirar clave» (botón rojo junto a «Reemplazar clave»). La clave se elimina del almacén; sólo quien la tenga puede volver a cargarla. El servidor rechaza con `provider_in_use` si hay funciones que dependen del proveedor, lo que cubre el caso peor (el análisis se cae) pero no el de un proveedor configurado y sin uso. Para un proveedor personalizado, «Eliminar» quita la fila entera.

Arreglo: confirmación de un paso que nombra el proveedor y recuerda que la clave no se recupera.

### TP-11 · «Restablecer» del encuadre sobrescribe el texto del Editor sin Deshacer (clase 3, media)

Archivo: `panel/src/components/InstallationSettings.tsx:133-139` (`onClick={() => void save.mutateAsync({ [lang]: '' })}`; en cambio la edición del mismo campo sí usa `undo.run`, `:51-63`).

Pasos: Configuración > Encuadre del análisis (Editor) > «Restablecer» sobre un idioma con texto personalizado (`item.custom`). El texto del Editor se reemplaza por el valor por omisión; la pila de Deshacer de la pantalla no lo tiene.

Arreglo: `undo.run({ label, redo: reset, undo: () => save({ [lang]: before }) })`. Además `void ...mutateAsync` sin `catch` deja un rechazo sin atender si falla (TP-17).

### TP-12 · La pila de Deshacer sobrevive al paso de un mensaje a otro (clase 4, media)

Archivos: `panel/src/pages/MessageDetail.tsx:43` (`useUndoStack()` vive en `MessageDetail`, el componente de la ruta), `App.tsx:143` (`<Route path="messages/:id" element={<MessageDetail />} />`, sin `key`), `lib/undo.tsx:93-105` (Ctrl+Z global en `window`). `ReplyThread.tsx:57` ya compensa lo mismo para su fila `removed` (`removed.reply.message_id === message.id`), señal de que el autor sabe que el componente no se remonta.

Pasos: editar el título del mensaje #10; pulsar en la campana el aviso de otro mensaje #11 (o un enlace a otra ficha). React Router conserva la instancia de `MessageDetail` al cambiar sólo el parámetro; la pila sigue con la operación sobre #10. En #11, si la persona es autora del mensaje o de una respuesta, aparecen los botones «Deshacer»/«Rehacer» (`MessageDetail.tsx:189`); Deshacer o Ctrl+Z revierte el título de #10, con el aviso «Deshecho: Título editado», mientras se mira #11.

Refutación: la persistencia depende de que el elemento de ruta no cambie; leí `App.tsx` y no hay `key`. No ejecuté la prueba (ver preámbulo).

Arreglo: `<MessageDetail key={id}>` (envolver en un componente que lea `useParams` y renderice `<Body key={id}>`) o `undo.clear()` en un efecto de `id`. Prohibición: `cada-pila-de-deshacer-es-de-su-pantalla.test.tsx`.

### TP-13 · Salir de la pantalla durante una grabación deja el micrófono abierto (clase 4, media)

Archivos: `panel/src/lib/useMediaDraft.ts:30` (el único cleanup revoca URLs de objeto), `:65-86` (`toggleRecording` guarda el `Recording` en `recorder.current` y nadie lo cancela al desmontar). `MediaDraft.tsx:285` (`RecordAudioButton`, usado por `ReplyTools` y la ficha) sí hace `recorder.current?.cancel()` en el cleanup; el borrador de `ComposeBar` y `ReplyForm` no.

Pasos: en Inicio (o al responder), pulsar el micrófono; sin detener, pulsar un enlace de la barra lateral. `ComposeBar` se desmonta, el `MediaRecorder` y el `MediaStream` de `getUserMedia` siguen vivos (el navegador mantiene el indicador de micrófono) y acumulando `chunks` en memoria hasta recargar la página; no queda ningún botón para detenerlo.

Arreglo: en `useMediaDraft`, `useEffect(() => () => recorder.current?.cancel(), [])`. Prohibición 3.C.

### TP-14 · Estado de interfaz sólo en memoria: «Atrás» saca de la sección o pierde el lugar (clase 2, media)

Evidencia:
- Página de una lista: `FitList.tsx:87-88` (`start` e `historial` en `useState`). Mensajes > página 3 > abrir un mensaje > Atrás: la lista vuelve a la página 1.
- Ventanas: `ui/dialog.tsx` usa `Dialog.Root` controlado por estado local en todos los usos (perfil de miembro `Team.tsx`, galería `MediaGallery.tsx:509-537`, plantilla `AreaTemplates.tsx`, protecciones `AreaGuards.tsx:36`, menú del teléfono `App.tsx:76-80`, `FormDialog`). Con una ventana abierta, el botón Atrás del navegador (y el gesto de volver en teléfono) deja la página en vez de cerrar la ventana, y arrastra el texto sin guardar que hubiera dentro.
- Cajón de envíos de Inicio (`drawerOpen`, `selectedId`), «Borradas» de Áreas y Plantillas (`showDeleted`), hilo expandido (`expanded`), pliegues de Configuración: se pierden al ir a otra pantalla y volver.

Arreglo: la página (`?p=`) en la URL de Mensajes y de la vista de área, como ya lo están los filtros; para ventanas, estado `?v=` o un `useBlocker` que cierre la ventana antes de salir (`history.pushState` al abrir y `popstate` que la cierre). Prohibición 3.D.

### TP-15 · Escape no cierra una ventana mientras el foco está en un campo (clase 6, baja)

Archivos: `panel/src/components/ui/dialog.tsx:42-46` (`onEscapeKeyDown` hace `preventDefault()` si el destino es `textarea, input`), `FormDialog.tsx:98-143` (los campos son `Input`/`Textarea` sin manejador propio de Escape y el primero lleva `autoFocus`), `ForwardMessage.tsx:63-78`, `TemplateEditor.tsx:270-277` (`NewTemplateForm`).

Pasos: abrir «Nueva área» (barra lateral, Áreas), «Agregar miembro», «Cambiar contraseña», «Nueva plantilla» o «Reenviar» (el comentario: «Escape inside a text field cancels that edit only»). El primer campo ya tiene el foco; Escape no hace nada: no hay edición propia que cancelar. Se sale con Tab hasta «Cancelar», con la ✕ o con un clic fuera. El caso con edición propia (`EditableText` dentro de una ventana, como el perfil) sí está bien: el primer Escape cancela la edición y el segundo cierra.

Refutación: radix cierra con Escape cuando el foco no está en un campo; aquí lo detiene la excepción. No hay salida atrapada (Tab alcanza Cancelar), por eso es baja.

Arreglo: la excepción sólo para campos que declaran edición propia (`data-owns-escape`), y para el resto cerrar. Prohibición: `cada-ventana-se-cierra-con-escape.test.tsx` que abre cada `FormDialog` con el foco en su primer campo y pulsa Escape.

### TP-16 · No hay forma táctil de cancelar una edición en el lugar con error (clase 4, baja)

Archivo: `panel/src/components/EditableText.tsx:128-132,138-143` (ante un valor inválido o un guardado fallido, `commit` devuelve el foco al campo con `ref.current?.focus()`), `:195-199` (única vía de cancelar: Escape).

Pasos (teléfono o tableta sin teclado físico): abrir un título, borrarlo, tocar fuera. `validate` responde «Obligatorio», el foco vuelve a la caja y el teclado reaparece. Sin Escape, la persona sólo sale escribiendo un valor válido o navegando a otra pantalla (el clic en un enlace sigue funcionando). También ocurre si el servidor rechaza el guardado (sesión vencida, conflicto).

Arreglo: mostrar un botón «Cancelar» (✕) junto al mensaje de error mientras el campo está abierto.

### TP-17 · Fallos de mutación sin aviso y rechazos sin atender (clase 4, baja)

No hay `onError` global: `panel/src/main.tsx:17-24` crea el `QueryClient` sólo con valores de consultas, sin `MutationCache`. Sin ello, estos manejadores esperan una mutación y no capturan su error: `MessageDetail.tsx:109-112` (`remove`), `MessageList.tsx:36-50`, `MessageCard.tsx:72,88,101`, `Areas.tsx:115,208` y `AreaView.tsx:73`, `NoticeHost.tsx:83` (`void run()` de la acción del aviso), `UndoButtons.tsx:18,21` y `lib/undo.tsx:102` (`void current.undo()`), `AnalysisPanel.tsx:43-58` (`useDiscard`: `catch { return }`), `InstallationSettings.tsx:135-139` (TP-11). En esos casos el botón se rehabilita y no pasa nada visible: la persona no sabe si el borrado, el Deshacer o el Descartar ocurrió.

Arreglo: `new MutationCache({ onError: (err) => notices.show({ tone: 'danger', text: errorText(err) }) })` con un aviso (el contexto existe sólo bajo el `Shell`; basta un puente como `TelemetryBridge`), y `meta: { silent: true }` para los que ya muestran el error en el lugar. Prohibición 3.E.

### TP-18 · Filtros y estados reemplazan la entrada de historial (clase 2, baja)

Archivos: `pages/Messages.tsx:19` y `pages/AreaView.tsx:64` (`setParams(..., { replace: true })`).

Pasos: Mensajes > aplicar tres filtros > Atrás: sale de Mensajes (a la pantalla anterior) en vez de quitar un filtro. Es consistente con el comentario de AreaView («the back button and a link … arrive at the same place»), pero hace que Atrás no recorra el estado de la vista. No atrapa; es una decisión de diseño que conviene declarar. Distinto de TP-14, que habla de estado que no está en la URL.

Arreglo: `replace` sólo mientras se escribe la búsqueda; `push` para filtros y estados.

### TP-19 · Un clic fuera de una ventana de formulario descarta lo escrito (clase 4, baja)

Archivos: `ui/dialog.tsx` (no declara `onInteractOutside`; radix cierra con `pointerdown` fuera), `FormDialog.tsx:36-38` (`{open && <FormBody>}` desmonta y reinicia `values`), `TemplateEditor.tsx:269-271`.

Pasos: «Nueva área» con una descripción de 800 caracteres, clic accidental sobre el fondo: la ventana se cierra y el texto se pierde sin aviso. En los formularios de una línea el costo es bajo; en descripción de área y plantilla nueva es alto.

Arreglo: `onInteractOutside={(e) => dirty && e.preventDefault()}` con el estado de modificación del cuerpo.

## 3. Patrones transversales y prohibición que los cierra

**3.A · Toda acción destructiva tiene camino de vuelta.** Cubre TP-01, 02, 03, 07, 08, 09, 10, 11. Regla: borrar, vaciar, retirar o reemplazar es diferido o confirmado, y lo diferido tiene dos salidas: el aviso de 8 s con Deshacer y una lista de restaurables que sobrevive a la navegación. Prohibiciones de batería: `una-accion-destructiva-no-es-definitiva-sin-deshacer.test.ts` (recorre `DELETE`/`remove`/`reset`/`retire` de `packages/client/src/resources.ts` y exige que cada uno tenga una contraparte `restore` o una confirmación declarada en un registro, `docs/ACCIONES-DESTRUCTIVAS.md`) y `toda-lista-de-borrados-existe.test.tsx` (para cada recurso con `restore` en el cliente, existe un control en el panel que lo invoca).

**3.B · Lo que la persona escribe no vive sólo en `useState`.** Cubre TP-04, 05. Prohibición: `un-borrador-sobrevive-a-salir-de-la-pantalla.browser.test.mjs` (escribe en la barra de envío y en una respuesta, navega y vuelve, y espera el texto) y una detección estática `ningun-formulario-largo-sin-borrador.test.ts` que falle si un `textarea` de componente con más de N líneas posibles no está conectado a `useDraft`.

**3.C · Todo recurso del navegador se libera al desmontar.** Cubre TP-13. Prohibición: `cada-hook-con-getusermedia-cancela-al-desmontar.test.ts` (busca `startRecording(` y exige un `cancel()` en el cleanup del mismo módulo).

**3.D · Lo que ordena la navegación está en la URL o en el historial.** Cubre TP-14, 18. Prohibición: `cada-lista-con-paginas-las-lleva-en-la-url.test.ts` (`FitList` con `onPage` registrado en `searchParams`) y `cada-ventana-se-cierra-con-atras.browser.test.mjs`.

**3.E · Ningún fallo de mutación es mudo.** Cubre TP-17, parte de TP-11 y TP-12. Prohibición: `ninguna-mutacion-falla-en-silencio.test.tsx` (con `mockApi` que devuelve 500 en cada `DELETE`/`POST`/`PATCH`, cada botón del panel deja un `role="alert"` o un aviso con `tone: 'danger'`).

**3.F · Una pila de Deshacer pertenece a lo que se mira.** Cubre TP-12. Prohibición: `cada-pila-de-deshacer-es-de-su-pantalla.test.tsx` (cambia `:id` y espera `undoCount === 0`).

**3.G · Escape cierra lo que se abrió.** Cubre TP-15. Prohibición: `cada-ventana-se-cierra-con-escape.test.tsx`.

## 4. Sin confirmar

1. **Sesión vencida con trabajo a medias.** `config.js:295-296` fija 30 min de inactividad y 8 h absolutas. `useMe` tiene `staleTime` de 60 s y no hay `refetchOnWindowFocus` (`main.tsx:19`, `hooks.ts:35-38`). Una mutación con 401 muestra el error bajo el formulario sin devolver a la entrada; las consultas fallan con «No se pudo cargar» y «Reintentar» repite el 401 (`LoadState.tsx:26-33`). El `me` se vuelve a pedir recién al montarse un observador nuevo y vencido, y entonces `Routed` cambia a `Login`/`GoToHost` (`App.tsx:117-124`) y desmonta el `Shell` con los borradores de TP-04. No lo ejecuté: falta correr el panel contra un API con la sesión expirada. El riesgo cierto es el compuesto con TP-04; el de «Reintentar» infinito depende de que ningún observador de `me` se monte.
2. **Bucle de redirección con host de identidad.** `App.tsx:104-114` (`GoToHost`) manda a `login_url?next=<ruta>` con `location.replace`. Si el host autentica a la persona y el API sigue respondiendo 401 (configuración de `trusted-header` o `jwt` mal alineada), la página alterna entre ambos sin poder volver. `replace` evita llenar el historial, de modo que Atrás sale del bucle, pero no lo comprobé contra un host real; depende de configuración del servidor, fuera de la interfaz.
3. **Deshacer sobre el valor absoluto.** Las operaciones de la pila escriben el valor previo capturado (`MessageDetail.tsx:127`), no un `version`; si otra persona editó entremedio, Deshacer la pisa en silencio. El servidor tiene `edit_conflict` (409) para las respuestas; falta mirar si el `PATCH` de un mensaje lo exige. No lo confirmé.
4. **Pruebas de render.** Todos los hallazgos salen de lectura. El gancho de la sesión rechaza `vitest` en este equipo; correrlos (sobre todo TP-06, TP-12 y TP-15) queda para `infra/servidor-de-despliegue/probar.sh` si el dueño de la corrección lo quiere como prueba previa.
