// ================= State =================
let allTasks = [];
let currentTab = 'home';
let previousTabView = 'home';
let currentTaskId = null;
let completedCollapsed = { simple: false, medium: false, heavy: false };
let creatorNames = ['Name 1', 'Name 2', 'Name 3'];
let addTaskSelectedCreator = null;
let editSelectedCreator = null;
let calYear, calMonth;

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

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
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
  const saved = localStorage.getItem('std_theme') || 'dark';
  applyTheme(saved);
}

document.getElementById('lightThemeToggle').addEventListener('change', (e) => {
  applyTheme(e.target.checked ? 'light' : 'dark');
});

// ================= PIN lock (global / shared across devices) =================
const lockscreen = document.getElementById('lockscreen');
const pinDots = document.getElementById('pinDots');
const lockTitle = document.getElementById('lockTitle');
const lockError = document.getElementById('lockError');
let lockMode = 'loading'; // 'loading' | 'setup1' | 'setup2' | 'verify'
let enteredDigits = '';
let firstSetupPin = '';
let globalPinHash = null;

function renderPinDots(container, count) {
  const dots = container.querySelectorAll('.pin-dot');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < count));
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
  resetPinEntry();
  lockscreen.classList.remove('hidden');

  let sec;
  try {
    sec = await getSecurityDoc();
  } catch (err) {
    lockTitle.textContent = 'Connection error';
    lockError.textContent = 'Check your internet connection and reload.';
    return;
  }
  globalPinHash = sec ? sec.pinHash : null;

  const lastUnlock = localStorage.getItem('std_last_unlock_date');

  if (!globalPinHash) {
    lockMode = 'setup1';
    lockTitle.textContent = 'Set a shared PIN';
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

document.getElementById('keypad').addEventListener('click', (e) => {
  if (lockMode === 'loading') return;
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
      lockTitle.textContent = 'Set a shared PIN';
      enteredDigits = '';
      setTimeout(() => renderPinDots(pinDots, 0), 350);
    }
    return;
  }
  // verify
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

// ---- Change PIN modal (writes the shared/global PIN) ----
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
document.getElementById('changeKeypad').addEventListener('click', async (e) => {
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
const SUB_VIEWS = ['taskDetail', 'settings', 'calendar'];
const TAB_LABELS = { home: 'Std', simple: 'Simple', medium: 'Medium', heavy: 'Heavy', settings: 'Settings', calendar: 'Calendar' };

function goToView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');

  if (SUB_VIEWS.includes(name)) {
    backBtn.style.visibility = 'visible';
    viewTitleEl.textContent = name === 'taskDetail' ? 'Task' : (TAB_LABELS[name] || 'Std');
    currentTab = name;
  } else {
    const navBtn = document.querySelector(`.navbtn[data-nav="${name}"]`);
    if (navBtn) navBtn.classList.add('active');
    backBtn.style.visibility = 'hidden';
    viewTitleEl.textContent = TAB_LABELS[name] || 'Std';
    currentTab = name;
    previousTabView = name;
  }

  appEl.className = 'tab-' + (name === 'taskDetail' ? (currentTaskFallbackTab() || 'home') : name);

  if (name === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(name)) renderTabList(name);
  if (name === 'calendar') renderCalendar();
  if (name === 'settings') populateSettingsFields();
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

document.getElementById('calendarBtn').addEventListener('click', () => {
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  goToView('calendar');
});
document.getElementById('settingsBtn').addEventListener('click', () => goToView('settings'));

// ================= Creator chips (shared render helper) =================
function renderCreatorChips(container, selected, onSelect) {
  container.innerHTML = creatorNames.map(name =>
    `<button type="button" class="chip ${name === selected ? 'selected' : ''}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`
  ).join('');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => onSelect(chip.dataset.name));
  });
}

// ================= Settings =================
function populateSettingsFields() {
  document.getElementById('creatorName1Input').value = creatorNames[0] || '';
  document.getElementById('creatorName2Input').value = creatorNames[1] || '';
  document.getElementById('creatorName3Input').value = creatorNames[2] || '';
}

