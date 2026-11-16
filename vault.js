// ======================================================================
// Data vault — end-to-end encrypted personal records (Settings -> Data)
//  * One random AES-256-GCM data key (DEK) encrypts every record + the
//    category/people config. Firestore only ever sees ciphertext.
//  * The DEK is wrapped twice: by a key derived (PBKDF2) from the passphrase,
//    and by one derived from a one-time recovery code.
//  * Changing the passphrase just re-wraps the DEK (one small write).
// ======================================================================

// <pure>
const V_ENC = new TextEncoder(), V_DEC = new TextDecoder();
const V_PASS_ITER = 600000, V_CODE_ITER = 100000;

function vB64(buf) {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function vUnB64(str) {
  const s = atob(str), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}
async function vDeriveKek(secret, saltB64, iter) {
  const km = await crypto.subtle.importKey('raw', V_ENC.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: vUnB64(saltB64), iterations: iter, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function vWrapDek(dek, secret, iter) {            // dek must be extractable
  const salt = vB64(crypto.getRandomValues(new Uint8Array(16)));
  const kek = await vDeriveKek(secret, salt, iter);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { salt, iter, iv: vB64(iv), ct: vB64(ct) };
}
async function vUnwrapDek(w, secret, extractable) {     // throws on wrong secret
  const kek = await vDeriveKek(secret, w.salt, w.iter);
  return crypto.subtle.unwrapKey('raw', vUnB64(w.ct), kek, { name: 'AES-GCM', iv: vUnB64(w.iv) },
    { name: 'AES-GCM', length: 256 }, !!extractable, ['encrypt', 'decrypt']);
}
async function vToSession(dek) {                        // extractable DEK -> non-extractable copy
  const raw = await crypto.subtle.exportKey('raw', dek);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function vEncJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, V_ENC.encode(JSON.stringify(obj)));
  return { iv: vB64(iv), ct: vB64(ct) };
}
async function vDecJson(key, o) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vUnB64(o.iv) }, key, vUnB64(o.ct));
  return JSON.parse(V_DEC.decode(pt));
}

const V_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';      // 31 chars, no look-alikes
function vNewRecoveryCode() {
  let out = '';
  while (out.replace(/-/g, '').length < 25) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    for (const x of b) {
      if (x >= 248) continue;                           // rejection sampling: no modulo bias
      if (out.replace(/-/g, '').length >= 25) break;
      if (out.replace(/-/g, '').length % 5 === 0 && out) out += '-';
      out += V_ALPHA[x % 31];
    }
  }
  return out;
}
const vNormCode = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function vStrength(p) {
  let s = 0;
  if (p.length >= 8) s++; if (p.length >= 12) s++; if (p.length >= 16) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  return s <= 2 ? 'Weak' : s <= 4 ? 'OK' : 'Strong';
}

// ---- dates ----
const vPad = (n) => String(n).padStart(2, '0');
function vYMD(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; }
function vDaysBetween(a, b) {                           // whole days from a to b (YYYY-MM-DD)
  const A = vYMD(a), B = vYMD(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}
function vAgeText(dob, today) {
  const b = vYMD(dob), t = vYMD(today);
  let y = t.y - b.y, m = t.m - b.m;
  if (t.d < b.d) m--;
  if (m < 0) { y--; m += 12; }
  if (y < 0) return '';
  if (y === 0) return m === 0 ? 'newborn' : m + ' mo';
  return y + (y > 1 ? ' yrs' : ' yr') + (m ? ' ' + m + ' mo' : '');
}
function vNextBirthday(dob, today) {
  const b = vYMD(dob), t = vYMD(today);
  const mk = (y) => { const last = new Date(y, b.m, 0).getDate(); return `${y}-${vPad(b.m)}-${vPad(Math.min(b.d, last))}`; };
  let y = t.y, date = mk(y);
  if (date < today) { y++; date = mk(y); }
  return { date, days: vDaysBetween(today, date), turns: y - b.y };
}
const vFmtDMY = (s) => { const { y, m, d } = vYMD(s); return `${vPad(d)}/${vPad(m)}/${y}`; };
function vDaysLabel(n) {
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  return n > 0 ? 'in ' + n + ' days' : 'expired ' + (-n) + ' days ago';
}

// ---- values ----
const V_TYPES = { text: 'Text', date: 'Date', pan: 'PAN', aadhaar: 'Aadhaar', number: 'Number / ID', phone: 'Phone' };
const V_MASK_DEFAULT = { pan: true, aadhaar: true, number: true };
function vNormalize(type, v) {
  v = String(v || '').trim();
  if (type === 'pan') return v.toUpperCase().replace(/\s+/g, '');
  if (type === 'aadhaar') return v.replace(/\D/g, '');
  return v;
}
function vValidate(type, v) {                            // '' = looks fine
  if (type === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v)) return "This doesn't look like a valid PAN (e.g. ABCDE1234F). Tap Save again to keep it anyway.";
  if (type === 'aadhaar' && !/^\d{12}$/.test(v)) return "Aadhaar should be 12 digits. Tap Save again to keep it anyway.";
  return '';
}
function vMask(r) {
  const v = String(r.value || '');
  if (r.type === 'aadhaar') return '\u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 ' + v.slice(-4);
  return v.length <= 4 ? '\u2022\u2022\u2022\u2022' : '\u2022'.repeat(Math.max(4, v.length - 4)) + v.slice(-4);
}
function vCopyValue(r) {
  if (r.type === 'date' && r.value) return vFmtDMY(r.value);
  return r.value;
}

