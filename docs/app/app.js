// Keycard beta: sign-in, follow, copy and saving keycards (Firebase), shared by every page.
// Firebase is loaded from Google's CDN only when the site has a config (app/config.js).
import * as cfg from './config.js';
const firebaseConfig = cfg.firebaseConfig;
export const aiUrl = cfg.aiUrl || '';

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
let myNameCache = '';
export const myName = () => myNameCache || (me && me.displayName) || 'Someone';
// Change the name shown on your keycards (and on the ones you've already made).
export async function setMyName(name) {
  const f = await ready; name = String(name || '').trim().slice(0, 40); if (!name || !me) return;
  await f.F.setDoc(f.F.doc(f.db, 'users', me.uid), { name, nameSet: true }, { merge: true });
  myNameCache = name; try { sessionStorage.setItem('kc-name-' + me.uid, name); } catch (e) {}
  const mine = await myKeycards().catch(() => []);
  await Promise.all(mine.map(k => f.F.setDoc(f.F.doc(f.db, 'keycards', k.docId), { ownerName: name }, { merge: true }).catch(() => {})));
}
export const isAdmin = () => !!(me && me.email && cfg.adminEmail && me.email === cfg.adminEmail);

ready.then(f => {
  if (!f) return setUser(null);
  f.A.getRedirectResult(f.auth).catch(() => {});
  f.A.onAuthStateChanged(f.auth, async u => {
    if (u) {
      // The name shown on your keycards: your Google name, unless you've chosen one on Mine (nameSet).
      try { myNameCache = sessionStorage.getItem('kc-name-' + u.uid) || ''; } catch (e) {}
      if (!myNameCache || !sessionStorage.getItem('kc-profile-' + u.uid)) {
        try {
          const d = await f.F.getDoc(f.F.doc(f.db, 'users', u.uid));
          const chosen = d.exists() && d.data().nameSet ? d.data().name : '';
          myNameCache = chosen || u.displayName || 'Someone';
          await f.F.setDoc(f.F.doc(f.db, 'users', u.uid),
            { ...(chosen ? {} : { name: myNameCache }), photo: u.photoURL || '', seen: f.F.serverTimestamp(),
              tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || '') }, { merge: true });
          sessionStorage.setItem('kc-profile-' + u.uid, '1'); sessionStorage.setItem('kc-name-' + u.uid, myNameCache);
        } catch (e) { console.warn('profile save failed', e); }
      }
    }
    setUser(u);
    if (u) runPending(u);
  });
});

