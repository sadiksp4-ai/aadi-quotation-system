import { memo, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx/xlsx.mjs';
import { UploadCloud, Trash2, CheckCircle2, AlertTriangle, Search, X, Plus } from 'lucide-react';

function fileToDataUrl(file, maxDim = 600) {
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

const COL_KEYS = {
  description: ['item description', 'description', 'item', 'product', 'product name', 'name', 'particulars'],
  brand: ['brand', 'make', 'brand/make', 'brand / make'],
  qty: ['qty', 'quantity', 'qnty', 'nos', 'quantity (nos)'],
  unit: ['unit', 'uom', 'u/m', 'unit of measure'],
  spec: ['spec', 'specification', 'specs'],
  price: ['unit cost', 'unit price', 'rate', 'price', 'basic price', 'cost', 'mrp'],
  gst: ['gst', 'gst %', 'gst slab', 'gst rate', 'tax'],
  hsn: ['hsn', 'hsn code'],
  tag: ['tag', 'item code', 'sr no', 'sr. no', 'ref', 'sl no', 's.no', 'item no', 'code'],
  dimension: ['dimension', 'size', 'capacity', 'dims', 'measurements'],
  technical: ['description', 'material', 'remark', 'material spec', 'notes', 'remarks'],
  area: ['location', 'area', 'zone', 'section', 'department', 'station'],
};

function pickCol(headers, keys) {
  const lower = headers.map((h) => String(h || '').trim().toLowerCase());
  for (const k of keys) {
    const idx = lower.findIndex((h) => h === k || h.includes(k));
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizeGst(v, fallback = '18%') {
  if (v == null || v === '') return fallback;
  const m = String(v).match(/([\d.]+)/);
  if (!m) return fallback;
  const n = Number(m[1]);
  return `${n}%`;
}

function fuzzyScore(query, product) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const hay = [product.name, product.brand, product.sku, product.category, product.hsn, product.subcategory]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
  }
  if (hay.includes(q)) score += tokens.length;
  return score;
}

function bestMatch(description, catalog) {
  if (!description || !catalog?.length) return null;
  let best = null;
  let bestScore = 0;
  for (const p of catalog) {
    const sc = fuzzyScore(description, p);
    if (sc > bestScore) {
      bestScore = sc;
      best = p;
    }
  }
  const tokens = String(description).toLowerCase().split(/\s+/).filter(Boolean);
  const maxScore = tokens.length * 2;
  const ratio = maxScore > 0 ? bestScore / maxScore : 0;
  let level = 'none';
  if (best && ratio >= 0.8) level = 'high';
  else if (best && ratio >= 0.6) level = 'suggested';
  else level = 'none';
  return best ? { product: best, score: bestScore, level } : null;
}

function parseTextLines(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (line.includes('\t')) {
      const cols = line.split('\t').map((c) => c.trim());
      const desc = cols[0] || '';
      const qty = Number(String(cols[1] || '').replace(/[^0-9.]/g, '')) || 1;
      const price = Number(String(cols[2] || '').replace(/[^0-9.]/g, '')) || 0;
      const gst = normalizeGst(cols[3], '18%');
      rows.push({ description: desc, qty, unitPrice: price, gst, brand: '', hsn: '', image: '' });
      continue;
    }
    const m = line.match(/^(.*?)[\s\-–—xX*]+(\d+(?:\.\d+)?)\s*$/);
    if (m && m[1].trim()) {
      rows.push({ description: m[1].trim(), qty: Number(m[2]) || 1, unitPrice: 0, gst: '18%', brand: '', hsn: '', image: '' });
    } else {
      rows.push({ description: line, qty: 1, unitPrice: 0, gst: '18%', brand: '', hsn: '', image: '' });
    }
  }
  return rows;
}

const baseRow = (extra = {}) => ({
  id: Math.random().toString(36).slice(2),
  description: '',
  brand: '',
  qty: 1,
  unit: 'Nos',
  unitPrice: 0,
  gst: '18%',
  hsn: '',
  image: '',
  sku: '',
  include: true,
  saveToCatalog: false,
  searchQuery: '',
  searchOpen: false,
  manualMatch: false,
  dimensionOrCapacity: '',
  technicalSpec: '',
  clientTag: '',
  areaCategory: '',
  ...extra,
});

const RowCatalogSearch = memo(function RowCatalogSearch({ indexedCatalog, rowId, onSelectProduct }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const esc = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  const results = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (q.length < 2) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return indexedCatalog
      .filter(({ lookup }) => tokens.every((t) => lookup.includes(t)))
      .slice(0, 12)
      .map(({ p }) => p);
  }, [debounced, indexedCatalog]);

  return (
    <div className="relative boq-search-wrap">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search catalog..."
        className="w-full rounded border border-slate-200 px-2 py-1 text-[10px] focus:border-slate-900 focus:outline-none"
      />
      {open && debounced.trim().length >= 2 && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
          {results.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-400">No matches</div>
          )}
          {results.map((p) => (
            <button
              key={p.sku}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectProduct(rowId, p);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-left hover:bg-slate-50"
            >
              {p.image ? (
                <img src={p.image} alt="" className="h-8 w-8 rounded border border-slate-200 object-contain bg-white" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 text-[8px] text-slate-400">
                  N/A
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-bold text-slate-800">{p.name}</div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span className="rounded bg-slate-100 px-1 font-bold">{p.brand}</span>
                  <span className="font-mono">{p.sku}</span>
                </div>
              </div>
              <div className="text-right text-[10px] font-bold text-slate-700">
                <div>Rs {Number(p.sellingPrice || 0).toLocaleString('en-IN')}</div>
                <div className="text-slate-400">{p.gst}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default function BOQParser({ catalog = [], clients = [], onTransfer, onClose, onAddClient }) {
  const [tab, setTab] = useState('excel');
  const [rows, setRows] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [saveAll, setSaveAll] = useState(false);
  const [bulkGst, setBulkGst] = useState('');
  const [toast, setToast] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClient, setNewClient] = useState({
    propertyName: '',
    legalEntity: '',
    address: '',
    shippingAddress: '',
    gstin: '',
    stateCode: '27',
    contactPerson: '',
    designation: '',
    email: '',
  });

  useEffect(() => {
    const close = (e) => {
      const wraps = document.querySelectorAll('.boq-search-wrap');
      let inside = false;
      wraps.forEach((w) => {
        if (w.contains(e.target)) inside = true;
      });
      if (!inside) {
        setRows((prev) => prev.map((r) => (r.searchOpen ? { ...r, searchOpen: false } : r)));
      }
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        setRows((prev) => prev.map((r) => (r.searchOpen ? { ...r, searchOpen: false } : r)));
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const indexedCatalog = useMemo(
    () => catalog.map((p) => ({ p, lookup: `${p.name} ${p.sku} ${p.brand}`.toLowerCase() })),
    [catalog],
  );

  const matchedRows = useMemo(
    () =>
      rows.map((r) => {
        const m = r.matchedProduct || bestMatch(`${r.description} ${r.dimensionOrCapacity}`.trim(), catalog);
        const product = m?.product || null;
        const level = m?.level || 'none';
        const defaultSave = level !== 'high';
        let finalLevel = level;
        if (r.manualMatch || (r.sku && catalog.some((p) => p.sku === r.sku))) {
          finalLevel = 'high';
        }
        return {
          ...r,
          _match: m,
          _level: finalLevel,
          sku: r.sku || (product && level !== 'none' ? product.sku : ''),
          brand: r.brand || (product ? product.brand : ''),
          hsn: r.hsn || (product ? product.hsn : ''),
          unitPrice: r.unitPrice || (product ? Number(product.sellingPrice) || 0 : 0),
          gst: r.gst || (product ? product.gst : '18%'),
          image: r.image || (product ? product.image : ''),
          saveToCatalog: r.saveToCatalog != null ? r.saveToCatalog : (saveAll ? true : defaultSave),
        };
      }),
    [rows, catalog, saveAll],
  );

  const handleFile = async (file) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!json.length) return;
    const headers = Object.keys(json[0]);
    const ti = pickCol(headers, COL_KEYS.tag);
    const dimi = pickCol(headers, COL_KEYS.dimension);
    const techi = pickCol(headers, COL_KEYS.technical);
    const areai = pickCol(headers, COL_KEYS.area);
    const di = pickCol(headers, COL_KEYS.description);
    const bi = pickCol(headers, COL_KEYS.brand);
    const qi = pickCol(headers, COL_KEYS.qty);
    const ui = pickCol(headers, COL_KEYS.unit);
    const si = pickCol(headers, COL_KEYS.spec);
    const pi = pickCol(headers, COL_KEYS.price);
    const gi = pickCol(headers, COL_KEYS.gst);
    const hi = pickCol(headers, COL_KEYS.hsn);

    const tagIdx = ti >= 0 ? ti : 0;
    const descIdx = di >= 0 ? di : 1;
    const dimIdx = dimi >= 0 ? dimi : 2;
    const qtyIdx = qi >= 0 ? qi : 3;
    const brandIdx = bi >= 0 ? bi : 4;
    const techIdx = techi >= 0 ? techi : 5;
    const areaIdx = areai >= 0 ? areai : -1;
    const unitIdx = ui >= 0 ? ui : -1;
    const specIdx = si >= 0 ? si : -1;
    const priceIdx = pi >= 0 ? pi : -1;
    const gstIdx = gi >= 0 ? gi : -1;
    const hsnIdx = hi >= 0 ? hi : -1;

    let currentArea = '';
    const parsed = [];
    for (const row of json) {
      const arr = headers.map((h) => row[h]);
      const desc = descIdx >= 0 ? String(arr[descIdx] || '').trim() : '';
      const qty = qtyIdx >= 0 ? Number(String(arr[qtyIdx] || '').replace(/[^0-9.]/g, '')) || 0 : 0;
      const price = priceIdx >= 0 ? Number(String(arr[priceIdx] || '').replace(/[^0-9.]/g, '')) || 0 : 0;

      if (desc && !qty && !price && desc === desc.toUpperCase() && desc.length > 3) {
        currentArea = desc;
        continue;
      }

      const brand = brandIdx >= 0 && brandIdx !== descIdx ? String(arr[brandIdx] || '').trim() : '';
      const unit = unitIdx >= 0 ? String(arr[unitIdx] || '').trim() : '';
      const spec = specIdx >= 0 ? String(arr[specIdx] || '').trim() : '';
      const gst = gstIdx >= 0 ? normalizeGst(arr[gstIdx], '18%') : '18%';
      const hsn = hsnIdx >= 0 ? String(arr[hsnIdx] || '').trim() : '';
      const tag = tagIdx >= 0 && tagIdx !== descIdx ? String(arr[tagIdx] || '').trim() : '';
      let dimension = dimIdx >= 0 && dimIdx !== descIdx ? String(arr[dimIdx] || '').trim() : '';
      let technical = techIdx >= 0 && techIdx !== descIdx ? String(arr[techIdx] || '').trim() : '';
      const area = (areaIdx >= 0 && areaIdx !== descIdx ? String(arr[areaIdx] || '').trim() : '') || currentArea;

      if (!dimension && technical) {
        const capMatch = technical.match(/\b\d+(?:\.\d+)?\s*(?:KG|Kg|kg|LTR|Ltr|ltr|ML|ml|W|Watt|watt|mm|cm|inch|in)\b/i);
        if (capMatch) dimension = capMatch[0].trim();
      }

      const fullDesc = spec ? `${desc} (${spec})` : desc;
      if (!desc) continue;
      parsed.push(
        baseRow({
          description: fullDesc || desc,
          brand,
          qty: qty || 1,
          unit,
          unitPrice: price,
          gst,
          hsn,
          clientTag: tag,
          dimensionOrCapacity: dimension,
          technicalSpec: technical,
          areaCategory: area,
        }),
      );
    }
    setRows(parsed);
  };

  const handleTextParse = (text) => {
    const parsed = parseTextLines(text).map((r) =>
      baseRow({
        description: r.description,
        brand: r.brand || '',
        qty: r.qty || 1,
        unit: r.unit || '',
        unitPrice: r.unitPrice || 0,
        gst: r.gst || '18%',
        hsn: r.hsn || '',
      }),
    );
    setRows(parsed);
  };

  const updateRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const addCustomLine = () =>
    setRows((prev) => [
      ...prev,
      baseRow({ brand: 'Aadi', saveToCatalog: true }),
    ]);

  const handleImageUpload = async (id, file) => {
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      updateRow(id, { image: url });
    } catch {
      /* ignore */
    }
  };

  const toggleAll = (checked) => {
    setRows((prev) => prev.map((r) => ({ ...r, include: checked })));
  };

  const bulkRemoveSelected = () => {
    setRows((prev) => prev.filter((r) => !r.include));
  };

  const bulkSetGst = (gst) => {
    setRows((prev) => prev.map((r) => (r.include ? { ...r, gst } : r)));
  };

  const handleBulkAction = (val) => {
    if (val === 'gst18') bulkSetGst('18%');
    else if (val === 'gst5') bulkSetGst('5%');
    else if (val === 'remove') bulkRemoveSelected();
    setBulkGst('');
  };

  const selectProduct = (rowId, product) => {
    updateRow(rowId, {
      sku: product.sku,
      description: product.name,
      brand: product.brand,
      hsn: product.hsn || '',
      unitPrice: Number(product.sellingPrice) || 0,
      gst: product.gst || '18%',
      image: product.image || '',
      searchQuery: '',
      searchOpen: false,
      manualMatch: true,
    });
  };

  const catalogSearchResults = (query) => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return catalog
      .filter((p) => {
        const hay = [p.name, p.brand, p.sku].filter(Boolean).join(' ').toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 25);
  };

  const handleCreateClient = async () => {
    if (!newClient.propertyName.trim()) return;
    const client = {
      id: `c_${Date.now()}`,
      category: 'Custom Clients',
      accountName: newClient.legalEntity || newClient.propertyName,
      propertyName: newClient.propertyName,
      legalEntity: newClient.legalEntity || newClient.propertyName,
      address: newClient.address || '',
      city: '',
      contactPerson: newClient.contactPerson || '',
      designation: newClient.designation || '',
      phone: '',
      email: newClient.email || '',
      placeOfSupply: newClient.stateCode === '27' ? 'Maharashtra (27)' : `State (${newClient.stateCode})`,
      gstin: newClient.gstin || '',
      shippingAddress: newClient.shippingAddress || newClient.address || '',
      stateCode: newClient.stateCode || '27',
    };
    if (onAddClient) {
      const id = await onAddClient(client);
      setSelectedClient(String(id || client.id));
    } else {
      setSelectedClient(String(client.id));
    }
    setShowNewClient(false);
    setNewClient({
      propertyName: '',
      legalEntity: '',
      address: '',
      shippingAddress: '',
      gstin: '',
      stateCode: '27',
      contactPerson: '',
      designation: '',
      email: '',
    });
  };

  const included = matchedRows.filter((r) => r.include);
  const allSelected = matchedRows.length > 0 && matchedRows.every((r) => r.include);
  const matchedCount = included.filter((r) => r._level !== 'none').length;
  const estimated = included.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);
  const zeroPriceCount = included.filter((r) => !(Number(r.unitPrice) > 0)).length;

  const levelBadge = (level) => {
    if (level === 'high')
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">High Match</span>;
    if (level === 'suggested')
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">Suggested</span>;
    return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-700">Custom</span>;
  };

  const handleNormalize = () => {
    const knownMakes = Array.from(
      new Set([
        ...catalog.map((p) => p.brand).filter(Boolean),
        'Nilkamal',
        'Master',
        'Fabrikated',
        'Fabricated',
        'Jaquar',
        'Sirman',
        'Hobart',
        'Aadi',
      ]),
    );
    const spelling = {
      tabel: 'Table',
      washining: 'Washing',
      washng: 'Washing',
      stell: 'Steel',
      staimless: 'Stainless',
    };
    const capRe = /\b\d+(?:\.\d+)?\s*(?:KG|Kg|kg|LTR|Ltr|ltr|ML|ml|W|Watt|watt|mm|cm|inch|in)\b/i;

    let count = 0;
    setRows((prev) =>
      prev.map((r) => {
        let name = r.description || '';
        // spelling
        for (const [a, b] of Object.entries(spelling)) {
          const re = new RegExp(`\\b${a}\\b`, 'gi');
          name = name.replace(re, b);
        }
        let dimension = r.dimensionOrCapacity || '';
        let brand = r.brand || '';
        let technical = r.technicalSpec || '';

        // extract capacity from name if missing
        if (!dimension) {
          const m = name.match(capRe);
          if (m) {
            dimension = m[0].trim();
            name = name.replace(capRe, '').replace(/\s{2,}/g, ' ').trim();
          }
        }
        // also from technical if still missing
        if (!dimension && technical) {
          const m = technical.match(capRe);
          if (m) dimension = m[0].trim();
        }

        // split make from name
        if (!brand) {
          for (const mk of knownMakes) {
            const re = new RegExp(`\\b${mk}\\b`, 'i');
            if (re.test(name)) {
              brand = mk;
              name = name.replace(re, '').replace(/\s{2,}/g, ' ').trim();
              break;
            }
          }
        }

        // if technical empty but name had spec-like remainder? keep
        count += 1;
        return {
          ...r,
          description: name,
          brand,
          dimensionOrCapacity: dimension,
          technicalSpec: technical,
        };
      }),
    );
    setToast(`Cleaned and normalized ${rows.length} item specifications`);
    setTimeout(() => setToast(''), 2500);
  };

  const handleTransfer = () => {
    const enriched = matchedRows.map((r) => ({
      ...r,
      saveToCatalog: saveAll ? true : r.saveToCatalog,
    }));
    if (onTransfer) onTransfer(enriched, selectedClient);
  };

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-lg font-extrabold text-slate-900">BOQ Ingestion & Verification Studio</h1>
          <p className="text-xs font-medium text-slate-500">Import Excel/RFQ text, verify matches, then transfer to quotation</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
          <X size={20} />
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 bg-white px-5 pt-2">
        {[
          { id: 'excel', label: 'Excel / Spreadsheet Upload' },
          { id: 'text', label: 'Quick-Paste Client Email / Text' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-4 py-2 text-[13px] font-bold transition ${
              tab === t.id ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-5 nice-scroll">
        {tab === 'excel' && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className="mb-4 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center"
          >
            <UploadCloud size={32} className="text-slate-400" />
            <p className="text-sm font-bold text-slate-700">Drag & drop .xlsx / .xls / .csv here</p>
            <p className="text-xs text-slate-400">or</p>
            <label className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-700">
              Browse file
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          </div>
        )}

        {tab === 'text' && (
          <div className="mb-4">
            <textarea
              placeholder={`Paste RFQ text here, e.g.\nSteel Pressure Cooker - 5\nTramontina Cookware Set - 2`}
              className="h-40 w-full rounded-2xl border border-slate-200 bg-white p-3 text-[13px] font-medium focus:border-slate-900 focus:outline-none"
              onBlur={(e) => handleTextParse(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">Blur the field to parse. Supports tab-separated columns.</p>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 py-2">Photo</th>
                <th className="px-2 py-2">Match</th>
                <th className="px-2 py-2">Item Description</th>
                <th className="px-2 py-2">Make / Brand</th>
                <th className="px-2 py-2">SKU / HSN</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Unit Cost</th>
                <th className="px-2 py-2">GST</th>
                <th className="px-2 py-2">Save</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {matchedRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-slate-400">
                    No items parsed yet.
                  </td>
                </tr>
              )}
              {matchedRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) => updateRow(r.id, { include: e.target.checked })}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1">
                      {r.image ? (
                        <img src={r.image} alt="" className="h-10 w-10 rounded border border-slate-200 object-contain bg-white" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-slate-300 text-[9px] text-slate-400">
                          No img
                        </div>
                      )}
                      <label className="cursor-pointer rounded border border-slate-200 px-1.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50">
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(r.id, e.target.files?.[0])}
                        />
                      </label>
                    </div>
                  </td>
                  <td className="px-2 py-2">{levelBadge(r._level)}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap items-center gap-1 mb-1">
                      {r.clientTag && (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-extrabold text-blue-800">
                          Ref: {r.clientTag}
                        </span>
                      )}
                      {r.areaCategory && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-extrabold text-purple-800">
                          {r.areaCategory}
                        </span>
                      )}
                    </div>
                    <input
                      value={r.description}
                      onChange={(e) => updateRow(r.id, { description: e.target.value })}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] font-medium focus:border-slate-900 focus:outline-none"
                    />
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[10px] text-slate-400">📏</span>
                      <input
                        value={r.dimensionOrCapacity}
                        onChange={(e) => updateRow(r.id, { dimensionOrCapacity: e.target.value })}
                        placeholder="e.g. 20 KG"
                        className="flex-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-medium focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <input
                      value={r.technicalSpec}
                      onChange={(e) => updateRow(r.id, { technicalSpec: e.target.value })}
                      placeholder="SS 304 - 18/8 Ni/Cr"
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-0.5 text-[10px] italic text-slate-500 focus:border-slate-900 focus:outline-none"
                    />
                    {r._level !== 'none' && r._match?.product && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Matched: {r._match.product.name}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={r.brand}
                      onChange={(e) => updateRow(r.id, { brand: e.target.value })}
                      placeholder="Aadi"
                      className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] font-medium focus:border-slate-900 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <RowCatalogSearch
                      indexedCatalog={indexedCatalog}
                      rowId={r.id}
                      onSelectProduct={selectProduct}
                    />
                    <select
                      value={r.sku}
                      onChange={(e) => {
                        const p = catalog.find((x) => x.sku === e.target.value);
                        updateRow(r.id, {
                          sku: e.target.value,
                          brand: p?.brand || r.brand,
                          hsn: p?.hsn || r.hsn,
                          unitPrice: p ? Number(p.sellingPrice) || r.unitPrice : r.unitPrice,
                          gst: p?.gst || r.gst,
                          image: p?.image || r.image,
                          manualMatch: !!p,
                        });
                      }}
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px] font-mono focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">Custom (no SKU)</option>
                      {catalog.map((p) => (
                        <option key={p.sku} value={p.sku}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={r.hsn}
                      onChange={(e) => updateRow(r.id, { hsn: e.target.value })}
                      placeholder="HSN"
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[11px] font-mono focus:border-slate-900 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={1}
                      value={r.qty}
                      onChange={(e) => updateRow(r.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                      className="w-14 rounded border border-slate-200 px-2 py-1 text-center text-[12px] font-bold focus:border-slate-900 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      value={r.unitPrice}
                      onChange={(e) => updateRow(r.id, { unitPrice: Number(e.target.value) || 0 })}
                      className="w-20 rounded border border-slate-200 px-2 py-1 text-right text-[12px] font-bold focus:border-slate-900 focus:outline-none"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={r.gst}
                      onChange={(e) => updateRow(r.id, { gst: e.target.value })}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] font-bold focus:border-slate-900 focus:outline-none"
                    >
                      {['0%', '5%', '12%', '18%', '28%'].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={!!r.saveToCatalog}
                      onChange={(e) => updateRow(r.id, { saveToCatalog: e.target.checked })}
                      aria-label="Save to catalog"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button onClick={() => removeRow(r.id)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete row">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={addCustomLine}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 hover:border-slate-500"
          >
            <Plus size={14} /> Add New Custom Line
          </button>
          <label className="flex items-center gap-2 text-[12px] font-bold text-slate-700">
            <input type="checkbox" checked={saveAll} onChange={(e) => setSaveAll(e.target.checked)} />
            Save all custom/edited items to Master Catalog
          </label>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[12px] font-bold text-slate-700">
            Total Parsed: {matchedRows.length} items | Matched: {matchedCount} items | Estimated Basic Value: ₹{Math.round(estimated).toLocaleString('en-IN')}
          </div>
          {zeroPriceCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-extrabold text-amber-800">
              ⚠️ {zeroPriceCount} items have ₹0 price
            </span>
          )}
          <select
            value={bulkGst}
            onChange={(e) => handleBulkAction(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold focus:border-slate-900 focus:outline-none"
          >
            <option value="">Bulk actions...</option>
            <option value="gst18">Set Selected GST to 18%</option>
            <option value="gst5">Set Selected GST to 5%</option>
            <option value="remove">Remove Selected</option>
          </select>
          <button
            onClick={handleNormalize}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] font-bold text-indigo-700 hover:bg-indigo-100"
          >
            ✨ AI Normalize Specs
          </button>
          <select
            value={selectedClient}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setShowNewClient(true);
              } else {
                setSelectedClient(e.target.value);
              }
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold focus:border-slate-900 focus:outline-none"
          >
            <option value="">Select Client (optional)</option>
            <option value="__new__">[+ Add New Client...]</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.propertyName} — {c.legalEntity || c.accountName}
              </option>
            ))}
          </select>
          <button
            onClick={handleTransfer}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-700"
          >
            Transfer to Live Quotation
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-[95] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-[12px] font-bold text-white shadow-pop">
          {toast}
        </div>
      )}

      {showNewClient && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setShowNewClient(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-5 shadow-pop">
            <h2 className="mb-3 text-[15px] font-extrabold">Add New Client</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Client / Property Name</span>
                <input value={newClient.propertyName} onChange={(e) => setNewClient((p) => ({ ...p, propertyName: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Legal Entity / Billing Company</span>
                <input value={newClient.legalEntity} onChange={(e) => setNewClient((p) => ({ ...p, legalEntity: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Billing Address</span>
                <textarea value={newClient.address} onChange={(e) => setNewClient((p) => ({ ...p, address: e.target.value }))} rows={2} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Shipping Address</span>
                <textarea value={newClient.shippingAddress} onChange={(e) => setNewClient((p) => ({ ...p, shippingAddress: e.target.value }))} rows={2} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">GSTIN</span>
                <input value={newClient.gstin} onChange={(e) => setNewClient((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-mono focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">State Code</span>
                <input value={newClient.stateCode} onChange={(e) => setNewClient((p) => ({ ...p, stateCode: e.target.value.replace(/[^0-9]/g, '') }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-mono focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Contact Person</span>
                <input value={newClient.contactPerson} onChange={(e) => setNewClient((p) => ({ ...p, contactPerson: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Designation</span>
                <input value={newClient.designation} onChange={(e) => setNewClient((p) => ({ ...p, designation: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Email</span>
                <input type="email" value={newClient.email} onChange={(e) => setNewClient((p) => ({ ...p, email: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium focus:border-slate-900 focus:outline-none" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowNewClient(false)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-bold text-slate-600 hover:border-slate-400">
                Cancel
              </button>
              <button onClick={handleCreateClient} className="rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-700">
                Save Client
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}