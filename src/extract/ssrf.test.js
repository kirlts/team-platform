import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAddress, resolveSafeHost } from './lib/ssrf.js';
import { ExtractError } from './errors.js';

const blocked = [
  '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
  '169.254.169.254', '100.100.100.200', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
  '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1',
  '64:ff9b::7f00:1', '2002:7f00:1::', '2002:a9fe:a9fe::1',
];
const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2001:4860:4860::8888'];

test('private, link-local, metadata and multicast addresses are blocked', () => {
  for (const ip of blocked) assert.equal(classifyAddress(ip).allowed, false, ip);
});

test('public addresses are allowed, including public mapped IPv4', () => {
  for (const ip of allowed) assert.equal(classifyAddress(ip).allowed, true, ip);
});

const rejects = (host, opts) =>
  assert.rejects(resolveSafeHost(host, opts), (e) => e instanceof ExtractError && e.code === 'link_blocked');

test('private literal IPs are rejected without querying DNS', async () => {
  const lookup = async () => assert.fail('must not resolve a literal IP');
  for (const host of ['127.0.0.1', '[::1]', '169.254.169.254', '10.1.1.1', '[::ffff:127.0.0.1]']) await rejects(host, { lookup });
});

test('localhost and internal names are rejected without querying DNS', async () => {
  const lookup = async () => assert.fail('must not resolve an internal name');
  for (const host of ['localhost', 'LOCALHOST', 'app.localhost', 'impresora.local', 'metadata.google.internal', 'localhost.']) await rejects(host, { lookup });
});

test('a name that resolves to a private address is rejected (rebinding)', async () => {
  await rejects('legit.example', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
  // A single private address among several is enough.
  await rejects('mixed.example', { lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }] });
});

test('a public name returns the validated addresses to pin the connection', async () => {
  const out = await resolveSafeHost('ok.example', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.deepEqual(out, [{ address: '93.184.216.34', family: 4 }]);
});

test('a name that does not resolve is its own error', async () => {
  await assert.rejects(
    resolveSafeHost('no-existe.example', { lookup: async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } }),
    (e) => e.code === 'link_unresolved',
  );
});

test('a host explicitly exempted may be private', async () => {
  const out = await resolveSafeHost('127.0.0.1', { allowedPrivateHosts: ['127.0.0.1'] });
  assert.equal(out[0].address, '127.0.0.1');
});
