// SSRF protection for link downloads (report 05 §7.2, OWASP SSRF Prevention
// Cheat Sheet, CVE-2026-61704). Rules: nothing to private, link-local, metadata,
// or multicast networks, nor to `localhost`, in IPv4 and IPv6 (including mapped IPv4, NAT64 and 6to4);
// literal IPs are checked beforehand because the `lookup` hook does not run for them.
// Ranges: IANA special-purpose address registries (RFC 6890 and successors).
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { ExtractError } from '../errors.js';

const v4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) v4.addSubnet(net, prefix, 'ipv4');

const v6 = new BlockList();
for (const [net, prefix] of [
  ['::', 96], // unspecified, loopback and IPv4-compatible (obsolete)
  ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) v6.addSubnet(net, prefix, 'ipv6');

// Codes of `dns.lookup` that mean «the name servers did not answer», as opposed to «the name does not exist» (ENOTFOUND, ENODATA).
const TRANSIENT_DNS = new Set(['EAI_AGAIN', 'ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain'];

function parseIPv6(address) {
  let text = address.split('%')[0].toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = text.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array(fill).fill('0'), ...right].map((g) => Number.parseInt(g || '0', 16));
}

const quad = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** @returns {{allowed:boolean, reason?:string}} */
export function classifyAddress(address) {
  const family = isIP(address);
  if (family === 4) return v4.check(address, 'ipv4') ? { allowed: false, reason: 'private_ipv4' } : { allowed: true };
  if (family !== 6) return { allowed: false, reason: 'not_an_ip' };
  const g = parseIPv6(address);
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  // Mapped IPv4 (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 inside.
  if (zeros(0, 5) && g[5] === 0xffff) return classifyAddress(quad(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return classifyAddress(quad(g[6], g[7]));
  if (g[0] === 0x2002) return classifyAddress(quad(g[1], g[2]));
  return v6.check(address, 'ipv6') ? { allowed: false, reason: 'private_ipv6' } : { allowed: true };
}

function blocked(host, reason) {
  return new ExtractError('link_blocked', 'El enlace apunta a una dirección interna y no se puede abrir.', { host, reason });
}

/**
 * Resolves the name once and returns the validated addresses. The connection is made to
 * those addresses, never to a second resolution (report 05 §7.2).
 * @returns {Promise<{address:string,family:number}[]>}
 */
export async function resolveSafeHost(rawHost, { lookup = dnsLookup, allowedPrivateHosts = [] } = {}) {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const exempt = allowedPrivateHosts.includes(host);
  const literal = isIP(host);
  if (literal) {
    if (!exempt) {
      const verdict = classifyAddress(host);
      if (!verdict.allowed) throw blocked(host, verdict.reason);
    }
    return [{ address: host, family: literal }];
  }
  if (!exempt && (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)))) {
    throw blocked(host, 'internal_name');
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch (cause) {
    // The name servers not answering (a timeout, a refused connection, a server failure) clears up by itself; a name that does not exist does not.
    if (TRANSIENT_DNS.has(cause?.code)) throw new ExtractError('link_fetch_failed', 'No se pudo abrir el enlace.', { host, cause: String(cause.code) });
    throw new ExtractError('link_unresolved', 'No se encontró el sitio del enlace.', { host, cause: String(cause?.code ?? cause) });
  }
  if (!addresses?.length) throw new ExtractError('link_unresolved', 'No se encontró el sitio del enlace.', { host });
  if (!exempt) {
    for (const { address } of addresses) {
      const verdict = classifyAddress(address);
      if (!verdict.allowed) throw blocked(host, verdict.reason);
    }
  }
  return addresses.map(({ address, family }) => ({ address, family }));
}
