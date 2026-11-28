// Pure logic for the DenSau pilot counters (no I/O, easy to test).
const EVENTS = new Set(['visit','demo','pilot_start','sync','subview','paytry','want','preorder','feedback','report','ics','delete','family']);
const num = (v, max = 100000) => { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0; };
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

export function cleanBody(b) {
  if (!b || typeof b !== 'object') return null;
  const pid = String(b.pid || '');
  if (!/^[a-z0-9]{6,16}$/.test(pid)) return null;
  if (!EVENTS.has(b.evt)) return null;
  return {
    pid, evt: b.evt,
    lang: b.lang === 'ru' ? 'ru' : 'kk',
    mode: ['pilot', 'demo', 'user'].includes(b.mode) ? b.mode : 'user',
    start: num(b.start, 4e12), day: num(b.day, 400),
    planned: num(b.planned), taken: num(b.taken), rel: num(b.rel), meds: num(b.meds, 200),
    hasRel: !!b.hasRel,
    name: str(b.name, 60), phone: str(b.phone, 20).replace(/[^\d+ ]/g, ''),
    rate: num(b.rate, 5), text: str(b.text, 300),
  };
}

export function applyEvent(rec, e, now = Date.now()) {
  const r = rec || { pid: e.pid, first: now, last: now, visits: 0, days: [], lang: e.lang, flags: {}, counts: {} };
  r.last = now; r.lang = e.lang; r.mode = e.mode;
  r.counts[e.evt] = (r.counts[e.evt] || 0) + 1;
  const dk = dayKey(now);
  if (!r.days.includes(dk)) { r.days.push(dk); if (r.days.length > 60) r.days.shift(); }
  if (e.evt === 'visit') r.visits++;
  if (e.evt === 'demo') r.flags.demo = true;
  if (e.evt === 'pilot_start') { r.flags.pilot = true; r.pilotStart = e.start || now; }
  if (e.evt === 'subview') r.flags.subview = true;
  if (e.evt === 'paytry') r.flags.paytry = true;
  if (e.evt === 'want') r.flags.want = true;
  if (e.evt === 'ics') r.flags.ics = true;
  if (e.evt === 'family') r.flags.family = true;
  if (e.evt === 'report') r.flags.report = true;
  if (e.mode === 'pilot' && ['pilot_start', 'sync', 'want', 'preorder', 'report', 'ics'].includes(e.evt)) {
    r.stats = { day: e.day, planned: e.planned, taken: e.taken, rel: e.rel, meds: e.meds, hasRel: e.hasRel };
    if (e.start) r.pilotStart = e.start;
  }
  if (e.evt === 'preorder' && e.name && e.phone) { r.flags.want = true; r.flags.preorder = true; r.preorder = { name: e.name, phone: e.phone, ts: now }; }
  if (e.evt === 'feedback') { r.flags.feedback = true; r.feedback = { rate: e.rate, text: e.text, ts: now }; }
  return r;
}

export function summarize(records) {
  const t = { visitors: 0, demo: 0, pilotStarted: 0, pilotActive: 0, withRelative: 0, subview: 0, paytry: 0, want: 0, preorder: 0, ics: 0, family: 0, report: 0, feedbackCount: 0, feedbackAvg: 0, planned: 0, taken: 0, rel: 0, adherence: 0 };
  const byDay = {}; const pilots = []; const waitlist = []; const feedback = []; let rsum = 0;
  for (const r of records) {
    t.visitors++;
    const f = r.flags || {};
    if (f.demo) t.demo++;
    if (f.pilot) {
      t.pilotStarted++;
      const s = r.stats || {};
      if (s.taken > 0) t.pilotActive++;
      if (s.hasRel) t.withRelative++;
      t.planned += s.planned || 0; t.taken += s.taken || 0; t.rel += s.rel || 0;
      pilots.push({ pid: r.pid, code: r.pid.slice(0, 6).toUpperCase(), start: r.pilotStart || r.first, last: r.last, day: s.day || 0, planned: s.planned || 0, taken: s.taken || 0, rel: s.rel || 0, meds: s.meds || 0, hasRel: !!s.hasRel, want: !!f.want, preorder: !!f.preorder, ics: !!f.ics, lang: r.lang });
    }
    if (f.subview) t.subview++;
    if (f.paytry) t.paytry++;
    if (f.want) t.want++;
    if (f.preorder) t.preorder++;
    if (f.ics) t.ics++;
    if (f.family) t.family++;
    if (f.report) t.report++;
    if (r.preorder) waitlist.push({ code: r.pid.slice(0, 6).toUpperCase(), ...r.preorder });
    if (r.feedback) { t.feedbackCount++; rsum += r.feedback.rate || 0; feedback.push({ code: r.pid.slice(0, 6).toUpperCase(), ...r.feedback }); }
    for (const d of r.days || []) { byDay[d] = byDay[d] || { visitors: 0, pilotStarts: 0 }; byDay[d].visitors++; }
    if (f.pilot && r.pilotStart) { const d = dayKey(r.pilotStart); byDay[d] = byDay[d] || { visitors: 0, pilotStarts: 0 }; byDay[d].pilotStarts++; }
  }
  t.adherence = t.planned ? Math.round(t.taken / t.planned * 100) : 0;
  const rated = feedback.filter(x => x.rate).length;
  t.feedbackAvg = rated ? Math.round(feedback.reduce((a, x) => a + (x.rate || 0), 0) / rated * 10) / 10 : 0;
  pilots.sort((a, b) => b.last - a.last); waitlist.sort((a, b) => b.ts - a.ts); feedback.sort((a, b) => b.ts - a.ts);
  return { totals: t, byDay, pilots, waitlist, feedback, generated: Date.now() };
}

const hm = (v) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : '');
const ymd = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '');
export function sanitizeFamily(d) {
  if (!d || typeof d !== 'object') return null;
  const date = ymd(d.date);
  if (!date) return null;
  const show = !!d.show;
  const doses = (Array.isArray(d.doses) ? d.doses : []).slice(0, 24).map((x) => ({
    t: hm(x && x.t) || '00:00', n: show ? str(x && x.n, 70) : '', s: x && x.s ? 1 : 0,
    at: hm(x && x.at), by: x && x.by === 'rel' ? 'rel' : 'self',
  }));
  const week = (Array.isArray(d.week) ? d.week : []).slice(0, 7)
    .map((x) => ({ d: ymd(x && x.d), p: num(x && x.p, 50), t: num(x && x.t, 50) })).filter((x) => x.d);
  const tzo = Math.max(-720, Math.min(840, Math.round(Number(d.tzo) || 0)));
  return { name: str(d.name, 40), show, date, tzo, doses, week };
}
