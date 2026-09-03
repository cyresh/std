// ================= State =================
let allTasks = [];
let currentTab = 'home';
let previousTabView = 'home';
let currentTaskId = null;
let completedCollapsed = { simple: false, medium: false, heavy: false };
let creatorNames = ['Name 1', 'Name 2', 'Name 3'];
let tabLabels = { simple: 'Simple', medium: 'Medium', heavy: 'Heavy' };
let addTaskSelectedCreator = null;
let editSelectedCreator = null;
let calYear, calMonth;
let editingCreatorNames = [];
const MAIN_TABS_ORDER = ['home', 'simple', 'medium', 'heavy'];

// ================= Utilities =================
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return 'No due date';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(timeStr) {
  if (!timeStr) return '\u2014';
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTs(ts) {
  return new Date(ts).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function isOverdue(task) {
  return task.status === 'open' && task.dueDate && task.dueDate < todayStr();
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return String(hash);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ================= Theme =================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('std_theme', theme);
  document.getElementById('lightThemeToggle').checked = theme === 'light';
}
function initTheme() {
  applyTheme(localStorage.getItem('std_theme') || 'dark');
}
document.getElementById('lightThemeToggle').addEventListener('change', (e) => {
  applyTheme(e.target.checked ? 'light' : 'dark');
});

// ================= Sync status dot =================
const syncDot = document.getElementById('syncDot');
function setSyncStatus(status) {
  syncDot.classList.remove('syncing', 'offline');
  if (status === 'syncing') syncDot.classList.add('syncing');
  else if (status === 'offline') syncDot.classList.add('offline');
}
window.addEventListener('online', () => setSyncStatus('synced'));
window.addEventListener('offline', () => setSyncStatus('offline'));

// ================= Reminders / notifications (local, app-open only) =================
const notifiedThisSession = new Set();
const dismissedNotifIds = new Set();

function dueTodayTasks() {
  const today = todayStr();
  return allTasks.filter(t => t.status === 'open' && t.dueDate === today && !dismissedNotifIds.has(t.id));
}
function overdueTasks() {
  return allTasks.filter(t => isOverdue(t) && !dismissedNotifIds.has(t.id));
}

function updateNotifBadge() {
  const count = dueTodayTasks().length + overdueTasks().length;
  const badge = document.getElementById('notifBadge');
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function notifCardHtml(t, subText, subClass) {
  return `
    <div class="notif-card tab-${t.tab}" data-task-id="${t.id}">
      <div class="n-main">
        <div class="n-title">${escapeHtml(t.title)} <span style="opacity:.5; font-weight:400;">(${t.activityNo})</span></div>
        <div class="n-sub ${subClass || ''}">${subText}</div>
      </div>
      <button class="notif-close" data-dismiss-id="${t.id}" title="Dismiss">&#10005;</button>
    </div>`;
}

function renderNotificationsView() {
  const todayList = document.getElementById('notifDueTodayList');
  const overdueList = document.getElementById('notifOverdueList');
  const today = dueTodayTasks();
  const overdue = overdueTasks();

  todayList.innerHTML = today.length
    ? today.map(t => notifCardHtml(t, t.dueTime ? formatTime(t.dueTime) : 'No specific time')).join('')
    : `<div class="empty-check">Nothing due today</div>`;

  overdueList.innerHTML = overdue.length
    ? overdue.map(t => notifCardHtml(t, formatDate(t.dueDate), 'overdue')).join('')
    : `<div class="empty-check">Nothing overdue &#127881;</div>`;

  document.querySelectorAll('#view-notifications [data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-dismiss-id]')) return;
      openTaskDetail(el.dataset.taskId);
    });
  });
  document.querySelectorAll('#view-notifications [data-dismiss-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissedNotifIds.add(btn.dataset.dismissId);
      renderNotificationsView();
      updateNotifBadge();
    });
  });
}

function initNotifToggle() {
  const toggle = document.getElementById('notifToggle');
  toggle.checked = localStorage.getItem('std_notify_enabled') === 'true' && Notification.permission === 'granted';
  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        localStorage.setItem('std_notify_enabled', 'true');
      } else {
        toggle.checked = false;
        localStorage.setItem('std_notify_enabled', 'false');
      }
    } else {
      localStorage.setItem('std_notify_enabled', 'false');
    }
  });
}

function checkAndFireNotifications() {
  if (localStorage.getItem('std_notify_enabled') !== 'true') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  dueTodayTasks().forEach(t => {
    if (notifiedThisSession.has(t.id)) return;
    notifiedThisSession.add(t.id);
    try {
      new Notification('Due today: ' + t.title, {
        body: t.dueTime ? `At ${formatTime(t.dueTime)}` : 'No specific time set',
        icon: 'icon-192.png'
      });
    } catch (e) { /* Notification constructor unsupported in some mobile browsers */ }
  });
}
setInterval(checkAndFireNotifications, 5 * 60 * 1000);