function vUpcoming(records, today, personName, windowDays) {
  const out = [];
  for (const r of records) {
    if (r.type !== 'date' || !r.value) continue;
    const who = personName(r.person);
    if (r.kind === 'birthday') {
      const nb = vNextBirthday(r.value, today);
      if (nb.days <= windowDays) out.push({ id: r.id, days: nb.days, title: (who || r.label) + ' turns ' + nb.turns, icon: '\uD83C\uDF82' });
    } else if (r.kind === 'expiry') {
      const d = vDaysBetween(today, r.value);
      if (d <= windowDays && d >= -30) out.push({ id: r.id, days: d, title: r.label + (who ? ' \u00B7 ' + who : ''), icon: '\u23F3' });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
// </pure>

// ======================================================================
// State, storage, UI
// ======================================================================
const VAULT_COL = firestoreDb.collection('vault');
const VMETA = firestoreDb.collection('meta').doc('vault');
const VCFG = firestoreDb.collection('meta').doc('vaultConfig');

const V_TEMPLATES = [
  { emoji: '\uD83C\uDF82', name: 'Family dates', defType: 'date', defLabel: 'Date of birth', defKind: 'birthday' },
  { emoji: '\uD83E\uDEAA', name: 'PAN numbers', defType: 'pan', defLabel: 'PAN' },
  { emoji: '\uD83C\uDD94', name: 'Aadhaar numbers', defType: 'aadhaar', defLabel: 'Aadhaar' },
  { emoji: '\uD83C\uDF93', name: 'School IDs', defType: 'text', defLabel: 'Student ID' },
  { emoji: '\uD83D\uDEE1\uFE0F', name: 'Insurance policies', defType: 'text', defLabel: 'Policy no.' },
  { emoji: '\uD83D\uDE97', name: 'Vehicles', defType: 'text', defLabel: 'Registration no.' },
  { emoji: '\uD83D\uDEC2', name: 'Passport & licence', defType: 'text', defLabel: 'Passport no.' },
  { emoji: '\uD83D\uDCDE', name: 'Important contacts', defType: 'phone', defLabel: 'Phone' }
];
const V_EMOJIS = ['\uD83D\uDCC1', '\uD83C\uDF82', '\uD83E\uDEAA', '\uD83C\uDD94', '\uD83C\uDF93', '\uD83D\uDEE1\uFE0F', '\uD83D\uDE97', '\uD83C\uDFE0', '\uD83C\uDFE5', '\uD83D\uDCBC', '\uD83D\uDCDE', '\u2B50'];

function vDefaultCfg() {
  return {
    cats: V_TEMPLATES.slice(0, 4).map((t, i) => ({ id: 'c_' + i, name: t.name, emoji: t.emoji, defType: t.defType, defLabel: t.defLabel, defKind: t.defKind || 'plain' })),
    people: []
  };
}
const V = {
  meta: undefined,        // undefined = loading, null = vault not created yet
  metaError: false, key: null, cfg: vDefaultCfg(), records: [], seq: 0,
  unsubRecs: null, unsubCfg: null, person: 'all', cat: null, q: '', revealed: new Set(),
  hiddenAt: 0, remember: false, fails: 0, lockedUntil: 0, pending: null, uiState: '', editing: null
};
const $v = (id) => document.getElementById(id);
const vEsc = (s) => escapeHtml(String(s == null ? '' : s));
const vId = (p) => p + Math.random().toString(36).slice(2, 9);
const vCat = (id) => V.cfg.cats.find(c => c.id === id);
const vPersonName = (id) => { const p = V.cfg.people.find(p => p.id === id); return p ? p.name : ''; };

const ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>'
};

// ---- toast / clipboard ----
let vToastTimer;
function vToast(msg) {
  const el = $v('vToast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(vToastTimer); vToastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}
async function vCopy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove(); return ok;
  }
}

// ---- remembered key (non-extractable CryptoKey in IndexedDB) ----
function vIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('std-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function vKeyOp(mode, fn) {
  try {
    const db = await vIdb();
    return await new Promise((res, rej) => {
      const tx = db.transaction('k', mode); const req = fn(tx.objectStore('k'));
      tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error);
    });
  } catch (e) { return null; }
}
const vKeyPut = (k) => vKeyOp('readwrite', s => s.put(k, 'dek'));
const vKeyGet = () => vKeyOp('readonly', s => s.get('dek'));
const vKeyDel = () => vKeyOp('readwrite', s => s.delete('dek'));

// ---- sync ----
function vaultInit() {
  VMETA.onSnapshot(async (snap) => {
    V.metaError = false;
    V.meta = snap.exists ? snap.data() : null;
    if (V.meta && !V.key) await vTryRestore();
    if (!V.meta && V.key) vLock(true);
    vRenderAll();
  }, (err) => { console.error('vault meta', err); V.metaError = true; vRenderAll(); });
}
async function vTryRestore() {
  const k = await vKeyGet();
  if (!k) return;
  try {
    const snap = await VCFG.get();
    if (snap.exists) await vDecJson(k, snap.data().enc);
    V.key = k; V.remember = true; vStartSession();
  } catch (e) { vKeyDel(); }
}
function vStartSession() {
  vStopSession();
  V.unsubCfg = VCFG.onSnapshot(async (snap) => {
    try {
      V.cfg = snap.exists ? await vDecJson(V.key, snap.data().enc) : vDefaultCfg();
      V.cfg.cats = V.cfg.cats || []; V.cfg.people = V.cfg.people || [];
    } catch (e) { vLock(true); vToast('Data was reset on another device'); return; }
    vRenderAll();
  }, (e) => console.error('vault cfg', e));
  V.unsubRecs = VAULT_COL.onSnapshot(async (snap) => {
    const seq = ++V.seq, key = V.key;
    const out = await Promise.all(snap.docs.map(async (d) => {
      try { return Object.assign({ id: d.id }, await vDecJson(key, d.data().enc)); } catch (e) { return null; }
    }));
    if (seq !== V.seq || !V.key) return;
    V.records = out.filter(Boolean); vRenderAll();
  }, (e) => console.error('vault records', e));
}
function vStopSession() {
  if (V.unsubRecs) { V.unsubRecs(); V.unsubRecs = null; }
  if (V.unsubCfg) { V.unsubCfg(); V.unsubCfg = null; }
}
function vLock(silent) {
  vStopSession(); V.seq++;
  V.key = null; V.records = []; V.revealed.clear(); V.remember = false; V.q = '';
  vKeyDel();
  $v('vaultModal').classList.add('hidden');
  if (currentTab === 'dataList') { setTimeout(() => history.back(), 0); }
  vRenderAll();
  if (!silent) vToast('Locked');
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) V.hiddenAt = Date.now();
  else if (V.key && !V.remember && V.hiddenAt && Date.now() - V.hiddenAt > 5 * 60 * 1000) vLock();
});

async function vSaveCfg() {
  const enc = await vEncJson(V.key, V.cfg);
  VCFG.set({ enc, updatedAt: Date.now() }).catch(console.error);
}
async function vSaveRecord(rec, id) {
  const { id: _drop, ...payload } = rec;
  const enc = await vEncJson(V.key, payload);
  const ref = id ? VAULT_COL.doc(id) : VAULT_COL.doc();
  ref.set({ enc, updatedAt: Date.now() }).catch(console.error);
  return ref.id;
}

