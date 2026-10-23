# RULES: team-platform

> Reglas operativas para agentes de IA que trabajan en este repositorio.
> Referenciadas desde MASTER-SPEC §8.

---

## Alcance

Todas las operaciones del agente sobre el repositorio: código, documentación, dependencias, pruebas y empaquetado.

---

## Reglas

1. **Idioma** (UD-015). Código entero en inglés: identificadores, esquema, rutas, nombres de archivo, comentarios, pruebas, registros y prompts. En español: textos de interfaz y todo mensaje que vea una persona, las plantillas iniciales de `templates/`, la documentación y los commits.
2. **Ninguna credencial entra al repositorio** (MASTER-SPEC §4.6). Llaves de proveedores y secretos van en variables de entorno o en un archivo fuera del árbol; `.env.example` documenta los nombres sin valores.
3. **Un número que gobierna la operación nace declarado** (MASTER-SPEC §4.9). Antes de escribir un umbral, un límite o un tiempo de espera, se cita la corrida del banco de referencia (`bench/`) o la documentación fechada del tercero, o se declara como perilla de configuración con su valor por omisión justificado. «Parece razonable» no es una fuente.
4. **Ningún `if` sobre texto humano** (MASTER-SPEC §4.2). Lo que escribe una persona lo interpreta el modelo y llega por campos del esquema; el sistema valida la forma.
5. **Nada se declara funcionando sin haberlo ejecutado.** Un cambio que toca la API lleva su prueba en `node --test`; uno que toca una pantalla se abre y se captura antes de darse por hecho.
6. **Toda dependencia nueva es compatible con MIT** (UD-004) y se justifica en MASTER-SPEC §3 en el mismo commit.
7. **El cambio toca exactamente lo que la tarea nombra.** Sin mejoras «ya que estoy».
8. **Una decisión de Martín se registra en `docs/USER-DECISIONS.md` con sus palabras**, nunca una decisión que todavía no tomó. Si pidió investigar, se investiga y se le presenta; la UD se escribe cuando contesta.
9. **La maqueta y `idea.md` son fuentes; `idea.md` manda donde difieren.** Un cambio de diseño que los supere se anota en USER-DECISIONS y se refleja en MASTER-SPEC en el mismo commit.
10. **La documentación del repositorio no nombra otros proyectos del autor** (Martín, 2026-10-20). Se habla en lenguaje neutro: «un proyecto anterior del autor», «un servicio comparable». Los informes de `docs/investigaciones/` quedan exentos. El repositorio es público.
11. **Toda recomendación técnica nace de una investigación con fuentes fechadas**, hecha por subagentes en paralelo según `.agents/skills/standard-research/SKILL.md`, y queda como informe numerado en `docs/investigaciones/NN - Tema.md` con la fecha de consulta arriba. Una cifra de esos informes se cita siempre con su fecha.
12. **Las pruebas por defecto son dirigidas** (UD-265, Martín 2026-10-23: «deja eso como regla por defecto y como ajuste por defecto, la batería completa es muy cara»). `npm test` corre las pruebas de las áreas que el cambio toca (`src/testing/areas.json`) más las guardias que siempre corren; `npm run test:panel` y `npm run test:client` si se tocó el panel o el cliente. La batería completa (`npm run test:completa`, `test:fit`, `test:flows`) se corre sólo si se pide, antes de una publicación o cuando el cambio toca algo transversal (migraciones, `config.js`, contrato de la API). Un agente no lanza la batería completa por costumbre: elige lo que el cambio puede romper y lo declara.
13. **Una captura de la interfaz declara qué muestra y si ocultó los datos** (UD-268). Cada captura de una respuesta lleva `path`, `alt`, `masked`, `place` y `as`. Con `masked: false` sólo se adjunta si la zona declarada es la abierta; la plataforma no lee la imagen. Las capturas viajan como archivos y nunca pasan por el modelo.
