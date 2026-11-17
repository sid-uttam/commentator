// Make or edit a keycard: /make/ (new) or /make/?id=<doc id> (edit). Never a blank page: start from a shape or a copy.
import { onUser, signIn, loadKeycard, saveKeycard, deleteKeycard, keycardUrl, esc, toast, ROOT, live, SUBJECTS, catOf } from './app.js';

const box = document.getElementById('ed');
const params = new URLSearchParams(location.search);
const docId = params.get('id');

const STARTERS = {
  picks: {
    name: 'Picks', blurb: 'The best of something, and why. Places to eat, gear, books, spots in a city.',
    eg: 'Like Manav’s Dubai eats',
    k: { sections: [{ title: 'My picks', items: [] }], sources: [],
         instruction: 'New places or things worth adding, and anything on this list that has closed or changed.' } },
  sources: {
    name: 'Sources', blurb: 'Who to follow on a topic, and why each one is good. Channels, sites, podcasts, people.',
    eg: 'Like your FPL or AI investing setup',
    k: { sections: [], sources: [],
         instruction: 'The 3 to 5 things that mattered this week, and anything coming up.' } },
  routine: {
    name: 'Routine', blurb: 'A plan or habit you’ve figured out: the steps, the videos you use, your tips.',
    eg: 'Like Sid’s stretching for footballers',
    k: { sections: [{ title: 'The routine', items: [] }, { title: 'Videos I use', items: [] }, { title: 'Tips', items: [] }], sources: [],
         instruction: 'Help someone follow this week to week, and surface new videos from the creators listed.' } },
};

let k = null, owner = null, dirty = false;

function blankItem() { return { name: '', why: '', url: '' }; }

// "Name - why" or a pasted link per line becomes an item.
function parseLines(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const m = line.match(/https?:\/\/\S+/);
    const url = m ? m[0].replace(/[).,]+$/, '') : '';
    let rest = (m ? line.replace(m[0], '') : line).replace(/^[-*•\d.)\s]+/, '').trim();
    let name = rest, why = '';
    const split = rest.match(/^(.+?)\s+[-–—:|]\s+(.+)$/);
    if (split) { name = split[1]; why = split[2]; }
    if (!name && url) {
      try {
        const u = new URL(url); const host = u.hostname.replace(/^www\./, '');
        name = /youtu/.test(host) ? 'YouTube video' : /google\..*\/maps|maps\.app/.test(url) ? 'Place on Google Maps' : host;
      } catch (e) { name = url; }
    }
    return { name: name.replace(/[-–—:|]\s*$/, '').trim(), why, url };
  });
}

const linkOpen = new Set();
function itemHTML(it, path) {
  const showLink = it.url || linkOpen.has(path);
  return `<div class="ed-item"><div class="ed-item-f">
      <input data-p="${path}.name" value="${esc(it.name)}" placeholder="Name" aria-label="Name">
      <input class="why" data-p="${path}.why" value="${esc(it.why)}" placeholder="Why? (one line)" aria-label="Why">
      ${showLink ? `<input class="url" data-p="${path}.url" value="${esc(it.url)}" placeholder="Paste a link" inputmode="url" aria-label="Link">`
        : `<button class="ed-link" type="button" data-link="${path}">+ link</button>`}
    </div><button class="ed-x" type="button" data-rm="${path}" aria-label="Remove">×</button></div>`;
}

// Long copies (Manav's 94 places) start folded, so the editor stays short. Tap a section to open it.
const shut = new Set();
function listBox(title, items, path, hint, titlePath) {
  const isShut = shut.has(path);
  return `<section class="ed-sec${isShut ? ' shut' : ''}">
    <div class="ed-sec-h">${titlePath
      ? `<input data-p="${titlePath}" value="${esc(title)}" placeholder="Section name" aria-label="Section name">`
      : `<span class="label" style="padding:6px 4px">${esc(title)}</span>`}
      <button class="ed-tog" type="button" data-tog="${path}" aria-expanded="${!isShut}">${items.length} ${isShut ? '▸' : '▾'}</button>
      ${titlePath ? `<button class="ed-x" type="button" data-rmsec="${titlePath.split('.')[1]}" aria-label="Remove section">×</button>` : ''}</div>
    <div class="ed-sec-body">
    ${hint ? `<small class="kc-fine">${esc(hint)}</small>` : ''}
    ${items.map((it, i) => itemHTML(it, `${path}.${i}`)).join('')}
    <div class="ed-row">
      <button class="kc-btn" type="button" data-add="${path}">+ Add one</button>
      <button class="kc-btn kc-btn-quiet" type="button" data-pastebtn="${path}">Paste a list</button>
    </div>
    <div class="ed-paste" data-paste="${path}">
      <textarea placeholder="One per line. Links work too.&#10;e.g. Kinoya – best ramen in town https://maps.app.goo.gl/…"></textarea>
      <div class="ed-row"><button class="kc-btn kc-btn-main" type="button" data-pasteadd="${path}">Add these</button></div>
    </div></div>
  </section>`;
}

