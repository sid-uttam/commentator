// Commentator beta: sign-in, follow, copy and saving keycards (Firebase), shared by every page.
// Firebase is loaded from Google's CDN only when the site has a config (app/config.js).
import { firebaseConfig } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/11.0.2/';
export const ROOT = new URL('../', import.meta.url).href;   // the site root, wherever we're hosted

// ---------- Firebase ----------
let fb = null;
export const ready = (async () => {
  if (!firebaseConfig) return null;
  const [appMod, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { auth: A.getAuth(app), db: F.getFirestore(app), A, F };
  return fb;
})().catch(err => { console.error('Firebase failed to load', err); return null; });

export const live = () => !!firebaseConfig;

// ---------- who's signed in ----------
let me;                       // undefined = not known yet, null = signed out
const watchers = [];
export function onUser(cb) { watchers.push(cb); if (me !== undefined) cb(me); }
function setUser(u) { me = u; watchers.forEach(cb => { try { cb(u); } catch (e) { console.error(e); } }); }
export const user = () => me;

ready.then(f => {
  if (!f) return setUser(null);
  f.A.getRedirectResult(f.auth).catch(() => {});
  f.A.onAuthStateChanged(f.auth, async u => {
    if (u && !sessionStorage.getItem('kc-profile-' + u.uid)) {
      try {
        await f.F.setDoc(f.F.doc(f.db, 'users', u.uid),
          { name: u.displayName || 'Someone', photo: u.photoURL || '', seen: f.F.serverTimestamp() }, { merge: true });
        sessionStorage.setItem('kc-profile-' + u.uid, '1');
      } catch (e) { console.warn('profile save failed', e); }
    }
    setUser(u);
    if (u) runPending(u);
  });
});

export async function signIn() {
  const f = await ready;
  if (!f) { toast('Sign-in opens very soon.'); return null; }
  const provider = new f.A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const r = await f.A.signInWithPopup(f.auth, provider);
    return r.user;
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      await f.A.signInWithRedirect(f.auth, provider);       // comes back to this page; the pending action runs then
    } else if (!['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e.code)) {
      console.error(e); toast("Couldn't sign you in. Try again?");
    }
    return null;
  }
}
export async function signOut() { const f = await ready; if (f) await f.A.signOut(f.auth); }

// Something the person asked for before signing in (follow, copy), done once they're in.
const PENDING = 'kc-pending';
const actions = {};
export function registerAction(name, fn) { actions[name] = fn; }
function runPending(u) {
  let p; try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (e) { p = null; }
  if (!p || !actions[p.name] || Date.now() - p.at > 10 * 60000) return;
  sessionStorage.removeItem(PENDING);
  actions[p.name](...(p.args || []));
}
export async function withUser(name, ...args) {
  if (me) return actions[name](...args);
  sessionStorage.setItem(PENDING, JSON.stringify({ name, args, at: Date.now() }));
  await signIn();                // onAuthStateChanged runs the pending action
}

// ---------- keycards ----------
// Ids: "site:<slug>" for keycards on this site, "user:<doc id>" for keycards people made.
export function keycardUrl(id) {
  return id.startsWith('site:') ? ROOT + id.slice(5) + '/' : ROOT + 'k/?id=' + encodeURIComponent(id.slice(5));
}
export const makeUrl = (docId, extra = '') => ROOT + 'make/' + (docId ? '?id=' + encodeURIComponent(docId) + extra : '');