let signingIn = false;   // one sign-in window at a time, however many taps
export async function signIn() {
  if (signingIn) return null;
  const f = await ready;
  if (!f) { toast('Sign-in opens very soon.'); return null; }
  signingIn = true;
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
  } finally { signingIn = false; }
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
// Signed out and tapped Follow or Copy: say why we need sign-in, and open Google only when they tap
// "Continue" (a direct tap, so popup blockers allow it). The action they wanted runs straight after.
export async function withUser(name, ...args) {
  if (me) return actions[name](...args);
  sessionStorage.setItem(PENDING, JSON.stringify({ name, args, at: Date.now() }));
  const why = name.startsWith('follow') ? ['Sign in to follow', "You'll see its updates on your Mine page, plus one short email on Sundays."]
    : name === 'copy' ? ['Sign in to copy', 'Your copy is saved to your account, credited to the original. Change anything you like.']
    : name.startsWith('ask:') ? ['Sign in to ask', 'Asking uses AI, so it needs a free account. Answers come only from this keycard.']
    : ['Sign in to continue', 'So your keycards are saved and you can share them.'];
  signInSheet(...why);
}
export function signInSheet(title, body) {
  document.querySelector('.kc-sheet')?.remove();
  const el = document.createElement('div');
  el.className = 'kc-sheet';
  el.innerHTML = `<div class="kc-sheet-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <b>${esc(title)}</b><p>${esc(body)}</p>
      <button class="kc-btn kc-btn-main" type="button" data-go>Continue with Google</button>
      <button class="kc-btn kc-btn-quiet" type="button" data-no>Not now</button>
      <small>Free. We only see your name and photo.</small></div>`;
  const close = () => el.remove();
  el.addEventListener('click', e => {
    if (e.target === el || e.target.closest('[data-no]')) { sessionStorage.removeItem(PENDING); sessionStorage.removeItem('kc-make-pending'); close(); }
    if (e.target.closest('[data-go]')) { close(); signIn(); }
  });
  document.body.appendChild(el);
  el.querySelector('[data-go]').focus();
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

// In a copy, everything starts marked as from the original; what the owner adds later isn't.
const clean = list => (list || []).map(s => ({
  title: s.title || '', items: (s.items || []).map(i => ({ name: i.name || '', why: i.why || '', url: i.url || '', copy: i.copy || '', ...(i.type ? { type: i.type } : {}), from: true }))
}));

// A fingerprint of a keycard's contents, to tell a copier when the original has changed.
export function kcHash(k) {
  const pick = i => [i.name || '', i.why || '', i.url || '', i.copy || ''].join('|');
  const txt = JSON.stringify([(k.sections || []).map(s => [s.title || '', (s.items || []).map(pick)]), (k.sources || []).map(pick)]);
  let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h << 5) + h + txt.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function copyKeycard(id) {
  const f = await ready; if (!f || !me) return;
  toast('Making your copy…');
  const src = await loadKeycard(id);
  const by = src.curator || src.ownerName || 'Keycard';
  if (src.owner && src.owner === me.uid) { toast("This one's already yours. Tap Edit to change it."); return null; }
  const data = {
    owner: me.uid, ownerName: myName(), ownerPhoto: me.photoURL || '',
    title: `${myName().split(' ')[0]}'s ${(src.title || '').replace(/\s+by\s+[^]+$/i, '').trim() || src.title}`, tagline: '', subject: catOf(src.subject || ''),
    sections: clean(src.sections), sources: (src.sources || []).map(s => ({ name: s.name || '', why: s.why || '', url: s.url || '', from: true })),
    shape: src.shape || '', tested: src.tested || '', idea: src.idea || '',
    instruction: src.instruction || '', visibility: 'unlisted', edited: false,
    copiedFrom: { id, title: src.title, by, hash: kcHash(src), live: src.copiedFrom && src.copiedFrom.live || (id.startsWith('site:') ? id : null) },
    created: f.F.serverTimestamp(), updated: f.F.serverTimestamp(),
  };
  const ref = await f.F.addDoc(f.F.collection(f.db, 'keycards'), data);
  await f.F.addDoc(f.F.collection(f.db, 'copies'), { from: id, to: 'user:' + ref.id, uid: me.uid, at: f.F.serverTimestamp() }).catch(() => {});
  location.href = keycardUrl('user:' + ref.id) + '&new=1';
}
registerAction('copy', copyKeycard);

export async function saveKeycard(docId, data) {
  const f = await ready;
  const body = { ...data, owner: me.uid, ownerName: myName(), ownerPhoto: me.photoURL || '',
                 updated: f.F.serverTimestamp(), checked: f.F.serverTimestamp() };
  if (docId) { await f.F.setDoc(f.F.doc(f.db, 'keycards', docId), body, { merge: true }); return docId; }
  body.created = f.F.serverTimestamp();
  return (await f.F.addDoc(f.F.collection(f.db, 'keycards'), body)).id;
}
export async function markChecked(docId) { const f = await ready; await f.F.setDoc(f.F.doc(f.db, 'keycards', docId), { checked: f.F.serverTimestamp() }, { merge: true }); }
export const ago = t => {
  const ms = t && t.toMillis ? t.toMillis() : Date.parse(t);
  if (!ms) return '';
  const m = Math.round((Date.now() - ms) / 60000), d = Math.round(m / 1440);
  return m < 60 ? 'just now' : m < 1440 ? Math.round(m / 60) + 'h ago' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : d < 60 ? 'a month ago' : Math.round(d / 30) + ' months ago';
};
export const ageDays = t => { const ms = t && t.toMillis ? t.toMillis() : Date.parse(t); return ms ? (Date.now() - ms) / 864e5 : 0; };
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

// ---------- weekly email preference (users/{uid}.weekly) ----------
export async function getWeekly() {
  const f = await ready; if (!f || !me) return true;
  const d = await f.F.getDoc(f.F.doc(f.db, 'users', me.uid)).catch(() => null);
  return d && d.exists() ? d.data().weekly : true;
}
// For the beta results: did this person start making a keycard, and how? (Finishing is recorded on the keycard itself.)
export async function noteStart(how) {
  try { const f = await ready; if (me) await f.F.setDoc(f.F.doc(f.db, 'users', me.uid), { lastStart: { how, at: f.F.serverTimestamp() } }, { merge: true }); } catch (e) {}
}
export async function setWeekly(on) { const f = await ready; await f.F.setDoc(f.F.doc(f.db, 'users', me.uid), { weekly: !!on }, { merge: true }); }

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
// ---------- search: the site's keycards plus friends' public ones ----------
let siteIdx = null;
const words = t => String(t || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f-]+/g, ' ').split(' ').filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'how', 'my', 'your'].includes(w));
const stem = w => w.replace(/(ies|es|s)$/, '');
export async function searchKeycards(q) {
  const want = [...new Set(words(q).map(stem))]; if (!want.length) return [];
  if (!siteIdx) { try { siteIdx = await (await fetch(ROOT + 'keycards.json', { cache: 'no-cache' })).json(); } catch (e) { siteIdx = []; } }
  const friends = await publicKeycards(80).catch(() => []);
  const all = [...siteIdx.map(k => ({ ...k, url: ROOT + k.url })),
               ...friends.filter(k => (!k.copiedFrom || k.edited) && !siteIdx.some(x => x.absorbs && String(x.absorbs).replace(/[^A-Za-z0-9]/g, '') === String(k.id || '').replace(/^user:/, '').replace(/[^A-Za-z0-9]/g, ''))).map(k => ({ id: k.id, url: keycardUrl(k.id), title: k.title, tagline: k.tagline || '',
                 subject: catOf(k.subject), type: SHAPE_LABEL[k.shape] || '', live: hasLive(k), by: k.ownerName || '',
                 words: [k.title, k.tagline, k.subject, ...(k.sections || []).flatMap(x => [x.title, ...(x.items || []).map(i => i.name)])].join(' ') }))];
  return all.map(k => { const have = new Set(words(k.words + ' ' + k.title).map(stem)); return { k, n: want.filter(w => have.has(w)).length }; })
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6).map(x => x.k);
}

