/**
 * Quote Builder domain model & calculation engine.
 *
 * Pure functions only – no React, no Firebase. Used by the builder UI,
 * the saved-record mapper and the PDF renderer so every surface computes
 * exactly the same numbers.
 */

import {
  COMPANY,
  DEFAULT_TERMS,
  INDIAN_STATES,
  STANDARD_TERMS,
} from './company.js';

export const QUOTE_STATUSES = [
  'Draft',
  'Sent',
  'Under Discussion',
  'Approved',
  'Rejected',
  'Expired',
];

export const QUOTE_STATUS_STYLES = {
  Draft: 'border-slate-200 bg-slate-100 text-slate-700',
  Sent: 'border-blue-200 bg-blue-100 text-blue-800',
  'Under Discussion': 'border-amber-200 bg-amber-100 text-amber-800',
  Approved: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  Rejected: 'border-rose-200 bg-rose-100 text-rose-800',
  Expired: 'border-slate-300 bg-slate-100 text-slate-600',
};

export const GST_RATE_OPTIONS = [0, 5, 12, 18, 28];
export const UNIT_OPTIONS = [
  'Nos',
  'Pcs',
  'Set',
  'Pair',
  'Box',
  'Pack',
  'Mtr',
  'Ltr',
  'Kg',
  'Roll',
];
export const DEFAULT_UNIT = 'Nos';
export const COMPANY_STATE_CODE = '27';

/* ------------------------------------------------------------------ */
/* Numbers / formatting                                               */
/* ------------------------------------------------------------------ */

export const toNumber = (value, fallback = 0) => {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

export const round2 = (value) =>
  Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;

export const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, toNumber(value, 0)));

/** Accepts 18, "18", "18%", "GST 18%" */
export function parseGstRate(gst) {
  if (gst === null || gst === undefined || gst === '') return 0;
  if (typeof gst === 'number') return Number.isFinite(gst) ? gst : 0;
  const match = String(gst).match(/([\d.]+)/);
  return match ? Number(match[1]) : 0;
}

export const gstLabel = (rate) => `${round2(rate)}%`;

const inr0 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const group0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const group2 = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const formatINR = (value) => inr0.format(round2(value));
export const formatINR2 = (value) => inr2.format(round2(value));
export const formatNumberIN = (value, decimals = 0) =>
  decimals ? group2.format(toNumber(value)) : group0.format(toNumber(value));
/** PDF-safe currency (standard PDF fonts don't carry the ₹ glyph). */
export const pdfMoney = (value) => `Rs. ${formatNumberIN(value, 2)}`;

export function todayISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso || todayISO()}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return todayISO(d);
}

export function formatDateIN(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const addressKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Printable address lines for a customer block.
 *
 * Client records often already end their street address with the city and PIN
 * (e.g. "…, Pune, Maharashtra 411001"). Appending the separate "City - PIN"
 * line in that case printed the location twice, so it is suppressed whenever
 * the address tail already carries it.
 */
export function addressLines({ address = '', city = '', pin = '' } = {}) {
  const street = String(address || '').replace(/\s+/g, ' ').trim();
  const cityText = String(city || '').replace(/\s+/g, ' ').trim();
  const pinText = String(pin || '').replace(/\s+/g, ' ').trim();
  const cityPin = cityText && pinText ? `${cityText} - ${pinText}` : cityText || pinText;
  const lines = street ? [street] : [];
  if (!cityPin) return lines;

  const tail = addressKey(street);
  const cityKey = addressKey(cityText);
  const pinKey = addressKey(pinText);
  const duplicated =
    Boolean(tail) &&
    (tail.endsWith(addressKey(cityPin)) ||
      (pinKey && tail.endsWith(pinKey)) ||
      (cityKey && pinKey && tail.includes(cityKey) && tail.includes(pinKey)));
  if (!duplicated) lines.push(cityPin);
  return lines;
}

/** Customer-facing email, always with a usable "@" even if data is patched. */
export function contactEmail(company = {}) {
  const email = String(company.email || '').trim();
  return email.includes('@') ? email : COMPANY.email;
}

export function numberToWordsIN(num) {
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
    if (h) parts.push(`${ones[h]} Hundred`);
    if (r) {
      if (r < 20) parts.push(ones[r]);
      else {
        const t = Math.floor(r / 10);
        const o = r % 10;
        parts.push(tens[t] + (o ? ` ${ones[o]}` : ''));
      }
    }
    return parts.join(' ');
  };
  const build = (input) => {
    let x = input;
    if (x === 0) return 'Zero';
    const crore = Math.floor(x / 10000000);
    x %= 10000000;
    const lakh = Math.floor(x / 100000);
    x %= 100000;
    const thousand = Math.floor(x / 1000);
    x %= 1000;
    const parts = [];
    if (crore) parts.push(`${threeDigits(crore)} Crore`);
    if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
    if (x) parts.push(threeDigits(x));
    return parts.join(' ').trim();
  };
  let result = `${build(rupees)} Rupees`;
  if (paise > 0) result += ` and ${build(paise)} Paise`;
  result += ' Only';
  if (n < 0) result = `Minus ${result}`;
  return result;
}

