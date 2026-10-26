// The version of the host contract: the five orders (CREATE, RUN, COLLECT, DESTROY, DELIVER), their markers, their environment and their exit codes (0, 75, 76).
// The single source is docs/CONTRATO-DE-ANFITRION.md; this constant is the number that document declares. A change of the contract that is not additive
// (a marker removed, a code that changes meaning) raises it; an additive one (a variable with a default, an optional order, a field in /health) does not.
//
// Who reads it: GET /health publishes it as `contract_version`; the worker prints it when it starts next to the one the driver declares
// (EXECUTE_CONTRACT_VERSION) and refuses to start when the major versions differ; scripts/host-conformance.mjs reports the one a driver meets.
export const CONTRACT_VERSION = 1

const FORMAT = /^\d+(\.\d+)*$/

/** The major component of a declared version («1», «1.2» → 1). Throws on anything that is not dotted digits. */
export function majorOf (version) {
  const text = String(version).trim()
  if (!FORMAT.test(text)) throw new Error(`EXECUTE_CONTRACT_VERSION: «${version}» is not a version (digits separated by dots, e.g. 1).`)
  return Number(text.split('.')[0])
}

/**
 * Compares what the core implements with what the driver declares. Without a declaration it starts anyway (`declared: null`, `ok: true`): a driver that
 * does not say which contract it meets is not refused, it is simply not checked. With one, the major versions must be equal.
 */
export function checkContractVersion (declared, core = CONTRACT_VERSION) {
  const coreMajor = majorOf(core)
  if (declared === undefined || declared === null || String(declared).trim() === '') {
    return { ok: true, core: String(core), declared: null, line: `contract_version: core ${core}, driver declares none (not checked)` }
  }
  const declaredMajor = majorOf(declared)
  const ok = declaredMajor === coreMajor
  return {
    ok,
    core: String(core),
    declared: String(declared).trim(),
    line: ok
      ? `contract_version: core ${core}, driver declares ${String(declared).trim()}`
      : `contract_version: core ${core}, driver declares ${String(declared).trim()}: the major versions differ (${coreMajor} and ${declaredMajor}), so the worker does not start. Use a driver that meets contract ${coreMajor} or a core that implements ${declaredMajor}.`
  }
}

/**
 * Called when the worker starts (the separate process and the one inside the API): logs the line and throws when the driver declares another major version.
 * `config.execute.contractVersion` is EXECUTE_CONTRACT_VERSION.
 */
export function announceContractVersion ({ config, logger }) {
  const checked = checkContractVersion(config.execute.contractVersion)
  if (!checked.ok) throw new Error(checked.line)
  logger.info({ contract_version: CONTRACT_VERSION, declared_contract_version: checked.declared }, checked.line)
  return checked
}
