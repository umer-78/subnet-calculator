import { parseCidr, describe, split, vlsm } from './ipv4.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let current = null;

function renderFacts(d) {
  const rows = [
    ['Network', `${d.cidr}`, true],
    ['Usable hosts', fmt(d.usableHosts), true],
    ['Host range', d.usableHosts > 1 ? `${d.firstHost} – ${d.lastHost}` : d.firstHost],
    ['Broadcast', d.broadcast ?? 'none (/31 or /32)'],
    ['Subnet mask', d.mask],
    ['Wildcard mask', d.wildcard],
    ['Total addresses', fmt(d.totalAddresses)],
    ['Address type', d.type],
    ['Class', d.ipClass],
    ['Binary mask', d.binaryMask],
    ['Address in hex', d.hex],
  ];
  $('facts').innerHTML = rows
    .map(([k, v, big]) => `<div><dt>${esc(k)}</dt><dd class="${big ? 'big' : ''}">${esc(v)}</dd></div>`)
    .join('');
}

function fillPrefixes(prefix) {
  const sel = $('newPrefix');
  const keep = Number(sel.value);
  sel.innerHTML = '';
  for (let p = prefix + 1; p <= Math.min(32, prefix + 16); p++) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = `/${p}: ${fmt(2 ** (p - prefix))} subnets`;
    sel.append(opt);
  }
  sel.disabled = prefix >= 32;
  sel.value = keep > prefix && keep <= prefix + 16 ? keep : Math.min(32, prefix + 2);
}

function calculate() {
  $('calcError').textContent = '';
  try {
    const { ip, prefix } = parseCidr($('cidr').value);
    current = { ip, prefix };
    renderFacts(describe(ip, prefix));
    fillPrefixes(prefix);
    history.replaceState(null, '', `#${encodeURIComponent($('cidr').value.trim())}`);
    return true;
  } catch (err) {
    $('calcError').textContent = err.message;
    return false;
  }
}

function renderSplit() {
  $('splitError').textContent = '';
  if (!current) return;
  try {
    const r = split(current.ip, current.prefix, Number($('newPrefix').value), 256);
    $('splitSummary').textContent = `${fmt(r.count)} subnets of ${fmt(r.subnets[0].totalAddresses)} addresses each` +
      (r.truncated ? ' (first 256 shown)' : '');
    $('splitTable').tBodies[0].innerHTML = r.subnets.map((s) => `<tr>
      <td class="mono">${s.cidr}</td><td>${fmt(s.usableHosts)}</td>
      <td class="mono">${s.firstHost} – ${s.lastHost}</td><td class="mono">${s.broadcast ?? '—'}</td></tr>`).join('');
    $('splitTable').hidden = false;
  } catch (err) {
    $('splitError').textContent = err.message;
  }
}

function renderVlsm() {
  $('vlsmError').textContent = '';
  $('vlsmTable').hidden = true;
  $('vlsmSummary').textContent = '';
  if (!current) return;
  try {
    const reqs = $('reqs').value.split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
      const m = line.match(/^(.*?)[,\s]+(\d+)$/);
      if (!m) throw new Error(`Line ${i + 1}: expected "name, hosts"`);
      return { name: m[1].trim() || `Subnet ${i + 1}`, hosts: Number(m[2]) };
    });
    if (!reqs.length) throw new Error('Add at least one requirement.');
    const r = vlsm(current.ip, current.prefix, reqs);
    $('vlsmSummary').textContent = `${fmt(r.used)} addresses allocated, ${fmt(r.free)} left in ${describe(current.ip, current.prefix).cidr}`;
    $('vlsmTable').tBodies[0].innerHTML = r.allocations.map((a) => `<tr>
      <td>${esc(a.name)}</td><td>${fmt(a.hostsRequested)}</td><td class="mono">${a.cidr}</td>
      <td>${fmt(a.usableHosts)}</td><td class="mono">${a.firstHost} – ${a.lastHost}</td></tr>`).join('');
    $('vlsmTable').hidden = false;
  } catch (err) {
    $('vlsmError').textContent = err.message;
  }
}

$('calcForm').addEventListener('submit', (e) => { e.preventDefault(); if (calculate()) { renderSplit(); renderVlsm(); } });
$('splitForm').addEventListener('submit', (e) => { e.preventDefault(); renderSplit(); });
$('vlsmForm').addEventListener('submit', (e) => { e.preventDefault(); renderVlsm(); });

if (location.hash.length > 1) $('cidr').value = decodeURIComponent(location.hash.slice(1));
if (calculate()) { renderSplit(); renderVlsm(); }
