// My keycards: the ones you made or copied, and the ones you follow.
import { onUser, signIn, signOut, myKeycards, myFollows, loadKeycard, counts, keycardUrl, esc, plural, ROOT, live } from './app.js';

const box = document.getElementById('me');
const VIS = { public: 'Everyone', unlisted: 'Link only', private: 'Just me' };

function tile(k, meta) {
  return `<a class="kc-tile" href="${esc(k.url || keycardUrl(k.id))}"><b>${esc(k.title)}</b>
    ${k.tagline ? `<span class="h">${esc(k.tagline)}</span>` : ''}<span class="m">${meta}</span></a>`;
}

onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Sign-in opens very soon.</p></section>`; return; }
  if (!u) {
    box.innerHTML = `<section class="kc-hero"><h1 class="display kc-title">MY KEYCARDS</h1></section>
      <section class="card"><p class="kc-body">Sign in to see the keycards you've made, copied and followed.</p>
      <button class="kc-btn kc-btn-main" type="button" id="si">Sign in with Google</button></section>`;
    document.getElementById('si').onclick = () => signIn();
    return;
  }
  box.innerHTML = `<section class="kc-hero"><div class="eyebrow">${esc(u.displayName || '')}</div><h1 class="display kc-title">MY KEYCARDS</h1></section>
    <a class="kc-btn kc-btn-main" href="${ROOT}make/">+ Make a keycard</a>
    <section class="card"><div class="kc-h"><span class="label">Made by you</span></div><div id="mine"><div class="kc-empty">Loading…</div></div></section>
    <section class="card"><div class="kc-h"><span class="label">Following</span></div><div id="fol"><div class="kc-empty">Loading…</div></div></section>
    <button class="kc-btn kc-btn-quiet" type="button" id="so">Sign out</button>`;
  document.getElementById('so').onclick = async () => { await signOut(); location.href = ROOT; };

  const mine = await myKeycards().catch(e => { console.error(e); return []; });
  const cs = await Promise.all(mine.map(k => counts(k.id)));
  document.getElementById('mine').innerHTML = mine.length ? mine.map((k, i) => {
    const c = cs[i] || {};
    const bits = [VIS[k.visibility] || '', k.copiedFrom ? `copy of ${esc(k.copiedFrom.title)}` : '',
      c.followers ? plural(c.followers, 'follower') : '', c.copies ? `copied ${plural(c.copies, 'time')}` : ''].filter(Boolean);
    return tile(k, bits.join(' · '));
  }).join('') : `<div class="kc-empty">Nothing yet. Make one about something you know, or copy one you like and make it yours.</div>`;

  const ids = await myFollows().catch(() => []);
  const fol = (await Promise.all(ids.map(id => loadKeycard(id).catch(() => null)))).filter(Boolean);
  document.getElementById('fol').innerHTML = fol.length
    ? fol.map(k => tile(k, esc(k.curator || k.ownerName ? 'by ' + (k.curator || k.ownerName) : (k.subject || '')))).join('')
    : `<div class="kc-empty">Follow a keycard to keep up with it here.</div>`;
});