// ---------- asks: "nobody's made one yet, I'd like one" (kept on your own profile; no new database rules) ----------
export async function saveAsk(topic) {
  const f = await ready; if (!f || !me) return;
  topic = String(topic || '').trim().slice(0, 80); if (!topic) return;
  const ref = f.F.doc(f.db, 'users', me.uid);
  const d = await f.F.getDoc(ref).catch(() => null);
  const asks = ((d && d.exists() && d.data().asks) || []).filter(a => a.topic.toLowerCase() !== topic.toLowerCase());
  asks.push({ topic, at: new Date().toISOString() });
  await f.F.setDoc(ref, { asks: asks.slice(-20) }, { merge: true });
}

// ---------- beta results ----------
// An open: once a day per browser per keycard, so a refresh doesn't count twice. Owners' own visits don't count.
export async function recordOpen(id, ownerUid) {
  const f = await ready; if (!f) return;
  const day = new Date().toISOString().slice(0, 10), key = 'kc-open-' + id;
  try { if (localStorage.getItem(key) === day) return; } catch (e) {}
  const u = await new Promise(res => onUser(res));
  if (u && ((ownerUid && u.uid === ownerUid) || (id.startsWith('site:') && u.email && u.email === cfg.adminEmail))) return;   // owners don't count
  try { await f.F.addDoc(f.F.collection(f.db, 'opens'), { keycard: id, uid: u ? u.uid : null, at: f.F.serverTimestamp() }); localStorage.setItem(key, day); } catch (e) {}
}
const nameOf = async (f, uid, cache) => {
  if (!(uid in cache)) { const d = await f.F.getDoc(f.F.doc(f.db, 'users', uid)).catch(() => null); cache[uid] = (d && d.exists() && d.data().name) || 'Someone'; }
  return cache[uid];
};
// Who followed and copied a keycard, by name, plus how many times it's been opened.
export async function whoFor(id) {
  const f = await ready; if (!f) return null;
  const q = (col, field) => f.F.getDocs(f.F.query(f.F.collection(f.db, col), f.F.where(field, '==', id)));
  try {
    const [fo, co, op] = await Promise.all([q('follows', 'keycard'), q('copies', 'from'), q('opens', 'keycard')]);
    const cache = {};
    const names = async snap => [...new Set(await Promise.all(snap.docs.map(d => nameOf(f, d.data().uid, cache))))];
    return { followers: await names(fo), copiers: await names(co), opens: op.docs.length,
             people: new Set(op.docs.map(d => d.data().uid).filter(Boolean)).size };
  } catch (e) { console.warn(e); return null; }
}
// Everything for Sid's beta results page: people, what they did, and how each keycard is doing.
export async function betaData() {
  const f = await ready; if (!f) return null;
  const all = async (col, ...w) => (await f.F.getDocs(f.F.query(f.F.collection(f.db, col), ...w))).docs.map(d => ({ id: d.id, ...d.data() }));
  const [users, follows, copies, opens, pub, unl] = await Promise.all([all('users'), all('follows'), all('copies'), all('opens'),
    all('keycards', f.F.where('visibility', '==', 'public')), all('keycards', f.F.where('visibility', '==', 'unlisted'))]);
  return { users, follows, copies, opens, keycards: [...pub, ...unl] };
}

export async function counts(id) {
  const f = await ready; if (!f) return null;
  const n = async (col, field) => (await f.F.getCountFromServer(
    f.F.query(f.F.collection(f.db, col), f.F.where(field, '==', id)))).data().count;
  try { const [followers, copies] = await Promise.all([n('follows', 'keycard'), n('copies', 'from')]); return { followers, copies }; }
  catch (e) { console.warn(e); return null; }
}

// ---------- the interviewer (Cloudflare worker; checks your sign-in) ----------
// The one thing that works signed out: a keycard's Quick summary (the worker caps it per address and per day).
async function askFree(context) {
  if (!aiUrl) throw new Error('unavailable');
  const r = await fetch(aiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                 body: JSON.stringify({ action: 'askcard', free: true, topic: 'Quick summary', turns: [], context }) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 || r.status === 429) { signInSheet('Sign in to ask more', "It's free, and you carry on right where you were."); throw new Error(d.error || 'Sign in to ask.'); }
  if (!r.ok) throw new Error(d.error || 'The interviewer hit a snag. Try again in a moment.');
  return d;
}
export async function askAI(action, topic, turns, extra = {}) {
  if (!aiUrl) throw new Error('unavailable');
  // Signed out, making still works (the worker caps it per address); only saving needs an account.
  const headers = { 'Content-Type': 'application/json', ...(me ? { Authorization: 'Bearer ' + await me.getIdToken() } : {}) };
  const r = await fetch(aiUrl, { method: 'POST', headers, body: JSON.stringify({ ...extra, action, topic, turns, ...(me ? {} : { free: true }) }) });
  const d = await r.json().catch(() => ({}));
  if (!me && (r.status === 401 || r.status === 429)) throw new Error("You've tried a lot today. Sign in to keep going, it's free.");
  if (!r.ok) throw new Error(d.error || 'The interviewer hit a snag. Try again in a moment.');
  return d;
}

