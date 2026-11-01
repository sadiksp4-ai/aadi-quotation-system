import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx/xlsx.mjs';
import { UploadCloud, Trash2, CheckCircle2, AlertTriangle, Search, X } from 'lucide-react';

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
  if (![0, 5, 12, 18, 28].includes(n)) return `${n}%`;
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
  if (hay.includes(q)) score += tokens.length; // phrase bonus
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
  if (best && ratio >= 0.7) level = 'high';
  else if (best && ratio >= 0.3) level = 'suggested';
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

export default function BOQParser({ catalog = [], clients = [], onTransfer, onClose }) {
  const [tab, setTab] = useState('excel');
  const [rows, setRows] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [search, setSearch] = useState('');

  const matchedRows = useMemo(
    () =>
      rows.map((r) => {
        const m = r.matchedProduct || bestMatch(r.description, catalog);
        const product = m?.product || null;
        const level = m?.level || 'none';
        return {
          ...r,
          _match: m,
          _level: level,
          sku: r.sku || (product && level !== 'none' ? product.sku : ''),
          brand: r.brand || (product ? product.brand : ''),
          hsn: r.hsn || (product ? product.hsn : ''),
          unitPrice: r.unitPrice || (product ? Number(product.sellingPrice) || 0 : 0),
          gst: r.gst || (product ? product.gst : '18%'),
          image: r.image || (product ? product.image : ''),
        };
      }),
    [rows, catalog],
  );

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog.slice(0, 60);
    return catalog
      .filter((p) =>
        [p.name, p.brand, p.sku, p.hsn].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [catalog, search]);

  const handleFile = async (file) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!json.length) return;
    const headers = Object.keys(json[0]);
    const di = pickCol(headers, COL_KEYS.description);
    const bi = pickCol(headers, COL_KEYS.brand);
    const qi = pickCol(headers, COL_KEYS.qty);
    const ui = pickCol(headers, COL_KEYS.unit);
    const si = pickCol(headers, COL_KEYS.spec);
    const pi = pickCol(headers, COL_KEYS.price);
    const gi = pickCol(headers, COL_KEYS.gst);
    const hi = pickCol(headers, COL_KEYS.hsn);
    const parsed = json.map((row) => {
      const arr = headers.map((h) => row[h]);
      const desc = di >= 0 ? String(arr[di] || '').trim() : '';
      const brand = bi >= 0 ? String(arr[bi] || '').trim() : '';
      const qty = qi >= 0 ? Number(String(arr[qi]).replace(/[^0-9.]/g, '')) || 1 : 1;
      const unit = ui >= 0 ? String(arr[ui] || '').trim() : '';
      const spec = si >= 0 ? String(arr[si] || '').trim() : '';
      const price = pi >= 0 ? Number(String(arr[pi]).replace(/[^0-9.]/g, '')) || 0 : 0;
      const gst = gi >= 0 ? normalizeGst(arr[gi], '18%') : '18%';
      const hsn = hi >= 0 ? String(arr[hi] || '').trim() : '';
      const fullDesc = spec ? `${desc} (${spec})` : desc;
      return {
        id: Math.random().toString(36).slice(2),
        description: fullDesc || desc,
        brand,
        qty: qty || 1,
        unit,
        unitPrice: price,
        gst,
        hsn,
        image: '',
        sku: '',
        include: true,
      };
    }).filter((r) => r.description);
    setRows(parsed);
  };

  const handleTextParse = (text) => {
    const parsed = parseTextLines(text).map((r) => ({
      id: Math.random().toString(36).slice(2),
      description: r.description,
      brand: r.brand || '',
      qty: r.qty || 1,
      unit: r.unit || '',
      unitPrice: r.unitPrice || 0,
      gst: r.gst || '18%',
      hsn: r.hsn || '',
      image: r.image || '',
      sku: '',
      include: true,
    }));
    setRows(parsed);
  };

  const updateRow = (id, patch) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));

  const addCustomLine = () =>
    setRows((prev) => [
      ...prev,
      {
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
      },
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

  const included = matchedRows.filter((r) => r.include);
  const matchedCount = included.filter((r) => r._level !== 'none').length;
  const estimated = included.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unitPrice) || 0), 0);

  const levelBadge = (level) => {
    if (level === 'high')
      return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold text-emerald-800">High Match</span>;
    if (level === 'suggested')
      return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">Suggested</span>;
    return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-extrabold text-slate-700">Custom</span>;
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

      {/* Tabs */}
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

        {/* Verification grid */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2">Inc</th>
                <th className="px-2 py-2">Photo</th>
                <th className="px-2 py-2">Match</th>
                <th className="px-2 py-2">Item Description</th>
                <th className="px-2 py-2">SKU / HSN</th>
                <th className="px-2 py-2">Qty</th>
                <th className="px-2 py-2">Unit Cost</th>
                <th className="px-2 py-2">GST</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {matchedRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
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
                    <input
                      value={r.description}
                      onChange={(e) => updateRow(r.id, { description: e.target.value })}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-[12px] font-medium focus:border-slate-900 focus:outline-none"
                    />
                    {r._level !== 'none' && r._match?.product && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Matched: {r._match.product.name}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2">
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
                        });
                      }}
                      className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] font-mono focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">Custom (no SKU)</option>
                      {filteredCatalog.map((p) => (
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
                    {r._level !== 'none' && (
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search catalog..."
                        className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-[10px] focus:border-slate-900 focus:outline-none"
                      />
                    )}
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

        <button
          onClick={addCustomLine}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 hover:border-slate-500"
        >
          <CheckCircle2 size={14} /> Add New Custom Line
        </button>
      </div>

      {/* Action bar */}
      <div className="border-t border-slate-200 bg-white px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[12px] font-bold text-slate-700">
            Total Parsed: {matchedRows.length} items | Matched: {matchedCount} items | Estimated Basic Value: ₹{Math.round(estimated).toLocaleString('en-IN')}
          </div>
          <select
            value={selectedClient}
            onChange={(e) => setSelectedClient(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold focus:border-slate-900 focus:outline-none"
          >
            <option value="">Select Client (optional)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.propertyName} — {c.legalEntity || c.accountName}
              </option>
            ))}
          </select>
          <button
            onClick={() => onTransfer(matchedRows, selectedClient)}
            className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-bold text-white hover:bg-slate-700"
          >
            Transfer to Live Quotation
          </button>
        </div>
      </div>
    </div>
  );
}
