// ================= State =================
let allTasks = [];
let currentTab = 'home';      // home | simple | medium | heavy | settings | taskDetail
let previousTabView = 'home'; // where "back" from task detail returns to
let currentTaskId = null;
let completedCollapsed = { simple: false, medium: false, heavy: false };

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

function formatTs(ts) {
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function isOverdue(task) {
  return task.status === 'open' && task.dueDate && task.dueDate < todayStr();
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

// ================= Theme =================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('std_theme', theme);
  document.getElementById('lightThemeToggle').checked = theme === 'light';
  document.getElementById('themeToggleBtn').innerHTML = theme === 'light' ? '&#9790;' : '&#9788;';
}

function initTheme() {
  const saved = localStorage.getItem('std_theme') || 'dark';
  applyTheme(saved);
}

document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'light' ? 'dark' : 'light');
});

document.getElementById('lightThemeToggle').addEventListener('change', (e) => {
  applyTheme(e.target.checked ? 'light' : 'dark');
});

// ================= PIN lock =================
const lockscreen = document.getElementById('lockscreen');
const pinDots = document.getElementById('pinDots');
const lockTitle = document.getElementById('lockTitle');
const lockError = document.getElementById('lockError');
let lockMode = 'verify'; // 'setup1' | 'setup2' | 'verify'
let enteredDigits = '';
let firstSetupPin = '';

function renderPinDots(container, count) {
  const dots = container.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < count));
}

function shakeDots(container) {
  container.classList.add('shake');
  setTimeout(() => container.classList.remove('shake'), 350);
}

function startLockFlow() {
  const storedHash = localStorage.getItem('std_pin_hash');
  const lastUnlock = localStorage.getItem('std_last_unlock_date');

  if (!storedHash) {
    lockMode = 'setup1';
    lockTitle.textContent = 'Set a PIN';
    showLockscreen();
    return;
  }
  if (lastUnlock === todayStr()) {
    hideLockscreen();
    return;
  }
  lockMode = 'verify';
  lockTitle.textContent = 'Enter PIN';
  showLockscreen();
}

function showLockscreen() {
  enteredDigits = '';
  lockError.textContent = '';
  renderPinDots(pinDots, 0);
  lockscreen.classList.remove('hidden');
}

function hideLockscreen() {
  lockscreen.classList.add('hidden');
}

document.getElementById('keypad').addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn || btn.classList.contains('empty')) return;
  const k = btn.dataset.k;

  if (k === 'del') {
    enteredDigits = enteredDigits.slice(0, -1);
    renderPinDots(pinDots, enteredDigits.length);
    return;
  }
  if (enteredDigits.length >= 4) return;
  enteredDigits += k;
  renderPinDots(pinDots, enteredDigits.length);

  if (enteredDigits.length === 4) {
    handlePinComplete();
  }
});

function handlePinComplete() {
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
      localStorage.setItem('std_pin_hash', simpleHash(enteredDigits));
      localStorage.setItem('std_last_unlock_date', todayStr());
      hideLockscreen();
    } else {
      lockError.textContent = "PINs didn't match — try again";
      shakeDots(pinDots);
      lockMode = 'setup1';
      lockTitle.textContent = 'Set a PIN';
      enteredDigits = '';
      setTimeout(() => renderPinDots(pinDots, 0), 350);
    }
    return;
  }
  // verify
  if (simpleHash(enteredDigits) === localStorage.getItem('std_pin_hash')) {
    localStorage.setItem('std_last_unlock_date', todayStr());
    hideLockscreen();
  } else {
    lockError.textContent = 'Incorrect PIN';
    shakeDots(pinDots);
    enteredDigits = '';
    setTimeout(() => renderPinDots(pinDots, 0), 350);
  }
}

// ---- Change PIN modal ----
const changePinModal = document.getElementById('changePinModal');
const newPinDots = document.getElementById('newPinDots');
const changePinError = document.getElementById('changePinError');
let changePinStage = 'first';
let changePinFirst = '';
let changePinDigits = '';

document.getElementById('changePinLink').addEventListener('click', () => {
  changePinStage = 'first';
  changePinDigits = '';
  changePinFirst = '';
  changePinError.textContent = '';
  renderPinDots(newPinDots, 0);
  changePinModal.classList.remove('hidden');
});
document.getElementById('cancelChangePin').addEventListener('click', () => {
  changePinModal.classList.add('hidden');
});
document.getElementById('changeKeypad').addEventListener('click', (e) => {
  const btn = e.target.closest('.key');
  if (!btn || btn.classList.contains('empty')) return;
  const k = btn.dataset.k;
  if (k === 'del') {
    changePinDigits = changePinDigits.slice(0, -1);
    renderPinDots(newPinDots, changePinDigits.length);
    return;
  }
  if (changePinDigits.length >= 4) return;
  changePinDigits += k;
  renderPinDots(newPinDots, changePinDigits.length);
  if (changePinDigits.length === 4) {
    if (changePinStage === 'first') {
      changePinFirst = changePinDigits;
      changePinStage = 'confirm';
      changePinDigits = '';
      setTimeout(() => renderPinDots(newPinDots, 0), 150);
    } else {
      if (changePinDigits === changePinFirst) {
        localStorage.setItem('std_pin_hash', simpleHash(changePinDigits));
        changePinModal.classList.add('hidden');
      } else {
        changePinError.textContent = "PINs didn't match — try again";
        shakeDots(newPinDots);
        changePinStage = 'first';
        changePinDigits = '';
        setTimeout(() => renderPinDots(newPinDots, 0), 350);
      }
    }
  }
});

