// Mine: the keycards you made or copied, and the ones you follow.
import { onUser, signIn, signOut, myKeycards, myFollows, loadKeycard, keycardUrl, tileHTML, catOf, esc, ROOT, live } from './app.js';

const box = document.getElementById('me');
const VIS = { public: 'Everyone', unlisted: 'Link only', private: 'Just me' };

onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Sign-in opens very soon.</p></section>`; return; }
  if (!u) {
    box.innerHTML = `<section class="disc-h"><h1 class="display">MINE</h1></section>
      <section class="card"><p class="kc-body">Sign in to keep the keycards you make, copy and follow in one place.</p>
      <button class="kc-btn kc-btn-main" type="button" id="si">Sign in with Google</button></section>`;
    document.getElementById('si').onclick = () => signIn();
    return;
  }
  box.innerHTML = `<section class="disc-h"><h1 class="display">MINE</h1></section>
    <div class="sec-l">Made by you</div><div class="grid" id="mine"><div class="grid-empty">Loading…</div></div>
    <div class="sec-l">Following</div><div class="grid" id="fol"><div class="grid-empty">Loading…</div></div>
    <p class="kc-fine" style="text-align:center">Signed in as ${esc(u.displayName || u.email || '')} · <a href="#" id="so" style="color:var(--muted)">Sign out</a></p>`;
  document.getElementById('so').onclick = async e => { e.preventDefault(); await signOut(); location.href = ROOT; };

  const mine = await myKeycards().catch(e => { console.error(e); return []; });
  document.getElementById('mine').innerHTML = mine.length
    ? mine.map(k => tileHTML({ url: keycardUrl(k.id), cat: catOf(k.subject), title: k.title, mine: true,
        line: k.copiedFrom && !k.edited ? `Copy of ${k.copiedFrom.by}'s` : '', by: VIS[k.visibility] || '' })).join('')
    : `<div class="grid-empty">Nothing yet. Tap <b>Make</b> below, or copy a keycard you like on Discover.</div>`;

  const ids = await myFollows().catch(() => []);
  const fol = (await Promise.all(ids.map(id => loadKeycard(id).catch(() => null)))).filter(Boolean);
  document.getElementById('fol').innerHTML = fol.length
    ? fol.map(k => tileHTML({ url: k.url, cat: catOf(k.subject), title: k.title,
        line: k.status || '', by: (k.curator || k.ownerName) ? 'by ' + (k.curator || k.ownerName) : 'Live' })).join('')
    : `<div class="grid-empty">Follow a keycard and it shows up here.</div>`;
});
