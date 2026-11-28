import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';
import { summarize } from '../lib/pilot.mjs';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async (req) => {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return json({ ok: false, error: 'no_password_set' }, 503);
  if (req.method !== 'POST') return json({ ok: false }, 405);
  let given = '';
  try { given = (await req.json()).password || ''; } catch { /* ignore */ }
  if (!same(given, pw)) { await new Promise(r => setTimeout(r, 800)); return json({ ok: false, error: 'bad_password' }, 401); }
  try {
    const store = getStore({ name: 'densau-pilot', consistency: 'strong' });
    const { blobs } = await store.list({ prefix: 'p-' });
    const recs = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
    const fl = (await store.list({ prefix: 'f-' })).blobs;
    const fr = (await Promise.all(fl.map(b => store.get(b.key, { type: 'json' }).catch(() => null)))).filter(Boolean);
    const now = Date.now();
    const fam = { created: fr.length, active: fr.filter(x => x.exp > now).length, viewed: fr.filter(x => (x.views || 0) > 0).length, views: fr.reduce((a, x) => a + (x.views || 0), 0) };
    return json({ ok: true, ...summarize(recs), fam });
  } catch (err) {
    return json({ ok: false, error: 'store' }, 500);
  }
};