// ================= Navigation =================
const viewTitleEl = document.getElementById('viewTitle');
const appEl = document.getElementById('app');
const backBtn = document.getElementById('backBtn');

const TAB_LABELS = { home: 'Std', simple: 'Simple', medium: 'Medium', heavy: 'Heavy', settings: 'Settings' };

function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));

  if (name === 'taskDetail') {
    document.getElementById('view-taskDetail').classList.add('active');
    backBtn.style.visibility = 'visible';
    viewTitleEl.textContent = 'Task';
  } else {
    document.getElementById('view-' + name).classList.add('active');
    const navBtn = document.querySelector(`.navbtn[data-nav="${name}"]`);
    if (navBtn) navBtn.classList.add('active');
    backBtn.style.visibility = 'hidden';
    viewTitleEl.textContent = TAB_LABELS[name] || 'Std';
    currentTab = name;
    if (['simple', 'medium', 'heavy'].includes(name)) previousTabView = name;
  }

  appEl.className = 'tab-' + (name === 'taskDetail' ? (currentTaskFallbackTab() || 'home') : name);

  if (name === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(name)) renderTabList(name);
}

function currentTaskFallbackTab() {
  const t = allTasks.find(t => t.id === currentTaskId);
  return t ? t.tab : previousTabView;
}

document.querySelectorAll('.navbtn').forEach(btn => {
  btn.addEventListener('click', () => goToView(btn.dataset.nav));
});

backBtn.addEventListener('click', () => goToView(previousTabView));

document.querySelectorAll('[data-goto-tab]').forEach(el => {
  el.addEventListener('click', () => goToView(el.dataset.gotoTab));
});

