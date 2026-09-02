// Firebase project: cytd
const firebaseConfig = {
  apiKey: "AIzaSyAZLa9eWG81t_aujGyDOSVSU0aUJgr0Pbw",
  authDomain: "cytd-b14e4.firebaseapp.com",
  projectId: "cytd-b14e4",
  storageBucket: "cytd-b14e4.firebasestorage.app",
  messagingSenderId: "431795980197",
  appId: "1:431795980197:web:db074aab53de3a536a0a4c"
};

firebase.initializeApp(firebaseConfig);
const firestoreDb = firebase.firestore();

// Anonymous auth so Firestore rules can require request.auth != null
// without needing a real login screen.
firebase.auth().signInAnonymously().catch((err) => {
  console.error('Anonymous auth failed:', err);
});
