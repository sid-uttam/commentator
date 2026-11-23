// Make or edit a keycard: /make/ (new) or /make/?id=<doc id> (edit). Never a blank page: start from a shape or a copy.
import { onUser, signIn, signInSheet, noteStart, searchKeycards, saveAsk, loadKeycard, saveKeycard, deleteKeycard, keycardUrl, esc, toast, ROOT, live, SUBJECTS, catOf, aiUrl, askAI, itemRow, myName, SHAPE_LABEL, fold, isRules, rulesCard } from './app.js';

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
const fitWhy = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
const fitAllWhy = () => box.querySelectorAll('textarea.why').forEach(fitWhy);
function itemHTML(it, path) {
  const showLink = it.url || linkOpen.has(path);
  const showCopy = typeof it.copy === 'string' || copyOpen.has(path);   // items made for copying start with copy: ''
  return `<div class="ed-item"><div class="ed-item-f">
      <input data-p="${path}.name" value="${esc(it.name)}" placeholder="Name" aria-label="Name">
      <textarea class="why" data-p="${path}.why" rows="1" placeholder="Why?" aria-label="Why">${esc(it.why)}</textarea>
      ${showLink ? `<input class="url" data-p="${path}.url" value="${esc(it.url)}" placeholder="Paste a link" inputmode="url" aria-label="Link">` : ''}
      ${showCopy ? `<textarea class="copy" data-p="${path}.copy" placeholder="Text people can copy: a prompt, instructions, settings…" aria-label="Text to copy">${esc(it.copy || '')}</textarea>` : ''}
      ${!showLink || (!showCopy && k.shape === 'playbook') ? `<div class="ed-row" style="gap:12px">
        ${showLink ? '' : `<button class="ed-link" type="button" data-link="${path}">+ link</button>`}
        ${showCopy || k.shape !== 'playbook' ? '' : `<button class="ed-link" type="button" data-copyopen="${path}">+ text to copy</button>`}</div>` : ''}
    </div>${k.shape === 'picks' && path.startsWith('sections.') ? `<button class="ed-star${it.star ? ' on' : ''}" type="button" data-star="${path}" aria-label="${it.star ? 'In your top 3' : 'Add to your top 3'}" aria-pressed="${!!it.star}">${it.star ? '★' : '☆'}</button>` : ''}<button class="ed-x" type="button" data-rm="${path}" aria-label="Remove">×</button></div>`;
}
const starCount = () => k.sections.reduce((n, sec) => n + sec.items.filter(i => i.star).length, 0);

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
      <input data-p="tagline" value="${esc(k.tagline)}" placeholder="${k.copiedFrom ? 'What makes your version yours?' : 'In one line: what should someone get out of it?'}" maxlength="160" aria-label="One line">
      <input data-p="idea" value="${esc(k.idea || '')}" placeholder="The big idea, in one line (shown large at the top)" maxlength="140" aria-label="Big idea">
      ${(k.sections || []).map((s, i) => listBox(s.title, s.items, `sections.${i}.items`, '', `sections.${i}.title`)).join('')}
      ${showSources ? listBox('Sources I follow', k.sources, 'sources', 'Paste links to YouTube channels, websites or podcasts (Apple or Spotify) and you get a short AI update from them every few hours. Say why each one is good. X, Instagram and Reddit links can go here too, but they can\'t feed updates.') : ''}
      <div class="ed-row">
        <button class="kc-btn kc-btn-quiet" type="button" data-addsec>+ Section</button>
        ${showSources ? '' : '<button class="kc-btn kc-btn-quiet" type="button" data-addsrc>+ Sources for updates</button>'}
      </div>
      <section class="ed-sec ed-ai" id="ai-box">
        <span class="label">Ask AI to watch for you <small style="text-transform:none;letter-spacing:0;font-weight:500">optional</small></span>
        <textarea data-p="watch" placeholder="${esc(watchFor(k).ph)}" maxlength="300">${esc(k.watch || '')}</textarea>
        <div class="ed-chips">${watchFor(k).ex.map(x => `<button type="button" class="ed-chip" data-watchchip="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <small class="kc-fine">Your own instruction, just for your keycard. AI checks every few hours and links everything it finds. Leave it empty and nothing changes.</small>
      </section>
      <details class="ed-more"${moreOpen ? ' open' : ''}>
        <summary>More options</summary>
        <div class="ed-field"><span>Subject</span>
          <div class="ed-chips">${SUBJECTS.map(x => `<button type="button" class="ed-chip${catOf(k.subject) === x && k.subject ? ' on' : ''}" data-subject="${x}">${x}</button>`).join('')}</div></div>
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
    </form>`;  fitAllWhy();
}

function getPath(path) { return path.split('.').reduce((o, p) => o[p], k); }
function setPath(path, v) { const ps = path.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p], k)[last] = v; }

