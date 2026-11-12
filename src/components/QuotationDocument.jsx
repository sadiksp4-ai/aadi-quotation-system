import { addressLines, contactEmail, documentModel, formatDateIN, formatINR2, gstLabel } from '../lib/quotation';

const LOGO_SRC =
  typeof window !== 'undefined'
    ? new URL(`${import.meta.env.BASE_URL || '/'}aadi-logo.png`, window.location.href).href
    : '';

const SIGNATURE_SRC =
  typeof window !== 'undefined'
    ? new URL(`${import.meta.env.BASE_URL || '/'}aadi-signature.png`, window.location.href).href
    : '';

const FIRST_PAGE_ITEMS = 4;
const LAST_PAGE_ITEMS = 8;
const MIDDLE_PAGE_ITEMS = 14;

/**
 * Split lines into A4 pages. Page one includes the customer block, so it
 * carries fewer rows. The final page also carries totals, terms, bank details
 * and the signature block, so it is kept deliberately lighter.
 */
export function paginateItems(lines = []) {
  const items = Array.isArray(lines) ? lines : [];
  if (items.length === 0) return [[]];
  if (items.length <= FIRST_PAGE_ITEMS) return [items];

  const pages = [];
  let offset = 0;
  const first = Math.min(FIRST_PAGE_ITEMS, items.length);
  pages.push(items.slice(0, first));
  offset = first;

  let remaining = items.length - offset;
  while (remaining > 0) {
    if (remaining <= LAST_PAGE_ITEMS) {
      pages.push(items.slice(offset, offset + remaining));
      remaining = 0;
    } else {
      const take = Math.min(MIDDLE_PAGE_ITEMS, remaining - LAST_PAGE_ITEMS);
      pages.push(items.slice(offset, offset + take));
      offset += take;
      remaining -= take;
    }
  }
  return pages;
}

function discountLabel(item) {
  if (!item.itemDiscount) return '—';
  if (item.discount?.mode === 'amount') return formatINR2(item.itemDiscount);
  return `${Number(item.discount?.value) || 0}%`;
}

function docHeader(model, compact) {
  const c = model.company;
  if (compact) {
    return (
      <header className="ae-doc-head ae-doc-head-compact">
        <div className="ae-doc-brandline">
          {LOGO_SRC ? <img src={LOGO_SRC} alt="" className="ae-doc-logo-sm" /> : null}
          <div>
            <p className="ae-doc-company">{c.name}</p>
            <p className="ae-doc-tagline">{c.tagline}</p>
          </div>
        </div>
        <div className="ae-doc-compact-meta">
          <span>Quotation</span>
          <strong>{model.quoteNo || '—'}</strong>
        </div>
      </header>
    );
  }

  return (
    <header className="ae-doc-head">
      <div className="ae-doc-head-main">
        <div className="ae-doc-brand">
          {LOGO_SRC ? <img src={LOGO_SRC} alt="Aadi Enterprises" className="ae-doc-logo" /> : null}
          <div className="ae-doc-brand-copy">
            <p className="ae-doc-company">{c.name}</p>
            <p className="ae-doc-tagline">{c.tagline}</p>
            <p className="ae-doc-company-meta">
              {c.address} · {c.phone}
            </p>
            <p className="ae-doc-company-meta">
              GSTIN: {c.gstin} · UDYAM: {c.udyam}
            </p>
          </div>
        </div>
        <div className="ae-doc-title-block">
          <p className="ae-doc-title">QUOTATION</p>
          <p className="ae-doc-title-rule" />
          <p className="ae-doc-no">{model.quoteNo || '—'}</p>
          <p className="ae-doc-title-meta">
            Date: <strong>{formatDateIN(model.quoteDate)}</strong>
          </p>
          <p className="ae-doc-title-meta">
            Valid until: <strong>{formatDateIN(model.validUntil)}</strong>
          </p>
        </div>
      </div>
      <div className="ae-doc-gold-rule" />
    </header>
  );
}

