import { getStore } from '@netlify/blobs';
import { cleanBody, applyEvent } from '../lib/pilot.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const hits = new Map();

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  const ip = req.headers.get('x-nf-client-connection-ip') || 'x';
  const h = hits.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - h.t > 60000) { h.n = 0; h.t = Date.now(); }
  if (++h.n > 60) return json({ ok: false }, 429);
  hits.set(ip, h);
  let body;
  try { const raw = await req.text(); if (raw.length > 3000) return json({ ok: false }, 413); body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
  const e = cleanBody(body);
  if (!e) return json({ ok: false }, 400);
  try {
    const store = getStore({ name: 'densau-pilot', consistency: 'strong' });
    const key = 'p-' + e.pid;
    if (e.evt === 'delete') { await store.delete(key); return json({ ok: true }); }
    const rec = applyEvent(await store.get(key, { type: 'json' }), e);
    await store.setJSON(key, rec);
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false }, 500);
  }
};
