import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
const firebaseConfig = {
  apiKey: "AIzaSyBWt9BpdJ8dSvocRnciTLJcc3kFa_YWL6g",
  authDomain: "arrow-game-19120.firebaseapp.com",
  projectId: "arrow-game-19120",
  storageBucket: "arrow-game-19120.firebasestorage.app",
  messagingSenderId: "1002266973530",
  appId: "1:1002266973530:web:bbe2315f1adefb20de0f63",
  measurementId: "G-9KLTGTVKRY",
  databaseURL: "https://arrow-game-19120-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const rtdb = getDatabase(app);