// ================= PIN lock (global, 6-digit) =================
const PIN_LEN = 6;
const lockscreen = document.getElementById('lockscreen');
const pinDots = document.getElementById('pinDots');
const lockTitle = document.getElementById('lockTitle');
const lockError = document.getElementById('lockError');
let lockMode = 'loading';
let enteredDigits = '';
let firstSetupPin = '';
let globalPinHash = null;

function renderPinDots(container, count) {
  container.querySelectorAll('.pin-dot').forEach((dot, i) => dot.classList.toggle('filled', i < count));
}
function shakeDots(container) {
  container.classList.add('shake');
  setTimeout(() => container.classList.remove('shake'), 350);
}
function resetPinEntry() {
  enteredDigits = '';
  lockError.textContent = '';
  renderPinDots(pinDots, 0);
}

async function startLockFlow() {
  lockMode = 'loading';
  lockTitle.textContent = 'Loading...';
  lockError.textContent = '';
  document.getElementById('lockRetryBtn').style.display = 'none';
  resetPinEntry();
  lockscreen.classList.remove('hidden');

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  let sec;
  try {
    sec = await withTimeout(getSecurityDoc(), 10000);
  } catch (err) {
    lockTitle.textContent = 'Connection error';
    lockError.textContent = "Couldn't reach the server — check your internet connection.";
    document.getElementById('lockRetryBtn').style.display = 'inline-block';
    return;
  }
  globalPinHash = sec ? sec.pinHash : null;
  const lastUnlock = localStorage.getItem('std_last_unlock_date');

  if (!globalPinHash) {
    lockMode = 'setup1';
    lockTitle.textContent = 'Set a shared PIN (6 digits)';
    resetPinEntry();
    return;
  }
  if (lastUnlock === todayStr()) {
    lockscreen.classList.add('hidden');
    return;
  }
  lockMode = 'verify';
  lockTitle.textContent = 'Enter PIN';
  resetPinEntry();
}
document.getElementById('lockRetryBtn').addEventListener('click', () => startLockFlow());

function handleLockKey(k) {
  if (lockMode === 'loading') return;
  if (k === 'del') {
    enteredDigits = enteredDigits.slice(0, -1);
    renderPinDots(pinDots, enteredDigits.length);
    return;
  }
  if (enteredDigits.length >= PIN_LEN) return;
  enteredDigits += k;
  renderPinDots(pinDots, enteredDigits.length);
  if (enteredDigits.length === PIN_LEN) handlePinComplete();
}

document.getElementById('keypad').addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn || btn.classList.contains('empty')) return;
  handleLockKey(btn.dataset.k);
});

async function handlePinComplete() {
  if (lockMode === 'setup1') {
    firstSetupPin = enteredDigits;
    lockMode = 'setup2';
    lockTitle.textContent = 'Confirm PIN';
    enteredDigits = '';
    setTimeout(() => renderPinDots(pinDots, 0), 150);
    return;
  }
  if (lockMode === 'setup2') {
    if (enteredDigits === firstSetupPin) {
      const hash = simpleHash(enteredDigits);
      try {
        await setGlobalPinHash(hash);
        globalPinHash = hash;
        localStorage.setItem('std_last_unlock_date', todayStr());
        lockscreen.classList.add('hidden');
      } catch (err) {
        lockError.textContent = 'Could not save PIN — check connection.';
        shakeDots(pinDots);
      }
    } else {
      lockError.textContent = "PINs didn't match — try again";
      shakeDots(pinDots);
      lockMode = 'setup1';
      lockTitle.textContent = 'Set a shared PIN (6 digits)';
      enteredDigits = '';
      setTimeout(() => renderPinDots(pinDots, 0), 350);
    }
    return;
  }
  if (simpleHash(enteredDigits) === globalPinHash) {
    localStorage.setItem('std_last_unlock_date', todayStr());
    lockscreen.classList.add('hidden');
  } else {
    lockError.textContent = 'Incorrect PIN';
    shakeDots(pinDots);
    enteredDigits = '';
    setTimeout(() => renderPinDots(pinDots, 0), 350);
  }
}

// ---- Change PIN modal: verify old PIN -> new PIN -> confirm (all 6-digit) ----
const changePinModal = document.getElementById('changePinModal');
const newPinDots = document.getElementById('newPinDots');
const changePinError = document.getElementById('changePinError');
const changePinHeading = document.getElementById('changePinHeading');
let changePinStage = 'old'; // 'old' | 'first' | 'confirm'
let changePinFirst = '';
let changePinDigits = '';

function resetChangePinFlow() {
  changePinStage = 'old';
  changePinDigits = '';
  changePinFirst = '';
  changePinError.textContent = '';
  changePinHeading.textContent = 'Enter current PIN';
  renderPinDots(newPinDots, 0);
}

