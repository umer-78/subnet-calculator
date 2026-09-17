import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIp, formatIp, parseCidr, prefixFromMask, describe, split, vlsm, prefixForHosts, contains, addressType } from '../src/ipv4.js';

test('parse and format round-trip', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '192.168.100.254', '255.255.255.255']) {
    assert.equal(formatIp(parseIp(ip)), ip);
  }
});

test('rejects bad addresses', () => {
  for (const bad of ['1.2.3', '256.1.1.1', '1.2.3.4.5', 'a.b.c.d', '01.2.3.4', '']) {
    assert.throws(() => parseIp(bad));
  }
});

test('cidr in three notations', () => {
  assert.deepEqual(parseCidr('192.168.1.10/24'), { ip: parseIp('192.168.1.10'), prefix: 24 });
  assert.equal(parseCidr('192.168.1.10 255.255.255.0').prefix, 24);
  assert.equal(parseCidr('192.168.1.10/255.255.254.0').prefix, 23);
  assert.equal(parseCidr('8.8.8.8').prefix, 32);
  assert.throws(() => parseCidr('10.0.0.0/33'));
  assert.throws(() => parseCidr('10.0.0.0/'));
  assert.throws(() => prefixFromMask('255.0.255.0'));
});

test('describe a /24', () => {
  const d = describe(parseIp('192.168.1.130'), 24);
  assert.equal(d.network, '192.168.1.0');
  assert.equal(d.broadcast, '192.168.1.255');
  assert.equal(d.firstHost, '192.168.1.1');
  assert.equal(d.lastHost, '192.168.1.254');
  assert.equal(d.usableHosts, 254);
  assert.equal(d.wildcard, '0.0.0.255');
  assert.equal(d.ipClass, 'C');
  assert.equal(d.type, 'Private (RFC 1918)');
  assert.equal(d.binaryMask, '11111111.11111111.11111111.00000000');
});

test('edge prefixes /0, /31 and /32', () => {
  assert.equal(describe(parseIp('1.2.3.4'), 0).usableHosts, 2 ** 32 - 2);
  const p2p = describe(parseIp('10.0.0.0'), 31);
  assert.equal(p2p.usableHosts, 2);
  assert.equal(p2p.broadcast, null);
  assert.equal(p2p.lastHost, '10.0.0.1');
  const host = describe(parseIp('10.0.0.7'), 32);
  assert.equal(host.usableHosts, 1);
  assert.equal(host.firstHost, '10.0.0.7');
});

test('split a /24 into /26s', () => {
  const r = split(parseIp('10.0.0.0'), 24, 26);
  assert.equal(r.count, 4);
  assert.deepEqual(r.subnets.map((s) => s.cidr), ['10.0.0.0/26', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/26']);
  assert.equal(split(parseIp('10.0.0.0'), 8, 30, 10).truncated, true);
  assert.throws(() => split(parseIp('10.0.0.0'), 24, 23));
});

test('prefix for host counts', () => {
  assert.equal(prefixForHosts(1), 32);
  assert.equal(prefixForHosts(2), 31);
  assert.equal(prefixForHosts(3), 29);
  assert.equal(prefixForHosts(62), 26);
  assert.equal(prefixForHosts(63), 25);
  assert.equal(prefixForHosts(254), 24);
});

test('VLSM allocates largest first without overlap', () => {
  const r = vlsm(parseIp('192.168.10.0'), 24, [
    { name: 'Guests', hosts: 20 },
    { name: 'Staff', hosts: 100 },
    { name: 'Link', hosts: 2 },
    { name: 'Servers', hosts: 50 },
  ]);
  assert.deepEqual(r.allocations.map((a) => `${a.name} ${a.cidr}`), [
    'Staff 192.168.10.0/25',
    'Servers 192.168.10.128/26',
    'Guests 192.168.10.192/27',
    'Link 192.168.10.224/31',
  ]);
  assert.equal(r.used, 128 + 64 + 32 + 2);
  assert.equal(r.free, 256 - r.used);
  assert.throws(() => vlsm(parseIp('192.168.10.0'), 24, [{ name: 'Big', hosts: 300 }]), /not enough space/);
});

test('contains and address types', () => {
  assert.ok(contains(parseIp('172.16.0.0'), 12, parseIp('172.31.255.1')));
  assert.ok(!contains(parseIp('172.16.0.0'), 12, parseIp('172.32.0.1')));
  assert.equal(addressType(parseIp('8.8.8.8')), 'Public');
  assert.equal(addressType(parseIp('127.0.0.1')), 'Loopback');
  assert.equal(addressType(parseIp('100.100.1.1')), 'Carrier-grade NAT (RFC 6598)');
  assert.equal(addressType(parseIp('255.255.255.255')), 'Limited broadcast');
});