// ---------- ask this keycard: answers only from what's on it (and its sources' latest update) ----------
// Everything the AI may use, as plain text: the owner's items and reasons, sources, and the latest sourced update.
export function askContext(k, brief) {
  const by = k.curator || k.ownerName || '';
  const L = [`Keycard: ${k.title || ''}${by ? ` (by ${by})` : ''}`];
  if (k.tagline) L.push(`About: ${k.tagline}`);
  if (k.status) L.push(`Coming up: ${k.status}`);
  (k.sections || []).forEach(sec => {
    const items = (sec.items || []).filter(i => i.name || i.copy);
    if (!items.length) return;
    L.push('', `## ${sec.title || 'Items'}`);
    items.forEach(i => L.push(`- ${i.name || ''}${i.star ? ' (one of the owner\'s top 3)' : ''}${i.type ? ` [${i.type}]` : ''}${i.why ? `: ${i.why}` : ''}${i.copy ? `\n  Exact text: ${String(i.copy).slice(0, 600)}` : ''}`));
  });
  const src = (k.sources || []).filter(x => x.name && !/google news search/i.test(x.name));
  if (src.length) { L.push('', '## Sources the owner follows'); src.forEach(x => L.push(`- ${x.name}${x.why ? `: ${x.why}` : ''}`)); }
  const b = brief || k.briefing;
  if (b && ((b.points && b.points.length) || (b.from_list && b.from_list.length))) {
    L.push('', `## Latest AI update from its sources${b.updated ? ` (${ago(b.updated)})` : ''}`);
    if (b.headline) L.push(b.headline);
    (b.from_list || []).forEach(x => L.push(`- From the list: ${x.name}${x.why ? `: ${x.why}` : ''}`));
    (b.points || []).forEach(p => L.push(`- [${p.label || 'reported'}] ${p.text} (${(p.sources || []).map(s => s.name + (s.date ? ', ' + ago(s.date) : '')).join('; ')})`));
    (b.differences || []).forEach(d => L.push(`- [sources differ] ${d.text}`));
  }
  return L.join('\n').slice(0, 15000);
}

