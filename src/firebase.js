import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC3YVVkrok8xX5BH7teuqyRgy24pyFknOc',
  authDomain: 'aadi-quotation-system.firebaseapp.com',
  projectId: 'aadi-quotation-system',
  storageBucket: 'aadi-quotation-system.firebasestorage.app',
  messagingSenderId: '479301617987',
  appId: '1:479301617987:web:3b277db4f5fec0f647c7f6',
  measurementId: 'G-C6P2DDRXE0',
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const db = getFirestore(app);