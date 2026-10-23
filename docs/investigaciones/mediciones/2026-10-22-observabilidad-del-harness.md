# Telemetría de Claude Code para el harness (OTLP)

Fecha de consulta de las fuentes: 2026-10-22. Versión medida: `claude` 2.1.284.

Claude Code exporta métricas, eventos y trazas por OTLP. Las trazas están en beta. En `claude -p` el `TRACEPARENT` del entorno pasa a ser el padre del span `claude_code.interaction`. Nada de esto se ejecutó con un prompt real: solo `--version` y `--help`.

## Fuentes

| Fuente | Dato | Fecha |
|---|---|---|
| `claude --version` | 2.1.284 (Claude Code) | 2026-10-22 |
| `claude --help` | No lista variables OTEL ni opciones de telemetría. Lista `--output-format`, `--include-partial-messages`, `--bare` y el subcomando `gateway` ("Run the enterprise auth/telemetry gateway", opción `--config`) | 2026-10-22 |
| https://code.claude.com/docs/en/monitoring-usage | Variables, métricas, eventos, trazas y propagación | 2026-10-22 |

La página es de la versión vigente de la documentación, posterior a la 2.1.284. Algunos datos exigen una versión mayor que la instalada: `prompt_text` (2.1.287 o más) y `classifier_verdict` (2.1.301 o más). No están verificados en 2.1.284.

## Activación mínima para `claude -p`

| Variable | Valor |
|---|---|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | `1` (obligatoria) |
| `OTEL_METRICS_EXPORTER` | `otlp`, `console`, `prometheus` o `none` |
| `OTEL_LOGS_EXPORTER` | `otlp`, `console` o `none` |
| `OTEL_TRACES_EXPORTER` | `otlp`, `console` o `none` |
| `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` | `1`, para trazas |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc`, `http/json` o `http/protobuf`. Sin valor por omisión |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Por ejemplo `http://localhost:4317` (grpc) o `http://localhost:4318` (http) |

La documentación no indica que `--output-format stream-json` cambie la telemetría. Es independiente de ese formato: no verificado con una corrida.

## Variables de exportación

| Variable | Función |
|---|---|
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL`, `_ENDPOINT`, `_HEADERS` | Valores propios de métricas |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`, `_ENDPOINT`, `_HEADERS` | Valores propios de eventos |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `_ENDPOINT`, `_HEADERS` | Valores propios de trazas |
| `OTEL_EXPORTER_OTLP_HEADERS` | Cabeceras de todas las señales |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta` (omisión) o `cumulative` |
| `OTEL_RESOURCE_ATTRIBUTES` | Atributos propios en métricas y eventos, separados por coma |
| `CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS` | Refresco de cabeceras dinámicas, omisión 1.740.000 ms |
| `otelHeadersHelper` (clave de `settings.json`) | Guion que imprime un JSON de cabeceras. No sirve con `grpc` |

## Intervalos

| Variable | Omisión |
|---|---|
| `OTEL_METRIC_EXPORT_INTERVAL` | 60.000 ms |
| `OTEL_LOGS_EXPORT_INTERVAL` | 5.000 ms |
| `OTEL_TRACES_EXPORT_INTERVAL` | 5.000 ms (beta) |

Un `claude -p` corto puede terminar antes de 60 s. La documentación no dice si el proceso vacía las métricas al salir: no verificado. Conviene bajar `OTEL_METRIC_EXPORT_INTERVAL`.

## Privacidad

Todas apagadas por omisión.

| Variable | Efecto |
|---|---|
| `OTEL_LOG_USER_PROMPTS` | Registra el texto del prompt. Apagada, `prompt` vale `<REDACTED>` |
| `OTEL_LOG_ASSISTANT_RESPONSES` | Registra la respuesta. Si no está definida, sigue a `OTEL_LOG_USER_PROMPTS`; con `0` queda redactada |
| `OTEL_LOG_TOOL_DETAILS` | Registra parámetros de herramientas: comandos Bash, nombres de MCP y skills, rutas, mensajes de error |
| `OTEL_LOG_TOOL_CONTENT` | Registra la salida de herramientas en el evento de span `tool.output`. Requiere trazas |
| `OTEL_LOG_RAW_API_BODIES` | Cuerpos completos de petición y respuesta. `1` en línea (truncado) o `file:<dir>` sin truncar. Implica consentimiento a las demás |
| `OTEL_LOG_MANAGED_SETTINGS` | Agrega la configuración administrada redactada |
| `CLAUDE_CODE_OTEL_CONTENT_MAX_LENGTH` | Tope de contenido, omisión 61.440 unidades UTF-16 |
| `DISABLE_ERROR_REPORTING` | Suprime los eventos `internal_error` |

## Cardinalidad de métricas

| Variable | Omisión |
|---|---|
| `OTEL_METRICS_INCLUDE_SESSION_ID` | `true` |
| `OTEL_METRICS_INCLUDE_VERSION` | `false` |
| `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` | `true` |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT` | `false` |
| `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES` | `true` |
| `OTEL_METRICS_INCLUDE_REPOSITORY` | `false` |

