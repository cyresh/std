// ---------- Firestore data layer ----------
// Collections:
//   tasks  { id, tab, activityNo, title, dueDate, status, createdAt, completedAt, notes:[{ts,text}] }
//   meta/counters { simple:0, medium:0, heavy:0 }

const TASKS_COL = firestoreDb.collection('tasks');
const COUNTERS_DOC = firestoreDb.collection('meta').doc('counters');

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

async function addTask({ tab, title, dueDate }) {
  const activityNo = await nextActivityNo(tab);
  const doc = {
    tab,
    activityNo,
    title,
    dueDate: dueDate || null,
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

function setTaskStatus(id, status) {
  return TASKS_COL.doc(id).update({
    status,
    completedAt: status === 'completed' ? Date.now() : null
  });
}

// Real-time listener for ALL tasks. callback receives an array of task objects.
function listenToTasks(callback) {
  return TASKS_COL.onSnapshot((snapshot) => {
    const tasks = [];
    snapshot.forEach((doc) => tasks.push({ id: doc.id, ...doc.data() }));
    callback(tasks);
  }, (err) => {
    console.error('Firestore listener error:', err);
  });
}
