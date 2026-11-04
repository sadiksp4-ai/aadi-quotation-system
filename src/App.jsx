import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Landmark,
  Lock,
  LogIn,
  Loader2,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  User,
  X,
  ClipboardList,
  LogOut,
  UserCircle,
  Archive,
  CheckCircle2,
} from 'lucide-react';
import rawProducts from './data/products.json';
import rawClients from './data/clients.json';
import BOQParser from './components/BOQParser';
import { db } from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';

// drop raw spreadsheet header rows that occasionally ship inside the feed
const BASE_URL = import.meta.env.BASE_URL;

const products = rawProducts
  .filter(
    (p) =>
      p.category !== 'Category *' &&
      p.sku !== 'SKU / Model No *' &&
      p.brand !== 'Brand *',
  )
  .map((p) => ({
    ...p,
    image:
      typeof p.image === 'string' && p.image.startsWith('/')
        ? `${BASE_URL}${p.image.slice(1)}`
        : p.image,
  }));

const BASE_CLIENTS = Array.isArray(rawClients) ? rawClients : [];

/* ---------------- helpers ---------------- */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const fmt = (n) => inr.format(Math.round(Number(n) || 0));

// Indian digit-grouping for editable price inputs (e.g. 10,40,999)
const groupIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const groupNum = (n) => groupIN.format(Math.round(Number(n) || 0));
const parseDigits = (s) => Number(String(s).replace(/[^0-9]/g, '')) || 0;

function parseGstRate(gst) {
  if (gst == null) return 0;
  const m = String(gst).match(/([\d.]+)/);
  return m ? Number(m[1]) / 100 : 0;
}

