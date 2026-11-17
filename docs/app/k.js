// A keycard someone made: /k/?id=<doc id>
import { loadKeycard, mountActions, onUser, esc, itemRow, fold, briefingCard, keycardUrl, makeUrl, ROOT, live } from './app.js';

const box = document.getElementById('kc');
const docId = new URLSearchParams(location.search).get('id');

function notFound(msg) {
  box.innerHTML = `<section class="card"><p class="kc-head">${esc(msg)}</p>
    <p class="kc-body">It may have been made private or deleted. <a href="${ROOT}">Browse keycards</a></p></section>`;
}

async function show() {
  if (!docId) return notFound('No keycard here.');
  if (!live()) return notFound('Keycards made by people open very soon.');
  let k;
  try { k = await loadKeycard('user:' + docId); } catch (e) { return notFound("We couldn't find that keycard."); }
  document.title = `${k.title} · Commentator`;
  const by = k.ownerName || 'Someone';
  const cf = k.copiedFrom;
  const sections = (k.sections || []).filter(s => (s.items || []).some(i => i.name || i.url));
  const sources = (k.sources || []).filter(s => s.name || s.url);
  const vis = { private: 'Only you can see this', unlisted: 'Anyone with the link' }[k.visibility];

  box.innerHTML = `
    <section class="kc-hero">
      <div class="eyebrow">${esc(k.subject || 'Keycard')}</div>
      <h1 class="display kc-title">${esc(k.title)}</h1>
      <div class="kc-cur">By <b>${esc(by)}</b>${vis ? ` · ${esc(vis)}` : ''}</div>
      ${cf ? `<div class="kc-copied">Copied from <a href="${esc(keycardUrl(cf.id))}">${esc(cf.title)}</a> by ${esc(cf.by)}</div>` : ''}
    </section>
    ${k.tagline ? `<p class="kc-body" style="margin-top:-6px">${esc(k.tagline)}</p>` : ''}
    <div class="kc-actions" id="acts"></div>
    <div id="live"></div>
    ${sections.length || sources.length ? `<section class="kc-folds">
      ${sections.map((s, i) => fold(s.title || 'Picks', s.items.filter(x => x.name || x.url).map(itemRow), i === 0)).join('')}
      ${sources.length ? fold('Sources on this keycard', sources.map(itemRow), !sections.length) : ''}
    </section>` : `<section class="card"><p class="kc-body">${esc(by)} hasn't added anything yet.</p></section>`}
    ${k.instruction ? `<section class="card"><div class="kc-h"><span class="label">What it keeps an eye on</span></div><p class="kc-body">${esc(k.instruction)}</p></section>` : ''}`;

  onUser(u => {
    const own = u && u.uid === k.owner;
    const acts = document.getElementById('acts');
    mountActions(acts, k.id, { title: k.title, own });
    if (own) {
      const row = acts.querySelector('.kc-act-row');
      row.insertAdjacentHTML('afterbegin', `<a class="kc-btn kc-btn-main" href="${esc(makeUrl(docId))}">Edit</a>`);
    }
  });

  // Living: a copy of a live keycard shows the original's latest briefing (same sources).
  if (cf && cf.live) {
    try {
      const src = await loadKeycard(cf.live);
      document.getElementById('live').innerHTML = briefingCard(src.briefing, 'Right now',
        `AI summary of the sources this keycard started from (${src.title}). Labels show how solid each point is.`);
    } catch (e) { /* no briefing yet */ }
  }
}
show();