function AddressBlock({ title, name, address, city, pin, gstin, contact, phone, email }) {
  const locationLines = addressLines({ address, city, pin });
  return (
    <div className="ae-doc-address-block">
      <p className="ae-doc-address-title">{title}</p>
      <p className="ae-doc-address-name">{name || '—'}</p>
      {contact ? <p className="ae-doc-address-line">Attn: {contact}</p> : null}
      {locationLines.length ? (
        locationLines.map((line) => (
          <p key={line} className="ae-doc-address-line">
            {line}
          </p>
        ))
      ) : (
        <p className="ae-doc-address-line">—</p>
      )}
      {phone || email ? (
        <p className="ae-doc-address-line">{[phone, email].filter(Boolean).join(' · ')}</p>
      ) : null}
      {gstin ? <p className="ae-doc-address-line">GSTIN: {gstin}</p> : null}
    </div>
  );
}

function CustomerBlock({ model }) {
  const c = model.customer || {};
  return (
    <section className="ae-doc-customer">
      <AddressBlock
        title="Bill To"
        name={c.companyName}
        address={c.billingAddress}
        city={c.city}
        pin={c.pinCode}
        gstin={c.gstin}
        contact={c.contactPerson}
        phone={c.mobile}
        email={c.email}
      />
      <AddressBlock
        title="Ship To"
        name={c.companyName}
        address={c.sameAsBilling ? c.billingAddress : c.shippingAddress}
        city={c.city}
        pin={c.pinCode}
        contact={c.contactPerson}
        phone={c.mobile}
      />
      <div className="ae-doc-quote-meta">
        <p className="ae-doc-address-title">Quotation Details</p>
        <dl>
          <div>
            <dt>Place of supply</dt>
            <dd>{model.placeOfSupply}</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{c.reference || '—'}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd>{model.settings?.paymentTerms || '—'}</dd>
          </div>
          <div>
            <dt>Delivery</dt>
            <dd>{model.settings?.deliveryTerms || '—'}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ItemsTable({ items, startIndex }) {
  return (
    <table className="ae-doc-table">
      <colgroup>
        <col style={{ width: '6mm' }} />
        <col style={{ width: '11mm' }} />
        <col style={{ width: '18mm' }} />
        <col style={{ width: '46mm' }} />
        <col style={{ width: '8mm' }} />
        <col style={{ width: '8mm' }} />
        <col style={{ width: '19mm' }} />
        <col style={{ width: '17mm' }} />
        <col style={{ width: '8mm' }} />
        <col style={{ width: '20mm' }} />
        <col style={{ width: '20mm' }} />
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>Image</th>
          <th>SKU / HSN</th>
          <th>Product description</th>
          <th>Qty</th>
          <th>Unit</th>
          <th>Rate</th>
          <th>Disc.</th>
          <th>GST</th>
          <th>Taxable</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <tr>
            <td colSpan={11} className="ae-doc-empty">
              No products added to this quotation.
            </td>
          </tr>
        ) : (
          items.map((item, index) => (
            <tr key={item.uid || `${item.sku}-${startIndex + index}`}>
              <td className="ae-doc-center">{startIndex + index + 1}</td>
              <td className="ae-doc-center">
                {item.image ? (
                  <img src={item.image} alt="" className="ae-doc-thumb" />
                ) : (
                  <span className="ae-doc-thumb-fallback">
                    {String(item.brand || 'A').slice(0, 1)}
                  </span>
                )}
              </td>
              <td>
                <span className="ae-doc-sku">{item.sku || '—'}</span>
                {item.hsn ? <span className="ae-doc-hsn">HSN {item.hsn}</span> : null}
              </td>
              <td>
                <span className="ae-doc-item-name">{item.name || item.description}</span>
                {item.description && item.description !== item.name ? (
                  <span className="ae-doc-item-desc">{item.description}</span>
                ) : null}
                {item.note ? <span className="ae-doc-item-note">{item.note}</span> : null}
                {item.brand ? <span className="ae-doc-item-brand">{item.brand}</span> : null}
              </td>
              <td className="ae-doc-center">{item.qty}</td>
              <td className="ae-doc-center">{item.unit || 'Nos'}</td>
              <td className="ae-doc-right ae-doc-num">{formatINR2(item.unitPrice)}</td>
              <td className="ae-doc-center ae-doc-num">{discountLabel(item)}</td>
              <td className="ae-doc-center ae-doc-num">{gstLabel(item.gstRate)}</td>
              <td className="ae-doc-right ae-doc-num">{formatINR2(item.taxableAmount)}</td>
              <td className="ae-doc-right ae-doc-strong ae-doc-num">{formatINR2(item.totalAmount)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function TotalsBlock({ model }) {
  const t = model.totals;
  return (
    <section className="ae-doc-totals-wrap">
      <div className="ae-doc-words">
        <p className="ae-doc-address-title">Amount in words</p>
        <p className="ae-doc-words-text">{model.amountInWords}</p>
      </div>
      <div className="ae-doc-totals">
        <div className="ae-doc-total-row">
          <span>Subtotal</span>
          <strong>{formatINR2(t.subtotal)}</strong>
        </div>
        {t.totalDiscount > 0 ? (
          <div className="ae-doc-total-row ae-doc-discount-row">
            <span>Total discount</span>
            <strong>- {formatINR2(t.totalDiscount)}</strong>
          </div>
        ) : null}
        <div className="ae-doc-total-row">
          <span>Taxable amount</span>
          <strong>{formatINR2(t.taxableAmount)}</strong>
        </div>
        {model.intraState ? (
          <>
            <div className="ae-doc-total-row">
              <span>CGST</span>
              <strong>{formatINR2(t.cgst)}</strong>
            </div>
            <div className="ae-doc-total-row">
              <span>SGST</span>
              <strong>{formatINR2(t.sgst)}</strong>
            </div>
          </>
        ) : (
          <div className="ae-doc-total-row">
            <span>IGST</span>
            <strong>{formatINR2(t.igst)}</strong>
          </div>
        )}
        {t.additionalChargesTotal > 0 ? (
          <div className="ae-doc-total-row">
            <span>Additional charges</span>
            <strong>{formatINR2(t.additionalChargesTotal)}</strong>
          </div>
        ) : null}
        <div className="ae-doc-grand">
          <span>Grand Total</span>
          <strong>{formatINR2(t.grandTotal)}</strong>
        </div>
      </div>
    </section>
  );
}

function TermsBlock({ model }) {
  const s = model.settings || {};
  const terms = Array.isArray(s.generalTerms) ? s.generalTerms : [];
  return (
    <section className="ae-doc-terms">
      <div className="ae-doc-terms-grid">
        <div>
          <p className="ae-doc-address-title">Terms &amp; conditions</p>
          <ol className="ae-doc-terms-list">
            {terms.slice(0, 8).map((term, index) => (
              <li key={`${index}-${term.slice(0, 12)}`}>{term}</li>
            ))}
          </ol>
        </div>
        <div className="ae-doc-terms-meta">
          <div>
            <dt>Payment terms</dt>
            <dd>{s.paymentTerms || '—'}</dd>
          </div>
          <div>
            <dt>Delivery terms</dt>
            <dd>{s.deliveryTerms || '—'}</dd>
          </div>
          <div>
            <dt>Installation</dt>
            <dd>{s.installationTerms || '—'}</dd>
          </div>
          <div>
            <dt>Warranty</dt>
            <dd>{s.warrantyTerms || '—'}</dd>
          </div>
          {s.remarks ? (
            <div>
              <dt>Remarks</dt>
              <dd>{s.remarks}</dd>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function BankAndSign({ model }) {
  const c = model.company;
  return (
    <section className="ae-doc-bank-sign">
      <div className="ae-doc-bank">
        <p className="ae-doc-address-title">Bank details</p>
        <p>
          <strong>{c.bankName}</strong>
        </p>
        <p>
          {c.bank} · {c.branch}
        </p>
        <p>A/C No: {c.account}</p>
        <p>IFSC: {c.ifsc}</p>
        <p className="ae-doc-bank-note">
          Payment reference: {model.quoteNo || 'quotation number'}
        </p>
      </div>
      <div className="ae-doc-sign">
        <p>For {c.name}</p>
        <div className="ae-doc-sign-space">
          {SIGNATURE_SRC ? (
            <img
              src={SIGNATURE_SRC}
              alt="Authorised signature"
              className="ae-doc-sign-img"
            />
          ) : null}
        </div>
        <p className="ae-doc-sign-line">Authorised Signatory</p>
      </div>
    </section>
  );
}

function PageFooter({ model, page, total }) {
  const c = model.company;
  return (
    <footer className="ae-doc-footer">
      <span>
        {c.website} · {contactEmail(c)} · {c.phone}
      </span>
      <span>
        {model.quoteNo || '—'} · Page {page} of {total}
      </span>
    </footer>
  );
}

export const QUOTATION_DOC_CSS = `
.ae-doc-root {
  --ae-navy: #14253d;
  --ae-navy-deep: #0e1a2b;
  --ae-gold: #c9a66b;
  --ae-ink: #1e293b;
  --ae-muted: #64748b;
  --ae-line: #e2e8f0;
  --ae-soft: #f8fafc;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  color: var(--ae-ink);
  font-family: 'Plus Jakarta Sans', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  font-size: 8.5pt;
  line-height: 1.35;
}
.ae-doc-page {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  padding: 11mm 12mm 13mm;
  background: #ffffff;
  box-shadow: 0 18px 45px -22px rgba(14, 26, 43, 0.45), 0 2px 8px rgba(14, 26, 43, 0.08);
  overflow: hidden;
}
.ae-doc-page * { box-sizing: border-box; }
.ae-doc-head { flex: 0 0 auto; }
.ae-doc-head-main { display: flex; align-items: flex-start; justify-content: space-between; gap: 8mm; }
.ae-doc-brand { display: flex; align-items: flex-start; gap: 4mm; min-width: 0; }
.ae-doc-logo { width: 19mm; height: 19mm; object-fit: contain; }
.ae-doc-logo-sm { width: 9mm; height: 9mm; object-fit: contain; }
.ae-doc-company { margin: 0; font-size: 18pt; font-weight: 800; letter-spacing: 0.04em; color: var(--ae-navy); line-height: 1.05; }
.ae-doc-tagline { margin: 1.2mm 0 0; font-size: 8pt; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #a07840; }
.ae-doc-company-meta { margin: 1mm 0 0; font-size: 7.4pt; color: var(--ae-muted); }
.ae-doc-title-block { text-align: right; flex: 0 0 auto; }
.ae-doc-title { margin: 0; font-size: 20pt; font-weight: 800; letter-spacing: 0.14em; color: var(--ae-navy); line-height: 1; }
.ae-doc-title-rule { width: 30mm; height: 0.9mm; margin: 2mm 0 2.2mm auto; background: var(--ae-gold); }
.ae-doc-no { margin: 0; font-size: 9.4pt; font-weight: 800; color: var(--ae-navy); }
.ae-doc-title-meta { margin: 1.2mm 0 0; font-size: 7.6pt; color: var(--ae-muted); }
.ae-doc-title-meta strong { color: var(--ae-ink); }
.ae-doc-gold-rule { height: 1.4mm; margin-top: 5mm; background: linear-gradient(90deg, var(--ae-navy) 0%, var(--ae-navy) 62%, var(--ae-gold) 62%, var(--ae-gold) 100%); }
.ae-doc-head-compact { display: flex; align-items: center; justify-content: space-between; gap: 4mm; padding-bottom: 2.5mm; border-bottom: 0.8mm solid var(--ae-navy); }
.ae-doc-brandline { display: flex; align-items: center; gap: 2.5mm; }
.ae-doc-head-compact .ae-doc-company { font-size: 11pt; letter-spacing: 0.03em; }
.ae-doc-head-compact .ae-doc-tagline { margin-top: 0.5mm; font-size: 6pt; }
.ae-doc-compact-meta { text-align: right; font-size: 7pt; color: var(--ae-muted); }
.ae-doc-compact-meta span { display: block; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
.ae-doc-compact-meta strong { font-size: 8.4pt; color: var(--ae-navy); }

.ae-doc-customer { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; gap: 3.5mm; margin: 5mm 0 4.5mm; }
.ae-doc-address-block, .ae-doc-quote-meta { display: flex; flex-direction: column; min-width: 0; padding: 3mm 3.2mm; border: 0.3mm solid var(--ae-line); border-radius: 1.5mm; background: var(--ae-soft); }
.ae-doc-address-title { margin: 0 0 1.5mm; font-size: 6.6pt; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; color: #a07840; }
.ae-doc-address-name { margin: 0 0 1mm; font-size: 9pt; font-weight: 800; color: var(--ae-navy); }
.ae-doc-address-line { margin: 0.4mm 0; font-size: 7.3pt; color: #475569; overflow-wrap: anywhere; }
.ae-doc-quote-meta dl { margin: 0; display: flex; flex-direction: column; gap: 1.1mm; padding-bottom: 0.5mm; }
.ae-doc-quote-meta dl > div { display: grid; grid-template-columns: 1fr; gap: 0.15mm; }
.ae-doc-quote-meta dt { font-size: 6.4pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; line-height: 1.2; }
.ae-doc-quote-meta dd { margin: 0; font-size: 7.6pt; font-weight: 700; color: var(--ae-ink); line-height: 1.25; }

.ae-doc-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ae-doc-table thead { display: table-header-group; }
.ae-doc-table th { padding: 1.8mm 1.2mm; background: var(--ae-navy); color: #ffffff; font-size: 6.3pt; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; text-align: left; }
.ae-doc-table td { padding: 1.4mm 1.2mm; border-bottom: 0.25mm solid var(--ae-line); font-size: 7pt; vertical-align: top; }
.ae-doc-table tbody tr:nth-child(even) td { background: #fbfdff; }
.ae-doc-table tbody tr { break-inside: avoid; page-break-inside: avoid; }
.ae-doc-center { text-align: center !important; }
.ae-doc-right { text-align: right !important; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ae-doc-num { font-size: 6.5pt; padding-left: 0.8mm !important; padding-right: 0.8mm !important; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ae-doc-strong { font-weight: 800; color: var(--ae-navy); }
.ae-doc-sku { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 6.8pt; font-weight: 700; color: var(--ae-navy); overflow-wrap: anywhere; }
.ae-doc-hsn { display: block; margin-top: 0.4mm; font-size: 6pt; color: #94a3b8; }
.ae-doc-item-name { display: block; font-size: 7.4pt; font-weight: 800; color: #0f172a; line-height: 1.25; }
.ae-doc-item-desc { display: block; margin-top: 0.5mm; font-size: 6.3pt; font-weight: 400; color: #475569; line-height: 1.3; }
.ae-doc-item-brand { display: inline-block; margin-top: 1mm; padding: 0.35mm 1.4mm; border: 0.2mm solid #efe3cd; border-radius: 1mm; background: #fbf6ec; font-size: 5.9pt; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #a07840; }
.ae-doc-item-note { display: block; margin-top: 0.5mm; font-size: 6.2pt; color: var(--ae-muted); font-style: italic; }
.ae-doc-thumb { display: block; width: 9mm; height: 9mm; margin: 0 auto; border: 0.25mm solid var(--ae-line); border-radius: 1mm; object-fit: contain; background: #fff; }
.ae-doc-thumb-fallback { display: flex; align-items: center; justify-content: center; width: 9mm; height: 9mm; margin: 0 auto; border-radius: 1mm; background: var(--ae-navy); color: #fff; font-size: 7pt; font-weight: 800; }
.ae-doc-empty { padding: 8mm 0 !important; text-align: center; color: var(--ae-muted); font-style: italic; }

.ae-doc-totals-wrap { display: grid; grid-template-columns: 1fr 64mm; gap: 6mm; margin-top: 4.5mm; break-inside: avoid; page-break-inside: avoid; }
.ae-doc-words { padding: 2.5mm 3mm; border: 0.3mm solid var(--ae-line); border-radius: 1.5mm; background: #fcfaf5; align-self: start; }
.ae-doc-words-text { margin: 0; font-size: 7.4pt; font-weight: 700; color: var(--ae-navy); line-height: 1.45; }
.ae-doc-totals { padding: 2.5mm 3mm; border: 0.3mm solid var(--ae-line); border-radius: 1.5mm; background: #ffffff; }
.ae-doc-total-row { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; padding: 0.8mm 0; font-size: 7.4pt; color: var(--ae-muted); }
.ae-doc-total-row strong { font-size: 7.8pt; color: var(--ae-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ae-doc-discount-row strong { color: #0f766e; }
.ae-doc-grand { display: flex; align-items: baseline; justify-content: space-between; gap: 3mm; margin-top: 1.8mm; padding: 2.4mm 2.6mm; border-radius: 1mm; background: var(--ae-navy); color: #ffffff; }
.ae-doc-grand span { font-size: 7.4pt; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
.ae-doc-grand strong { font-size: 12pt; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

.ae-doc-terms { margin-top: 4mm; padding-top: 3mm; border-top: 0.3mm solid var(--ae-line); break-inside: avoid; page-break-inside: avoid; }
.ae-doc-terms-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 5mm; }
.ae-doc-terms-list { margin: 0; padding-left: 4mm; display: flex; flex-direction: column; gap: 1mm; }
.ae-doc-terms-list li { font-size: 6.5pt; line-height: 1.38; color: #475569; }
.ae-doc-terms-meta { display: flex; flex-direction: column; gap: 1.5mm; }
.ae-doc-terms-meta dt { font-size: 6.2pt; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; }
.ae-doc-terms-meta dd { margin: 0.2mm 0 0; font-size: 6.8pt; color: var(--ae-ink); }

.ae-doc-bank-sign { display: flex; align-items: flex-end; justify-content: space-between; gap: 6mm; margin-top: 4mm; padding-top: 3mm; border-top: 0.3mm solid var(--ae-line); break-inside: avoid; page-break-inside: avoid; }
.ae-doc-bank { font-size: 6.9pt; color: #475569; line-height: 1.4; }
.ae-doc-bank p { margin: 0; }
.ae-doc-bank strong { color: var(--ae-navy); }
.ae-doc-bank-note { margin-top: 1mm !important; font-size: 6.2pt; color: #94a3b8; }
.ae-doc-sign { min-width: 45mm; text-align: center; font-size: 7.2pt; color: var(--ae-ink); }
.ae-doc-sign p { margin: 0; }
.ae-doc-sign-space { display: flex; align-items: flex-end; justify-content: center; height: 13mm; }
.ae-doc-sign-img { display: block; width: auto; height: auto; max-width: 42mm; max-height: 12.4mm; object-fit: contain; }
.ae-doc-sign-line { padding-top: 1.5mm; border-top: 0.3mm solid #94a3b8; font-size: 6.6pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ae-muted); }

.ae-doc-footer { display: flex; align-items: center; justify-content: space-between; gap: 4mm; margin-top: auto; padding-top: 3.5mm; border-top: 0.3mm solid var(--ae-line); font-size: 6.2pt; color: #94a3b8; }
.ae-doc-footer span:last-child { font-weight: 700; color: var(--ae-muted); white-space: nowrap; }

@media print {
  @page { size: A4; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .ae-doc-root { display: block; gap: 0; }
  .ae-doc-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
  .ae-doc-page:last-child { break-after: auto; page-break-after: auto; }
  .ae-doc-page, .ae-doc-page * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

export default function QuotationDocument({ value, className = '' }) {
  const model = value?.totals && value?.company ? value : documentModel(value);
  const pages = paginateItems(model.items);
  let offset = 0;

  return (
    <div className={`ae-doc-root ${className}`.trim()}>
      <style>{QUOTATION_DOC_CSS}</style>
      {pages.map((pageItems, pageIndex) => {
        const isFirst = pageIndex === 0;
        const isLast = pageIndex === pages.length - 1;
        const startIndex = offset;
        offset += pageItems.length;
        return (
          <article className="ae-doc-page" key={`page-${pageIndex}`}>
            {docHeader(model, !isFirst)}
            {isFirst ? <CustomerBlock model={model} /> : null}
            <ItemsTable items={pageItems} startIndex={startIndex} />
            {isLast ? (
              <>
                <TotalsBlock model={model} />
                <TermsBlock model={model} />
                <BankAndSign model={model} />
              </>
            ) : null}
            <PageFooter model={model} page={pageIndex + 1} total={pages.length} />
          </article>
        );
      })}
    </div>
  );
}
