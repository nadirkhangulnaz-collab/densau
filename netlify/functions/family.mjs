import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { sanitizeFamily } from '../lib/pilot.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const hash = (x) => createHash('sha256').update(String(x)).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const TTL = 30 * 24 * 3600 * 1000;
const hits = new Map();

export default async (req) => {
  const ip = req.headers.get('x-nf-client-connection-ip') || 'x';
  const h = hits.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - h.t > 60000) { h.n = 0; h.t = Date.now(); }
  if (++h.n > 90) return json({ ok: false }, 429);
  hits.set(ip, h);
  const store = getStore({ name: 'densau-pilot', consistency: 'strong' });
  try {
    if (req.method === 'GET') {
      const u = new URL(req.url);
      const fid = u.searchParams.get('fid') || '';
      if (!/^[a-z0-9]{12,24}$/.test(fid)) return json({ ok: false }, 400);
      const rec = await store.get('f-' + fid, { type: 'json' });
      if (!rec || rec.exp < Date.now()) return json({ ok: false, error: 'gone' }, 404);
      if (u.searchParams.get('first') === '1') { rec.views = (rec.views || 0) + 1; rec.lastView = Date.now(); await store.setJSON('f-' + fid, rec); }
      return json({ ok: true, data: rec.data, updated: rec.updated });
    }
    if (req.method !== 'POST') return json({ ok: false }, 405);
    const raw = await req.text();
    if (raw.length > 12000) return json({ ok: false }, 413);
    let b; try { b = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
    const fid = String(b.fid || ''), sec = String(b.sec || '');
    if (!/^[a-z0-9]{12,24}$/.test(fid) || !/^[a-z0-9]{16,40}$/.test(sec)) return json({ ok: false }, 400);
    const key = 'f-' + fid;
    const rec = await store.get(key, { type: 'json' });
    if (rec && !same(hash(sec), rec.h)) return json({ ok: false }, 403);
    if (b.action === 'revoke') { if (rec) await store.delete(key); return json({ ok: true }); }
    if (b.action !== 'publish') return json({ ok: false }, 400);
    const data = sanitizeFamily(b.data);
    if (!data) return json({ ok: false }, 400);
    const now = Date.now();
    await store.setJSON(key, { h: hash(sec), created: (rec && rec.created) || now, updated: now, exp: now + TTL, views: (rec && rec.views) || 0, lastView: (rec && rec.lastView) || 0, data });
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false }, 500);
  }
};