document.getElementById('saveCreatorNamesBtn').addEventListener('click', async () => {
  const n1 = document.getElementById('creatorName1Input').value.trim() || 'Name 1';
  const n2 = document.getElementById('creatorName2Input').value.trim() || 'Name 2';
  const n3 = document.getElementById('creatorName3Input').value.trim() || 'Name 3';
  await setCreatorNames([n1, n2, n3]);
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

// ================= Calendar =================
function renderCalendar() {
  const label = new Date(calYear, calMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  document.getElementById('calMonthLabel').textContent = label;

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
    const todayClass = dateStr === todayS ? 'today' : '';
    html += `<div class="cal-day ${todayClass}" data-date="${dateStr}"><div>${d}</div><div class="dots">${dots}</div></div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-day[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      const dayTasks = allTasks.filter(t => t.dueDate === dateStr);
      openDayTasksModal(dateStr, dayTasks);
    });
  });
}

function openDayTasksModal(dateStr, tasks) {
  document.getElementById('dayTasksTitle').textContent = formatDate(dateStr);
  const list = document.getElementById('dayTasksList');
  list.innerHTML = tasks.length ? tasks.map(t => `
    <div class="task-card" data-task-id="${t.id}" style="background:var(--surface-2); color:var(--text);">
      <div class="task-card-main">
        <div class="task-card-no">${t.activityNo} &middot; ${capitalize(t.tab)}</div>
        <div class="task-card-title">${escapeHtml(t.title)}</div>
      </div>
    </div>`).join('') : `<div class="empty-state">No tasks due this day</div>`;
  list.querySelectorAll('[data-task-id]').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('dayTasksModal').classList.add('hidden');
      openTaskDetail(el.dataset.taskId);
    });
  });
  document.getElementById('dayTasksModal').classList.remove('hidden');
}

document.getElementById('calPrevBtn').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
});
document.getElementById('calNextBtn').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
});
document.getElementById('closeDayTasks').addEventListener('click', () => {
  document.getElementById('dayTasksModal').classList.add('hidden');
});

// ================= Task detail (read-only view) =================
function openTaskDetail(id) {
  currentTaskId = id;
  const t = allTasks.find(t => t.id === id);
  if (!t) return;

  document.getElementById('taskDetailNo').textContent = t.activityNo;
  document.getElementById('taskDetailTitle').textContent = t.title;
  document.getElementById('viewDueDate').textContent = formatDate(t.dueDate);
  document.getElementById('viewGroup').textContent = capitalize(t.tab);
  document.getElementById('viewCreatedBy').textContent = t.createdBy || '\u2014';

  let statusHtml;
  if (t.status === 'completed') statusHtml = '<span class="status-badge completed">Completed</span>';
  else if (isOverdue(t)) statusHtml = '<span class="status-badge overdue">Overdue</span>';
  else statusHtml = '<span class="status-badge open">Open</span>';
  document.getElementById('viewStatus').innerHTML = statusHtml;

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
  document.getElementById('editGroupInput').value = t.tab;
  editSelectedCreator = t.createdBy || null;
  renderCreatorChips(document.getElementById('editCreatorChips'), editSelectedCreator, selectEditCreator);
  editTaskModal.classList.remove('hidden');
});

document.getElementById('cancelEditTask').addEventListener('click', () => {
  editTaskModal.classList.add('hidden');
});

document.getElementById('saveEditTask').addEventListener('click', async () => {
  const title = document.getElementById('editTitleInput').value.trim();
  const dueDate = document.getElementById('editDueInput').value || null;
  const tab = document.getElementById('editGroupInput').value;
  if (!title) return;
  await updateTask(currentTaskId, { title, dueDate, tab, createdBy: editSelectedCreator });
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

document.querySelectorAll('[data-add-task]').forEach(btn => {
  btn.addEventListener('click', () => {
    addTaskTab = btn.dataset.addTask;
    document.getElementById('addTaskTitleInput').value = '';
    document.getElementById('addTaskDueInput').value = todayStr();
    document.getElementById('addTaskError').textContent = '';
    addTaskSelectedCreator = null;
    renderCreatorChips(document.getElementById('addTaskCreatorChips'), addTaskSelectedCreator, selectAddTaskCreator);
    addTaskModal.classList.remove('hidden');
  });
});
document.getElementById('cancelAddTask').addEventListener('click', () => addTaskModal.classList.add('hidden'));
document.getElementById('saveAddTask').addEventListener('click', async () => {
  const title = document.getElementById('addTaskTitleInput').value.trim();
  const dueDate = document.getElementById('addTaskDueInput').value || null;
  if (!title) {
    document.getElementById('addTaskError').textContent = 'Enter a title';
    return;
  }
  await addTask({ tab: addTaskTab, title, dueDate, createdBy: addTaskSelectedCreator });
  addTaskModal.classList.add('hidden');
});

// ================= Auth + Firestore live sync =================
function refreshCurrentView() {
  if (currentTab === 'home') renderHome();
  if (['simple', 'medium', 'heavy'].includes(currentTab)) renderTabList(currentTab);
  if (currentTab === 'calendar') renderCalendar();
  if (currentTab === 'taskDetail' && currentTaskId) {
    const t = allTasks.find(t => t.id === currentTaskId);
    if (t) {
      document.getElementById('toggleCompleteBtn').textContent = t.status === 'completed' ? 'Reopen task' : 'Mark complete';
      renderNotes(t);
    }
  }
}

let unsubscribeTasks = null;
let unsubscribeSettings = null;
firebase.auth().onAuthStateChanged((user) => {
  if (user && !unsubscribeTasks) {
    unsubscribeTasks = listenToTasks((tasks) => {
      allTasks = tasks;
      refreshCurrentView();
    });
    unsubscribeSettings = listenToAppSettings((data) => {
      creatorNames = (data && Array.isArray(data.createdByNames) && data.createdByNames.length === 3)
        ? data.createdByNames
        : ['Name 1', 'Name 2', 'Name 3'];
      if (currentTab === 'settings') populateSettingsFields();
    });
    startLockFlow();
  }
});

// ================= Init =================
initTheme();
lockscreen.classList.remove('hidden'); // block content until startLockFlow resolves
goToView('home');