box.addEventListener('input', e => {
  if (e.target.matches && e.target.matches('textarea.why')) fitWhy(e.target);
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
  const b = e.target.closest('[data-ivstart],[data-frompaste],[data-blank],[data-idea],[data-findideas],[data-intoideas],[data-ask],[data-surprise]'); if (!b) return;
  if (b.matches('[data-idea]') && b.dataset.idea.includes('…')) return;   // just fills the box; no need to sign in yet
  e.preventDefault(); e.stopImmediatePropagation();
  const act = b.matches('[data-surprise]') ? 'surprise' : b.matches('[data-ivstart],[data-idea]') ? 'ivstart' : b.matches('[data-findideas]') ? 'find' : b.matches('[data-intoideas]') ? 'into'
    : b.matches('[data-ask]') ? 'ask' : b.matches('[data-frompaste]') ? 'frompaste' : 'blank';
  const topic = b.matches('[data-idea]') ? b.dataset.idea : ((document.getElementById('iv-topic') || {}).value || '').trim();
  if (act === 'ivstart' && !topic) { toast('What would you like to share?'); return; }
  const answers = [0, 1, 2].map(i => (document.getElementById('fq' + i) || {}).value || '');
  if (act === 'find' && !answers.some(a => a.trim())) { toast('Answer at least one, even briefly'); return; }
  if (act === 'into' || act === 'ask') { try { sessionStorage.setItem(MAKE_PENDING, JSON.stringify({ act, topic: into.topic })); } catch (x) {}
    signInSheet(act === 'ask' ? 'Sign in to ask' : 'Sign in to see ideas', act === 'ask' ? "It's free. We'll email you when someone makes one." : "It's free, and you carry on right where you were."); return; }
  try { sessionStorage.setItem(MAKE_PENDING, JSON.stringify({ act, topic, answers, paste: (document.getElementById('paste0') || {}).value || '' })); } catch (x) {}
  signInSheet('Sign in to start', "It's free. Your keycard is saved to your account, and you carry on right where you were.");
}, true);