// ---- hooks used by app.js ----
function vaultOnView(name) {
  if (name === 'dataHome') { V.q = ''; vRenderAll(); }
  if (name === 'dataList') {
    const c = vCat(V.cat);
    viewTitleEl.textContent = c ? c.emoji + ' ' + c.name : 'Data';
    vRenderAll();
  }
  vUpdateFab();
}
function vUpdateFab() {
  $v('vFab').classList.toggle('hidden', !((currentTab === 'dataHome' || currentTab === 'dataList') && V.key));
}
function vRenderAll() {
  if (currentTab === 'dataHome') renderDataHome();
  else if (currentTab === 'dataList') renderDataList();
  else if (currentTab === 'home') renderVaultHomeCard();
  vUpdateFab();
}
function renderVaultHomeCard() {
  const card = $v('homeVaultCard'); if (!card) return;
  const items = V.key ? vUpcoming(V.records, todayStr(), vPersonName, 30) : [];
  card.classList.toggle('hidden', !items.length);
  if (!items.length) return;
  $v('homeVaultList').innerHTML = items.slice(0, 6).map(i => `
    <div class="vrow ${i.days < 0 ? 'late' : ''}" data-vgo="1"><span>${i.icon} ${vEsc(i.title)}</span><span class="d">${vDaysLabel(i.days)}</span></div>`).join('');
}

// ---- rendering: Data home ----
function renderDataHome() {
  const body = $v('dataHomeBody');
  let state;
  if (V.metaError && V.meta === undefined) state = 'error';
  else if (V.meta === undefined) state = 'loading';
  else if (V.pending) state = 'recovery';
  else if (V.meta === null) state = 'setup';
  else if (!V.key) state = 'unlock';
  else state = 'main';

  if (state !== V.uiState) { body.innerHTML = vSkeleton(state); V.uiState = state; vBindState(state); }
  if (state === 'main') {
    const f = $v('vSearch'); if (f && f.value !== V.q) f.value = V.q;
    $v('vChips').innerHTML = vChipsHtml();
    $v('vContent').innerHTML = vHomeContent();
  }
}
function vSkeleton(state) {
  if (state === 'loading') return '<div class="empty-state">Loading&hellip;</div>';
  if (state === 'error') return '<div class="card"><div class="row-sub" style="margin-bottom:12px;">Couldn\u2019t load Data. Check your connection.</div><button class="btn" id="vRetry">Retry</button></div>';
  if (state === 'setup') return `
    <div class="card vhero">
      <div class="vhero-ico">${ICON.shield}</div>
      <h2>Private Data vault</h2>
      <p>Save IDs, dates and numbers you reuse often. Everything is encrypted on this device before it\u2019s stored, so nobody else can read it, not even Firebase. You\u2019ll unlock it with a passphrase of your own.</p>
      <div class="field"><label>Choose a passphrase</label><input class="vinput" id="vsPass" type="password" autocomplete="new-password" placeholder="A few random words works well"><div class="row-sub" id="vsStrength"></div></div>
      <div class="field"><label>Confirm passphrase</label><input class="vinput" id="vsPass2" type="password" autocomplete="new-password"></div>
      <div class="vwarn" id="vsErr"></div>
      <button class="btn" id="vsGo">Create vault</button>
    </div>`;
  if (state === 'recovery') return `
    <div class="card vhero">
      <h2>Save your recovery code</h2>
      <p>If you ever forget your passphrase, this code is the <b>only</b> way to get your data back. Keep it somewhere safe and offline, not in this app.</p>
      <div class="vcode" id="vsCode">${vCodeHtml(V.pending.code)}</div>
      <div class="field-row" style="margin-bottom:12px;"><button class="btn secondary" id="vsCopyCode">Copy</button><button class="btn secondary" id="vsDlCode">Download</button></div>
      <label class="vcheck"><input type="checkbox" id="vsSaved"> I\u2019ve saved my recovery code</label>
      <button class="btn" id="vsDone" disabled style="margin-top:12px;">Continue</button>
    </div>`;
  if (state === 'unlock') return `
    <div class="card vhero">
      <div class="vhero-ico">${ICON.lock}</div>
      <h2>Data is locked</h2>
      <div class="field"><input class="vinput" id="vuPass" type="password" autocomplete="current-password" placeholder="Passphrase"></div>
      <label class="vcheck"><input type="checkbox" id="vuRemember"> Keep unlocked on this device</label>
      <div class="vwarn" id="vuErr"></div>
      <button class="btn" id="vuGo" style="margin-top:6px;">Unlock</button>
      <div class="vlink" id="vuForgot">Forgot passphrase?</div>
    </div>`;
  return `
    <div class="vbar">
      <input class="vinput" id="vSearch" type="search" placeholder="Search all data\u2026" autocomplete="off">
      <button class="icon-btn" id="vLockBtn" title="Lock now">${ICON.lock}</button>
      <button class="icon-btn" id="vMoreBtn" title="More">${ICON.more}</button>
    </div>
    <div class="chip-row vchips" id="vChips"></div>
    <div id="vContent"></div>`;
}
function vBindState(state) {
  if (state === 'error') $v('vRetry').onclick = () => { V.metaError = false; V.meta = undefined; V.uiState = ''; vaultInit(); vRenderAll(); };
  if (state === 'setup') {
    $v('vsPass').addEventListener('input', (e) => { $v('vsStrength').textContent = e.target.value ? 'Strength: ' + vStrength(e.target.value) : ''; });
    $v('vsGo').onclick = vSetupStart;
  }
  if (state === 'recovery') {
    $v('vsCopyCode').onclick = async () => vToast((await vCopy(V.pending.code)) ? 'Recovery code copied' : 'Copy failed');
    $v('vsDlCode').onclick = () => vDownload('std-recovery-code.txt', 'Std Data recovery code\n' + V.pending.code + '\n\nKeep this safe. Anyone with it AND access to your account can unlock your Data.\n');
    $v('vsSaved').onchange = (e) => { $v('vsDone').disabled = !e.target.checked; };
    $v('vsDone').onclick = vSetupCommit;
  }
  if (state === 'unlock') {
    $v('vuGo').onclick = vUnlockSubmit;
    $v('vuPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') vUnlockSubmit(); });
    $v('vuForgot').onclick = vOpenForgot;
  }
  if (state === 'main') {
    $v('vSearch').addEventListener('input', (e) => { V.q = e.target.value; $v('vContent').innerHTML = vHomeContent(); });
    $v('vLockBtn').onclick = () => vLock();
    $v('vMoreBtn').onclick = vOpenMenu;
  }
}
const vCodeHtml = (c) => String(c).split('-').map(g => '<span>' + vEsc(g) + '</span>').join('-');
function vDownload(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function vChipsHtml() {
  const chips = [`<button type="button" class="chip ${V.person === 'all' ? 'selected' : ''}" data-vperson="all">All</button>`]
    .concat(V.cfg.people.map(p => `<button type="button" class="chip ${V.person === p.id ? 'selected' : ''}" data-vperson="${p.id}">${vEsc(p.name)}</button>`));
  chips.push('<button type="button" class="chip" data-vact="people">+ Person</button>');
  return chips.join('');
}
function vSortRecs(list) {
  const order = (id) => { const i = V.cfg.people.findIndex(p => p.id === id); return i < 0 ? 999 : i; };
  return list.slice().sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || order(a.person) - order(b.person) || String(a.label).localeCompare(String(b.label)));
}
function vSubText(r) {
  const parts = [];
  if (r.type === 'date' && r.value) {
    const t = todayStr();
    if (r.kind === 'birthday') {
      const nb = vNextBirthday(r.value, t); const age = vAgeText(r.value, t);
      if (age) parts.push(age);
      if (nb.days <= 60) parts.push('turns ' + nb.turns + ' ' + vDaysLabel(nb.days).toLowerCase());
    } else if (r.kind === 'expiry') parts.push(vDaysLabel(vDaysBetween(t, r.value)));
  }
  if (r.note) parts.push(r.note.length > 70 ? r.note.slice(0, 70) + '\u2026' : r.note);
  return parts.join(' \u00B7 ');
}
function vDisplay(r) {
  if (r.type === 'date' && r.value) return formatDate(r.value);
  if (r.type === 'aadhaar') return String(r.value).replace(/(\d{4})(?=\d)/g, '$1 ');
  return r.value;
}
function vCardHtml(r, showCat) {
  const masked = r.mask && !V.revealed.has(r.id);
  const person = vPersonName(r.person), c = vCat(r.cat), sub = vSubText(r);
  return `<div class="vrec" data-vid="${r.id}">
    <div class="vrec-main" data-vact="copy">
      <div class="vrec-top"><span class="vrec-label">${vEsc(r.label)}</span>${person ? `<span class="vrec-person">${vEsc(person)}</span>` : ''}${showCat && c ? `<span class="vrec-cat">${vEsc(c.emoji)} ${vEsc(c.name)}</span>` : ''}${r.pin ? '<span class="vrec-pin">\u2605</span>' : ''}</div>
      <div class="vrec-val ${masked ? 'masked' : ''}">${vEsc(masked ? vMask(r) : vDisplay(r))}</div>
      ${sub ? `<div class="vrec-sub">${vEsc(sub)}</div>` : ''}
    </div>
    <div class="vrec-actions">
      ${r.mask ? `<button class="vbtn" data-vact="reveal" title="Show / hide">${ICON.eye}</button>` : ''}
      <button class="vbtn" data-vact="share" title="Share">${ICON.share}</button>
      <button class="vbtn ${r.pin ? 'on' : ''}" data-vact="pin" title="Pin to top">${ICON.star}</button>
      <button class="vbtn" data-vact="edit" title="Edit">${ICON.pen}</button>
    </div>
  </div>`;
}
function vHomeContent() {
  const q = V.q.trim().toLowerCase();
  if (q) {
    const hits = vSortRecs(V.records.filter(r => {
      if (V.person !== 'all' && r.person !== V.person) return false;
      const c = vCat(r.cat);
      return [r.label, r.value, r.note, vPersonName(r.person), c && c.name].some(x => String(x || '').toLowerCase().includes(q));
    }));
    return hits.length ? `<div class="group-header" style="cursor:default;">${hits.length} result${hits.length > 1 ? 's' : ''}</div>` + hits.map(r => vCardHtml(r, true)).join('')
      : '<div class="empty-state">Nothing matches \u201C' + vEsc(V.q) + '\u201D</div>';
  }
  if (V.person !== 'all') {
    const mine = V.records.filter(r => r.person === V.person);
    if (!mine.length) return `<div class="empty-state">Nothing saved for ${vEsc(vPersonName(V.person))} yet.<br>Tap + to add something.</div>`;
    const cats = V.cfg.cats.concat([{ id: '__other', name: 'Other', emoji: '\uD83D\uDCC1' }]);
    return cats.map(c => {
      const list = vSortRecs(mine.filter(r => (vCat(r.cat) ? r.cat : '__other') === c.id));
      return list.length ? `<div class="group-header" style="cursor:default;">${vEsc(c.emoji)} ${vEsc(c.name)}</div>` + list.map(r => vCardHtml(r, false)).join('') : '';
    }).join('');
  }
  const pinned = vSortRecs(V.records.filter(r => r.pin));
  let html = '';
  if (pinned.length) html += '<div class="group-header" style="cursor:default;">\u2605 Pinned</div>' + pinned.map(r => vCardHtml(r, true)).join('');
  html += '<div class="group-header" style="cursor:default;">Categories</div><div class="vtiles">' +
    V.cfg.cats.map(c => { const n = V.records.filter(r => r.cat === c.id).length;
      return `<div class="vtile" data-vcat="${c.id}"><div class="e">${vEsc(c.emoji)}</div><div class="n">${vEsc(c.name)}</div><div class="c">${n} item${n === 1 ? '' : 's'}</div></div>`; }).join('') +
    '<div class="vtile add" data-vact="newcat"><div class="e">+</div><div class="n">New category</div></div></div>';
  return html;
}