document.getElementById('changePinLink').addEventListener('click', () => {
  resetChangePinFlow();
  changePinModal.classList.remove('hidden');
});
document.getElementById('cancelChangePin').addEventListener('click', () => changePinModal.classList.add('hidden'));

async function handleChangeKey(k) {
  if (k === 'del') {
    changePinDigits = changePinDigits.slice(0, -1);
    renderPinDots(newPinDots, changePinDigits.length);
    return;
  }
  if (changePinDigits.length >= PIN_LEN) return;
  changePinDigits += k;
  renderPinDots(newPinDots, changePinDigits.length);
  if (changePinDigits.length !== PIN_LEN) return;

  if (changePinStage === 'old') {
    if (simpleHash(changePinDigits) === globalPinHash) {
      changePinStage = 'first';
      changePinHeading.textContent = 'Enter new PIN';
      changePinDigits = '';
      setTimeout(() => renderPinDots(newPinDots, 0), 150);
    } else {
      changePinError.textContent = 'Incorrect current PIN';
      shakeDots(newPinDots);
      changePinDigits = '';
      setTimeout(() => renderPinDots(newPinDots, 0), 350);
    }
    return;
  }
  if (changePinStage === 'first') {
    changePinFirst = changePinDigits;
    changePinStage = 'confirm';
    changePinHeading.textContent = 'Confirm new PIN';
    changePinDigits = '';
    setTimeout(() => renderPinDots(newPinDots, 0), 150);
    return;
  }
  // confirm
  if (changePinDigits === changePinFirst) {
    const hash = simpleHash(changePinDigits);
    try {
      await setGlobalPinHash(hash);
      globalPinHash = hash;
      changePinModal.classList.add('hidden');
    } catch (err) {
      changePinError.textContent = 'Could not save — check connection.';
      shakeDots(newPinDots);
    }
  } else {
    changePinError.textContent = "PINs didn't match — try again";
    shakeDots(newPinDots);
    changePinStage = 'first';
    changePinHeading.textContent = 'Enter new PIN';
    changePinDigits = '';
    setTimeout(() => renderPinDots(newPinDots, 0), 350);
  }
}

document.getElementById('changeKeypad').addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn || btn.classList.contains('empty')) return;
  handleChangeKey(btn.dataset.k);
});

// ---- Keyboard support (desktop): digits 0-9 and Backspace for whichever PIN entry is on screen ----
document.addEventListener('keydown', (e) => {
  const isDigit = /^[0-9]$/.test(e.key);
  const isBackspace = e.key === 'Backspace';
  if (!isDigit && !isBackspace) return;
  const k = isBackspace ? 'del' : e.key;

  if (!changePinModal.classList.contains('hidden')) {
    e.preventDefault();
    handleChangeKey(k);
    return;
  }
  if (!lockscreen.classList.contains('hidden')) {
    e.preventDefault();
    handleLockKey(k);
  }
});

// ================= Navigation =================
const viewTitleEl = document.getElementById('viewTitle');
const appEl = document.getElementById('app');
const backBtn = document.getElementById('backBtn');
const SUB_VIEWS = ['taskDetail', 'settings', 'calendar', 'search', 'creatorsEditor', 'notifications'];
const FIXED_LABELS = { home: 'Std', settings: 'Settings', calendar: 'Calendar', search: 'Search', creatorsEditor: 'Task creators', notifications: 'Notifications' };

function labelFor(name) {
  if (['simple', 'medium', 'heavy'].includes(name)) return tabLabels[name] || capitalize(name);
  return FIXED_LABELS[name] || 'Std';
}

function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');

  if (SUB_VIEWS.includes(name)) {
    backBtn.style.visibility = 'visible';
    viewTitleEl.textContent = name === 'taskDetail' ? 'Task' : labelFor(name);
    currentTab = name;
  } else {
    const navBtn = document.querySelector(`.navbtn[data-nav="${name}"]`);
    if (navBtn) navBtn.classList.add('active');
    backBtn.style.visibility = 'hidden';
    viewTitleEl.textContent = labelFor(name);
    currentTab = name;
    previousTabView = name;
  }

  appEl.className = 'tab-' + (name === 'taskDetail' ? (currentTaskFallbackTab() || 'home') : name);

  if (name === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(name)) renderTabList(name);
  if (name === 'calendar') renderCalendar();
  if (name === 'settings') populateSettingsFields();
  if (name === 'creatorsEditor') openCreatorsEditor();
  if (name === 'notifications') renderNotificationsView();
  if (name === 'search') document.getElementById('searchInput').focus();
}

function currentTaskFallbackTab() {
  const t = allTasks.find(t => t.id === currentTaskId);
  return t ? t.tab : previousTabView;
}

