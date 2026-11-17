// A keycard someone made: /k/?id=<doc id>  (also /u/<id>/, the shareable page with a proper link preview)
import { loadKeycard, mountActions, onUser, esc, itemRow, fold, briefingCard, keycardUrl, makeUrl, share, ROOT, live } from './app.js';

const box = document.getElementById('kc');
const params = new URLSearchParams(location.search);
const docId = params.get('id') || box.dataset.id;

function notFound(msg) {
  box.innerHTML = `<section class="card"><p class="kc-head">${esc(msg)}</p>
    <p class="kc-body">It may have been made private or deleted. <a href="${ROOT}">Back to Discover</a></p></section>`;
}

async function show() {
  if (!docId) return notFound('No keycard here.');
  if (!live()) return notFound('Keycards made by people open very soon.');
  let k;
  try { k = await loadKeycard('user:' + docId); } catch (e) { return notFound("We couldn't find that keycard."); }
  document.title = `${k.title} · Commentator`;
  const by = k.ownerName || 'Someone';
  const cf = k.copiedFrom;
  const sections = (k.sections || []).map(s => ({ ...s, items: (s.items || []).filter(i => i.name || i.url) })).filter(s => s.items.length);
  const sources = (k.sources || []).filter(s => s.name || s.url);
  const vis = { private: 'Only you can see this', unlisted: 'Only people with the link' }[k.visibility];

  box.innerHTML = `
    <div id="banner"></div>
    <section class="kc-hero">
      <div class="eyebrow">${esc(k.subject || 'Keycard')}</div>
      <h1 class="display kc-title">${esc(k.title)}</h1>
      <div class="kc-cur">By <b>${esc(by)}</b>${cf ? ` · based on <a href="${esc(keycardUrl(cf.id))}" style="color:inherit">${esc(cf.by)}'s</a>` : ''}</div>
      ${vis ? `<div class="kc-fine">${esc(vis)}</div>` : ''}
    </section>
    ${k.tagline ? `<p class="kc-body" style="margin-top:-6px">${esc(k.tagline)}</p>` : ''}
    <div class="kc-actions" id="acts"></div>
    <div id="live"></div>
    ${sections.length || sources.length ? `<section class="kc-folds">
      ${sections.map((s, i) => fold(s.title || 'Picks', s.items.map(itemRow), i === 0)).join('')}
      ${sources.length ? fold('Sources', sources.map(itemRow), !sections.length) : ''}
    </section>` : `<section class="card"><p class="kc-body">Nothing on here yet.</p></section>`}`;

  onUser(u => {
    const own = u && u.uid === k.owner;
    const acts = document.getElementById('acts');
    if (own) {
      acts.innerHTML = `<div class="kc-act-row"><a class="kc-btn kc-btn-main" href="${esc(makeUrl(docId))}">Edit</a>
        <button class="kc-btn" type="button" id="sh">Share</button></div>`;
      document.getElementById('sh').onclick = () => share(k.title, ROOT + 'u/' + docId + '/');
      if (params.get('new')) {
        document.getElementById('banner').innerHTML = `<div class="kc-banner"><b>Your copy is ready.</b> It's yours now: rename it, drop what you don't need and add your own. ${esc(cf ? cf.by : 'The original')} keeps the credit.</div>`;
        history.replaceState(null, '', location.pathname + '?id=' + encodeURIComponent(docId));
      }
    } else {
      mountActions(acts, k.id, { title: k.title, url: ROOT + 'u/' + docId + '/' });
    }
  });

  // Living: a copy of a live keycard shows the original's latest update (same sources).
  if (cf && cf.live) {
    try {
      const src = await loadKeycard(cf.live);
      document.getElementById('live').innerHTML = briefingCard(src.briefing, 'Right now',
        `AI summary of ${src.title}'s sources. Labels show how solid each point is.`);
    } catch (e) { /* no update yet */ }
  }
}
show();
