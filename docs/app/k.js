// A keycard someone made: /k/?id=<doc id>  (also /u/<id>/, the shareable page with a proper link preview)
// One layout for every shape: who made it and how fresh it is, then the most useful thing first.
//   Picks: the list first, "what's new" after it.  Sources: "right now" first.  Playbook: numbered steps + copy boxes.
import { loadKeycard, mountActions, onUser, esc, itemRow, fold, briefingCard, keycardUrl, makeUrl, share, kcHash,
         markChecked, ago, toast, ROOT, live, SHAPE_LABEL, whoFor } from './app.js';

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
  const vis = { private: 'Only you can see this', unlisted: 'Only people you send the link to can see this' }[k.visibility];
  const all = [...sections.flatMap(s => s.items), ...sources];
  // What came from the original: compare with the original itself, by name. (Older copies lost their markers
  // when saved, so the marker alone can't be trusted.) Falls back to the marker if the original can't be loaded.
  if (cf) {
    const norm = x => String(x || '').trim().toLowerCase();
    let names = null;
    try { const o = await loadKeycard(cf.id); names = new Set([...(o.sections || []).flatMap(x => x.items || []), ...(o.sources || [])].map(i => norm(i.name))); } catch (e) {}
    if (names && names.size) all.forEach(i => { i.from = names.has(norm(i.name)); });
  }
  const main = sections.length ? sections.flatMap(s => s.items) : sources;   // what people count: the picks or steps, else the sources
  const added = cf ? main.filter(i => !i.from).length : 0, inherited = cf ? main.length - added : 0;

  // Freshness: when the owner last edited or confirmed it. Picks and playbooks rot silently, so say so.
  const touched = [k.checked, k.updated].map(t => t && t.toMillis ? t.toMillis() : 0).reduce((a, b) => Math.max(a, b), 0);
  const days = touched ? (Date.now() - touched) / 864e5 : 0;
  const fresh = touched && !(cf && !k.edited) ? `Updated by ${esc(first)} ${esc(ago(new Date(touched).toISOString()))}` : '';
  const stale = touched && days > 90 && shape !== 'sources';

  const folds = sections.length || sources.length ? `<section class="kc-folds">
      ${sections.map((s, i) => fold(s.title || 'Picks', s.items.map(it => itemRow(it, cf && `added by ${first}`)), i === 0,
                                     shape === 'playbook' && i === 0)).join('')}
      ${sources.length ? fold('Sources', sources.map(it => itemRow(it, cf && `added by ${first}`)), !sections.length) : ''}
    </section>` : `<section class="card"><p class="kc-body">Nothing on here yet.</p></section>`;

  box.innerHTML = `
    <section class="kc-hero">
      <div class="eyebrow">${esc([SHAPE_LABEL[shape], k.subject].filter(Boolean).join(' · ') || 'Keycard')}</div>
      <h1 class="display kc-title">${esc(k.title)}</h1>
      <div class="kc-cur kc-by">${k.ownerPhoto ? `<img src="${esc(k.ownerPhoto)}" alt="" referrerpolicy="no-referrer">` : `<span class="kc-av">${esc(first.slice(0, 1))}</span>`}<span>By <b>${esc(by)}</b>${cf ? ` · based on <a href="${esc(keycardUrl(cf.id))}" style="color:inherit">${esc(cf.by)}'s</a>` : ''}</span></div>
      ${stale ? `<div class="kc-stale">Not checked for ${Math.round(days / 30)} months, so some of this may be out of date</div>` : fresh ? `<div class="kc-fresh">${fresh}</div>` : ''}
      ${cf && added ? `<div class="kc-fine">${inherited} from ${esc(cf.by)}${added ? ` · <span style="color:var(--good)">${added} added by ${esc(first)}</span>` : ''}</div>` : ''}
      ${k.tested ? `<div class="kc-tested">Tested with ${esc(k.tested)}</div>` : ''}
      ${vis ? `<div class="kc-fine" id="vis" hidden>${esc(vis)}</div>` : ''}
    </section>
    ${k.tagline ? `<p class="kc-body" style="margin-top:-6px">${esc(k.tagline)}</p>` : ''}
    <div class="kc-actions" id="acts"></div>
    <div id="mine"></div>
    ${shape === 'picks' && !k.watch ? folds + '<div id="live"></div>' : '<div id="live"></div>' + folds}`;

  onUser(u => {
    const preview = params.get('as') === 'friend';     // the owner, seeing it exactly as a friend would
    const own = u && u.uid === k.owner && !preview;
    if (preview && u && u.uid === k.owner && !document.querySelector('.kc-previewing'))
      box.insertAdjacentHTML('afterbegin', `<div class="kc-banner kc-previewing">This is what friends see. <a href="?id=${encodeURIComponent(docId)}" style="color:var(--accent)">Back to yours</a></div>`);
    const acts = document.getElementById('acts');
    const visEl = document.getElementById('vis'); if (visEl) visEl.hidden = !own;   // only the owner needs to know who can see it
    const noun = { picks: 'pick', sources: 'source', playbook: 'step' }[shape] || 'thing';
    const what = sections.length > 1 ? 'all of it' : main.length ? `all ${main.length} ${noun}${main.length === 1 ? '' : 's'}` : 'it';
    const copyNote = `Copy to get ${what} as your own, credited to ${first}. Change anything; ${first}'s stays as it is.`;
    if (!own) { mountActions(acts, k.id, { title: k.title, url: ROOT + 'u/' + docId + '/', copyNote, owner: k.owner,
      followNote: sources.length || (cf && cf.live) ? 'Follow to get its updates.' : `Follow to hear when ${first} changes it.` }); return; }
    acts.innerHTML = `<div class="kc-act-row"><a class="kc-btn kc-btn-main" href="${esc(makeUrl(docId))}">Edit</a>
      <button class="kc-btn" type="button" id="sh">Share</button></div>`;
    document.getElementById('sh').onclick = () => share(k.title, ROOT + 'u/' + docId + '/');
    // Results, for the owner: seeing your knowledge travel is the reward.
    acts.insertAdjacentHTML('beforeend', '<div class="kc-results" id="res"></div>');
    whoFor(k.id).then(r => {
      const el = document.getElementById('res'); if (!el || !r) return;
      const list = (names, verb) => names.length ? `<div><b>${names.length}</b> ${verb} <span>${esc(names.slice(0, 4).join(', '))}${names.length > 4 ? ` and ${names.length - 4} more` : ''}</span></div>` : '';
      const lines = [r.opens ? `<div><b>${r.opens}</b> open${r.opens === 1 ? '' : 's'}</div>` : '', list(r.copiers, r.copiers.length === 1 ? 'copy by' : 'copies by'), list(r.followers, 'following:')].filter(Boolean);
      el.insertAdjacentHTML('afterend', `<a class="kc-fine kc-asfriend" href="?id=${encodeURIComponent(docId)}&as=friend">See it as a friend would ›</a>`);
      el.innerHTML = lines.length ? lines.join('') : `<div class="kc-fine">Your keycard is ready to travel. Share it with someone who'd find it useful, and you'll see here when people open, follow or make their own version.</div>`;
    });
    const mine = document.getElementById('mine');

    // The moment after copying: this is yours now, here's what you got, three ways to make it yours.
    if (cf && !k.edited) {
      const groups = sections.length > 1 ? ` in ${sections.length} groups` : '';
      const n = main.length, noun = shape === 'sources' ? 'source' : shape === 'playbook' ? 'step' : 'pick';
      mine.innerHTML = `<section class="kc-mine">
        <b>${params.get('new') ? 'This is yours now.' : 'Make it yours.'}</b>
        <p>You got ${n} ${noun}${n === 1 ? '' : 's'}${groups}${cf.live ? ', plus live updates' : ''} from ${esc(cf.by.split(' ')[0])}. Change anything you like. ${esc(cf.by.split(' ')[0])}'s original stays as it is, and you'll hear if they update it.</p>
        <div class="kc-act-row">
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=title'))}">Rename</a>
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=add'))}">Add your own</a>
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=remove'))}">Remove some</a>
          <a class="kc-btn" href="${esc(makeUrl(docId, '&focus=watch'))}">Ask AI to watch for you</a>
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
        const f = box.querySelector('.kc-fresh, .kc-stale'); if (f) { f.className = 'kc-fresh'; f.textContent = `Updated by ${first} just now`; }
      };
    };
    // Picks without a reason: the most useful thing an owner can add. Comes before "still accurate?".
    const noWhy = sections.flatMap(x => x.items).filter(i => !(i.why || '').trim() && !i.copy).length;
    const nextMessage = () => {
      if (shape !== 'picks' || noWhy < 3) return stillAccurate();
      mine.innerHTML = `<section class="kc-mine"><b>${noWhy} picks have no reason yet.</b>
        <p>A few words on why each one is on your list is what makes it worth borrowing. One at a time, skip any you like.</p>
        <div class="kc-act-row"><a class="kc-btn kc-btn-main" href="${esc(makeUrl(docId, '&focus=reasons'))}">Add reasons</a></div></section>`;
    };
    if (!(cf && cf.hash)) return nextMessage();
    loadKeycard(cf.id).then(orig => {
      const seenKey = 'kc-seen-' + docId + '-' + kcHash(orig);
      let seen = false; try { seen = !!localStorage.getItem(seenKey); } catch (e) {}
      if (kcHash(orig) === cf.hash || seen) return nextMessage();
      mine.innerHTML = `<div class="kc-banner"><b>${esc(cf.by)} has updated the original</b> since you copied it. <a href="${esc(keycardUrl(cf.id))}" style="color:var(--accent)">See what's new</a>, then add anything you like to yours.</div>`;
      mine.querySelector('a').onclick = () => { try { localStorage.setItem(seenKey, '1'); } catch (e) {} };
    }).catch(stillAccurate);
  });

  // Living: the keycard's own AI update from its links; otherwise a copy of a live keycard shows the original's.
  // Picks (a restaurant list, favourite films) don't get news: general updates don't belong on someone's list.
  // ...unless the owner asked AI to watch something for them ("which are in Downtown? new places like these").
  if (shape === 'picks' && !k.watch) return;
  let mineB = null;
  try { const r = await fetch(ROOT + 'u/' + docId + '/briefing.json', { cache: 'no-cache' }); if (r.ok) mineB = await r.json(); } catch (e) {}
  const title = "What's new";
  if (mineB && ((mineB.points && mineB.points.length) || (mineB.from_list && mineB.from_list.length))) {
    document.getElementById('live').innerHTML = briefingCard(mineB, `${k.watch ? 'For ' + first : title} · ${ago(mineB.updated)}`,
      k.watch ? `${first} asked: “${k.watch.replace(/[.\s]+$/, '')}” Picks from the list only use what's on this keycard. Anything new links to where it came from.`
              : 'AI summary of the links on this keycard only. Labels show how solid each point is.');
  } else if (k.watch && shape === 'picks') {
    document.getElementById('live').innerHTML = `<section class="card kc-now"><div class="kc-h"><span class="label">For ${esc(first)}</span></div>
      <p class="kc-body">Watching for: “${esc(k.watch)}”. The first update arrives within a few hours.</p></section>`;
  } else if (cf && cf.live) {
    try {
      const src = await loadKeycard(cf.live);
      if (src.briefing) document.getElementById('live').innerHTML = briefingCard(src.briefing, `${title}${src.briefing.updated ? ' · ' + ago(src.briefing.updated) : ''}`,
        `AI summary of ${src.title}'s sources. Labels show how solid each point is.`);
    } catch (e) { /* no update yet */ }
  }
}
show();