function navigateWithSlide(name) {
  const fromIdx = MAIN_TABS_ORDER.indexOf(currentTab);
  const toIdx = MAIN_TABS_ORDER.indexOf(name);
  goToView(name);
  if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
    const viewEl = document.getElementById('view-' + name);
    const cls = toIdx > fromIdx ? 'enter-from-right' : 'enter-from-left';
    viewEl.classList.remove('enter-from-right', 'enter-from-left');
    void viewEl.offsetWidth; // restart animation even if same class as before
    viewEl.classList.add(cls);
  }
}

document.querySelectorAll('.navbtn').forEach(btn => btn.addEventListener('click', () => navigateWithSlide(btn.dataset.nav)));
backBtn.addEventListener('click', () => goToView(previousTabView));
document.querySelectorAll('[data-goto-tab]').forEach(el => el.addEventListener('click', () => navigateWithSlide(el.dataset.gotoTab)));

document.getElementById('calendarBtn').addEventListener('click', () => {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  goToView('calendar');
});
document.getElementById('settingsBtn').addEventListener('click', () => goToView('settings'));
document.getElementById('notifBtn').addEventListener('click', () => goToView('notifications'));
document.getElementById('searchBtn').addEventListener('click', () => goToView('search'));

// ---- Swipe navigation between Home/Simple/Medium/Heavy ----
(function setupSwipe() {
  const el = document.getElementById('views');
  let startX = 0, startY = 0, tracking = false;
  el.addEventListener('touchstart', (e) => {
    if (!MAIN_TABS_ORDER.includes(currentTab)) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = MAIN_TABS_ORDER.indexOf(currentTab);
    if (dx < 0 && idx < MAIN_TABS_ORDER.length - 1) navigateWithSlide(MAIN_TABS_ORDER[idx + 1]);
    else if (dx > 0 && idx > 0) navigateWithSlide(MAIN_TABS_ORDER[idx - 1]);
  }, { passive: true });
})();

