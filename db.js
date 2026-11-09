// ---------- Firestore data layer ----------
// Collections:
//   tasks           { id, tab, activityNo, title, dueDate, dueTime, location, createdBy,
//                      status, createdAt, completedAt, notes:[{ts,text}] }
//   meta/counters   { simple:0, medium:0, heavy:0 }
//   meta/security   { pinHash }
//   meta/appSettings{ createdByNames:[...], tabLabels:{simple,medium,heavy} }

const TASKS_COL = firestoreDb.collection('tasks');
const SECURITY_DOC = firestoreDb.collection('meta').doc('security');
const APP_SETTINGS_DOC = firestoreDb.collection('meta').doc('appSettings');

const TAB_PREFIX = { simple: 'S', medium: 'M', heavy: 'H' };

// Picks the next activity number for a tab from the locally cached task list
// (kept live by listenToTasks/allTasks in app.js) instead of a Firestore
// transaction. Transactions require a live round-trip to the server and will
// hang indefinitely while offline -- that's what caused "Save" to appear
// stuck with no feedback, and repeated taps queuing up multiple transactions
// that all fired at once (as duplicate tasks) the moment connectivity
// returned. A plain document write, unlike a transaction, is fully supported
// by Firestore's offline persistence and resolves immediately either way.
function nextActivityNo(tab) {
  const prefix = TAB_PREFIX[tab];
  let maxNum = 0;
  (typeof allTasks !== 'undefined' ? allTasks : []).forEach((t) => {
    if (t.tab === tab && typeof t.activityNo === 'string' && t.activityNo.startsWith(prefix + '-')) {
      const n = parseInt(t.activityNo.slice(prefix.length + 1), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

async function addTask({ tab, title, dueDate, dueTime, location, createdBy, repeat }) {
  const activityNo = nextActivityNo(tab);
  const doc = {
    tab,
    activityNo,
    title,
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    location: location || null,
    createdBy: createdBy || null,
    status: 'open',
    createdAt: Date.now(),
    completedAt: null,
    repeat: repeat || null,
    notes: []
  };
  const ref = await TASKS_COL.add(doc);
  return { id: ref.id, ...doc };
}

function updateTask(id, fields) {
  return TASKS_COL.doc(id).update(fields);
}

function deleteTask(id) {
  return TASKS_COL.doc(id).delete();
}

function addNoteToTask(id, text) {
  const entry = { ts: Date.now(), text };
  return TASKS_COL.doc(id).update({
    notes: firebase.firestore.FieldValue.arrayUnion(entry)
  });
}

// Overwrites the whole notes array — used when editing an existing note's text.
function replaceTaskNotes(id, notesArray) {
  return TASKS_COL.doc(id).update({ notes: notesArray });
}

function setTaskStatus(id, status) {
  return TASKS_COL.doc(id).update({
    status,
    completedAt: status === 'completed' ? Date.now() : null
  });
}

// options: { includeMetadataChanges: true } lets the caller derive sync status
// (hasPendingWrites / fromCache) from snapshot.metadata.
function listenToTasks(callback) {
  return TASKS_COL.onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
    const tasks = [];
    snapshot.forEach((doc) => tasks.push({ id: doc.id, ...doc.data() }));
    callback(tasks, snapshot.metadata);
  }, (err) => {
    console.error('Firestore tasks listener error:', err);
  });
}

// ---------- Global (shared) PIN ----------
async function getSecurityDoc() {
  const snap = await SECURITY_DOC.get();
  return snap.exists ? snap.data() : null;
}

function setGlobalPinHash(hash) {
  return SECURITY_DOC.set({ pinHash: hash }, { merge: true });
}

// ---------- App settings (creator names + tab labels) ----------
function listenToAppSettings(callback) {
  return APP_SETTINGS_DOC.onSnapshot((doc) => {
    callback(doc.exists ? doc.data() : null);
  }, (err) => {
    console.error('Firestore appSettings listener error:', err);
  });
}

function setCreatorNames(names) {
  return APP_SETTINGS_DOC.set({ createdByNames: names }, { merge: true });
}

function setTabLabels(labels) {
  return APP_SETTINGS_DOC.set({ tabLabels: labels }, { merge: true });
}


// ---------- Archive ----------
// Archived = parked: not open (no overdue / reminders), not completed (not closed).
// Archiving an open recurring task pauses the series (no next copy is created).
function archiveTask(id) {
  const now = Date.now();
  return TASKS_COL.doc(id).update({
    status: 'archived',
    archivedAt: now,
    notes: firebase.firestore.FieldValue.arrayUnion({ ts: now, text: 'Archived' })
  });
}

function restoreTask(id) {
  const now = Date.now();
  return TASKS_COL.doc(id).update({
    status: 'open',
    archivedAt: null,
    notes: firebase.firestore.FieldValue.arrayUnion({ ts: now, text: 'Restored from archive' })
  });
}

// ---------- Recurrence ----------
// task.repeat = { every:N, unit:'day'|'week'|'month'|'year', from:'due'|'done', anchor:'YYYY-MM-DD' }
//  from 'due'  -> fixed schedule (anchor + k*interval, never drifts, skips dates already past)
//  from 'done' -> next one is due `interval` after the day you complete it
function _pad(n) { return String(n).padStart(2, '0'); }

function addInterval(dateStr, n, unit) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (unit === 'day' || unit === 'week') {
    const dt = new Date(y, m - 1, d + n * (unit === 'week' ? 7 : 1));
    return `${dt.getFullYear()}-${_pad(dt.getMonth() + 1)}-${_pad(dt.getDate())}`;
  }
  const months = n * (unit === 'year' ? 12 : 1);
  const total = (m - 1) + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();   // clamp e.g. Jan 31 + 1 month -> Feb 28/29
  return `${ty}-${_pad(tm + 1)}-${_pad(Math.min(d, lastDay))}`;
}

function nextDueDate(t) {
  const r = t.repeat;
  const today = todayStr();
  if (r.from === 'done') return addInterval(today, r.every, r.unit);
  const anchor = r.anchor || t.dueDate;
  let k = 1, next;
  do {
    next = addInterval(anchor, r.every * k, r.unit);
    k++;
  } while ((next <= t.dueDate || next < today) && k < 5000);
  return next;
}

// Completes a task; if it repeats (and hasn't already spawned its next copy),
// creates the next occurrence in the same atomic batch (works offline too).
function completeTask(t) {
  const batch = firestoreDb.batch();
  const ref = TASKS_COL.doc(t.id);
  const spawn = !!(t.repeat && t.repeat.every && !t.nextSpawned);
  const upd = { status: 'completed', completedAt: Date.now() };
  if (spawn) upd.nextSpawned = true;
  batch.update(ref, upd);
  if (spawn) {
    batch.set(TASKS_COL.doc(), {
      tab: t.tab,
      activityNo: nextActivityNo(t.tab),
      title: t.title,
      dueDate: nextDueDate(t),
      dueTime: t.dueTime || null,
      location: t.location || null,
      createdBy: t.createdBy || null,
      status: 'open',
      createdAt: Date.now(),
      completedAt: null,
      repeat: t.repeat,
      notes: []
    });
  }
  return batch.commit();
}