const ASK_SECOND = { live: 'Where do sources disagree?', picks: 'Where should I start?', playbook: 'How would I apply this to my own situation?', sources: 'Who should I follow first?' };
// getCtx: async () => context text. kind: live | picks | playbook | sources.
export function mountAsk(el, id, getCtx, kind, ownerFirst) {
  const second = ASK_SECOND[kind] || ASK_SECOND.picks;
  const from = kind === 'live' ? "this keycard and its sources' latest update" : esc(ownerFirst ? ownerFirst + "'s keycard" : 'this keycard');
  // One slim line under Follow / Copy: a field plus "Quick summary" (the 2-4 things that matter most). Tapping the field opens the rest.
  el.innerHTML = `<div class="ask-bar">
    <form class="ask-row"><input type="text" name="q" maxlength="200" placeholder="Ask this keycard" aria-label="Ask this keycard" autocomplete="off">
      <button type="button" class="ask-hot" data-q="Quick summary: what matters most here?">Quick summary</button>
      <button class="ask-go" type="submit" hidden>Ask</button></form>
    <div class="ask-more" hidden><button type="button" class="ask-chip" data-q="${esc(second)}">${esc(second)}</button>
      <span class="kc-fine">Answers come only from ${from}. If it isn't on here, it says so.</span></div>
    <div class="ask-out" aria-live="polite"></div></div>`;
  const out = el.querySelector('.ask-out'), input = el.querySelector('input'), go = el.querySelector('.ask-go'),
        hot = el.querySelector('.ask-hot'), more = el.querySelector('.ask-more');
  const open = on => { more.hidden = !on; go.hidden = !on; hot.hidden = on; };
  input.addEventListener('focus', () => open(true));
  input.addEventListener('blur', () => setTimeout(() => { if (!input.value.trim() && !el.contains(document.activeElement)) open(false); }, 150));
  const render = (q, a, covered) => {
    const lines = String(a).split('\n').map(x => x.trim()).filter(Boolean);
    let html = '', inList = false;
    lines.forEach(l => {
      if (/^[-•*]\s+/.test(l)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${esc(l.replace(/^[-•*]\s+/, ''))}</li>`; }
      else { if (inList) { html += '</ul>'; inList = false; } html += `<p>${esc(l)}</p>`; }
    });
    if (inList) html += '</ul>';
    out.innerHTML = `<div class="ask-q"><span>${esc(q)}</span><button type="button" class="ask-x" aria-label="Close answer">×</button></div>
      <div class="ask-a${covered ? '' : ' ask-gap'}">${html}</div><div class="kc-fine">From ${from} only.</div>`;
    out.querySelector('.ask-x').onclick = () => { out.innerHTML = ''; };
  };
  // Signed out, say up front that asking needs a (free) sign-in; Quick summary is the one free taste.
  if (!me) input.placeholder = 'Ask this keycard (free, with sign-in)';
  const run = async q => {
    q = String(q || '').trim(); if (!q) return;
    const quick = /^Quick summary/.test(q);
    if (!me && !quick) {   // say why, right where they're looking, instead of a sheet that may open off-screen
      out.innerHTML = `<div class="ask-a ask-gap"><p>Asking your own question needs a free sign-in. Quick summary works without one.</p>
        <button type="button" class="kc-btn kc-btn-main" data-asksign>Sign in to ask</button></div>`;
      out.querySelector('[data-asksign]').onclick = () => withUser('ask:' + id, q);
      return;
    }
    input.value = ''; input.blur(); open(false); go.disabled = hot.disabled = true;
    out.innerHTML = `<div class="ask-q"><span>${esc(q)}</span></div><div class="ask-a ask-wait">Reading the keycard…</div>`;
    try {
      const d = me ? await askAI('askcard', q.slice(0, 120), [], { question: q, context: await getCtx() }) : await askFree(await getCtx());
      render(q, d.answer || "Couldn't find an answer on this keycard.", d.covered !== false);
    } catch (e) {
      const msg = /unknown action/i.test(e.message) ? 'Asking switches on very soon.' : e.message === 'unavailable' ? 'Asking is not available right now.' : e.message;
      out.innerHTML = `<div class="ask-a ask-gap"><p>${esc(msg)}</p></div>`;
    }
    go.disabled = hot.disabled = false;
  };
  registerAction('ask:' + id, q => { el.scrollIntoView({ block: 'center' }); run(q); });
  if (me) runPending(me);   // signed in just now, before this box existed
  el.querySelector('form').onsubmit = e => { e.preventDefault(); run(input.value); };
  el.querySelectorAll('[data-q]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => run(b.dataset.q); });
}

// ---------- versions: copies people made public, shown on the original ----------
export async function versionsOf(id) {
  try { return (await publicKeycards(200)).filter(k => k.copiedFrom && k.copiedFrom.id === id); }
  catch (e) { return []; }
}
export function versionsHTML(list) {
  if (!list.length) return '';
  const name = k => (k.ownerName || 'Someone').split(' ')[0];
  return `<div class="kc-versions"><span>${list.length} version${list.length === 1 ? '' : 's'}:</span> ${list.slice(0, 6).map(k =>
    `<a href="${esc(keycardUrl(k.id))}">${esc(name(k))}'s</a>`).join('<i>·</i>')}${list.length > 6 ? ` <i>+${list.length - 6}</i>` : ''}</div>`;
}

// ---------- new since your last visit ----------
// Each browser remembers when it last opened a keycard. Points whose newest source is later than that get a "New" tag,
// and the update says how many. A visit is one sitting: reloads within half an hour compare against the visit before.
const SEEN = 'kc-seen:', VISIT = 30 * 60 * 1000;
function lastVisit(key) {
  const now = Date.now();
  let v = {};
  try { v = JSON.parse(localStorage.getItem(SEEN + key) || '{}'); } catch (e) {}
  if (!v.last || now - v.last > VISIT) { v = { prev: v.last || 0, last: now }; }
  else v.last = now;
  try { localStorage.setItem(SEEN + key, JSON.stringify(v)); } catch (e) {}
  return v.prev || 0;
}
export function markNew(root = document, key = location.pathname + location.search) {
  const cards = [...root.querySelectorAll('.kc-now')].filter(c => !c.dataset.newDone);
  if (!cards.length) return;
  const prev = lastVisit(key);
  cards.forEach(card => {
    card.dataset.newDone = '1';
    if (!prev) return;                                   // first visit: nothing to compare with
    const fresh = [...card.querySelectorAll('.kc-pt[data-d]')].filter(li => { const d = Date.parse(li.dataset.d); return d && d > prev; });
    if (!fresh.length) return;
    fresh.forEach(li => li.insertAdjacentHTML('afterbegin', '<span class="kc-new">New</span>'));
    if (fresh.some(li => li.closest('details'))) fresh.forEach(li => { const d = li.closest('details'); if (d) d.open = true; });
    const h = card.querySelector('.kc-h');
    if (h) h.insertAdjacentHTML('afterend', `<p class="kc-newline">${fresh.length} new since you were last here</p>`);
  });
}
document.addEventListener('DOMContentLoaded', () => markNew());
if (document.readyState !== 'loading') setTimeout(() => markNew(), 0);

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

// For Beta results: which keycards someone has shared (read-modify-write on their own user record; no new rules).
async function noteShare(url) {
  try {
    const m = url.match(/\/u\/([^/?#]+)/) || url.match(/[?&]id=([^&#]+)/);
    if (!m || !me) return;
    const id = decodeURIComponent(m[1]).replace(/^user:/, '');
    const f = await ready, ref = f.F.doc(f.db, 'users', me.uid);
    const cur = ((await f.F.getDoc(ref)).data() || {}).shared || [];
    if (!cur.includes(id)) await f.F.setDoc(ref, { shared: [...cur, id].slice(-50) }, { merge: true });
  } catch (e) {}
}
export async function share(title, url) {
  // A friend's keycard gets its own preview page at the next update (every 30 minutes). Until then, share the
  // live page link, which has a general Keycard preview, so WhatsApp always shows a card.
  const m = url.match(/\/u\/([^/]+)\/?$/);
  if (m) { try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (!r.ok) url = ROOT + 'k/?id=' + encodeURIComponent(m[1]); } catch (e) {} }
  noteShare(url);
  if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { prompt('Copy this link', url); }
}

// Your photo on the Mine tab once you're signed in.
function mountMine() {
  document.querySelectorAll('[data-mine]').forEach(el => {
    const icon = el.querySelector('svg, img, .av-i');
    onUser(u => {
      const cur = el.querySelector('svg, img, .av-i');
      if (!u) { if (cur !== icon) cur.replaceWith(icon); return; }
      const n = u.photoURL ? Object.assign(document.createElement('img'), { className: 'av', src: u.photoURL, alt: '', referrerPolicy: 'no-referrer' })
        : Object.assign(document.createElement('span'), { className: 'av-i', textContent: (u.displayName || '?').trim()[0] || '?' });
      cur.replaceWith(n);
    });
  });
}

// The plain categories people filter by. Older subjects map onto them.
const CATS = { Football: 'Sport', FPL: 'Sport', UFC: 'Sport', Markets: 'Money & tech', Tech: 'Money & tech', Gaming: 'Pop culture', Games: 'Pop culture', Film: 'Pop culture', Music: 'Pop culture' };
export const SUBJECTS = ['Food', 'Travel', 'Sport', 'Fitness', 'Money & tech', 'Pop culture', 'Learning', 'Life & work', 'Other'];
export const catOf = s => CATS[s] || (SUBJECTS.includes(s) || s === 'News' ? s : 'Other');

export const SHAPE_LABEL = { picks: 'Picks', sources: 'Sources', playbook: 'Playbook' };
// Three kinds (Picks, Playbook, Sources) by what's on a keycard. "Live updates" is something a keycard has, not a kind:
// AI watches links it can read (YouTube, websites, podcasts) and writes "What's new". Lists only get it when the owner asks AI to watch.
const NO_FEED = /(^|\.)(instagram|x|twitter|tiktok|facebook|reddit|linkedin|threads)\.(com|net)$|(^|\.)maps\.app\.goo\.gl$|(^|\.)goo\.gl$/;
const followable = u => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return /^https?:/.test(u) && !NO_FEED.test(h) && !(h === 'google.com' && u.includes('/maps')); } catch (e) { return false; } };
export function hasLive(k) {
  if (!k) return false;
  if (k.live || k.briefing || k.watch || (k.copiedFrom && k.copiedFrom.live)) return true;
  if ((k.shape || '') === 'picks') return false;
  // Same links the engine reads: anything on the keycard, steps included, not just the sources list.
  return [...(k.sources || []), ...(k.sections || []).flatMap(x => x.items || [])].some(x => followable(x.url || ''));
}
export const LIVE_BADGE = '<span class="live-badge">● Live updates</span>';
export function tileHTML({ url, cat, title, by, line, mine, shape, id, live }) {
  const type = SHAPE_LABEL[shape] || '';
  return `<a class="tile${mine ? ' mine' : ''}" href="${esc(url)}" data-cat="${esc(cat)}"><span class="c">${type ? esc(type) + ' · ' : ''}${esc(cat)}</span>
    <b>${esc(title)}</b>${line ? `<span class="s">${esc(line)}</span>` : ''}<span class="by">${esc(by)}${live ? ' ' + LIVE_BADGE : ''}</span>${id ? `<span class="tile-n" data-n="${esc(id)}"></span>` : ''}</a>`;
}

// Follow / copy / share buttons, plus follower and copy counts.
export function mountActions(el, id, opts = {}) {
  const title = opts.title || document.title;
  el.innerHTML = `<div class="kc-stats" hidden></div><div class="kc-act-row">
      <button class="kc-btn kc-btn-main" data-a="follow" type="button">Follow</button>
      <button class="kc-btn" data-a="copy" type="button">Copy</button>
      <button class="kc-btn kc-btn-icon" data-a="share" type="button" aria-label="Share">${SHARE_ICON}</button>
    </div><div class="kc-fine kc-counts" aria-live="polite"></div>`;
  const fBtn = el.querySelector('[data-a="follow"]');
  let following = false, changed = 0;     // changed: ignore a slow 'am I following?' answer once they've tapped
  const paint = () => { fBtn.textContent = following ? 'Following ✓' : 'Follow'; fBtn.classList.toggle('on', following); };
  const showCounts = async () => {
    const out = el.querySelector('.kc-counts'); const c = await counts(id);
    // The Follow / Copy explanation shows the first few times only; after that it's clutter.
    let seenN = 0; try { seenN = +localStorage.getItem('kc-actnote') || 0; localStorage.setItem('kc-actnote', seenN + 1); } catch (e) {}
    out.textContent = seenN >= 3 ? '' : opts.copyNote ? `${opts.followNote || 'Follow to see what changes.'} ${opts.copyNote}` : 'Follow: they keep it up to date, and you see what changes. Copy: your own version to change however you like; the original keeps the credit.';
    // Copies are the proof a keycard is worth borrowing, so they lead, big and bold.
    const st = el.querySelector('.kc-stats');
    const bits = c ? [c.copies ? `<span><b>${c.copies}</b> ${c.copies === 1 ? 'person has' : 'people have'} copied this</span>` : '',
                      c.followers ? `<span><b>${c.followers}</b> following</span>` : ''].filter(Boolean) : [];
    st.innerHTML = bits.join('<i>·</i>'); st.hidden = !bits.length;
    if (c && c.copies && !el.dataset.v) (el.dataset.v = '1', versionsOf(id)).then(v => { if (v.length) st.insertAdjacentHTML('afterend', versionsHTML(v)); });
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
  else recordOpen(id, opts.owner);
  onUser(async u => {
    const at = changed;
    const f = u ? await isFollowing(id).catch(() => false) : false;
    if (at === changed) { following = f; paint(); }
  });
  showCounts();
}

const SHARE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>';

// ---------- render a keycard someone made (same look as the site's curated keycards) ----------
export function itemRow(it, mark) {
  const u = safeUrl(it.url);
  // A reason is the owner's words; a Maps category ("Ramen restaurant") is just a label, so it shows as a small tag.
  const meta = it.why ? clampWhy(it.why) : it.type ? `<span class="kc-tag">${esc(it.type)}</span>` : esc(u ? new URL(u).hostname.replace(/^www\./, '') : '');
  const yours = mark && !it.from ? `<span class="kc-yours">${esc(mark)}</span>` : '';   // mark: e.g. "added by Arjun"
  const t = `<span class="kc-row-t">${esc(it.name || u)}${yours}</span>${meta ? `<span class="kc-row-m">${meta}</span>` : ''}`;
  if (it.copy) {
    return `<div class="kc-row kc-row-copy">${u ? `<a href="${esc(u)}" target="_blank" rel="noopener" class="kc-row-a">${t}</a>` : t}
      <div class="kc-copybox"><pre>${esc(it.copy)}</pre><button type="button" class="kc-copybtn" data-copytext>Copy</button></div></div>`;
  }
  return u ? `<a class="kc-row" href="${esc(u)}" target="_blank" rel="noopener">${t}</a>` : `<div class="kc-row">${t}</div>`;
}
// A long reason shows its first sentence; tap "more" for the rest. Nothing is cut, it just isn't all on screen at once.
function clampWhy(why) {
  const w = String(why), m = w.match(/^(.{40,180}?[.!?])\s+(.+)$/s);
  return m && w.length > 160 ? `${esc(m[1])}<span class="kc-rest" hidden> ${esc(m[2])}</span> <button type="button" class="kc-morebtn" data-more>more</button>` : esc(w);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-more]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const r = b.previousElementSibling; if (r) r.hidden = false; b.remove();
}, true);
// The owner's rules ("How I choose"): short lines first, their own words one tap away.
export const isRules = s => s && (s.kind === 'principles' || s.principles || /^how i (choose|think about it)$/i.test((s.title || '').trim()));
export function rulesCard(s) {
  const items = (s.items || []).slice(0, 5);
  const rule = (it, i) => `<details class="kc-rule"${i >= 3 ? ' data-extra hidden' : ''}><summary>${esc(it.name)}</summary>${it.why ? `<p>“${esc(String(it.why).replace(/["“”]/g, ''))}”</p>` : ''}</details>`;
  return `<section class="kc-rules"><span class="label">${esc(s.title || 'How I choose')}</span>
    ${items.map(rule).join('')}
    ${items.length > 3 ? `<button type="button" class="kc-seeall" data-seeall>See all ${items.length}</button>` : ''}</section>`;
}
// A Quick tip: the whole card on one screen, like a postcard. Fact chips, the why, and one button to act.
export const isTip = k => { const n = (k.sections || []).filter(s => !isRules(s)).reduce((a, s) => a + (s.items || []).length, 0);
  return n <= 3 && (k.format === 'tip' || (!k.format && (k.shape || 'picks') === 'picks' && n <= 2)); };
export function tipBlock(k) {
  const items = (k.sections || []).filter(s => !isRules(s)).flatMap(s => s.items || []);
  const place = (items.find(i => /\bat\s+[A-Z]/.test(i.name || '')) || {}).name;
  // Maps only when there's a real "something at Place" to search for, never a guess from a vague phrase.
  const where = place ? place.replace(/^.*?\bat\s+/, '') : (['Food', 'Travel'].includes(k.subject) && /\bat\s+[A-Z]/.test(k.title || '') ? k.title.replace(/^.*?\bat\s+/, '').split(',')[0] : '');
  return `<section class="kc-tip">
    ${(k.facts || []).length ? `<div class="kc-facts">${k.facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
    ${items.map(it => `<div class="kc-tip-i"><b>${esc(it.name)}</b>${it.why ? `<p>${esc(it.why)}</p>` : ''}</div>`).join('')}
    ${(k.sections || []).filter(isRules).flatMap(s => s.items || []).slice(0, 3).map(it => `<div class="kc-tip-rule">✓ ${esc(it.name)}</div>`).join('')}
    ${where ? `<a class="kc-btn kc-btn-main kc-tip-map" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}
  </section>`;
}
// Sections as tabs: one at a time, headlines first, the reason one tap away. Prompts and links keep their own rows.
export const factsRow = k => (k.facts || []).length ? `<div class="kc-facts">${k.facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : '';
// Sections, read lean-back: the most useful one is open and readable top to bottom (reasons showing, long ones
// shortened with "more"); the rest fold underneath with a one-line preview. Collapsing is for the extras, not the point.
export function sectionTabs(sections, rowFn) {
  if (!sections.length) return '';
  const map = it => it.map ? `<a class="kc-map" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.map)}" target="_blank" rel="noopener">Open in Maps ›</a>` : '';
  const row = it => (it.copy || it.url) ? rowFn(it)
    : `<div class="kc-read-i"><b>${esc(it.name)}</b>${it.why ? `<p>${clampWhy(it.why)}</p>` : ''}${map(it)}</div>`;
  const score = s => (s.items || []).length + ((s.items || []).some(i => i.copy) ? 100 : 0);
  const first = sections.reduce((b, s, i) => score(s) > score(sections[b]) ? i : b, 0);
  // A small keycard (7 items or fewer) is simply read top to bottom, nothing folded.
  if (sections.reduce((n, s) => n + (s.items || []).length, 0) <= 7) return sections.map(s => `<section class="kc-tabs"><span class="label">${esc(s.title || 'Picks')}</span>
    <div class="kc-panel">${(s.items || []).map(row).join('')}</div></section>`).join('');
  const main = sections[first], rest = sections.filter((_, i) => i !== first);
  return `<section class="kc-tabs"><span class="label">${esc(main.title || 'Picks')}</span>
      <div class="kc-panel">${(main.items || []).map(row).join('')}</div></section>
    ${rest.length ? `<section class="kc-folds">${rest.map(s => fold(s.title || 'More', (s.items || []).map(row), false)).join('')}</section>` : ''}`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { const box = t.closest('.kc-tabs');
    box.querySelectorAll('.kc-tab').forEach(b => b.classList.toggle('on', b === t));
    box.querySelectorAll('.kc-panel').forEach(p => { p.hidden = p.dataset.panel !== t.dataset.tab; });
    t.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); return; }
  const a = e.target.closest('[data-seeall]');
  if (a) { a.closest('.kc-rules').querySelectorAll('[data-extra]').forEach(x => { x.hidden = false; }); a.remove(); }
});
// A folded section shows a one-line taste of what's inside, so people know whether to open it.
const preview = rows => { const m = String(rows[0] || '').match(/class="kc-row-t">([^<]*)|class="kc-read-i"><b>([^<]*)/); return m ? (m[1] || m[2] || '') : ''; };
export function fold(title, rows, open, steps) {
  const p = !open && rows.length ? preview(rows) : '';
  return `<details class="kc-fold"${open ? ' open' : ''}><summary><span class="kc-fold-t"><span>${esc(title)}</span>${p ? `<small class="kc-prev">${p}${rows.length > 1 ? '…' : ''}</small>` : ''}</span><span class="kc-count">${rows.length}</span></summary><div class="kc-fold-body${steps ? ' kc-steps' : ''}">${rows.join('')}</div></details>`;
}
export function briefingCard(b, title, note) {
  const fl = (b && b.from_list) || [];
  if (!b || ((!b.points || !b.points.length) && !fl.length)) return '';
  b.points = b.points || [];
  const pt = p => `<li class="kc-pt" data-d="${esc((p.sources || []).map(x => x.date || '').filter(Boolean).sort().pop() || '')}"><span class="kc-lbl kc-lbl-${esc((p.label || 'reported').replace(/ /g, '-'))}">${esc(p.label || 'reported')}</span> ${esc(p.text)} ${
    (p.sources || []).slice(0, 2).map(s => (safeUrl(s.url) ? `<a class="kc-src" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : `<span class="kc-src">${esc(s.name)}</span>`)
      + (s.date ? `<span class="kc-src"> · ${esc(ago(s.date))}</span>` : '')).join(' · ')}</li>`;
  return `<section class="card kc-now"><div class="kc-h"><span class="label">${esc(title)}</span></div>
    ${b.headline ? `<p class="kc-head">${esc(b.headline)}</p>` : ''}
    ${fl.length ? `<div class="kc-fine" style="padding-top:4px">From the list</div>${fl.map(x => `<div class="kc-row"><span class="kc-row-t">${esc(x.name)}</span>${x.why ? `<span class="kc-row-m">${esc(x.why)}</span>` : ''}</div>`).join('')}
      ${b.points.length ? '<div class="kc-fine" style="padding-top:10px">New</div>' : ''}` : ''}<ul class="kc-pts">${b.points.slice(0, 3).map(pt).join('')}</ul>
    ${b.points.length > 3 ? `<details class="kc-more"><summary>${b.points.length - 3} more points</summary><ul class="kc-pts">${b.points.slice(3).map(pt).join('')}</ul></details>` : ''}
    <div class="kc-fine">${esc(note)}</div></section>`;
}

mountMine();
// Copy buttons on playbook items: copy the text right above them.
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-copytext]'); if (!b) return;
  const text = b.parentElement.querySelector('pre').textContent;
  try { await navigator.clipboard.writeText(text); } catch (err) { prompt('Copy this', text); return; }
  b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1600);
});
document.querySelectorAll('[data-keycard]').forEach(el => mountActions(el, el.dataset.keycard, { title: el.dataset.title, copyNote: el.dataset.copynote }));
document.querySelectorAll('[data-ask]').forEach(el => {
  let k = null;
  mountAsk(el, el.dataset.ask, async () => askContext(k || (k = await loadKeycard(el.dataset.ask))), el.dataset.kind, el.dataset.by);
});