export async function loadKeycard(id) {
  if (id.startsWith('site:')) {
    const r = await fetch(ROOT + id.slice(5) + '/keycard.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('not found');
    return { ...(await r.json()), id, url: keycardUrl(id) };
  }
  const f = await ready;
  if (!f) throw new Error('offline');
  const snap = await f.F.getDoc(f.F.doc(f.db, 'keycards', id.slice(5)));
  if (!snap.exists()) throw new Error('not found');
  return { ...snap.data(), id, docId: snap.id, url: keycardUrl(id) };
}

const clean = list => (list || []).map(s => ({
  title: s.title || '', items: (s.items || []).map(i => ({ name: i.name || '', why: i.why || '', url: i.url || '' }))
}));

export async function copyKeycard(id) {
  const f = await ready; if (!f || !me) return;
  toast('Making your copy…');
  const src = await loadKeycard(id);
  const by = src.curator || src.ownerName || 'Commentator';
  const data = {
    owner: me.uid, ownerName: me.displayName || 'Someone', ownerPhoto: me.photoURL || '',
    title: (src.title || '').replace(/\s+by\s+[^]+$/i, '').trim() || src.title, tagline: src.tagline || '', subject: src.subject || '',
    sections: clean(src.sections), sources: (src.sources || []).map(s => ({ name: s.name || '', why: s.why || '', url: s.url || '' })),
    instruction: src.instruction || '', visibility: 'unlisted', edited: false,
    copiedFrom: { id, title: src.title, by, live: src.copiedFrom && src.copiedFrom.live || (id.startsWith('site:') ? id : null) },
    created: f.F.serverTimestamp(), updated: f.F.serverTimestamp(),
  };
  const ref = await f.F.addDoc(f.F.collection(f.db, 'keycards'), data);
  await f.F.addDoc(f.F.collection(f.db, 'copies'), { from: id, to: 'user:' + ref.id, uid: me.uid, at: f.F.serverTimestamp() }).catch(() => {});
  location.href = makeUrl(ref.id, '&copied=1');
}
registerAction('copy', copyKeycard);

export async function saveKeycard(docId, data) {
  const f = await ready;
  const body = { ...data, owner: me.uid, ownerName: me.displayName || 'Someone', ownerPhoto: me.photoURL || '',
                 updated: f.F.serverTimestamp() };
  if (docId) { await f.F.setDoc(f.F.doc(f.db, 'keycards', docId), body, { merge: true }); return docId; }
  body.created = f.F.serverTimestamp();
  return (await f.F.addDoc(f.F.collection(f.db, 'keycards'), body)).id;
}
export async function deleteKeycard(docId) { const f = await ready; await f.F.deleteDoc(f.F.doc(f.db, 'keycards', docId)); }

async function list(q) { const f = await ready; return (await f.F.getDocs(q)).docs.map(d => ({ ...d.data(), docId: d.id, id: 'user:' + d.id })); }
export async function myKeycards() {
  const f = await ready; if (!f || !me) return [];
  return (await list(f.F.query(f.F.collection(f.db, 'keycards'), f.F.where('owner', '==', me.uid)))).sort(byUpdated);
}
export async function publicKeycards(n = 40) {
  const f = await ready; if (!f) return [];
  return (await list(f.F.query(f.F.collection(f.db, 'keycards'), f.F.where('visibility', '==', 'public'), f.F.limit(n)))).sort(byUpdated);
}
const ms = t => (t && t.toMillis ? t.toMillis() : 0);
const byUpdated = (a, b) => ms(b.updated) - ms(a.updated);

// ---------- follow & counts ----------
const followId = id => me.uid + '_' + id;
export async function isFollowing(id) {
  const f = await ready; if (!f || !me) return false;
  return (await f.F.getDoc(f.F.doc(f.db, 'follows', followId(id)))).exists();
}
export async function follow(id) {
  const f = await ready;
  await f.F.setDoc(f.F.doc(f.db, 'follows', followId(id)), { uid: me.uid, keycard: id, at: f.F.serverTimestamp() });
}
export async function unfollow(id) { const f = await ready; await f.F.deleteDoc(f.F.doc(f.db, 'follows', followId(id))); }
export async function myFollows() {
  const f = await ready; if (!f || !me) return [];
  const docs = await f.F.getDocs(f.F.query(f.F.collection(f.db, 'follows'), f.F.where('uid', '==', me.uid)));
  return docs.docs.map(d => d.data().keycard);
}
export async function counts(id) {
  const f = await ready; if (!f) return null;
  const n = async (col, field) => (await f.F.getCountFromServer(
    f.F.query(f.F.collection(f.db, col), f.F.where(field, '==', id)))).data().count;
  try { const [followers, copies] = await Promise.all([n('follows', 'keycard'), n('copies', 'from')]); return { followers, copies }; }
  catch (e) { console.warn(e); return null; }
}

// ---------- little UI helpers ----------
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

export function toast(msg) {
  let t = document.querySelector('.kc-toast');
  if (!t) { t = document.createElement('div'); t.className = 'kc-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600);
}

export async function share(title, url) {
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link', url); }
}

// The account button in the top bar of every page.
function mountAccount() {
  document.querySelectorAll('[data-account]').forEach(el => {
    onUser(u => {
      if (u) {
        const initial = esc((u.displayName || '?').trim()[0] || '?');
        el.innerHTML = `<a class="kc-acct" href="${ROOT}me/" aria-label="My keycards">${u.photoURL
          ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : `<span>${initial}</span>`}<b>My keycards</b></a>`;
      } else {
        el.innerHTML = `<button class="kc-signin" type="button">Sign in</button>`;
        el.querySelector('button').onclick = () => signIn();
      }
    });
  });
}

// Follow / copy / share buttons, plus follower and copy counts.
export function mountActions(el, id, opts = {}) {
  const title = opts.title || document.title;
  el.innerHTML = `<div class="kc-act-row">
      <button class="kc-btn kc-btn-main" data-a="follow" type="button">Follow</button>
      <button class="kc-btn" data-a="copy" type="button">${opts.own ? 'Copy' : 'Copy &amp; make it yours'}</button>
      <button class="kc-btn kc-btn-icon" data-a="share" type="button" aria-label="Share">${SHARE_ICON}</button>
    </div><div class="kc-fine kc-counts" aria-live="polite"></div>`;
  const fBtn = el.querySelector('[data-a="follow"]');
  let following = false, changed = 0;     // changed: ignore a slow 'am I following?' answer once they've tapped
  const paint = () => { fBtn.textContent = following ? 'Following ✓' : 'Follow'; fBtn.classList.toggle('on', following); };
  const showCounts = async () => {
    const c = await counts(id); const out = el.querySelector('.kc-counts');
    if (!c || (!c.followers && !c.copies)) { out.textContent = opts.hint || ''; return; }
    out.textContent = [c.followers ? plural(c.followers, 'follower') : '', c.copies ? plural(c.copies, 'copy', 'copies') : '']
      .filter(Boolean).join(' · ');
  };
  registerAction('follow:' + id, async () => { changed++; await follow(id); following = true; paint(); toast("Following. You'll get its updates."); showCounts(); });
  fBtn.onclick = async () => {
    if (!me) return withUser('follow:' + id);
    fBtn.disabled = true; changed++;
    try {
      if (following) { await unfollow(id); following = false; toast('Unfollowed'); }
      else { await follow(id); following = true; toast("Following. You'll get its updates."); }
      paint(); showCounts();
    } catch (e) { console.error(e); toast('Something went wrong. Try again?'); }
    fBtn.disabled = false;
  };
  el.querySelector('[data-a="copy"]').onclick = () => withUser('copy', id).catch(e => { console.error(e); toast("Couldn't copy it. Try again?"); });
  el.querySelector('[data-a="share"]').onclick = () => share(title, opts.url || keycardUrl(id));
  if (opts.own) fBtn.hidden = true;
  onUser(async u => {
    const at = changed;
    const f = u ? await isFollowing(id).catch(() => false) : false;
    if (at === changed) { following = f; paint(); }
  });
  showCounts();
}

const SHARE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>';

// ---------- render a keycard someone made (same look as the site's curated keycards) ----------
export function itemRow(it) {
  const u = safeUrl(it.url);
  const meta = esc(it.why || (u ? new URL(u).hostname.replace(/^www\./, '') : ''));
  return u
    ? `<a class="kc-row" href="${esc(u)}" target="_blank" rel="noopener"><span class="kc-row-t">${esc(it.name || u)}</span>${meta ? `<span class="kc-row-m">${meta}</span>` : ''}</a>`
    : `<div class="kc-row"><span class="kc-row-t">${esc(it.name)}</span>${meta ? `<span class="kc-row-m">${meta}</span>` : ''}</div>`;
}
export function fold(title, rows, open) {
  return `<details class="kc-fold"${open ? ' open' : ''}><summary><span>${esc(title)}</span><span class="kc-count">${rows.length}</span></summary><div class="kc-fold-body">${rows.join('')}</div></details>`;
}
export function briefingCard(b, title, note) {
  if (!b || !b.points || !b.points.length) return '';
  const pt = p => `<li class="kc-pt"><span class="kc-lbl kc-lbl-${esc((p.label || 'reported').replace(/ /g, '-'))}">${esc(p.label || 'reported')}</span> ${esc(p.text)} ${
    (p.sources || []).slice(0, 2).map(s => safeUrl(s.url) ? `<a class="kc-src" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : `<span class="kc-src">${esc(s.name)}</span>`).join(' · ')}</li>`;
  return `<section class="card kc-now"><div class="kc-h"><span class="label">${esc(title)}</span></div>
    ${b.headline ? `<p class="kc-head">${esc(b.headline)}</p>` : ''}<ul class="kc-pts">${b.points.slice(0, 3).map(pt).join('')}</ul>
    ${b.points.length > 3 ? `<details class="kc-more"><summary>${b.points.length - 3} more points</summary><ul class="kc-pts">${b.points.slice(3).map(pt).join('')}</ul></details>` : ''}
    <div class="kc-fine">${esc(note)}</div></section>`;
}

mountAccount();
document.querySelectorAll('[data-keycard]').forEach(el => mountActions(el, el.dataset.keycard, { title: el.dataset.title, hint: el.dataset.hint }));
