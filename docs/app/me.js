// Mine: the keycards you made or copied, and the ones you follow.
import { onUser, signIn, signOut, myKeycards, myFollows, loadKeycard, keycardUrl, tileHTML, hasLive, catOf, esc, ROOT, live, getWeekly, setWeekly, toast, isAdmin, betaData, ago, myName, setMyName } from './app.js';

const box = document.getElementById('me');
const VIS = { public: 'Everyone', unlisted: 'Link only', private: 'Just me' };

onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Sign-in opens very soon.</p></section>`; return; }
  if (!u) {
    box.innerHTML = `<section class="disc-h"><h1 class="display">MINE</h1></section>
      <section class="card"><p class="kc-body">Your keycards live here: the ones you make, the copies you've made your own, and the ones you follow for updates.</p>
      <button class="kc-btn kc-btn-main" type="button" id="si">Sign in with Google</button></section>`;
    document.getElementById('si').onclick = () => signIn();
    return;
  }
  box.innerHTML = `<section class="disc-h"><h1 class="display">MINE</h1><p class="kc-fine" style="margin:4px 0 0">Everything you've made, copied and followed, in one place.</p></section>
    <div class="sec-l">Made or copied by you</div><div class="grid" id="mine"><div class="grid-empty">Loading…</div></div>
    <div class="sec-l">Following</div><div class="grid" id="fol"><div class="grid-empty">Loading…</div></div>
    ${isAdmin() ? '<div class="sec-l">Beta results <small style="text-transform:none;letter-spacing:0">only you see this</small></div><div id="beta" class="card"><p class="kc-fine">Loading…</p></div>' : ''}
    <div class="kc-toggle"><span><b>Your name on keycards</b><small>How friends see you, e.g. "Sid".</small></span>
      <span style="display:flex;gap:6px;align-items:center"><input id="nm" maxlength="40" style="width:120px;font:500 15px Inter,system-ui,sans-serif;color:var(--ink);background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px 10px">
      <button class="kc-btn" type="button" id="nmsave" style="flex:0 0 auto;min-height:38px">Save</button></span></div>
    <label class="kc-toggle"><span><b>Weekly email</b><small>One short note on Sundays: what's coming up and what changed.</small></span>
      <input type="checkbox" id="wk" checked></label>
    <p class="kc-fine" style="text-align:center">Signed in as ${esc(u.displayName || u.email || '')} · <a href="#" id="so" style="color:var(--muted)">Sign out</a></p>`;
  const nm = document.getElementById('nm'); nm.value = myName();
  document.getElementById('nmsave').onclick = async () => { await setMyName(nm.value); toast(`Your keycards now say "${myName()}"`); };
  const wk = document.getElementById('wk');
  getWeekly().then(v => { wk.checked = v !== false; });
  wk.onchange = async () => { await setWeekly(wk.checked); toast(wk.checked ? 'Weekly email on' : 'Weekly email off'); };
  document.getElementById('so').onclick = async e => { e.preventDefault(); await signOut(); location.href = ROOT; };

  const mine = await myKeycards().catch(e => { console.error(e); return []; });
  document.getElementById('mine').innerHTML = mine.length
    ? mine.map(k => tileHTML({ url: keycardUrl(k.id), cat: catOf(k.subject), title: k.title, mine: true, shape: k.shape, live: hasLive(k),
        line: k.copiedFrom && !k.edited ? `Copy of ${k.copiedFrom.by}'s` : '', by: VIS[k.visibility] || '' })).join('')
    : `<div class="grid-empty">Nothing yet. Tap <b>Make</b> below, or copy a keycard you like on Discover.</div>`;

  const ids = await myFollows().catch(() => []);
  const fol = (await Promise.all(ids.map(id => loadKeycard(id).catch(() => null)))).filter(Boolean);
  document.getElementById('fol').innerHTML = fol.length
    ? fol.map(k => tileHTML({ url: k.url, cat: catOf(k.subject), title: k.title, shape: k.shape, live: hasLive(k),
        line: k.status || '', by: (k.curator || k.ownerName) ? 'by ' + (k.curator || k.ownerName) : '' })).join('')
    : `<div class="grid-empty">Follow a keycard and it shows up here.</div>`;
  if (isAdmin()) betaResults().catch(e => { console.error(e); document.getElementById('beta').innerHTML = '<p class="kc-fine">Couldn\'t load results.</p>'; });
});

