// ---------- Firestore data layer ----------
// Collections:
//   tasks           { id, tab, activityNo, title, dueDate, dueTime, location, createdBy,
//                      status, createdAt, completedAt, notes:[{ts,text}] }
//   meta/counters   { simple:0, medium:0, heavy:0 }
//   meta/security   { pinHash }
//   meta/appSettings{ createdByNames:[...], tabLabels:{simple,medium,heavy} }

const TASKS_COL = firestoreDb.collection('tasks');
const COUNTERS_DOC = firestoreDb.collection('meta').doc('counters');
const SECURITY_DOC = firestoreDb.collection('meta').doc('security');
const APP_SETTINGS_DOC = firestoreDb.collection('meta').doc('appSettings');

const TAB_PREFIX = { simple: 'S', medium: 'M', heavy: 'H' };

async function nextActivityNo(tab) {
  return firestoreDb.runTransaction(async (tx) => {
    const snap = await tx.get(COUNTERS_DOC);
    const data = snap.exists ? snap.data() : { simple: 0, medium: 0, heavy: 0 };
    const next = (data[tab] || 0) + 1;
    tx.set(COUNTERS_DOC, { ...data, [tab]: next }, { merge: true });
    return `${TAB_PREFIX[tab]}-${String(next).padStart(3, '0')}`;
  });
}

async function addTask({ tab, title, dueDate, dueTime, location, createdBy }) {
  const activityNo = await nextActivityNo(tab);
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