## Métricas

| Métrica | Unidad | Atributos propios |
|---|---|---|
| `claude_code.session.count` | ninguna | `start_type` (`fresh`, `resume`, `continue`, `agents_view`) |
| `claude_code.lines_of_code.count` | ninguna | `type` (`added`, `removed`), `model` |
| `claude_code.pull_request.count` | ninguna | ninguno |
| `claude_code.commit.count` | ninguna | ninguno |
| `claude_code.cost.usage` | USD | `model`, `query_source`, `speed`, `effort`, `agent.name`, `skill.name`, `plugin.name`, `marketplace.name`, `mcp_server.name`, `mcp_tool.name` |
| `claude_code.token.usage` | tokens | `type` (`input`, `output`, `cacheRead`, `cacheCreation`) y los mismos atributos de costo |
| `claude_code.code_edit_tool.decision` | ninguna | `tool_name`, `decision`, `source`, `language` |
| `claude_code.active_time.total` | s | `type` (`user`, `cli`) |

Atributos estándar de métricas y eventos: `session.id`, `ccr.session.id`, `app.version`, `app.entrypoint`, `organization.id`, `user.account_uuid`, `user.account_id`, `user.id`, `user.email`, `terminal.type`, claves de `OTEL_RESOURCE_ATTRIBUTES` y `vcs.*`. Los eventos agregan `prompt.id`, `workspace.host_paths`, `workflow.run_id` y `workflow.name`.

## Eventos

Atributos de correlación: `prompt.id`, `event.sequence` (por proceso), `message.uuid`, `request_id`, `client_request_id`, `tool_use_id`. Los eventos llevan `trace_id` y `span_id` en sesiones SDK y `-p`, incluso sin exportador de trazas.

| Evento | Atributos principales |
|---|---|
| `claude_code.user_prompt` | `prompt_length`, `prompt` (con permiso), `message.uuid`, `command_name`, `command_source` |
| `claude_code.assistant_response` | `response_length`, `response` (con permiso), `model`, `request_id`, `message.uuid`, `query_source` |
| `claude_code.tool_result` | `tool_name`, `tool_use_id`, `success`, `duration_ms`, `error_type`, `error` (con permiso), `decision_type`, `decision_source`, `tool_input_size_bytes`, `tool_result_size_bytes`, `mcp_server_scope`, `tool_parameters` (con permiso), `tool_input` (con permiso) |
| `claude_code.api_request` | `model`, `cost_usd`, `cost_usd_micros`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `client_request_id`, `speed`, `query_source`, `effort` |
| `claude_code.api_error` | `model`, `error`, `status_code`, `duration_ms`, `attempt`, `request_id`, `speed`, `query_source`, `effort` |
| `claude_code.api_retries_exhausted` | Atributos no copiados de la página |
| `claude_code.api_refusal` | `model`, `request_id`, `query_source`, `attempt`, `has_category`, `category` (con permiso) |
| `claude_code.api_request_body`, `claude_code.api_response_body` | `body` o `body_ref`, `body_length`, `body_truncated`, `request_body_id`. Solo con `OTEL_LOG_RAW_API_BODIES` |
| `claude_code.tool_decision` | `tool_name`, `tool_use_id`, `decision`, `tool_source`, `source`, `permission_mode`, `tool_parameters` (con permiso) |
| `claude_code.permission_mode_changed` | `from_mode`, `to_mode`, `trigger` |
| `claude_code.auth` | `action`, `success`, `auth_method`, `error_category`, `status_code` |
| `claude_code.mcp_server_connection` | `status`, `transport_type`, `server_scope`, `duration_ms`, `error_code`, `server_name` (con permiso) |
| `claude_code.internal_error` | `error_name`, `error_code` |

