import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Download,
  Eye,
  FileText,
  IndianRupee,
  Info,
  Loader2,
  Package,
  Percent,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Share2,
  ShieldCheck,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { COMPANY, INDIAN_STATES } from '../lib/company';
import {
  EMAIL_REGEX,
  GSTIN_REGEX,
  GST_RATE_OPTIONS,
  QUOTE_STATUSES,
  QUOTE_STATUS_STYLES,
  UNIT_OPTIONS,
  addDaysISO,
  calculateQuote,
  clamp,
  draftToRecord as buildRecord,
  formatDateIN,
  formatINR,
  formatINR2,
  generateQuoteNumber,
  newId,
  normalizeStatus,
  numberToWordsIN,
  parseGstRate,
  stateFromPlaceOfSupply,
  toNumber,
  validateQuote,
} from '../lib/quotation';
import QuotationDocument from './QuotationDocument';
import { downloadQuotationPdf, shareQuotationPdf } from '../lib/quotationPdf';
import { printQuotation } from '../lib/quotationPrint';

const inputCls =
  'w-full rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-medium text-ink shadow-sm outline-none transition placeholder:text-slate-400 focus:border-ink focus:ring-4 focus:ring-ink/5 disabled:bg-slate-50 disabled:text-slate-400';
const selectCls =
  'w-full appearance-none rounded-xl border border-line bg-white px-3 py-2 pr-8 text-[12.5px] font-semibold text-ink shadow-sm outline-none transition focus:border-ink focus:ring-4 focus:ring-ink/5';
const textareaCls =
  'w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-[12.5px] font-medium leading-relaxed text-ink shadow-sm outline-none transition placeholder:text-slate-400 focus:border-ink focus:ring-4 focus:ring-ink/5';

const RATE_OPTIONS = [...new Set([0, ...GST_RATE_OPTIONS, 12, 28])].sort((a, b) => a - b);