// ---- rendering: category list ----
function renderDataList() {
  const body = $v('dataListBody'), c = vCat(V.cat);
  if (!V.key || !c) { body.innerHTML = ''; return; }
  const list = vSortRecs(V.records.filter(r => r.cat === c.id && (V.person === 'all' || r.person === V.person)));
  body.innerHTML = `<div class="vlist-title">${vEsc(c.emoji)} ${vEsc(c.name)}</div><div class="chip-row vchips">${vChipsHtml()}</div>` +
    (list.length ? list.map(r => vCardHtml(r, false)).join('') : `<div class="empty-state">Nothing here yet.<br>Tap + to add your first item.</div>`) +
    `<button class="btn secondary btn-icon" data-vact="editcat" style="margin-top:14px;">${ICON.pen}<span>Edit category</span></button>`;
}

// ---- modal helpers ----
function vModal(html) { $v('vaultModalBody').innerHTML = html; $v('vaultModal').classList.remove('hidden'); }
function vModalClose() { $v('vaultModal').classList.add('hidden'); V.editing = null; }
function vBusy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Working\u2026'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } }

// ---- setup / unlock / recovery flows ----
async function vSetupStart() {
  const p1 = $v('vsPass').value, p2 = $v('vsPass2').value, err = $v('vsErr');
  err.textContent = '';
  if (p1.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
  if (p1 !== p2) { err.textContent = 'The two passphrases don\u2019t match.'; return; }
  const btn = $v('vsGo'); vBusy(btn, true, 'Securing\u2026');
  try {
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const code = vNewRecoveryCode();
    const wrapped = await vWrapDek(dek, p1, V_PASS_ITER);
    const rwrapped = await vWrapDek(dek, vNormCode(code), V_CODE_ITER);
    V.pending = { wrapped, rwrapped, code, session: await vToSession(dek) };
    renderDataHome();
  } catch (e) { console.error(e); err.textContent = 'Something went wrong. Please try again.'; vBusy(btn, false); }
}
async function vSetupCommit() {
  const P = V.pending; if (!P) return;
  const cfg = vDefaultCfg();
  const enc = await vEncJson(P.session, cfg);
  const meta = { v: 2, wrapped: P.wrapped, rwrapped: P.rwrapped, createdAt: Date.now() };
  const b = firestoreDb.batch();
  b.set(VMETA, meta); b.set(VCFG, { enc, updatedAt: Date.now() });
  b.commit().catch(console.error);
  V.meta = meta; V.key = P.session; V.cfg = cfg; V.pending = null;
  vStartSession(); renderDataHome(); vUpdateFab();
}
async function vUnlockSubmit() {
  const err = $v('vuErr'), btn = $v('vuGo');
  if (Date.now() < V.lockedUntil) { err.textContent = 'Too many attempts. Wait a moment.'; return; }
  const pass = $v('vuPass').value; if (!pass) return;
  err.textContent = ''; vBusy(btn, true, 'Unlocking\u2026');
  try {
    const key = await vUnwrapDek(V.meta.wrapped, pass, false);
    V.fails = 0; V.key = key; V.remember = $v('vuRemember').checked;
    if (V.remember) await vKeyPut(key);
    vStartSession(); renderDataHome(); vUpdateFab();
  } catch (e) {
    V.fails++;
    if (V.fails >= 5) { V.lockedUntil = Date.now() + 30000; V.fails = 0; err.textContent = 'Too many attempts. Try again in 30 seconds.'; }
    else err.textContent = 'Wrong passphrase.';
    vBusy(btn, false);
  }
}
function vOpenForgot() {
  vModal(`<h3>Reset passphrase</h3>
    <div class="row-sub" style="margin-bottom:12px;">Enter the recovery code you saved when you created the vault, then choose a new passphrase. Your data stays intact.</div>
    <div class="field"><label>Recovery code</label><input class="vinput" id="vfCode" type="text" autocapitalize="characters" autocomplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"></div>
    <div class="field"><label>New passphrase</label><input class="vinput" id="vfP1" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Confirm new passphrase</label><input class="vinput" id="vfP2" type="password" autocomplete="new-password"></div>
    <div class="vwarn" id="vfErr"></div>
    <button class="btn" id="vfGo">Reset passphrase</button>
    <button class="btn secondary" id="vfCancel" style="margin-top:8px;">Cancel</button>
    <div class="vlink danger" id="vfNoCode">I don\u2019t have a recovery code</div>`);
  $v('vfCancel').onclick = vModalClose; $v('vfNoCode').onclick = vOpenReset;
  $v('vfGo').onclick = async () => {
    const err = $v('vfErr'), p1 = $v('vfP1').value; err.textContent = '';
    if (p1.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    if (p1 !== $v('vfP2').value) { err.textContent = 'The two passphrases don\u2019t match.'; return; }
    const btn = $v('vfGo'); vBusy(btn, true, 'Resetting\u2026');
    try {
      const dek = await vUnwrapDek(V.meta.rwrapped, vNormCode($v('vfCode').value), true);
      const wrapped = await vWrapDek(dek, p1, V_PASS_ITER);
      V.meta = Object.assign({}, V.meta, { wrapped });
      VMETA.update({ wrapped }).catch(console.error);
      V.key = await vToSession(dek); vStartSession(); vModalClose(); renderDataHome(); vUpdateFab();
      vToast('Passphrase reset');
    } catch (e) { err.textContent = 'That recovery code doesn\u2019t match.'; vBusy(btn, false); }
  };
}
function vOpenReset() {
  vModal(`<h3>Erase all Data?</h3>
    <div class="row-sub" style="margin-bottom:12px;">Without your passphrase or recovery code the saved data can\u2019t be read by anyone. This permanently deletes everything in Data so you can start fresh.</div>
    <div class="field"><label>Type DELETE to confirm</label><input class="vinput" id="vrmWord" type="text" autocomplete="off"></div>
    <button class="btn danger" id="vrmGo">Erase everything</button>
    <button class="btn secondary" id="vrmCancel" style="margin-top:8px;">Cancel</button>`);
  $v('vrmCancel').onclick = vModalClose;
  $v('vrmGo').onclick = async () => {
    if ($v('vrmWord').value.trim() !== 'DELETE') return;
    const btn = $v('vrmGo'); vBusy(btn, true, 'Erasing\u2026');
    try {
      const snap = await VAULT_COL.get();
      const refs = snap.docs.map(d => d.ref);
      for (let i = 0; i < refs.length; i += 400) { const b = firestoreDb.batch(); refs.slice(i, i + 400).forEach(r => b.delete(r)); await b.commit(); }
      const b2 = firestoreDb.batch(); b2.delete(VMETA); b2.delete(VCFG); await b2.commit();
      vStopSession(); V.key = null; V.records = []; V.cfg = vDefaultCfg(); V.meta = null; V.remember = false; vKeyDel();
      vModalClose(); renderDataHome(); vUpdateFab(); vToast('Data erased');
    } catch (e) { console.error(e); vBusy(btn, false); }
  };
}

// ---- menu ----
function vOpenMenu() {
  vModal(`<h3>Data options</h3>
    <div class="settings-link" data-vm="cats"><div><div class="row-label">Categories</div><div class="row-sub">Add, rename or remove</div></div><span class="chev">&#8250;</span></div>
    <div class="settings-link" data-vm="people"><div><div class="row-label">People</div><div class="row-sub">Family members used as tags</div></div><span class="chev">&#8250;</span></div>
    <div class="row"><div><div class="row-label">Keep unlocked on this device</div><div class="row-sub">Skip the passphrase here. Lock now to turn off.</div></div>
      <label class="switch"><input type="checkbox" id="vmRemember" ${V.remember ? 'checked' : ''}><span class="slider"></span></label></div>
    <div class="settings-link" data-vm="pass"><div><div class="row-label">Change passphrase</div></div><span class="chev">&#8250;</span></div>
    <div class="settings-link" data-vm="code"><div><div class="row-label">New recovery code</div><div class="row-sub">Replaces the old one</div></div><span class="chev">&#8250;</span></div>
    <div class="settings-link" data-vm="reset" style="border-bottom:none;"><div><div class="row-label" style="color:var(--bad);">Erase all Data</div></div><span class="chev">&#8250;</span></div>
    <button class="btn secondary" id="vmClose" style="margin-top:12px;">Close</button>`);
  $v('vmClose').onclick = vModalClose;
  $v('vmRemember').onchange = async (e) => {
    V.remember = e.target.checked;
    if (V.remember) await vKeyPut(V.key); else await vKeyDel();
    vToast(V.remember ? 'Staying unlocked on this device' : 'Will lock after 5 min away');
  };
}
function vOpenPassChange() {
  vModal(`<h3>Change passphrase</h3>
    <div class="field"><label>Current passphrase</label><input class="vinput" id="vcCur" type="password" autocomplete="current-password"></div>
    <div class="field"><label>New passphrase</label><input class="vinput" id="vcP1" type="password" autocomplete="new-password"></div>
    <div class="field"><label>Confirm new passphrase</label><input class="vinput" id="vcP2" type="password" autocomplete="new-password"></div>
    <div class="vwarn" id="vcErr"></div>
    <button class="btn" id="vcGo">Change passphrase</button>
    <button class="btn secondary" id="vcCancel" style="margin-top:8px;">Cancel</button>`);
  $v('vcCancel').onclick = vModalClose;
  $v('vcGo').onclick = async () => {
    const err = $v('vcErr'), p1 = $v('vcP1').value; err.textContent = '';
    if (p1.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    if (p1 !== $v('vcP2').value) { err.textContent = 'The two new passphrases don\u2019t match.'; return; }
    const btn = $v('vcGo'); vBusy(btn, true, 'Changing\u2026');
    let dek; try { dek = await vUnwrapDek(V.meta.wrapped, $v('vcCur').value, true); } catch (e) { err.textContent = 'Current passphrase is wrong.'; vBusy(btn, false); return; }
    const wrapped = await vWrapDek(dek, p1, V_PASS_ITER);
    V.meta = Object.assign({}, V.meta, { wrapped }); VMETA.update({ wrapped }).catch(console.error);
    vModalClose(); vToast('Passphrase changed');
  };
}
function vOpenNewCode() {
  vModal(`<h3>New recovery code</h3>
    <div class="row-sub" style="margin-bottom:12px;">Enter your passphrase to confirm. The old recovery code will stop working.</div>
    <div class="field"><input class="vinput" id="vnPass" type="password" autocomplete="current-password" placeholder="Passphrase"></div>
    <div class="vwarn" id="vnErr"></div>
    <button class="btn" id="vnGo">Generate new code</button>
    <button class="btn secondary" id="vnCancel" style="margin-top:8px;">Cancel</button>`);
  $v('vnCancel').onclick = vModalClose;
  $v('vnGo').onclick = async () => {
    const err = $v('vnErr'); err.textContent = '';
    const btn = $v('vnGo'); vBusy(btn, true, 'Working\u2026');
    let dek; try { dek = await vUnwrapDek(V.meta.wrapped, $v('vnPass').value, true); } catch (e) { err.textContent = 'Wrong passphrase.'; vBusy(btn, false); return; }
    const code = vNewRecoveryCode();
    const rwrapped = await vWrapDek(dek, vNormCode(code), V_CODE_ITER);
    V.meta = Object.assign({}, V.meta, { rwrapped }); VMETA.update({ rwrapped }).catch(console.error);
    vModal(`<h3>Your new recovery code</h3><div class="row-sub" style="margin-bottom:12px;">Save it somewhere safe and offline. It\u2019s only shown now.</div>
      <div class="vcode">${vCodeHtml(code)}</div>
      <div class="field-row"><button class="btn secondary" id="vnCopy">Copy</button><button class="btn secondary" id="vnDl">Download</button></div>
      <button class="btn" id="vnDone" style="margin-top:12px;">Done</button>`);
    $v('vnCopy').onclick = async () => vToast((await vCopy(code)) ? 'Recovery code copied' : 'Copy failed');
    $v('vnDl').onclick = () => vDownload('std-recovery-code.txt', 'Std Data recovery code\n' + code + '\n');
    $v('vnDone').onclick = vModalClose;
  };
}

// ---- categories ----
function vOpenCats() {
  vModal(`<h3>Categories</h3>` + (V.cfg.cats.map(c => {
    const n = V.records.filter(r => r.cat === c.id).length;
    return `<div class="settings-link" data-vecat="${c.id}"><div><div class="row-label">${vEsc(c.emoji)} ${vEsc(c.name)}</div><div class="row-sub">${n} item${n === 1 ? '' : 's'}</div></div><span class="chev">&#8250;</span></div>`;
  }).join('') || '<div class="empty-state">No categories</div>') +
    `<button class="btn" id="vcAdd" style="margin-top:12px;">+ New category</button><button class="btn secondary" id="vcBack" style="margin-top:8px;">Close</button>`);
  $v('vcAdd').onclick = () => vOpenCatEditor(null); $v('vcBack').onclick = vModalClose;
}
function vOpenCatEditor(id) {
  const c = id ? vCat(id) : { id: null, name: '', emoji: V_EMOJIS[0], defType: 'text', defLabel: '', defKind: 'plain' };
  V.editing = { catId: id };
  vModal(`<h3>${id ? 'Edit category' : 'New category'}</h3>
    ${id ? '' : `<div class="field"><label>Start from a template</label><div class="chip-row" id="vceTpl">${V_TEMPLATES.map((t, i) => `<button type="button" class="chip" data-tpl="${i}">${vEsc(t.emoji)} ${vEsc(t.name)}</button>`).join('')}</div></div>`}
    <div class="field"><label>Icon</label><input class="vinput" id="vceEmoji" type="text" maxlength="4" value="${vEsc(c.emoji)}" style="width:90px;text-align:center;font-size:1.3em;">
      <div class="chip-row" style="margin-top:8px;">${V_EMOJIS.map(e => `<button type="button" class="chip emo" data-emo="${e}">${e}</button>`).join('')}</div></div>
    <div class="field"><label>Name</label><input class="vinput" id="vceName" type="text" value="${vEsc(c.name)}" placeholder="e.g. Insurance policies"></div>
    <div class="field-row">
      <div class="field"><label>Usually holds</label><select class="vinput" id="vceType">${Object.keys(V_TYPES).map(k => `<option value="${k}" ${c.defType === k ? 'selected' : ''}>${V_TYPES[k]}</option>`).join('')}</select></div>
      <div class="field"><label>Default label</label><input class="vinput" id="vceLabel" type="text" value="${vEsc(c.defLabel)}" placeholder="e.g. Policy no."></div>
    </div>
    <div class="vwarn" id="vceErr"></div>
    <button class="btn" id="vceSave">Save</button>
    ${id ? '<button class="btn danger" id="vceDel" style="margin-top:8px;">Delete category</button>' : ''}
    <button class="btn secondary" id="vceCancel" style="margin-top:8px;">Cancel</button>`);
  $v('vceCancel').onclick = () => (id ? vOpenCats() : vModalClose());
  $v('vaultModalBody').querySelectorAll('[data-emo]').forEach(b => b.onclick = () => { $v('vceEmoji').value = b.dataset.emo; });
  $v('vaultModalBody').querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => {
    const t = V_TEMPLATES[+b.dataset.tpl];
    $v('vceEmoji').value = t.emoji; $v('vceName').value = t.name; $v('vceType').value = t.defType; $v('vceLabel').value = t.defLabel;
    V.editing.defKind = t.defKind || 'plain';
  });
  $v('vceSave').onclick = () => {
    const name = $v('vceName').value.trim(); if (!name) { $v('vceErr').textContent = 'Give the category a name.'; return; }
    const upd = { name, emoji: $v('vceEmoji').value.trim() || '\uD83D\uDCC1', defType: $v('vceType').value, defLabel: $v('vceLabel').value.trim(), defKind: (V.editing && V.editing.defKind) || (c.defKind || 'plain') };
    if (id) Object.assign(vCat(id), upd); else V.cfg.cats.push(Object.assign({ id: vId('c_') }, upd));
    vSaveCfg(); vRenderAll(); vOpenCats();
    if (currentTab === 'dataList') { const cc = vCat(V.cat); if (cc) viewTitleEl.textContent = cc.emoji + ' ' + cc.name; }
  };
  if (id) $v('vceDel').onclick = () => {
    const n = V.records.filter(r => r.cat === id).length;
    vModal(`<h3>Delete \u201C${vEsc(c.name)}\u201D?</h3><div class="row-sub" style="margin-bottom:14px;">${n ? 'This also deletes its ' + n + ' saved item' + (n === 1 ? '' : 's') + '. ' : ''}This can\u2019t be undone.</div>
      <button class="btn danger" id="vdYes">Delete</button><button class="btn secondary" id="vdNo" style="margin-top:8px;">Cancel</button>`);
    $v('vdNo').onclick = () => vOpenCatEditor(id);
    $v('vdYes').onclick = async () => {
      const refs = V.records.filter(r => r.cat === id).map(r => VAULT_COL.doc(r.id));
      for (let i = 0; i < refs.length; i += 400) { const b = firestoreDb.batch(); refs.slice(i, i + 400).forEach(r => b.delete(r)); b.commit().catch(console.error); }
      V.cfg.cats = V.cfg.cats.filter(x => x.id !== id); vSaveCfg();
      vModalClose(); vToast('Category deleted');
      if (currentTab === 'dataList' && V.cat === id) setTimeout(() => history.back(), 0);
      vRenderAll();
    };
  };
}

// ---- people ----
function vOpenPeople() {
  const row = (p) => `<div class="field-row vprow" data-pid="${p.id}"><div class="field"><input class="vinput" type="text" value="${vEsc(p.name)}" placeholder="Name"></div><button class="icon-btn vpdel" title="Remove" type="button">&times;</button></div>`;
  vModal(`<h3>People</h3><div class="row-sub" style="margin-bottom:12px;">Tag items with who they belong to, then filter by person.</div>
    <div id="vpList">${V.cfg.people.map(row).join('')}</div>
    <button class="btn secondary" id="vpAdd" type="button">+ Add person</button>
    <button class="btn" id="vpSave" style="margin-top:12px;">Save</button>
    <button class="btn secondary" id="vpCancel" style="margin-top:8px;">Cancel</button>`);
  const list = $v('vpList');
  const bindDel = () => list.querySelectorAll('.vpdel').forEach(b => b.onclick = () => b.closest('.vprow').remove());
  bindDel();
  $v('vpAdd').onclick = () => { list.insertAdjacentHTML('beforeend', row({ id: '', name: '' })); bindDel(); list.lastElementChild.querySelector('input').focus(); };
  $v('vpCancel').onclick = vModalClose;
  $v('vpSave').onclick = async () => {
    const next = [];
    list.querySelectorAll('.vprow').forEach(r => { const name = r.querySelector('input').value.trim(); if (name) next.push({ id: r.dataset.pid || vId('p_'), name }); });
    const gone = new Set(V.cfg.people.map(p => p.id).filter(id => !next.some(n => n.id === id)));
    V.cfg.people = next; if (V.person !== 'all' && !next.some(p => p.id === V.person)) V.person = 'all';
    await vSaveCfg();
    for (const r of V.records.filter(r => gone.has(r.person))) await vSaveRecord(Object.assign({}, r, { person: null }), r.id);
    vModalClose(); vRenderAll();
  };
}

// ---- record editor ----
function vOpenRecord(id, presetCat) {
  if (!V.cfg.cats.length) { vToast('Create a category first'); vOpenCatEditor(null); return; }
  const r = id ? V.records.find(x => x.id === id) : null;
  const cat = vCat(r ? r.cat : presetCat) || V.cfg.cats[0];
  const type = r ? r.type : cat.defType;
  const kind = r ? (r.kind || 'plain') : (cat.defKind || 'plain');
  V.editing = { id, warned: '' };
  vModal(`<h3>${id ? 'Edit item' : 'New item'}</h3>
    <div class="field-row">
      <div class="field"><label>Category</label><select class="vinput" id="vrCat">${V.cfg.cats.map(c => `<option value="${c.id}" ${c.id === cat.id ? 'selected' : ''}>${vEsc(c.emoji)} ${vEsc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Person</label><select class="vinput" id="vrPerson"><option value="">\u2014 none \u2014</option>${V.cfg.people.map(p => `<option value="${p.id}" ${r && r.person === p.id || (!r && V.person === p.id) ? 'selected' : ''}>${vEsc(p.name)}</option>`).join('')}<option value="__new">+ New person\u2026</option></select></div>
    </div>
    <div class="field hidden" id="vrNewWrap"><label>New person\u2019s name</label><input class="vinput" id="vrNew" type="text" autocomplete="off"></div>
    <div class="field-row">
      <div class="field"><label>Label</label><input class="vinput" id="vrLabel" type="text" value="${vEsc(r ? r.label : cat.defLabel)}" placeholder="e.g. PAN"></div>
      <div class="field"><label>Type</label><select class="vinput" id="vrType">${Object.keys(V_TYPES).map(k => `<option value="${k}" ${type === k ? 'selected' : ''}>${V_TYPES[k]}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>Value</label><input class="vinput" id="vrValue" autocomplete="off"></div>
    <div class="field hidden" id="vrKindWrap"><label>This date is a</label><select class="vinput" id="vrKind">
      <option value="birthday" ${kind === 'birthday' ? 'selected' : ''}>Birthday / anniversary (repeats yearly)</option>
      <option value="expiry" ${kind === 'expiry' ? 'selected' : ''}>Expiry / renewal (remind me before)</option>
      <option value="plain" ${kind === 'plain' ? 'selected' : ''}>Just a date</option></select></div>
    <div class="field"><label>Note (optional)</label><textarea class="vinput" id="vrNote" rows="2" placeholder="Anything to remember">${vEsc(r ? r.note : '')}</textarea></div>
    <label class="vcheck"><input type="checkbox" id="vrMask" ${(r ? r.mask : V_MASK_DEFAULT[type]) ? 'checked' : ''}> Hide value until I tap the eye</label>
    <label class="vcheck"><input type="checkbox" id="vrPin" ${r && r.pin ? 'checked' : ''}> Pin to top</label>
    <div class="vwarn" id="vrErr"></div>
    <button class="btn" id="vrSave" style="margin-top:6px;">Save</button>
    ${id ? '<button class="btn danger" id="vrDel" style="margin-top:8px;">Delete</button>' : ''}
    <button class="btn secondary" id="vrCancel" style="margin-top:8px;">Cancel</button>`);

  const valEl = $v('vrValue');
  const applyType = () => {
    const t = $v('vrType').value;
    valEl.type = t === 'date' ? 'date' : 'text';
    valEl.setAttribute('inputmode', t === 'aadhaar' ? 'numeric' : t === 'phone' ? 'tel' : 'text');
    valEl.setAttribute('autocapitalize', t === 'pan' ? 'characters' : 'off');
    valEl.placeholder = t === 'pan' ? 'ABCDE1234F' : t === 'aadhaar' ? '12-digit number' : '';
    $v('vrKindWrap').classList.toggle('hidden', t !== 'date');
  };
  applyType();
  valEl.value = r ? r.value : '';
  $v('vrType').onchange = () => { applyType(); valEl.value = ''; $v('vrMask').checked = !!V_MASK_DEFAULT[$v('vrType').value]; };
  $v('vrCat').onchange = () => {                       // pre-fill from category when starting a new item
    if (r) return;
    const c = vCat($v('vrCat').value); $v('vrLabel').value = c.defLabel; $v('vrType').value = c.defType; $v('vrKind').value = c.defKind || 'plain';
    applyType(); valEl.value = ''; $v('vrMask').checked = !!V_MASK_DEFAULT[c.defType];
  };
  $v('vrPerson').onchange = () => { const nw = $v('vrPerson').value === '__new'; $v('vrNewWrap').classList.toggle('hidden', !nw); if (nw) $v('vrNew').focus(); };
  $v('vrCancel').onclick = vModalClose;
  $v('vrSave').onclick = async () => {
    const err = $v('vrErr'); err.textContent = '';
    const t = $v('vrType').value, val = vNormalize(t, valEl.value);
    if (!val) { err.textContent = 'Enter a value.'; return; }
    const warn = vValidate(t, val);
    if (warn && V.editing.warned !== val) { V.editing.warned = val; err.textContent = warn; return; }
    let person = $v('vrPerson').value;
    if (person === '__new') {
      const nm = $v('vrNew').value.trim();
      if (!nm) { err.textContent = 'Enter the new person\u2019s name.'; return; }
      person = vId('p_'); V.cfg.people.push({ id: person, name: nm }); await vSaveCfg();
    }
    const c = vCat($v('vrCat').value);
    const rec = { cat: c.id, person: person || null, label: $v('vrLabel').value.trim() || c.defLabel || c.name, type: t, value: val,
      kind: t === 'date' ? $v('vrKind').value : 'plain', note: $v('vrNote').value.trim(), mask: $v('vrMask').checked, pin: $v('vrPin').checked, ts: Date.now() };
    await vSaveRecord(rec, id); vModalClose();
  };
  if (id) $v('vrDel').onclick = () => {
    vModal(`<h3>Delete this item?</h3><div class="row-sub" style="margin-bottom:14px;">${vEsc(r.label)} will be permanently removed.</div>
      <button class="btn danger" id="vdYes">Delete</button><button class="btn secondary" id="vdNo" style="margin-top:8px;">Cancel</button>`);
    $v('vdNo').onclick = () => vOpenRecord(id);
    $v('vdYes').onclick = () => { VAULT_COL.doc(id).delete().catch(console.error); vModalClose(); vToast('Deleted'); };
  };
}

// ---- events ----
async function vRecordAction(act, id) {
  const r = V.records.find(x => x.id === id); if (!r) return;
  if (act === 'copy') { vToast((await vCopy(String(vCopyValue(r)))) ? 'Copied ' + r.label : 'Copy failed'); }
  else if (act === 'reveal') {
    if (V.revealed.has(id)) V.revealed.delete(id);
    else { V.revealed.add(id); setTimeout(() => { V.revealed.delete(id); vRenderAll(); }, 20000); }
    vRenderAll();
  }
  else if (act === 'share') {
    const who = vPersonName(r.person), text = (who ? who + ' \u2013 ' : '') + r.label + ': ' + vCopyValue(r);
    if (navigator.share) { try { await navigator.share({ text }); } catch (e) {} }
    else vToast((await vCopy(text)) ? 'Copied for sharing' : 'Copy failed');
  }
  else if (act === 'pin') vSaveRecord(Object.assign({}, r, { pin: !r.pin }), id);
  else if (act === 'edit') vOpenRecord(id);
}
function vHandleClick(e) {
  const chip = e.target.closest('[data-vperson]');
  if (chip) { V.person = chip.dataset.vperson; vRenderAll(); return; }
  const tile = e.target.closest('[data-vcat]');
  if (tile) { V.cat = tile.dataset.vcat; goToView('dataList'); return; }
  const btn = e.target.closest('[data-vact]');
  if (!btn) return;
  const act = btn.dataset.vact, card = btn.closest('[data-vid]');
  if (card) return vRecordAction(act, card.dataset.vid);
  if (act === 'people') vOpenPeople();
  else if (act === 'newcat') vOpenCatEditor(null);
  else if (act === 'editcat') vOpenCatEditor(V.cat);
}
['view-dataHome', 'view-dataList'].forEach(id => $v(id).addEventListener('click', vHandleClick));
$v('vFab').addEventListener('click', () => vOpenRecord(null, currentTab === 'dataList' ? V.cat : null));
$v('dataLink').addEventListener('click', () => goToView('dataHome'));
$v('homeVaultCard').addEventListener('click', () => goToView('dataHome'));
$v('vaultModal').addEventListener('click', (e) => {
  if (e.target === $v('vaultModal')) { vModalClose(); return; }
  const m = e.target.closest('[data-vm]');
  if (m) ({ cats: vOpenCats, people: vOpenPeople, pass: vOpenPassChange, code: vOpenNewCode, reset: vOpenReset })[m.dataset.vm]();
  const ec = e.target.closest('[data-vecat]');
  if (ec) vOpenCatEditor(ec.dataset.vecat);
});
ALL_MODAL_IDS.push('vaultModal');
authReady.then(vaultInit);
