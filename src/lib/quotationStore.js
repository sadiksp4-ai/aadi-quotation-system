/**
 * Quotation persistence seam.
 *
 * The app talks to this module instead of Firestore directly for quotation
 * records. In normal operation it writes to the existing `quotations`
 * collection. When the app is opened with `?testMode=1` (or the
 * `aadi_test_mode` localStorage flag) it uses a local in-browser store so
 * automated verification never creates test records in production.
 */

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { stripUndefined } from './quotation';

const TEST_FLAG = 'aadi_test_mode';
const TEST_STORE_KEY = 'aadi_test_quotations';
const listeners = new Set();

export function isTestMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('testMode') === '1') return true;
  } catch {
    /* ignore */
  }
  try {
    return window.localStorage.getItem(TEST_FLAG) === '1';
  } catch {
    return false;
  }
}

function sortQuotes(list) {
  return [...list].sort((a, b) => {
    const ta = new Date(a.timestamp || a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.timestamp || b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
}

function readTestStore() {
  try {
    const raw = window.localStorage.getItem(TEST_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? sortQuotes(parsed) : [];
  } catch {
    return [];
  }
}

function writeTestStore(list) {
  const sorted = sortQuotes(list);
  try {
    window.localStorage.setItem(TEST_STORE_KEY, JSON.stringify(sorted));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(sorted));
  return sorted;
}

function emitTestStore() {
  const list = readTestStore();
  listeners.forEach((fn) => fn(list));
}

export function subscribeQuotations(onNext, onError) {
  if (isTestMode()) {
    onNext(readTestStore());
    listeners.add(onNext);
    const onStorage = (event) => {
      if (!event || event.key === TEST_STORE_KEY) onNext(readTestStore());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(onNext);
      window.removeEventListener('storage', onStorage);
    };
  }

  return onSnapshot(
    collection(db, 'quotations'),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onNext(sortQuotes(list));
    },
    (err) => {
      console.error('quotations snapshot error', err);
      if (onError) onError(err);
    },
  );
}

export async function saveQuotation(record) {
  const clean = stripUndefined(record);
  if (isTestMode()) {
    const list = readTestStore();
    const index = list.findIndex((q) => q.id === clean.id);
    if (index >= 0) list[index] = clean;
    else list.unshift(clean);
    writeTestStore(list);
    return clean;
  }
  await setDoc(doc(db, 'quotations', clean.id), clean);
  return clean;
}

export async function updateQuotationStatus(id, status, extra = {}) {
  const patch = {
    status,
    ...extra,
    updatedAt: new Date().toISOString(),
  };
  if (isTestMode()) {
    const list = readTestStore().map((q) =>
      q.id === id ? { ...q, ...patch, timestamp: q.timestamp || patch.updatedAt } : q,
    );
    writeTestStore(list);
    return;
  }
  await updateDoc(doc(db, 'quotations', id), patch);
}

export async function deleteQuotation(id) {
  if (isTestMode()) {
    writeTestStore(readTestStore().filter((q) => q.id !== id));
    return;
  }
  await deleteDoc(doc(db, 'quotations', id));
}

export async function deleteAllTestQuotations() {
  if (!isTestMode()) return;
  writeTestStore([]);
}

export function seedTestQuotations(list = []) {
  if (!isTestMode()) return;
  writeTestStore(list);
}

export function emitTestChange() {
  if (isTestMode()) emitTestStore();
}
