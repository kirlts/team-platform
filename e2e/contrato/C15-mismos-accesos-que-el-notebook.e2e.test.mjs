// C15. The unattended session has the same accesses as the notebook (through Infisical, which is the host's: the platform passes the environment on).
// What this suite can prove is that the platform puts no variable, filter, allow-list or tool restriction between the host and the session.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { loadConfig } from '../../src/config.js'
import { iniciarCiclo, ORDEN } from './ciclo.mjs'

const CREDENCIALES = {
  INFISICAL_EMAIL: 'sesion@x.org', INFISICAL_PASSWORD: 'clave-de-infisical-de-prueba', INFISICAL_CLIENT_SECRET: 'secreto-de-prueba',
  GH_TOKEN: 'ghp_de_prueba', GOOGLE_APPLICATION_CREDENTIALS: '/ruta/a/credencial.json', NPM_TOKEN: 'npm_de_prueba', CLOUDSDK_CORE_PROJECT: 'proyecto-de-prueba'
}
const RESTRICCIONES = ['--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--tools', '--strict-mcp-config', '--bare', '--add-dir', '--disable-slash-commands']

describe('C15 la sesión desatendida tiene los accesos del notebook', () => {
  let c
  before(async () => { Object.assign(process.env, CREDENCIALES); c = await iniciarCiclo() })
  after(async () => { for (const k of Object.keys(CREDENCIALES)) delete process.env[k]; await c.cerrar() })

  it('sesión local: recibe todo el entorno del servicio, sin quitar ninguna credencial', async () => {
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La pantalla de agenda queda en blanco.')
    await c.esperar(id)
    const env = c.entornoDe(c.llamadas().at(-1))
    for (const [k, v] of Object.entries(CREDENCIALES)) assert.equal(env[k], v, `${k} llega a la sesión`)
    assert.equal(env.HOME, process.env.HOME)
    assert.ok(env.PATH.includes(process.env.PATH), 'the PATH of the service is kept (the `team` command goes in front of it)')
    await c.detener()
  })

  it('sin restricciones de herramientas ni de permisos en la invocación: la sesión puede lo que puede el notebook', async () => {
    c.iniciar({ deliverCommand: ORDEN.pasa })
    const id = await c.enviar('El botón de reservas no responde en el teléfono.')
    await c.esperar(id)
    const { args } = c.llamadas().at(-1)
    for (const flag of RESTRICCIONES) assert.ok(!args.includes(flag), `la invocación lleva ${flag}`)
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions')
    await c.detener()
  })

  it('sesión en máquina de trabajo (entorno limpio): lo que el anfitrión declara en EXECUTE_SESSION_ENV llega entero, sin lista de permitidos', async () => {
    const declared = { INFISICAL_EMAIL: 'otra@x.org', INFISICAL_PASSWORD: 'otra-clave', GH_TOKEN: 'ghp_otro', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' }
    // A clean environment, as a remote machine has: only the FAKE_* of the suite (the stand-in of `claude`) and what env.sh carries.
    const keep = Object.keys(process.env).filter((k) => k.startsWith('FAKE_')).map((k) => `${k}="$${k}"`).join(' ')
    c.iniciar({ runner: 'machine', machineCreate: 'echo vm-{job_id}', machineRun: `env -i HOME="$HOME" PATH="$PATH" ${keep} bash {workdir}/run.sh`, machineDestroy: 'true', sessionEnv: declared, deliverCommand: ORDEN.pasa })
    const id = await c.enviar('La ficha del paciente corta el nombre.')
    await c.esperar(id)
    const env = c.entornoDe(c.llamadas().at(-1))
    for (const [k, v] of Object.entries(declared)) assert.equal(env[k], v, `${k} viaja en env.sh`)
    assert.equal(env.TEAM_AGENT_EMAIL, 'claude@x.org', 'y la credencial del agente para hablar con la plataforma')
    await c.detener()
  })

  it('la configuración acepta cualquier nombre de credencial en EXECUTE_SESSION_ENV (sólo rechaza TEAM_*, que es de la plataforma)', () => {
    const cfg = loadConfig({ DATA_DIR: c.env.dir, EXECUTE_SESSION_ENV: 'INFISICAL_CLIENT_ID=a INFISICAL_CLIENT_SECRET=b GH_TOKEN=c AWS_SECRET_ACCESS_KEY=d' }).execute
    assert.deepEqual(cfg.sessionEnv, { INFISICAL_CLIENT_ID: 'a', INFISICAL_CLIENT_SECRET: 'b', GH_TOKEN: 'c', AWS_SECRET_ACCESS_KEY: 'd' })
  })
})