Otros eventos nombrados en la página, sin atributos copiados aquí: `plugin_installed`, `plugin_loaded`, `skill_activated`, `at_mention`, `hook_registered`, `hook_execution_start`, `hook_execution_complete`, `hook_plugin_metrics`, `compaction`, `subagent_completed`, `feedback_survey`, `retention_sweep`, `managed_settings_resolved`. Todos llevan el prefijo `claude_code.`.

## Trazas

Existen spans. Están en beta y requieren `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` y `OTEL_TRACES_EXPORTER`.

| Span | Contenido |
|---|---|
| `claude_code.interaction` | Uno por prompt. `user_prompt_length`, `interaction.sequence`, `parent.source` (`env` o `none`), `interaction.duration_ms` |
| `claude_code.llm_request` | `model`, `gen_ai.system`, `query_source`, `speed`, `effort`, `duration_ms`, `ttft_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `request_id`, `attempt`, `success`, `status_code`, `stop_reason` |
| `claude_code.tool` | `tool_name`, `bash_command_class`, `bash_argv0`, `duration_ms`, `result_tokens`, `tool_use_id` |
| `claude_code.tool.blocked_on_user` | `duration_ms`, `decision`, `source` |
| `claude_code.tool.execution` | `duration_ms`, `success`, `error_class` |
| `claude_code.hook` | Solo con `ENABLE_BETA_TRACING_DETAILED` y `BETA_TRACING_ENDPOINT` |

Los spans de subagentes cuelgan de `claude_code.tool` (herramienta Agent).

## TRACEPARENT

| Caso | Comportamiento documentado |
|---|---|
| Entrada en `claude -p` y Agent SDK | `TRACEPARENT` y `TRACESTATE` del entorno son el padre de `claude_code.interaction` |
| Entrada en sesión interactiva | Se ignoran |
| Subprocesos Bash y PowerShell | Heredan `TRACEPARENT` del span de la herramienta activa |
| Peticiones a la API de Anthropic | Cabecera `traceparent`. La respuesta `traceresponse` queda como enlace del span |
| Peticiones HTTP a servidores MCP | Cabecera `traceparent` |
| `ANTHROPIC_BASE_URL` propio | Sin cabecera, salvo `CLAUDE_CODE_PROPAGATE_TRACEPARENT=1` |
| Proveedores de terceros | No reciben la cabecera |

Con esto el harness puede pasar el `TRACEPARENT` de su span al proceso `claude -p` y obtener un árbol único. Falta la prueba con una corrida real, que cuesta tokens: no verificado.

## Reglas de configuración

Los `OTEL_*` de `.claude/settings.json` y `.claude/settings.local.json` del repositorio se ignoran, salvo para apagar una señal con `none`. Las variables van en el entorno del proceso, en `~/.claude/settings.json` o en la configuración administrada. Los subprocesos (Bash, hooks, MCP, LSP) no reciben las variables `OTEL_*`.

Para depurar: `claude --debug-file <ruta>` y buscar errores `[3P telemetry]`.

## Sin verificar

| Punto | Estado |
|---|---|
| Atributos con versión mínima mayor que 2.1.284 | No verificado en la versión instalada |
| Vaciado de métricas al terminar un `claude -p` corto | No verificado |
| Efecto de `--bare` sobre la telemetría | No verificado, salvo que no corre el barrido de retención |
| Atributos de los eventos de la lista «Otros eventos» | No copiados |
| Corrida real con `TRACEPARENT` | No ejecutada |