// ================= Creator chips (add/edit task) =================
function renderCreatorChips(container, selected, onSelect) {
  container.innerHTML = creatorNames.map(name =>
    `<button type="button" class="chip ${name === selected ? 'selected' : ''}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
  ).join('');
  container.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => onSelect(chip.dataset.name)));
}

// ================= Settings =================
function populateSettingsFields() {
  document.getElementById('creatorsSummary').textContent = creatorNames.join(', ');
  document.getElementById('tabLabelSimpleInput').value = tabLabels.simple;
  document.getElementById('tabLabelMediumInput').value = tabLabels.medium;
  document.getElementById('tabLabelHeavyInput').value = tabLabels.heavy;
}

document.getElementById('creatorsSummaryLink').addEventListener('click', () => goToView('creatorsEditor'));

document.getElementById('saveTabLabelsBtn').addEventListener('click', async () => {
  const simple = document.getElementById('tabLabelSimpleInput').value.trim() || 'Simple';
  const medium = document.getElementById('tabLabelMediumInput').value.trim() || 'Medium';
  const heavy = document.getElementById('tabLabelHeavyInput').value.trim() || 'Heavy';
  await setTabLabels({ simple, medium, heavy });
  flashSaved('tabLabelsSavedMsg');
});

function flashSaved(elId) {
  const el = document.getElementById(elId);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}

function applyTabLabelsToUI() {
  document.getElementById('simpleLabelSpan').textContent = tabLabels.simple;
  document.getElementById('mediumLabelSpan').textContent = tabLabels.medium;
  document.getElementById('heavyLabelSpan').textContent = tabLabels.heavy;
  document.getElementById('navLabel-simple').textContent = tabLabels.simple;
  document.getElementById('navLabel-medium').textContent = tabLabels.medium;
  document.getElementById('navLabel-heavy').textContent = tabLabels.heavy;
  document.getElementById('editGroupOptionSimple').textContent = tabLabels.simple;
  document.getElementById('editGroupOptionMedium').textContent = tabLabels.medium;
  document.getElementById('editGroupOptionHeavy').textContent = tabLabels.heavy;
  if (['simple', 'medium', 'heavy'].includes(currentTab)) viewTitleEl.textContent = labelFor(currentTab);
}

// ---- Creators editor (expandable list, reorder via arrows, +add) ----
function renderCreatorsEditorList() {
  const container = document.getElementById('creatorsEditorList');
  container.innerHTML = editingCreatorNames.map((name, i) => `
    <div class="creator-row" data-index="${i}">
      <input type="text" value="${escapeHtml(name)}" data-index="${i}">
      <button class="mini-btn" data-move="up" data-index="${i}" ${i === 0 ? 'disabled' : ''}>&#8593;</button>
      <button class="mini-btn" data-move="down" data-index="${i}" ${i === editingCreatorNames.length - 1 ? 'disabled' : ''}>&#8595;</button>
      <button class="mini-btn remove" data-remove="${i}" ${editingCreatorNames.length <= 1 ? 'disabled' : ''}>&#10005;</button>
    </div>`).join('');

  container.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => { editingCreatorNames[Number(inp.dataset.index)] = inp.value; });
  });
  container.querySelectorAll('[data-move]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.index);
      const j = btn.dataset.move === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= editingCreatorNames.length) return;
      [editingCreatorNames[i], editingCreatorNames[j]] = [editingCreatorNames[j], editingCreatorNames[i]];
      renderCreatorsEditorList();
    });
  });
  container.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (editingCreatorNames.length <= 1) return;
      editingCreatorNames.splice(Number(btn.dataset.remove), 1);
      renderCreatorsEditorList();
    });
  });
}

function openCreatorsEditor() {
  editingCreatorNames = [...creatorNames];
  document.getElementById('creatorsSavedMsg').classList.remove('show');
  renderCreatorsEditorList();
}

document.getElementById('addCreatorRowBtn').addEventListener('click', () => {
  editingCreatorNames.push('');
  renderCreatorsEditorList();
});

document.getElementById('saveCreatorsBtn').addEventListener('click', async () => {
  const cleaned = editingCreatorNames.map(n => n.trim()).filter(n => n.length > 0);
  if (!cleaned.length) return;
  await setCreatorNames(cleaned);
  flashSaved('creatorsSavedMsg');
});

// ================= Rendering: tab lists =================
function assignDateGroups(sortedTasks) {
  // Alternates a color class each time the due date changes, so tasks sharing
  // a date share a color and the next distinct date flips to the other color.
  const groups = new Map();
  let lastDate = undefined;
  let toggle = 1;
  sortedTasks.forEach(t => {
    if (t.dueDate !== lastDate) { toggle = 1 - toggle; lastDate = t.dueDate; }
    groups.set(t.id, toggle === 0 ? 'date-a' : 'date-b');
  });
  return groups;
}

function renderTabList(tab) {
  const container = document.getElementById('list-' + tab);
  const tasks = allTasks.filter(t => t.tab === tab);
  const open = tasks.filter(t => t.status === 'open').sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
  const completed = tasks.filter(t => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const dateGroups = assignDateGroups(open);

  let html = `<div class="group-header">Open (${open.length})</div>`;
  html += open.length ? open.map(t => taskCardHtml(t, dateGroups.get(t.id))).join('') : `<div class="empty-state">No open tasks</div>`;
  html += `<div class="group-header" data-toggle-completed="${tab}">Completed (${completed.length}) <span>${completedCollapsed[tab] ? '&#9656;' : '&#9662;'}</span></div>`;
  if (!completedCollapsed[tab]) {
    html += completed.length ? completed.map(t => taskCardHtml(t)).join('') : `<div class="empty-state">Nothing completed yet</div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => { if (!e.target.closest('.tick-btn')) openTaskDetail(el.dataset.taskId); });
  });
  container.querySelectorAll('.tick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.closest('[data-task-id]').dataset.taskId;
      const task = allTasks.find(t => t.id === id);
      setTaskStatus(id, task.status === 'open' ? 'completed' : 'open');
    });
  });
  const toggleHeader = container.querySelector('[data-toggle-completed]');
  if (toggleHeader) toggleHeader.addEventListener('click', () => { completedCollapsed[tab] = !completedCollapsed[tab]; renderTabList(tab); });
}

function taskCardHtml(t, dateGroupClass) {
  const overdueClass = isOverdue(t) ? 'overdue' : '';
  const completedClass = t.status === 'completed' ? 'completed' : '';
  const byTag = t.createdBy ? ` &middot; ${escapeHtml(t.createdBy)}` : '';
  const timeTag = t.dueTime ? `, ${formatTime(t.dueTime)}` : '';
  const locHtml = t.location ? `<div class="task-card-loc">&#128205; ${escapeHtml(t.location)}</div>` : '';
  return `
    <div class="task-card ${completedClass} ${dateGroupClass || ''}" data-task-id="${t.id}">
      <div class="task-card-main">
        <div class="task-card-no">${t.activityNo}${byTag}</div>
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        <div class="task-card-due ${overdueClass}">${formatDate(t.dueDate)}${timeTag}</div>
        ${locHtml}
      </div>
      <button class="tick-btn ${t.status === 'completed' ? 'done' : ''}">&#10003;</button>
    </div>`;
}