let moreOpen = false;
function render() {
  const wasOpen = box.querySelector('.ed-more'); if (wasOpen) moreOpen = wasOpen.open;
  const showSources = k.sources.length || k.kind === 'sources';
  box.innerHTML = `
    <form class="ed" onsubmit="return false">
      <input class="ed-title" data-p="title" value="${esc(k.title)}" placeholder="Name it, e.g. Dubai brunches" maxlength="80" aria-label="Name">
      <input data-p="tagline" value="${esc(k.tagline)}" placeholder="${k.copiedFrom ? 'What makes your version yours?' : 'In one line: what is it, who is it for?'}" maxlength="160" aria-label="One line">
      ${(k.sections || []).map((s, i) => listBox(s.title, s.items, `sections.${i}.items`, '', `sections.${i}.title`)).join('')}
      ${showSources ? listBox('Sources I follow', k.sources, 'sources', 'Channels, sites, podcasts, people. Say why each one is good.') : ''}
      <div class="ed-row">
        <button class="kc-btn kc-btn-quiet" type="button" data-addsec>+ Section</button>
        ${showSources ? '' : '<button class="kc-btn kc-btn-quiet" type="button" data-addsrc>+ Sources you follow</button>'}
      </div>
      <details class="ed-more"${moreOpen ? ' open' : ''}>
        <summary>More options</summary>
        <div class="ed-field"><span>Subject</span>
          <div class="ed-chips">${SUBJECTS.map(x => `<button type="button" class="ed-chip${catOf(k.subject) === x && k.subject ? ' on' : ''}" data-subject="${x}">${x}</button>`).join('')}</div></div>
        <label class="ed-field"><span>What should it keep an eye on?</span>
          <textarea data-p="instruction" placeholder="e.g. New openings that suit this list, and anything that has closed.">${esc(k.instruction)}</textarea>
          <small>For the short AI updates. They only use the sources on this keycard.</small></label>
        <div class="ed-field"><span>Who can see it</span>
          <div class="ed-vis">
            ${[['public', 'Everyone', 'On Discover'], ['unlisted', 'Link only', 'People you send it to'], ['private', 'Just me', 'Only you']]
              .map(([v, t, x]) => `<label><input type="radio" name="vis" value="${v}"${k.visibility === v ? ' checked' : ''}>${t}<small>${x}</small></label>`).join('')}
          </div></div>
        ${docId ? `<button class="kc-btn kc-btn-danger" type="button" data-delete>Delete this keycard</button>` : ''}
      </details>
      <div class="ed-bar">
        <a class="kc-btn" href="${docId ? esc(keycardUrl('user:' + docId)) : ROOT}">Cancel</a>
        <button class="kc-btn kc-btn-main" type="button" data-save>Save</button>
      </div>
    </form>`;
}

function getPath(path) { return path.split('.').reduce((o, p) => o[p], k); }
function setPath(path, v) { const ps = path.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p], k)[last] = v; }

box.addEventListener('input', e => {
  const p = e.target.dataset.p;
  if (p) { setPath(p, e.target.value); dirty = true; }
  if (e.target.name === 'vis') { k.visibility = e.target.value; dirty = true; }
});
box.addEventListener('change', e => { if (e.target.name === 'vis') k.visibility = e.target.value; });
box.addEventListener('click', async e => {
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.starter) { start(d.starter); return; }
  if (d.link) { linkOpen.add(d.link); render(); box.querySelector(`[data-p="${d.link}.url"]`).focus(); return; }
  if (d.addsrc) { k.kind = 'sources'; k.sources.push(blankItem()); dirty = true; render(); focusLast('sources'); return; }
  if (d.tog) { shut.has(d.tog) ? shut.delete(d.tog) : shut.add(d.tog); render(); return; }
  if (d.subject) { k.subject = catOf(k.subject) === d.subject && k.subject ? '' : d.subject; dirty = true; render(); return; }
  if (d.add) { getPath(d.add).push(blankItem()); dirty = true; render(); focusLast(d.add); return; }
  if (d.rm) { const ps = d.rm.split('.'); const i = +ps.pop(); getPath(ps.join('.')).splice(i, 1); dirty = true; render(); return; }
  if (d.rmsec) { if (!confirm('Remove this section and everything in it?')) return; shut.clear(); k.sections.splice(+d.rmsec, 1); dirty = true; render(); return; }
  if (d.addsec) { k.sections.push({ title: '', items: [blankItem()] }); dirty = true; render(); box.querySelector(`[data-p="sections.${k.sections.length - 1}.title"]`).focus(); return; }
  if (d.pastebtn) { const p = box.querySelector(`[data-paste="${d.pastebtn}"]`); p.classList.toggle('on'); p.querySelector('textarea').focus(); return; }
  if (d.pasteadd) {
    const ta = box.querySelector(`[data-paste="${d.pasteadd}"] textarea`);
    const items = parseLines(ta.value);
    if (!items.length) return toast('Paste one thing per line');
    const list = getPath(d.pasteadd);
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].name && !list[i].url) list.splice(i, 1);
    list.push(...items); dirty = true; render(); toast(`Added ${items.length}`); return;
  }
  if (d.save !== undefined) return save(t);
  if (d.delete !== undefined) {
    if (!confirm('Delete this keycard? This can’t be undone.')) return;
    await deleteKeycard(docId); toast('Deleted'); location.href = ROOT + 'me/';
  }
});
function focusLast(path) { const els = box.querySelectorAll(`[data-p^="${path}."][data-p$=".name"]`); if (els.length) els[els.length - 1].focus(); }

