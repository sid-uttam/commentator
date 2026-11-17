// Make or edit a keycard: /make/ (new) or /make/?id=<doc id> (edit). Never a blank page: start from a shape or a copy.
import { onUser, signIn, noteStart, loadKeycard, saveKeycard, deleteKeycard, keycardUrl, esc, toast, ROOT, live, SUBJECTS, catOf, aiUrl, askAI } from './app.js';

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
  playbook: {
    name: 'Playbook', blurb: 'How you do something: your steps, setup and the exact prompts or settings people can copy.',
    eg: 'Like how Sid uses Claude, or his stretching routine',
    k: { sections: [{ title: 'How I do it', items: [] }, { title: 'Copy these', items: [] }, { title: 'Where I learned it', items: [] }], sources: [],
         instruction: 'New techniques, tools and videos from the creators listed, and anything in this playbook that has gone out of date.' } },
};

// Ready-made drafts: make/?template=claude
const TEMPLATES = {
  claude: { shape: 'playbook', subject: 'Learning', title: 'How I use Claude', tested: 'Claude, Nov 2026',
    tagline: 'The setup I use to build products with Claude without being a full-time developer.',
    sections: [
      { title: 'How I do it', items: [
        { name: 'One Project per product', why: 'Briefs, decisions and chats live together, so every new chat starts with context.' },
        { name: 'Briefs as Project docs', why: 'A product brief, a spec and a plan that Claude reads and keeps up to date.' },
        { name: 'A public site and a private engine', why: 'Pages on GitHub Pages; code, data and keys in a private repo.' },
        { name: 'Start each day with "pick up where we left off"', why: 'A skill that catches up on docs, chats and repos, then lists what is next.' }] },
      { title: 'Copy these', items: [
        { name: 'My "pick up where we left off" skill', why: 'Paste into a new skill and change the project names.', copy: '' },
        { name: 'My custom instructions', why: '', copy: '' }] },
      { title: 'Where I learned it', items: [{ name: '', why: '', url: '' }] }] },
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

const linkOpen = new Set(), copyOpen = new Set();
function itemHTML(it, path) {
  const showLink = it.url || linkOpen.has(path);
  const showCopy = typeof it.copy === 'string' || copyOpen.has(path);   // items made for copying start with copy: ''
  return `<div class="ed-item"><div class="ed-item-f">
      <input data-p="${path}.name" value="${esc(it.name)}" placeholder="Name" aria-label="Name">
      <input class="why" data-p="${path}.why" value="${esc(it.why)}" placeholder="Why? (one line)" aria-label="Why">
      ${showLink ? `<input class="url" data-p="${path}.url" value="${esc(it.url)}" placeholder="Paste a link" inputmode="url" aria-label="Link">` : ''}
      ${showCopy ? `<textarea class="copy" data-p="${path}.copy" placeholder="Text people can copy: a prompt, instructions, settings…" aria-label="Text to copy">${esc(it.copy || '')}</textarea>` : ''}
      ${!showLink || (!showCopy && k.shape === 'playbook') ? `<div class="ed-row" style="gap:12px">
        ${showLink ? '' : `<button class="ed-link" type="button" data-link="${path}">+ link</button>`}
        ${showCopy || k.shape !== 'playbook' ? '' : `<button class="ed-link" type="button" data-copyopen="${path}">+ text to copy</button>`}</div>` : ''}
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
      ${items.length > 6 || isShut ? `<button class="ed-tog" type="button" data-tog="${path}" aria-expanded="${!isShut}">${isShut ? `Show ${items.length}` : 'Hide'}</button>` : ''}
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
      <input class="ed-title" data-p="title" value="${esc(k.title)}" placeholder="Name it" maxlength="80" aria-label="Name">
      <input data-p="tagline" value="${esc(k.tagline)}" placeholder="${k.copiedFrom ? 'What makes your version yours?' : 'In one line: what is it, who is it for?'}" maxlength="160" aria-label="One line">
      ${(k.sections || []).map((s, i) => listBox(s.title, s.items, `sections.${i}.items`, '', `sections.${i}.title`)).join('')}
      ${showSources ? listBox('Sources I follow', k.sources, 'sources', 'Paste links to YouTube channels or websites and you get a short AI update from them every few hours. Say why each one is good.') : ''}
      <div class="ed-row">
        <button class="kc-btn kc-btn-quiet" type="button" data-addsec>+ Section</button>
        ${showSources ? '' : '<button class="kc-btn kc-btn-quiet" type="button" data-addsrc>+ Sources for updates</button>'}
      </div>
      <details class="ed-more"${moreOpen ? ' open' : ''}>
        <summary>More options</summary>
        <div class="ed-field"><span>Subject</span>
          <div class="ed-chips">${SUBJECTS.map(x => `<button type="button" class="ed-chip${catOf(k.subject) === x && k.subject ? ' on' : ''}" data-subject="${x}">${x}</button>`).join('')}</div></div>
        <label class="ed-field"><span>What should it keep an eye on?</span>
          <textarea data-p="instruction" placeholder="e.g. New openings that suit this list, and anything that has closed.">${esc(k.instruction)}</textarea>
          <small>For the short AI updates. They only use the sources on this keycard.</small></label>
        ${k.shape === 'playbook' ? `<label class="ed-field"><span>Tested with</span>
          <input data-p="tested" value="${esc(k.tested || '')}" placeholder="e.g. Claude, Nov 2026"><small>Tools change fast. This tells people how fresh your playbook is.</small></label>` : ''}
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
// Signed out: let people see how making works, and only ask them to sign in when they start.
// What they'd typed is kept, and the step carries on straight after sign-in.
const MAKE_PENDING = 'kc-make-pending';
box.addEventListener('click', e => {
  if (owner) return;
  const b = e.target.closest('[data-ivstart],[data-frompaste],[data-blank],[data-idea],[data-findideas]'); if (!b) return;
  if (b.matches('[data-idea]') && b.dataset.idea.includes('…')) return;   // just fills the box; no need to sign in yet
  e.preventDefault(); e.stopImmediatePropagation();
  const act = b.matches('[data-ivstart],[data-idea]') ? 'ivstart' : b.matches('[data-findideas]') ? 'find' : b.matches('[data-frompaste]') ? 'frompaste' : 'blank';
  const topic = b.matches('[data-idea]') ? b.dataset.idea : ((document.getElementById('iv-topic') || {}).value || '').trim();
  if (act === 'ivstart' && !topic) { toast('What would you like to share?'); return; }
  const answers = [0, 1, 2].map(i => (document.getElementById('fq' + i) || {}).value || '');
  if (act === 'find' && !answers.some(a => a.trim())) { toast('Answer at least one, even briefly'); return; }
  try { sessionStorage.setItem(MAKE_PENDING, JSON.stringify({ act, topic, answers, paste: (document.getElementById('paste0') || {}).value || '' })); } catch (x) {}
  signIn();
}, true);

box.addEventListener('click', async e => {
  if (e.target.closest('[data-showpaste]')) { e.preventDefault(); const pb = document.getElementById('paste-box'); pb.hidden = false; pb.querySelector('textarea').focus(); return; }
  if (e.target.closest('[data-blank]')) { e.preventDefault(); start('picks'); return; }
  if (e.target.closest('[data-ivquit]')) { e.preventDefault(); iv = null; pick = null; try { sessionStorage.removeItem(IV); } catch (x) {} starters(); return; }
  if (e.target.closest('[data-back]')) { e.preventDefault(); pick = null; starters(); scrollTo(0, 0); return; }
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.starter) { start(d.starter); return; }
  if (d.ivchip) { const t = document.getElementById('iv-topic'); t.value = d.ivchip.replace('…', ' '); t.focus(); return; }
  if (d.choice) { pick = d.choice; starters(); scrollTo(0, 0); return; }
  if (d.idea) {
    if (d.idea.includes('…')) {                       // "My 5 favourite restaurants in …": they finish the sentence
      const t = document.getElementById('iv-topic'); t.value = d.idea.replace('…', '').trim() + ' ';
      t.focus(); t.setSelectionRange(t.value.length, t.value.length); toast('Finish the sentence, then Start'); return;
    }
    startInterview(d.idea); return;
  }
  if (d.findideas !== undefined) { findIdeas([0, 1, 2].map(i => document.getElementById('fq' + i).value)); return; }
  if (d.ivstart !== undefined) {
    const topic = document.getElementById('iv-topic').value.trim();
    if (!topic) { toast('What would you like to share?'); return; }
    startInterview(topic); return;
  }
  if (d.ivnext !== undefined) {
    const a = document.getElementById('iv-a').value.trim();
    if (!a) { toast('Type an answer, even a short one'); return; }
    iv.turns.push({ q: iv.q, a }); iv.q = ''; ivSave(); ivAsk(); return;
  }
  if (d.ivdone !== undefined) { const a = document.getElementById('iv-a'); if (a && a.value.trim()) iv.turns.push({ q: iv.q, a: a.value.trim() }); ivDraft(); return; }
  if (d.ivretry !== undefined) { iv.q ? renderIv() : ivAsk(); return; }
  if (d.frompaste !== undefined) { startFromPaste(document.getElementById('paste0').value); return; }
  if (d.copyopen) { copyOpen.add(d.copyopen); const it = getPath(d.copyopen); if (it.copy === undefined) it.copy = ''; render(); box.querySelector(`[data-p="${d.copyopen}.copy"]`).focus(); return; }
  if (d.link) { linkOpen.add(d.link); render(); box.querySelector(`[data-p="${d.link}.url"]`).focus(); return; }
  if (d.addsrc) { k.kind = 'sources'; k.sources.push(blankItem()); dirty = true; render(); focusLast('sources'); return; }
  if (d.tog) { shut.has(d.tog) ? shut.delete(d.tog) : shut.add(d.tog); render(); return; }
  if (d.subject) { k.subject = catOf(k.subject) === d.subject && k.subject ? '' : d.subject; dirty = true; render(); return; }
  if (d.add) { const list = getPath(d.add), last = list[list.length - 1]; list.push({ ...blankItem(), ...(last && typeof last.copy === 'string' ? { copy: '' } : {}) }); dirty = true; render(); focusLast(d.add); return; }
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

let made = null;   // how this keycard was started, and when: { how, t0 }
async function save(btn) {
  if (!k.title.trim()) { toast('Give it a name first'); box.querySelector('[data-p="title"]').focus(); return; }
  const keep = it => (it.name || '').trim() || (it.url || '').trim() || (it.copy || '').trim();
  const tidy = it => ({ name: (it.name || '').trim(), why: (it.why || '').trim(), url: (it.url || '').trim(), ...(it.copy ? { copy: it.copy.trim() } : {}), ...(it.from ? { from: true } : {}) });
  const data = {
    title: k.title.trim(), tagline: k.tagline.trim(), subject: k.subject || '',
    sections: k.sections.map(s => ({ title: s.title.trim() || 'Picks', items: s.items.filter(keep).map(tidy) })).filter(s => s.items.length),
    sources: k.sources.filter(keep).map(tidy), instruction: k.instruction.trim(),
    shape: k.shape || '', tested: (k.tested || '').trim(),
    visibility: k.visibility, copiedFrom: k.copiedFrom || null, edited: !!(k.edited || (k.copiedFrom && dirty) || !k.copiedFrom),
  };
  if (!docId && made) data.made = { how: made.how, secs: Math.round((Date.now() - made.t0) / 1000) };
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const id = await saveKeycard(docId, data);
    dirty = false;
    location.href = keycardUrl('user:' + id);
  } catch (e) { console.error(e); toast("Couldn't save. Check your connection and try again."); btn.disabled = false; btn.textContent = 'Save'; }
}

function start(kind) {
  if (!made) { made = { how: 'blank', t0: Date.now() }; noteStart('blank'); }
  const s = STARTERS[kind];
  k = { title: '', tagline: '', subject: '', visibility: 'public', copiedFrom: null, kind, shape: kind, tested: '', ...JSON.parse(JSON.stringify(s.k)) };
  if (kind === 'playbook') k.sections.filter(sec => sec.title === 'Copy these').forEach(sec => sec.items.forEach(it => { it.copy = ''; }));
  k.sections.forEach(sec => { if (!sec.items.length) sec.items.push(sec.title === 'Copy these' ? { ...blankItem(), copy: '' } : blankItem()); });
  if (kind === 'sources') k.sources.push(blankItem());
  render();
  box.querySelector('[data-p="title"]').focus();
}

// Turn a pasted note or list into sections and items. Headings ("## Thai", "THAI:", "Thai:") start a section.
function fromPaste(text) {
  const sections = []; let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const h = line.match(/^#{1,4}\s*(.+)$/) || (!/https?:\/\//.test(line) && line.match(/^([^-*•\d].{1,50}):$/))
      || (line.length < 40 && line === line.toUpperCase() && /[A-Z]/.test(line) && !/https?:/.test(line) ? [line, line] : null);
    if (h) { cur = { title: h[1].replace(/:$/, '').trim(), items: [] }; sections.push(cur); continue; }
    if (!cur) { cur = { title: 'My picks', items: [] }; sections.push(cur); }
    cur.items.push(...parseLines(line));
  }
  return sections.filter(s => s.items.length);
}

function startFromPaste(text) {
  const sections = fromPaste(text);
  if (!sections.length) return toast('Paste a few lines first');
  made = { how: 'paste', t0: Date.now() }; noteStart('paste');
  const links = sections.flatMap(s => s.items).filter(i => /youtu|\/feed|rss/.test(i.url || '')).length;
  const kind = links > sections.flatMap(s => s.items).length / 2 ? 'sources' : 'picks';
  k = { title: '', tagline: '', subject: '', visibility: 'public', copiedFrom: null, kind, shape: kind, tested: '',
        sections, sources: [], instruction: STARTERS[kind].k.instruction };
  if (sections.length > 3) sections.forEach((sec, i) => shut.add(`sections.${i}.items`));
  dirty = true; render();
  toast(`Made ${sections.flatMap(s => s.items).length} items in ${sections.length} section${sections.length === 1 ? '' : 's'}. Give it a name.`);
  box.querySelector('[data-p="title"]').focus();
}

// ---------- "Interview me": a short conversation that becomes a keycard, in your words ----------
const IV = 'kc-interview';
let iv = null;   // { topic, turns: [{q, a}], q }
const ivSave = () => { try { sessionStorage.setItem(IV, JSON.stringify(iv)); } catch (e) {} };

function renderIv(state, err) {
  const n = iv.turns.length;
  box.innerHTML = `<section class="iv">
      <div class="eyebrow">Interview · ${esc(iv.topic)}</div>
      ${n ? `<details class="iv-past"${n <= 2 ? ' open' : ''}><summary>Your answers so far (${n})</summary>
        ${iv.turns.map(t => `<div class="iv-turn"><span>${esc(t.q)}</span><p>${esc(t.a)}</p></div>`).join('')}</details>` : ''}
      ${state === 'drafting' ? `<p class="iv-q">Writing your keycard, in your words…</p><div class="iv-dots"><i></i><i></i><i></i></div>`
        : state === 'thinking' ? `<div class="iv-dots"><i></i><i></i><i></i></div>`
        : `<p class="iv-q">${esc(iv.q)}</p>
           <textarea id="iv-a" placeholder="Type your answer. As long or short as you like."></textarea>
           <div class="ed-row">
             <button class="kc-btn kc-btn-main" type="button" data-ivnext>Next</button>
             ${n >= 3 ? '<button class="kc-btn" type="button" data-ivdone>Make my keycard</button>' : ''}
           </div>`}
      ${err ? `<div class="kc-banner">${esc(err)} <button class="kc-btn kc-btn-quiet" type="button" data-ivretry>Try again</button></div>` : ''}
      <p class="kc-fine">${state ? '' : `Question ${n + 1} of about 5. `}You'll see and edit everything before it's saved.
        <a href="#" data-ivquit style="color:var(--faint)">Stop</a></p>
    </section>`;
  const a = document.getElementById('iv-a'); if (a) a.focus();
}

async function ivAsk() {
  renderIv('thinking');
  try {
    const d = await askAI('ask', iv.topic, iv.turns);
    if (d.done) return ivDraft();
    // Never leave a blank question: if the AI sends nothing back, ask a sensible next one ourselves.
    const fallback = ['Walk me through it, step by step.', 'Why do you do it this way?', 'What did you get wrong when you started?',
                      'What would you tell someone just starting out?', 'Anything else someone should know?'];
    iv.q = (d.question || '').trim() || fallback[Math.min(iv.turns.length, fallback.length - 1)];
    ivSave(); renderIv();
  } catch (e) { renderIv(null, e.message); }
}

async function ivDraft() {
  renderIv('drafting');
  try {
    const kd = (await askAI('draft', iv.topic, iv.turns)).keycard || {};
    made = { how: 'interview', t0: iv.t0 || Date.now() };
    const shape = ['picks', 'sources', 'playbook'].includes(kd.shape) ? kd.shape : 'playbook';
    const item = i => ({ name: i.name || '', why: i.why || '', url: i.url || '', ...(i.copy ? { copy: i.copy } : {}) });
    k = { title: kd.title || iv.topic, tagline: kd.tagline || '', subject: SUBJECTS.includes(kd.subject) ? kd.subject : '',
          visibility: 'public', copiedFrom: null, kind: shape, shape, tested: '',
          sections: (kd.sections || []).map(x => ({ title: x.title || '', items: (x.items || []).map(item) })).filter(x => x.items.length),
          sources: (kd.sources || []).map(item), instruction: kd.instruction || STARTERS[shape].k.instruction };
    if (!k.sections.length && !k.sources.length) k.sections = [{ title: 'My picks', items: [blankItem()] }];
    try { sessionStorage.removeItem(IV); } catch (e) {}
    iv = null; dirty = true; render();
    toast("Here's your draft. Fix anything that's off, then Save.");
  } catch (e) { renderIv(null, e.message); }
}

// One obvious way in: the interview (or a paste, until the interview is switched on). No shapes to choose:
// the interview or the paste works out the shape; "start blank" is there for people who know what they want.
// First-time making: don't ask "what keycard?". Help people notice what they already know.
// Four kinds of thing to share, each with a few small, relatable ideas; or let the AI find one with them.
const CHOICES = [
  { key: 'places', label: 'My favourite places', sub: 'Restaurants, trips, things to do',
    ideas: ['My 5 favourite restaurants in …', 'Where I take friends visiting …', 'My perfect weekend in …', 'My favourite coffee spots in …', "Trips I'd happily do again"] },
  { key: 'figured', label: "Something I've figured out", sub: "Advice, lessons, what I wish I'd known",
    ideas: ["What I wish I'd known before moving abroad", "My beginner's guide to …", 'Lessons from travelling solo', 'Things I learned the hard way about money', "Advice I'd give someone starting their career"] },
  { key: 'how', label: 'How I do something', sub: 'Routines, systems, how I use AI',
    ideas: ['How I get the most out of ChatGPT or Claude', 'My morning routine', 'How I recover after sport', 'How I plan a holiday', 'How I approach FPL every week'] },
  { key: 'sources', label: 'People and sources I trust', sub: 'Who I follow, and why',
    ideas: ['Who I follow to understand AI', 'YouTube channels I actually watch', 'Podcasts and newsletters I really read', 'The best people to follow for football', 'Money and investing sources I trust'] },
];
const FIND_QS = ['What do friends or colleagues usually come to you for?', "What's something you've spent ages learning or figuring out?", 'What do you love recommending or explaining?'];
let pick = null, found = null;   // which choice is open; ideas the AI suggested

function starters() {
  if (pick === 'find') return renderFind();
  const c = CHOICES.find(x => x.key === pick);
  if (c) return renderChoice(c);
  const paste = `<section class="ed-sec ed-start" id="paste-box"${aiUrl ? ' hidden' : ''}>
      <span class="label">Paste what you already have</span>
      <textarea id="paste0" placeholder="A list, a note, your Maps list copied out… One thing per line. Headings become sections.&#10;&#10;Japanese:&#10;Kinoya – best ramen in town&#10;Kokoro – hand rolls"></textarea>
      <button class="kc-btn kc-btn-main" type="button" data-frompaste>Turn it into a keycard</button>
    </section>`;
  box.innerHTML = `<section class="kc-hero">
      <h1 class="display kc-title">EVERYONE KNOWS SOMETHING.</h1>
      <p class="kc-body">Turn something you've figured out into a keycard someone else can borrow. What would you like to share?</p></section>
    ${aiUrl ? `<div class="mk-choices">
      ${CHOICES.map(x => `<button type="button" class="mk-choice" data-choice="${x.key}"><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></button>`).join('')}
      <button type="button" class="mk-choice mk-find" data-choice="find"><b>Help me find an idea</b><span>Three quick questions, then a few ideas to pick from</span></button>
    </div>` : ''}
    ${paste}
    <p class="kc-fine" style="text-align:center">${aiUrl ? '<a href="#" data-showpaste>Already have a list? Paste it</a> · ' : ''}<a href="#" data-blank>Start blank</a> · <a href="${ROOT}">Copy one from Discover</a></p>
    ${owner ? '' : '<p class="kc-fine" style="text-align:center">Free. You\'ll sign in with Google when you start, so it\'s saved.</p>'}`;
}

function renderChoice(c) {
  box.innerHTML = `<a href="#" class="mk-back" data-back>‹ Back</a>
    <section class="kc-hero"><h1 class="display kc-title">${esc(c.label.toUpperCase())}</h1>
      <p class="kc-body">Tap one to start, or say it your way. Small is good: five things is plenty.</p></section>
    <div class="mk-ideas">${c.ideas.map(i => `<button type="button" class="mk-idea" data-idea="${esc(i)}">${esc(i)}</button>`).join('')}</div>
    <section class="ed-sec ed-start">
      <span class="label">Or in your own words</span>
      <input id="iv-topic" placeholder="e.g. ${esc(c.ideas[0].replace(' …', ' Dubai'))}" maxlength="80">
      <button class="kc-btn kc-btn-main" type="button" data-ivstart>Start</button>
    </section>
    <p class="kc-fine" style="text-align:center">A few questions, then AI writes it up in your words. You check it before it's saved.</p>`;
}

function renderFind(state, err) {
  const vals = [0, 1, 2].map(i => ((document.getElementById('fq' + i) || {}).value) || (found && found.answers ? found.answers[i] : '') || '');
  box.innerHTML = `<a href="#" class="mk-back" data-back>‹ Back</a>
    <section class="kc-hero"><h1 class="display kc-title">HELP ME FIND AN IDEA</h1>
      <p class="kc-body">Answer one or all three. A few words is fine.</p></section>
    <section class="ed-sec ed-start">
      ${FIND_QS.map((q, i) => `<label class="mk-q"><span>${esc(q)}</span><textarea id="fq${i}" rows="2" maxlength="400">${esc(vals[i])}</textarea></label>`).join('')}
      <button class="kc-btn kc-btn-main" type="button" data-findideas>${found && found.ideas ? 'Suggest different ideas' : 'Suggest ideas'}</button>
    </section>
    ${state === 'thinking' ? '<div class="iv-dots"><i></i><i></i><i></i></div>' : ''}
    ${err ? `<div class="kc-banner">${esc(err)}</div>` : ''}
    ${found && found.ideas && state !== 'thinking' ? `<span class="label" style="display:block;margin:18px 4px 8px">Tap one to start</span>
      <div class="mk-ideas">${found.ideas.map(i => `<button type="button" class="mk-idea" data-idea="${esc(i.start)}"><b>${esc(i.title)}</b></button>`).join('')}</div>` : ''}`;
}

async function findIdeas(answers) {
  if (!answers.some(a => a.trim())) { toast('Answer at least one, even briefly'); return; }
  found = { answers, ideas: found && found.ideas };
  renderFind('thinking');
  try {
    const d = await askAI('ideas', 'Help me find an idea', FIND_QS.map((q, i) => ({ q, a: answers[i] || '' })));
    found = { answers, ideas: d.ideas || [] };
    renderFind();
    const first = box.querySelector('.mk-ideas'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!found.ideas.length) renderFind(null, "Couldn't come up with ideas from that. Add a bit more and try again?");
  } catch (e) { renderFind(null, e.message); }
}

function startInterview(topic) {
  iv = { topic, turns: [], q: '', t0: Date.now() }; noteStart('interview'); ivAsk();
}

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

let started = false;
onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Making keycards opens very soon.</p></section>`; return; }
  if (!u) { owner = null; return starters(); }
  if (started && owner === u.uid) return;
  started = true; owner = u.uid;
  const tpl = TEMPLATES[params.get('template')];
  if (!docId && tpl) {
    k = { tagline: '', visibility: 'public', copiedFrom: null, kind: tpl.shape, sources: [], instruction: STARTERS[tpl.shape].k.instruction, ...JSON.parse(JSON.stringify(tpl)) };
    return render();
  }
  if (!docId) {
    let pend = null;
    try { pend = JSON.parse(sessionStorage.getItem(MAKE_PENDING) || 'null'); sessionStorage.removeItem(MAKE_PENDING); } catch (e) {}
    if (pend) {
      starters();
      if (pend.act === 'blank') return start('picks');
      if (pend.act === 'frompaste') return startFromPaste(pend.paste);
      if (pend.act === 'ivstart' && aiUrl) return startInterview(pend.topic);
      if (pend.act === 'find' && aiUrl) { pick = 'find'; found = { answers: pend.answers || [] }; starters(); return findIdeas(pend.answers || []); }
    }
    try { iv = JSON.parse(sessionStorage.getItem(IV) || 'null'); } catch (e) { iv = null; }
    if (iv && iv.q && aiUrl) return renderIv();
    return starters();
  }
  try {
    const got = await loadKeycard('user:' + docId);
    if (got.owner !== u.uid) { location.href = keycardUrl('user:' + docId); return; }
    k = { title: '', tagline: '', subject: '', sections: [], sources: [], instruction: '', visibility: 'public', tested: '', ...got };
    if (!k.shape && (k.sections || []).some(sec => sec.items.some(it => it.copy))) k.shape = 'playbook';
    if (k.sections.length > 3) k.sections.forEach((sec, i) => shut.add(`sections.${i}.items`));
    if (k.sources.length > 6) shut.add('sources');
    const focus = params.get('focus');
    if (focus === 'remove') shut.clear();                       // open everything so they can tap × on what they don't want
    if (focus === 'add') {                                     // a blank line at the top of the first list, ready to type
      const list = k.sections.length ? k.sections[0].items : k.sources;
      list.unshift(blankItem()); shut.delete(k.sections.length ? 'sections.0.items' : 'sources'); dirty = true;
    }
    render();
    if (focus === 'title') { const t = box.querySelector('[data-p="title"]'); t.focus(); t.select(); }
    if (focus === 'add') box.querySelector(`[data-p="${k.sections.length ? 'sections.0.items' : 'sources'}.0.name"]`).focus();
    if (focus === 'remove') toast('Tap × on anything you don\'t want, then Save');
  } catch (e) { box.innerHTML = `<section class="card"><p class="kc-body">We couldn't find that keycard. <a href="${ROOT}me/">Your keycards</a></p></section>`; }
});