// ================= Rendering: home dashboard =================
function renderHome() {
  const open = allTasks.filter(t => t.status === 'open');
  const completed = allTasks.filter(t => t.status === 'completed');
  const overdue = open.filter(isOverdue);

  document.getElementById('homeOpenCount').textContent = open.length;
  document.getElementById('homeCompletedCount').textContent = completed.length;
  document.getElementById('homeOverdueCount').textContent = overdue.length;

  const totals = ['simple', 'medium', 'heavy'].map(tab => allTasks.filter(t => t.tab === tab).length);
  const maxTotal = Math.max(1, ...totals);

  ['simple', 'medium', 'heavy'].forEach(tab => {
    const tabTasks = allTasks.filter(t => t.tab === tab);
    const tabCompleted = tabTasks.filter(t => t.status === 'completed').length;
    document.getElementById(tab + 'Counts').textContent = `${tabCompleted}/${tabTasks.length}`;
    document.getElementById(tab + 'TotalBar').style.width = ((tabTasks.length / maxTotal) * 100) + '%';
    document.getElementById(tab + 'CompletedBar').style.width = ((tabCompleted / maxTotal) * 100) + '%';
  });

  const overallPct = allTasks.length ? Math.round((completed.length / allTasks.length) * 100) : 0;
  document.getElementById('overallPct').textContent = overallPct + '%';
  document.getElementById('overallBar').style.width = overallPct + '%';

  const overdueList = document.getElementById('homeOverdueList');
  const sortedOverdue = overdue.sort((a, b) => a.dueDate < b.dueDate ? -1 : 1);
  overdueList.innerHTML = sortedOverdue.length ? sortedOverdue.map(t => `
      <div class="overdue-row tab-${t.tab}" data-task-id="${t.id}">
        <div class="t">${escapeHtml(t.title)} <span style="opacity:.5; font-weight:400;">(${t.activityNo})</span></div>
        <div class="d">${formatDate(t.dueDate)}</div>
      </div>`).join('') : `<div class="empty-check">Nothing overdue &#127881;</div>`;
  overdueList.querySelectorAll('[data-task-id]').forEach(el => el.addEventListener('click', () => openTaskDetail(el.dataset.taskId)));
}

// ================= Search =================
document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = `<div class="empty-state">Type to search across all tasks</div>`; return; }
  const matches = allTasks.filter(t => t.title.toLowerCase().includes(q));
  results.innerHTML = matches.length ? matches.map(t => `
    <div class="task-card" data-task-id="${t.id}" style="background:var(--surface); border:1px solid var(--border); color:var(--text);">
      <div class="task-card-main">
        <div class="task-card-no">${t.activityNo} &middot; ${labelFor(t.tab)}</div>
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        <div class="task-card-due">${formatDate(t.dueDate)}</div>
      </div>
    </div>`).join('') : `<div class="empty-state">No matching tasks</div>`;
  results.querySelectorAll('[data-task-id]').forEach(el => el.addEventListener('click', () => openTaskDetail(el.dataset.taskId)));
});