function brandInitials(brand) {
  return String(brand || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

const BRAND_STYLE = {
  Tramontina: 'bg-[#C8102E] text-white',
  Dolphy: 'bg-[#1B2A4A] text-white',
  'Kärcher': 'bg-[#FFD200] text-black',
};

const ACTIVE_PILL = {
  Tramontina: 'border-[#C8102E] bg-[#C8102E] text-white shadow-sm',
  Dolphy: 'border-[#1B2A4A] bg-[#1B2A4A] text-white shadow-sm',
  'Kärcher': 'border-[#CA8A04] bg-[#FFD200] text-black shadow-sm',
};

const BRAND_AVATAR_BG = {
  Tramontina: 'bg-[#C8102E]',
  Dolphy: 'bg-[#1B2A4A]',
  'Kärcher': 'bg-[#EAB308]',
};

/* ---------------- AADI ENTERPRISES company profile ---------------- */

const COMPANY = {
  name: 'AADI ENTERPRISES',
  tagline: 'Complete Hospitality Solution',
  address: 'Pune - 411041',
  gstin: '27AHRPB0512G1ZQ',
  udyam: 'UDYAM-MH-26-0546574',
  phone: '+91 9076304428',
  email: 'contact@aadienterprisespune.com',
  bankName: 'AADI ENTERPRISES',
  bank: 'ICICI Bank',
  account: '187605005124',
  ifsc: 'ICIC0001876',
  branch: 'Bavdhan Branch, Pune',
};

const STANDARD_TERMS = [
  'Prices quoted are as per the brand / make specified; any change in make or specification will revise the quotation.',
  'GST is charged extra as applicable per item HSN slab (5% / 18%) unless stated otherwise.',
  'Delivery timeline is 7 to 10 working days from receipt of PO & advance, subject to stock availability.',
  'Payment: 100% advance along with PO unless otherwise agreed in writing.',
  'Freight / transport charges, if applicable, are charged extra at actuals.',
  'Goods once sold will not be taken back or exchanged except for manufacturing defects reported within 48 hours of delivery.',
  'Warranty, if applicable, is as per the respective brand / manufacturer policy.',
  'All disputes are subject to Pune jurisdiction only. Quotation validity as stated above.',
];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateIN(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function isIntraStateSupply(placeOfSupply, stateCode) {
  const sc = String(stateCode || '').trim();
  if (sc) return sc === '27' || /maharashtra/i.test(sc);
  return /maharashtra|27/i.test(String(placeOfSupply || ''));
}

/* ---------------- quotation lifecycle helpers ---------------- */

const QUOTE_STATUSES = ['Draft', 'Sent', 'PO Received', 'Revised', 'Expired'];

const QUOTE_STATUS_STYLES = {
  Draft: 'border-slate-200 bg-slate-100 text-slate-700',
  Sent: 'border-blue-200 bg-blue-100 text-blue-800',
  'PO Received': 'border-emerald-200 bg-emerald-100 text-emerald-800',
  Revised: 'border-amber-200 bg-amber-100 text-amber-800',
  Expired: 'border-rose-200 bg-rose-100 text-rose-800',
};

const QUOTE_STATUS_TABS = [
  { key: 'All', label: 'All', match: () => true },
  {
    key: 'Active',
    label: 'Active / Sent',
    match: (q) => ['Sent', 'Revised'].includes(normalizeQuoteStatus(q)),
  },
  {
    key: 'PO Received',
    label: 'PO Received',
    match: (q) => normalizeQuoteStatus(q) === 'PO Received',
  },
  {
    key: 'Drafts',
    label: 'Drafts',
    match: (q) => normalizeQuoteStatus(q) === 'Draft',
  },
];

function normalizeQuoteStatus(quote) {
  const raw = String(quote?.status || 'Draft').trim();
  if (raw === 'Confirmed' || raw === 'Invoice Generated') return 'PO Received';
  if (raw === 'Active') return 'Sent';
  return QUOTE_STATUSES.includes(raw) ? raw : 'Draft';
}

function quoteMatchesStatusFilter(quote, filterKey) {
  const tab = QUOTE_STATUS_TABS.find((t) => t.key === filterKey);
  return tab ? tab.match(quote) : true;
}

function clientDefaultDiscount(client) {
  const raw = client?.defaultDiscount;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function quoteTotals(quote) {
  const items = Array.isArray(quote.items) ? quote.items : [];
  const marginPct = Number(quote.marginPct) || 0;
  const factor = 1 - marginPct / 100;
  const calcSubtotal = items.reduce(
    (s, i) => s + (Number(i.sellingPrice) || 0) * factor * (Number(i.qty) || 0),
    0,
  );
  const calcGst = items.reduce(
    (s, i) =>
      s +
      (Number(i.sellingPrice) || 0) *
        factor *
        (Number(i.qty) || 0) *
        parseGstRate(i.gst),
    0,
  );
  const subtotal =
    quote.subtotal != null && Number.isFinite(Number(quote.subtotal))
      ? Number(quote.subtotal)
      : calcSubtotal;
  const gstTotal =
    quote.gstTotal != null && Number.isFinite(Number(quote.gstTotal))
      ? Number(quote.gstTotal)
      : calcGst;
  const freight = Number(quote.freight) || 0;
  const grandTotal =
    quote.grandTotal != null && Number.isFinite(Number(quote.grandTotal))
      ? Number(quote.grandTotal)
      : subtotal + gstTotal + freight;
  return {
    items,
    subtotal,
    gstTotal,
    freight,
    grandTotal,
    itemCount: items.reduce((s, i) => s + (Number(i.qty) || 0), 0),
  };
}

function buildQuoteWhatsAppText(quote) {
  const totals = quoteTotals(quote);
  const marginPct = Number(quote.marginPct) || 0;
  const factor = 1 - marginPct / 100;
  const intraState = isIntraStateSupply(quote.placeOfSupply, quote.stateCode);
  const lines = [
    `*QUOTATION — ${COMPANY.name}*`,
    `${COMPANY.tagline}, ${COMPANY.address} | ${COMPANY.phone}`,
    `Quote No: ${quote.quoteNo || '—'} | Date: ${formatDateIN(quote.quoteDate) || '—'}`,
    quote.clientName ? `To: ${quote.clientName}` : null,
    quote.hotelName ? `Unit: ${quote.hotelName}` : null,
    `Items: ${totals.itemCount}`,
    '--------------------------------',
  ];
  totals.items.forEach((i, idx) => {
    const rate = (Number(i.sellingPrice) || 0) * factor;
    const lineTotal = rate * (Number(i.qty) || 0);
    lines.push(`${idx + 1}. ${i.name || i.sku || 'Item'}`);
    lines.push(
      `    ${i.brand ? `${i.brand} · ` : ''}${i.sku || ''} | Qty: ${i.qty || 0} x ${fmt(rate)} = ${fmt(lineTotal)} (+${i.gst || '0%'} GST)`,
    );
  });
  lines.push(
    '--------------------------------',
    `Basic Value: ${fmt(totals.subtotal)}`,
    intraState
      ? `CGST + SGST: ${inr2.format(totals.gstTotal)}`
      : `IGST: ${inr2.format(totals.gstTotal)}`,
  );
  if (totals.freight > 0) lines.push(`Freight: ${fmt(totals.freight)}`);
  lines.push(
    `*Grand Total (incl. GST): ${inr2.format(totals.grandTotal)}*`,
    '',
    `Delivery: ${quote.delivery || '—'} | Payment: ${quote.payment || '—'} | Validity: ${quote.validity || '—'}`,
    '',
    '*Bank Details (ICICI Bank)*',
    `A/C Name: ${COMPANY.bankName}`,
    `A/C No: ${COMPANY.account}`,
    `IFSC: ${COMPANY.ifsc}`,
    `Branch: ${COMPANY.branch}`,
  );
  return lines.filter((l) => l !== null).join('\n');
}

// client initials for quotation numbering (e.g. JW, RC)
function clientInitials(name) {
  const cleaned = String(name || '')
    .replace(/^the\s+/i, '')
    .trim();
  if (!cleaned) return 'CL';
  const tokens = cleaned.split(/[\\s\\-\\/]+/).filter(Boolean);
  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }
  let out = '';
  for (const t of tokens) {
    if (out.length >= 2) break;
    if (t.length <= 3) out += t.toUpperCase();
    else out += t[0].toUpperCase();
  }
  out = out.replace(/[^A-Z]/g, '').slice(0, 2);
  if (out.length < 2 && tokens[0].length >= 2) {
    out = tokens[0].slice(0, 2).toUpperCase();
  }
  return out || 'CL';
}

// Indian-rupee amount in words
function numberToWordsIN(num) {
  const n = Number(num) || 0;
  const rupees = Math.floor(Math.abs(n));
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const threeDigits = (x) => {
    if (x === 0) return '';
    const h = Math.floor(x / 100);
    const r = x % 100;
    const parts = [];
    if (h) parts.push(ones[h] + ' Hundred');
    if (r) {
      if (r < 20) parts.push(ones[r]);
      else {
        const t = Math.floor(r / 10);
        const o = r % 10;
        parts.push(tens[t] + (o ? ' ' + ones[o] : ''));
      }
    }
    return parts.join(' ');
  };
  const build = (x) => {
    if (x === 0) return 'Zero';
    const crore = Math.floor(x / 10000000);
    x %= 10000000;
    const lakh = Math.floor(x / 100000);
    x %= 100000;
    const thousand = Math.floor(x / 1000);
    x %= 1000;
    const hundred = x;
    const parts = [];
    if (crore) parts.push(threeDigits(crore) + ' Crore');
    if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
    if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
    if (hundred) parts.push(threeDigits(hundred));
    return parts.join(' ').trim();
  };
  let result = build(rupees) + ' Rupees';
  if (paise > 0) result += ' and ' + build(paise) + ' Paise';
  result += ' Only';
  if (n < 0) result = 'Minus ' + result;
  return result;
}

// margin / discount presets applied quote-wide on basic rates (before GST)
const MARGIN_PRESETS = [0, 5, 10, 15, 20, 25];
const marginLabel = (p) => `${p}%`;

const DETAILS_KEY = 'quote-details';
const AUTH_KEY = 'aadi_auth_user';
const ARCHIVE_KEY = 'aadi_quotations_archive';

const AUTH_USERS = [
  {
    email: 'admin@aadienterprises.com',
    passwordHash:
      'c23cd600f553b666a87586dbdb03242cdb44bc7f28be5ebf542eede976afc26c',
    name: 'Admin',
    role: 'System Administrator',
    avatarBg: 'from-slate-700 to-slate-900',
    initial: 'A',
  },
  {
    email: 'aditya@aadienterprises.com',
    passwordHash:
      '5585c75f1d5d1ea3adb2c9396af6a3b73653a7f944cf2662dd5a5f6170569856',
    name: 'Aditya',
    role: '',
    avatarBg: 'from-orange-500 to-amber-600',
    initial: 'A',
  },
  {
    email: 'abhijit@aadienterprises.com',
    passwordHash:
      'f381a4da85fcb2021d563d329f962e1185dafdce3089e7ba08cb372a8322ac1b',
    name: 'Abhijit',
    role: '',
    avatarBg: 'from-emerald-500 to-green-600',
    initial: 'A',
  },
];

async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing is unavailable in this browser.');
  const bytes = new TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyPasswordHash(hash, input) {
  if (!hash || !input) return false;
  const candidate = await sha256Hex(input);
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

function loadAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
  } catch {
    return null;
  }
}

function loadArchive() {
  try {
    const list = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const DEFAULT_DETAILS = {
  clientName: '',
  hotelName: '',
  address: '',
  shippingAddress: '',
  clientGstin: '',
  clientPan: '',
  stateCode: '27',
  contactPerson: '',
  designation: '',
  contactPhone: '',
  contactEmail: '',
  quoteNo: 'AE/QTN/2026-001',
  quoteDate: todayISO(),
  delivery: 'Ready Stock / 7-10 Working days',
  payment: '100% Advance along with PO',
  placeOfSupply: 'Maharashtra (27)',
  validity: '15 days from quotation date',
  freight: 0,
  marginPct: 0,
};

function loadDetails() {
  try {
    const saved = JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}');
    return { ...DEFAULT_DETAILS, ...saved };
  } catch {
    return { ...DEFAULT_DETAILS };
  }
}

/* ---------------- custom products (user-added) ---------------- */

const CUSTOM_KEY = 'custom_products_db';
const GST_OPTIONS = ['0%', '5%', '12%', '18%', '28%'];

function loadCustomProducts() {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const OVERRIDES_KEY = 'catalog_product_overrides';

function loadProductOverrides() {
  try {
    const obj = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

const numPrice = (s) => {
  const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// downscale via canvas so localStorage + print stay happy
function fileToDataUrl(file, maxDim = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- add / edit product modal ---------------- */

function ModalField({ label, error, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
      {error && (
        <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-600">
          <AlertCircle size={11} /> {error}
        </span>
      )}
    </label>
  );
}

const modalInput =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-slate-900 focus:outline-none';
const modalInputErr = 'border-red-400 focus:border-red-600';

function AddProductModal({ catalog, initial, onClose, onSave, onReset }) {
  const editing = Boolean(initial);
  const brands = useMemo(
    () => [...new Set(catalog.map((p) => p.brand))],
    [catalog],
  );
  const categories = useMemo(
    () => [...new Set(catalog.map((p) => p.category))].sort(),
    [catalog],
  );

  const [f, setF] = useState(() => ({
    brand: initial?.brand || brands[0] || 'Tramontina',
    brandNew: false,
    newBrand: '',
    sku: initial?.sku || '',
    name: initial?.name || '',
    category: initial?.category || '',
    subcategory: initial?.subcategory || '',
    hsn: initial?.hsn || '',
    gst: initial?.gst || '18%',
    mrp: initial?.mrp != null ? String(initial.mrp) : '',
    discountPct: '',
    sellingPrice: initial?.sellingPrice != null ? String(initial.sellingPrice) : '',
    image: initial?.image || '',
  }));
  const [errors, setErrors] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // seed discount when editing
  useEffect(() => {
    if (initial) {
      const mrp = numPrice(initial.mrp);
      const sp = numPrice(initial.sellingPrice);
      if (mrp > 0)
        setF((p) => ({
          ...p,
          discountPct: String(Math.round((1 - sp / mrp) * 10000) / 100),
        }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // esc closes; body scroll locked
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const setField = (key, value) => setF((p) => ({ ...p, [key]: value }));

  // linked pricing: MRP+discount ⇄ selling price
  const setPrice = (patch) =>
    setF((prev) => {
      const next = { ...prev, ...patch };
      if (patch.mrp !== undefined || patch.discountPct !== undefined) {
        const mrp = numPrice(patch.mrp !== undefined ? patch.mrp : prev.mrp);
        const dRaw = numPrice(
          patch.discountPct !== undefined ? patch.discountPct : prev.discountPct,
        );
        const d = Math.min(100, Math.max(0, dRaw));
        if (mrp > 0) next.sellingPrice = String(Math.round(mrp * (1 - d / 100)));
      } else if (patch.sellingPrice !== undefined) {
        const mrp = numPrice(prev.mrp);
        const sp = numPrice(patch.sellingPrice);
        if (mrp > 0) {
          const d = Math.min(100, Math.max(0, (1 - sp / mrp) * 100));
          next.discountPct = String(Math.round(d * 100) / 100);
        }
      }
      return next;
    });

  const ingestFile = async (file) => {
    if (!file) return;
    if (!/image\/(jpeg|png|webp)/i.test(file.type)) {
      setErrors((e) => ({ ...e, image: 'Only JPG, PNG or WEBP files allowed' }));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setErrors((e) => ({ ...e, image: 'File too large (max 12 MB)' }));
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      setF((p) => ({ ...p, image: url }));
      setErrors((e) => {
        const n = { ...e };
        delete n.image;
        return n;
      });
    } catch {
      setErrors((e) => ({ ...e, image: 'Could not read that image file' }));
    }
  };

  const submit = () => {
    const e = {};
    const brand = f.brandNew ? f.newBrand.trim() : f.brand;
    if (!brand) e.brand = 'Brand is required';
    const sku = f.sku.trim();
    if (!sku) e.sku = 'SKU is required';
    else if (
      catalog.some(
        (p) => p.sku.toLowerCase() === sku.toLowerCase() && p.sku !== initial?.sku,
      )
    )
      e.sku = 'SKU already exists in catalog';
    if (!f.name.trim()) e.name = 'Product name is required';
    if (!f.category.trim()) e.category = 'Category is required';
    if (numPrice(f.sellingPrice) < 0) e.sellingPrice = 'Invalid price';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    onSave({
      brand,
      sku,
      name: f.name.trim(),
      category: f.category.trim(),
      subcategory: f.subcategory.trim(),
      hsn: f.hsn.trim(),
      gst: f.gst,
      mrp: numPrice(f.mrp),
      sellingPrice: numPrice(f.sellingPrice),
      image: f.image,
      custom: initial ? Boolean(initial.custom) : true,
    });
  };

  return (
    <div className="no-print fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/60 animate-fade-in"
        onClick={onClose}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-fade-in">
        {/* header */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
            {editing ? <Pencil size={15} /> : <Plus size={15} />}
          </span>
          <div>
            <h2 className="text-[15px] font-extrabold leading-tight">
              {editing ? 'Edit Product' : 'Add New Product'}
            </h2>
            <p className="text-[11px] font-medium text-slate-500">
              {editing
                ? `Updating ${initial.sku}`
                : 'Saved locally · appears in catalog instantly'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 nice-scroll">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {/* brand */}
            <ModalField label="Brand" error={errors.brand}>
              {f.brandNew ? (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={f.newBrand}
                    onChange={(e) => setField('newBrand', e.target.value)}
                    placeholder="Enter new brand name"
                    className={`${modalInput} ${errors.brand ? modalInputErr : ''}`}
                  />
                  <button
                    onClick={() => setF((p) => ({ ...p, brandNew: false }))}
                    className="rounded-lg border border-slate-200 px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100"
                    title="Back to existing brands"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <select
                  value={f.brand}
                  onChange={(e) => {
                    if (e.target.value === '__new__')
                      setF((p) => ({ ...p, brandNew: true }));
                    else setField('brand', e.target.value);
                  }}
                  className={modalInput}
                >
                  {brands.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                  <option value="__new__">＋ New brand…</option>
                </select>
              )}
            </ModalField>

            {/* sku */}
            <ModalField label="SKU / Model Number" error={errors.sku}>
              <input
                value={f.sku}
                disabled={editing}
                onChange={(e) => setField('sku', e.target.value)}
                placeholder="e.g. 98050035 or 1.100-240.0"
                className={`${modalInput} font-mono ${errors.sku ? modalInputErr : ''} ${editing ? 'cursor-not-allowed bg-slate-100 text-slate-500' : ''}`}
              />
            </ModalField>

            {/* name */}
            <div className="sm:col-span-2">
              <ModalField label="Product Name" error={errors.name}>
                <input
                  value={f.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Full product name as it should appear on the quotation"
                  className={`${modalInput} ${errors.name ? modalInputErr : ''}`}
                />
              </ModalField>
            </div>

            {/* category */}
            <ModalField label="Category" error={errors.category}>
              <input
                value={f.category}
                list="modal-categories"
                onChange={(e) => setField('category', e.target.value)}
                placeholder="Pick existing or type new"
                className={`${modalInput} ${errors.category ? modalInputErr : ''}`}
              />
              <datalist id="modal-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </ModalField>

            {/* subcategory */}
            <ModalField label="Subcategory">
              <input
                value={f.subcategory}
                list="modal-subcats"
                onChange={(e) => setField('subcategory', e.target.value)}
                placeholder="Optional"
                className={modalInput}
              />
              <datalist id="modal-subcats">
                {[
                  ...new Set(
                    catalog
                      .map((p) => p.subcategory)
                      .filter(Boolean),
                  ),
                ].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </ModalField>

            {/* hsn + gst */}
            <ModalField label="HSN Code">
              <input
                value={f.hsn}
                onChange={(e) => setField('hsn', e.target.value)}
                placeholder="e.g. 73239390"
                className={`${modalInput} font-mono`}
              />
            </ModalField>
            <ModalField label="GST Rate">
              <select
                value={f.gst}
                onChange={(e) => setField('gst', e.target.value)}
                className={modalInput}
              >
                {GST_OPTIONS.map((g) => (
                  <option key={g} value={g}>
                    +{g} GST
                  </option>
                ))}
              </select>
            </ModalField>

            {/* pricing */}
            <div className="sm:col-span-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                <p className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                  Pricing (INR) — auto-linked
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <ModalField label="MRP (₹)">
                    <input
                      inputMode="decimal"
                      value={f.mrp}
                      onChange={(e) => setPrice({ mrp: e.target.value })}
                      placeholder="0"
                      className={`${modalInput} tabular-nums`}
                    />
                  </ModalField>
                  <ModalField label="Discount (%)">
                    <input
                      inputMode="decimal"
                      value={f.discountPct}
                      onChange={(e) => setPrice({ discountPct: e.target.value })}
                      placeholder="0"
                      className={`${modalInput} tabular-nums`}
                    />
                  </ModalField>
                  <ModalField label="Offer Price (₹)" error={errors.sellingPrice}>
                    <input
                      inputMode="decimal"
                      value={f.sellingPrice}
                      onChange={(e) => setPrice({ sellingPrice: e.target.value })}
                      placeholder="0"
                      className={`${modalInput} tabular-nums font-bold ${errors.sellingPrice ? modalInputErr : ''}`}
                    />
                  </ModalField>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Edit MRP + Discount to compute price, or edit MRP + Offer Price to
                  back-compute the discount.
                </p>
              </div>
            </div>

            {/* photo */}
            <div className="sm:col-span-2">
              <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Photo
              </span>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  ingestFile(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) =>
                  (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()
                }
                className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
                  dragOver
                    ? 'border-slate-900 bg-slate-100'
                    : errors.image
                      ? 'border-red-300 bg-red-50/40'
                      : 'border-slate-300 bg-slate-50/40 hover:border-slate-500'
                }`}
              >
                {f.image ? (
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={f.image}
                      alt="Preview"
                      className="h-24 w-24 rounded-lg border border-slate-200 bg-white object-contain"
                    />
                    <div className="flex gap-2">
                      <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                        Replace
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setField('image', '');
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:border-red-300 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <UploadCloud size={26} className="text-slate-400" />
                    <p className="text-[13px] font-bold text-slate-700">
                      Drag & drop photo, or click to browse
                    </p>
                    <p className="text-[11px] text-slate-400">JPG · PNG · WEBP</p>
                  </>
                )}
                {errors.image && (
                  <span className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-red-600">
                    <AlertCircle size={11} /> {errors.image}
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  ingestFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-600 transition hover:border-slate-400"
          >
            Cancel
          </button>
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-500 transition hover:border-red-300 hover:text-red-600"
            >
              Reset to Default
            </button>
          )}
          <button
            onClick={submit}
            className="ml-auto flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2 text-[13px] font-bold text-white transition hover:bg-slate-700 active:scale-[.98]"
          >
            <Check size={15} />
            {editing ? 'Save Changes' : 'Add to Catalog'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ALL_PRICES = products.map((p) => Number(p.sellingPrice) || 0);
const GLOBAL_MIN = Math.floor(Math.min(...ALL_PRICES));
const GLOBAL_MAX = Math.ceil(Math.max(...ALL_PRICES));

// slider granularity scales with the catalogue's price span (e.g. ~₹5,000 steps at ₹1Cr span)
const PRICE_STEP = Math.max(100, Math.round((GLOBAL_MAX - GLOBAL_MIN) / 2000 / 100) * 100);

/* ---------------- image with graceful fallback ---------------- */

function ProductImage({ product, size = 'md' }) {
  const [failed, setFailed] = useState(!product.image);
  useEffect(() => setFailed(!product.image), [product.sku, product.image]);

  const dims =
    size === 'sm'
      ? 'h-14 w-14 rounded-lg text-sm'
      : 'h-full w-full text-3xl';

  if (failed) {
    const avatarBg = BRAND_AVATAR_BG[product.brand] || 'bg-slate-800';
    const avatarText = product.brand === 'Kärcher' ? 'text-black' : 'text-white';
    const wash =
      product.brand === 'Tramontina'
        ? 'from-rose-50 to-rose-100'
        : product.brand === 'Kärcher'
          ? 'from-yellow-50 to-yellow-100'
          : 'from-slate-100 to-slate-200';
    return (
      <div
        className={`flex ${dims} flex-col items-center justify-center gap-1.5 bg-gradient-to-br ${wash} p-2 text-center`}
        aria-label={`${product.brand} placeholder`}
      >
        <span
          className={`flex h-11 w-11 items-center justify-center rounded-full font-extrabold tracking-wide shadow-sm ${avatarBg} ${avatarText}`}
        >
          {brandInitials(product.brand)}
        </span>
        <span className="max-w-full truncate rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm">
          {product.category}
        </span>
      </div>
    );
  }

  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${size === 'sm' ? 'h-14 w-14 rounded-lg border border-slate-200 object-contain bg-white p-2' : 'h-full w-full object-contain bg-white p-2 transition-transform duration-200 group-hover:scale-[1.04]'}`}
    />
  );
}

/* ---------------- print thumbnail (50x50, fallback-safe) ---------------- */

function PrintThumb({ item }) {
  const [failed, setFailed] = useState(!item.image);
  useEffect(() => setFailed(!item.image), [item.sku, item.image]);
  if (failed || !item.image) {
    return (
      <div
        style={{
          width: 50,
          height: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: item.brand === 'Tramontina' ? '#FBE9EC' : '#E8EDF5',
          color: item.brand === 'Tramontina' ? '#C8102E' : '#1B2A4A',
          fontWeight: 800,
          fontSize: 14,
          border: '1px solid #cbd5e1',
          borderRadius: 4,
        }}
      >
        {brandInitials(item.brand)}
      </div>
    );
  }
  return (
    <img
      src={item.image}
      alt={item.sku}
      onError={() => setFailed(true)}
      style={{
        width: 50,
        height: 50,
        objectFit: 'contain',
        border: '1px solid #cbd5e1',
        borderRadius: 4,
        background: '#fff',
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    />
  );
}

/* ---------------- client quick-select combobox ---------------- */
function ClientQuickSelect({ clients = [], onSelect, onClear }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) =>
      [c.propertyName, c.legalEntity, c.accountName, c.city, c.category]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [query]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const c of filtered) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category).push(c);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="🔍 Select Existing Client / Hotel (85 accounts available)..."
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none"
          />
          {open && (
            <div className="absolute left-0 top-full z-[60] mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-pop nice-scroll">
              {groups.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs font-medium text-slate-400">
                  No clients match “{query}”
                </p>
              ) : (
                groups.map(([cat, list]) => (
                  <div key={cat}>
                    <div className="sticky top-0 bg-slate-100 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                      {cat}
                    </div>
                    {list.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          onSelect(c);
                          setQuery(
                            `${c.propertyName} — ${c.legalEntity || c.accountName}`,
                          );
                          setOpen(false);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-[13px] font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        {c.propertyName} — {c.legalEntity || c.accountName}
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            onClear();
          }}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
          title="Clear / New Client"
        >
          Clear / New Client
        </button>
      </div>
    </div>
  );
}

/* ---------------- quotation status badge + action menu ---------------- */

function QuoteStatusSelect({ value, onChange }) {
  const status = normalizeQuoteStatus({ status: value });
  return (
    <div
      className={`relative inline-flex items-center rounded-full border ${QUOTE_STATUS_STYLES[status]}`}
    >
      <select
        value={status}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent py-0.5 pl-2 pr-6 text-[11px] font-extrabold focus:outline-none"
        aria-label="Update quotation status"
        title="Update quotation status"
      >
        {QUOTE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="pointer-events-none absolute right-1.5" />
    </div>
  );
}

function QuoteActionMenu({
  onLoad,
  onPrint,
  onDuplicate,
  onWhatsApp,
  onDelete,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const toggleMenu = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const width = 208;
      const height = 260;
      setPos({
        top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - height - 8)),
        left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)),
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (
        !menuRef.current?.contains(e.target) &&
        !btnRef.current?.contains(e.target)
      )
        setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const item = (label, Icon, onClick, extra = '') => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-slate-700 transition hover:bg-slate-50 ${extra}`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleMenu}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={14} />
        Actions
        <ChevronDown size={11} />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: 208,
            zIndex: 80,
          }}
          className="rounded-xl border border-slate-200 bg-white py-1 shadow-pop animate-fade-in"
        >
          {item('Load / Edit', Pencil, onLoad)}
          {item('View / Print PDF', Printer, onPrint)}
          {item('Duplicate / Revise', Copy, onDuplicate)}
          {item(
            'Send via WhatsApp',
            MessageCircle,
            onWhatsApp,
            'text-emerald-700',
          )}
          <div className="my-1 border-t border-slate-100" />
          {item('Delete', Trash2, onDelete, 'text-rose-600 hover:bg-rose-50')}
        </div>
      )}
    </>
  );
}

function ClientPricingMemory({ client, onSave }) {
  const [value, setValue] = useState(client?.defaultDiscount ?? '');
  useEffect(() => {
    setValue(client?.defaultDiscount ?? '');
  }, [client?.id, client?.defaultDiscount]);

  if (!client) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-800">
          Client pricing memory
        </p>
        <p className="truncate text-[11px] text-emerald-700">
          Default discount auto-applies when selected
        </p>
      </div>
      <div className="relative ml-auto w-20 shrink-0">
        <input
          type="number"
          min={0}
          max={100}
          step="0.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full rounded-lg border border-emerald-200 bg-white py-1 pl-2 pr-5 text-[12px] font-extrabold tabular-nums focus:border-emerald-600 focus:outline-none"
          aria-label="Client default discount percent"
        />
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-emerald-600">
          %
        </span>
      </div>
      <button
        type="button"
        onClick={() => onSave(value)}
        className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700"
      >
        Save
      </button>
    </div>
  );
}

/* ---------------- quotation details accordion (drawer) ---------------- */

function DetailField({ label, children }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

const detailInputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-800 focus:border-slate-900 focus:outline-none';

function QuoteDetailsForm({
  details,
  setDetail,
  open,
  onToggle,
  onReset,
  archive = [],
  clients = [],
  selectedClient = null,
  onClientSelect,
  onClientClear,
  onUpdateClientDiscount,
}) {
  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
        aria-expanded={open}
      >
        <Building2 size={15} className="text-slate-600" />
        <span className="text-[13px] font-extrabold text-slate-800">
          Customer & Quotation Details
        </span>
        <span className="truncate text-[11px] font-medium text-slate-400">
          {details.clientName || '—'}
        </span>
        <ChevronDown
          size={16}
          className={`ml-auto shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 px-4 pb-3 animate-fade-in">
          <ClientQuickSelect
            clients={clients}
            onSelect={(c) => {
              setDetail('clientName', c.legalEntity || c.accountName || '');
              setDetail('hotelName', c.propertyName || '');
              setDetail('address', c.address || '');
              setDetail('shippingAddress', c.address || '');
              setDetail('contactPerson', c.contactPerson || '');
              setDetail('designation', c.designation || '');
              setDetail('contactPhone', c.phone || '');
              setDetail('contactEmail', c.email || '');
              setDetail('placeOfSupply', c.placeOfSupply || details.placeOfSupply);
              const scMatch = String(c.placeOfSupply || '').match(/\\((\\d+)\\)/);
              setDetail('stateCode', scMatch ? scMatch[1] : details.stateCode || '27');
              setDetail('clientGstin', c.gstin || details.clientGstin || '');
              setDetail('quoteNo', (() => {
                const initials = clientInitials(c.propertyName || c.legalEntity || c.accountName || '');
                const year = new Date().getFullYear();
                const prefix = `AE/${initials}/${year}-`;
                let max = 0;
                for (const q of archive) {
                  const qn = String(q.quoteNo || '');
                  if (qn.startsWith(prefix)) {
                    const m = qn.match(/-(\\d+)\\s*$/);
                    if (m) max = Math.max(max, Number(m[1]));
                  }
                }
                return `${prefix}${String(max + 1).padStart(3, '0')}`;
              })());
              onClientSelect?.(c);
            }}
            onClear={() => {
              setDetail('clientName', '');
              setDetail('hotelName', '');
              setDetail('address', '');
              setDetail('shippingAddress', '');
              setDetail('contactPerson', '');
              setDetail('designation', '');
              setDetail('contactPhone', '');
              setDetail('contactEmail', '');
              setDetail('clientGstin', '');
              setDetail('clientPan', '');
              setDetail('stateCode', '27');
              onClientClear?.();
            }}
          />

          <ClientPricingMemory
            client={selectedClient}
            onSave={(value) =>
              onUpdateClientDiscount?.(selectedClient?.id, value)
            }
          />

          {/* Bill-to */}
          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            <Building2 size={11} /> Bill To
          </p>
          <DetailField label="Client / Company Name">
            <input
              value={details.clientName}
              onChange={(e) => setDetail('clientName', e.target.value)}
              placeholder="EON HINJEWADI INFRASTRUCTURE PVT. LTD."
              className={detailInputCls}
            />
          </DetailField>
          <DetailField label="Hotel / Unit Name">
            <input
              value={details.hotelName}
              onChange={(e) => setDetail('hotelName', e.target.value)}
              placeholder="COURTYARD BY MARRIOTT PUNE, HINJEWADI"
              className={detailInputCls}
            />
          </DetailField>
          <DetailField label="Billing Address">
            <textarea
              value={details.address}
              onChange={(e) => setDetail('address', e.target.value)}
              placeholder="Plot / Street, Area, City - PIN"
              rows={2}
              className={`${detailInputCls} resize-y`}
            />
          </DetailField>
          <DetailField label="Shipping / Property Delivery Address">
            <textarea
              value={details.shippingAddress}
              onChange={(e) => setDetail('shippingAddress', e.target.value)}
              placeholder="Property delivery address"
              rows={2}
              className={`${detailInputCls} resize-y`}
            />
          </DetailField>
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="Client GSTIN">
              <input
                value={details.clientGstin}
                onChange={(e) => setDetail('clientGstin', e.target.value.toUpperCase())}
                placeholder="27XXXXX0000X1Z5"
                className={`${detailInputCls} font-mono`}
              />
            </DetailField>
            <DetailField label="State Code">
              <input
                value={details.stateCode}
                onChange={(e) => setDetail('stateCode', e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="27"
                className={`${detailInputCls} font-mono`}
              />
            </DetailField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="PAN">
              <input
                value={details.clientPan}
                onChange={(e) => setDetail('clientPan', e.target.value.toUpperCase())}
                placeholder="ABCDE1234F"
                className={`${detailInputCls} font-mono`}
              />
            </DetailField>
            <DetailField label="Attention Contact Person">
              <input
                value={details.contactPerson}
                onChange={(e) => setDetail('contactPerson', e.target.value)}
                placeholder="Name"
                className={detailInputCls}
              />
            </DetailField>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="Designation">
              <input
                value={details.designation}
                onChange={(e) => setDetail('designation', e.target.value)}
                placeholder="CLUSTER PURCHASE MANAGER"
                className={detailInputCls}
              />
            </DetailField>
            <DetailField label="Attention Email">
              <input
                type="email"
                value={details.contactEmail}
                onChange={(e) => setDetail('contactEmail', e.target.value)}
                placeholder="name@company.com"
                className={detailInputCls}
              />
            </DetailField>
          </div>
          <DetailField label="Contact Phone">
            <input
              value={details.contactPhone}
              onChange={(e) => setDetail('contactPhone', e.target.value)}
              placeholder="+91 9xxxxxxxxx"
              className={detailInputCls}
            />
          </DetailField>

          {/* Metadata */}
          <p className="mt-1 flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            <CalendarDays size={11} /> Quotation Metadata
          </p>
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="Quotation No">
              <input
                value={details.quoteNo}
                onChange={(e) => setDetail('quoteNo', e.target.value)}
                placeholder="AE/QTN/2026-001"
                className={`${detailInputCls} font-mono`}
              />
            </DetailField>
            <DetailField label="Quotation Date">
              <input
                type="date"
                value={details.quoteDate}
                onChange={(e) => setDetail('quoteDate', e.target.value)}
                className={detailInputCls}
              />
            </DetailField>
          </div>
          <DetailField label="Delivery Timeline">
            <input
              value={details.delivery}
              onChange={(e) => setDetail('delivery', e.target.value)}
              placeholder="7 to 10 Working Days from PO"
              className={detailInputCls}
            />
          </DetailField>
          <DetailField label="Payment Terms">
            <input
              value={details.payment}
              onChange={(e) => setDetail('payment', e.target.value)}
              placeholder="100% Advance along with PO"
              className={detailInputCls}
            />
          </DetailField>
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="Place of Supply">
              <input
                value={details.placeOfSupply}
                onChange={(e) => setDetail('placeOfSupply', e.target.value)}
                placeholder="Maharashtra (27)"
                className={detailInputCls}
              />
            </DetailField>
            <DetailField label="Validity">
              <input
                value={details.validity}
                onChange={(e) => setDetail('validity', e.target.value)}
                placeholder="15 Days"
                className={detailInputCls}
              />
            </DetailField>
          </div>
          <DetailField label="Freight / Transport Charges (₹) (0 = Included)">
            <input
              type="number"
              min={0}
              value={details.freight}
              onChange={(e) =>
                setDetail('freight', Math.max(0, Number(e.target.value) || 0))
              }
              className={`${detailInputCls} tabular-nums`}
            />
          </DetailField>

          <button
            onClick={onReset}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-500 transition hover:border-slate-400 hover:text-slate-800"
          >
            <RotateCcw size={12} /> Reset details to defaults
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- product card ---------------- */

function ProductCard({ product, qty, onAdd, onInc, onDec, onEdit, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [inputQty, setInputQty] = useState(qty > 0 ? qty : 1);
  useEffect(() => {
    if (qty > 0) setInputQty(qty);
  }, [qty]);
  const discount =
    product.mrp > product.sellingPrice
      ? Math.round((1 - product.sellingPrice / product.mrp) * 100)
      : 0;

  const handleCopy = async () => {
    const ok = await copyText(product.sku);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:shadow-md">
      {/* image area */}
      <div className="relative mb-3 flex h-44 w-full items-center justify-center overflow-hidden rounded-xl bg-white">
        <ProductImage product={product} />
        <span
          className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide shadow-sm ${BRAND_STYLE[product.brand] || 'bg-slate-800 text-white'}`}
        >
          {product.brand}
        </span>
        {product.custom && (
          <span className="absolute left-2 bottom-2 rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-sm">
            Custom
          </span>
        )}
        <button
          onClick={onEdit}
          title="Edit product"
          className="absolute right-2 top-2 z-10 rounded-md bg-white/95 p-1.5 text-slate-600 shadow-sm opacity-0 transition group-hover:opacity-100 hover:bg-slate-900 hover:text-white"
        >
          <Pencil size={13} />
        </button>
        {product.custom && (
          <span className="absolute right-2 bottom-2 flex gap-1">
            <button
              onClick={onDelete}
              title="Delete product"
              className="rounded-md bg-white/95 p-1.5 text-slate-600 shadow-sm transition hover:bg-red-600 hover:text-white"
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
        {discount > 0 && (
          <span className="absolute right-2 top-2 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm transition group-hover:opacity-0">
            -{discount}%
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col">
        {/* SKU row */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 no-underline [text-decoration:none]">
            {product.sku}
          </span>
          <button
            onClick={handleCopy}
            title="Copy SKU"
            className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {copied ? (
              <Check size={13} className="text-emerald-600" />
            ) : (
              <Copy size={13} />
            )}
          </button>
          {copied && (
            <span className="text-[11px] font-medium text-emerald-600">Copied</span>
          )}
          <span className="ml-auto rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            HSN {product.hsn}
          </span>
        </div>

        {/* title 2-line clamp */}
        <h3
          title={product.name}
          className="text-sm font-semibold text-slate-900 leading-snug line-clamp-none min-h-[3.75rem] flex items-start break-words"
        >
          {product.name}
        </h3>
        <p className="mt-1 block text-[11px] font-medium text-slate-400 uppercase tracking-wider">
          {product.category}
        </p>

        {/* footer: pricing + CTA aligned across every row */}
        <div className="mt-auto border-t border-slate-100 pt-3">
          {/* pricing */}
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-base font-bold text-slate-900">
              {fmt(product.sellingPrice)}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200/60">
              +{product.gst} GST
            </span>
          </div>
          {product.mrp > product.sellingPrice && (
            <div className="mb-2 text-[11px] text-slate-400 line-through">
              {fmt(product.mrp)}
            </div>
          )}

          {/* add / counter */}
          {qty === 0 ? (
            <div className="flex items-center gap-1.5 w-full">
              <input
                type="number"
                min={1}
                value={inputQty}
                onChange={(e) =>
                  setInputQty(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-10 sm:w-12 h-8 text-center text-xs font-semibold border border-slate-200 rounded-md"
                aria-label="Quantity to add"
              />
              <button
                onClick={() => onAdd(Math.max(1, Number(inputQty) || 1))}
                className="flex-1 h-8 px-2 bg-slate-900 text-white rounded-md text-xs font-semibold flex items-center justify-center gap-1 hover:bg-slate-800 active:scale-95 transition-all"
              >
                <ShoppingCart className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Add to Quote</span><span className="sm:hidden">Add</span>
              </button>
            </div>
          ) : (
            <div className="mt-2 flex w-full items-center justify-between rounded-lg border-2 border-slate-900 bg-slate-50 px-1 py-1">
              <button
                onClick={onDec}
                className="flex h-7 w-8 items-center justify-center rounded-md bg-white text-slate-900 shadow-sm transition hover:bg-slate-200"
                aria-label="Decrease quantity"
              >
                <Minus size={15} />
              </button>
              <span className="text-sm font-extrabold tabular-nums">
                {qty} in Quote
              </span>
              <button
                onClick={onInc}
                className="flex h-7 w-8 items-center justify-center rounded-md bg-slate-900 text-white shadow-sm transition hover:bg-slate-700"
                aria-label="Increase quantity"
              >
                <Plus size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- login view ---------------- */

function LoginArtwork() {
  return (
    <svg
      viewBox="0 0 720 900"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="login-gold-line" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C9A66B" stopOpacity="0.7" />
          <stop offset="1" stopColor="#C9A66B" stopOpacity="0.12" />
        </linearGradient>
        <radialGradient id="login-navy-glow" cx="50%" cy="42%" r="58%">
          <stop offset="0" stopColor="#2B4467" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0E1A2B" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="720" height="900" fill="url(#login-navy-glow)" />

      {/* architectural curves */}
      <g stroke="url(#login-gold-line)" strokeWidth="1.1" opacity="0.5">
        <path d="M-70 720C90 470 300 430 470 620s230 200 350-20" />
        <path d="M-40 770C120 520 320 480 500 660s220 190 340-10" opacity="0.65" />
        <path d="M520-40c-50 170 20 300 200 370" />
        <path d="M560-40c-50 160 10 280 180 340" opacity="0.55" />
      </g>

      {/* faint architectural uprights */}
      <g stroke="#C9A66B" strokeWidth="0.7" opacity="0.16">
        <path d="M120 0v900" />
        <path d="M160 0v900" />
        <path d="M600 0v900" />
      </g>

      {/* hotel luggage trolley */}
      <g
        stroke="#C9A66B"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.72"
      >
        <path d="M470 545v-70c0-12 10-22 22-22h26" />
        <path d="M518 453h-7" />
        <path d="M470 545h150v145" />
        <path d="M500 545v145" />
        <path d="M620 545v145" />
        <path d="M500 690h120" />
        <circle cx="500" cy="735" r="20" />
        <circle cx="620" cy="735" r="20" />
        <path d="M480 735h-12" />
        <path d="M640 735h12" />
        <rect x="492" y="500" width="106" height="45" rx="6" />
        <path d="M492 520h106" />
        <path d="M512 500v-10h20v10" />
        <rect x="500" y="565" width="90" height="55" rx="6" />
        <path d="M500 585h90" />
        <path d="M522 565v-10h18v10" />
        <path d="M535 620v14" />
      </g>

      {/* decorative indoor plant */}
      <g stroke="#C9A66B" strokeWidth="1.2" strokeLinecap="round" opacity="0.42">
        <path d="M110 790h54l-8 54h-38z" />
        <path d="M137 790v-48" />
        <path d="M137 755c-18-6-28-20-26-38 18 3 28 17 26 38z" />
        <path d="M137 735c14-8 22-22 18-40-16 5-24 19-18 40z" />
        <path d="M137 712c-12-8-16-22-10-36 14 7 18 21 10 36z" />
      </g>

      <g fill="#C9A66B" opacity="0.28">
        <circle cx="80" cy="120" r="2" />
        <circle cx="100" cy="140" r="1.5" />
        <circle cx="640" cy="180" r="2" />
      </g>
    </svg>
  );
}

function LoginAccountSelector({ selectedIndex, onSelect }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState('down');
  const [activeIndex, setActiveIndex] = useState(selectedIndex ?? 0);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const selectedUser =
    selectedIndex === null || selectedIndex === undefined
      ? null
      : AUTH_USERS[selectedIndex];

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow < 260 && spaceAbove > 220 ? 'up' : 'down');
    }
    setActiveIndex(selectedIndex ?? 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex ?? 0);
  }, [open, selectedIndex]);

  const focusOption = (index) => {
    const next = (index + AUTH_USERS.length) % AUTH_USERS.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const choose = (index) => {
    onSelect(index);
    setOpen(false);
    setActiveIndex(index);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e) => {
    if (
      !open &&
      (e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' ')
    ) {
      e.preventDefault();
      openMenu();
      requestAnimationFrame(() =>
        optionRefs.current[selectedIndex ?? 0]?.focus(),
      );
    }
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(activeIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusOption(activeIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusOption(AUTH_USERS.length - 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="login-account-list"
        className={`flex w-full items-center gap-3 rounded-2xl border border-white/80 bg-white/55 px-3.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-md transition duration-200 hover:bg-white/70 focus:border-[#14253D]/35 focus:bg-white/75 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#14253D]/10 ${
          open ? 'border-[#14253D]/25 bg-white/75 ring-4 ring-[#14253D]/5' : ''
        }`}
      >
        {selectedUser ? (
          <>
            <span
              aria-hidden="true"
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${selectedUser.avatarBg} text-[13px] font-extrabold text-white shadow-sm`}
            >
              {selectedUser.initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-[#17263C]">
                {selectedUser.name}
              </span>
              <span className="block truncate text-[11px] font-medium text-[#66758A]">
                {selectedUser.role || selectedUser.email}
              </span>
            </span>
          </>
        ) : (
          <>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/60 text-[#66758A]">
              <User size={17} />
            </span>
            <span className="flex-1 text-[13px] font-semibold text-[#66758A]">
              Select your account
            </span>
          </>
        )}
        <ChevronDown
          size={16}
          className={`shrink-0 text-[#66758A] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id="login-account-list"
          role="listbox"
          aria-label="Select your account"
          onKeyDown={handleMenuKeyDown}
          className={`login-glass-menu login-dropdown-in absolute left-0 right-0 z-40 overflow-hidden rounded-2xl p-1.5 ${
            placement === 'up'
              ? 'login-dropdown-up bottom-full mb-2 origin-bottom'
              : 'top-full mt-2 origin-top'
          }`}
        >
          {AUTH_USERS.map((u, idx) => {
            const active = selectedIndex === idx;
            return (
              <div key={u.email}>
                {idx > 0 && <div className="mx-3 h-px bg-slate-200/70" />}
                <button
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(idx)}
                  onFocus={() => setActiveIndex(idx)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14253D]/25 ${
                    active
                      ? 'bg-white/80 ring-1 ring-[#14253D]/10'
                      : 'hover:bg-white/60'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${u.avatarBg} text-sm font-extrabold text-white shadow-sm`}
                  >
                    {u.initial}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-[#17263C]">
                      {u.name}
                    </span>
                    <span className="block truncate text-[11px] font-medium text-[#66758A]">
                      {u.role || u.email}
                    </span>
                  </span>
                  {active && (
                    <Check size={15} className="shrink-0 text-[#16A45B]" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoginView({ onLogin }) {
  const [selected, setSelected] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef(null);

  const user =
    selected === null || selected === undefined ? null : AUTH_USERS[selected];

  const selectAccount = (index) => {
    setSelected(index);
    setPassword('');
    setError('');
    setShowPass(false);
    window.setTimeout(() => passwordRef.current?.focus(), 80);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!user || !password.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const valid = await verifyPasswordHash(user.passwordHash, password);
      if (!valid) {
        setError('Invalid password. Please try again.');
        setSubmitting(false);
        return;
      }
      onLogin({
        email: user.email,
        name: user.name,
        role: user.role,
      });
    } catch (err) {
      console.error('login error', err);
      setError('Unable to sign in right now. Please try again.');
      setSubmitting(false);
    }
  };

  const canSubmit = Boolean(user && password.trim() && !submitting);

  return (
    <div
      className="login-page relative flex min-h-[100dvh] w-full flex-col overflow-x-hidden bg-[#EAF0F6] md:flex-row"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* LEFT PANEL — Modern Workspace */}
      <aside className="relative hidden shrink-0 overflow-hidden bg-[#0E1A2B] md:flex md:w-[36%] lg:w-[40%] xl:w-[42%]">
        <div className="login-navy-aurora absolute inset-0" />
        <LoginArtwork />
        <div className="relative z-10 flex h-full w-full flex-col justify-between p-7 lg:p-10 xl:p-14">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A66B]/50 text-[13px] font-extrabold tracking-wide text-[#C9A66B]"
            >
              AE
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-white/55">
                Aadi Enterprises
              </p>
              <p className="mt-0.5 text-[10px] font-medium tracking-wide text-white/30">
                Pune · Hospitality supply
              </p>
            </div>
          </div>

          <div className="max-w-md">
            <h1 className="text-3xl font-extrabold leading-[1.1] tracking-[-0.03em] text-white sm:text-4xl lg:text-[42px] xl:text-5xl">
              Aadi Enterprises
            </h1>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.32em] text-[#C9A66B]">
              Quotation System
            </p>
            <div className="my-5 h-px w-20 bg-gradient-to-r from-[#C9A66B] to-transparent" />
            <p className="max-w-sm text-sm leading-relaxed text-white/60 lg:text-[15px]">
              Create, manage and share quotations for hospitality projects.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/30">
            <span className="h-1.5 w-1.5 rounded-full bg-[#C9A66B]" />
            Premium hospitality supply partner
          </div>
        </div>
      </aside>

      {/* RIGHT PANEL — Liquid Glass Login */}
      <div className="relative flex min-h-[100dvh] w-full flex-col md:w-[64%] lg:w-[60%] xl:w-[58%]">
        {/* compact mobile branding */}
        <div className="relative overflow-hidden bg-[#0E1A2B] px-5 pb-9 pt-[max(1.5rem,env(safe-area-inset-top))] md:hidden">
          <div className="absolute -right-10 -top-16 h-48 w-48 rounded-full border border-[#C9A66B]/20" />
          <div className="absolute -right-4 -top-8 h-32 w-32 rounded-full border border-[#C9A66B]/15" />
          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-white/95 shadow-sm">
              <img
                src={`${import.meta.env.BASE_URL}aadi-logo.png`}
                alt="Aadi Enterprises"
                className="h-8 w-auto object-contain"
              />
            </div>
            <div>
              <p className="text-[15px] font-extrabold text-white">
                Aadi Enterprises
              </p>
              <p className="text-[11px] font-medium text-white/55">
                Quotation System
              </p>
            </div>
          </div>
          <div className="mt-5 h-px w-14 bg-gradient-to-r from-[#C9A66B] to-transparent" />
          <p className="mt-3 max-w-xs text-[12px] leading-relaxed text-white/55">
            Create, manage and share quotations for hospitality projects.
          </p>
        </div>

        <main className="relative -mt-5 flex flex-1 items-start justify-center rounded-t-[28px] bg-[#EAF0F6] px-4 pb-8 pt-6 sm:px-6 sm:pt-8 md:mt-0 md:items-center md:rounded-none md:px-8 md:py-10 lg:px-12 xl:px-16">
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-[28px] md:rounded-none">
            <div
              className="login-aurora absolute -left-24 top-10 h-[22rem] w-[22rem] rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(37,99,235,.14), rgba(37,99,235,0) 68%)',
              }}
            />
            <div
              className="login-aurora login-aurora-slow absolute -right-24 bottom-0 h-[24rem] w-[24rem] rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(201,166,107,.18), rgba(201,166,107,0) 68%)',
              }}
            />
            <div
              className="absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(20,37,61,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20,37,61,.04) 1px, transparent 1px)',
                backgroundSize: '42px 42px',
              }}
            />
          </div>

          <div className="login-glass login-card-in relative z-10 w-full max-w-md rounded-[28px] p-6 sm:p-8 lg:p-9">
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/80 bg-white/85 shadow-[0_10px_24px_-16px_rgba(20,37,61,.45)]">
                <img
                  src={`${import.meta.env.BASE_URL}aadi-logo.png`}
                  alt="Aadi Enterprises"
                  className="h-12 w-auto object-contain"
                />
              </div>
              <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-[#17263C] sm:text-[28px]">
                Quotation System
              </h1>
              <p className="mt-1.5 text-[13px] font-medium text-[#66758A] sm:text-sm">
                Sign in to continue
              </p>
            </div>

            <div className="mt-7">
              <LoginAccountSelector
                selectedIndex={selected}
                onSelect={selectAccount}
              />
            </div>

            {user && (
              <form onSubmit={submit} className="login-field-in mt-4 space-y-4">
                <div className="flex items-center gap-2 px-1 text-[11px] font-medium text-[#66758A]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#16A45B]" />
                  Signing in as{' '}
                  <span className="font-bold text-[#17263C]">{user.name}</span>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-[#66758A]"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <Lock
                      size={17}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#66758A]"
                    />
                    <input
                      id="login-password"
                      ref={passwordRef}
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="Enter password"
                      autoComplete="current-password"
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? 'login-error' : undefined}
                      className={`w-full rounded-2xl border bg-white/60 py-3 pl-11 pr-12 text-sm font-medium text-[#17263C] shadow-[inset_0_1px_0_rgba(255,255,255,.8)] placeholder:text-[#66758A]/60 focus:bg-white/80 focus:outline-none focus:ring-4 ${
                        error
                          ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                          : 'border-white/80 focus:border-[#14253D]/40 focus:ring-[#14253D]/10'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl text-[#66758A] transition duration-200 hover:bg-white/70 hover:text-[#17263C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#14253D]/25"
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                      aria-pressed={showPass}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {error && (
                    <p
                      id="login-error"
                      role="alert"
                      className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-rose-600"
                    >
                      <AlertCircle size={13} /> {error}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[#14253D] px-4 py-3 text-sm font-bold text-white shadow-[0_14px_30px_-14px_rgba(20,37,61,.75)] transition duration-200 hover:bg-[#0E1A2B] hover:shadow-[0_18px_36px_-16px_rgba(20,37,61,.8)] active:scale-[.99] disabled:cursor-not-allowed disabled:bg-[#14253D]/45 disabled:shadow-none"
                >
                  {submitting ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <LogIn
                      size={17}
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  )}
                  {submitting ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-[10.5px] font-medium tracking-wide text-[#66758A]/75">
              Authorised access only · Aadi Enterprises
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ---------------- main app ---------------- */

const PAGE_SIZE = 60;

export default function App() {
  const [authUser, setAuthUser] = useState(loadAuthUser);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');
  const [catQuery, setCatQuery] = useState('');
  const [brands, setBrands] = useState([]); // [] = all
  const [cats, setCats] = useState([]);
  const [sort, setSort] = useState('relevance');
  const [customProducts, setCustomProducts] = useState(loadCustomProducts);
  const [itemSpecs, setItemSpecs] = useState({});
  const [clients, setClients] = useState(BASE_CLIENTS);
  const [productOverrides, setProductOverrides] = useState({});
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [boqOpen, setBoqOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ name: '', phone: '', password: '' });

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const close = (e) => {
      const menus = document.querySelectorAll('[data-account-menu]');
      let inside = false;
      menus.forEach((m) => {
        if (m.contains(e.target)) inside = true;
      });
      if (!inside) setIsAccountMenuOpen(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') setIsAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [isAccountMenuOpen]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [minPrice, setMinPrice] = useState(GLOBAL_MIN);
  const [maxPrice, setMaxPrice] = useState(GLOBAL_MAX);
  const [cart, setCart] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('quote-cart') || '{}');
    } catch {
      return {};
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState(loadDetails);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [archive, setArchive] = useState([]);
  const [currentQuoteId, setCurrentQuoteId] = useState(null);
  const [currentIsInvoice, setCurrentIsInvoice] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchRaw.trim().toLowerCase());
      setVisible(PAGE_SIZE);
    }, 250);
    return () => clearTimeout(t);
  }, [searchRaw]);

  useEffect(() => {
    try {
      localStorage.setItem('quote-cart', JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  useEffect(() => {
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
    } catch {
      /* ignore */
    }
  }, [details]);

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customProducts));
    } catch {
      /* ignore */
    }
  }, [customProducts]);

  // real-time Firestore sync for quotations
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'quotations'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = new Date(a.timestamp || a.updatedAt || a.createdAt || 0).getTime();
          const tb = new Date(b.timestamp || b.updatedAt || b.createdAt || 0).getTime();
          return tb - ta;
        });
        setArchive(list);
      },
      (err) => console.error('quotations snapshot error', err),
    );
    return () => unsub();
  }, []);

  // real-time Firestore sync for product overrides
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'product_overrides'),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          map[d.id] = d.data();
        });
        setProductOverrides(map);
      },
      (err) => console.error('product_overrides snapshot error', err),
    );
    return () => unsub();
  }, []);

  // real-time Firestore sync for clients
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        if (snap.size > 0) {
          const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setClients(list);
        }
      },
      (err) => console.error('clients snapshot error', err),
    );
    return () => unsub();
  }, []);

  // product overrides are synced via Firestore (see above)

  useEffect(() => {
    try {
      if (authUser) localStorage.setItem(AUTH_KEY, JSON.stringify(authUser));
      else localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }, [authUser]);

  // base catalog + user-added products
  const catalog = useMemo(
    () => [
      ...customProducts,
      ...products.map((p) =>
        productOverrides[p.sku] ? { ...p, ...productOverrides[p.sku] } : p,
      ),
    ],
    [customProducts, productOverrides],
  );

  // catalogue-aware price bounds (custom products may exceed base JSON range)
  const catalogLo = useMemo(
    () => Math.floor(Math.min(...catalog.map((p) => Number(p.sellingPrice) || 0))),
    [catalog],
  );
  const catalogHi = useMemo(
    () => Math.ceil(Math.max(...catalog.map((p) => Number(p.sellingPrice) || 0))),
    [catalog],
  );

  // expand (never shrink) the active price filter when custom products
  // push past the current bounds so they stay visible in the grid
  useEffect(() => {
    setMinPrice((v) => Math.min(v, catalogLo));
    setMaxPrice((v) => Math.max(v, catalogHi));
  }, [catalogLo, catalogHi]);

  const setDetail = (key, value) =>
    setDetails((d) => ({ ...d, [key]: value }));

  const selectedClient = useMemo(
    () =>
      clients.find((c) => String(c.id) === String(selectedClientId)) || null,
    [clients, selectedClientId],
  );

  const applyClientSelection = (client) => {
    setSelectedClientId(client?.id ?? null);
    setDetail('marginPct', clientDefaultDiscount(client));
  };

  const clearClientSelection = () => {
    setSelectedClientId(null);
    setDetail('marginPct', 0);
  };

  const recordList = useMemo(
    () => archive.filter((q) => quoteMatchesStatusFilter(q, statusFilter)),
    [archive, statusFilter],
  );

  const statusCounts = useMemo(() => {
    const counts = {};
    for (const tab of QUOTE_STATUS_TABS) {
      counts[tab.key] = archive.filter(tab.match).length;
    }
    return counts;
  }, [archive]);

  const DETAIL_KEYS = [
    'clientName',
    'hotelName',
    'address',
    'shippingAddress',
    'clientGstin',
    'clientPan',
    'stateCode',
    'contactPerson',
    'designation',
    'contactPhone',
    'contactEmail',
    'quoteNo',
    'quoteDate',
    'delivery',
    'payment',
    'placeOfSupply',
    'validity',
    'freight',
    'marginPct',
  ];

  const buildQuoteObject = (statusOverride) => {
    const existing = currentQuoteId
      ? archive.find((q) => q.id === currentQuoteId)
      : null;
    const id = existing ? existing.id : `q_${Date.now()}`;
    const status =
      statusOverride ||
      (existing ? normalizeQuoteStatus(existing) : 'Draft');
    const quote = {
      id,
      quoteNo: details.quoteNo,
      clientName: details.clientName,
      hotelName: details.hotelName,
      address: details.address,
      shippingAddress: details.shippingAddress,
      clientGstin: details.clientGstin,
      clientPan: details.clientPan,
      stateCode: details.stateCode,
      contactPerson: details.contactPerson,
      designation: details.designation,
      contactPhone: details.contactPhone,
      contactEmail: details.contactEmail,
      quoteDate: details.quoteDate,
      delivery: details.delivery,
      payment: details.payment,
      placeOfSupply: details.placeOfSupply,
      validity: details.validity,
      freight: details.freight,
      marginPct: details.marginPct,
      items: lineItems.map((i) => ({ ...i })),
      itemCount,
      subtotal,
      gstTotal,
      grandTotal,
      status,
      createdBy: authUser?.name || existing?.createdBy || '',
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    return quote;
  };

  const persistArchive = (next) => {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const saveQuote = (statusOverride) => {
    if (lineItems.length === 0) {
      showToast('Add items before saving a quote');
      return null;
    }
    const quote = buildQuoteObject(statusOverride);
    setDoc(doc(db, 'quotations', quote.id), quote).catch((err) =>
      console.error('save quote error', err),
    );
    setCurrentQuoteId(quote.id);
    showToast(`Quote ${quote.quoteNo} saved (${quote.status})`);
    return quote;
  };

  const loadQuote = (q) => {
    const newDetails = { ...DEFAULT_DETAILS };
    for (const k of DETAIL_KEYS) {
      if (q[k] !== undefined) newDetails[k] = q[k];
    }
    setDetails(newDetails);
    const matchedClient = clients.find(
      (c) =>
        (q.clientName &&
          [c.legalEntity, c.accountName].filter(Boolean).includes(q.clientName)) ||
        (q.hotelName && c.propertyName === q.hotelName),
    );
    setSelectedClientId(matchedClient ? matchedClient.id : null);
    const newCart = {};
    const newSpecs = {};
    for (const item of q.items || []) {
      if (item?.sku) {
        newCart[item.sku] = item.qty || 1;
        newSpecs[item.sku] = {
          dimensionOrCapacity: item.dimensionOrCapacity || '',
          technicalSpec: item.technicalSpec || '',
          clientTag: item.clientTag || '',
          areaCategory: item.areaCategory || '',
        };
      }
    }
    setCart(newCart);
    setItemSpecs(newSpecs);
    setCurrentQuoteId(q.id);
    setCurrentIsInvoice(!!q.isInvoice);
    setDrawerOpen(false);
    setRecordsOpen(false);
    showToast(`Loaded quote ${q.quoteNo}`);
  };

  const updateQuoteStatus = (id, status) => {
    updateDoc(doc(db, 'quotations', id), {
      status,
      updatedAt: new Date().toISOString(),
    }).catch((err) => console.error('update status error', err));
    showToast(`Quote marked as ${status}`);
  };

  const requestDeleteQuote = (q) => setDeleteTarget(q);

  const deleteQuote = (id) => {
    deleteDoc(doc(db, 'quotations', id)).catch((err) =>
      console.error('delete quote error', err),
    );
    if (currentQuoteId === id) setCurrentQuoteId(null);
    showToast('Quote deleted');
  };

  const confirmDeleteQuote = () => {
    if (!deleteTarget) return;
    deleteQuote(deleteTarget.id);
    setDeleteTarget(null);
  };

  const duplicateQuote = (q) => {
    const base = String(q.quoteNo || 'AE/QTN/2026-001').replace(
      /-R\d+\s*$/i,
      '',
    );
    let maxRevision = 0;
    for (const item of archive) {
      const qn = String(item.quoteNo || '');
      if (qn === base) maxRevision = Math.max(maxRevision, 0);
      if (qn.startsWith(`${base}-R`)) {
        const n = Number(qn.slice(base.length + 2).trim());
        if (Number.isFinite(n)) maxRevision = Math.max(maxRevision, n);
      }
    }
    const quoteNo = `${base}-R${maxRevision + 1}`;
    const now = new Date().toISOString();
    const copy = {
      ...q,
      id: `q_${Date.now()}`,
      quoteNo,
      status: 'Draft',
      isInvoice: false,
      revisionOf: base,
      createdBy: authUser?.name || q.createdBy || '',
      createdAt: now,
      updatedAt: now,
      timestamp: now,
    };
    setDoc(doc(db, 'quotations', copy.id), copy).catch((err) =>
      console.error('duplicate quote error', err),
    );
    loadQuote(copy);
    showToast(`Revision ${quoteNo} created as draft`);
  };

  const sendQuoteWhatsApp = (q) => {
    const text = buildQuoteWhatsAppText(q);
    const digits = String(q.contactPhone || '').replace(/\D/g, '');
    const phone = digits.length === 10 ? `91${digits}` : digits;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast('Opening WhatsApp with quotation summary');
  };

  const updateClientDefaultDiscount = async (id, raw) => {
    if (id === undefined || id === null) return;
    const client = clients.find((c) => String(c.id) === String(id));
    if (!client) return;
    const n =
      raw === '' || raw === null || raw === undefined
        ? null
        : Math.min(100, Math.max(0, Number(raw) || 0));
    const next = { ...client, defaultDiscount: n };
    setClients((prev) =>
      prev.map((c) => (String(c.id) === String(id) ? next : c)),
    );
    try {
      await setDoc(doc(db, 'clients', String(id)), next, { merge: true });
      showToast(
        n === null
          ? 'Client default discount cleared'
          : `Client default discount set to ${n}%`,
      );
    } catch (err) {
      console.error('save client default discount error', err);
      showToast('Could not save client default discount');
    }
  };

  const convertToInvoice = (q) => {
    const invoice = {
      ...q,
      id: `inv_${Date.now()}`,
      quoteNo: String(q.quoteNo || '').replace('AE/QTN/', 'AE/INV/'),
      isInvoice: true,
      status: 'Invoice Generated',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    setDoc(doc(db, 'quotations', invoice.id), invoice).catch((err) =>
      console.error('convert invoice error', err),
    );
    showToast(`Converted to Tax Invoice ${invoice.quoteNo}`);
  };

  const reprintQuote = (q) => {
    loadQuote(q);
    setTimeout(() => window.print(), 200);
  };

  const openAddModal = () => {
    setEditingProduct(null);
    setAddModalOpen(true);
  };

  const handleAddClient = async (client) => {
    const id = client.id || `c_${Date.now()}`;
    const data = { ...client, id };
    try {
      await setDoc(doc(db, 'clients', String(id)), data);
    } catch (err) {
      console.error('save client error', err);
    }
    setClients((prev) => {
      if (prev.some((c) => String(c.id) === String(id))) return prev;
      return [...prev, data];
    });
    return id;
  };

  const handleBOQTransfer = (rows, selectedClient) => {
    const included = (rows || []).filter((r) => r.include);
    const skuMap = [];
    const newCustom = [];
    const toSave = [];
    included.forEach((r, idx) => {
      let sku = r.sku;
      const exists = catalog.some((p) => p.sku === sku);
      if (!sku || !exists) {
        sku = r.sku || `AE-CUST-${Date.now().toString().slice(-6)}-${idx}`;
        newCustom.push({
          brand: r.brand || 'Aadi',
          sku,
          name: r.description || 'BOQ Item',
          category: 'Custom Kitchen / Commercial',
          subcategory: '',
          hsn: r.hsn || '',
          gst: r.gst || '18%',
          mrp: Number(r.unitPrice) || 0,
          sellingPrice: Number(r.unitPrice) || 0,
          image: r.image || '',
          custom: true,
          createdAt: new Date().toISOString(),
        });
      }
      if (r.saveToCatalog) {
        toSave.push({
          brand: r.brand || 'Aadi',
          sku,
          name: r.description || 'BOQ Item',
          category: 'Custom Kitchen / Commercial',
          subcategory: '',
          hsn: r.hsn || '',
          gst: r.gst || '18%',
          mrp: Number(r.unitPrice) || 0,
          sellingPrice: Number(r.unitPrice) || 0,
          image: r.image || '',
          custom: true,
        });
      }
      skuMap.push({ r, sku });
    });

    setCart((prevCart) => {
      const next = { ...prevCart };
      skuMap.forEach(({ r, sku }) => {
        next[sku] = (next[sku] || 0) + (Number(r.qty) || 1);
      });
      return next;
    });

    setItemSpecs((prev) => {
      const next = { ...prev };
      skuMap.forEach(({ r, sku }) => {
        next[sku] = {
          dimensionOrCapacity: r.dimensionOrCapacity || '',
          technicalSpec: r.technicalSpec || '',
          clientTag: r.clientTag || '',
          areaCategory: r.areaCategory || '',
        };
      });
      return next;
    });

    if (newCustom.length) {
      setCustomProducts((prev) => [...newCustom, ...prev]);
    }
    toSave.forEach((prod) => {
      setDoc(doc(db, 'product_overrides', prod.sku), prod).catch((err) =>
        console.error('save boq product error', err),
      );
    });

    if (selectedClient) {
      const c = clients.find((x) => String(x.id) === String(selectedClient));
      if (c) {
        setDetail('clientName', c.legalEntity || c.accountName || '');
        setDetail('hotelName', c.propertyName || '');
        setDetail('address', c.address || '');
        setDetail('shippingAddress', c.shippingAddress || c.address || '');
        setDetail('clientGstin', c.gstin || '');
        setDetail('stateCode', c.stateCode || (String(c.placeOfSupply || '').match(/\((\d+)\)/)?.[1] || details.stateCode));
        setDetail('contactPerson', c.contactPerson || '');
        setDetail('designation', c.designation || '');
        setDetail('contactPhone', c.phone || '');
        setDetail('contactEmail', c.email || '');
        setDetail('placeOfSupply', c.placeOfSupply || details.placeOfSupply);
        setDetail('marginPct', clientDefaultDiscount(c));
        setSelectedClientId(c.id);
      }
    }
    setBoqOpen(false);
    setDrawerOpen(true);
    showToast(`Transferred ${included.length} BOQ items to quotation`);
  };

  const openEditModal = (p) => {
    setEditingProduct(p);
    setAddModalOpen(true);
  };

  const saveCustomProduct = (p) => {
    setCustomProducts((list) => {
      const idx = list.findIndex((x) => x.sku === p.sku);
      const saved = {
        ...p,
        createdAt:
          idx >= 0 ? list[idx].createdAt : new Date().toISOString(),
      };
      if (idx >= 0) {
        const next = [...list];
        next[idx] = saved;
        return next;
      }
      return [saved, ...list];
    });
    setAddModalOpen(false);
    showToast(
      editingProduct ? `${p.sku} updated` : `${p.sku} added to catalog`,
    );
    setEditingProduct(null);
  };

  const saveProduct = (p) => {
    if (p.custom) {
      setCustomProducts((list) => {
        const idx = list.findIndex((x) => x.sku === p.sku);
        const saved = {
          ...p,
          createdAt:
            idx >= 0 ? list[idx].createdAt : new Date().toISOString(),
        };
        if (idx >= 0) {
          const next = [...list];
          next[idx] = saved;
          return next;
        }
        return [saved, ...list];
      });
    } else {
      setDoc(doc(db, 'product_overrides', p.sku), p).catch((err) =>
        console.error('save product override error', err),
      );
    }
    setAddModalOpen(false);
    showToast('Product updated successfully');
    setEditingProduct(null);
  };

  const deleteCustomProduct = (p) => {
    if (
      !window.confirm(
        `Delete custom product "${p.name}" (${p.sku})? This cannot be undone.`,
      )
    )
      return;
    setCustomProducts((list) => list.filter((x) => x.sku !== p.sku));
    setCart((c) => {
      if (!(p.sku in c)) return c;
      const next = { ...c };
      delete next[p.sku];
      return next;
    });
    showToast(`${p.sku} deleted from catalog`);
  };

  const categories = useMemo(() => {
    const map = new Map();
    for (const p of catalog) map.set(p.category, (map.get(p.category) || 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  // dynamic brands pulled from data (order of first appearance), with counts
  const allBrands = useMemo(() => {
    const map = new Map();
    for (const p of catalog) map.set(p.brand, (map.get(p.brand) || 0) + 1);
    return [...map.entries()];
  }, [catalog]);

  const productBySku = useMemo(() => {
    const m = {};
    for (const p of catalog) m[p.sku] = p;
    return m;
  }, [catalog]);

  const filtered = useMemo(() => {
    let out = catalog;
    if (search) {
      const tokens = search.split(/\\s+/).filter(Boolean);
      out = out.filter((p) => {
        const hay = [p.name, p.brand, p.sku, p.category, p.subcategory, p.hsn]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
    if (brands.length)
      out = out.filter((p) => brands.includes(p.brand));
    if (cats.length) out = out.filter((p) => cats.includes(p.category));
    out = out.filter(
      (p) =>
        (Number(p.sellingPrice) || 0) >= minPrice &&
        (Number(p.sellingPrice) || 0) <= maxPrice,
    );
    if (sort === 'low-high')
      out = [...out].sort((a, b) => a.sellingPrice - b.sellingPrice);
    else if (sort === 'high-low')
      out = [...out].sort((a, b) => b.sellingPrice - a.sellingPrice);
    return out;
  }, [catalog, search, brands, cats, minPrice, maxPrice, sort]);

  const lineItems = useMemo(
    () =>
      Object.entries(cart)
        .map(([sku, qty]) => {
          const base = productBySku[sku];
          if (!base) return null;
          const specs = itemSpecs[sku] || {};
          return { ...base, ...specs, qty };
        })
        .filter((i) => i && i.qty > 0 && i.sku),
    [cart, productBySku, itemSpecs],
  );

  useEffect(() => {
    const handler = () => {
      if (lineItems.length > 0) saveQuote();
    };
    window.addEventListener('beforeprint', handler);
    return () => window.removeEventListener('beforeprint', handler);
  }, [lineItems, details, cart, saveQuote]);

  const itemCount = lineItems.reduce((s, i) => s + i.qty, 0);
  // quote-wide margin / discount applied on basic rates, before GST
  const marginPct = Number(details.marginPct) || 0;
  const adjFactor = 1 - marginPct / 100;
  const adjBasicOf = (i) => (Number(i.sellingPrice) || 0) * adjFactor;
  const subtotal = lineItems.reduce((s, i) => s + adjBasicOf(i) * i.qty, 0);
  const totalListPrice = lineItems.reduce((s, i) => s + (Number(i.sellingPrice) || 0) * i.qty, 0);
  const totalDiscountAmount = Math.max(0, totalListPrice - subtotal);
  const gstTotal = lineItems.reduce(
    (s, i) => s + adjBasicOf(i) * i.qty * parseGstRate(i.gst),
    0,
  );
  const freight = lineItems.length > 0 ? Number(details.freight) || 0 : 0;
  const grandTotal = subtotal + gstTotal + freight;
  const intraState = isIntraStateSupply(details.placeOfSupply, details.stateCode);
  const cgst = intraState ? gstTotal / 2 : 0;
  const sgst = intraState ? gstTotal / 2 : 0;
  const igst = intraState ? 0 : gstTotal;

  // print-ready per-line maths (basic excl-GST -> GST/unit -> inclusive -> line total)
  const printRows = lineItems.map((i, idx) => {
    const rate = parseGstRate(i.gst);
    const basic = adjBasicOf(i);
    const gstUnit = basic * rate;
    const incl = basic + gstUnit;
    return {
      ...i,
      sr: idx + 1,
      basic,
      gstUnit,
      incl,
      lineTotal: incl * i.qty,
    };
  });

  const setQty = (sku, qty) =>
    setCart((c) => {
      if (qty <= 0) {
        const n = { ...c };
        delete n[sku];
        return n;
      }
      return { ...c, [sku]: qty };
    });

  const resetFilters = () => {
    setSearchRaw('');
    setSearch('');
    setCatQuery('');
    setBrands([]);
    setCats([]);
    setSort('relevance');
    setMinPrice(catalogLo);
    setMaxPrice(catalogHi);
    setVisible(PAGE_SIZE);
  };

  const toggle = (list, setList, v) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /* ---- export: WhatsApp text ---- */
  const whatsappText = useMemo(() => {
    const lines = [
      `*QUOTATION — ${COMPANY.name}*`,
      `${COMPANY.tagline}, ${COMPANY.address} | ${COMPANY.phone}`,
      `Quote No: ${details.quoteNo} | Date: ${formatDateIN(details.quoteDate)}`,
      details.clientName ? `To: ${details.clientName}` : null,
      details.hotelName ? `Unit: ${details.hotelName}` : null,
      `Items: ${itemCount}`,
      '--------------------------------',
    ].filter(Boolean);
    lineItems.forEach((i, idx) => {
      const adj = adjBasicOf(i);
      lines.push(
        `${idx + 1}. ${i.name}`,
        `    ${i.brand} · ${i.sku} | Qty: ${i.qty} x ${fmt(adj)} = ${fmt(adj * i.qty)} (+${i.gst} GST)`,
      );
    });
    lines.push(
      '--------------------------------',
      marginPct !== 0
        ? `Basic Value (after ${marginLabel(marginPct)} margin): ${fmt(subtotal)}`
        : `Basic Value: ${fmt(subtotal)}`,
      intraState
        ? `CGST + SGST: ${inr2.format(gstTotal)}`
        : `IGST: ${inr2.format(gstTotal)}`,
    );
    if (freight > 0) lines.push(`Freight: ${fmt(freight)}`);
    lines.push(
      `*Grand Total (incl. GST): ${inr2.format(grandTotal)}*`,
      '',
      `Delivery: ${details.delivery} | Payment: ${details.payment} | Validity: ${details.validity}`,
    );
    return lines.join('\n');
  }, [lineItems, itemCount, subtotal, gstTotal, grandTotal, details, intraState, freight, marginPct, adjFactor]);

  const handleCopyWhatsapp = async () => {
    const ok = await copyText(whatsappText);
    showToast(
      ok ? 'WhatsApp text copied to clipboard' : 'Copy failed — select text manually',
    );
  };

  const filtersActive =
    brands.length + cats.length + (search ? 1 : 0) + (sort !== 'relevance' ? 1 : 0);

  const filterPanel = (
    <div className="flex flex-col gap-5">
      {/* brand */}
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
          <Building2 size={13} /> Brand
        </h3>
        <div className="flex flex-wrap gap-2">
          {allBrands.map(([b, n]) => {
            const active = brands.includes(b);
            return (
              <button
                key={b}
                onClick={() => toggle(brands, setBrands, b)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-full border-2 px-3.5 py-1.5 text-[13px] font-bold transition active:scale-95 ${
                  active
                    ? ACTIVE_PILL[b] || 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
                }`}
              >
                {b}
                <span
                  className={`rounded-full px-1.5 text-[11px] font-extrabold tabular-nums ${
                    active ? 'bg-black/15' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* category */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-500">
            <Package size={13} /> Category
          </h3>
          {cats.length > 0 && (
            <button
              onClick={() => setCats([])}
              className="text-[11px] font-bold text-slate-500 underline hover:text-slate-800"
            >
              Clear
            </button>
          )}
        </div>
        <div className="relative mb-1.5">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            placeholder={`Search ${categories.length} categories…`}
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-7 text-[13px] font-medium focus:border-slate-900 focus:outline-none"
            aria-label="Search categories"
          />
          {catQuery && (
            <button
              onClick={() => setCatQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label="Clear category search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1 nice-scroll">
          {categories
            .filter(([c]) =>
              c.toLowerCase().includes(catQuery.trim().toLowerCase()),
            )
            .map(([c, n]) => {
            const active = cats.includes(c);
            return (
              <button
                key={c}
                title={c}
                onClick={() => toggle(cats, setCats, c)}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] font-medium transition ${
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                <span className="truncate">{c}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {n}
                </span>
              </button>
            );
          })}
          {categories.filter(([c]) =>
            c.toLowerCase().includes(catQuery.trim().toLowerCase()),
          ).length === 0 && (
            <p className="rounded-lg bg-white px-3 py-4 text-center text-xs font-medium text-slate-400">
              No categories match “{catQuery}”
            </p>
          )}
        </div>
      </section>

      {/* sort */}
      <section>
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
          Price sort
        </h3>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {[
            { v: 'relevance', label: 'Popular', icon: null },
            { v: 'low-high', label: 'Low → High', icon: ArrowUpNarrowWide },
            { v: 'high-low', label: 'High → Low', icon: ArrowDownWideNarrow },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setSort(o.v)}
              className={`flex items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[12px] font-bold transition ${
                sort === o.v
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {o.icon && <o.icon size={13} />}
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* price range */}
      <section>
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
          Price range
        </h3>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <div className="relative w-full">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-400">
                ₹
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={groupNum(minPrice)}
                onChange={(e) =>
                  setMinPrice(
                    Math.max(catalogLo, Math.min(parseDigits(e.target.value), maxPrice)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-6 pr-2 text-[13px] font-semibold tabular-nums focus:border-slate-900 focus:outline-none"
                aria-label="Minimum price"
              />
            </div>
            <span className="text-slate-400">–</span>
            <div className="relative w-full">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[13px] font-bold text-slate-400">
                ₹
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={groupNum(maxPrice)}
                onChange={(e) =>
                  setMaxPrice(
                    Math.min(catalogHi, Math.max(parseDigits(e.target.value), minPrice)),
                  )
                }
                className="w-full rounded-lg border border-slate-200 py-1.5 pl-6 pr-2 text-[13px] font-semibold tabular-nums focus:border-slate-900 focus:outline-none"
                aria-label="Maximum price"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <input
              type="range"
              min={catalogLo}
              max={catalogHi}
              step={PRICE_STEP}
              value={minPrice}
              onChange={(e) =>
                setMinPrice(Math.min(Number(e.target.value), maxPrice))
              }
              className="price-range"
              aria-label="Min price slider"
            />
            <input
              type="range"
              min={catalogLo}
              max={catalogHi}
              step={PRICE_STEP}
              value={maxPrice}
              onChange={(e) =>
                setMaxPrice(Math.max(Number(e.target.value), minPrice))
              }
              className="price-range"
              aria-label="Max price slider"
            />
          </div>
          <p className="mt-2 text-center text-[12px] font-bold tabular-nums text-slate-700">
            {fmt(minPrice)} — {fmt(maxPrice)}
          </p>
        </div>
      </section>

      <button
        onClick={resetFilters}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
      >
        <RotateCcw size={14} /> Reset all filters
      </button>
    </div>
  );

  if (!authUser) {
    return <LoginView onLogin={setAuthUser} />;
  }

  return (
    <div className="min-h-screen">
      {/* ============ HEADER ============ */}
    <>
      {/* Mobile header */}
      <header className="no-print sticky top-0 z-40 md:hidden bg-white border-b border-slate-200 px-4 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}aadi-logo.png`} alt="Aadi Enterprises" className="h-7 w-auto object-contain" />
            <span className="text-sm font-bold text-slate-900">Aadi Quote</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex h-8 items-center gap-1 rounded-full bg-slate-900 px-3 text-[12px] font-bold text-white"
            >
              🛒 {itemCount} items
            </button>
            <button
              onClick={() => setIsAccountMenuOpen((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white ${
                authUser?.name === 'Aditya'
                  ? 'from-orange-500 to-amber-600'
                  : authUser?.name === 'Abhijit'
                  ? 'from-emerald-500 to-green-600'
                  : 'from-slate-700 to-slate-900'
              }`}
            >
              {String(authUser?.name || '?').charAt(0).toUpperCase()}
            </button>
            {isAccountMenuOpen && (
              <div data-account-menu className="absolute right-4 top-12 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 py-1.5 z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-900">{authUser?.name}</p>
                  <p className="text-[11px] text-slate-500">{authUser?.role || 'User'}</p>
                  <p className="text-[11px] text-slate-400">{authUser?.email || 'contact@aadienterprisespune.com'}</p>
                </div>
                <button
                  onClick={() => {
                    setSettingsForm({ name: authUser?.name || '', phone: authUser?.phone || '', password: '' });
                    setSettingsOpen(true);
                    setIsAccountMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <UserCircle size={15} /> Account Settings
                </button>
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={() => setAuthUser(null)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50"
                >
                  <LogOut size={15} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="relative w-full">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchRaw}
            onChange={(e) => setSearchRaw(e.target.value)}
            placeholder="Search products, SKUs, HSN..."
            className="w-full h-9 rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs font-medium focus:border-slate-900 focus:bg-white focus:outline-none"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto py-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
          <button
            onClick={() => setBoqOpen(true)}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-indigo-600 px-3 text-[12px] font-bold text-white"
          >
            📥 Import BOQ
          </button>
          <button
            onClick={openAddModal}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700"
          >
            + Product
          </button>
          <button
            onClick={() => setRecordsOpen(true)}
            className="relative flex h-8 shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700"
          >
            📋 Records
            {archive.length > 0 && (
              <span className="ml-1 rounded-full bg-[#C8102E] px-1.5 text-[9px] font-extrabold text-white">
                {archive.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Desktop header */}
      <header className="no-print sticky top-0 z-40 hidden md:flex h-16 px-6 bg-white border-b border-slate-200 items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <img src={`${import.meta.env.BASE_URL}aadi-logo.png`} alt="Aadi Enterprises" className="h-9 w-auto shrink-0 object-contain" />
        <div className="min-w-0">
          <h1 className="text-sm font-extrabold leading-tight text-slate-900">Aadi Enterprises</h1>
          <p className="text-[11px] font-medium text-slate-500">Quotation Portal</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
          {catalog.length} products
        </span>
      </div>
      <div className="relative max-w-md w-full">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={searchRaw}
          onChange={(e) => setSearchRaw(e.target.value)}
          placeholder="Search 777+ products, SKUs, HSN..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-16 text-sm font-medium focus:border-slate-900 focus:bg-white focus:outline-none"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
          Ctrl K
        </span>
        {searchRaw && (
          <button
            onClick={() => setSearchRaw('')}
            className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setBoqOpen(true)}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[.98]"
          title="Import BOQ / RFQ"
        >
          <UploadCloud size={15} />
          <span className="hidden sm:inline">Import BOQ</span>
        </button>
        <button
          onClick={openAddModal}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900 active:scale-[.98]"
          title="Add a custom product to the catalog"
        >
          <Plus size={15} />
          <span className="hidden sm:inline">+ Add Product</span>
        </button>
        <button
          onClick={() => setRecordsOpen(true)}
          className="relative flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-900 active:scale-[.98]"
          title="Quotation Records"
        >
          <ClipboardList size={15} />
          <span className="hidden sm:inline">Records</span>
          {archive.length > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C8102E] px-1 text-[9px] font-extrabold tabular-nums text-white">
              {archive.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3.5 text-white shadow-sm transition hover:bg-slate-700 active:scale-[.98]"
        >
          <ShoppingCart size={15} />
          <span className="text-[12px] font-extrabold tabular-nums">
            🛒 {itemCount} items • {fmt(grandTotal)}
          </span>
        </button>
        <div className="relative">
          <button
            onClick={() => setIsAccountMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 pl-1 pr-3 py-1 hover:bg-slate-100 transition-colors"
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white ${
                authUser?.name === 'Aditya'
                  ? 'from-orange-500 to-amber-600'
                  : authUser?.name === 'Abhijit'
                  ? 'from-emerald-500 to-green-600'
                  : 'from-slate-700 to-slate-900'
              }`}
            >
              {String(authUser?.name || '?').charAt(0).toUpperCase()}
            </span>
            <span className="text-xs font-semibold text-slate-800">{authUser?.name}</span>
          </button>
          {isAccountMenuOpen && (
            <div data-account-menu className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-2xl border border-slate-100 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-sm font-bold text-slate-900">{authUser?.name}</p>
                <p className="text-[11px] text-slate-500">{authUser?.role || 'User'}</p>
                <p className="text-[11px] text-slate-400">{authUser?.email || 'contact@aadienterprisespune.com'}</p>
              </div>
              <button
                onClick={() => {
                  setSettingsForm({ name: authUser?.name || '', phone: authUser?.phone || '', password: '' });
                  setSettingsOpen(true);
                  setIsAccountMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <UserCircle size={15} /> Account Settings
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button
                onClick={() => setAuthUser(null)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium text-rose-600 hover:bg-rose-50"
              >
                <LogOut size={15} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
    </>



      {/* ============ BODY ============ */}
      <div className="no-print mx-auto flex max-w-[1400px] gap-5 px-3 pb-4 pt-6 sm:px-5">
        {/* sidebar (desktop) */}
        <aside className="sticky top-[76px] hidden h-fit w-64 shrink-0 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 lg:block">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
              <SlidersHorizontal size={15} /> Filters
              {filtersActive > 0 && (
                <span className="rounded-full bg-slate-900 px-1.5 text-[11px] font-bold text-white">
                  {filtersActive}
                </span>
              )}
            </h2>
          </div>
          {filterPanel}
        </aside>

        {/* mobile filter toggle */}
        <div className="fixed bottom-4 left-4 z-30 lg:hidden">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-pop"
          >
            <SlidersHorizontal size={16} /> Filters
            {filtersActive > 0 && (
              <span className="rounded-full bg-white px-1.5 text-[11px] font-extrabold text-slate-900">
                {filtersActive}
              </span>
            )}
          </button>
        </div>
        {filtersOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-slate-900/50 animate-fade-in"
              onClick={() => setFiltersOpen(false)}
            />
            <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-slate-50 p-4 nice-scroll animate-slide-in">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-sm font-extrabold">
                  <SlidersHorizontal size={15} /> Filters
                </h2>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="rounded-full bg-slate-200 p-1.5"
                  aria-label="Close filters"
                >
                  <X size={16} />
                </button>
              </div>
              {filterPanel}
              <button
                onClick={() => setFiltersOpen(false)}
                className="mt-3 w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white"
              >
                Show {filtered.length} products
              </button>
            </div>
          </div>
        )}

        {/* grid */}
        <main className="min-w-0 flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
              <Package size={40} className="text-slate-300" />
              <p className="text-lg font-bold text-slate-700">No products found</p>
              <p className="max-w-sm text-sm text-slate-500">
                Try a different search term, or clear brand / category / price
                filters.
              </p>
              <button
                onClick={resetFilters}
                className="mt-1 flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
              >
                <RotateCcw size={14} /> Reset filters
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 pt-2 text-[13px] font-medium text-slate-500">
                Showing{' '}
                <strong className="text-slate-800">
                  {Math.min(visible, filtered.length)}
                </strong>{' '}
                of <strong className="text-slate-800">{filtered.length}</strong>{' '}
                products
                {itemCount > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    <strong className="text-slate-800">
                      {itemCount} in quote
                    </strong>
                  </>
                )}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4 2xl:grid-cols-5">
                {filtered.slice(0, visible).map((p) => (
                  <ProductCard
                    key={p.sku}
                    product={p}
                    qty={cart[p.sku] || 0}
                    onAdd={(q) => {
                      setQty(p.sku, Math.max(1, Number(q) || 1));
                      showToast(`${p.sku} added to quote`);
                    }}
                    onInc={() => setQty(p.sku, (cart[p.sku] || 0) + 1)}
                    onDec={() => setQty(p.sku, (cart[p.sku] || 0) - 1)}
                    onEdit={() => openEditModal(p)}
                    onDelete={p.custom ? () => deleteCustomProduct(p) : undefined}
                  />
                ))}
              </div>
              {visible < filtered.length && (
                <div className="mt-6 text-center">
                  <button
                    onClick={() =>
                      setVisible((v) => v + PAGE_SIZE)
                    }
                    className="rounded-xl border-2 border-slate-900 bg-white px-6 py-2.5 text-sm font-bold text-slate-900 transition hover:bg-slate-900 hover:text-white"
                  >
                    Load more ({filtered.length - visible} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ============ DRAWER ============ */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/50 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-pop animate-slide-in">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
              <FileText size={18} className="text-slate-700" />
              <h2 className="text-[15px] font-extrabold">Quotation</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                {itemCount} items
              </span>
              <span className="ml-auto max-w-[140px] truncate font-mono text-[11px] text-slate-400" title={details.quoteNo}>
                {details.quoteNo}
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close quotation"
              >
                <X size={18} />
              </button>
            </div>

            {/* scrollable middle: details form + line items */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain nice-scroll">
              {/* editable customer + quotation details */}
              <QuoteDetailsForm
                details={details}
                setDetail={setDetail}
                open={detailsOpen}
                onToggle={() => setDetailsOpen((v) => !v)}
                onReset={() => {
                  setDetails({ ...DEFAULT_DETAILS });
                  setSelectedClientId(null);
                  showToast('Details reset to defaults');
                }}
                archive={archive}
                clients={clients}
                selectedClient={selectedClient}
                onClientSelect={applyClientSelection}
                onClientClear={clearClientSelection}
                onUpdateClientDiscount={updateClientDefaultDiscount}
              />

              {lineItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
                  <ShoppingCart size={40} className="text-slate-200" />
                  <p className="font-bold text-slate-700">Your quote is empty</p>
                  <p className="text-sm text-slate-500">
                    Add products with “Add to Quote” to build your quotation.
                  </p>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
                  >
                    Browse products
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3 pr-1">
                  <ul className="flex flex-col gap-3">
                    {lineItems.map((i) => {
                      const adj = adjBasicOf(i);
                      return (
                      <li
                        key={i.sku}
                        className="flex gap-3 rounded-xl border border-slate-200 p-2.5"
                      >
                        <div className="h-14 w-14 shrink-0 overflow-hidden">
                          <ProductImage product={i} size="sm" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold" title={i.name}>
                            {i.name}
                          </p>
                          <p className="truncate whitespace-nowrap font-mono text-[11px] text-slate-500">
                            {i.sku} ·{' '}
                            {marginPct > 0 && (
                              <s className="text-slate-400">List: {fmt(i.sellingPrice)} </s>
                            )}
                            {marginPct > 0
                              ? `Disc (${marginPct}%): ${fmt(adj)} + ${i.gst} GST`
                              : `${fmt(adj)} +${i.gst} GST`}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                              <button
                                onClick={() => setQty(i.sku, i.qty - 1)}
                                className="rounded-md bg-white p-1 shadow-sm hover:bg-slate-200"
                                aria-label="Decrease"
                              >
                                <Minus size={13} />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={i.qty}
                                onChange={(e) =>
                                  setQty(i.sku, Math.max(1, Number(e.target.value) || 1))
                                }
                                className="w-12 bg-transparent text-center text-[13px] font-extrabold tabular-nums focus:outline-none"
                                aria-label={`Quantity for ${i.sku}`}
                              />
                              <button
                                onClick={() => setQty(i.sku, i.qty + 1)}
                                className="rounded-md bg-slate-900 p-1 text-white hover:bg-slate-700"
                                aria-label="Increase"
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                            <span className="ml-auto text-[13px] font-extrabold tabular-nums">
                              {fmt(adj * i.qty)}
                            </span>
                            <button
                              onClick={() => setQty(i.sku, 0)}
                              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              aria-label={`Remove ${i.sku}`}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                  <button
                    onClick={() => {
                      setCart({});
                      setItemSpecs({});
                      setCurrentQuoteId(null);
                      setCurrentIsInvoice(false);
                      setSelectedClientId(null);
                      showToast('Quote cleared');
                    }}
                    className="mt-3 flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-red-600"
                  >
                    <Trash2 size={12} /> Clear quote
                  </button>
                </div>
              )}
            </div>

            {lineItems.length > 0 && (
                <div className="flex-shrink-0 border-t border-slate-200 bg-white p-4 shadow-lg">
                  {/* margin / discount adjustment */}
                  <div className="mb-2.5 rounded-xl bg-slate-100 p-2.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                        Margin / Discount
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold tabular-nums ${
                          marginPct === 0
                            ? 'bg-slate-200 text-slate-600'
                            : marginPct > 0
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {marginLabel(marginPct)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {MARGIN_PRESETS.map((p) => (
                        <button
                          key={p}
                          onClick={() => setDetail('marginPct', p)}
                          aria-pressed={marginPct === p}
                          className={`rounded-lg px-2 py-1 text-[12px] font-extrabold tabular-nums transition active:scale-95 ${
                            marginPct === p
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-white text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {marginLabel(p)}
                        </button>
                      ))}
                      <div className="relative ml-auto">
                        <input
                          type="number"
                          step="0.5"
                          min={-100}
                          max={200}
                          value={details.marginPct}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setDetail(
                              'marginPct',
                              Number.isFinite(v)
                                ? Math.min(200, Math.max(-100, v))
                                : 0,
                            );
                          }}
                          className="w-20 rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-6 text-[12px] font-extrabold tabular-nums focus:border-slate-900 focus:outline-none"
                          aria-label="Custom margin or discount percent"
                          title="Custom %"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] font-bold text-slate-400">
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-[12px]">
                    <div className="flex justify-between text-slate-600">
                      <span>Total List Price (MRP)</span>
                      <span className="font-bold tabular-nums">{fmt(totalListPrice)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-600 font-semibold">
                      <span>Discount Applied ({marginPct}%)</span>
                      <span className="tabular-nums">-{fmt(totalDiscountAmount)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Taxable Basic Value</span>
                      <span className="font-bold tabular-nums">{fmt(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>{intraState ? 'CGST / SGST' : 'IGST'}</span>
                      <span className="font-bold tabular-nums">
                        {intraState ? `${inr2.format(cgst)} / ${inr2.format(sgst)}` : inr2.format(igst)}
                      </span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-extrabold">
                      <span>Grand Total</span>
                      <span className="tabular-nums">{inr2.format(grandTotal)}</span>
                    </div>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm">
                    {marginPct !== 0 && (
                      <div className="flex justify-between text-[13px] text-slate-500">
                        <dt>List price adjust ({marginLabel(marginPct)})</dt>
                        <dd className="font-bold tabular-nums">applied</dd>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <dt>Basic Value (excl. GST)</dt>
                      <dd className="font-bold tabular-nums">{fmt(subtotal)}</dd>
                    </div>
                    {intraState ? (
                      <>
                        <div className="flex justify-between text-slate-600">
                          <dt>CGST</dt>
                          <dd className="font-bold tabular-nums">{inr2.format(cgst)}</dd>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <dt>SGST</dt>
                          <dd className="font-bold tabular-nums">{inr2.format(sgst)}</dd>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-slate-600">
                        <dt>IGST</dt>
                        <dd className="font-bold tabular-nums">{inr2.format(igst)}</dd>
                      </div>
                    )}
                    {freight > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <dt>Freight / Delivery</dt>
                        <dd className="font-bold tabular-nums">{fmt(freight)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-extrabold">
                      <dt>Grand Total</dt>
                      <dd className="tabular-nums">{inr2.format(grandTotal)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        saveQuote();
                        window.print();
                      }}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-[13px] font-bold text-white transition hover:bg-slate-700"
                    >
                      <Printer size={15} /> Print / Save PDF
                    </button>
                    <button
                      onClick={() => saveQuote()}
                      className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2.5 text-[13px] font-bold text-white transition hover:bg-indigo-700"
                    >
                      <Archive size={15} /> Save Quote
                    </button>
                  </div>
                  <div className="mt-2">
                    <button
                      onClick={handleCopyWhatsapp}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2.5 text-[13px] font-bold text-white transition hover:brightness-95"
                    >
                      <MessageCircle size={15} /> Copy WhatsApp Text
                    </button>
                  </div>
                </div>
            )}
          </aside>
        </div>
      )}

      {/* ============ QUOTATION RECORDS DRAWER ============ */}
      {recordsOpen && (
        <div className="no-print fixed inset-0 z-[55]">
          <div
            className="absolute inset-0 bg-slate-900/50 animate-fade-in"
            onClick={() => setRecordsOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col bg-white shadow-pop animate-slide-in">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
              <ClipboardList size={18} className="text-slate-700" />
              <h2 className="text-[15px] font-extrabold">Quotation Records</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold tabular-nums text-slate-600">
                {archive.length} saved
              </span>
              <button
                onClick={() => setRecordsOpen(false)}
                className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Close records"
              >
                <X size={18} />
              </button>
            </div>

            {/* status filter tabs */}
            <div className="flex flex-shrink-0 flex-wrap gap-1 border-b border-slate-200 px-4 py-2">
              {QUOTE_STATUS_TABS.map((tab) => {
                const count = statusCounts[tab.key] || 0;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                      statusFilter === tab.key
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                        statusFilter === tab.key ? 'bg-white/20' : 'bg-white'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-auto nice-scroll">
              {recordList.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
                  <ClipboardList size={40} className="text-slate-200" />
                  <p className="font-bold text-slate-700">No quotations found</p>
                  <p className="text-sm text-slate-500">
                    Save or print a quote to see it here.
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-slate-50 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Quote No</th>
                      <th className="px-3 py-2">Client / Hotel Unit</th>
                      <th className="px-3 py-2 text-center">Items</th>
                      <th className="px-3 py-2 text-right">Grand Total (₹)</th>
                      <th className="px-3 py-2">Date & Timestamp</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordList.map((q) => {
                      const status = normalizeQuoteStatus(q);
                      return (
                        <tr
                          key={q.id}
                          className="border-t border-slate-100 hover:bg-slate-50/60"
                        >
                          <td className="px-3 py-2 font-mono text-[12px] font-bold">
                            {q.quoteNo}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-bold text-slate-800">
                              {q.clientName || '—'}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {q.hotelName}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            {q.itemCount ?? q.items?.length ?? 0}
                          </td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">
                            {inr2.format(q.grandTotal || 0)}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-500">
                            {formatDateIN(q.quoteDate)}
                            <br />
                            {q.timestamp
                              ? new Date(q.timestamp).toLocaleString('en-IN')
                              : ''}
                          </td>
                          <td className="px-3 py-2">
                            <QuoteStatusSelect
                              value={status}
                              onChange={(next) =>
                                updateQuoteStatus(q.id, next)
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <QuoteActionMenu
                              onLoad={() => loadQuote(q)}
                              onPrint={() => reprintQuote(q)}
                              onDuplicate={() => duplicateQuote(q)}
                              onWhatsApp={() => sendQuoteWhatsApp(q)}
                              onDelete={() => requestDeleteQuote(q)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* ============ DELETE QUOTATION CONFIRMATION MODAL ============ */}
      {deleteTarget && (
        <div className="no-print fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 animate-fade-in"
            onClick={() => setDeleteTarget(null)}
          />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-pop animate-fade-in">
            <div className="mb-2 flex items-center gap-2 text-rose-600">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100">
                <Trash2 size={16} />
              </span>
              <h2 className="text-[15px] font-extrabold">Delete quotation?</h2>
            </div>
            <p className="text-[13px] leading-relaxed text-slate-600">
              Delete{' '}
              <strong className="font-mono text-slate-900">
                {deleteTarget.quoteNo || 'this quotation'}
              </strong>
              {deleteTarget.clientName ? (
                <>
                  {' '}
                  for{' '}
                  <strong className="text-slate-900">
                    {deleteTarget.clientName}
                  </strong>
                </>
              ) : null}
              ? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-600 transition hover:border-slate-400"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteQuote}
                className="rounded-lg bg-rose-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ ADD / EDIT PRODUCT MODAL ============ */}
      {addModalOpen && (
        <AddProductModal
          key={editingProduct ? editingProduct.sku : 'new'}
          catalog={catalog}
          initial={editingProduct}
          onClose={() => {
            setAddModalOpen(false);
            setEditingProduct(null);
          }}
          onSave={saveProduct}
          onReset={
            editingProduct && !editingProduct.custom && productOverrides[editingProduct.sku]
              ? () => {
                  deleteDoc(
                    doc(db, 'product_overrides', editingProduct.sku),
                  ).catch((err) => console.error('reset override error', err));
                  setAddModalOpen(false);
                  setEditingProduct(null);
                  showToast('Product reset to default');
                }
              : undefined
          }
        />
      )}

      {/* BOQ Parser */}
      {boqOpen && (
        <BOQParser
          catalog={catalog}
          clients={clients}
          onTransfer={handleBOQTransfer}
          onAddClient={handleAddClient}
          onClose={() => setBoqOpen(false)}
        />
      )}

      {/* Account Settings Modal */}
      {settingsOpen && (
        <div className="no-print fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-pop">
            <h2 className="mb-3 text-[15px] font-extrabold">Account Settings</h2>
            <div className="space-y-2">
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Display Name</span>
                <input value={settingsForm.name} onChange={(e) => setSettingsForm((p) => ({ ...p, name: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Phone Number</span>
                <input value={settingsForm.phone} onChange={(e) => setSettingsForm((p) => ({ ...p, phone: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">New Password</span>
                <input type="password" value={settingsForm.password} onChange={(e) => setSettingsForm((p) => ({ ...p, password: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSettingsOpen(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-600 hover:border-slate-400">
                Cancel
              </button>
              <button
                onClick={() => {
                  setAuthUser((u) => ({ ...(u || {}), name: settingsForm.name || u?.name, phone: settingsForm.phone }));
                  setSettingsOpen(false);
                  showToast('Account settings updated');
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="no-print fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-fade-in">
          <p className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-[13px] font-bold text-white shadow-pop">
            <Check size={14} className="text-emerald-400" /> {toast}
          </p>
        </div>
      )}

      {/* ============ PRINT-ONLY: AADI ENTERPRISES OFFICIAL QUOTATION (A4) ============ */}
      <div className="print-only">
        <div className="ae-print w-full max-w-[210mm] mx-auto overflow-hidden text-slate-900 box-border" style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827', fontSize: 11 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '3px solid #0f172a', paddingBottom: 10 }}>
            <div style={{ flex: '1 1 55%' }}>
              <img
                src={`${import.meta.env.BASE_URL}aadi-logo.png`}
                alt="AADI ENTERPRISES"
                className="h-16 w-auto object-contain mb-1"
                style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 10.5, lineHeight: 1.55, color: '#334155' }}>
                {COMPANY.address} | GSTIN: {COMPANY.gstin} | {COMPANY.udyam}
                <br />
                {COMPANY.phone} | {COMPANY.email}
              </p>
            </div>
            <div style={{ flex: '0 0 42%' }}>
              <div style={{ background: '#0f172a', color: '#fff', textAlign: 'center', fontWeight: 800, fontSize: 14, letterSpacing: 2, padding: '4px 0' }}>
                {currentIsInvoice ? 'TAX INVOICE' : 'QUOTATION'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, marginTop: 4 }}>
                <tbody>
                  {[
                    [currentIsInvoice ? 'Invoice Date' : 'Quotation Date', formatDateIN(details.quoteDate)],
                    [currentIsInvoice ? 'Tax Invoice No' : 'Quotation No', details.quoteNo],
                    ['Delivery Timeline', details.delivery],
                    ['Payment Terms', details.payment],
                    ['Validity', details.validity],
                    ['Freight', details.freight > 0 ? inr2.format(details.freight) : 'Included'],
                    ['Place of Supply', details.placeOfSupply],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ border: '1px solid #94a3b8', padding: '3px 6px', background: '#f1f5f9', fontWeight: 700, width: '38%' }}>{k}</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '3px 6px' }}>{v || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bill To */}
          <div style={{ border: '1.5px solid #0f172a', borderRadius: 4, marginTop: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: '#0f172a', marginBottom: 4 }}>BILL TO / SHIP TO</div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>{details.clientName || '—'}</div>
            {details.hotelName && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>{details.hotelName}</div>
            )}
            {details.address && (
              <div style={{ fontSize: 10.5, color: '#334155', marginTop: 2, whiteSpace: 'pre-line' }}>
                <strong>Billing:</strong> {details.address}
              </div>
            )}
            {details.shippingAddress && details.shippingAddress !== details.address && (
              <div style={{ fontSize: 10.5, color: '#334155', marginTop: 2, whiteSpace: 'pre-line' }}>
                <strong>Shipping:</strong> {details.shippingAddress}
              </div>
            )}
            <div style={{ fontSize: 10.5, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {details.clientGstin && <span>GSTIN: <strong>{details.clientGstin}</strong></span>}
              {details.stateCode && <span> | State Code: <strong>{details.stateCode}</strong></span>}
              {details.clientPan && <span> | PAN: <strong>{details.clientPan}</strong></span>}
            </div>
            {(details.contactPerson || details.designation || details.contactEmail) && (
              <div style={{ fontSize: 10.5, color: '#334155' }}>
                Attention: {details.contactPerson}
                {details.designation ? ` (${details.designation})` : ''}
                {details.contactEmail ? ` | ${details.contactEmail}` : ''}
                {details.contactPhone ? ` | ${details.contactPhone}` : ''}
              </div>
            )}
          </div>

          {/* Itemized table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 9.5, tableLayout: 'fixed', wordBreak: 'break-word' }}>
            <thead>
              <tr style={{ background: '#0f172a', color: '#fff' }}>
                <th style={{ width: '5%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'center' }}>Sr.</th>
                <th style={{ width: '32%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'left' }}>Item Description</th>
                <th style={{ width: '15%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'center' }}>Make / Brand & SKU</th>
                <th style={{ width: '8%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'center' }}>Image</th>
                <th style={{ width: '10%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'right' }}>List Price (MRP)</th>
                <th style={{ width: '7%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'center' }}>Disc %</th>
                <th style={{ width: '11%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'right' }}>Best Unit Price</th>
                <th style={{ width: '5%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'center' }}>Qty</th>
                <th style={{ width: '12%', padding: '6px 4px', border: '1px solid #0f172a', fontSize: 9, textAlign: 'right' }}>Total (INR)</th>
              </tr>
            </thead>
            <tbody>
              {printRows.map((r) => {
                const listPrice = Number(r.mrp) || 0;
                const bestPrice = Number(r.basic) || 0;
                const discPct = listPrice > 0 ? Math.max(0, Math.round((1 - bestPrice / listPrice) * 100)) : 0;
                return (
                <tr key={r.sku}>
                  <td style={{ width: '5%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}>{r.sr}</td>
                  <td style={{ width: '32%', border: '1px solid #94a3b8', padding: 4, textAlign: 'left' }}>
                    <strong>{r.name}</strong>
                    {r.dimensionOrCapacity && (
                      <>
                        <br />
                        <span style={{ color: '#475569' }}>Size/Cap: {r.dimensionOrCapacity}</span>
                      </>
                    )}
                    {r.technicalSpec && (
                      <>
                        <br />
                        <span style={{ color: '#475569', fontStyle: 'italic' }}>{r.technicalSpec}</span>
                      </>
                    )}
                    <br />
                    <span style={{ color: '#475569' }}>HSN: {r.hsn} | GST: {r.gst}</span>
                  </td>
                  <td style={{ width: '15%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}>{r.brand} | {r.sku}</td>
                  <td style={{ width: '8%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}><PrintThumb item={r} /></td>
                  <td style={{ width: '10%', border: '1px solid #94a3b8', padding: 4, textAlign: 'right' }}>{listPrice > 0 ? inr2.format(listPrice) : '-'}</td>
                  <td style={{ width: '7%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}>{discPct > 0 ? `${discPct}%` : '-'}</td>
                  <td style={{ width: '11%', border: '1px solid #94a3b8', padding: 4, textAlign: 'right' }}>{inr2.format(bestPrice)}</td>
                  <td style={{ width: '5%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}>{r.qty}</td>
                  <td style={{ width: '12%', border: '1px solid #94a3b8', padding: 4, textAlign: 'right', fontWeight: 700 }}>{inr2.format(r.lineTotal)}</td>
                </tr>
                );
              })}
              {printRows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ border: '1px solid #94a3b8', padding: 12, textAlign: 'center' }}>
                    No items in quotation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Financial breakdown */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <table style={{ fontSize: 11, borderCollapse: 'collapse', minWidth: 300 }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', background: '#f8fafc' }}>Basic Value</td>
                  <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', textAlign: 'right' }}>{inr2.format(subtotal)}</td>
                </tr>
                {intraState ? (
                  <>
                    <tr>
                      <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', background: '#f8fafc' }}>CGST</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', textAlign: 'right' }}>{inr2.format(cgst)}</td>
                    </tr>
                    <tr>
                      <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', background: '#f8fafc' }}>SGST</td>
                      <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', textAlign: 'right' }}>{inr2.format(sgst)}</td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', background: '#f8fafc' }}>IGST</td>
                    <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', textAlign: 'right' }}>{inr2.format(igst)}</td>
                  </tr>
                )}
                {freight > 0 && (
                  <tr>
                    <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', background: '#f8fafc' }}>Freight / Delivery Charges</td>
                    <td style={{ border: '1px solid #94a3b8', padding: '4px 10px', textAlign: 'right' }}>{inr2.format(freight)}</td>
                  </tr>
                )}
                <tr>
                  <td style={{ border: '2px solid #0f172a', padding: '6px 10px', fontWeight: 800, fontSize: 13 }}>Grand Total</td>
                  <td style={{ border: '2px solid #0f172a', padding: '6px 10px', textAlign: 'right', fontWeight: 800, fontSize: 13 }}>{inr2.format(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 10.5, color: '#111827', marginTop: 6, fontWeight: 700 }}>
             Grand Total (in words): {numberToWordsIN(grandTotal)}
           </p>
           <p style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            {itemCount} item(s) across {lineItems.length} line(s) · GST applied per item HSN slab ·
            Place of Supply: {details.placeOfSupply || '—'} ({intraState ? 'CGST + SGST' : 'IGST'})
            {marginPct !== 0 && ` · Basic rates include ${marginLabel(marginPct)} margin/discount on list price`}.
          </p>

          {/* Terms */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, borderBottom: '1.5px solid #0f172a', paddingBottom: 3 }}>
              TERMS & CONDITIONS
            </div>
            <ol style={{ fontSize: 9.5, color: '#334155', lineHeight: 1.6, margin: '6px 0 0', paddingLeft: 16 }}>
              {STANDARD_TERMS.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </div>

          {/* Banking + signature */}
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            <div style={{ flex: 1, border: '1px solid #94a3b8', borderRadius: 4, padding: '8px 10px', fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 10, letterSpacing: 1 }}>
                <Landmark size={12} /> BANKING DETAILS
              </div>
              <div style={{ marginTop: 4, lineHeight: 1.7 }}>
                Account Name: <strong>{COMPANY.bankName}</strong>
                <br />
                Bank: <strong>{COMPANY.bank}</strong> · {COMPANY.branch}
                <br />
                Current A/C: <strong>{COMPANY.account}</strong> · IFSC: <strong>{COMPANY.ifsc}</strong>
              </div>
            </div>
            <div style={{ flex: 1, border: '1px solid #94a3b8', borderRadius: 4, padding: '8px 10px', fontSize: 10, textAlign: 'center' }}>
              <div style={{ fontWeight: 800 }}>For {COMPANY.name}</div>
              <img
                src={`${import.meta.env.BASE_URL}aadi-signature.png`}
                alt="Seal and Signature"
                className="h-20 w-auto object-contain mx-auto mb-1"
                style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
              />
              <div style={{ borderTop: '1px solid #64748b', paddingTop: 4 }}>
                Authorised Signatory & Seal
              </div>
            </div>
          </div>

          <p style={{ fontSize: 9, color: '#64748b', textAlign: 'center', marginTop: 10 }}>
            {COMPANY.name} · {COMPANY.address} · GSTIN {COMPANY.gstin} · {COMPANY.phone} · {COMPANY.email} ·
            Thank you for your business!
          </p>
        </div>
      </div>
    </div>
  );
}