async function save(btn) {
  if (!k.title.trim()) { toast('Give it a name first'); box.querySelector('[data-p="title"]').focus(); return; }
  const keep = it => (it.name || '').trim() || (it.url || '').trim();
  const tidy = it => ({ name: it.name.trim(), why: it.why.trim(), url: it.url.trim() });
  const data = {
    title: k.title.trim(), tagline: k.tagline.trim(), subject: k.subject || '',
    sections: k.sections.map(s => ({ title: s.title.trim() || 'Picks', items: s.items.filter(keep).map(tidy) })).filter(s => s.items.length),
    sources: k.sources.filter(keep).map(tidy), instruction: k.instruction.trim(),
    visibility: k.visibility, copiedFrom: k.copiedFrom || null, edited: !!(k.edited || (k.copiedFrom && dirty) || !k.copiedFrom),
  };
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const id = await saveKeycard(docId, data);
    dirty = false;
    location.href = keycardUrl('user:' + id);
  } catch (e) { console.error(e); toast("Couldn't save. Check your connection and try again."); btn.disabled = false; btn.textContent = 'Save'; }
}

function start(kind) {
  const s = STARTERS[kind];
  k = { title: '', tagline: '', subject: '', visibility: 'public', copiedFrom: null, kind, ...JSON.parse(JSON.stringify(s.k)) };
  k.sections.forEach(sec => { if (!sec.items.length) sec.items.push(blankItem()); });
  if (kind === 'sources') k.sources.push(blankItem());
  render();
  box.querySelector('[data-p="title"]').focus();
}

function starters() {
  box.innerHTML = `<section class="kc-hero"><div class="eyebrow">New keycard</div>
      <h1 class="display kc-title">MAKE A KEYCARD</h1>
      <p class="kc-body">Share something you know. Pick a shape to start.</p></section>
    <div class="starters">${Object.entries(STARTERS).map(([key, s]) =>
      `<button class="starter" type="button" data-starter="${key}"><b>${s.name}</b><span>${s.blurb}</span><i>${s.eg}</i></button>`).join('')}</div>
    <p class="kc-fine" style="text-align:center">Or find one on <a href="${ROOT}">Discover</a>, tap Copy and make it yours.</p>`;
}

function signInFirst() {
  box.innerHTML = `<section class="kc-hero"><div class="eyebrow">New keycard</div><h1 class="display kc-title">MAKE A KEYCARD</h1></section>
    <section class="card"><p class="kc-body">Sign in so your keycard is saved and you can share it.</p>
    <button class="kc-btn kc-btn-main" type="button" id="si">Sign in with Google</button></section>`;
  document.getElementById('si').onclick = () => signIn();
}

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

let started = false;
onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Making keycards opens very soon.</p></section>`; return; }
  if (!u) { owner = null; return signInFirst(); }
  if (started && owner === u.uid) return;
  started = true; owner = u.uid;
  if (!docId) return starters();
  try {
    const got = await loadKeycard('user:' + docId);
    if (got.owner !== u.uid) { location.href = keycardUrl('user:' + docId); return; }
    k = { title: '', tagline: '', subject: '', sections: [], sources: [], instruction: '', visibility: 'public', ...got };
    if (k.sections.length > 3) k.sections.forEach((sec, i) => shut.add(`sections.${i}.items`));
    if (k.sources.length > 6) shut.add('sources');
    render();
  } catch (e) { box.innerHTML = `<section class="card"><p class="kc-body">We couldn't find that keycard. <a href="${ROOT}me/">Your keycards</a></p></section>`; }
});