// ================= Calendar =================
function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const grid = document.getElementById('calGrid');
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const todayS = todayStr();

  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayTasks = allTasks.filter(t => t.dueDate === dateStr);
    const tabsPresent = [...new Set(dayTasks.map(t => t.tab))];
    const dots = tabsPresent.map(tab => `<span class="dot ${tab}"></span>`).join('');
    html += `<div class="cal-day ${dateStr === todayS ? 'today' : ''}" data-date="${dateStr}"><div>${d}</div><div class="dots">${dots}</div></div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.cal-day[data-date]').forEach(cell => {
    cell.addEventListener('click', () => openDayTasksModal(cell.dataset.date, allTasks.filter(t => t.dueDate === cell.dataset.date)));
  });
}

function openDayTasksModal(dateStr, tasks) {
  document.getElementById('dayTasksTitle').textContent = formatDate(dateStr);
  const list = document.getElementById('dayTasksList');
  list.innerHTML = tasks.length ? tasks.map(t => `
    <div class="task-card" data-task-id="${t.id}" style="background:var(--surface-2); color:var(--text);">
      <div class="task-card-main">
        <div class="task-card-no">${t.activityNo} &middot; ${labelFor(t.tab)}</div>
        <div class="task-card-title">${escapeHtml(t.title)}</div>
      </div>
    </div>`).join('') : `<div class="empty-state">No tasks due this day</div>`;
  list.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => { document.getElementById('dayTasksModal').classList.add('hidden'); openTaskDetail(el.dataset.taskId); });
  });
  document.getElementById('dayTasksModal').classList.remove('hidden');
}

document.getElementById('calPrevBtn').addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
document.getElementById('calNextBtn').addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
document.getElementById('closeDayTasks').addEventListener('click', () => document.getElementById('dayTasksModal').classList.add('hidden'));

// ================= Task detail =================
function openTaskDetail(id) {
  currentTaskId = id;
  const t = allTasks.find(t => t.id === id);
  if (!t) return;

  document.getElementById('taskDetailNo').textContent = t.activityNo;
  document.getElementById('taskDetailTitle').textContent = t.title;
  document.getElementById('viewDueDate').textContent = formatDate(t.dueDate);
  document.getElementById('viewDueTime').textContent = formatTime(t.dueTime);
  document.getElementById('viewLocation').textContent = t.location || '\u2014';
  document.getElementById('viewGroup').textContent = labelFor(t.tab);
  document.getElementById('viewCreatedBy').textContent = t.createdBy || '\u2014';

  let statusHtml = t.status === 'completed' ? '<span class="status-badge completed">Completed</span>'
    : isOverdue(t) ? '<span class="status-badge overdue">Overdue</span>'
    : '<span class="status-badge open">Open</span>';
  document.getElementById('viewStatus').innerHTML = statusHtml;

  document.getElementById('toggleCompleteBtn').textContent = t.status === 'completed' ? 'Reopen task' : 'Mark complete';
  renderNotes(t);
  goToView('taskDetail');
}

function renderNotes(t) {
  const list = document.getElementById('taskNotesList');
  const notes = [...(t.notes || [])].sort((a, b) => b.ts - a.ts);
  list.innerHTML = notes.length ? notes.map(n => `
    <div class="note-entry" data-ts="${n.ts}">
      <div class="note-top">
        <div>
          <div class="ts">${formatTs(n.ts)}</div>
          <div class="txt" data-view>${escapeHtml(n.text)}</div>
        </div>
        <button class="note-edit-btn" data-edit-ts="${n.ts}">Edit</button>
      </div>
      <div class="note-edit-row" style="display:none;">
        <input type="text" value="${escapeHtml(n.text)}">
        <button class="note-add-btn" data-save-ts="${n.ts}">Save</button>
      </div>
    </div>`).join('') : `<div class="empty-state">No notes yet</div>`;

  list.querySelectorAll('[data-edit-ts]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = btn.closest('.note-entry');
      entry.querySelector('[data-view]').parentElement.parentElement.style.display = 'none';
      entry.querySelector('.note-edit-row').style.display = 'flex';
    });
  });
  list.querySelectorAll('[data-save-ts]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ts = Number(btn.dataset.saveTs);
      const entry = btn.closest('.note-entry');
      const newText = entry.querySelector('.note-edit-row input').value.trim();
      if (!newText) return;
      const task = allTasks.find(t => t.id === currentTaskId);
      const updatedNotes = (task.notes || []).map(n => n.ts === ts ? { ...n, text: newText } : n);
      await replaceTaskNotes(currentTaskId, updatedNotes);
    });
  });
}

document.getElementById('addNoteBtn').addEventListener('click', async () => {
  const input = document.getElementById('newNoteInput');
  const text = input.value.trim();
  if (!text) return;
  await addNoteToTask(currentTaskId, text);
  input.value = '';
});

document.getElementById('toggleCompleteBtn').addEventListener('click', async () => {
  const t = allTasks.find(t => t.id === currentTaskId);
  await setTaskStatus(currentTaskId, t.status === 'open' ? 'completed' : 'open');
});

// ================= Edit Task modal =================
const editTaskModal = document.getElementById('editTaskModal');
function selectEditCreator(name) {
  editSelectedCreator = (editSelectedCreator === name) ? null : name;
  renderCreatorChips(document.getElementById('editCreatorChips'), editSelectedCreator, selectEditCreator);
}
document.getElementById('openEditBtn').addEventListener('click', () => {
  const t = allTasks.find(t => t.id === currentTaskId);
  if (!t) return;
  document.getElementById('editTitleInput').value = t.title;
  document.getElementById('editDueInput').value = t.dueDate || '';
  document.getElementById('editTimeInput').value = t.dueTime || '';
  document.getElementById('editLocationInput').value = t.location || '';
  document.getElementById('editGroupInput').value = t.tab;
  editSelectedCreator = t.createdBy || null;
  renderCreatorChips(document.getElementById('editCreatorChips'), editSelectedCreator, selectEditCreator);
  editTaskModal.classList.remove('hidden');
});
document.getElementById('cancelEditTask').addEventListener('click', () => editTaskModal.classList.add('hidden'));
document.getElementById('saveEditTask').addEventListener('click', async () => {
  const title = document.getElementById('editTitleInput').value.trim();
  const dueDate = document.getElementById('editDueInput').value || null;
  const dueTime = document.getElementById('editTimeInput').value || null;
  const location = document.getElementById('editLocationInput').value.trim() || null;
  const tab = document.getElementById('editGroupInput').value;
  if (!title) return;
  await updateTask(currentTaskId, { title, dueDate, dueTime, location, tab, createdBy: editSelectedCreator });
  editTaskModal.classList.add('hidden');
});
document.getElementById('deleteTaskBtn').addEventListener('click', async () => {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  await deleteTask(currentTaskId);
  editTaskModal.classList.add('hidden');
  goToView(previousTabView);
});

// ================= Add task modal =================
const addTaskModal = document.getElementById('addTaskModal');
let addTaskTab = 'simple';
function selectAddTaskCreator(name) {
  addTaskSelectedCreator = (addTaskSelectedCreator === name) ? null : name;
  renderCreatorChips(document.getElementById('addTaskCreatorChips'), addTaskSelectedCreator, selectAddTaskCreator);
}
function updateAddTaskGroupPill() {
  const pill = document.getElementById('addTaskGroupPill');
  pill.textContent = tabLabels[addTaskTab];
  pill.className = 'group-pill ' + addTaskTab;
}

function openAddTaskModal(tab) {
  addTaskTab = tab;
  document.getElementById('addTaskTitleInput').value = '';
  document.getElementById('addTaskDueInput').value = todayStr();
  document.getElementById('addTaskTimeInput').value = '';
  document.getElementById('addTaskLocationInput').value = '';
  document.getElementById('addTaskError').textContent = '';
  addTaskSelectedCreator = null;
  renderCreatorChips(document.getElementById('addTaskCreatorChips'), addTaskSelectedCreator, selectAddTaskCreator);
  updateAddTaskGroupPill();
  addTaskModal.classList.remove('hidden');
}

document.getElementById('addTaskGroupPill').addEventListener('click', () => {
  const order = ['simple', 'medium', 'heavy'];
  addTaskTab = order[(order.indexOf(addTaskTab) + 1) % order.length];
  updateAddTaskGroupPill();
});

document.querySelectorAll('[data-add-task]').forEach(btn => {
  btn.addEventListener('click', () => openAddTaskModal(btn.dataset.addTask));
});

document.getElementById('quickAddBtn').addEventListener('click', () => {
  const targetTab = ['simple', 'medium', 'heavy'].includes(currentTab) ? currentTab
    : (['simple', 'medium', 'heavy'].includes(previousTabView) ? previousTabView : 'simple');
  openAddTaskModal(targetTab);
});
document.getElementById('cancelAddTask').addEventListener('click', () => addTaskModal.classList.add('hidden'));
document.getElementById('saveAddTask').addEventListener('click', async () => {
  const title = document.getElementById('addTaskTitleInput').value.trim();
  const dueDate = document.getElementById('addTaskDueInput').value || null;
  const dueTime = document.getElementById('addTaskTimeInput').value || null;
  const location = document.getElementById('addTaskLocationInput').value.trim() || null;
  if (!title) { document.getElementById('addTaskError').textContent = 'Enter a title'; return; }
  await addTask({ tab: addTaskTab, title, dueDate, dueTime, location, createdBy: addTaskSelectedCreator });
  addTaskModal.classList.add('hidden');
});

// ================= Auth + Firestore live sync =================
function refreshCurrentView() {
  if (currentTab === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(currentTab)) renderTabList(currentTab);
  if (currentTab === 'calendar') renderCalendar();
  if (currentTab === 'notifications') renderNotificationsView();
  if (currentTab === 'search') document.getElementById('searchInput').dispatchEvent(new Event('input'));
  if (currentTab === 'taskDetail' && currentTaskId) {
    const t = allTasks.find(t => t.id === currentTaskId);
    if (t) {
      document.getElementById('toggleCompleteBtn').textContent = t.status === 'completed' ? 'Reopen task' : 'Mark complete';
      renderNotes(t);
    }
  }
  updateNotifBadge();
  checkAndFireNotifications();
}

let unsubscribeTasks = null;
let unsubscribeSettings = null;
firebase.auth().onAuthStateChanged((user) => {
  if (user && !unsubscribeTasks) {
    unsubscribeTasks = listenToTasks((tasks, metadata) => {
      allTasks = tasks;
      refreshCurrentView();
      if (!navigator.onLine) setSyncStatus('offline');
      else if (metadata && metadata.hasPendingWrites) setSyncStatus('syncing');
      else setSyncStatus('synced');
    });
    unsubscribeSettings = listenToAppSettings((data) => {
      creatorNames = (data && Array.isArray(data.createdByNames) && data.createdByNames.length > 0)
        ? data.createdByNames : ['Name 1', 'Name 2', 'Name 3'];
      tabLabels = (data && data.tabLabels) ? { simple: data.tabLabels.simple || 'Simple', medium: data.tabLabels.medium || 'Medium', heavy: data.tabLabels.heavy || 'Heavy' } : { simple: 'Simple', medium: 'Medium', heavy: 'Heavy' };
      applyTabLabelsToUI();
      if (currentTab === 'settings') populateSettingsFields();
    });
    startLockFlow();
  }
});

// ================= Install prompt (Chrome/Edge) =================
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('installCard').style.display = 'block';
});
document.getElementById('installAppBtn').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('installCard').style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('installCard').style.display = 'none';
});

// ================= Init =================
initTheme();
initNotifToggle();
lockscreen.classList.remove('hidden');
goToView('home');
