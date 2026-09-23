// Pure IPv4 maths. No DOM, so it runs in Node tests and in the browser.
// Addresses are handled as unsigned 32-bit integers.

export function parseIp(text) {
  const parts = String(text).trim().split('.');
  if (parts.length !== 4) throw new Error(`"${text}" is not an IPv4 address`);
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) throw new Error(`"${text}" is not an IPv4 address`);
    if (p.length > 1 && p.startsWith('0')) throw new Error(`"${text}" has a leading zero (ambiguous octal)`);
    n = n * 256 + Number(p);
  }
  return n >>> 0;
}

export const formatIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

export const maskFromPrefix = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export function prefixFromMask(mask) {
  const m = typeof mask === 'number' ? mask : parseIp(mask);
  const inv = ~m >>> 0;
  if ((inv & (inv + 1)) !== 0) throw new Error(`${formatIp(m)} is not a contiguous subnet mask`);
  return 32 - Math.log2(inv + 1);
}

/** Accepts "10.0.0.5/24", "10.0.0.5 255.255.255.0" or "10.0.0.5" (/32). */
export function parseCidr(text) {
  const s = String(text).trim();
  let ipPart, prefix;
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    ipPart = a;
    prefix = b.includes('.') ? prefixFromMask(b) : (/^\d{1,2}$/.test(b) ? Number(b) : NaN);
  } else if (/\s/.test(s)) {
    const [a, b] = s.split(/\s+/);
    ipPart = a;
    prefix = prefixFromMask(b);
  } else {
    ipPart = s;
    prefix = 32;
  }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('prefix must be 0-32');
  return { ip: parseIp(ipPart), prefix };
}

export function ipClass(n) {
  const first = n >>> 24;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (multicast)';
  return 'E (reserved)';
}

const RANGES = [
  ['0.0.0.0', 8, 'This network'],
  ['10.0.0.0', 8, 'Private (RFC 1918)'],
  ['100.64.0.0', 10, 'Carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0', 8, 'Loopback'],
  ['169.254.0.0', 16, 'Link-local'],
  ['172.16.0.0', 12, 'Private (RFC 1918)'],
  ['192.0.2.0', 24, 'Documentation (TEST-NET-1)'],
  ['192.168.0.0', 16, 'Private (RFC 1918)'],
  ['198.18.0.0', 15, 'Benchmarking'],
  ['198.51.100.0', 24, 'Documentation (TEST-NET-2)'],
  ['203.0.113.0', 24, 'Documentation (TEST-NET-3)'],
  ['224.0.0.0', 4, 'Multicast'],
  ['240.0.0.0', 4, 'Reserved'],
].map(([ip, p, label]) => ({ net: parseIp(ip), mask: maskFromPrefix(p), label }));

export function addressType(n) {
  if (n === 0xffffffff) return 'Limited broadcast';
  const hit = RANGES.find((r) => ((n & r.mask) >>> 0) === r.net);
  return hit ? hit.label : 'Public';
}

/** Everything a subnet calculator shows for one network. */
export function describe(ip, prefix) {
  const mask = maskFromPrefix(prefix);
  const network = (ip & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const broadcast = (network + size - 1) >>> 0;
  let firstHost, lastHost, usable;
  if (prefix === 32) {
    firstHost = lastHost = network; usable = 1;
  } else if (prefix === 31) {
    firstHost = network; lastHost = broadcast; usable = 2; // RFC 3021 point-to-point
  } else {
    firstHost = network + 1; lastHost = broadcast - 1; usable = size - 2;
  }
  return {
    address: formatIp(ip),
    cidr: `${formatIp(network)}/${prefix}`,
    prefix,
    mask: formatIp(mask),
    wildcard: formatIp(~mask >>> 0),
    network: formatIp(network),
    broadcast: prefix >= 31 ? null : formatIp(broadcast),
    firstHost: formatIp(firstHost),
    lastHost: formatIp(lastHost),
    totalAddresses: size,
    usableHosts: usable,
    ipClass: ipClass(ip),
    type: addressType(ip),
    binaryMask: [24, 16, 8, 0].map((s) => ((mask >>> s) & 255).toString(2).padStart(8, '0')).join('.'),
    hex: '0x' + ip.toString(16).padStart(8, '0').toUpperCase(),
    networkInt: network,
    broadcastInt: broadcast,
  };
}

/** Split a network into 2^bits equal subnets. */
export function split(networkIp, prefix, newPrefix, limit = 1024) {
  if (newPrefix < prefix || newPrefix > 32) throw new Error(`new prefix must be between /${prefix} and /32`);
  const count = 2 ** (newPrefix - prefix);
  const size = 2 ** (32 - newPrefix);
  const base = (networkIp & maskFromPrefix(prefix)) >>> 0;
  const out = [];
  for (let i = 0; i < Math.min(count, limit); i++) out.push(describe((base + i * size) >>> 0, newPrefix));
  return { count, subnets: out, truncated: count > limit };
}

/** Smallest prefix that fits `hosts` usable addresses. */
export function prefixForHosts(hosts) {
  if (!Number.isInteger(hosts) || hosts < 1) throw new Error('host count must be a positive integer');
  if (hosts === 1) return 32;
  if (hosts === 2) return 31;
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts) return p;
  throw new Error('too many hosts for IPv4');
}

/**
 * VLSM: allocate subnets for each requirement, largest first, inside a parent block.
 * requirements: [{ name, hosts }]
 */
export function vlsm(networkIp, prefix, requirements) {
  const parentStart = (networkIp & maskFromPrefix(prefix)) >>> 0;
  const parentEnd = parentStart + 2 ** (32 - prefix); // exclusive
  const sorted = requirements
    .map((r, i) => ({ ...r, order: i, prefix: prefixForHosts(r.hosts) }))
    .sort((a, b) => a.prefix - b.prefix || a.order - b.order);
  let cursor = parentStart;
  const allocations = [];
  for (const r of sorted) {
    const size = 2 ** (32 - r.prefix);
    cursor = Math.ceil(cursor / size) * size; // align to the block boundary
    if (cursor + size > parentEnd) {
      throw new Error(`not enough space for "${r.name}" (${r.hosts} hosts need a /${r.prefix})`);
    }
    allocations.push({ name: r.name, hostsRequested: r.hosts, ...describe(cursor >>> 0, r.prefix) });
    cursor += size;
  }
  const used = allocations.reduce((s, a) => s + a.totalAddresses, 0);
  return { allocations, used, free: parentEnd - parentStart - used };
}

/** Does `ip` fall inside network/prefix? */
export function contains(networkIp, prefix, ip) {
  const mask = maskFromPrefix(prefix);
  return ((networkIp & mask) >>> 0) === ((ip & mask) >>> 0);
}
