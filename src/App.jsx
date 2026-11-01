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
  FileText,
  Landmark,
  MessageCircle,
  Minus,
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
const MARGIN_PRESETS = [-10, -5, 0, 5, 10, 15];
const marginLabel = (p) => (p > 0 ? `+${p}%` : `${p}%`);

const DETAILS_KEY = 'quote-details';
const AUTH_KEY = 'aadi_auth_user';
const ARCHIVE_KEY = 'aadi_quotations_archive';

const AUTH_USERS = [
  {
    email: 'admin@aadienterprises.com',
    password: 'aadi123',
    name: 'Admin',
    role: 'System Administrator',
    avatarBg: 'from-slate-700 to-slate-900',
    initial: 'A',
  },
  {
    email: 'aditya@aadienterprises.com',
    password: 'aditya123',
    name: 'Aditya',
    role: '',
    avatarBg: 'from-orange-500 to-amber-600',
    initial: 'A',
  },
  {
    email: 'abhijit@aadienterprises.com',
    password: 'abhijit123',
    name: 'Abhijit',
    role: '',
    avatarBg: 'from-emerald-500 to-green-600',
    initial: 'A',
  },
];

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

function QuoteDetailsForm({ details, setDetail, open, onToggle, onReset, archive = [], clients = [] }) {
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
            }}
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
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {product.mrp > product.sellingPrice && (
              <span className="text-xs text-slate-400 line-through">
                {fmt(product.mrp)}
              </span>
            )}
            <span className="text-[17px] font-extrabold text-slate-900">
              {fmt(product.sellingPrice)}
            </span>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              +{product.gst} GST
            </span>
          </div>

          {/* add / counter */}
          {qty === 0 ? (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={inputQty}
                onChange={(e) =>
                  setInputQty(Math.max(1, Number(e.target.value) || 1))
                }
                className="w-12 h-9 text-center border border-slate-200 rounded-lg text-sm font-medium focus:ring-1 focus:ring-slate-900"
                aria-label="Quantity to add"
              />
              <button
                onClick={() => onAdd(Math.max(1, Number(inputQty) || 1))}
                className="h-9 px-3 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center justify-center gap-1.5 transition-all active:scale-95 whitespace-nowrap"
              >
                <ShoppingCart className="w-3.5 h-3.5" /> Add to Quote
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
function LoginView({ onLogin }) {
  const [selected, setSelected] = useState(0);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPass, setShowPass] = useState(false);

  const user = AUTH_USERS[selected];

  const submit = (e) => {
    e.preventDefault();
    if (password === user.password) {
      onLogin({
        email: user.email,
        name: user.name,
        role: user.role,
      });
    } else {
      setError('Invalid password. Please try again.');
    }
  };

  const autofill = () => {
    setPassword(user.password);
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-pop sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={`${import.meta.env.BASE_URL}aadi-logo.png`} alt="Aadi Enterprises" className="mb-3 h-16 w-auto object-contain" />
          <h1 className="text-xl font-extrabold text-slate-900">Aadi Enterprises</h1>
          <p className="text-sm font-medium text-slate-500">Quotation System · Select your profile</p>
        </div>

        {/* profile cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {AUTH_USERS.map((u, idx) => {
            const active = selected === idx;
            return (
              <button
                key={u.email}
                type="button"
                onClick={() => {
                  setSelected(idx);
                  setPassword('');
                  setError('');
                }}
                className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-4 transition ${
                  active
                    ? 'border-slate-900 bg-slate-50 shadow-md ring-2 ring-slate-900/20'
                    : 'border-slate-200 bg-white hover:border-slate-400'
                }`}
              >
                <span
                  className={`flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br ${u.avatarBg} text-2xl font-extrabold text-white shadow-sm`}
                >
                  {u.initial}
                </span>
                <span className="text-[14px] font-extrabold text-slate-900">{u.name}</span>
                {u.role && (
                  <span className="text-[11px] font-medium text-slate-500">{u.role}</span>
                )}
                <span className="text-[10px] font-medium text-slate-400">{u.email}</span>
              </button>
            );
          })}
        </div>

        {/* password for selected user */}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-center text-[13px] font-bold text-slate-700">
              Signing in as {user.name}
            </p>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="Enter password"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-20 text-sm font-medium focus:border-slate-900 focus:outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100"
              >
                {showPass ? 'Hide' : 'Show'}
              </button>
            </div>
            {error && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-red-600">
                <AlertCircle size={13} /> {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={autofill}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            >
              Auto-fill password
            </button>
            <button
              type="submit"
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 active:scale-[.98]"
            >
              <UserCircle size={16} /> Sign In
            </button>
          </div>

          <p className="text-center text-[11px] font-medium text-slate-400">
            Hint: {user.name} password is “{user.password}”
          </p>
        </form>
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
      existing?.status ||
      'Draft';
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

  const deleteQuote = (id) => {
    if (
      !window.confirm('Delete this quotation record? This cannot be undone.')
    )
      return;
    deleteDoc(doc(db, 'quotations', id)).catch((err) =>
      console.error('delete quote error', err),
    );
    if (currentQuoteId === id) setCurrentQuoteId(null);
    showToast('Quote deleted');
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
  const adjFactor = 1 + marginPct / 100;
  const adjBasicOf = (i) => (Number(i.sellingPrice) || 0) * adjFactor;
  const subtotal = lineItems.reduce((s, i) => s + adjBasicOf(i) * i.qty, 0);
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
<header className="no-print sticky top-0 z-40 h-16 px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
      {/* Left: branding */}
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

      {/* Center: search */}
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

      {/* Right: actions + account */}
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
        <div className="flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 pl-1 pr-3 py-1 hover:bg-slate-100 transition-colors">
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
          <button
            onClick={() => setAuthUser(null)}
            className="flex items-center justify-center rounded-md p-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
            title="Sign Out"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
    </header>


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
              <p className="mb-3 text-[13px] font-medium text-slate-500">
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
                  showToast('Details reset to defaults');
                }}
                archive={archive}
                clients={clients}
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
                            {marginPct !== 0 && (
                              <s className="text-slate-400">{fmt(i.sellingPrice)} </s>
                            )}
                            {fmt(adj)} +{i.gst}
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
              {['All', 'Draft', 'Sent', 'Confirmed', 'Invoices'].map((s) => {
                const count =
                  s === 'All'
                    ? archive.length
                    : s === 'Invoices'
                    ? archive.filter((q) => q.isInvoice).length
                    : archive.filter((q) => q.status === s).length;
                const label =
                  s === 'All'
                    ? 'All'
                    : s === 'Draft'
                    ? 'Drafts'
                    : s === 'Invoices'
                    ? 'Tax Invoices'
                    : s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition ${
                      statusFilter === s
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-extrabold tabular-nums ${
                        statusFilter === s ? 'bg-white/20' : 'bg-white'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-auto nice-scroll">
              {archive.filter(
                (q) =>
                  statusFilter === 'All' ||
                  (statusFilter === 'Invoices'
                    ? q.isInvoice
                    : q.status === statusFilter),
              ).length === 0 ? (
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
                    {archive
                      .filter(
                        (q) =>
                          statusFilter === 'All' ||
                          (statusFilter === 'Invoices'
                            ? q.isInvoice
                            : q.status === statusFilter),
                      )
                      .map((q) => {
                        const status = q.status || 'Draft';
                        const badgeCls = q.isInvoice
                          ? 'bg-purple-100 text-purple-800'
                          : status === 'Confirmed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : status === 'Sent'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800';
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
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${badgeCls}`}
                              >
                                {status}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                <button
                                  onClick={() => loadQuote(q)}
                                  className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white hover:bg-slate-700"
                                >
                                  Load / Edit
                                </button>
                                <button
                                  onClick={() => reprintQuote(q)}
                                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:border-slate-400"
                                >
                                  Re-print PDF
                                </button>
                                {status === 'Draft' && (
                                  <button
                                    onClick={() =>
                                      updateQuoteStatus(q.id, 'Sent')
                                    }
                                    className="rounded-lg bg-blue-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-blue-700"
                                  >
                                    Mark as Sent
                                  </button>
                                )}
                                {status === 'Sent' && (
                                  <button
                                    onClick={() =>
                                      updateQuoteStatus(q.id, 'Confirmed')
                                    }
                                    className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                                  >
                                    Mark as Confirmed
                                  </button>
                                )}
                                {status === 'Confirmed' && !q.isInvoice && (
                                  <button
                                    onClick={() => convertToInvoice(q)}
                                    className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                                  >
                                    Convert to Invoice
                                  </button>
                                )}
                                <button
                                  onClick={() => deleteQuote(q.id)}
                                  className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-50"
                                >
                                  Delete
                                </button>
                              </div>
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
        <div className="ae-print" style={{ fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827', fontSize: 11 }}>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 9.5 }}>
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
                  <td style={{ width: '7%', border: '1px solid #94a3b8', padding: 4, textAlign: 'center' }}>{discPct > 0 ? discPct + '%' : '-'}</td>
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
