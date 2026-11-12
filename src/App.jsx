import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpNarrowWide,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  Landmark,
  LayoutGrid,
  List,
  Lock,
  LogIn,
  Loader2,
  MessageCircle,
  Minus,
  MoreHorizontal,
  Package,
  PackageSearch,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Trash2,
  UploadCloud,
  User,
  X,
  ClipboardList,
  LogOut,
  UserCircle,
  CheckCircle2,
} from 'lucide-react';
import rawProducts from './data/products.json';
import rawClients from './data/clients.json';
import BOQParser from './components/BOQParser';
import QuoteBuilder from './components/QuoteBuilder';
import {
  addDaysISO,
  draftFromCart,
  draftFromQuote,
  documentModel,
  generateQuoteNumber,
  normalizeStatus,
  QUOTE_STATUSES,
  QUOTE_STATUS_STYLES,
  QUOTE_STATUS_TABS,
} from './lib/quotation';
import {
  subscribeQuotations,
  saveQuotation,
  updateQuotationStatus,
  deleteQuotation,
} from './lib/quotationStore';
import { downloadQuotationPdf } from './lib/quotationPdf';
import { printQuotation } from './lib/quotationPrint';
import { db } from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
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

const BRAND_ACCENT = {
  Tramontina: '#C8102E',
  Dolphy: '#1B2A4A',
  'Kärcher': '#D4A600',
  Frontier: '#0F766E',
};

const BRAND_AVATAR_BG = {
  Tramontina: 'bg-[#C8102E]',
  Dolphy: 'bg-[#1B2A4A]',
  'Kärcher': 'bg-[#EAB308]',
};

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Recommended', hint: 'Popular first' },
  { value: 'low-high', label: 'Price: Low to High', hint: 'Best value' },
  { value: 'high-low', label: 'Price: High to Low', hint: 'Premium first' },
];

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