function Field({ label, error, hint, required, className = '', children }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 flex items-baseline gap-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
        {label}
        {required ? <span className="text-aadi">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 flex items-start gap-1 text-[10.5px] font-semibold leading-snug text-rose-600">
          <AlertCircle size={11} className="mt-0.5 shrink-0" /> {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[10.5px] leading-snug text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

function SectionCard({ title, subtitle, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-line bg-white shadow-soft ${className}`}>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line/80 px-4 py-3 sm:px-5">
        {Icon ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-white shadow-sm">
            <Icon size={15} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-extrabold tracking-tight text-ink-deep">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[10.5px] text-slate-400">{subtitle}</p> : null}
        </div>
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function StatusBadge({ status }) {
  const value = normalizeStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] ${
        QUOTE_STATUS_STYLES[value] || QUOTE_STATUS_STYLES.Draft
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value}
    </span>
  );
}

function parsePin(address) {
  const matches = String(address || '').match(/\b\d{6}\b/g);
  return matches ? matches[matches.length - 1] : '';
}

function clientDefaultDiscount(client) {
  const raw = client?.defaultDiscount;
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function itemFromProduct(product) {
  return {
    uid: newId('it'),
    sku: String(product.sku || '').trim(),
    brand: String(product.brand || '').trim(),
    name: String(product.name || '').trim(),
    description: String(product.name || '').trim(),
    image: product.image || '',
    hsn: String(product.hsn || '').trim(),
    unit: 'Nos',
    qty: 1,
    unitPrice: Math.max(0, toNumber(product.sellingPrice ?? product.unitPrice)),
    discount: { mode: 'percent', value: 0 },
    gstRate: clamp(parseGstRate(product.gst ?? product.gstRate), 0, 50),
    note: '',
    custom: Boolean(product.custom),
    mrp: Math.max(0, toNumber(product.mrp)),
  };
}

function emptyCustomItem() {
  const stamp = String(Date.now()).slice(-6);
  return {
    uid: newId('it'),
    sku: `AE-CUSTOM-${stamp}`,
    brand: 'Aadi',
    name: '',
    description: '',
    image: '',
    hsn: '',
    unit: 'Nos',
    qty: 1,
    unitPrice: 0,
    discount: { mode: 'percent', value: 0 },
    gstRate: 18,
    note: '',
    custom: true,
    mrp: 0,
  };
}

function ProductThumb({ item, size = 'md' }) {
  const [failed, setFailed] = useState(!item.image);
  useEffect(() => setFailed(!item.image), [item.image]);
  const dims = size === 'sm' ? 'h-9 w-9' : 'h-12 w-12';
  if (failed) {
    return (
      <span
        className={`${dims} flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-[11px] font-extrabold text-white`}
        aria-hidden="true"
      >
        {String(item.brand || item.name || 'A').slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`${dims} flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-white p-1`}>
      <img
        src={item.image}
        alt=""
        className="h-full w-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

function CataloguePicker({ open, onClose, catalog, onAdd, existingSkus, showToast }) {
  const [query, setQuery] = useState('');
  const [brand, setBrand] = useState('all');
  const [visible, setVisible] = useState(24);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setBrand('all');
    setVisible(24);
    const timer = setTimeout(() => searchRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open]);

  const brands = useMemo(() => {
    const map = new Map();
    (catalog || []).forEach((p) => map.set(p.brand, (map.get(p.brand) || 0) + 1));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog]);

  const results = useMemo(() => {
    let list = Array.isArray(catalog) ? catalog : [];
    if (brand !== 'all') list = list.filter((p) => p.brand === brand);
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length) {
      list = list.filter((p) => {
        const hay = [p.name, p.sku, p.brand, p.category, p.hsn].filter(Boolean).join(' ').toLowerCase();
        return tokens.every((token) => hay.includes(token));
      });
    }
    return list;
  }, [catalog, brand, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center p-0 sm:items-center sm:p-5">
      <div className="absolute inset-0 bg-ink-deep/55 animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add products from catalogue"
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-line bg-white shadow-pop animate-card-rise sm:rounded-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white">
            <Package size={16} />
          </span>
          <div>
            <h2 className="text-[14px] font-extrabold text-ink-deep">Add from catalogue</h2>
            <p className="text-[10.5px] text-slate-400">Search 900+ hospitality products</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-ink"
            aria-label="Close catalogue picker"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-line bg-slate-50/70 px-4 py-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(24);
              }}
              placeholder="Search product, SKU, brand, category or HSN…"
              className={`${inputCls} pl-9`}
              aria-label="Search catalogue"
            />
          </div>
          <div className="relative w-full sm:w-52">
            <select
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setVisible(24);
              }}
              className={selectCls}
              aria-label="Filter by brand"
            >
              <option value="all">All brands ({catalog?.length || 0})</option>
              {brands.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto nice-scroll px-4 py-3">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Package size={36} className="text-slate-200" />
              <p className="text-[13px] font-bold text-slate-700">No products found</p>
              <p className="text-[11.5px] text-slate-500">Try a different search term or brand.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.slice(0, visible).map((product) => {
                const already = existingSkus.has(product.sku);
                return (
                  <li
                    key={product.sku}
                    className="flex items-center gap-3 rounded-xl border border-line/80 bg-white p-2.5 shadow-soft transition hover:border-slate-300"
                  >
                    <ProductThumb item={product} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[12px] font-bold leading-snug text-ink-deep">{product.name}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                        <span className="font-mono font-bold text-slate-500">{product.sku}</span>
                        <span>{product.brand}</span>
                        <span>{product.category}</span>
                        {product.hsn ? <span>HSN {product.hsn}</span> : null}
                      </p>
                      <p className="mt-0.5 text-[11px] font-extrabold tabular-nums text-ink">
                        {formatINR(product.sellingPrice)}{' '}
                        <span className="text-[9.5px] font-semibold text-slate-400">+{product.gst} GST</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onAdd(product);
                        if (already) showToast?.(`${product.sku} quantity increased`);
                        else showToast?.(`${product.sku} added to quotation`);
                      }}
                      className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[11px] font-extrabold transition active:scale-95 ${
                        already
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-ink text-white hover:bg-ink-deep'
                      }`}
                    >
                      {already ? <Plus size={12} /> : <Plus size={12} />}
                      {already ? '+1' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {visible < results.length ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setVisible((v) => v + 24)}
                className="rounded-xl border border-line bg-white px-4 py-2 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
              >
                Load more ({results.length - visible} remaining)
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-slate-50/80 px-4 py-3">
          <p className="text-[10.5px] font-semibold text-slate-500">
            {results.length} product{results.length === 1 ? '' : 's'} available
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-ink px-4 py-2 text-[11.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ open, onClose, draft, busy, onPrint, onDownload, onShare }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-slate-900/65 animate-fade-in">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-ink-deep px-3 py-2.5 text-white sm:px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
          <FileText size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-extrabold">Quotation preview</p>
          <p className="text-[10px] text-white/60">{draft.quoteNo || 'Draft'} · A4 document</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onPrint}
            className="flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-[11px] font-bold text-white transition hover:bg-white/10"
          >
            <Printer size={13} /> <span className="hidden sm:inline">Print</span>
          </button>
          <button
            type="button"
            onClick={onShare}
            disabled={busy}
            className="flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-[11px] font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            {busy === 'share' ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
            <span className="hidden sm:inline">Share</span>
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={busy}
            className="flex h-8 items-center gap-1 rounded-lg bg-aadi px-2.5 text-[11px] font-extrabold text-white shadow-sm transition hover:bg-aadi-dark disabled:opacity-60"
          >
            {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            <span className="hidden sm:inline">Download PDF</span>
            <span className="sm:hidden">PDF</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white transition hover:bg-white/10"
            aria-label="Close preview"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-200/70 p-3 sm:p-6">
        <div className="mx-auto w-max max-w-none origin-top qb-doc-fit">
          <QuotationDocument value={draft} />
        </div>
      </div>
    </div>
  );
}

export default function QuoteBuilder({
  initialDraft,
  archive = [],
  clients = [],
  catalog = [],
  user = null,
  onClose,
  onSave,
  onUpdateStatus,
  onDelete,
  showToast,
  startPreview = false,
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState({});
  const [previewOpen, setPreviewOpen] = useState(Boolean(startPreview));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const topRef = useRef(null);

  const initialJson = useRef(JSON.stringify(initialDraft));
  useEffect(() => {
    setDraft(initialDraft);
    initialJson.current = JSON.stringify(initialDraft);
    setDirty(false);
    setErrors({});
    setShowErrors(false);
    setSelectedClientId(null);
  }, [initialDraft]);

  useEffect(() => {
    setDirty(JSON.stringify(draft) !== initialJson.current);
  }, [draft]);

  useEffect(() => {
    if (!showToast) return;
    const first = Object.values(errors)[0];
    if (showErrors && first) showToast(String(first));
  }, [showErrors, errors, showToast]);

  const totals = useMemo(() => calculateQuote(draft), [draft]);
  const lineByUid = useMemo(() => {
    const map = new Map();
    totals.lines.forEach((line) => map.set(line.uid, line));
    return map;
  }, [totals]);

  const gstGroups = useMemo(() => {
    const map = new Map();
    totals.lines.forEach((line) => {
      const key = Number(line.gstRate) || 0;
      const current = map.get(key) || { rate: key, taxable: 0, tax: 0 };
      current.taxable += line.taxableAmount;
      current.tax += line.gstAmount;
      map.set(key, current);
    });
    totals.charges
      .filter((charge) => charge.taxable)
      .forEach((charge) => {
        const key = Number(charge.gstRate) || 0;
        const current = map.get(key) || { rate: key, taxable: 0, tax: 0 };
        current.taxable += charge.amount;
        current.tax += charge.gstAmount;
        map.set(key, current);
      });
    return [...map.values()]
      .filter((group) => group.taxable !== 0 || group.tax !== 0)
      .sort((a, b) => a.rate - b.rate);
  }, [totals]);

  const existingSkus = useMemo(() => new Set((draft.items || []).map((item) => item.sku)), [draft.items]);

  const updateDraft = (patch) =>
    setDraft((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));

  const updateCustomer = (key, value) =>
    setDraft((prev) => {
      const customer = { ...prev.customer, [key]: value };
      if (key === 'billingAddress' && prev.customer.sameAsBilling) {
        customer.shippingAddress = value;
      }
      if (key === 'sameAsBilling' && value) {
        customer.shippingAddress = prev.customer.billingAddress;
      }
      return { ...prev, customer };
    });

  const updateSettings = (key, value) =>
    setDraft((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }));

  const updateItem = (uid, patch) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)),
    }));

  const updateItemDiscount = (uid, patch) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.uid === uid ? { ...item, discount: { ...item.discount, ...patch } } : item,
      ),
    }));

  const removeItem = (uid) =>
    setDraft((prev) => ({ ...prev, items: prev.items.filter((item) => item.uid !== uid) }));

  const addProduct = (product) => {
    setDraft((prev) => {
      const existing = prev.items.find((item) => item.sku === product.sku);
      if (existing) {
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.uid === existing.uid ? { ...item, qty: Math.max(1, toNumber(item.qty) + 1) } : item,
          ),
        };
      }
      return { ...prev, items: [...prev.items, itemFromProduct(product)] };
    });
  };

  const addCustomItem = () => {
    setDraft((prev) => ({ ...prev, items: [...prev.items, emptyCustomItem()] }));
    showToast?.('Custom item added — enter description and rate');
  };

  const addCharge = () =>
    updateDraft((prev) => ({
      ...prev,
      charges: [
        ...(prev.charges || []),
        { id: newId('ch'), label: '', amount: 0, taxable: false, gstRate: 18 },
      ],
    }));

  const updateCharge = (id, patch) =>
    updateDraft((prev) => ({
      ...prev,
      charges: (prev.charges || []).map((charge) =>
        charge.id === id ? { ...charge, ...patch } : charge,
      ),
    }));

  const removeCharge = (id) =>
    updateDraft((prev) => ({
      ...prev,
      charges: (prev.charges || []).filter((charge) => charge.id !== id),
    }));

  const regenerateQuoteNo = () => {
    const next = generateQuoteNumber(archive, draft.customer?.companyName || '', draft.quoteDate, draft.id);
    updateDraft({ quoteNo: next });
    showToast?.(`Quotation number set to ${next}`);
  };

  const onQuoteDateChange = (value) => {
    setDraft((prev) => {
      const wasDefault = prev.validUntil === addDaysISO(prev.quoteDate, 15);
      return {
        ...prev,
        quoteDate: value,
        validUntil: wasDefault || !prev.validUntil ? addDaysISO(value, 15) : prev.validUntil,
      };
    });
  };

  const selectClient = (id) => {
    const client = clients.find((c) => String(c.id) === String(id));
    if (!client) return;
    setSelectedClientId(client.id);
    const state = stateFromPlaceOfSupply(
      client.placeOfSupply || client.stateCode || COMPANY.stateName,
    );
    const billing = client.address || '';
    const shipping = client.shippingAddress || billing;
    const discount = clientDefaultDiscount(client);
    setDraft((prev) => ({
      ...prev,
      quoteNo: generateQuoteNumber(
        archive,
        client.legalEntity || client.accountName || '',
        prev.quoteDate,
        prev.id,
      ),
      customer: {
        ...prev.customer,
        companyName: client.legalEntity || client.accountName || client.propertyName || '',
        contactPerson: client.contactPerson || '',
        email: client.email || '',
        mobile: client.phone || '',
        gstin: String(client.gstin || '').toUpperCase(),
        billingAddress: billing,
        shippingAddress: shipping,
        sameAsBilling: !client.shippingAddress || shipping === billing,
        state: state.name,
        stateCode: state.code,
        city: client.city || '',
        pinCode: parsePin(billing),
        reference: client.propertyName || prev.customer.reference || '',
      },
      overallDiscount:
        discount > 0 && (!prev.overallDiscount?.value || prev.overallDiscount.value === 0)
          ? { mode: 'percent', value: discount }
          : prev.overallDiscount,
    }));
    showToast?.(`Customer details loaded${discount > 0 ? ` · ${discount}% client discount applied` : ''}`);
  };

  const scrollTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const runValidation = () => {
    const result = validateQuote(draft);
    setErrors(result.errors);
    setShowErrors(true);
    if (!result.valid) {
      scrollTop();
      return null;
    }
    return result;
  };

  const persist = async (status) => {
    if (!runValidation()) return null;
    setBusy(status === 'Draft' ? 'draft' : 'final');
    setShowErrors(false);
    try {
      const existing =
        draft.id
          ? archive.find((q) => q.id === draft.id) || {
              id: draft.id,
              createdAt: draft.createdAt,
            }
          : null;
      const record = draftToRecordCompat(draft, status, user, existing);
      const saved = await onSave(record);
      setDraft((prev) => ({
        ...prev,
        id: saved.id,
        status: saved.status,
        finalized: saved.finalized,
        quoteNo: saved.quoteNo,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      }));
      initialJson.current = JSON.stringify({
        ...draft,
        id: saved.id,
        status: saved.status,
        finalized: saved.finalized,
        quoteNo: saved.quoteNo,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      });
      setDirty(false);
      setErrors({});
      showToast?.(
        status === 'Draft'
          ? `Draft ${saved.quoteNo} saved`
          : `Quotation ${saved.quoteNo} generated`,
      );
      if (status !== 'Draft') setPreviewOpen(true);
      return saved;
    } catch (error) {
      console.error('save quotation error', error);
      showToast?.('Could not save the quotation. Please try again.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const draftToRecordCompat = (source, status, authUser, existing) =>
    buildRecord(source, { status, user: authUser, existing });

  const preview = () => {
    if (!runValidation()) return;
    setPreviewOpen(true);
  };

  const download = async () => {
    if (!runValidation()) return;
    setBusy('pdf');
    try {
      await downloadQuotationPdf(draft);
      showToast?.('Quotation PDF downloaded');
    } catch (error) {
      console.error('download quotation pdf error', error);
      showToast?.('Could not create the PDF. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const share = async () => {
    if (!runValidation()) return;
    setBusy('share');
    try {
      const result = await shareQuotationPdf(draft);
      showToast?.(result === 'shared' ? 'Quotation shared' : 'Quotation PDF downloaded');
    } catch (error) {
      console.error('share quotation error', error);
      showToast?.('Could not share the PDF. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const print = () => {
    if (!runValidation()) return;
    printQuotation(draft);
    showToast?.('Opening print preview');
  };

  const changeStatus = async (status) => {
    updateDraft({ status, finalized: status !== 'Draft' });
    if (draft.id && onUpdateStatus) {
      try {
        await onUpdateStatus(draft.id, status);
        showToast?.(`Status updated to ${status}`);
      } catch (error) {
        console.error('update quotation status error', error);
        showToast?.('Could not update status');
      }
    }
  };

  const errorCount = Object.keys(errors).length;
  const firstErrors = Object.values(errors).slice(0, 5);
  const gstinValue = String(draft.customer?.gstin || '').toUpperCase();
  const gstinLiveInvalid = Boolean(gstinValue) && !GSTIN_REGEX.test(gstinValue);
  const emailLiveInvalid = Boolean(draft.customer?.email) && !EMAIL_REGEX.test(draft.customer.email);

  return (
    <div className="quote-builder-shell min-h-screen pb-16" data-testid="quote-builder" ref={topRef}>
      <style>{`
        .qb-doc-fit { zoom: 1; }
        @media (max-width: 1000px) { .qb-doc-fit { zoom: 0.82; } }
        @media (max-width: 760px) { .qb-doc-fit { zoom: 0.58; } }
        @media (max-width: 520px) { .qb-doc-fit { zoom: 0.43; } }
      `}</style>

      {/* ============ BUILDER HEADER ============ */}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1550px] flex-wrap items-center gap-2 px-3 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
          >
            <ArrowLeft size={14} /> <span className="hidden sm:inline">Catalogue</span>
          </button>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-white shadow-sm">
            <img
              src={`${import.meta.env.BASE_URL}aadi-logo.png`}
              alt=""
              className="h-7 w-auto object-contain"
            />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[13.5px] font-extrabold leading-tight tracking-tight text-ink-deep">
                Quote Builder
              </h1>
              {dirty ? (
                <span className="hidden items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-700 sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved
                </span>
              ) : null}
            </div>
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              <span className="max-w-[150px] truncate font-mono text-[9.5px] normal-case tracking-normal" data-testid="qb-quote-no">
                {draft.quoteNo}
              </span>
              <StatusBadge status={draft.status} />
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => persist('Draft')}
              disabled={Boolean(busy)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink disabled:opacity-50"
              data-testid="qb-save-draft"
            >
              {busy === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              <span className="hidden md:inline">Save draft</span>
              <span className="md:hidden">Draft</span>
            </button>
            <button
              type="button"
              onClick={preview}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
              data-testid="qb-preview"
            >
              <Eye size={13} /> <span className="hidden md:inline">Preview</span>
            </button>
            <button
              type="button"
              onClick={download}
              disabled={Boolean(busy)}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 text-[11px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink disabled:opacity-50"
              data-testid="qb-download"
            >
              {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              <span className="hidden lg:inline">Download PDF</span>
              <span className="lg:hidden">PDF</span>
            </button>
            <button
              type="button"
              onClick={() => persist('Sent')}
              disabled={Boolean(busy)}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-ink px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-ink-deep disabled:opacity-50"
              data-testid="qb-finalize"
            >
              {busy === 'final' ? <Loader2 size={13} className="animate-spin" /> : <BadgeCheck size={13} />}
              <span className="hidden sm:inline">Generate quotation</span>
              <span className="sm:hidden">Finalise</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1550px] gap-4 px-3 pt-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="flex min-w-0 flex-col gap-4">
          {showErrors && errorCount > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 shadow-sm" role="alert">
              <p className="flex items-center gap-1.5 text-[12px] font-extrabold text-rose-700">
                <AlertCircle size={14} /> {errorCount} item{errorCount === 1 ? '' : 's'} need attention
              </p>
              <ul className="mt-1.5 grid gap-1 text-[11px] font-medium leading-snug text-rose-700 sm:grid-cols-2">
                {firstErrors.map((message) => (
                  <li key={message} className="flex items-start gap-1">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-500" /> {message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ============ CUSTOMER ============ */}
          <SectionCard
            title="Customer information"
            subtitle="Billing, shipping and contact details for this quotation"
            icon={Building2}
            action={
              <span className="hidden items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-emerald-700 sm:flex">
                <ShieldCheck size={11} /> GST ready
              </span>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Select saved client" className="sm:col-span-2 xl:col-span-3">
                <div className="relative">
                  <select
                    value={selectedClientId ?? ''}
                    onChange={(e) => selectClient(e.target.value)}
                    className={selectCls}
                    aria-label="Select saved client"
                  >
                    <option value="">Choose a client to auto-fill (optional)</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.legalEntity || client.accountName || client.propertyName}
                        {client.propertyName ? ` — ${client.propertyName}` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </Field>

              <Field
                label="Customer / company name"
                required
                error={errors['customer.companyName']}
                className="sm:col-span-2"
              >
                <input
                  value={draft.customer.companyName}
                  onChange={(e) => updateCustomer('companyName', e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Ascent Hotels Pvt Ltd"
                  data-testid="qb-company"
                />
              </Field>
              <Field label="Contact person" required error={errors['customer.contactPerson']}>
                <input
                  value={draft.customer.contactPerson}
                  onChange={(e) => updateCustomer('contactPerson', e.target.value)}
                  className={inputCls}
                  placeholder="Purchase manager / project lead"
                  data-testid="qb-contact"
                />
              </Field>
              <Field label="Email address" error={errors['customer.email']} hint={emailLiveInvalid ? 'Email format looks incomplete' : undefined}>
                <input
                  type="email"
                  value={draft.customer.email}
                  onChange={(e) => updateCustomer('email', e.target.value)}
                  className={inputCls}
                  placeholder="name@company.com"
                />
              </Field>
              <Field label="Mobile number" required error={errors['customer.mobile']}>
                <input
                  value={draft.customer.mobile}
                  onChange={(e) => updateCustomer('mobile', e.target.value)}
                  className={inputCls}
                  placeholder="10-digit mobile number"
                  inputMode="tel"
                  data-testid="qb-mobile"
                />
              </Field>
              <Field
                label="GSTIN"
                error={errors['customer.gstin']}
                hint={gstinLiveInvalid ? 'Expected 15 characters, e.g. 27AHRPB0512G1ZQ' : 'Optional for unregistered clients'}
              >
                <input
                  value={draft.customer.gstin}
                  onChange={(e) => updateCustomer('gstin', e.target.value.toUpperCase())}
                  className={`${inputCls} font-mono uppercase`}
                  placeholder="27AHRPB0512G1ZQ"
                  maxLength={15}
                  data-testid="qb-gstin"
                />
              </Field>
              <Field label="Customer reference / project" className="sm:col-span-2 xl:col-span-1">
                <input
                  value={draft.customer.reference}
                  onChange={(e) => updateCustomer('reference', e.target.value)}
                  className={inputCls}
                  placeholder="Hotel / project / PO reference"
                />
              </Field>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <Field label="Billing address" required error={errors['customer.billingAddress']}>
                <textarea
                  rows={3}
                  value={draft.customer.billingAddress}
                  onChange={(e) => updateCustomer('billingAddress', e.target.value)}
                  className={textareaCls}
                  placeholder="Building, street, area, city, state, PIN"
                  data-testid="qb-billing"
                />
              </Field>
              <div>
                <Field label="Shipping address" required={!draft.customer.sameAsBilling} error={errors['customer.shippingAddress']}>
                  <textarea
                    rows={3}
                    value={draft.customer.shippingAddress}
                    onChange={(e) => updateCustomer('shippingAddress', e.target.value)}
                    className={textareaCls}
                    placeholder="Delivery site address"
                    disabled={draft.customer.sameAsBilling}
                  />
                </Field>
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-slate-50/70 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={draft.customer.sameAsBilling}
                    onChange={(e) => updateCustomer('sameAsBilling', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-ink focus:ring-ink"
                  />
                  <span className="text-[11.5px] font-bold text-slate-600">Billing and shipping address are the same</span>
                </label>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="State / place of supply" required error={errors['customer.stateCode']}>
                <div className="relative">
                  <select
                    value={String(draft.customer.stateCode || '27').padStart(2, '0')}
                    onChange={(e) => {
                      const found = INDIAN_STATES.find((state) => state.code === e.target.value);
                      updateCustomer('stateCode', e.target.value);
                      updateCustomer('state', found?.name || '');
                    }}
                    className={selectCls}
                    aria-label="State / place of supply"
                  >
                    {INDIAN_STATES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.code} — {state.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </Field>
              <Field label="City" required error={errors['customer.city']}>
                <input
                  value={draft.customer.city}
                  onChange={(e) => updateCustomer('city', e.target.value)}
                  className={inputCls}
                  placeholder="Pune"
                  data-testid="qb-city"
                />
              </Field>
              <Field label="PIN code" required error={errors['customer.pinCode']}>
                <input
                  value={draft.customer.pinCode}
                  onChange={(e) => updateCustomer('pinCode', e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  className={inputCls}
                  placeholder="411014"
                  inputMode="numeric"
                  maxLength={6}
                  data-testid="qb-pin"
                />
              </Field>
            </div>
          </SectionCard>

          {/* ============ QUOTATION SETTINGS ============ */}
          <SectionCard
            title="Quotation settings"
            subtitle="Numbering, dates, commercial terms and remarks"
            icon={CalendarDays}
            action={
              <button
                type="button"
                onClick={regenerateQuoteNo}
                className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[10px] font-bold text-slate-500 transition hover:border-slate-300 hover:text-ink"
                title="Regenerate quotation number"
              >
                <RefreshCw size={11} /> Re-number
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Quotation number" required error={errors.quoteNo}>
                <input
                  value={draft.quoteNo}
                  onChange={(e) => updateDraft({ quoteNo: e.target.value })}
                  className={`${inputCls} font-mono font-bold`}
                />
              </Field>
              <Field label="Quotation date" required error={errors.quoteDate}>
                <input
                  type="date"
                  value={draft.quoteDate}
                  onChange={(e) => onQuoteDateChange(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Valid until" required error={errors.validUntil}>
                <input
                  type="date"
                  value={draft.validUntil}
                  onChange={(e) => updateDraft({ validUntil: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Status" hint="Status changes save immediately for saved quotations">
                <div className="relative">
                  <select
                    value={normalizeStatus(draft.status)}
                    onChange={(e) => changeStatus(e.target.value)}
                    className={selectCls}
                    data-testid="qb-status"
                  >
                    {QUOTE_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                </div>
              </Field>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Payment terms">
                <input
                  value={draft.settings.paymentTerms}
                  onChange={(e) => updateSettings('paymentTerms', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Delivery terms">
                <input
                  value={draft.settings.deliveryTerms}
                  onChange={(e) => updateSettings('deliveryTerms', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Installation terms">
                <input
                  value={draft.settings.installationTerms}
                  onChange={(e) => updateSettings('installationTerms', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Warranty terms">
                <input
                  value={draft.settings.warrantyTerms}
                  onChange={(e) => updateSettings('warrantyTerms', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <Field label="General terms & conditions" hint="One term per line. These appear on the quotation preview and PDF.">
                <textarea
                  rows={7}
                  value={(draft.settings.generalTerms || []).join('\n')}
                  onChange={(e) =>
                    updateSettings(
                      'generalTerms',
                      e.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                    )
                  }
                  className={textareaCls}
                />
              </Field>
              <Field label="Additional remarks">
                <textarea
                  rows={7}
                  value={draft.settings.remarks}
                  onChange={(e) => updateSettings('remarks', e.target.value)}
                  className={textareaCls}
                  placeholder="Any special note for the customer…"
                />
              </Field>
            </div>
          </SectionCard>

          {/* ============ ITEMS ============ */}
          <SectionCard
            title="Products & services"
            subtitle={`${draft.items.length} line item${draft.items.length === 1 ? '' : 's'} · edits here do not change the catalogue`}
            icon={ClipboardList}
            action={
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex h-8 items-center gap-1 rounded-lg border border-line bg-white px-2.5 text-[10.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
                  data-testid="qb-add-catalogue"
                >
                  <Package size={12} /> <span className="hidden sm:inline">From catalogue</span><span className="sm:hidden">Add</span>
                </button>
                <button
                  type="button"
                  onClick={addCustomItem}
                  className="flex h-8 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
                  data-testid="qb-add-custom"
                >
                  <Plus size={12} /> Custom item
                </button>
              </div>
            }
          >
            {draft.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-slate-50/60 px-6 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-white text-slate-300 shadow-soft">
                  <Package size={25} />
                </span>
                <p className="mt-1 text-[13px] font-bold text-ink-deep">No products in this quotation</p>
                <p className="max-w-sm text-[11.5px] leading-relaxed text-slate-500">
                  Add products from the catalogue, import a BOQ from the catalogue screen, or add a custom line item.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-[11.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
                  >
                    <Package size={13} /> Add from catalogue
                  </button>
                  <button
                    type="button"
                    onClick={addCustomItem}
                    className="flex items-center gap-1 rounded-xl border border-line bg-white px-3 py-2 text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
                  >
                    <Plus size={13} /> Custom item
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Desktop editable table */}
                <div className="hidden overflow-x-auto nice-scroll lg:block">
                  <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left" data-testid="qb-items">
                    <thead>
                      <tr className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-slate-400">
                        {['#', 'Product', 'Qty', 'Unit', 'Rate', 'Discount', 'GST', 'Taxable', 'Total', ''].map((heading) => (
                          <th key={heading} className="border-b border-line px-2 pb-2 text-left first:pl-0 last:pr-0">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.items.map((item, index) => {
                        const line = lineByUid.get(item.uid) || {};
                        return (
                          <tr key={item.uid} className="align-top">
                            <td className="w-8 border-b border-line/70 py-2.5 pl-0 pr-1 text-[11px] font-extrabold tabular-nums text-slate-400">
                              {index + 1}
                            </td>
                            <td className="min-w-[280px] border-b border-line/70 px-2 py-2.5">
                              <div className="flex gap-2.5">
                                <ProductThumb item={item} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      value={item.sku}
                                      onChange={(e) => updateItem(item.uid, { sku: e.target.value })}
                                      className="w-24 rounded-md border border-transparent bg-slate-50 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-slate-500 outline-none focus:border-line focus:bg-white"
                                      aria-label={`SKU for item ${index + 1}`}
                                    />
                                    <input
                                      value={item.brand}
                                      onChange={(e) => updateItem(item.uid, { brand: e.target.value })}
                                      className="w-20 rounded-md border border-transparent bg-slate-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700/80 outline-none focus:border-line focus:bg-white"
                                      aria-label={`Brand for item ${index + 1}`}
                                    />
                                    {item.custom ? (
                                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase text-amber-700">Custom</span>
                                    ) : null}
                                  </div>
                                  <textarea
                                    rows={2}
                                    value={item.description}
                                    onChange={(e) => updateItem(item.uid, {
                                      description: e.target.value,
                                      name: item.name || e.target.value,
                                    })}
                                    className="mt-1 w-full resize-y rounded-lg border border-line/80 bg-white px-2 py-1.5 text-[11.5px] font-semibold leading-snug text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/5"
                                    placeholder="Product description as it should appear on the quotation"
                                    aria-label={`Description for item ${index + 1}`}
                                  />
                                  <input
                                    value={item.note || ''}
                                    onChange={(e) => updateItem(item.uid, { note: e.target.value })}
                                    className="mt-1 w-full rounded-lg border border-transparent bg-slate-50/80 px-2 py-1 text-[10px] font-medium text-slate-500 outline-none focus:border-line focus:bg-white"
                                    placeholder="Optional note / specification for this line"
                                    aria-label={`Note for item ${index + 1}`}
                                  />
                                  {errors[`items.${item.uid}.name`] || errors[`items.${item.uid}.qty`] ? (
                                    <p className="mt-1 text-[10px] font-bold text-rose-600">
                                      {errors[`items.${item.uid}.name`] || errors[`items.${item.uid}.qty`]}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="w-20 border-b border-line/70 px-1.5 py-2.5">
                              <input
                                type="number"
                                min={1}
                                value={item.qty}
                                onChange={(e) => updateItem(item.uid, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                                className="w-full rounded-lg border border-line bg-white px-1.5 py-1.5 text-center text-[11.5px] font-extrabold tabular-nums text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/5"
                                aria-label={`Quantity for item ${index + 1}`}
                              />
                            </td>
                            <td className="w-20 border-b border-line/70 px-1.5 py-2.5">
                              <select
                                value={item.unit || 'Nos'}
                                onChange={(e) => updateItem(item.uid, { unit: e.target.value })}
                                className="w-full rounded-lg border border-line bg-white px-1.5 py-1.5 text-[10.5px] font-bold text-slate-600 outline-none focus:border-ink"
                                aria-label={`Unit for item ${index + 1}`}
                              >
                                {UNIT_OPTIONS.map((unit) => (
                                  <option key={unit} value={unit}>{unit}</option>
                                ))}
                              </select>
                            </td>
                            <td className="w-28 border-b border-line/70 px-1.5 py-2.5">
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">₹</span>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(e) => updateItem(item.uid, { unitPrice: e.target.value === '' ? '' : Number(e.target.value) })}
                                  className="w-full rounded-lg border border-line bg-white py-1.5 pl-5 pr-1.5 text-right text-[11px] font-bold tabular-nums text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/5"
                                  aria-label={`Unit price for item ${index + 1}`}
                                />
                              </div>
                            </td>
                            <td className="w-32 border-b border-line/70 px-1.5 py-2.5">
                              <div className="flex items-center gap-1">
                                <select
                                  value={item.discount?.mode || 'percent'}
                                  onChange={(e) => updateItemDiscount(item.uid, { mode: e.target.value })}
                                  className="w-12 rounded-lg border border-line bg-white px-1 py-1.5 text-[10px] font-bold text-slate-600 outline-none focus:border-ink"
                                  aria-label={`Discount mode for item ${index + 1}`}
                                >
                                  <option value="percent">%</option>
                                  <option value="amount">₹</option>
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  value={item.discount?.value ?? 0}
                                  onChange={(e) => updateItemDiscount(item.uid, { value: e.target.value === '' ? '' : Number(e.target.value) })}
                                  className="w-full rounded-lg border border-line bg-white px-1.5 py-1.5 text-right text-[11px] font-bold tabular-nums text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/5"
                                  aria-label={`Discount value for item ${index + 1}`}
                                />
                              </div>
                            </td>
                            <td className="w-20 border-b border-line/70 px-1.5 py-2.5">
                              <select
                                value={Number(item.gstRate) || 0}
                                onChange={(e) => updateItem(item.uid, { gstRate: Number(e.target.value) })}
                                className="w-full rounded-lg border border-line bg-white px-1.5 py-1.5 text-[10.5px] font-bold text-slate-600 outline-none focus:border-ink"
                                aria-label={`GST rate for item ${index + 1}`}
                              >
                                {RATE_OPTIONS.map((rate) => (
                                  <option key={rate} value={rate}>{rate}%</option>
                                ))}
                              </select>
                            </td>
                            <td className="w-24 border-b border-line/70 px-1.5 py-2.5 text-right text-[11px] font-bold tabular-nums text-slate-600">
                              {formatINR2(line.taxableAmount || 0)}
                            </td>
                            <td className="w-28 border-b border-line/70 px-1.5 py-2.5 text-right text-[11.5px] font-extrabold tabular-nums text-ink-deep">
                              {formatINR2(line.totalAmount || 0)}
                            </td>
                            <td className="w-8 border-b border-line/70 py-2.5 pl-1 pr-0">
                              <button
                                type="button"
                                onClick={() => removeItem(item.uid)}
                                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                                aria-label={`Remove item ${index + 1}`}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile stacked editors */}
                <div className="flex flex-col gap-2.5 lg:hidden">
                  {draft.items.map((item, index) => {
                    const line = lineByUid.get(item.uid) || {};
                    return (
                      <div key={item.uid} className="rounded-xl border border-line bg-white p-3 shadow-soft">
                        <div className="flex items-start gap-2.5">
                          <ProductThumb item={item} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-extrabold text-slate-400">#{index + 1}</span>
                              <input
                                value={item.sku}
                                onChange={(e) => updateItem(item.uid, { sku: e.target.value })}
                                className="w-24 rounded border border-transparent bg-slate-50 px-1 py-0.5 font-mono text-[9px] font-bold text-slate-500 outline-none focus:border-line focus:bg-white"
                                aria-label={`SKU for item ${index + 1}`}
                              />
                              <input
                                value={item.brand}
                                onChange={(e) => updateItem(item.uid, { brand: e.target.value })}
                                className="w-16 rounded border border-transparent bg-slate-50 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-700/80 outline-none focus:border-line focus:bg-white"
                                aria-label={`Brand for item ${index + 1}`}
                              />
                            </div>
                            <textarea
                              rows={2}
                              value={item.description}
                              onChange={(e) => updateItem(item.uid, { description: e.target.value, name: item.name || e.target.value })}
                              className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-[11px] font-semibold leading-snug outline-none focus:border-ink"
                              placeholder="Product description"
                              aria-label={`Description for item ${index + 1}`}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(item.uid)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Remove item ${index + 1}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Qty</span>
                            <input
                              type="number"
                              min={1}
                              value={item.qty}
                              onChange={(e) => updateItem(item.uid, { qty: e.target.value === '' ? '' : Number(e.target.value) })}
                              className={inputCls}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Unit</span>
                            <select
                              value={item.unit || 'Nos'}
                              onChange={(e) => updateItem(item.uid, { unit: e.target.value })}
                              className={selectCls}
                            >
                              {UNIT_OPTIONS.map((unit) => (
                                <option key={unit} value={unit}>{unit}</option>
                              ))}
                            </select>
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Unit price (₹)</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.unitPrice}
                              onChange={(e) => updateItem(item.uid, { unitPrice: e.target.value === '' ? '' : Number(e.target.value) })}
                              className={inputCls}
                            />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">GST</span>
                            <select
                              value={Number(item.gstRate) || 0}
                              onChange={(e) => updateItem(item.uid, { gstRate: Number(e.target.value) })}
                              className={selectCls}
                            >
                              {RATE_OPTIONS.map((rate) => (
                                <option key={rate} value={rate}>{rate}%</option>
                              ))}
                            </select>
                          </label>
                          <label className="col-span-2 block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Discount</span>
                            <div className="flex items-center gap-1.5">
                              <select
                                value={item.discount?.mode || 'percent'}
                                onChange={(e) => updateItemDiscount(item.uid, { mode: e.target.value })}
                                className={`${selectCls} w-20`}
                              >
                                <option value="percent">%</option>
                                <option value="amount">₹</option>
                              </select>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={item.discount?.value ?? 0}
                                onChange={(e) => updateItemDiscount(item.uid, { value: e.target.value === '' ? '' : Number(e.target.value) })}
                                className={inputCls}
                              />
                            </div>
                          </label>
                          <label className="col-span-2 block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Line note</span>
                            <input
                              value={item.note || ''}
                              onChange={(e) => updateItem(item.uid, { note: e.target.value })}
                              className={inputCls}
                              placeholder="Optional note"
                            />
                          </label>
                        </div>
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Taxable {formatINR2(line.taxableAmount || 0)}</span>
                          <span className="text-[12px] font-extrabold tabular-nums text-ink-deep">{formatINR2(line.totalAmount || 0)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-slate-50/70 px-3 py-2">
                  <p className="text-[10.5px] font-semibold text-slate-500">
                    {draft.items.length} line item{draft.items.length === 1 ? '' : 's'} · {totals.itemCount} unit{totals.itemCount === 1 ? '' : 's'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-1 text-[10.5px] font-extrabold text-ink transition hover:text-aadi"
                  >
                    <Plus size={12} /> Add more products
                  </button>
                </div>
              </>
            )}
          </SectionCard>

          {/* ============ DISCOUNTS & CHARGES ============ */}
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title="Overall discount" subtitle="Allocated across every taxable line before GST" icon={Percent}>
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-28">
                  <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Mode</span>
                  <div className="relative">
                    <select
                      value={draft.overallDiscount?.mode || 'percent'}
                      onChange={(e) => updateDraft({ overallDiscount: { ...draft.overallDiscount, mode: e.target.value } })}
                      className={selectCls}
                    >
                      <option value="percent">Percent</option>
                      <option value="amount">Amount</option>
                    </select>
                    <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  </div>
                </label>
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
                    {draft.overallDiscount?.mode === 'amount' ? 'Discount amount (₹)' : 'Discount percent (%)'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={draft.overallDiscount?.value ?? 0}
                    onChange={(e) => updateDraft({ overallDiscount: { ...draft.overallDiscount, value: e.target.value === '' ? '' : Number(e.target.value) } })}
                    className={inputCls}
                  />
                </label>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
                  <p className="text-[9px] font-extrabold uppercase tracking-wide text-emerald-600">Discount</p>
                  <p className="text-[13px] font-extrabold tabular-nums text-emerald-800">- {formatINR(totals.overallDiscountAmount)}</p>
                </div>
              </div>
              <p className="mt-2 flex items-start gap-1 text-[10.5px] leading-relaxed text-slate-400">
                <Info size={12} className="mt-0.5 shrink-0" />
                The overall discount is distributed proportionally across line items so GST is always calculated on the discounted taxable value.
              </p>
            </SectionCard>

            <SectionCard
              title="Additional charges"
              subtitle="Freight, installation, packing or other project charges"
              icon={Truck}
              action={
                <button
                  type="button"
                  onClick={addCharge}
                  className="flex h-8 items-center gap-1 rounded-lg bg-ink px-2.5 text-[10.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep"
                >
                  <Plus size={12} /> Add charge
                </button>
              }
            >
              {(draft.charges || []).length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-slate-50/60 px-4 py-6 text-center">
                  <Truck size={22} className="mx-auto text-slate-300" />
                  <p className="mt-1 text-[11.5px] font-bold text-slate-600">No additional charges</p>
                  <p className="text-[10.5px] text-slate-400">Add freight, packing, installation or other charges if applicable.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(draft.charges || []).map((charge, index) => (
                    <div key={charge.id} className="rounded-xl border border-line bg-white p-2.5 shadow-soft">
                      <div className="flex items-center gap-2">
                        <input
                          value={charge.label}
                          onChange={(e) => updateCharge(charge.id, { label: e.target.value })}
                          className={`${inputCls} flex-1`}
                          placeholder={`Charge ${index + 1} description`}
                          aria-label={`Charge ${index + 1} label`}
                        />
                        <button
                          type="button"
                          onClick={() => removeCharge(charge.id)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove charge ${index + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Amount (₹)</span>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={charge.amount}
                            onChange={(e) => updateCharge(charge.id, { amount: e.target.value === '' ? '' : Number(e.target.value) })}
                            className={inputCls}
                          />
                        </label>
                        <label className="block">
                          <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">GST treatment</span>
                          <select
                            value={charge.taxable ? 'taxable' : 'non-taxable'}
                            onChange={(e) => updateCharge(charge.id, { taxable: e.target.value === 'taxable' })}
                            className={selectCls}
                          >
                            <option value="non-taxable">Non-taxable</option>
                            <option value="taxable">Taxable</option>
                          </select>
                        </label>
                        {charge.taxable ? (
                          <label className="col-span-2 block">
                            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">GST rate</span>
                            <select
                              value={Number(charge.gstRate) || 0}
                              onChange={(e) => updateCharge(charge.id, { gstRate: Number(e.target.value) })}
                              className={selectCls}
                            >
                              {RATE_OPTIONS.map((rate) => (
                                <option key={rate} value={rate}>{rate}%</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </div>

        {/* ============ STICKY SUMMARY ============ */}
        <aside className="min-w-0">
          <div className="sticky top-[74px] flex flex-col gap-3">
            <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
              <div className="bg-ink-deep px-4 py-3.5 text-white">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-white/50">Quotation summary</p>
                    <p className="mt-0.5 truncate text-[12.5px] font-extrabold">{draft.customer.companyName || 'New customer'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-white/50">Valid until</p>
                    <p className="text-[11px] font-extrabold">{formatDateIN(draft.validUntil)}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5 p-4">
                <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                  <span>Subtotal</span>
                  <span className="font-bold tabular-nums text-ink" data-testid="qb-subtotal">{formatINR2(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-2 text-[11.5px] text-emerald-600">
                  <span>Total discount</span>
                  <span className="font-bold tabular-nums" data-testid="qb-total-discount">- {formatINR2(totals.totalDiscount)}</span>
                </div>
                <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                  <span>Taxable amount</span>
                  <span className="font-bold tabular-nums text-ink">{formatINR2(totals.taxableAmount)}</span>
                </div>
                {totals.intraState ? (
                  <>
                    <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                      <span>CGST</span>
                      <span className="font-bold tabular-nums text-ink">{formatINR2(totals.cgst)}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                      <span>SGST</span>
                      <span className="font-bold tabular-nums text-ink">{formatINR2(totals.sgst)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                    <span>IGST</span>
                    <span className="font-bold tabular-nums text-ink">{formatINR2(totals.igst)}</span>
                  </div>
                )}
                {totals.additionalChargesTotal > 0 ? (
                  <div className="flex justify-between gap-2 text-[11.5px] text-slate-500">
                    <span>Additional charges</span>
                    <span className="font-bold tabular-nums text-ink">{formatINR2(totals.additionalChargesTotal)}</span>
                  </div>
                ) : null}
                <div className="mt-2 flex items-end justify-between gap-2 border-t border-line pt-2.5">
                  <div>
                    <p className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Grand total</p>
                    <p className="text-[9px] font-semibold text-slate-400">Inclusive of GST</p>
                  </div>
                  <p className="text-[22px] font-extrabold leading-none tabular-nums tracking-tight text-ink-deep" data-testid="qb-grand-total">
                    {formatINR2(totals.grandTotal)}
                  </p>
                </div>
                <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-wide text-amber-700/80">Amount in words</p>
                  <p className="mt-0.5 text-[10.5px] font-bold leading-snug text-amber-900">{documentWords(totals.grandTotal)}</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-line bg-slate-50/60 p-3">
                <button
                  type="button"
                  onClick={() => persist('Draft')}
                  disabled={Boolean(busy)}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl border border-line bg-white text-[11.5px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink disabled:opacity-50"
                >
                  {busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  Save as draft
                </button>
                <button
                  type="button"
                  onClick={() => persist('Sent')}
                  disabled={Boolean(busy)}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-ink text-[11.5px] font-bold text-white shadow-sm transition hover:bg-ink-deep disabled:opacity-50"
                >
                  {busy === 'final' ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={14} />}
                  Generate final quotation
                </button>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={preview}
                    className="flex h-9 items-center justify-center gap-1 rounded-xl border border-line bg-white text-[10px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
                  >
                    <Eye size={12} /> Preview
                  </button>
                  <button
                    type="button"
                    onClick={download}
                    disabled={Boolean(busy)}
                    className="flex h-9 items-center justify-center gap-1 rounded-xl border border-line bg-white text-[10px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink disabled:opacity-50"
                  >
                    {busy === 'pdf' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} PDF
                  </button>
                  <button
                    type="button"
                    onClick={print}
                    className="flex h-9 items-center justify-center gap-1 rounded-xl border border-line bg-white text-[10px] font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-ink"
                  >
                    <Printer size={12} /> Print
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-line bg-white p-4 shadow-soft" data-testid="qb-gst-breakup">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <IndianRupee size={14} />
                </span>
                <div>
                  <h2 className="text-[12px] font-extrabold text-ink-deep">GST breakup</h2>
                  <p className="text-[9.5px] text-slate-400">{totals.intraState ? 'Intra-state · CGST + SGST' : 'Inter-state · IGST'}</p>
                </div>
              </div>
              {gstGroups.length === 0 ? (
                <p className="mt-2 text-[10.5px] text-slate-400">Add taxable products to see GST.</p>
              ) : (
                <div className="mt-2 overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-left text-[10px]">
                    <thead className="bg-slate-50 text-[8.5px] font-extrabold uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-2 py-1.5">Rate</th>
                        <th className="px-2 py-1.5 text-right">Taxable</th>
                        <th className="px-2 py-1.5 text-right">{totals.intraState ? 'CGST' : 'IGST'}</th>
                        {totals.intraState ? <th className="px-2 py-1.5 text-right">SGST</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {gstGroups.map((group) => (
                        <tr key={group.rate} className="border-t border-line/70">
                          <td className="px-2 py-1.5 font-extrabold text-slate-600">{group.rate}%</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{formatINR2(group.taxable)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink">
                            {formatINR2(totals.intraState ? group.tax / 2 : group.tax)}
                          </td>
                          {totals.intraState ? (
                            <td className="px-2 py-1.5 text-right tabular-nums font-bold text-ink">{formatINR2(group.tax / 2)}</td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-2 space-y-1 border-t border-line pt-2 text-[10px]">
                <div className="flex justify-between text-slate-400">
                  <span>Additional taxable</span>
                  <span className="font-bold tabular-nums text-slate-600">{formatINR2(totals.additionalChargesTaxable)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Additional non-taxable</span>
                  <span className="font-bold tabular-nums text-slate-600">{formatINR2(totals.additionalChargesNonTaxable)}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Total GST</span>
                  <span className="font-extrabold tabular-nums text-ink">{formatINR2(totals.gstTotal)}</span>
                </div>
              </div>
              <p className="mt-2 flex items-start gap-1 text-[9.5px] leading-relaxed text-slate-400">
                <Info size={11} className="mt-0.5 shrink-0" />
                {totals.intraState
                  ? 'Place of supply is Maharashtra, so GST is split equally between CGST and SGST.'
                  : 'Place of supply is outside Maharashtra, so IGST is charged.'}
              </p>
            </section>

            {draft.id ? (
              <section className="rounded-2xl border border-line bg-white p-3.5 shadow-soft">
                <p className="text-[9.5px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Saved record</p>
                <p className="mt-1 font-mono text-[11px] font-bold text-slate-600">{draft.quoteNo}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9.5px] font-bold text-slate-500">
                    {draft.items.length} items
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9.5px] font-bold text-slate-500">
                    {formatINR(totals.grandTotal)}
                  </span>
                  {draft.updatedAt ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9.5px] font-bold text-slate-500">
                      Updated {new Date(draft.updatedAt).toLocaleDateString('en-IN')}
                    </span>
                  ) : null}
                </div>
                {onDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete quotation ${draft.quoteNo}? This cannot be undone.`)) {
                        onDelete(draft.id);
                      }
                    }}
                    className="mt-2 flex items-center gap-1 text-[10px] font-bold text-rose-500 transition hover:text-rose-700"
                  >
                    <Trash2 size={11} /> Delete quotation
                  </button>
                ) : null}
              </section>
            ) : null}

            <div className="flex items-start gap-2 rounded-2xl border border-blue-200/70 bg-blue-50/70 px-3.5 py-3 text-[10px] leading-relaxed text-blue-800">
              <ShieldCheck size={14} className="mt-0.5 shrink-0" />
              <p>
                Saved quotations store a full snapshot of products, prices and customer details. Later catalogue price
                changes will not alter historical records.
              </p>
            </div>
          </div>
        </aside>
      </main>

      <CataloguePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        catalog={catalog}
        onAdd={addProduct}
        existingSkus={existingSkus}
        showToast={showToast}
      />

      <PreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        draft={draft}
        busy={busy}
        onPrint={print}
        onDownload={download}
        onShare={share}
      />
    </div>
  );
}

function documentWords(value) {
  return numberToWordsIN(value);
}