box.addEventListener('click', async e => {
  if (e.target.closest('[data-showpaste]')) { e.preventDefault(); const pb = document.getElementById('paste-box'); pb.hidden = false; pb.scrollIntoView({ behavior: 'smooth', block: 'center' }); pb.querySelector('textarea').focus(); return; }
  if (e.target.closest('[data-blank]')) { e.preventDefault(); start('picks'); return; }
  if (e.target.closest('[data-ivquit]')) { e.preventDefault(); iv = null; pick = null; try { sessionStorage.removeItem(IV); } catch (x) {} starters(); return; }
  if (e.target.closest('[data-rsstop]')) { e.preventDefault(); finishReasons(); return; }
  const rvt = e.target.closest('[data-rvtitle],[data-rvvis],[data-rvsave],[data-rvtweak],[data-rvagain],[data-rvmore],[data-rvquit],[data-rvrate]');
  if (rvt && rv) { e.preventDefault(); return revealClick(rvt); }
  if (e.target.closest('[data-back]')) { e.preventDefault(); pick = null; into = null; starters(); scrollTo(0, 0); return; }
  const t = e.target.closest('button'); if (!t) return;
  const d = t.dataset;
  if (d.starter) { start(d.starter); return; }
  if (d.surprise !== undefined) { startSurprise(); return; }
  if (d.ivchip) { const t = document.getElementById('iv-topic'); t.value = d.ivchip.replace('…', ' '); t.focus(); return; }
  if (d.rsnext !== undefined || d.rsskip !== undefined) {
    const v = document.getElementById('rs-why').value.trim();
    if (d.rsnext !== undefined && v) { setPath(rs.queue[rs.i] + '.why', v); rs.added++; dirty = true; }
    rs.i++;
    if (rs.added && rs.added % 5 === 0 && d.rsnext !== undefined && v) saveQuietly();
    renderReasons(); return;
  }
  if (d.watchchip) { const t = box.querySelector('[data-p="watch"]'); t.value = (t.value.trim() ? t.value.trim() + ' ' : '') + d.watchchip; setPath('watch', t.value); dirty = true; t.focus(); return; }
  if (d.star !== undefined) {
    const it = getPath(d.star);
    if (!it.star && starCount() >= 3) { toast('Your top 3 is full. Untick one first.'); return; }
    if (it.star) delete it.star; else it.star = true;
    dirty = true; render();
    const n = starCount(); toast(n === 3 ? 'Top 3 set. They show first as “Start here”.' : `${n} of 3 starred`); return;
  }
  if (d.into !== undefined) { startInto(document.getElementById('into').value); return; }
  if (d.intoideas !== undefined) { if (owner) loadIntoIdeas(into.topic); return; }
  if (d.ask !== undefined) { await saveAsk(into.topic).catch(() => {}); into.asked = true; renderInto(); toast("Asked. We'll let you know."); return; }
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
  if (d.addsrc !== undefined) { k.kind = 'sources'; k.sources.push(blankItem()); dirty = true; render(); focusLast('sources'); return; }
  if (d.tog) { shut.has(d.tog) ? shut.delete(d.tog) : shut.add(d.tog); render(); return; }
  if (d.subject) { k.subject = catOf(k.subject) === d.subject && k.subject ? '' : d.subject; dirty = true; render(); return; }
  if (d.add) { const list = getPath(d.add), last = list[list.length - 1]; list.push({ ...blankItem(), ...(last && typeof last.copy === 'string' ? { copy: '' } : {}) }); dirty = true; render(); focusLast(d.add); return; }
  if (d.rm) { const ps = d.rm.split('.'); const i = +ps.pop(); getPath(ps.join('.')).splice(i, 1); dirty = true; render(); return; }
  if (d.rmsec) { if (!confirm('Remove this section and everything in it?')) return; shut.clear(); k.sections.splice(+d.rmsec, 1); dirty = true; render(); return; }
  if (d.addsec !== undefined) { k.sections.push({ title: '', items: [blankItem()] }); dirty = true; render(); box.querySelector(`[data-p="sections.${k.sections.length - 1}.title"]`).focus(); return; }
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
function payload() {
  const keep = it => (it.name || '').trim() || (it.url || '').trim() || (it.copy || '').trim();
  const tidy = it => ({ name: (it.name || '').trim(), why: (it.why || '').trim(), url: (it.url || '').trim(), ...(it.type ? { type: it.type } : {}), ...(it.copy ? { copy: it.copy.trim() } : {}), ...(it.star ? { star: true } : {}), ...(it.from ? { from: true } : {}) });
  const data = {
    title: k.title.trim(), tagline: k.tagline.trim(), idea: (k.idea || '').trim(), subject: k.subject || '',
    sections: k.sections.map(s => ({ title: s.title.trim() || 'Picks', items: s.items.filter(keep).map(tidy), ...(s.principles || s.kind === 'principles' ? { kind: 'principles' } : {}) })).filter(s => s.items.length),
    sources: k.sources.filter(keep).map(tidy), instruction: k.instruction.trim(),
    shape: k.shape || '', tested: (k.tested || '').trim(), watch: (k.watch || '').trim(),
    visibility: k.visibility, copiedFrom: k.copiedFrom || null, edited: !!(k.edited || (k.copiedFrom && dirty) || !k.copiedFrom),
  };
  if (!docId && made) data.made = { how: made.how, secs: Math.round((Date.now() - made.t0) / 1000), ...(made.takes > 1 ? { takes: made.takes } : {}), ...(made.tweaked ? { tweaked: true } : {}), ...(made.reads ? { reads: made.reads } : {}), ...(made.mode ? { mode: made.mode } : {}) };
  return data;
}
async function save(btn) {
  if (!k.title.trim()) { toast('Give it a name first'); box.querySelector('[data-p="title"]').focus(); return; }
  const data = payload();
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const id = await saveKeycard(docId, data);
    dirty = false;
    try { sessionStorage.removeItem(IV); } catch (e) {}
    location.href = keycardUrl('user:' + id);
  } catch (e) { console.error(e); toast("Couldn't save. Check your connection and try again."); btn.disabled = false; btn.textContent = 'Save'; }
}

// ---------- Add your reasons: one pick at a time ----------
// Reasons are what make a list worth borrowing ("best tonkotsu in town" beats "Ramen restaurant"). AI never writes
// them: the owner does, a line each, skipping any they like. Saved as they go.
let rs = null;   // { queue: [paths], i, added }
const missingWhy = () => k.sections.flatMap((sec, si) => sec.items.map((it, ii) => ((it.name || '').trim() && !(it.why || '').trim()) ? `sections.${si}.items.${ii}` : null)).filter(Boolean);
function startReasons() {
  rs = { queue: missingWhy(), i: 0, added: 0 };
  if (!rs.queue.length) { rs = null; toast('Every pick already has a reason'); return render(); }
  renderReasons();
}
function renderReasons() {
  if (rs.i >= rs.queue.length) return finishReasons();
  const path = rs.queue[rs.i], it = getPath(path), sec = k.sections[+path.split('.')[1]];
  box.innerHTML = `<a href="#" class="mk-back" data-rsstop>‹ Done for now</a>
    <section class="kc-hero"><h1 class="display kc-title">WHY THIS ONE?</h1>
      <p class="kc-body">A few words on why each pick is on your list. It's what makes it worth borrowing.</p></section>
    <section class="ed-sec ed-start">
      <span class="label">${esc(sec.title || 'Picks')} · ${rs.i + 1} of ${rs.queue.length}</span>
      <p class="iv-q" style="margin:4px 0 2px">${esc(it.name)}</p>
      ${it.type ? `<small class="kc-fine">${esc(it.type)}</small>` : ''}
      <input id="rs-why" placeholder="e.g. Best tonkotsu in town. Go at lunch." maxlength="160" autocomplete="off">
      <div class="ed-row">
        <button class="kc-btn kc-btn-main" type="button" data-rsnext>Next</button>
        <button class="kc-btn" type="button" data-rsskip>Skip</button>
      </div>
    </section>
    <p class="kc-fine" style="text-align:center">${rs.added ? `${rs.added} added so far. ` : ''}Saved as you go.</p>`;
  const inp = document.getElementById('rs-why'); inp.focus();
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); box.querySelector('[data-rsnext]').click(); } };
}
async function saveQuietly() {
  if (!docId) return;
  try { await saveKeycard(docId, payload()); dirty = false; } catch (e) { console.warn('autosave failed', e); }
}
async function finishReasons() {
  const n = rs ? rs.added : 0; rs = null;
  await saveQuietly();
  location.href = keycardUrl('user:' + docId);
  toast(n ? `Added ${n} reason${n === 1 ? '' : 's'}` : 'Saved');
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

// Two questions are "the same" if they're nearly word for word, so the interview never asks one twice.
const qKey = q => String(q || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
async function ivAsk() {
  const last = iv.turns[iv.turns.length - 1];
  // They've just answered "anything else?" with enough said already: that's the end, go to the reveal.
  if (last && iv.turns.length >= 3 && /\banything else\b/i.test(last.q)) return ivDraft();
  if (iv.kind === 'picks' && iv.turns.length === 3 && !iv.turns.some(t => /\b(three|top 3|top three)\b/i.test(t.q))) {
    iv.q = TOP3_Q; ivSave(); return renderIv();
  }
  renderIv('thinking');
  try {
    const clean = d => String((d && d.question) || '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
    const mode = iv.mode ? { mode: iv.mode } : {};
    let d = await askAI('ask', iv.topic, iv.turns, mode);
    let q = clean(d);
    if (!d.done && !q && iv.turns.length < 4) { d = await askAI('ask', iv.topic, iv.turns, mode); q = clean(d); }   // an empty reply: ask once more
    // The AI says it's done in different ways ("DONE", "Done.", quotes, nothing at all once there's enough): all mean finish.
    if (d.done || /^\W*done\W*$/i.test(q) || (!q && iv.turns.length >= 4)) return ivDraft();
    const asked = new Set(iv.turns.map(t => qKey(t.q)));
    if (q && asked.has(qKey(q))) return iv.turns.length >= 3 ? ivDraft() : (iv.q = 'Why do you do it this way?', ivSave(), renderIv());
    // Never leave a blank question: if the AI sends nothing back early on, ask a sensible one we haven't asked yet.
    // Stand-ins name their topic, so they never read as random.
    const raw = iv.topic.trim().replace(/[.?!]+$/, '');
    const t = /^how i\s+/i.test(raw) ? 'how you ' + raw.replace(/^how i\s+/i, '') : /^my\s+/i.test(raw) ? 'your ' + raw.replace(/^my\s+/i, '') : raw;
    const fallback = iv.mode === 'open' ? [...FIND_QS, 'Tell me more about that. Why do you do it that way?', 'Anything else someone should know?']
      : iv.kind === 'picks'
      ? [`Which ones would you send a friend to first, and why?`, `Which one is overrated, or one to skip?`, 'Anything else someone should know?']
      : [`Take me through ${t}, from start to finish. What do you actually do?`, "What's the one step you'd never skip, and why?",
         'What did you get wrong when you started?', 'Anything else someone should know?'];
    const next = q || fallback.find(f => !asked.has(qKey(f)));
    if (!next) return ivDraft();
    iv.q = next;
    ivSave(); renderIv();
  } catch (e) { renderIv(null, e.message); }
}

// Star the items they named when asked for their top 3 (matched by name in their own answer).
function starTop3(nk, turns) {
  const t = (turns || []).find(x => /\b(three|top 3|top three)\b/i.test(x.q));
  if (!t || nk.shape !== 'picks') return;
  const ans = ' ' + t.a.toLowerCase().replace(/[^a-z0-9 ]/g, ' ') + ' ';
  let n = 0;
  nk.sections.forEach(sec => sec.items.forEach(it => {
    const name = (it.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (n < 3 && name.length > 2 && ans.includes(' ' + name + ' ')) { it.star = true; n++; }
  }));
}

// The draft, as a keycard the editor understands.
function kFromDraft(kd) {
  const shape = ['picks', 'sources', 'playbook'].includes(kd.shape) ? kd.shape : 'playbook';
  const item = i => ({ name: i.name || '', why: i.why || '', url: i.url || '', ...(i.copy ? { copy: i.copy } : {}), ...(i.star ? { star: true } : {}) });
  const nk = { title: kd.title || (rv || iv).topic, tagline: kd.tagline || '', subject: SUBJECTS.includes(kd.subject) ? kd.subject : '',
               visibility: 'public', copiedFrom: null, kind: shape, shape, tested: '',
               sections: (kd.sections || []).map(x => ({ title: x.title || '', items: (x.items || []).map(item) })).filter(x => x.items.length),
               sources: (kd.sources || []).map(item), instruction: kd.instruction || STARTERS[shape].k.instruction };
  if (!nk.sections.length && !nk.sources.length) nk.sections = [{ title: 'My picks', items: [blankItem()] }];
  nk.idea = String(kd.idea || '').trim().replace(/^["“”]+|["“”]+$/g, '');
  const pr = (Array.isArray(kd.principles) ? kd.principles : []).filter(x => x && x.name).slice(0, 4).map(item);
  if (pr.length) nk.sections.unshift({ title: shape === 'picks' ? 'How I choose' : 'How I think about it', items: pr, principles: true });
  return nk;
}

async function ivDraft(again) {
  const base = again ? rv : iv;
  const take = again ? rv.take + 1 : 1;
  if (again) {
    const b = box.querySelector('[data-rvagain]'); if (b) { b.disabled = true; b.textContent = 'Trying another take…'; }
  } else renderIv('drafting');
  try {
    const avoid = again ? `last time the title was "${rv.k.title}" and the sections were: ${rv.k.sections.map(x => x.title).join(', ')}` : '';
    const kd = (await askAI('draft', base.topic, base.turns, { ...(take > 1 ? { take, avoid } : {}), ...(base.mode ? { mode: base.mode } : {}) })).keycard || {};
    const titles = [...new Set([kd.title, ...(Array.isArray(kd.titles) ? kd.titles : [])].map(t => String(t || '').trim()).filter(Boolean))].slice(0, 3);
    const more = (Array.isArray(kd.more) ? kd.more : []).filter(x => x && x.title && x.start).slice(0, 3);
    const fresh = (Array.isArray(kd.reads) ? kd.reads : []).filter(r => r && r.text).slice(0, 3)
      .map(r => ({ kind: ['pattern', 'guess', 'tension'].includes(r.kind) ? r.kind : 'pattern', text: String(r.text).trim(), evidence: cleanEv(r.evidence), rule: String(r.rule || '').trim(), r: '' }));
    const kept = again && rv.reads.some(r => r.r);   // they've already rated these: keep them, and what they confirmed
    rv = { topic: base.topic, turns: base.turns, t0: base.t0 || Date.now(), take, titles, mode: base.mode || '', more, k: null,
           noticed: String(kd.noticed || '').trim(), anticipation: kept ? rv.anticipation : String(kd.anticipation || '').trim(),
           reads: kept ? rv.reads : fresh };
    rv.k = kFromDraft(kd);
    rv.reads.filter(r => r.r === 'spot' && r.kind !== 'tension').forEach(r => addPrinciple(r));
    starTop3(rv.k, base.turns);
    k = rv.k; made = { how: 'interview', t0: rv.t0, takes: take, ...(rv.mode ? { mode: rv.mode } : {}) };
    if (rv.reads.some(r => r.r)) made.reads = { shown: rv.reads.length, spot: rv.reads.filter(x => x.r === 'spot').length, notquite: rv.reads.filter(x => x.r === 'notquite').length, wrong: rv.reads.filter(x => x.r === 'wrong').length };
    iv = null;
    try { sessionStorage.setItem(IV, JSON.stringify({ reveal: rv })); } catch (e) {}
    renderReveal();
    window.scrollTo(0, 0);
  } catch (e) {
    if (again) { toast(e.message || "Couldn't make another take. Try again."); renderReveal(); }
    else renderIv(null, e.message);
  }
}

// ---------- the reveal: "Your keycard is ready" ----------
// The payoff of the interview: the keycard exactly as a friend will see it, what the AI noticed, a choice of titles,
// and more keycards hiding in what they said. Editing is optional ("Tweak it"), not the first thing they see.
let rv = null;   // { topic, turns, t0, take, titles, noticed, more, k }
const TYPE_WORD = { picks: 'picks', sources: 'sources', playbook: 'steps' };
function renderReveal() {
  k = rv.k;
  const label = SHAPE_LABEL[k.shape] || 'Keycard';
  const n = k.sections.reduce((a, x) => a + x.items.length, 0) + k.sources.length;
  const first = (myName() || '').split(' ')[0] || 'you';
  box.innerHTML = `<section class="rv">
    <div class="rv-ready"><span class="rv-spark">✦</span> Your keycard is ready${rv.take > 1 ? ` <small>· take ${rv.take}</small>` : ''}</div>
    ${rv.anticipation ? `<div class="rv-antic"><span class="label">Here's what I think you're making</span><p>${esc(rv.anticipation)}</p></div>` : ''}
    ${(rv.reads || []).length ? `<div class="rv-reads"><span class="label">What I noticed about how you choose</span>
      ${rv.reads.map((r, i) => `<div class="rv-read${r.r === 'wrong' ? ' off' : ''}">
        <span class="rv-kind">${READ_LABEL[r.kind]}</span><p>${esc(r.text)}</p>
        ${r.evidence ? `<small class="rv-ev">From what you said: “${esc(cleanEv(r.evidence))}”</small>` : ''}
        ${r.r ? `<small class="rv-done">${READ_DONE[r.r](r)}</small>`
          : `<div class="rv-rate">${[['spot', 'Spot on'], ['notquite', 'Not quite'], ['wrong', 'Wrong']].map(([v, l]) => `<button type="button" data-rvrate="${i}:${v}">${l}</button>`).join('')}</div>`}
      </div>`).join('')}
      <p class="kc-fine">Everything on the keycard is what you said. These are my reads on it: tell me if I've got you right.</p></div>`
    : rv.noticed ? `<div class="rv-noticed"><span class="label">What I noticed</span><p>${esc(rv.noticed)}</p></div>` : ''}
    ${rv.titles.length > 1 ? `<div class="rv-titles"><span class="label">Pick a title</span>
      ${rv.titles.map((t, i) => `<button type="button" class="rv-t${t === k.title ? ' on' : ''}" data-rvtitle="${i}">${esc(t)}</button>`).join('')}</div>` : ''}
    <article class="rv-card">
      <div class="eyebrow">${esc(label)}${k.subject ? ' · ' + esc(k.subject) : ''}</div>
      <h1 class="display kc-title">${esc(k.title)}</h1>
      <div class="rv-by">by ${esc(first)}</div>
      ${k.idea ? `<p class="kc-idea">${esc(k.idea)}</p>` : k.tagline ? `<p class="kc-body">${esc(k.tagline)}</p>` : ''}
      ${(() => { const top = k.sections.flatMap(x => x.items.filter(i => i.star)).slice(0, 3);
        return top.length ? `<div class="rv-sec kc-start-in"><div class="label">Start here: ${esc(first)}'s top ${top.length}</div>${top.map(it => itemRow(it)).join('')}</div>` : ''; })()}
      ${k.sections.filter(isRules).map(sec => rulesCard(sec)).join('')}
      ${k.sections.filter(sec => !isRules(sec)).map((sec, i) => fold(sec.title, sec.items.map(it => itemRow(it)), i === 0 && sec.items.length <= 4)).join('')}
      ${k.sources.length ? `<div class="rv-sec"><div class="label">Sources I follow</div>${k.sources.map(it => itemRow(it)).join('')}</div>` : ''}
    </article>
    <div class="rv-share"><span class="label">When you share it</span>
      <div class="rv-wa"><b>${esc(k.title)}</b><span>${esc(label)} by ${esc(first)} · ${n} ${TYPE_WORD[k.shape] || 'things'} · Keycard</span></div></div>
    <div class="rv-actions">
      <div class="rv-vis" role="radiogroup" aria-label="Who can see it"><span class="label">Who can see it</span>
        ${[['public', 'Everyone', 'on Discover'], ['unlisted', 'Link only', 'people you send it to'], ['private', 'Just me', '']].map(([v, l, h]) =>
          `<button type="button" role="radio" aria-checked="${k.visibility === v}" class="rv-v${k.visibility === v ? ' on' : ''}" data-rvvis="${v}"><b>${l}</b>${h ? `<small>${h}</small>` : ''}</button>`).join('')}</div>
      <button class="kc-btn kc-btn-main" type="button" data-rvsave>Looks good: save it</button>
      <div class="rv-two"><button class="kc-btn" type="button" data-rvtweak>Tweak it</button>
      <button class="kc-btn" type="button" data-rvagain>Try another take</button></div>
      <p class="kc-fine">Everything on it came from your answers. Another take changes the shape and titles, never your picks or reasons.</p>
    </div>
    ${rv.more.length ? `<section class="rv-more"><span class="label">I spotted more keycards in what you said</span>
      ${rv.more.map((m, i) => `<button type="button" class="mk-idea mk-idea-typed" data-rvmore="${i}"><span class="mk-type">${esc(SHAPE_LABEL[m.type] || 'Keycard')}</span><b>${esc(m.title)}</b></button>`).join('')}
      <p class="kc-fine">Tapping one saves this keycard first, then starts the next interview.</p></section>` : ''}
    <p class="kc-fine" style="text-align:center"><a href="#" data-rvquit style="color:var(--faint)">Start over</a></p>
  </section>`;
}
// Evidence as one clean phrase: no stray quote marks, several quotes joined with " · ".
const cleanEv = e => String(e || '').replace(/["“”]/g, '').replace(/\s*;\s*/g, ' · ').replace(/\s+/g, ' ').trim();
const READ_LABEL = { pattern: 'A pattern I noticed', guess: 'My guess: is this right?', tension: 'Something that pulls two ways' };
const READ_DONE = { spot: r => r.kind === 'tension' ? 'Glad that landed.' : 'Added to your keycard, under how you choose.',
                    notquite: () => "Thanks. Fix it with Tweak it if you'd like it on your keycard.", wrong: () => "Got it. I've left that out." };
// A read they confirm becomes one of their principles (the first section). Tensions don't: they're questions, not rules.
function addPrinciple(r) {
  let sec = rv.k.sections.find(x => x.principles);
  if (!sec) { sec = { title: rv.k.shape === 'picks' ? 'How I choose' : 'How I think about it', items: [], principles: true }; rv.k.sections.unshift(sec); }
  const name = r.rule ? r.rule.replace(/[.]$/, '') : r.text.replace(/^(is it that|maybe|i think)\s+/i, '').replace(/\?$/, '').replace(/^you\s+/i, 'I ').replace(/^./, c => c.toUpperCase());
  if (sec.items.length < 5 && !sec.items.some(i => i.name === name)) sec.items.push({ name, why: r.evidence || '', url: '' });
}
async function revealClick(t) {
  if (t.dataset.rvrate !== undefined) {
    const [i, v] = t.dataset.rvrate.split(':'); const r = rv.reads[+i]; if (!r || r.r) return;
    r.r = v;
    if (v === 'spot' && r.kind !== 'tension') addPrinciple(r);
    made.reads = { shown: rv.reads.length, spot: rv.reads.filter(x => x.r === 'spot').length, notquite: rv.reads.filter(x => x.r === 'notquite').length, wrong: rv.reads.filter(x => x.r === 'wrong').length };
    try { sessionStorage.setItem(IV, JSON.stringify({ reveal: rv })); } catch (e) {}
    return renderReveal();
  }
  if (t.dataset.rvtitle !== undefined) { rv.k.title = rv.titles[+t.dataset.rvtitle]; return renderReveal(); }
  if (t.dataset.rvvis !== undefined) { rv.k.visibility = t.dataset.rvvis; try { sessionStorage.setItem(IV, JSON.stringify({ reveal: rv })); } catch (e) {} return renderReveal(); }
  if (t.dataset.rvsave !== undefined) return save(t);
  if (t.dataset.rvtweak !== undefined) {
    made.tweaked = true; dirty = true;
    try { sessionStorage.removeItem(IV); } catch (e) {}
    rv = null; render(); window.scrollTo(0, 0);
    return toast('Change anything, then Save.');
  }
  if (t.dataset.rvagain !== undefined) return ivDraft(true);
  if (t.dataset.rvmore !== undefined) {
    const next = rv.more[+t.dataset.rvmore];
    t.disabled = true;
    try {
      await saveKeycard(null, payload());
      toast(`Saved “${k.title}”. On to the next one.`);
    } catch (e) { t.disabled = false; return toast("Couldn't save this one. Check your connection."); }
    try { sessionStorage.removeItem(IV); } catch (e) {}
    rv = null; k = null; dirty = false; made = null;
    window.scrollTo(0, 0);
    return startInterview(next.start, next.type === 'picks' ? 'picks' : '');
  }
  if (t.dataset.rvquit !== undefined) {
    try { sessionStorage.removeItem(IV); } catch (e) {}
    rv = null; k = null; dirty = false; return starters();
  }
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
// Your own AI instruction on a keycard (including a copy of someone else's): what it should watch for you.
const WATCH = {
  picks: { ph: 'e.g. Which of these are in Downtown? Tell me about new places like these.',
           ex: ['Which of these are near …?', 'New openings like these', 'Tell me if any of these close'] },
  sources: { ph: "e.g. Only the big stuff, and anything about Nvidia's next chips.", ex: ['Only the big stuff', 'Anything about …', 'Where they disagree'] },
  playbook: { ph: 'e.g. Tell me when a better way to do this comes out.', ex: ['New tools that do this better', 'Updates from the people I learned from'] },
};
const watchFor = k => WATCH[k.shape] || (k.copiedFrom && k.copiedFrom.live && !/^site:guide-/.test(k.copiedFrom.live) ? WATCH.sources : WATCH.picks);
const FIND_QS = ['What do friends or colleagues usually come to you for?', "What's something you've spent ages learning or figuring out?", 'What do you love recommending or explaining?'];
let pick = null, found = null;   // which choice is open; ideas the AI suggested
let into = null;                 // "What are you into?": { topic, matches, ideas, asked, state }
const TYPE_LABEL = { playbook: 'Playbook', picks: 'Picks', sources: 'Sources' };

async function startInto(topic) {
  topic = String(topic || '').trim();
  if (!topic) { toast("What are you into? A few words is fine"); return; }
  into = { topic, matches: null, ideas: null, asked: false, state: 'loading' };
  pick = 'into'; renderInto(); scrollTo(0, 0);
  searchKeycards(topic).then(m => { if (into && into.topic === topic) { into.matches = m; renderInto(); } });
  if (owner) loadIntoIdeas(topic);
}
async function loadIntoIdeas(topic) {
  into.state = 'loading'; renderInto();
  try {
    let d;
    try { d = await askAI('into', topic, []); }
    catch (e) {   // the worker hasn't been updated yet: use "Help me find an idea" with this as the answer
      if (!/unknown action/i.test(e.message)) throw e;
      d = await askAI('ideas', 'Help me find an idea', [{ q: 'What are you into, or what have you figured out?', a: topic }]);
    }
    if (into && into.topic === topic) { into.ideas = d.ideas || []; into.state = ''; renderInto(); }
  } catch (e) { if (into) { into.state = 'error:' + e.message; renderInto(); } }
}
function renderInto() {
  const t = into.topic;
  const matches = into.matches === null ? '<p class="kc-fine">Looking…</p>'
    : into.matches.length ? into.matches.map(k => `<a class="kc-row" href="${esc(k.url)}"><span class="kc-row-t">${esc(k.title)}</span><span class="kc-row-m">${esc([k.type, k.subject, k.by ? 'by ' + k.by : ''].filter(Boolean).join(' · '))}${k.live ? ' <span class="live-badge">● Live updates</span>' : ''}</span></a>`).join('')
    : `<p class="kc-body" style="font-size:15px">No one's made a keycard on “${esc(t)}” yet. You could be the first.</p>`;
  const ideas = !owner ? `<p class="kc-body" style="font-size:15px">Get ideas for keycards you could make from your own experience.</p>
        <button class="kc-btn kc-btn-main" type="button" data-intoideas>Show me ideas</button>`
    : into.state === 'loading' ? '<div class="iv-dots"><i></i><i></i><i></i></div>'
    : into.state.startsWith('error:') ? `<div class="kc-banner">${esc(into.state.slice(6))} <button class="kc-btn kc-btn-quiet" type="button" data-intoideas>Try again</button></div>`
    : `<div class="mk-ideas">${(into.ideas || []).map(i => `<button type="button" class="mk-idea mk-idea-typed" data-idea="${esc(i.start || i.title)}">
          ${TYPE_LABEL[i.type] ? `<span class="mk-type">${TYPE_LABEL[i.type]}</span>` : ''}<b>${esc(i.title)}</b>${i.blurb ? `<span>${esc(i.blurb)}</span>` : ''}</button>`).join('')}
        <button type="button" class="mk-idea mk-idea-typed" data-idea="${esc(t)}"><b>Or just: ${esc(t)}</b><span>Start the interview with your own words</span></button></div>`;
  box.innerHTML = `<a href="#" class="mk-back" data-back>‹ Back</a>
    <section class="ed-sec ed-start mk-into">
      <span class="label">What are you into?</span>
      <div class="mk-into-row"><input id="into" value="${esc(t)}" maxlength="80" enterkeyhint="go">
      <button class="kc-btn kc-btn-main" type="button" data-into>Go</button></div>
    </section>
    <span class="label" style="display:block;margin:18px 4px 6px">Already on Keycard</span>
    <section class="card">${matches}</section>
    <span class="label" style="display:block;margin:18px 4px 6px">You could make</span>
    ${ideas}
    <section class="ed-sec ed-start" style="margin-top:18px">
      <span class="label">Not your thing to write?</span>
      ${into.asked ? `<p class="kc-body" style="font-size:15px">Asked. We'll tell you in your Sunday email when someone makes one.</p>`
        : `<p class="kc-body" style="font-size:15px">Ask for a keycard on “${esc(t)}”, and we'll tell you when someone makes one.</p>
           <button class="kc-btn" type="button" data-ask>Ask for one</button>`}
    </section>`;
  const inp = document.getElementById('into');
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); startInto(inp.value); } };
}


function starters() {
  if (pick === 'find') return renderFind();
  if (pick === 'into') return renderInto();
  const c = CHOICES.find(x => x.key === pick);
  if (c) return renderChoice(c);
  const paste = `<section class="ed-sec ed-start" id="paste-box"${aiUrl ? ' hidden' : ''}>
      <span class="label">Paste what you already have</span>
      <textarea id="paste0" placeholder="A list, a note, your Maps list copied out… One thing per line. Headings become sections.&#10;&#10;Japanese:&#10;Kinoya – best ramen in town&#10;Kokoro – hand rolls"></textarea>
      <button class="kc-btn kc-btn-main" type="button" data-frompaste>Turn it into a keycard</button>
    </section>`;
  box.innerHTML = `<section class="kc-hero">
      <h1 class="display kc-title">EVERYONE KNOWS SOMETHING.</h1>
      <p class="kc-body">Turn something you've figured out into a keycard someone else can borrow. Answer a few questions and AI writes it up in your words; you check everything before it's saved. About 3 minutes.</p></section>
    ${aiUrl ? `<button type="button" class="mk-surprise" data-surprise><b>✦ Surprise me</b>
      <span>No topic needed. Just chat, and I'll find what you know that's worth sharing.</span></button>
    <span class="label" style="display:block;margin:14px 4px 8px">Or, if you know what you want to make</span>
    <section class="ed-sec ed-start mk-into">
      <span class="label">What are you into?</span>
      <div class="mk-into-row"><input id="into" placeholder="e.g. 7-a-side tactics, Bali" maxlength="80" enterkeyhint="go">
      <button class="kc-btn kc-btn-main" type="button" data-into>Go</button></div>
      <small class="kc-fine">See what's already here, and keycards you could make from your own experience.</small>
    </section>
    <span class="label" style="display:block;margin:14px 4px 8px">Or pick what you'd like to share</span>
    <div class="mk-choices">
      ${CHOICES.map(x => `<button type="button" class="mk-choice" data-choice="${x.key}"><b>${esc(x.label)}</b><span>${esc(x.sub)}</span></button>`).join('')}
      <button type="button" class="mk-choice mk-find" data-choice="find"><b>Help me find an idea</b><span>Three quick questions, then a few ideas to pick from</span></button>
    </div>` : ''}
    ${paste}
    <p class="kc-fine" style="text-align:center">${aiUrl ? '<a href="#" data-showpaste>Already have a list? Paste it</a> · ' : ''}<a href="#" data-blank>Start blank</a> · <a href="${ROOT}">Copy one from Discover</a></p>
    ${owner ? '' : '<p class="kc-fine" style="text-align:center">Free. You\'ll sign in with Google when you start, so it\'s saved.</p>'}`;
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'into' && pick !== 'into') { e.preventDefault(); startInto(e.target.value); } });

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

// Lists of favourites get one fixed question: the top 3 become "Start here" on the keycard.
const TOP3_Q = 'If someone only tried three, which would they be?';
const guessKind = topic => (pick === 'places' || /\b(favou?rite|best|top \d|spots?|restaurants?|places|caf[eé]s?|bars?|where (i|to)|picks|eats)\b/i.test(topic)) ? 'picks' : '';
function startInterview(topic, kind, mode, firstQ) {
  iv = { topic, turns: [], q: '', t0: Date.now(), kind: mode === 'open' ? '' : (kind || guessKind(topic)), ...(mode ? { mode } : {}) }; noteStart(mode === 'open' ? 'surprise' : 'interview');
  if (firstQ) { iv.q = firstQ; ivSave(); return renderIv(); }
  ivAsk();
}
// "Surprise me": no topic. The interview finds what they know, and the keycard comes out of the conversation.
// The first question is picked here (no AI call needed), different each time, so Surprise me never feels like a form.
const OPENERS = [
  'What do people usually come to you for?',
  "What's something you do differently from most people you know?",
  "What's a decision you made that you're quietly proud of?",
  "What's something you've spent years getting good at, even if it's not your job?",
  'What do you find yourself explaining to friends again and again?',
  "What's an opinion you hold that most people around you don't?",
  "What's a small habit that made a big difference to your life?",
  "What's something you know a lot about that might surprise people?",
  'When friends visit your city, where do you take them, and why there?',
  "What's the best advice you've ever ignored, or followed?",
  "What's something you'd happily spend an hour telling someone about?",
  "What's a mistake you made once and never made again?",
  'Who or what do you trust when you need to learn something new?',
  "What's something most people overpay for, or get wrong, that you don't?",
  "What's your go-to recommendation when someone asks you for one?",
  "What's a rule you live by that you've never written down?",
  'What does a really good weekend look like for you?',
  "What's something you changed your mind about in the last few years?",
  "What's a skill you picked up that you think everyone should have?",
  "What's a place, meal or experience you still think about?",
];
function startSurprise() {
  pick = null; into = null; window.scrollTo(0, 0);
  // Never the same opener twice in a row for one person: remember the ones this browser has seen, and reset once all are used.
  let seen = []; try { seen = JSON.parse(localStorage.getItem('kc-openers') || '[]'); } catch (e) {}
  let left = OPENERS.filter(q => !seen.includes(q)); if (!left.length) { seen = []; left = OPENERS; }
  const q = left[Math.floor(Math.random() * left.length)];
  try { localStorage.setItem('kc-openers', JSON.stringify([...seen, q])); } catch (e) {}
  startInterview('Surprise me', '', 'open', q);
}

window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

let started = false;
onUser(async u => {
  if (!live()) { box.innerHTML = `<section class="card"><p class="kc-body">Making keycards opens very soon.</p></section>`; return; }
  if (!u) { owner = null; if (params.get('into') && aiUrl && !into) return startInto(params.get('into')); return into ? renderInto() : starters(); }
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
      if (pend.act === 'surprise' && aiUrl) return startSurprise();
      if (pend.act === 'into' && aiUrl) return startInto(pend.topic);
      if (pend.act === 'ask') { await startInto(pend.topic); await saveAsk(pend.topic).catch(() => {}); into.asked = true; return renderInto(); }
      if (pend.act === 'find' && aiUrl) { pick = 'find'; found = { answers: pend.answers || [] }; starters(); return findIdeas(pend.answers || []); }
    }
    try { iv = JSON.parse(sessionStorage.getItem(IV) || 'null'); } catch (e) { iv = null; }
    if (iv && iv.reveal) { rv = iv.reveal; rv.reads = rv.reads || []; iv = null; made = { how: 'interview', t0: rv.t0, takes: rv.take };
      if (rv.reads.some(r => r.r)) made.reads = { shown: rv.reads.length, spot: rv.reads.filter(x => x.r === 'spot').length, notquite: rv.reads.filter(x => x.r === 'notquite').length, wrong: rv.reads.filter(x => x.r === 'wrong').length };
      return renderReveal(); }
    if (iv && iv.q && aiUrl) return renderIv();
    if (params.get('into') && aiUrl) return startInto(params.get('into'));
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
    if (focus === 'reasons') return startReasons();
    if (focus === 'star') { shut.clear(); render(); const b = box.querySelector('[data-star]'); if (b) b.scrollIntoView({ block: 'center' }); toast('Tap ☆ on your top 3'); }
    if (focus === 'watch') { const w = box.querySelector('[data-p="watch"]'); w.scrollIntoView({ block: 'center' }); w.focus(); }
  } catch (e) { box.innerHTML = `<section class="card"><p class="kc-body">We couldn't find that keycard. <a href="${ROOT}me/">Your keycards</a></p></section>`; }
});