/* ------------------------------------------------------------------ */
/* States, statuses, numbering                                        */
/* ------------------------------------------------------------------ */

export function stateFromPlaceOfSupply(value) {
  const raw = String(value || '').trim();
  if (!raw) return { code: COMPANY_STATE_CODE, name: COMPANY.stateName };
  const codeMatch = raw.match(/\((\d{1,2})\)/) || raw.match(/\b(\d{1,2})\b/);
  if (codeMatch) {
    const code = codeMatch[1].padStart(2, '0');
    const found = INDIAN_STATES.find((s) => s.code === code);
    if (found) return found;
  }
  const found = INDIAN_STATES.find(
    (s) => s.name.toLowerCase() === raw.toLowerCase() || raw.toLowerCase().includes(s.name.toLowerCase()),
  );
  return found || { code: COMPANY_STATE_CODE, name: COMPANY.stateName };
}

export function isIntraStateSupply(stateCode, stateName) {
  const code = String(stateCode || '').trim();
  if (code) return code.padStart(2, '0') === COMPANY_STATE_CODE;
  return /maharashtra/i.test(String(stateName || ''));
}

export function normalizeStatus(raw) {
  const value = String(raw || 'Draft').trim();
  if (value === 'Confirmed' || value === 'Invoice Generated' || value === 'PO Received') {
    return 'Approved';
  }
  if (value === 'Revised' || value === 'Active') return 'Sent';
  if (value === 'In Discussion' || value === 'Negotiation') return 'Under Discussion';
  return QUOTE_STATUSES.includes(value) ? value : 'Draft';
}

export function clientInitials(name) {
  const cleaned = String(name || '').replace(/^the\s+/i, '').trim();
  if (!cleaned) return 'CL';
  const tokens = cleaned.split(/[\s\-/]+/).filter(Boolean);
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  let out = '';
  for (const token of tokens) {
    if (out.length >= 2) break;
    if (token.length <= 3) out += token.toUpperCase();
    else out += token[0].toUpperCase();
  }
  out = out.replace(/[^A-Z]/g, '').slice(0, 2);
  if (out.length < 2 && tokens[0].length >= 2) out = tokens[0].slice(0, 2).toUpperCase();
  return out || 'CL';
}