// ---------- Sid's beta results: the questions the beta is meant to answer ----------
async function betaResults() {
  const d = await betaData(); const el = document.getElementById('beta'); if (!d || !el) return;
  const ms = t => (t && t.toMillis ? t.toMillis() : 0);
  const by = (list, key) => list.reduce((m, x) => ((m[x[key]] = m[x[key]] || []).push(x), m), {});
  const live = id => /^site:topic-/.test(id);
  const sum = (list, key, pred) => list.filter(x => pred(x[key] || '')).length;
  const made = d.keycards.filter(k => !k.copiedFrom || k.edited);
  const madeOwn = d.keycards.filter(k => !k.copiedFrom);
  const starters = d.users.filter(u => u.lastStart);
  const row = (a, b) => `<div class="kc-row"><span class="kc-row-t">${a}</span><span class="kc-row-m">${b}</span></div>`;
  const pct = (n, of) => of ? ` (${Math.round(100 * n / of)}%)` : '';
  const people = d.users.length;

  // The headline numbers
  let html = `<div class="kc-fine" style="padding-bottom:6px">${people} signed in</div>
    ${row('Started making one', `${starters.length}${pct(starters.length, people)}`)}
    ${row('Made their own', `${new Set(madeOwn.map(k => k.owner)).size}${pct(new Set(madeOwn.map(k => k.owner)).size, people)} · goal: 5 of 15`)}
    ${row('Copied one', `${new Set(d.copies.map(c => c.uid)).size}${pct(new Set(d.copies.map(c => c.uid)).size, people)}`)}
    ${row('Copies they changed', `${d.keycards.filter(k => k.copiedFrom && k.edited).length} of ${d.keycards.filter(k => k.copiedFrom).length}`)}
    ${row('Follows', String(d.follows.length))}`;
  const times = made.map(k => (k.made || {}).secs).filter(Boolean).sort((a, b) => a - b);
  if (times.length) html += row('Time to make one (middle)', `${Math.round(times[Math.floor(times.length / 2)] / 60)} min`);
  const hows = by(made.filter(k => k.made), 'made'); const howCount = {};
  made.forEach(k => { const h = (k.made || {}).how; if (h) howCount[h] = (howCount[h] || 0) + 1; });
  if (Object.keys(howCount).length) html += row('How they made them', Object.entries(howCount).map(([h, n]) => `${h} ${n}`).join(' · '));
  // The creation hook: do people play with the reveal, share what they made, and make another?
  const ivMade = madeOwn.filter(k => (k.made || {}).how === 'interview');
  if (ivMade.length) html += row('Interview keycards: tried another take', `${ivMade.filter(k => (k.made.takes || 1) > 1).length} of ${ivMade.length}`)
    + row('Tweaked before saving', `${ivMade.filter(k => k.made.tweaked).length} of ${ivMade.length}`);
  const tms = t => t && t.toMillis ? t.toMillis() : (t && t.__ts) || 0;
  const byOwner = {};
  madeOwn.forEach(k => { const t = tms(k.created); if (t) (byOwner[k.owner] = byOwner[k.owner] || []).push(t); });
  const makers = Object.keys(byOwner).length;
  if (makers) {
    const second = Object.values(byOwner).filter(ts => { ts.sort((a, b) => a - b); return ts.length > 1 && ts[1] - ts[0] < 864e5; }).length;
    const sharers = d.users.filter(u => (u.shared || []).some(id => madeOwn.some(k => k.owner === u.id && k.id === id))).length;
    html += row('Made a second keycard within a day', `${second} of ${makers} makers`) + row('Shared their own keycard', `${sharers} of ${makers} makers`);
  }

  // Coming back: did people return on another day, and a week later? (Opens are recorded once a day per keycard.)
  const daysBy = {};
  d.opens.forEach(o => { if (o.uid && o.at && o.at.toMillis) (daysBy[o.uid] = daysBy[o.uid] || new Set()).add(Math.floor(o.at.toMillis() / 864e5)); });
  const visitors = Object.keys(daysBy).length;
  const back = Object.values(daysBy).filter(x => x.size >= 2).length;
  const week = Object.values(daysBy).filter(x => { const a = [...x]; return Math.max(...a) - Math.min(...a) >= 7; }).length;
  html += row('Came back another day', `${back} of ${visitors} signed-in visitors`) + row('Came back a week later', `${week} of ${visitors}`);

  // Live vs personal: is it drifting into AI news?
  html += `<div class="kc-fine" style="padding:12px 0 4px">Live vs personal keycards</div>
    ${row('Opens', `${sum(d.opens, 'keycard', live)} live · ${sum(d.opens, 'keycard', x => !live(x))} personal`)}
    ${row('Follows', `${sum(d.follows, 'keycard', live)} live · ${sum(d.follows, 'keycard', x => !live(x))} personal`)}
    ${row('Copies', `${sum(d.copies, 'from', live)} live · ${sum(d.copies, 'from', x => !live(x))} personal`)}`;

  // What people asked for that nobody's made yet: the seeding list.
  const asks = d.users.flatMap(u => (u.asks || []).map(a => ({ ...a, who: u.name || 'Someone' })));
  if (asks.length) {
    const byTopic = {};
    asks.forEach(a => { const t = a.topic.trim().toLowerCase(); (byTopic[t] = byTopic[t] || { topic: a.topic, who: [] }).who.push(a.who); });
    html += `<div class="kc-fine" style="padding:12px 0 4px">Asked for (make these, or ask a friend who knows)</div>` +
      Object.values(byTopic).sort((a, b) => b.who.length - a.who.length).map(x => row(esc(x.topic), `${x.who.length} · ${esc([...new Set(x.who)].slice(0, 3).join(', '))}`)).join('');
  }

  // Each keycard
  const ids = [...new Set([...d.opens.map(o => o.keycard), ...d.follows.map(f => f.keycard), ...d.copies.map(c => c.from)])];
  const kcTitle = {}; d.keycards.forEach(k => { kcTitle['user:' + k.id] = k.title; });
  await Promise.all(ids.filter(id => id.startsWith('site:') && !kcTitle[id]).map(async id => { try { kcTitle[id] = (await loadKeycard(id)).title; } catch (e) { kcTitle[id] = id.slice(5); } }));
  const O = by(d.opens, 'keycard'), F = by(d.follows, 'keycard'), C = by(d.copies, 'from');
  const rows = ids.map(id => ({ id, o: (O[id] || []).length, f: (F[id] || []).length, c: (C[id] || []).length }))
    .sort((a, b) => (b.c - a.c) || (b.f - a.f) || (b.o - a.o));
  if (rows.length) html += `<div class="kc-fine" style="padding:12px 0 4px">Keycards</div>` + rows.map(r =>
    `<a class="kc-row" href="${esc(keycardUrl(r.id))}"><span class="kc-row-t">${esc(kcTitle[r.id] || r.id)}</span><span class="kc-row-m">${r.o} open${r.o === 1 ? '' : 's'} · ${r.f} following · ${r.c} ${r.c === 1 ? 'copy' : 'copies'}</span></a>`).join('');

  // Each person
  const mk = by(d.keycards, 'owner'), cp = by(d.copies, 'uid'), fl = by(d.follows, 'uid');
  html += `<div class="kc-fine" style="padding:12px 0 4px">People</div>` + d.users.sort((a, b) => ms(b.seen) - ms(a.seen)).map(u => {
    const own = (mk[u.id] || []).filter(k => !k.copiedFrom).length, cps = (cp[u.id] || []).length, fol = (fl[u.id] || []).length;
    const bits = [own ? `made ${own}` : (u.lastStart ? `started (${u.lastStart.how})` : ''), cps ? `copied ${cps}` : '', fol ? `following ${fol}` : ''].filter(Boolean);
    return row(esc(u.name || 'Someone'), (bits.join(' · ') || 'just looked') + (u.seen ? ` · seen ${esc(ago(new Date(ms(u.seen)).toISOString()))}` : ''));
  }).join('');
  el.innerHTML = html;
}