function normalizeQuoteStatus(quoteOrStatus) {
  const raw =
    typeof quoteOrStatus === 'string' ? quoteOrStatus : quoteOrStatus?.status;
  return normalizeStatus(raw);
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

  if (failed) {
    const avatarBg = BRAND_AVATAR_BG[product.brand] || 'bg-slate-800';
    const avatarText = product.brand === 'Kärcher' ? 'text-black' : 'text-white';
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-2 text-center ${
          size === 'sm' ? 'rounded-lg' : ''
        }`}
        aria-label={`${product.brand} product image unavailable`}
      >
        <span
          className={`flex items-center justify-center rounded-full font-extrabold tracking-wide shadow-sm ${avatarBg} ${avatarText} ${
            size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-12 w-12 text-[13px]'
          }`}
        >
          {brandInitials(product.brand)}
        </span>
        {size !== 'sm' && (
          <span className="max-w-full truncate rounded-full border border-line/80 bg-white/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {product.category || 'Product'}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={
        size === 'sm'
          ? 'h-full w-full rounded-lg bg-white object-contain p-1'
          : 'product-card-image h-full w-full bg-transparent object-contain p-3 sm:p-4'
      }
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
  onView,
  onDownload,
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
      const width = 224;
      const height = 330;
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
            width: 224,
            zIndex: 80,
          }}
          className="rounded-xl border border-slate-200 bg-white py-1 shadow-pop animate-fade-in"
        >
          {item('Edit quotation', Pencil, onLoad)}
          {item('View quotation', Eye, onView)}
          {item('Download PDF', Download, onDownload, 'text-blue-700')}
          {item('Print', Printer, onPrint)}
          {item('Duplicate as draft', Copy, onDuplicate)}
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

/* ---------------- product catalogue card ---------------- */

function SkuBadge({ sku, className = '' }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyText(sku);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <span className="truncate font-mono text-[11px] font-semibold tracking-tight text-slate-500">
        {sku}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'SKU copied' : 'Copy SKU'}
        aria-label={copied ? `SKU ${sku} copied` : `Copy SKU ${sku}`}
        className="shrink-0 rounded p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aadi/40"
      >
        {copied ? (
          <Check size={12} className="text-aadigreen" />
        ) : (
          <Copy size={12} />
        )}
      </button>
    </span>
  );
}

function QuoteControls({ qty, inputQty, setInputQty, onAdd, onInc, onDec }) {
  if (qty > 0) {
    return (
      <div className="mt-1">
        <div className="flex h-10 items-center justify-between gap-1 rounded-xl border border-aadigreen/25 bg-aadigreen/[0.07] px-1">
          <button
            type="button"
            onClick={onDec}
            aria-label="Decrease quantity"
            className="flex h-8 w-9 items-center justify-center rounded-lg bg-white text-ink-deep shadow-sm ring-1 ring-inset ring-line transition hover:bg-slate-100 active:scale-95"
          >
            <Minus size={15} />
          </button>
          <span
            className="flex min-w-0 flex-col items-center leading-none"
            aria-live="polite"
          >
            <span className="text-sm font-extrabold tabular-nums text-ink-deep">
              {qty}
            </span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-aadigreen">
              in quote
            </span>
          </span>
          <button
            type="button"
            onClick={onInc}
            aria-label="Increase quantity"
            className="flex h-8 w-9 items-center justify-center rounded-lg bg-ink text-white shadow-sm transition hover:bg-ink-deep active:scale-95"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          Quantity
        </span>
        <div className="flex h-8 items-center rounded-lg border border-line bg-white">
          <button
            type="button"
            onClick={() => setInputQty(Math.max(1, inputQty - 1))}
            aria-label="Decrease quantity to add"
            className="flex h-8 w-8 items-center justify-center rounded-l-lg text-slate-500 transition hover:bg-slate-100 active:scale-95"
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            min={1}
            value={inputQty}
            onChange={(e) =>
              setInputQty(Math.max(1, Number(e.target.value) || 1))
            }
            className="h-8 w-8 border-x border-line bg-white text-center text-xs font-bold tabular-nums text-ink-deep focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label="Quantity to add"
          />
          <button
            type="button"
            onClick={() => setInputQty(inputQty + 1)}
            aria-label="Increase quantity to add"
            className="flex h-8 w-8 items-center justify-center rounded-r-lg text-slate-500 transition hover:bg-slate-100 active:scale-95"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAdd(Math.max(1, Number(inputQty) || 1))}
        className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-3 text-[12.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aadi/50 focus-visible:ring-offset-2"
      >
        <Plus size={15} strokeWidth={2.8} />
        Add to Quote
      </button>
    </div>
  );
}

function ProductCard({ product, qty, onAdd, onInc, onDec, onEdit, onDelete }) {
  const [inputQty, setInputQty] = useState(qty > 0 ? qty : 1);
  useEffect(() => {
    if (qty > 0) setInputQty(qty);
  }, [qty]);

  const discount =
    product.mrp > product.sellingPrice
      ? Math.round((1 - product.sellingPrice / product.mrp) * 100)
      : 0;
  const accent = BRAND_ACCENT[product.brand] || '#64748B';

  return (
    <article className="product-card group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-soft hover:border-slate-300 hover:shadow-lift focus-within:border-slate-300">
      {/* image — fixed 4:3 stage keeps every card aligned */}
      <div className="image-stage relative aspect-[4/3] w-full overflow-hidden">
        <ProductImage product={product} />

        <span className="absolute left-2.5 top-2.5 z-10 flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-full border border-white/80 bg-white/90 py-1 pl-1.5 pr-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-600 shadow-sm backdrop-blur-md">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="truncate">{product.brand}</span>
        </span>

        {product.custom && (
          <span className="absolute bottom-2.5 left-2.5 z-10 rounded-full border border-violet-200 bg-violet-50/95 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-violet-700 shadow-sm">
            Custom
          </span>
        )}

        {discount > 0 && (
          <span className="absolute bottom-2.5 right-2.5 z-10 rounded-full border border-aadigreen/20 bg-white/90 px-2 py-0.5 text-[9.5px] font-bold tabular-nums text-aadigreen shadow-sm backdrop-blur-md">
            {discount}% off MRP
          </span>
        )}

        <div className="absolute right-2 top-2 z-20 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={onEdit}
            title="Edit product"
            aria-label={`Edit ${product.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/80 bg-white/90 text-slate-500 shadow-sm backdrop-blur-md transition hover:bg-ink hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aadi/50"
          >
            <Pencil size={13} />
          </button>
          {product.custom && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Delete product"
              aria-label={`Delete ${product.name}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/80 bg-white/90 text-slate-500 shadow-sm backdrop-blur-md transition hover:bg-rose-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <SkuBadge sku={product.sku} />
        </div>

        <h3
          title={product.name}
          className="mt-1.5 line-clamp-3 min-h-[3.6rem] break-words text-[13px] font-semibold leading-[1.35] text-ink-deep sm:text-[13.5px]"
        >
          {product.name}
        </h3>
        <p className="mt-1.5 truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">
          {product.category}
        </p>

        <div className="mt-auto pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t border-line/70 pt-3">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-[17px] font-extrabold tracking-tight text-ink-deep sm:text-lg">
                {fmt(product.sellingPrice)}
              </span>
              {discount > 0 && (
                <span className="text-[10px] font-medium text-slate-400 line-through">
                  {fmt(product.mrp)}
                </span>
              )}
            </div>
            <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200/70">
              +{product.gst} GST
            </span>
          </div>

          <QuoteControls
            qty={qty}
            inputQty={inputQty}
            setInputQty={setInputQty}
            onAdd={onAdd}
            onInc={onInc}
            onDec={onDec}
          />
        </div>
      </div>
    </article>
  );
}

function ProductListRow({ product, qty, onAdd, onInc, onDec, onEdit, onDelete }) {
  const [inputQty, setInputQty] = useState(qty > 0 ? qty : 1);
  useEffect(() => {
    if (qty > 0) setInputQty(qty);
  }, [qty]);

  const discount =
    product.mrp > product.sellingPrice
      ? Math.round((1 - product.sellingPrice / product.mrp) * 100)
      : 0;
  const accent = BRAND_ACCENT[product.brand] || '#64748B';

  return (
    <article className="product-card group flex flex-col gap-4 rounded-2xl border border-line bg-white p-3 shadow-soft hover:border-slate-300 hover:shadow-lift sm:flex-row sm:items-center sm:p-4">
      <div className="image-stage relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl sm:aspect-auto sm:h-24 sm:w-32">
        <ProductImage product={product} />
        <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full border border-white/80 bg-white/90 py-0.5 pl-1.5 pr-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600 shadow-sm backdrop-blur-md">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: accent }}
          />
          {product.brand}
        </span>
        {product.custom && (
          <span className="absolute bottom-2 left-2 rounded-full border border-violet-200 bg-violet-50/95 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-violet-700">
            Custom
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SkuBadge sku={product.sku} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            {product.category}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-300">
            HSN {product.hsn || '—'}
          </span>
        </div>
        <h3
          title={product.name}
          className="mt-1 line-clamp-2 text-[14px] font-semibold leading-snug text-ink-deep"
        >
          {product.name}
        </h3>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-lg font-extrabold tracking-tight text-ink-deep">
            {fmt(product.sellingPrice)}
          </span>
          {discount > 0 && (
            <span className="text-[11px] font-medium text-slate-400 line-through">
              {fmt(product.mrp)}
            </span>
          )}
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200/70">
            +{product.gst} GST
          </span>
        </div>
      </div>

      <div className="w-full shrink-0 border-t border-line/70 pt-3 sm:w-44 sm:border-l sm:border-t-0 sm:pb-0 sm:pl-4 sm:pt-0">
        <QuoteControls
          qty={qty}
          inputQty={inputQty}
          setInputQty={setInputQty}
          onAdd={onAdd}
          onInc={onInc}
          onDec={onDec}
        />
        <div className="mt-2 flex justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aadi/40"
          >
            <Pencil size={12} /> Edit
          </button>
          {product.custom && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              <Trash2 size={12} /> Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/* ---------------- account menu ---------------- */

function AccountMenu({ authUser, onSettings, onSignOut, className = '' }) {
  return (
    <div
      data-account-menu
      role="menu"
      aria-label="Account menu"
      className={`glass-menu absolute z-50 w-64 overflow-hidden rounded-2xl p-1.5 ${className}`}
    >
      <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-extrabold text-white shadow-sm">
          {String(authUser?.name || '?').charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink-deep">
            {authUser?.name}
          </p>
          <p className="truncate text-[10.5px] font-medium text-slate-500">
            {authUser?.role || 'Quotation team'}
          </p>
          <p className="truncate text-[10px] text-slate-400">
            {authUser?.email || 'contact@aadienterprisespune.com'}
          </p>
        </div>
      </div>
      <div className="my-1 h-px bg-line/80" />
      <button
        type="button"
        role="menuitem"
        onClick={onSettings}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-slate-600 transition hover:bg-white hover:text-ink"
      >
        <UserCircle size={15} /> Account settings
      </button>
      <div className="my-1 h-px bg-line/80" />
      <button
        type="button"
        role="menuitem"
        onClick={onSignOut}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-rose-600 transition hover:bg-rose-50"
      >
        <LogOut size={15} /> Sign out
      </button>
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
  const [brandQuery, setBrandQuery] = useState('');
  const [showAllCats, setShowAllCats] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [brands, setBrands] = useState([]); // [] = all
  const [cats, setCats] = useState([]);
  const [sort, setSort] = useState('relevance');
  const searchRef = useRef(null);
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
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderInitial, setBuilderInitial] = useState(null);
  const [builderStartPreview, setBuilderStartPreview] = useState(false);
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

  // global search shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  // real-time quotation sync (Firestore in production, local store in test mode)
  useEffect(() => {
    const unsub = subscribeQuotations(setArchive, (err) =>
      console.error('quotations snapshot error', err),
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
    saveQuotation(quote).catch((err) => console.error('save quote error', err));
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
    updateQuotationStatus(id, status).catch((err) =>
      console.error('update status error', err),
    );
    showToast(`Quote marked as ${status}`);
  };

  const requestDeleteQuote = (q) => setDeleteTarget(q);

  const deleteQuote = (id) => {
    deleteQuotation(id).catch((err) => console.error('delete quote error', err));
    if (currentQuoteId === id) setCurrentQuoteId(null);
    showToast('Quote deleted');
  };

  const confirmDeleteQuote = () => {
    if (!deleteTarget) return;
    deleteQuote(deleteTarget.id);
    setDeleteTarget(null);
  };

  const nextRevisionNumber = (q) => {
    const base = String(q.quoteNo || 'AE/QTN/2026-001').replace(/-R\d+\s*$/i, '');
    let maxRevision = 0;
    for (const item of archive) {
      const qn = String(item.quoteNo || '');
      if (qn === base) maxRevision = Math.max(maxRevision, 0);
      if (qn.startsWith(`${base}-R`)) {
        const n = Number(qn.slice(base.length + 2).trim());
        if (Number.isFinite(n)) maxRevision = Math.max(maxRevision, n);
      }
    }
    return `${base}-R${maxRevision + 1}`;
  };

  const duplicateQuote = (q) => {
    const source = draftFromQuote(q, { user: authUser });
    const quoteNo = nextRevisionNumber(q);
    const quoteDate = todayISO();
    const copy = {
      ...source,
      id: null,
      quoteNo,
      quoteDate,
      validUntil: addDaysISO(quoteDate, 15),
      status: 'Draft',
      finalized: false,
      createdAt: null,
      updatedAt: null,
      createdBy: authUser?.name || source.createdBy || '',
      createdByEmail: authUser?.email || source.createdByEmail || '',
      revisionOf: String(q.quoteNo || '').replace(/-R\d+\s*$/i, ''),
    };
    setBuilderInitial(copy);
    setBuilderStartPreview(false);
    setBuilderOpen(true);
    setRecordsOpen(false);
    setDrawerOpen(false);
    showToast(`Revision ${quoteNo} opened as a new draft`);
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
      status: 'Approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    saveQuotation(invoice).catch((err) =>
      console.error('convert invoice error', err),
    );
    showToast(`Converted to Tax Invoice ${invoice.quoteNo}`);
  };

  const openQuoteBuilderFromCart = () => {
    const existing = currentQuoteId
      ? archive.find((q) => q.id === currentQuoteId)
      : null;
    const base = draftFromCart({
      lines: lineItems,
      details,
      archive,
      user: authUser,
    });
    const initial = {
      ...base,
      id: existing?.id || currentQuoteId || null,
      status: existing ? normalizeQuoteStatus(existing) : 'Draft',
      finalized: existing ? Boolean(existing.finalized) : false,
      createdAt: existing?.createdAt || null,
      updatedAt: existing?.updatedAt || null,
      createdBy: existing?.createdBy || authUser?.name || '',
      createdByEmail: existing?.createdByEmail || authUser?.email || '',
    };
    setBuilderInitial(initial);
    setBuilderStartPreview(false);
    setBuilderOpen(true);
    setDrawerOpen(false);
    setRecordsOpen(false);
  };

  const openQuoteBuilderFromRecord = (q, { preview = false } = {}) => {
    const source = draftFromQuote(q, { user: authUser });
    setBuilderInitial(source);
    setBuilderStartPreview(preview);
    setBuilderOpen(true);
    setDrawerOpen(false);
    setRecordsOpen(false);
  };

  const viewRecordQuote = (q) => openQuoteBuilderFromRecord(q, { preview: true });

  const downloadRecordQuote = async (q) => {
    try {
      await downloadQuotationPdf(documentModel(draftFromQuote(q, { user: authUser })));
      showToast(`Quote ${q.quoteNo} PDF downloaded`);
    } catch (err) {
      console.error('download record quote error', err);
      showToast('Could not download the quotation PDF');
    }
  };

  const reprintQuote = (q) => {
    printQuotation(documentModel(draftFromQuote(q, { user: authUser })));
    showToast('Opening print preview');
  };

  const closeBuilder = () => {
    setBuilderOpen(false);
    setBuilderInitial(null);
    setBuilderStartPreview(false);
  };

  const handleBuilderSave = async (record) => {
    const saved = await saveQuotation(record);
    setCurrentQuoteId(saved.id);
    return saved;
  };

  const handleBuilderUpdateStatus = async (id, status) => {
    await updateQuotationStatus(id, status);
  };

  const handleBuilderDelete = async (id) => {
    try {
      await deleteQuotation(id);
      if (currentQuoteId === id) setCurrentQuoteId(null);
      closeBuilder();
      showToast('Quotation deleted');
    } catch (err) {
      console.error('delete builder quote error', err);
      showToast('Could not delete the quotation');
    }
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
    setBrandQuery('');
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

  const priceSpan = Math.max(1, catalogHi - catalogLo);
  const pricePct = (v) =>
    Math.min(100, Math.max(0, ((Number(v) - catalogLo) / priceSpan) * 100));
  const priceNarrowed = minPrice > catalogLo || maxPrice < catalogHi;
  const activeFilterCount =
    brands.length +
    cats.length +
    (search ? 1 : 0) +
    (priceNarrowed ? 1 : 0) +
    (sort !== 'relevance' ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const filteredBrands = allBrands.filter(([b]) =>
    b.toLowerCase().includes(brandQuery.trim().toLowerCase()),
  );
  const filteredCategories = categories.filter(([c]) =>
    c.toLowerCase().includes(catQuery.trim().toLowerCase()),
  );
  const visibleCategories = catQuery.trim()
    ? filteredCategories
    : showAllCats
      ? filteredCategories
      : filteredCategories.filter(
          ([c], index) => index < 10 || cats.includes(c),
        );
  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === sort)?.label || 'Recommended';

  const clearFilterChip = (type, value) => {
    if (type === 'search') {
      setSearchRaw('');
      setSearch('');
    } else if (type === 'brand') {
      setBrands((list) => list.filter((b) => b !== value));
    } else if (type === 'category') {
      setCats((list) => list.filter((c) => c !== value));
    } else if (type === 'price') {
      setMinPrice(catalogLo);
      setMaxPrice(catalogHi);
    } else if (type === 'sort') {
      setSort('relevance');
    }
  };

  const filterPanel = (
    <div className="flex flex-col gap-5">
      {hasActiveFilters && (
        <section className="rounded-xl border border-line/80 bg-slate-50/70 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Active filters
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="text-[10.5px] font-bold text-aadi transition hover:text-aadi-dark"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {search && (
              <button
                type="button"
                onClick={() => clearFilterChip('search')}
                className="flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                aria-label="Remove search filter"
              >
                “{searchRaw.trim()}”
                <X size={11} />
              </button>
            )}
            {brands.map((b) => (
              <button
                type="button"
                key={`chip-brand-${b}`}
                onClick={() => clearFilterChip('brand', b)}
                className="flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                aria-label={`Remove ${b} brand filter`}
              >
                {b}
                <X size={11} />
              </button>
            ))}
            {cats.map((c) => (
              <button
                type="button"
                key={`chip-cat-${c}`}
                onClick={() => clearFilterChip('category', c)}
                className="flex max-w-full items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                aria-label={`Remove ${c} category filter`}
              >
                <span className="max-w-[130px] truncate">{c}</span>
                <X size={11} className="shrink-0" />
              </button>
            ))}
            {priceNarrowed && (
              <button
                type="button"
                onClick={() => clearFilterChip('price')}
                className="flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-[10.5px] font-semibold tabular-nums text-slate-600 transition hover:border-slate-300 hover:text-ink"
                aria-label="Remove price filter"
              >
                {fmt(minPrice)}–{fmt(maxPrice)}
                <X size={11} />
              </button>
            )}
            {sort !== 'relevance' && (
              <button
                type="button"
                onClick={() => clearFilterChip('sort')}
                className="flex items-center gap-1 rounded-full border border-line bg-white py-0.5 pl-2 pr-1 text-[10.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                aria-label="Reset sort"
              >
                {sortLabel}
                <X size={11} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* brand */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
            <Building2 size={13} /> Brand
          </h3>
          {brands.length > 0 && (
            <button
              type="button"
              onClick={() => setBrands([])}
              className="text-[10.5px] font-bold text-slate-400 transition hover:text-ink"
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
            value={brandQuery}
            onChange={(e) => setBrandQuery(e.target.value)}
            placeholder="Find a brand…"
            className="h-8 w-full rounded-lg border border-line bg-white pl-8 pr-7 text-[12px] font-medium text-ink placeholder:text-slate-400 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/5"
            aria-label="Search brands"
          />
          {brandQuery && (
            <button
              type="button"
              onClick={() => setBrandQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear brand search"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex max-h-52 flex-col gap-0.5 overflow-y-auto pr-1 nice-scroll">
          {filteredBrands.map(([b, n]) => {
            const active = brands.includes(b);
            return (
              <button
                type="button"
                key={b}
                onClick={() => toggle(brands, setBrands, b)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-semibold transition ${
                  active
                    ? 'bg-ink/[0.055] text-ink-deep'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-ink'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {active && <Check size={10} strokeWidth={3.2} />}
                </span>
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: BRAND_ACCENT[b] || '#94A3B8',
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{b}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-bold tabular-nums text-slate-500">
                  {n}
                </span>
              </button>
            );
          })}
          {filteredBrands.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] font-medium text-slate-400">
              No brands match “{brandQuery}”
            </p>
          )}
        </div>
      </section>

      <div className="h-px bg-line/80" />

      {/* category */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
            <Tag size={13} /> Category
          </h3>
          {cats.length > 0 && (
            <button
              type="button"
              onClick={() => setCats([])}
              className="text-[10.5px] font-bold text-slate-400 transition hover:text-ink"
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
            className="h-8 w-full rounded-lg border border-line bg-white pl-8 pr-7 text-[12px] font-medium text-ink placeholder:text-slate-400 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/5"
            aria-label="Search categories"
          />
          {catQuery && (
            <button
              type="button"
              onClick={() => setCatQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear category search"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto pr-1 nice-scroll">
          {visibleCategories.map(([c, n]) => {
            const active = cats.includes(c);
            return (
              <button
                type="button"
                key={c}
                title={c}
                onClick={() => toggle(cats, setCats, c)}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] font-medium transition ${
                  active
                    ? 'bg-ink/[0.055] font-semibold text-ink-deep'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-ink'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {active && <Check size={10} strokeWidth={3.2} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{c}</span>
                <span className="shrink-0 rounded-full bg-slate-100 px-1.5 text-[10px] font-bold tabular-nums text-slate-500">
                  {n}
                </span>
              </button>
            );
          })}
          {visibleCategories.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-[11px] font-medium text-slate-400">
              No categories match “{catQuery}”
            </p>
          )}
        </div>
        {!catQuery.trim() && filteredCategories.length > 10 && (
          <button
            type="button"
            onClick={() => setShowAllCats((v) => !v)}
            className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-bold text-slate-400 transition hover:bg-slate-50 hover:text-ink"
          >
            {showAllCats ? 'Show fewer' : `Show all ${filteredCategories.length}`}
            <ChevronDown
              size={12}
              className={`transition-transform ${showAllCats ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </section>

      <div className="h-px bg-line/80" />

      {/* sort */}
      <section>
        <h3 className="mb-2 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
          Price sort
        </h3>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
          {[
            { v: 'relevance', label: 'Popular', icon: null },
            { v: 'low-high', label: 'Low → High', icon: ArrowUpNarrowWide },
            { v: 'high-low', label: 'High → Low', icon: ArrowDownWideNarrow },
          ].map((o) => (
            <button
              type="button"
              key={o.v}
              onClick={() => setSort(o.v)}
              aria-pressed={sort === o.v}
              className={`flex items-center justify-center gap-0.5 whitespace-nowrap rounded-lg px-0.5 py-1.5 text-[10px] font-bold transition ${
                sort === o.v
                  ? 'bg-white text-ink-deep shadow-sm'
                  : 'text-slate-500 hover:text-ink'
              }`}
            >
              {o.icon && <o.icon size={11} />}
              {o.label}
            </button>
          ))}
        </div>
      </section>

      {/* price range */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
            Price range
          </h3>
          {priceNarrowed && (
            <button
              type="button"
              onClick={() => clearFilterChip('price')}
              className="text-[10.5px] font-bold text-slate-400 transition hover:text-ink"
            >
              Reset
            </button>
          )}
        </div>
        <div className="rounded-xl border border-line bg-white p-3">
          <div className="grid grid-cols-1 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Min
              </span>
              <div className="relative w-full">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] font-bold text-slate-400">
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={groupNum(minPrice)}
                  onChange={(e) =>
                    setMinPrice(
                      Math.max(
                        catalogLo,
                        Math.min(parseDigits(e.target.value), maxPrice),
                      ),
                    )
                  }
                  className="h-8 w-full rounded-lg border border-line py-1.5 pl-6 pr-2 text-[12px] font-semibold tabular-nums text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/5"
                  aria-label="Minimum price"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                Max
              </span>
              <div className="relative w-full">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] font-bold text-slate-400">
                  ₹
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={groupNum(maxPrice)}
                  onChange={(e) =>
                    setMaxPrice(
                      Math.min(
                        catalogHi,
                        Math.max(parseDigits(e.target.value), minPrice),
                      ),
                    )
                  }
                  className="h-8 w-full rounded-lg border border-line py-1.5 pl-6 pr-2 text-[12px] font-semibold tabular-nums text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/5"
                  aria-label="Maximum price"
                />
              </div>
            </label>
          </div>

          <div className="dual-range mt-4">
            <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
            <div
              className="pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-ink"
              style={{
                left: `${pricePct(minPrice)}%`,
                right: `${100 - pricePct(maxPrice)}%`,
              }}
            />
            <input
              type="range"
              min={catalogLo}
              max={catalogHi}
              step={PRICE_STEP}
              value={minPrice}
              onChange={(e) =>
                setMinPrice(Math.min(Number(e.target.value), maxPrice))
              }
              aria-label="Minimum price slider"
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
              aria-label="Maximum price slider"
            />
          </div>
          <p className="mt-1.5 text-center text-[11px] font-bold tabular-nums text-slate-500">
            {fmt(minPrice)} — {fmt(maxPrice)}
          </p>
        </div>
      </section>

      <button
        type="button"
        onClick={resetFilters}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2.5 text-[12px] font-bold text-slate-500 transition hover:border-slate-300 hover:text-ink active:scale-[0.99]"
      >
        <RotateCcw size={14} /> Reset all filters
      </button>
    </div>
  );

  const openAccountSettings = () => {
    setSettingsForm({
      name: authUser?.name || '',
      phone: authUser?.phone || '',
      password: '',
    });
    setSettingsOpen(true);
    setIsAccountMenuOpen(false);
  };
  const closeAccountMenu = () => setIsAccountMenuOpen(false);

  if (!authUser) {
    return <LoginView onLogin={setAuthUser} />;
  }

  if (builderOpen && builderInitial) {
    return (
      <>
        <QuoteBuilder
          key={builderInitial.id || builderInitial.quoteNo || 'new-quotation'}
          initialDraft={builderInitial}
          archive={archive}
          clients={clients}
          catalog={catalog}
          user={authUser}
          startPreview={builderStartPreview}
          onClose={closeBuilder}
          onSave={handleBuilderSave}
          onUpdateStatus={handleBuilderUpdateStatus}
          onDelete={handleBuilderDelete}
          showToast={showToast}
        />
        {toast && (
          <div className="no-print fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 animate-fade-in">
            <p className="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-[13px] font-bold text-white shadow-pop">
              <Check size={14} className="text-emerald-400" /> {toast}
            </p>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="catalogue-shell min-h-screen overflow-x-hidden">
      {/* ============ MOBILE HEADER ============ */}
      <header className="no-print catalogue-header sticky top-0 z-40 border-b border-line/80 md:hidden">
        <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-white shadow-sm">
              <img
                src={`${import.meta.env.BASE_URL}aadi-logo.png`}
                alt="Aadi Enterprises"
                className="h-7 w-auto object-contain"
              />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-extrabold leading-tight tracking-tight text-ink-deep">
                Aadi Enterprises
              </p>
              <p className="truncate text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Quotation workspace
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openQuoteBuilderFromCart}
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white shadow-sm transition active:scale-95"
              aria-label={`Open quote builder, ${itemCount} items`}
            >
              <ShoppingCart size={16} />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-aadi px-1 text-[9px] font-extrabold tabular-nums text-white ring-2 ring-white">
                {itemCount}
              </span>
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsAccountMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={isAccountMenuOpen}
                className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-xs font-extrabold text-white shadow-sm ring-2 ring-white ${
                  authUser?.name === 'Aditya'
                    ? 'from-orange-500 to-amber-600'
                    : authUser?.name === 'Abhijit'
                      ? 'from-emerald-500 to-green-600'
                      : 'from-slate-700 to-slate-900'
                }`}
                aria-label="Open account menu"
              >
                {String(authUser?.name || '?').charAt(0).toUpperCase()}
              </button>
              {isAccountMenuOpen && (
                <AccountMenu
                  authUser={authUser}
                  onSettings={openAccountSettings}
                  onSignOut={() => setAuthUser(null)}
                  className="right-0 top-full mt-2"
                />
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Search products, SKU, brand, category…"
              className="h-9 w-full rounded-xl border border-line bg-white pl-9 pr-8 text-[12px] font-medium text-ink placeholder:text-slate-400 focus:border-ink focus:outline-none focus:ring-4 focus:ring-ink/5"
              aria-label="Search products"
            />
            {searchRaw && (
              <button
                type="button"
                onClick={() => setSearchRaw('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-white px-3 text-[11.5px] font-bold text-slate-600 shadow-sm transition active:scale-95"
            aria-label="Open filters"
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-extrabold tabular-nums text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-3 pb-2">
          <button
            type="button"
            onClick={openQuoteBuilderFromCart}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-gradient-to-b from-amber-100 to-amber-200 px-2.5 text-[11px] font-extrabold text-ink-deep shadow-sm transition active:scale-95"
            aria-label="Create new quote"
          >
            <Plus size={13} className="text-amber-700" /> Create New Quote
          </button>
          <button
            type="button"
            onClick={() => setBoqOpen(true)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition active:scale-95"
            title="Import products from BOQ / RFQ"
          >
            <UploadCloud size={13} /> Import
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition active:scale-95"
          >
            <Plus size={13} /> Add product
          </button>
          <button
            type="button"
            onClick={() => setRecordsOpen(true)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition active:scale-95"
          >
            <ClipboardList size={13} /> Records
            {archive.length > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-extrabold tabular-nums text-white">
                {archive.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ============ DESKTOP HEADER ============ */}
      <header className="no-print catalogue-header sticky top-0 z-40 hidden h-[72px] items-center gap-3 border-b border-line/80 px-5 md:flex xl:px-7">
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-white shadow-sm">
            <img
              src={`${import.meta.env.BASE_URL}aadi-logo.png`}
              alt="Aadi Enterprises"
              className="h-8 w-auto object-contain"
            />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[13.5px] font-extrabold leading-tight tracking-tight text-ink-deep">
              Aadi Enterprises
            </h1>
            <p className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Quotation workspace
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 justify-center px-1">
          <div className="relative w-full max-w-xl">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              ref={searchRef}
              value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              placeholder="Search by product, SKU, brand or category…"
              className="h-10 w-full rounded-xl border border-line bg-white/75 pl-10 pr-20 text-[12.5px] font-medium text-ink shadow-sm placeholder:text-slate-400 focus:border-ink focus:bg-white focus:outline-none focus:ring-4 focus:ring-ink/5"
              aria-label="Search products by name, SKU, brand or category"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-slate-50 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-400 lg:flex">
              Ctrl K
            </span>
            {searchRaw && (
              <button
                type="button"
                onClick={() => setSearchRaw('')}
                className="absolute right-12 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:right-14"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setBoqOpen(true)}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-0 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink active:scale-95 w-10 xl:w-auto xl:px-3"
            title="Import products from BOQ / RFQ"
          >
            <UploadCloud size={15} />
            <span className="hidden xl:inline">Import</span>
          </button>
          <button
            type="button"
            onClick={openAddModal}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-0 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink active:scale-95 w-10 xl:w-auto xl:px-3"
            title="Add a custom product to the catalogue"
          >
            <Plus size={15} />
            <span className="hidden xl:inline">Add product</span>
          </button>
          <button
            type="button"
            onClick={() => setRecordsOpen(true)}
            className="relative flex h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-0 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink active:scale-95 w-10 lg:w-auto lg:px-3"
            title="Quotation records"
          >
            <ClipboardList size={15} />
            <span className="hidden lg:inline">Records</span>
            {archive.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-aadi px-1 text-[9px] font-extrabold tabular-nums text-white ring-2 ring-white">
                {archive.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={openQuoteBuilderFromCart}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-gradient-to-b from-amber-100 to-amber-200 px-2.5 text-[11.5px] font-extrabold text-ink-deep shadow-sm transition hover:border-amber-400 hover:from-amber-200 hover:to-amber-300 active:scale-95 xl:px-3.5"
            title="Create a new quotation"
            aria-label="Create new quote"
          >
            <Plus size={15} className="text-amber-700" />
            <span className="hidden lg:inline">Create New Quote</span>
            <span className="lg:hidden">New</span>
          </button>

          <button
            type="button"
            onClick={openQuoteBuilderFromCart}
            className="relative flex h-10 items-center gap-2 rounded-xl bg-ink px-2.5 text-white shadow-sm transition hover:bg-ink-deep active:scale-95 xl:px-3.5"
            aria-label={`Open quote builder, ${itemCount} items`}
          >
            <span className="relative">
              <ShoppingCart size={16} />
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-aadi px-1 text-[9px] font-extrabold tabular-nums text-white ring-2 ring-ink">
                {itemCount}
              </span>
            </span>
            <span className="hidden text-[11.5px] font-bold tabular-nums xl:inline">
              Cart
            </span>
            <span className="hidden text-[11px] font-semibold tabular-nums text-white/70 2xl:inline">
              {fmt(grandTotal)}
            </span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsAccountMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={isAccountMenuOpen}
              className="flex h-10 items-center gap-2 rounded-xl border border-line bg-white py-1 pl-1 pr-2 text-[11.5px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-ink"
              aria-label="Open account menu"
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-extrabold text-white ${
                  authUser?.name === 'Aditya'
                    ? 'from-orange-500 to-amber-600'
                    : authUser?.name === 'Abhijit'
                      ? 'from-emerald-500 to-green-600'
                      : 'from-slate-700 to-slate-900'
                }`}
              >
                {String(authUser?.name || '?').charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-[92px] truncate xl:inline">
                {authUser?.name}
              </span>
              <ChevronDown
                size={13}
                className={`hidden text-slate-400 transition-transform xl:block ${
                  isAccountMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isAccountMenuOpen && (
              <AccountMenu
                authUser={authUser}
                onSettings={openAccountSettings}
                onSignOut={() => setAuthUser(null)}
                className="right-0 top-full mt-2"
              />
            )}
          </div>
        </div>
      </header>

      {/* ============ CATALOGUE WORKSPACE ============ */}
      <main className="no-print mx-auto w-full max-w-[1600px] px-3 pb-12 pt-5 sm:px-5 lg:px-6 xl:px-7">
        {/* page introduction */}
        <section className="flex flex-col gap-3.5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-slate-400">
              <span className="h-1.5 w-1.5 rounded-full bg-aadi" />
              Product workspace
            </div>
            <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-[-0.025em] text-ink-deep sm:text-[26px]">
              Product Catalogue
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-500 sm:text-[12.5px]">
              Browse and manage hospitality products for your quotations.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:items-stretch">
            {[
              {
                label: 'Total products',
                value: catalog.length,
                icon: Package,
              },
              {
                label: 'Brands',
                value: allBrands.length,
                icon: Building2,
              },
              {
                label: 'Categories',
                value: categories.length,
                icon: Tag,
              },
              {
                label: 'In quotation',
                value: itemCount,
                icon: ShoppingCart,
                accent: true,
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className={`flex min-w-0 flex-col rounded-xl border bg-white px-3 py-2 shadow-soft ${
                  metric.accent
                    ? 'border-aadi/25 bg-gradient-to-br from-white to-orange-50/60'
                    : 'border-line'
                }`}
              >
                <span className="flex items-center gap-1 text-[8.5px] font-bold uppercase tracking-[0.13em] text-slate-400">
                  <metric.icon
                    size={11}
                    className={metric.accent ? 'text-aadi' : 'text-slate-300'}
                  />
                  <span className="truncate">{metric.label}</span>
                </span>
                <span className="mt-0.5 text-[16px] font-extrabold leading-none tabular-nums tracking-tight text-ink-deep">
                  {metric.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-4 flex items-start gap-5 sm:mt-5">
          {/* sidebar (desktop) */}
          <aside className="nice-scroll sticky top-[88px] hidden max-h-[calc(100vh-104px)] w-[252px] shrink-0 overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-soft lg:block xl:w-[260px]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[12px] font-extrabold tracking-tight text-ink-deep">
                <SlidersHorizontal size={14} className="text-slate-400" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-extrabold tabular-nums text-white">
                    {activeFilterCount}
                  </span>
                )}
              </h3>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[10px] font-bold text-slate-400 transition hover:text-ink"
                >
                  Clear all
                </button>
              )}
            </div>
            {filterPanel}
          </aside>

          {/* mobile filter drawer */}
          {filtersOpen && (
            <div className="fixed inset-0 z-[65] lg:hidden">
              <div
                className="glass-scrim absolute inset-0 animate-fade-in"
                onClick={() => setFiltersOpen(false)}
              />
              <aside
                role="dialog"
                aria-modal="true"
                aria-label="Product filters"
                className="absolute inset-y-0 left-0 flex w-[88%] max-w-[340px] flex-col bg-white shadow-pop animate-drawer-in-left"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
                  <h3 className="flex items-center gap-1.5 text-[13px] font-extrabold text-ink-deep">
                    <SlidersHorizontal size={15} className="text-slate-400" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-extrabold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100"
                    aria-label="Close filters"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="nice-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                  {filterPanel}
                </div>
                <div className="shrink-0 border-t border-line bg-white p-3">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-ink text-[12.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep active:scale-[0.99]"
                  >
                    Show {filtered.length} products
                  </button>
                </div>
              </aside>
            </div>
          )}

          {/* results */}
          <section className="min-w-0 flex-1">
            {/* toolbar */}
            <div className="mb-3.5 flex flex-col gap-2.5 rounded-2xl border border-line bg-white px-3 py-2.5 shadow-soft sm:flex-row sm:items-center sm:justify-between sm:px-3.5">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <p className="text-[11.5px] font-medium text-slate-500">
                  Showing{' '}
                  <strong className="font-bold tabular-nums text-ink-deep">
                    {filtered.length ? 1 : 0}–
                    {Math.min(visible, filtered.length)}
                  </strong>{' '}
                  of{' '}
                  <strong className="font-bold tabular-nums text-ink-deep">
                    {filtered.length}
                  </strong>{' '}
                  products
                </p>
                {activeFilterCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-ink/[0.055] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink">
                    <SlidersHorizontal size={10} />
                    {activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'}
                  </span>
                )}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="text-[10.5px] font-bold text-slate-400 transition hover:text-aadi"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 transition hover:border-slate-300 hover:text-ink lg:hidden"
                >
                  <SlidersHorizontal size={13} />
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[9px] font-extrabold text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                <div className="relative">
                  <label htmlFor="catalogue-sort" className="sr-only">
                    Sort products
                  </label>
                  <ArrowDownWideNarrow
                    size={13}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <select
                    id="catalogue-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    className="h-9 cursor-pointer appearance-none rounded-lg border border-line bg-white pl-8 pr-7 text-[11px] font-bold text-slate-600 transition hover:border-slate-300 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/5"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={13}
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                </div>

                <div
                  className="flex items-center gap-0.5 rounded-lg border border-line bg-slate-50 p-0.5"
                  role="group"
                  aria-label="Change product layout"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    aria-pressed={viewMode === 'grid'}
                    aria-label="Grid view"
                    title="Grid view"
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                      viewMode === 'grid'
                        ? 'bg-white text-ink shadow-sm'
                        : 'text-slate-400 hover:text-ink'
                    }`}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    aria-pressed={viewMode === 'list'}
                    aria-label="List view"
                    title="List view"
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
                      viewMode === 'list'
                        ? 'bg-white text-ink shadow-sm'
                        : 'text-slate-400 hover:text-ink'
                    }`}
                  >
                    <List size={14} />
                  </button>
                </div>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-soft">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
                  <PackageSearch size={26} />
                </span>
                <p className="text-[15px] font-bold text-ink-deep">
                  No products found
                </p>
                <p className="max-w-sm text-[12px] leading-relaxed text-slate-500">
                  Try a different search term, or clear your brand, category and
                  price filters.
                </p>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="mt-1 flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
                >
                  <RotateCcw size={14} /> Reset filters
                </button>
              </div>
            ) : (
              <>
                <div
                  className={
                    viewMode === 'grid'
                      ? 'grid grid-cols-1 gap-3.5 min-[380px]:grid-cols-2 sm:gap-4 lg:grid-cols-3 min-[1440px]:grid-cols-4'
                      : 'flex flex-col gap-3'
                  }
                >
                  {filtered.slice(0, visible).map((p) =>
                    viewMode === 'grid' ? (
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
                        onDelete={
                          p.custom ? () => deleteCustomProduct(p) : undefined
                        }
                      />
                    ) : (
                      <ProductListRow
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
                        onDelete={
                          p.custom ? () => deleteCustomProduct(p) : undefined
                        }
                      />
                    ),
                  )}
                </div>

                {visible < filtered.length && (
                  <div className="mt-7 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setVisible((v) => v + PAGE_SIZE)}
                      className="flex items-center gap-2 rounded-xl border border-ink bg-white px-5 py-2.5 text-[12px] font-bold text-ink transition hover:bg-ink hover:text-white active:scale-[0.99]"
                    >
                      Load more products
                      <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[10px] tabular-nums">
                        {filtered.length - visible} remaining
                      </span>
                    </button>
                    <p className="text-[10px] font-medium text-slate-400">
                      Showing {Math.min(visible, filtered.length)} of{' '}
                      {filtered.length} matching products
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      {/* ============ QUOTATION CART DRAWER ============ */}
      {drawerOpen && (
        <div className="no-print fixed inset-0 z-50">
          <div
            className="glass-scrim absolute inset-0 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Quotation cart"
            className="cart-glass absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col animate-drawer-in-right sm:max-w-[480px]"
          >
            <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-line/80 px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white shadow-sm">
                <ShoppingCart size={17} />
              </span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-extrabold leading-tight tracking-tight text-ink-deep">
                  Quotation cart
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                  <span className="rounded-full bg-ink/[0.055] px-1.5 py-0.5 tabular-nums text-ink">
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                  </span>
                  <span className="max-w-[130px] truncate font-mono" title={details.quoteNo}>
                    {details.quoteNo}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="ml-auto rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-ink"
                aria-label="Close quotation cart"
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
                <div className="flex flex-col items-center justify-center gap-2 px-8 py-10 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-white text-slate-300 shadow-soft">
                    <ShoppingCart size={24} />
                  </span>
                  <p className="mt-1 text-[13px] font-bold text-ink-deep">
                    Your quotation is empty
                  </p>
                  <p className="max-w-[220px] text-[11.5px] leading-relaxed text-slate-500">
                    Add products with “Add to Quote” to build your quotation.
                  </p>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="mt-2 rounded-xl bg-ink px-4 py-2.5 text-[12px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
                  >
                    Browse products
                  </button>
                </div>
              ) : (
                <div className="px-4 py-3">
                  <ul className="flex flex-col gap-2.5">
                    {lineItems.map((i) => {
                      const adj = adjBasicOf(i);
                      return (
                        <li
                          key={i.sku}
                          className="flex gap-3 rounded-xl border border-line/80 bg-white/80 p-2.5 shadow-soft"
                        >
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line/70 bg-white">
                            <ProductImage product={i} size="sm" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="line-clamp-2 text-[12px] font-bold leading-snug text-ink-deep"
                              title={i.name}
                            >
                              {i.name}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                              {i.sku}
                            </p>
                            <p className="mt-0.5 text-[10.5px] font-medium text-slate-500">
                              {marginPct > 0 && (
                                <s className="mr-1 text-slate-400">
                                  {fmt(i.sellingPrice)}
                                </s>
                              )}
                              <span className="font-bold text-ink">
                                {fmt(adj)}
                              </span>{' '}
                              <span className="text-slate-400">unit</span> +{i.gst} GST
                            </p>
                            <div className="mt-1.5 flex items-center gap-2">
                              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-slate-50 p-0.5">
                                <button
                                  type="button"
                                  onClick={() => setQty(i.sku, i.qty - 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm transition hover:bg-slate-100 active:scale-95"
                                  aria-label={`Decrease quantity for ${i.sku}`}
                                >
                                  <Minus size={13} />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  value={i.qty}
                                  onChange={(e) =>
                                    setQty(
                                      i.sku,
                                      Math.max(1, Number(e.target.value) || 1),
                                    )
                                  }
                                  className="w-9 bg-transparent text-center text-[12px] font-extrabold tabular-nums text-ink focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                                  aria-label={`Quantity for ${i.sku}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => setQty(i.sku, i.qty + 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-white shadow-sm transition hover:bg-ink-deep active:scale-95"
                                  aria-label={`Increase quantity for ${i.sku}`}
                                >
                                  <Plus size={13} />
                                </button>
                              </div>
                              <span className="ml-auto text-[12.5px] font-extrabold tabular-nums text-ink-deep">
                                {fmt(adj * i.qty)}
                              </span>
                              <button
                                type="button"
                                onClick={() => setQty(i.sku, 0)}
                                className="rounded-md p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                aria-label={`Remove ${i.sku}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    type="button"
                    onClick={() => {
                      setCart({});
                      setItemSpecs({});
                      setCurrentQuoteId(null);
                      setCurrentIsInvoice(false);
                      setSelectedClientId(null);
                      showToast('Quote cleared');
                    }}
                    className="mt-3 flex items-center gap-1 rounded-lg px-1 py-1 text-[10.5px] font-bold text-slate-400 transition hover:text-rose-600"
                  >
                    <Trash2 size={12} /> Clear quote
                  </button>
                </div>
              )}
            </div>

            {lineItems.length > 0 && (
              <div
                className="shrink-0 border-t border-line/80 bg-white/80 p-3.5 shadow-[0_-14px_34px_-28px_rgba(14,26,43,.55)] backdrop-blur-xl"
                style={{ paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))' }}
              >
                {/* margin / discount adjustment */}
                <div className="mb-2.5 rounded-xl border border-line/80 bg-slate-50/80 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-slate-500">
                      Margin / Discount
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-extrabold tabular-nums ${
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
                        className={`rounded-lg px-2 py-1 text-[11px] font-extrabold tabular-nums transition active:scale-95 ${
                          marginPct === p
                            ? 'bg-ink text-white shadow-sm'
                            : 'bg-white text-slate-500 hover:bg-slate-100'
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
                        className="w-20 rounded-lg border border-line bg-white py-1 pl-2 pr-6 text-[11px] font-extrabold tabular-nums text-ink focus:border-ink focus:outline-none"
                        aria-label="Custom margin or discount percent"
                        title="Custom %"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                        %
                      </span>
                    </div>
                  </div>
                </div>

                {/* totals — single source of truth for the quote summary */}
                <div className="space-y-1 rounded-xl border border-line/80 bg-white p-2.5 text-[11px]">
                  <div className="flex justify-between text-slate-500">
                    <span>Total list price</span>
                    <span className="font-bold tabular-nums">{fmt(totalListPrice)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-emerald-600">
                    <span>Discount applied ({marginPct}%)</span>
                    <span className="tabular-nums">-{fmt(totalDiscountAmount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Taxable basic value</span>
                    <span className="font-bold tabular-nums">{fmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>{intraState ? 'CGST / SGST' : 'IGST'}</span>
                    <span className="font-bold tabular-nums">
                      {intraState
                        ? `${inr2.format(cgst)} / ${inr2.format(sgst)}`
                        : inr2.format(igst)}
                    </span>
                  </div>
                  {freight > 0 && (
                    <div className="flex justify-between text-slate-500">
                      <span>Freight / delivery</span>
                      <span className="font-bold tabular-nums">{fmt(freight)}</span>
                    </div>
                  )}
                  <div className="flex items-end justify-between border-t border-line pt-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                      Grand total
                    </span>
                    <span className="text-[17px] font-extrabold leading-none tabular-nums tracking-tight text-ink-deep">
                      {inr2.format(grandTotal)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openQuoteBuilderFromCart}
                  className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-[12.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aadi/50 focus-visible:ring-offset-2"
                  title="Open the full quotation workspace"
                >
                  Proceed to Create Quotation
                  <ArrowRight size={15} />
                </button>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      saveQuote();
                      window.print();
                    }}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-line bg-white px-2 text-[10.5px] font-bold text-slate-600 transition hover:border-slate-300 hover:text-ink"
                  >
                    <Printer size={14} /> Print / PDF
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyWhatsapp}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-2 text-[10.5px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <MessageCircle size={14} /> WhatsApp text
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
                              onLoad={() => openQuoteBuilderFromRecord(q)}
                              onView={() => viewRecordQuote(q)}
                              onDownload={() => downloadRecordQuote(q)}
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
