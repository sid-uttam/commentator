// A keycard someone made: /k/?id=<doc id>  (also /u/<id>/, the shareable page with a proper link preview)
// One layout for every shape: who made it and how fresh it is, then the most useful thing first.
//   Picks: the list first, "what's new" after it.  Sources: "right now" first.  Playbook: numbered steps + copy boxes.
import { loadKeycard, mountActions, onUser, esc, itemRow, fold, briefingCard, keycardUrl, makeUrl, share, kcHash,
         markChecked, ago, toast, ROOT, live } from './app.js';

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
  document.title = `${k.title} · Keycard`;
  const by = k.ownerName || 'Someone', first = by.split(' ')[0];
  const cf = k.copiedFrom;
  const sections = (k.sections || []).map(s => ({ ...s, items: (s.items || []).filter(i => i.name || i.url || i.copy) })).filter(s => s.items.length);
  const sources = (k.sources || []).filter(s => s.name || s.url);
  const shape = k.shape || (sources.length && !sections.length ? 'sources' : 'picks');
  const vis = { private: 'Only you can see this', unlisted: 'Only people with the link' }[k.visibility];
  const all = [...sections.flatMap(s => s.items), ...sources];
  const main = sections.length ? sections.flatMap(s => s.items) : sources;   // what people count: the picks or steps, else the sources
  const added = cf ? main.filter(i => !i.from).length : 0, inherited = cf ? main.length - added : 0;

  // Freshness: when the owner last edited or confirmed it. Picks and playbooks rot silently, so say so.
  const touched = [k.checked, k.updated].map(t => t && t.toMillis ? t.toMillis() : 0).reduce((a, b) => Math.max(a, b), 0);
  const days = touched ? (Date.now() - touched) / 864e5 : 0;
  const fresh = touched && !(cf && !k.edited) ? `Checked by ${esc(first)} ${esc(ago(new Date(touched).toISOString()))}` : '';
  const stale = touched && days > 90 && shape !== 'sources';

  const folds = sections.length || sources.length ? `<section class="kc-folds">
      ${sections.map((s, i) => fold(s.title || 'Picks', s.items.map(it => itemRow(it, cf && `added by ${first}`)), i === 0,
                                     shape === 'playbook' && i === 0)).join('')}
      ${sources.length ? fold('Sources', sources.map(it => itemRow(it, cf && `added by ${first}`)), !sections.length) : ''}
    </section>` : `<section class="card"><p class="kc-body">Nothing on here yet.</p></section>`;

  box.innerHTML = `
    <section class="kc-hero">
      <div class="eyebrow">${esc(k.subject || 'Keycard')}</div>
      <h1 class="display kc-title">${esc(k.title)}</h1>
      <div class="kc-cur">By <b>${esc(by)}</b>${cf ? ` · based on <a href="${esc(keycardUrl(cf.id))}" style="color:inherit">${esc(cf.by)}'s</a>` : ''}</div>
      ${stale ? `<div class="kc-stale">Not checked for ${Math.round(days / 30)} months, so some of this may be out of date</div>` : fresh ? `<div class="kc-fresh">${fresh}</div>` : ''}
      ${cf && main.length ? `<div class="kc-fine">${inherited} from ${esc(cf.by)}${added ? ` · <span style="color:var(--good)">${added} added by ${esc(first)}</span>` : ''}</div>` : ''}
      ${k.tested ? `<div class="kc-tested">Tested with ${esc(k.tested)}</div>` : ''}
      ${vis ? `<div class="kc-fine">${esc(vis)}</div>` : ''}
    </section>
    ${k.tagline ? `<p class="kc-body" style="margin-top:-6px">${esc(k.tagline)}</p>` : ''}
    <div class="kc-actions" id="acts"></div>
    <div id="mine"></div>
    ${shape === 'picks' ? folds + '<div id="live"></div>' : '<div id="live"></div>' + folds}`;

  onUser(u => {
    const own = u && u.uid === k.owner;
    const acts = document.getElementById('acts');
    if (!own) { mountActions(acts, k.id, { title: k.title, url: ROOT + 'u/' + docId + '/' }); return; }
    acts.innerHTML = `<div class="kc-act-row"><a class="kc-btn kc-btn-main" href="${esc(makeUrl(docId))}">Edit</a>
      <button class="kc-btn" type="button" id="sh">Share</button></div>`;
    document.getElementById('sh').onclick = () => share(k.title, ROOT + 'u/' + docId + '/');
    const mine = document.getElementById('mine');

    // The moment after copying: this is yours now, here's what you got, three ways to make it yours.
    if (cf && !k.edited) {
      const groups = sections.length > 1 ? ` in ${sections.length} groups` : '';
      const n = main.length, noun = shape === 'sources' ? 'source' : shape === 'playbook' ? 'step' : 'pick';
      mine.innerHTML = `<section class="kc-mine">
        <b>${params.get('new') ? 'This is yours now.' : 'Make it yours.'}</b>
        <p>You got ${n} ${noun}${n === 1 ? '' : 's'}${groups}${cf.live ? ', plus live updates' : ''} from ${esc(cf.by)}. Change anything you like: ${esc(cf.by)}'s original stays as it is, and you'll hear if they update it.</p>
        <div class="kc-act-row">
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=title'))}">Rename</a>
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=add'))}">Add your own</a>
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=remove'))}">Remove some</a>
        </div></section>`;
      if (params.get('new')) history.replaceState(null, '', location.pathname + '?id=' + encodeURIComponent(docId));
      return;
    }

    // One message at a time: the original changed (if they copied it) comes before "still accurate?".
    const stillAccurate = () => {
      if (!(touched && days > 30)) return;
      mine.innerHTML = `<div class="kc-check"><span>Still accurate?</span><div class="kc-act-row">
        <button class="kc-btn kc-btn-main" type="button" id="ok">Yes, still good</button>
        <a class="kc-btn" href="${esc(makeUrl(docId))}">Edit</a></div></div>`;
      document.getElementById('ok').onclick = async () => {
        await markChecked(docId); mine.innerHTML = ''; toast('Thanks. Marked as checked today.');
        const f = box.querySelector('.kc-fresh, .kc-stale'); if (f) { f.className = 'kc-fresh'; f.textContent = `Checked by ${first} just now`; }
      };
    };
    if (!(cf && cf.hash)) return stillAccurate();
    loadKeycard(cf.id).then(orig => {
      const seenKey = 'kc-seen-' + docId + '-' + kcHash(orig);
      let seen = false; try { seen = !!localStorage.getItem(seenKey); } catch (e) {}
      if (kcHash(orig) === cf.hash || seen) return stillAccurate();
      mine.innerHTML = `<div class="kc-banner"><b>${esc(cf.by)} has updated the original</b> since you copied it. <a href="${esc(keycardUrl(cf.id))}" style="color:var(--accent)">See what's new</a>, then add anything you like to yours.</div>`;
      mine.querySelector('a').onclick = () => { try { localStorage.setItem(seenKey, '1'); } catch (e) {} };
    }).catch(stillAccurate);
  });

  // Living: the keycard's own AI update from its links; otherwise a copy of a live keycard shows the original's.
  let mineB = null;
  try { const r = await fetch(ROOT + 'u/' + docId + '/briefing.json', { cache: 'no-cache' }); if (r.ok) mineB = await r.json(); } catch (e) {}
  const title = shape === 'picks' ? "What's new" : 'Right now';
  if (mineB && mineB.points && mineB.points.length) {
    document.getElementById('live').innerHTML = briefingCard(mineB, `${title} · ${ago(mineB.updated)}`,
      'AI summary of the links on this keycard only. Labels show how solid each point is.');
  } else if (cf && cf.live) {
    try {
      const src = await loadKeycard(cf.live);
      if (src.briefing) document.getElementById('live').innerHTML = briefingCard(src.briefing, `${title}${src.briefing.updated ? ' · ' + ago(src.briefing.updated) : ''}`,
        `AI summary of ${src.title}'s sources. Labels show how solid each point is.`);
    } catch (e) { /* no update yet */ }
  }
}
show();
