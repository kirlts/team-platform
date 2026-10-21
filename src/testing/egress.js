// Network-egress guard for HP-001 (docs/TEST.md): while installed, every outgoing connection of the process is
// recorded and, if its destination is not allowed, refused. It patches the five doors a Node process has to the
// network: `globalThis.fetch`, the `Agent` of the `undici` package, `net.Socket.prototype.connect` (what http, https,
// tls and every driver end up calling), `dns.lookup` and `dns.promises.lookup`. Test support: nothing here is
// imported from production code.
//
// Limit: worker threads have their own realm and are not covered; the document extractor runs in one, and a static
// test (src/network-egress.test.js) checks that its modules import nothing that can reach the network.

import dns from 'node:dns'
import dnsPromises from 'node:dns/promises'
import module from 'node:module'
import net from 'node:net'
import { Agent } from 'undici'

const LOOPBACK = ['127.0.0.1', '::1', 'localhost']

/** The hostname of a URL, address or `host:port` text, lowercased and without brackets. */
export function hostOf (value) {
  const text = String(value ?? '')
  try { return new URL(text).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch { /* not a URL */ }
  return text.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * The destinations a process may reach given its environment: loopback, the base URL of every configured provider
 * and, only when it is defined, the OTLP collector. `extra`: additional hosts for a specific test.
 */
export function allowedHostsFor (env, extra = []) {
  const urls = [env.TEXT_BASE_URL, env.VISION_BASE_URL, env.SPEECH_BASE_URL, env.TEXT_FALLBACK_BASE_URL, env.OTEL_EXPORTER_OTLP_ENDPOINT, env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT]
  return new Set([...LOOPBACK, ...urls.filter(Boolean).map(hostOf), ...extra.map(hostOf)])
}

/** Installs the guard. Returns { attempts, violations, uninstall }. `attempts` lists every destination seen. */
export function installEgressGuard ({ allowedHosts }) {
  const attempts = []
  const violations = []
  const check = (via, destination) => {
    const host = hostOf(destination)
    attempts.push({ via, host })
    if (allowedHosts.has(host)) return null
    violations.push({ via, host })
    return new Error(`egress blocked: ${via} to ${host}`)
  }

  const originals = {
    fetch: globalThis.fetch,
    dispatch: Agent.prototype.dispatch,
    connect: net.Socket.prototype.connect,
    lookup: dns.lookup,
    lookupPromise: dnsPromises.lookup
  }

  globalThis.fetch = function guardedFetch (input, init) {
    const target = typeof input === 'string' || input instanceof URL ? input : input?.url
    const error = check('fetch', target)
    return error ? Promise.reject(error) : originals.fetch.call(this, input, init)
  }

  Agent.prototype.dispatch = function guardedDispatch (options, handler) {
    const error = check('undici.Agent', options?.origin ?? options?.hostname)
    if (error) throw error
    return originals.dispatch.call(this, options, handler)
  }

  net.Socket.prototype.connect = function guardedConnect (...args) {
    // Node passes either (options[, callback]), (port[, host][, callback]) or (path[, callback]).
    const first = Array.isArray(args[0]) ? args[0][0] : args[0]
    let destination
    if (typeof first === 'object' && first !== null) destination = first.path ? `unix:${first.path}` : (first.host ?? 'localhost')
    else if (typeof first === 'number' || /^\d+$/.test(String(first))) destination = typeof args[1] === 'string' ? args[1] : 'localhost'
    else destination = `unix:${first}`
    const error = check('net.connect', destination)
    if (error) {
      process.nextTick(() => this.destroy(error))
      return this
    }
    return originals.connect.apply(this, args)
  }

  dns.lookup = function guardedLookup (hostname, ...rest) {
    const error = check('dns.lookup', hostname)
    if (!error) return originals.lookup.call(this, hostname, ...rest)
    const callback = rest.at(-1)
    process.nextTick(() => callback(error))
  }

  dnsPromises.lookup = function guardedLookupPromise (hostname, ...rest) {
    const error = check('dns.promises.lookup', hostname)
    return error ? Promise.reject(error) : originals.lookupPromise.call(this, hostname, ...rest)
  }
  module.syncBuiltinESMExports() // modules that imported `lookup` by name see the patched function

  return {
    attempts,
    violations,
    uninstall () {
      globalThis.fetch = originals.fetch
      Agent.prototype.dispatch = originals.dispatch
      net.Socket.prototype.connect = originals.connect
      dns.lookup = originals.lookup
      dnsPromises.lookup = originals.lookupPromise
      module.syncBuiltinESMExports()
    }
  }
}