export function generateQuoteNumber(
  archive = [],
  clientName = '',
  quoteDate = todayISO(),
  excludeId = null,
) {
  const year = new Date(`${quoteDate}T00:00:00`).getFullYear() || new Date().getFullYear();
  const initials = clientInitials(clientName);
  const prefix = String(clientName || '').trim()
    ? `AE/${initials}/${year}-`
    : `AE/QTN/${year}-`;
  const used = new Set(
    archive
      .filter((q) => q && (!excludeId || q.id !== excludeId))
      .map((q) => String(q.quoteNo || '').trim().toUpperCase()),
  );
  let max = 0;
  for (const q of archive) {
    if (!q || (excludeId && q.id === excludeId)) continue;
    const quoteNo = String(q.quoteNo || '').trim().toUpperCase();
    if (!quoteNo.startsWith(prefix.toUpperCase())) continue;
    const m = quoteNo.slice(prefix.length).match(/^(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let seq = max + 1;
  let candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  while (used.has(candidate.toUpperCase())) {
    seq += 1;
    candidate = `${prefix}${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Draft <-> record mapping                                           */
/* ------------------------------------------------------------------ */

export function newId(prefix = 'q') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

export const deepClone = (value) =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));

export function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined || typeof v === 'function') continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

const splitLines = (terms) => {
  if (Array.isArray(terms)) return terms.filter(Boolean);
  return String(terms || '')
    .split('\n')
    .map((t) => t.replace(/^\s*[\d]+[.)]\s*/, '').trim())
    .filter(Boolean);
};

const validityDays = (value) => {
  const m = String(value || '').match(/(\d+)\s*day/i);
  return m ? Number(m[1]) : 15;
};

const parsePin = (address) => {
  const matches = String(address || '').match(/\b\d{6}\b/g);
  return matches ? matches[matches.length - 1] : '';
};

function baseSettings(overrides = {}) {
  return {
    paymentTerms: DEFAULT_TERMS.paymentTerms,
    deliveryTerms: DEFAULT_TERMS.deliveryTerms,
    installationTerms: DEFAULT_TERMS.installationTerms,
    warrantyTerms: DEFAULT_TERMS.warrantyTerms,
    generalTerms: [...STANDARD_TERMS],
    remarks: '',
    ...overrides,
    generalTerms: splitLines(overrides.generalTerms ?? STANDARD_TERMS),
  };
}

export function emptyCustomer() {
  return {
    companyName: '',
    contactPerson: '',
    email: '',
    mobile: '',
    gstin: '',
    billingAddress: '',
    shippingAddress: '',
    sameAsBilling: true,
    state: COMPANY.stateName,
    stateCode: COMPANY_STATE_CODE,
    city: '',
    pinCode: '',
    reference: '',
  };
}

export function emptyDraft({ archive = [], user = null, quoteDate = todayISO() } = {}) {
  return {
    __kind: 'draft',
    id: null,
    quoteNo: generateQuoteNumber(archive, '', quoteDate),
    quoteDate,
    validUntil: addDaysISO(quoteDate, 15),
    status: 'Draft',
    finalized: false,
    customer: emptyCustomer(),
    items: [],
    overallDiscount: { mode: 'percent', value: 0 },
    charges: [],
    settings: baseSettings(),
    createdBy: user?.name || '',
    createdByEmail: user?.email || '',
    createdAt: null,
    updatedAt: null,
  };
}

function mapCartLine(line, index) {
  const gstRate = line.gstRate != null ? toNumber(line.gstRate) : parseGstRate(line.gst);
  return {
    uid: newId(`it${index + 1}`),
    sku: String(line.sku || '').trim(),
    brand: String(line.brand || '').trim(),
    name: String(line.name || '').trim(),
    description: String(line.description || line.name || '').trim(),
    image: line.image || '',
    hsn: String(line.hsn || '').trim(),
    unit: line.unit || DEFAULT_UNIT,
    qty: Math.max(1, Math.round(toNumber(line.qty, 1))),
    unitPrice: Math.max(0, toNumber(line.sellingPrice ?? line.unitPrice)),
    discount: { mode: 'percent', value: 0 },
    gstRate: clamp(gstRate, 0, 50),
    note: String(line.note || line.technicalSpec || '').trim(),
    custom: Boolean(line.custom),
    mrp: Math.max(0, toNumber(line.mrp, 0)),
  };
}

export function draftFromCart({
  lines = [],
  details = {},
  archive = [],
  user = null,
  quoteDate = todayISO(),
} = {}) {
  const state = stateFromPlaceOfSupply(
    details.placeOfSupply || details.stateCode || COMPANY.stateName,
  );
  const quoteNo =
    String(details.quoteNo || '').trim() ||
    generateQuoteNumber(archive, details.clientName || '', quoteDate);
  const deliveryDays = validityDays(details.validity);
  const billing = String(details.address || '');
  const shipping = String(details.shippingAddress || '');
  const freight = Math.max(0, toNumber(details.freight));
  return {
    __kind: 'draft',
    id: null,
    quoteNo,
    quoteDate,
    validUntil: addDaysISO(quoteDate, deliveryDays),
    status: 'Draft',
    finalized: false,
    customer: {
      companyName: String(details.clientName || ''),
      contactPerson: String(details.contactPerson || ''),
      email: String(details.contactEmail || ''),
      mobile: String(details.contactPhone || ''),
      gstin: String(details.clientGstin || '').toUpperCase(),
      billingAddress: billing,
      shippingAddress: shipping || billing,
      sameAsBilling: !shipping || shipping === billing,
      state: state.name,
      stateCode: state.code,
      city: '',
      pinCode: parsePin(billing),
      reference: String(details.hotelName || ''),
    },
    items: (lines || []).map(mapCartLine),
    overallDiscount: {
      mode: 'percent',
      value: clamp(toNumber(details.marginPct), 0, 100),
    },
    charges: freight
      ? [
          {
            id: newId('ch'),
            label: 'Freight / Transport',
            amount: freight,
            taxable: false,
            gstRate: 0,
          },
        ]
      : [],
    settings: baseSettings({
      paymentTerms: details.payment || DEFAULT_TERMS.paymentTerms,
      deliveryTerms: details.delivery || DEFAULT_TERMS.deliveryTerms,
    }),
    createdBy: user?.name || '',
    createdByEmail: user?.email || '',
    createdAt: null,
    updatedAt: null,
  };
}

function mapStoredItem(item, index) {
  return {
    uid: item.uid || `it_${index}_${String(item.sku || '').replace(/[^A-Za-z0-9]/g, '')}`,
    sku: String(item.sku || '').trim(),
    brand: String(item.brand || '').trim(),
    name: String(item.name || '').trim(),
    description: String(item.description || item.name || '').trim(),
    image: item.image || '',
    hsn: String(item.hsn || '').trim(),
    unit: item.unit || DEFAULT_UNIT,
    qty: Math.max(1, Math.round(toNumber(item.qty, 1))),
    unitPrice: Math.max(0, toNumber(item.unitPrice ?? item.sellingPrice)),
    discount: {
      mode: item.discount?.mode === 'amount' ? 'amount' : 'percent',
      value: Math.max(0, toNumber(item.discount?.value)),
    },
    gstRate: clamp(
      item.gstRate != null ? toNumber(item.gstRate) : parseGstRate(item.gst),
      0,
      50,
    ),
    note: String(item.note || '').trim(),
    custom: Boolean(item.custom),
    mrp: Math.max(0, toNumber(item.mrp, 0)),
  };
}

export function draftFromQuote(quote, { user = null } = {}) {
  if (!quote) return emptyDraft({ user });
  const fallbackState = stateFromPlaceOfSupply(
    quote.placeOfSupply || quote.stateCode || COMPANY.stateName,
  );
  const customerSource = quote.customer || {};
  const state = customerSource.stateCode
    ? INDIAN_STATES.find((s) => s.code === String(customerSource.stateCode).padStart(2, '0')) ||
      fallbackState
    : fallbackState;
  const quoteDate = String(quote.quoteDate || todayISO()).slice(0, 10);
  const settings = quote.settings
    ? baseSettings(quote.settings)
    : baseSettings({
        paymentTerms: quote.payment || DEFAULT_TERMS.paymentTerms,
        deliveryTerms: quote.delivery || DEFAULT_TERMS.deliveryTerms,
      });
  const charges = Array.isArray(quote.charges)
    ? quote.charges.map((c) => ({
        id: c.id || newId('ch'),
        label: String(c.label || 'Additional charge'),
        amount: Math.max(0, toNumber(c.amount)),
        taxable: Boolean(c.taxable),
        gstRate: clamp(toNumber(c.gstRate), 0, 50),
      }))
    : Math.max(0, toNumber(quote.freight))
      ? [
          {
            id: newId('ch'),
            label: 'Freight / Transport',
            amount: Math.max(0, toNumber(quote.freight)),
            taxable: false,
            gstRate: 0,
          },
        ]
      : [];
  return {
    __kind: 'draft',
    id: quote.id || null,
    quoteNo: String(quote.quoteNo || '').trim() || generateQuoteNumber([], '', quoteDate),
    quoteDate,
    validUntil:
      String(quote.validUntil || '').slice(0, 10) ||
      addDaysISO(quoteDate, validityDays(quote.validity)),
    status: normalizeStatus(quote.status),
    finalized: Boolean(quote.finalized),
    customer: {
      companyName: String(customerSource.companyName ?? quote.clientName ?? ''),
      contactPerson: String(customerSource.contactPerson ?? quote.contactPerson ?? ''),
      email: String(customerSource.email ?? quote.contactEmail ?? ''),
      mobile: String(customerSource.mobile ?? quote.contactPhone ?? ''),
      gstin: String(customerSource.gstin ?? quote.clientGstin ?? '').toUpperCase(),
      billingAddress: String(customerSource.billingAddress ?? quote.address ?? ''),
      shippingAddress: String(
        customerSource.shippingAddress ?? quote.shippingAddress ?? quote.address ?? '',
      ),
      sameAsBilling:
        customerSource.sameAsBilling ??
        (!quote.shippingAddress || quote.shippingAddress === quote.address),
      state: customerSource.state || state.name,
      stateCode: String(customerSource.stateCode || state.code).padStart(2, '0'),
      city: String(customerSource.city || ''),
      pinCode: String(
        customerSource.pinCode || parsePin(customerSource.billingAddress ?? quote.address ?? ''),
      ),
      reference: String(customerSource.reference ?? quote.hotelName ?? ''),
    },
    items: (quote.items || []).map(mapStoredItem),
    overallDiscount: quote.overallDiscount
      ? {
          mode: quote.overallDiscount.mode === 'amount' ? 'amount' : 'percent',
          value: Math.max(0, toNumber(quote.overallDiscount.value)),
        }
      : { mode: 'percent', value: Math.max(0, toNumber(quote.marginPct)) },
    charges,
    settings,
    createdBy: quote.createdBy || user?.name || '',
    createdByEmail: quote.createdByEmail || user?.email || '',
    createdAt: quote.createdAt || null,
    updatedAt: quote.updatedAt || null,
  };
}

export function toDraft(input, options = {}) {
  if (!input) return emptyDraft(options);
  if (input.__kind === 'draft') return deepClone(input);
  return draftFromQuote(input, options);
}

/* ------------------------------------------------------------------ */
/* Calculation                                                        */
/* ------------------------------------------------------------------ */

export function calculateQuote({ items = [], overallDiscount, charges = [], customer } = {}) {
  const normalized = (items || []).map((item, index) => {
    const qty = Math.max(0, toNumber(item.qty));
    const unitPrice = Math.max(0, toNumber(item.unitPrice ?? item.sellingPrice));
    const grossAmount = round2(unitPrice * qty);
    const discount = item.discount || {};
    const discountMode = discount.mode === 'amount' ? 'amount' : 'percent';
    const discountValue = Math.max(0, toNumber(discount.value));
    const itemDiscount =
      discountMode === 'amount'
        ? round2(Math.min(discountValue, grossAmount))
        : round2((grossAmount * Math.min(discountValue, 100)) / 100);
    const taxableBeforeOverall = round2(grossAmount - itemDiscount);
    return {
      ...item,
      uid: item.uid || `line_${index}`,
      qty,
      unitPrice,
      grossAmount,
      discount: { mode: discountMode, value: discountValue },
      itemDiscount,
      taxableBeforeOverall,
      gstRate: clamp(toNumber(item.gstRate), 0, 50),
      overallDiscountAllocated: 0,
      taxableAmount: taxableBeforeOverall,
      gstAmount: 0,
      totalAmount: taxableBeforeOverall,
    };
  });

  const base = round2(normalized.reduce((sum, line) => sum + line.taxableBeforeOverall, 0));
  const mode = overallDiscount?.mode === 'amount' ? 'amount' : 'percent';
  const value = Math.max(0, toNumber(overallDiscount?.value));
  const overallDiscountAmount =
    base <= 0
      ? 0
      : mode === 'amount'
        ? round2(Math.min(value, base))
        : round2((base * Math.min(value, 100)) / 100);

  let allocated = 0;
  normalized.forEach((line, index) => {
    let share = 0;
    if (overallDiscountAmount > 0 && base > 0) {
      share =
        index === normalized.length - 1
          ? round2(overallDiscountAmount - allocated)
          : round2((overallDiscountAmount * line.taxableBeforeOverall) / base);
      share = Math.min(share, line.taxableBeforeOverall);
      allocated = round2(allocated + share);
    }
    line.overallDiscountAllocated = share;
    line.taxableAmount = round2(line.taxableBeforeOverall - share);
    line.gstAmount = round2((line.taxableAmount * line.gstRate) / 100);
    line.totalAmount = round2(line.taxableAmount + line.gstAmount);
  });

  const normalizedCharges = (charges || [])
    .map((charge, index) => {
      const amount = Math.max(0, toNumber(charge.amount));
      const taxable = Boolean(charge.taxable);
      const gstRate = taxable ? clamp(toNumber(charge.gstRate), 0, 50) : 0;
      return {
        ...charge,
        id: charge.id || `charge_${index}`,
        label: String(charge.label || '').trim(),
        amount: round2(amount),
        taxable,
        gstRate,
        gstAmount: taxable ? round2((amount * gstRate) / 100) : 0,
      };
    })
    .filter((charge) => charge.amount > 0 || charge.gstAmount > 0);

  const subtotal = round2(normalized.reduce((sum, line) => sum + line.grossAmount, 0));
  const itemDiscountTotal = round2(
    normalized.reduce((sum, line) => sum + line.itemDiscount, 0),
  );
  const totalDiscount = round2(itemDiscountTotal + overallDiscountAmount);
  const taxableAmount = round2(
    normalized.reduce((sum, line) => sum + line.taxableAmount, 0),
  );
  const itemGst = round2(normalized.reduce((sum, line) => sum + line.gstAmount, 0));
  const additionalChargesTotal = round2(
    normalizedCharges.reduce((sum, charge) => sum + charge.amount, 0),
  );
  const additionalChargesTaxable = round2(
    normalizedCharges.filter((c) => c.taxable).reduce((sum, c) => sum + c.amount, 0),
  );
  const additionalChargesNonTaxable = round2(
    normalizedCharges.filter((c) => !c.taxable).reduce((sum, c) => sum + c.amount, 0),
  );
  const additionalChargesGst = round2(
    normalizedCharges.reduce((sum, charge) => sum + charge.gstAmount, 0),
  );
  const gstTotal = round2(itemGst + additionalChargesGst);
  const stateCode = customer?.stateCode || COMPANY_STATE_CODE;
  const intraState = isIntraStateSupply(stateCode, customer?.state);
  const cgst = intraState ? round2(gstTotal / 2) : 0;
  const sgst = intraState ? round2(gstTotal - cgst) : 0;
  const igst = intraState ? 0 : gstTotal;
  const grandTotal = round2(taxableAmount + additionalChargesTotal + gstTotal);
  const itemCount = normalized.reduce((sum, line) => sum + line.qty, 0);

  return {
    lines: normalized,
    charges: normalizedCharges,
    subtotal,
    itemDiscountTotal,
    overallDiscountAmount,
    totalDiscount,
    taxableAmount,
    itemGst,
    additionalChargesTotal,
    additionalChargesTaxable,
    additionalChargesNonTaxable,
    additionalChargesGst,
    gstTotal,
    cgst,
    sgst,
    igst,
    grandTotal,
    itemCount,
    intraState,
    stateCode,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DIGITS = (v) => String(v || '').replace(/\D/g, '');

export function validateCustomer(customer = {}) {
  const errors = {};
  if (!String(customer.companyName || '').trim()) {
    errors['customer.companyName'] = 'Customer / company name is required';
  }
  if (!String(customer.contactPerson || '').trim()) {
    errors['customer.contactPerson'] = 'Contact person is required';
  }
  const mobile = DIGITS(customer.mobile);
  const mobile10 = mobile.length === 12 && mobile.startsWith('91') ? mobile.slice(2) : mobile;
  if (!mobile10) errors['customer.mobile'] = 'Mobile number is required';
  else if (!/^[6-9]\d{9}$/.test(mobile10)) {
    errors['customer.mobile'] = 'Enter a valid 10-digit Indian mobile number';
  }
  if (customer.email && !EMAIL_REGEX.test(String(customer.email).trim())) {
    errors['customer.email'] = 'Enter a valid email address';
  }
  const gstin = String(customer.gstin || '').trim().toUpperCase();
  if (gstin && !GSTIN_REGEX.test(gstin)) {
    errors['customer.gstin'] = 'GSTIN must be 15 characters (e.g. 27AHRPB0512G1ZQ)';
  }
  if (!String(customer.billingAddress || '').trim()) {
    errors['customer.billingAddress'] = 'Billing address is required';
  }
  if (!customer.sameAsBilling && !String(customer.shippingAddress || '').trim()) {
    errors['customer.shippingAddress'] = 'Shipping address is required';
  }
  if (!String(customer.stateCode || '').trim()) {
    errors['customer.stateCode'] = 'State is required';
  }
  if (!String(customer.city || '').trim()) {
    errors['customer.city'] = 'City is required';
  }
  const pin = DIGITS(customer.pinCode);
  if (!pin) errors['customer.pinCode'] = 'PIN code is required';
  else if (!/^[1-9]\d{5}$/.test(pin)) errors['customer.pinCode'] = 'Enter a valid 6-digit PIN code';
  return errors;
}

export function validateQuote(draft = {}) {
  const errors = validateCustomer(draft.customer);

  if (!String(draft.quoteNo || '').trim()) errors.quoteNo = 'Quotation number is required';
  if (!draft.quoteDate) errors.quoteDate = 'Quotation date is required';
  if (!draft.validUntil) errors.validUntil = 'Valid until date is required';
  if (draft.quoteDate && draft.validUntil && draft.validUntil < draft.quoteDate) {
    errors.validUntil = 'Valid until cannot be before the quotation date';
  }

  const items = draft.items || [];
  if (items.length === 0) {
    errors.items = 'Add at least one product to the quotation';
  } else {
    items.forEach((item, index) => {
      const label = `Item ${index + 1}`;
      if (!String(item.name || '').trim()) {
        errors[`items.${item.uid}.name`] = `${label}: product name is required`;
      }
      if (toNumber(item.qty) <= 0) {
        errors[`items.${item.uid}.qty`] = `${label}: quantity must be greater than 0`;
      }
      if (toNumber(item.unitPrice) < 0) {
        errors[`items.${item.uid}.unitPrice`] = `${label}: unit price cannot be negative`;
      }
      if (item.gstRate === '' || item.gstRate === null || item.gstRate === undefined) {
        errors[`items.${item.uid}.gstRate`] = `${label}: GST rate is required`;
      }
    });
  }

  (draft.charges || []).forEach((charge, index) => {
    if (!String(charge.label || '').trim()) {
      errors[`charges.${charge.id || index}.label`] = `Charge ${index + 1}: label is required`;
    }
    if (toNumber(charge.amount) < 0) {
      errors[`charges.${charge.id || index}.amount`] = `Charge ${index + 1}: amount cannot be negative`;
    }
  });

  const keys = Object.keys(errors);
  return { valid: keys.length === 0, errors, firstError: keys[0] || null };
}

/* ------------------------------------------------------------------ */
/* Record mapping / document model                                    */
/* ------------------------------------------------------------------ */

export function draftToRecord(draft, { status, user = null, existing = null } = {}) {
  const totals = calculateQuote(draft);
  const now = new Date().toISOString();
  const customer = draft.customer || {};
  const settings = baseSettings(draft.settings || {});
  const id = draft.id || existing?.id || newId('q');
  const quoteNo = String(draft.quoteNo || '').trim();
  const normalizedStatus = normalizeStatus(
    status || draft.status || existing?.status || 'Draft',
  );
  const stateCode = String(customer.stateCode || COMPANY_STATE_CODE).padStart(2, '0');
  const stateName =
    INDIAN_STATES.find((s) => s.code === stateCode)?.name || customer.state || COMPANY.stateName;
  const placeOfSupply = `${stateName} (${stateCode})`;

  const items = totals.lines.map((line) => ({
    uid: line.uid,
    sku: line.sku,
    brand: line.brand,
    name: line.name,
    description: line.description || line.name,
    image: line.image || '',
    hsn: line.hsn || '',
    unit: line.unit || DEFAULT_UNIT,
    qty: line.qty,
    unitPrice: line.unitPrice,
    sellingPrice: line.unitPrice,
    discount: line.discount,
    discountAmount: line.itemDiscount,
    overallDiscountAllocated: line.overallDiscountAllocated,
    gstRate: line.gstRate,
    gst: gstLabel(line.gstRate),
    note: line.note || '',
    custom: Boolean(line.custom),
    mrp: Number(line.mrp) || 0,
    grossAmount: line.grossAmount,
    taxableBeforeOverall: line.taxableBeforeOverall,
    taxableAmount: line.taxableAmount,
    gstAmount: line.gstAmount,
    totalAmount: line.totalAmount,
  }));

  const freight = round2(
    totals.charges.filter((c) => !c.taxable).reduce((sum, c) => sum + c.amount, 0),
  );

  return stripUndefined({
    id,
    schemaVersion: 2,
    quoteNo,
    quoteDate: draft.quoteDate,
    validUntil: draft.validUntil,
    status: normalizedStatus,
    finalized: normalizedStatus !== 'Draft',
    customer: {
      ...customer,
      companyName: String(customer.companyName || '').trim(),
      contactPerson: String(customer.contactPerson || '').trim(),
      email: String(customer.email || '').trim(),
      mobile: String(customer.mobile || '').trim(),
      gstin: String(customer.gstin || '').trim().toUpperCase(),
      billingAddress: String(customer.billingAddress || '').trim(),
      shippingAddress: String(
        customer.sameAsBilling
          ? customer.billingAddress
          : customer.shippingAddress || customer.billingAddress,
      ).trim(),
      sameAsBilling: Boolean(customer.sameAsBilling),
      state: stateName,
      stateCode,
      city: String(customer.city || '').trim(),
      pinCode: String(customer.pinCode || '').trim(),
      reference: String(customer.reference || '').trim(),
    },
    settings,
    overallDiscount: totals.overallDiscountAmount
      ? { mode: draft.overallDiscount?.mode === 'amount' ? 'amount' : 'percent', value: toNumber(draft.overallDiscount?.value) }
      : { mode: 'percent', value: 0 },
    charges: totals.charges,
    totals: {
      subtotal: totals.subtotal,
      itemDiscountTotal: totals.itemDiscountTotal,
      overallDiscountAmount: totals.overallDiscountAmount,
      totalDiscount: totals.totalDiscount,
      taxableAmount: totals.taxableAmount,
      gstTotal: totals.gstTotal,
      cgst: totals.cgst,
      sgst: totals.sgst,
      igst: totals.igst,
      additionalChargesTotal: totals.additionalChargesTotal,
      additionalChargesTaxable: totals.additionalChargesTaxable,
      additionalChargesNonTaxable: totals.additionalChargesNonTaxable,
      additionalChargesGst: totals.additionalChargesGst,
      grandTotal: totals.grandTotal,
      itemCount: totals.itemCount,
      intraState: totals.intraState,
    },
    items,
    itemCount: totals.itemCount,
    /* legacy flat fields kept so records, WhatsApp, search & print keep working */
    clientName: String(customer.companyName || '').trim(),
    hotelName: String(customer.reference || '').trim(),
    address: String(customer.billingAddress || '').trim(),
    shippingAddress: String(
      customer.sameAsBilling ? customer.billingAddress : customer.shippingAddress,
    ).trim(),
    clientGstin: String(customer.gstin || '').trim().toUpperCase(),
    clientPan: '',
    stateCode,
    contactPerson: String(customer.contactPerson || '').trim(),
    designation: '',
    contactPhone: String(customer.mobile || '').trim(),
    contactEmail: String(customer.email || '').trim(),
    placeOfSupply,
    delivery: settings.deliveryTerms,
    payment: settings.paymentTerms,
    validity: `Valid until ${formatDateIN(draft.validUntil)}`,
    freight,
    marginPct:
      draft.overallDiscount?.mode !== 'amount'
        ? clamp(toNumber(draft.overallDiscount?.value), 0, 100)
        : 0,
    subtotal: totals.taxableAmount,
    gstTotal: totals.gstTotal,
    grandTotal: totals.grandTotal,
    createdBy: draft.createdBy || existing?.createdBy || user?.name || '',
    createdByEmail: draft.createdByEmail || existing?.createdByEmail || user?.email || '',
    createdAt: existing?.createdAt || draft.createdAt || now,
    updatedAt: now,
    timestamp: now,
    revisionOf: existing?.revisionOf || draft.revisionOf || null,
  });
}

export function documentModel(input) {
  const draft = toDraft(input);
  const totals = calculateQuote(draft);
  const stateCode = String(draft.customer?.stateCode || COMPANY_STATE_CODE).padStart(2, '0');
  const stateName =
    INDIAN_STATES.find((s) => s.code === stateCode)?.name ||
    draft.customer?.state ||
    COMPANY.stateName;
  return {
    ...draft,
    company: COMPANY,
    items: totals.lines,
    charges: totals.charges,
    totals,
    stateName,
    stateCode,
    placeOfSupply: `${stateName} (${stateCode})`,
    intraState: totals.intraState,
    amountInWords: numberToWordsIN(totals.grandTotal),
  };
}

export function quoteStatusMeta(status) {
  const normalized = normalizeStatus(status);
  return {
    value: normalized,
    className: QUOTE_STATUS_STYLES[normalized],
  };
}

export const QUOTE_STATUS_TABS = [
  { key: 'All', label: 'All', match: () => true },
  { key: 'Draft', label: 'Drafts', match: (q) => normalizeStatus(q?.status) === 'Draft' },
  { key: 'Sent', label: 'Sent', match: (q) => normalizeStatus(q?.status) === 'Sent' },
  {
    key: 'Under Discussion',
    label: 'In Discussion',
    match: (q) => normalizeStatus(q?.status) === 'Under Discussion',
  },
  {
    key: 'Approved',
    label: 'Approved',
    match: (q) => normalizeStatus(q?.status) === 'Approved',
  },
  {
    key: 'Closed',
    label: 'Rejected / Expired',
    match: (q) => ['Rejected', 'Expired'].includes(normalizeStatus(q?.status)),
  },
];