// ================= Rendering: tab lists =================
function renderTabList(tab) {
  const container = document.getElementById('list-' + tab);
  const tasks = allTasks.filter(t => t.tab === tab);
  const open = tasks.filter(t => t.status === 'open')
    .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : 1);
  const completed = tasks.filter(t => t.status === 'completed')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  let html = '';
  html += `<div class="group-header">Open (${open.length})</div>`;
  html += open.length ? open.map(t => taskCardHtml(t)).join('') : `<div class="empty-state">No open tasks</div>`;

  html += `<div class="group-header" data-toggle-completed="${tab}">Completed (${completed.length}) <span>${completedCollapsed[tab] ? '&#9656;' : '&#9662;'}</span></div>`;
  if (!completedCollapsed[tab]) {
    html += completed.length ? completed.map(t => taskCardHtml(t)).join('') : `<div class="empty-state">Nothing completed yet</div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.tick-btn')) return;
      openTaskDetail(el.dataset.taskId);
    });
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
  if (toggleHeader) {
    toggleHeader.addEventListener('click', () => {
      completedCollapsed[tab] = !completedCollapsed[tab];
      renderTabList(tab);
    });
  }
}

function taskCardHtml(t) {
  const overdueClass = isOverdue(t) ? 'overdue' : '';
  const completedClass = t.status === 'completed' ? 'completed' : '';
  const byTag = t.createdBy ? ` &middot; ${escapeHtml(t.createdBy)}` : '';
  return `
    <div class="task-card ${completedClass}" data-task-id="${t.id}">
      <div class="task-card-main">
        <div class="task-card-no">${t.activityNo}${byTag}</div>
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        <div class="task-card-due ${overdueClass}">${formatDate(t.dueDate)}</div>
      </div>
      <button class="tick-btn ${t.status === 'completed' ? 'done' : ''}">&#10003;</button>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ================= Rendering: home dashboard =================
function renderHome() {
  const open = allTasks.filter(t => t.status === 'open');
  const completed = allTasks.filter(t => t.status === 'completed');
  const overdue = open.filter(isOverdue);

  document.getElementById('homeOpenCount').textContent = open.length;
  document.getElementById('homeCompletedCount').textContent = completed.length;
  document.getElementById('homeOverdueCount').textContent = overdue.length;

  ['simple', 'medium', 'heavy'].forEach(tab => {
    const tabTasks = allTasks.filter(t => t.tab === tab);
    const tabCompleted = tabTasks.filter(t => t.status === 'completed').length;
    const pct = tabTasks.length ? Math.round((tabCompleted / tabTasks.length) * 100) : 0;
    document.getElementById(tab + 'Pct').textContent = pct + '%';
    document.getElementById(tab + 'Bar').style.width = pct + '%';
  });

  const overallPct = allTasks.length ? Math.round((completed.length / allTasks.length) * 100) : 0;
  document.getElementById('overallPct').textContent = overallPct + '%';
  document.getElementById('overallBar').style.width = overallPct + '%';

  const overdueList = document.getElementById('homeOverdueList');
  const sortedOverdue = overdue.sort((a, b) => a.dueDate < b.dueDate ? -1 : 1);
  if (!sortedOverdue.length) {
    overdueList.innerHTML = `<div class="empty-check">Nothing overdue &#127881;</div>`;
  } else {
    overdueList.innerHTML = sortedOverdue.map(t => `
      <div class="overdue-row" data-task-id="${t.id}">
        <div class="t">${escapeHtml(t.title)} <span style="opacity:.5; font-weight:400;">(${t.activityNo})</span></div>
        <div class="d">${formatDate(t.dueDate)}</div>
      </div>`).join('');
    overdueList.querySelectorAll('[data-task-id]').forEach(el => {
      el.addEventListener('click', () => openTaskDetail(el.dataset.taskId));
    });
  }
}

// ================= Task detail =================
function openTaskDetail(id) {
  currentTaskId = id;
  const t = allTasks.find(t => t.id === id);
  if (!t) return;

  document.getElementById('taskDetailNo').textContent = t.activityNo;
  document.getElementById('taskDetailTitle').textContent = t.title;
  document.getElementById('detailTitleInput').value = t.title;
  document.getElementById('detailDueInput').value = t.dueDate || '';
  document.getElementById('detailGroupInput').value = t.tab;
  document.getElementById('detailCreatedByInput').value = t.createdBy || '';

  const toggleBtn = document.getElementById('toggleCompleteBtn');
  toggleBtn.textContent = t.status === 'completed' ? 'Reopen task' : 'Mark complete';

  renderNotes(t);
  goToView('taskDetail');
}

function renderNotes(t) {
  const list = document.getElementById('taskNotesList');
  const notes = [...(t.notes || [])].sort((a, b) => b.ts - a.ts);
  list.innerHTML = notes.length
    ? notes.map(n => `<div class="note-entry"><div class="ts">${formatTs(n.ts)}</div><div class="txt">${escapeHtml(n.text)}</div></div>`).join('')
    : `<div class="empty-state">No notes yet</div>`;
}

document.getElementById('saveDetailBtn').addEventListener('click', async () => {
  const title = document.getElementById('detailTitleInput').value.trim();
  const dueDate = document.getElementById('detailDueInput').value || null;
  const tab = document.getElementById('detailGroupInput').value;
  const createdBy = document.getElementById('detailCreatedByInput').value.trim().toUpperCase().slice(0, 3);
  if (!title) return;
  await updateTask(currentTaskId, { title, dueDate, tab, createdBy });
});

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

document.getElementById('deleteTaskBtn').addEventListener('click', async () => {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  await deleteTask(currentTaskId);
  goToView(previousTabView);
});

// ================= Add task modal =================
const addTaskModal = document.getElementById('addTaskModal');
let addTaskTab = 'simple';

document.querySelectorAll('[data-add-task]').forEach(btn => {
  btn.addEventListener('click', () => {
    addTaskTab = btn.dataset.addTask;
    document.getElementById('addTaskTitleInput').value = '';
    document.getElementById('addTaskDueInput').value = todayStr();
    document.getElementById('addTaskCreatedByInput').value = '';
    document.getElementById('addTaskError').textContent = '';
    addTaskModal.classList.remove('hidden');
  });
});
document.getElementById('cancelAddTask').addEventListener('click', () => addTaskModal.classList.add('hidden'));
document.getElementById('saveAddTask').addEventListener('click', async () => {
  const title = document.getElementById('addTaskTitleInput').value.trim();
  const dueDate = document.getElementById('addTaskDueInput').value || null;
  const createdBy = document.getElementById('addTaskCreatedByInput').value.trim().toUpperCase().slice(0, 3);
  if (!title) {
    document.getElementById('addTaskError').textContent = 'Enter a title';
    return;
  }
  await addTask({ tab: addTaskTab, title, dueDate, createdBy });
  addTaskModal.classList.add('hidden');
});

// ================= Auth + Firestore live sync =================
function refreshCurrentView() {
  if (currentTab === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(currentTab)) renderTabList(currentTab);
  if (currentTab === 'taskDetail' && currentTaskId) {
    const t = allTasks.find(t => t.id === currentTaskId);
    if (t) {
      document.getElementById('toggleCompleteBtn').textContent = t.status === 'completed' ? 'Reopen task' : 'Mark complete';
      renderNotes(t);
    }
  }
}

let unsubscribeTasks = null;
firebase.auth().onAuthStateChanged((user) => {
  if (user && !unsubscribeTasks) {
    unsubscribeTasks = listenToTasks((tasks) => {
      allTasks = tasks;
      refreshCurrentView();
    });
  }
});

// ================= Init =================
initTheme();
startLockFlow();
goToView('home');
