/**
 * Vector PDF rendering for quotations.
 *
 * Uses jsPDF + jspdf-autotable (not screenshots) so text is selectable,
 * tables repeat their header across pages and every page carries a footer
 * with contact details and page numbering.
 */

import {
  documentModel,
  formatNumberIN,
  formatDateIN,
  gstLabel,
  addressLines,
  contactEmail,
} from './quotation';

const NAVY = [20, 37, 61];
const NAVY_DEEP = [14, 26, 43];
const GOLD = [201, 166, 107];
const INK = [30, 41, 59];
const MUTED = [100, 116, 139];
const LINE = [226, 232, 240];
const SOFT = [248, 250, 252];

const money = (value) => `Rs. ${formatNumberIN(value, 2)}`;
const imageCache = new Map();

function absoluteUrl(src) {
  if (!src) return null;
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

async function asDataUrl(src) {
  const url = absoluteUrl(src);
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = fetch(url, { mode: 'cors' })
    .then((response) => (response.ok ? response.blob() : null))
    .then(
      (blob) =>
        new Promise((resolve) => {
          if (!blob) return resolve(null);
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
  imageCache.set(url, promise);
  return promise;
}

function setColor(doc, rgb, kind = 'text') {
  if (kind === 'fill') doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  else if (kind === 'draw') doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
  else doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

/**
 * Draw a logo inside a box while preserving its aspect ratio (the PDF
 * equivalent of Tailwind's `object-contain` + `h-12 w-auto`).
 */
function drawLogo(doc, logo, x, y, boxW, boxH) {
  if (!logo) return;
  try {
    const props = doc.getImageProperties(logo);
    const ratio = props?.width && props?.height ? props.width / props.height : 1;
    let w = boxW;
    let h = boxW / ratio;
    if (h > boxH) {
      h = boxH;
      w = boxH * ratio;
    }
    doc.addImage(logo, 'PNG', x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
  } catch {
    try {
      doc.addImage(logo, 'PNG', x, y, boxW, boxH);
    } catch {
      /* ignore broken image */
    }
  }
}

function drawFullHeader(doc, model, logo) {
  const c = model.company;
  setColor(doc, NAVY, 'fill');
  doc.rect(0, 0, 210, 34, 'F');
  setColor(doc, GOLD, 'fill');
  doc.rect(0, 34, 210, 1.5, 'F');

  // White wordmark logo — the dark logo is invisible on the navy band.
  drawLogo(doc, logo, 13, 6, 21, 21);

  setColor(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(c.name, 38, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.4);
  setColor(doc, GOLD);
  doc.text(String(c.tagline || '').toUpperCase(), 38, 18.4);
  setColor(doc, [226, 232, 240]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.text(`${c.address}  |  ${c.phone}`, 38, 22.6);
  doc.text(`GSTIN: ${c.gstin}  |  UDYAM: ${c.udyam}`, 38, 26.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('QUOTATION', 196, 14, { align: 'right' });
  setColor(doc, GOLD, 'fill');
  doc.rect(150, 17.4, 46, 0.8, 'F');
  doc.setFontSize(8.4);
  doc.text(model.quoteNo || '—', 196, 22.8, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  setColor(doc, [226, 232, 240]);
  doc.text(`Date: ${formatDateIN(model.quoteDate)}`, 196, 26.8, { align: 'right' });
  doc.text(`Valid until: ${formatDateIN(model.validUntil)}`, 196, 30.2, { align: 'right' });
}

function drawCompactHeader(doc, model, logo) {
  setColor(doc, NAVY, 'fill');
  doc.rect(0, 0, 210, 18, 'F');
  setColor(doc, GOLD, 'fill');
  doc.rect(0, 18, 210, 1, 'F');
  drawLogo(doc, logo, 13, 4, 10.5, 10.5);
  setColor(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(model.company.name, 26, 9.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  setColor(doc, GOLD);
  doc.text(String(model.company.tagline || '').toUpperCase(), 26, 13.2);
  setColor(doc, [226, 232, 240]);
  doc.setFontSize(6.6);
  doc.text('QUOTATION', 196, 7.6, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(model.quoteNo || '—', 196, 12, { align: 'right' });
}

function box(doc, x, y, w, h) {
  setColor(doc, LINE, 'fill');
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
  setColor(doc, [255, 255, 255], 'fill');
  doc.roundedRect(x + 0.25, y + 0.25, w - 0.5, h - 0.5, 1.4, 1.4, 'F');
  setColor(doc, LINE, 'draw');
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, 'S');
}

function drawTextBlock(doc, x, y, width, lines, options = {}) {
  const {
    size = 6.8,
    color = MUTED,
    fontStyle = 'normal',
    lineHeight = 3.2,
    maxLines = 10,
  } = options;
  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(size);
  setColor(doc, color);
  const texts = doc.splitTextToSize(String(lines || ''), width).slice(0, maxLines);
  let cy = y;
  texts.forEach((line) => {
    doc.text(line, x, cy);
    cy += lineHeight;
  });
  return cy;
}

function drawCustomerBlocks(doc, model, startY) {
  const c = model.customer || {};
  const s = model.settings || {};
  const gap = 4;
  const w = 58; // (182mm - 2 gaps) / 3
  const xs = [14, 14 + w + gap, 14 + (w + gap) * 2];
  const innerW = w - 6;
  const innerX = (i) => xs[i] + 3;

  const billAddress = addressLines({
    address: c.billingAddress,
    city: c.city,
    pin: c.pinCode,
  });
  const shipAddress = addressLines({
    address: c.sameAsBilling ? c.billingAddress : c.shippingAddress || c.billingAddress,
    city: c.city,
    pin: c.pinCode,
  });

  const blocks = [
    {
      title: 'BILL TO',
      name: c.companyName || '—',
      lines: [
        c.contactPerson ? `Attn: ${c.contactPerson}` : '',
        ...billAddress,
        c.mobile || '',
        c.email || '',
        c.gstin ? `GSTIN: ${c.gstin}` : '',
      ].filter(Boolean),
    },
    {
      title: 'SHIP TO',
      name: c.companyName || '—',
      lines: [
        c.contactPerson ? `Attn: ${c.contactPerson}` : '',
        ...shipAddress,
        c.mobile || '',
      ].filter(Boolean),
    },
  ];

  // Measure both address cards first so the tallest one drives the height for
  // all three cards (no fixed h-36 style height, so nothing overflows).
  const measured = blocks.map((block) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const nameLines = doc.splitTextToSize(block.name, innerW);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    const bodyLines = block.lines.length
      ? doc.splitTextToSize(block.lines.join('\n'), innerW)
      : [];
    const bodyTop = 8.4 + nameLines.length * 3.3 + 0.6;
    const end = bodyLines.length ? bodyTop + (bodyLines.length - 1) * 2.8 + 1.6 : bodyTop;
    return { ...block, nameLines, bodyLines, bodyTop, end };
  });

  // Compact label/value rows for QUOTATION DETAILS.
  const meta = [
    ['Place of supply', model.placeOfSupply],
    ['Reference', c.reference || '—'],
    ['Payment', s.paymentTerms || '—'],
    ['Delivery', s.deliveryTerms || '—'],
  ];
  let metaY = 8.2;
  const metaRows = meta.map(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    const valueLines = doc.splitTextToSize(String(value || '—'), innerW).slice(0, 3);
    const row = { label, valueLines, y: metaY };
    metaY += 2.9 + valueLines.length * 2.55 + 1;
    return row;
  });
  const metaEnd = metaRows.length
    ? metaRows[metaRows.length - 1].y +
      2.9 +
      (metaRows[metaRows.length - 1].valueLines.length - 1) * 2.55 +
      1.7
    : 8.2;

  // Every card shares the height of the tallest card, plus bottom padding.
  const cardHeight = Math.max(30, ...measured.map((b) => b.end), metaEnd) + 3.2;

  for (let i = 0; i < 3; i += 1) box(doc, xs[i], startY, w, cardHeight);

  measured.forEach((block, i) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    setColor(doc, [160, 120, 64]);
    doc.text(block.title, innerX(i), startY + 4.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setColor(doc, NAVY);
    let nameY = startY + 8.4;
    block.nameLines.forEach((line) => {
      doc.text(line, innerX(i), nameY);
      nameY += 3.3;
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    setColor(doc, [71, 85, 105]);
    let bodyY = startY + block.bodyTop;
    block.bodyLines.forEach((line) => {
      doc.text(line, innerX(i), bodyY);
      bodyY += 2.8;
    });
  });

  metaRows.forEach((row) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.5);
    setColor(doc, [148, 163, 184]);
    doc.text(String(row.label).toUpperCase(), innerX(2), startY + row.y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    setColor(doc, INK);
    row.valueLines.forEach((line, idx) => {
      doc.text(line, innerX(2), startY + row.y + 2.9 + idx * 2.55);
    });
  });

  return startY + cardHeight + 4;
}

function drawTotals(doc, model, startY) {
  const t = model.totals;
  const leftX = 14;
  const leftW = 100;
  const rightX = 116;
  const rightW = 80;
  const rows = [];
  rows.push(['Subtotal', money(t.subtotal), false]);
  if (t.totalDiscount > 0) rows.push(['Total discount', `- ${money(t.totalDiscount)}`, true]);
  rows.push(['Taxable amount', money(t.taxableAmount), false]);
  if (model.intraState) {
    rows.push(['CGST', money(t.cgst), false]);
    rows.push(['SGST', money(t.sgst), false]);
  } else {
    rows.push(['IGST', money(t.igst), false]);
  }
  if (t.additionalChargesTotal > 0) {
    rows.push(['Additional charges', money(t.additionalChargesTotal), false]);
  }

  const rowH = 4.4;
  const boxH = rows.length * rowH + 13;
  box(doc, leftX, startY, leftW, boxH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.6);
  setColor(doc, [160, 120, 64]);
  doc.text('AMOUNT IN WORDS', leftX + 3, startY + 4.8);
  drawTextBlock(doc, leftX + 3, startY + 8.8, leftW - 6, model.amountInWords, {
    size: 7,
    color: NAVY,
    fontStyle: 'bold',
    lineHeight: 3.4,
    maxLines: 4,
  });

  box(doc, rightX, startY, rightW, boxH);
  let y = startY + 5.4;
  rows.forEach(([label, value, accent]) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.6);
    setColor(doc, accent ? [15, 118, 110] : MUTED);
    doc.text(label, rightX + 3, y);
    doc.setFont('helvetica', 'bold');
    setColor(doc, accent ? [15, 118, 110] : INK);
    doc.text(value, rightX + rightW - 3, y, { align: 'right' });
    y += rowH;
  });
  const grandY = startY + boxH - 10;
  setColor(doc, NAVY, 'fill');
  doc.roundedRect(rightX + 2, grandY, rightW - 4, 8, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(255, 255, 255);
  doc.text('GRAND TOTAL', rightX + 5, grandY + 5);
  doc.setFontSize(9.4);
  doc.text(money(t.grandTotal), rightX + rightW - 5, grandY + 5.4, { align: 'right' });

  return startY + boxH + 4;
}

function drawTermsAndBank(doc, model, startY, signature) {
  const s = model.settings || {};
  let y = startY;
  setColor(doc, LINE, 'draw');
  doc.setLineWidth(0.2);
  doc.line(14, y, 196, y);
  y += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.6);
  setColor(doc, [160, 120, 64]);
  doc.text('TERMS & CONDITIONS', 14, y);
  doc.text('COMMERCIAL TERMS', 120, y);
  y += 3.6;

  const terms = Array.isArray(s.generalTerms) ? s.generalTerms.slice(0, 8) : [];
  let leftY = y;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  setColor(doc, [71, 85, 105]);
  terms.forEach((term, index) => {
    const lines = doc.splitTextToSize(`${index + 1}. ${term}`, 100).slice(0, 2);
    lines.forEach((line) => {
      if (leftY < 278) doc.text(line, 14, leftY);
      leftY += 2.6;
    });
    leftY += 0.6;
  });

  let rightY = y;
  const metas = [
    ['Payment', s.paymentTerms],
    ['Delivery', s.deliveryTerms],
    ['Installation', s.installationTerms],
    ['Warranty', s.warrantyTerms],
  ];
  metas.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    setColor(doc, [148, 163, 184]);
    doc.text(String(label).toUpperCase(), 120, rightY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.9);
    setColor(doc, INK);
    const lines = doc.splitTextToSize(String(value || '—'), 76).slice(0, 3);
    lines.forEach((line, idx) => doc.text(line, 120, rightY + 2.7 + idx * 2.5));
    rightY += 2.7 + lines.length * 2.5 + 1.6;
  });
  if (s.remarks) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    setColor(doc, [148, 163, 184]);
    doc.text('REMARKS', 120, rightY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.9);
    setColor(doc, INK);
    doc.splitTextToSize(String(s.remarks), 76).slice(0, 3).forEach((line, idx) => {
      doc.text(line, 120, rightY + 2.7 + idx * 2.5);
    });
    rightY += 2.7 + 7.5;
  }

  y = Math.max(leftY, rightY) + 3;
  setColor(doc, LINE, 'draw');
  doc.line(14, y, 196, y);
  y += 5;

  const c = model.company;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.6);
  setColor(doc, [160, 120, 64]);
  doc.text('BANK DETAILS', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  setColor(doc, [71, 85, 105]);
  const bankLines = [
    c.bankName,
    `${c.bank}  |  ${c.branch}`,
    `A/C No: ${c.account}  |  IFSC: ${c.ifsc}`,
    `Payment reference: ${model.quoteNo || 'quotation number'}`,
  ];
  bankLines.forEach((line, index) => doc.text(line, 14, y + 3.8 + index * 3));

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  setColor(doc, INK);
  doc.text(`For ${c.name}`, 196, y + 4, { align: 'right' });
  if (signature) {
    try {
      // Signature sits above the signatory line, right-aligned on the same 38 mm rule.
      const sigH = 11;
      const sigW = sigH * 2;
      doc.addImage(signature, 'PNG', 196 - sigW, y + 19 - sigH - 0.8, sigW, sigH);
    } catch {
      /* ignore broken image */
    }
  }
  setColor(doc, MUTED, 'draw');
  doc.setLineWidth(0.2);
  doc.line(158, y + 19, 196, y + 19);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  setColor(doc, MUTED);
  doc.text('AUTHORISED SIGNATORY', 196, y + 22, { align: 'right' });

  return y + 27;
}

function drawFooters(doc, model) {
  const c = model.company;
  const email = contactEmail(c);
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    setColor(doc, LINE, 'draw');
    doc.setLineWidth(0.2);
    doc.line(14, 286, 196, 286);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    setColor(doc, [148, 163, 184]);
    doc.text(`${c.website}  |  ${email}  |  ${c.phone}`, 14, 290);
    doc.setFont('helvetica', 'bold');
    setColor(doc, MUTED);
    doc.text(`${model.quoteNo || '—'}  |  Page ${page} of ${total}`, 196, 290, {
      align: 'right',
    });
  }
}

const PRODUCT_COL_WIDTH = 48;
const PRODUCT_PADDING = 1.2;
const NUMERIC_COL_WIDTHS = { 6: 18, 7: 15, 9: 19, 10: 20 };

/**
 * Measure the rich "Product description" cell: product name (bold), the
 * description in a smaller muted font, an optional note and a brand badge.
 */
function measureProductCell(doc, item, width) {
  const name = String(item.name || item.description || '—').trim();
  const description = String(item.description || '').trim();
  const brand = String(item.brand || '').trim();
  const note = String(item.note || '').trim();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  const nameLines = doc.splitTextToSize(name, width);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.9);
  const descriptionLines =
    description && description !== name ? doc.splitTextToSize(description, width) : [];
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(5.5);
  const noteLines = note ? doc.splitTextToSize(note, width) : [];

  const height =
    nameLines.length * 2.9 +
    (descriptionLines.length ? 0.5 + descriptionLines.length * 2.4 : 0) +
    (noteLines.length ? 0.4 + noteLines.length * 2.2 : 0) +
    (brand ? 1 + 3.4 : 0);

  return { nameLines, descriptionLines, noteLines, brand, height };
}

function drawProductCell(doc, cell, parts) {
  const x = cell.x + PRODUCT_PADDING;
  let cy = cell.y + Math.max(1.2, (cell.height - parts.height) / 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  setColor(doc, NAVY);
  parts.nameLines.forEach((line) => {
    doc.text(line, x, cy + 2.2);
    cy += 2.9;
  });

  if (parts.descriptionLines.length) {
    cy += 0.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.9);
    setColor(doc, MUTED);
    parts.descriptionLines.forEach((line) => {
      doc.text(line, x, cy + 1.9);
      cy += 2.4;
    });
  }

  if (parts.noteLines.length) {
    cy += 0.4;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(5.5);
    setColor(doc, MUTED);
    parts.noteLines.forEach((line) => {
      doc.text(line, x, cy + 1.7);
      cy += 2.2;
    });
  }

  if (parts.brand) {
    cy += 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.2);
    const label = parts.brand.toUpperCase();
    const width = doc.getTextWidth(label);
    setColor(doc, [250, 245, 235], 'fill');
    doc.roundedRect(x - 0.4, cy, width + 2.4, 3.4, 0.8, 0.8, 'F');
    setColor(doc, [160, 120, 64]);
    doc.text(label, x + 0.8, cy + 2.4);
  }
}

export async function buildQuotationPdf(input) {
  const model = input?.totals && input?.company ? input : documentModel(input);
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const [logo, signature, ...itemImages] = await Promise.all([
    // Dark navy header band needs the white wordmark, not the dark logo.
    asDataUrl(`${import.meta.env.BASE_URL || '/'}aadi-logo-white.png`),
    asDataUrl(`${import.meta.env.BASE_URL || '/'}aadi-signature.png`),
    ...model.items.map((item) => asDataUrl(item.image)),
  ]);

  drawFullHeader(doc, model, logo);
  let y = drawCustomerBlocks(doc, model, 41);
  const tableStart = y;

  const body = model.items.map((item, index) => [
    index + 1,
    '',
    `${item.sku || '—'}${item.hsn ? `\nHSN ${item.hsn}` : ''}`,
    `${item.name || item.description || '—'}`,
    item.qty,
    item.unit || 'Nos',
    money(item.unitPrice),
    item.itemDiscount
      ? item.discount?.mode === 'amount'
        ? money(item.itemDiscount)
        : `${Number(item.discount?.value) || 0}%`
      : '—',
    gstLabel(item.gstRate),
    money(item.taxableAmount),
    money(item.totalAmount),
  ]);

  if (model.items.length === 0) {
    body.push(['', '', '', 'No products added to this quotation.', '', '', '', '', '', '', '']);
  }

  // Rich product cells are drawn manually in didDrawCell, so keep their parts
  // keyed by body row index.
  const productCells = new Map();

  autoTable(doc, {
    startY: tableStart,
    head: [
      [
        '#',
        'Image',
        'SKU / HSN',
        'Product description',
        'Qty',
        'Unit',
        'Rate',
        'Disc.',
        'GST',
        'Taxable',
        'Amount',
      ],
    ],
    body,
    theme: 'grid',
    margin: { left: 14, right: 14, top: 22, bottom: 16 },
    styles: {
      font: 'helvetica',
      fontSize: 6.4,
      cellPadding: 1.2,
      overflow: 'linebreak',
      textColor: INK,
      lineColor: LINE,
      lineWidth: 0.1,
      valign: 'middle',
      minCellHeight: 9.6,
    },
    headStyles: {
      fillColor: NAVY,
      textColor: [255, 255, 255],
      fontSize: 6,
      fontStyle: 'bold',
      cellPadding: { top: 1.8, bottom: 1.8, left: 1.1, right: 1.1 },
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: SOFT },
    columnStyles: {
      0: { halign: 'center', cellWidth: 7 },
      1: { halign: 'center', cellWidth: 11 },
      2: { cellWidth: 18, font: 'courier', fontSize: 5.9 },
      3: { cellWidth: PRODUCT_COL_WIDTH, fontSize: 6.4 },
      4: { halign: 'center', cellWidth: 9 },
      5: { halign: 'center', cellWidth: 9 },
      6: { halign: 'right', cellWidth: 18, fontSize: 6 },
      7: { halign: 'center', cellWidth: 15, fontSize: 6 },
      8: { halign: 'center', cellWidth: 8 },
      9: { halign: 'right', cellWidth: 19, fontSize: 6 },
      10: { halign: 'right', cellWidth: 20, fontSize: 6, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;

      if (data.column.index === 3) {
        const item = model.items[data.row.index];
        if (!item) return;
        const parts = measureProductCell(
          doc,
          item,
          PRODUCT_COL_WIDTH - PRODUCT_PADDING * 2,
        );
        productCells.set(data.row.index, parts);
        data.cell.text = [''];
        data.cell.styles.minCellHeight = Math.max(10, parts.height + 2.6);
        return;
      }

      // Money cells must never wrap ("Rs. 1,47,999.00" used to split after
      // "Rs."). Shrink the font slightly for unusually large values instead.
      const columnWidth = NUMERIC_COL_WIDTHS[data.column.index];
      if (!columnWidth) return;
      const available = columnWidth - 2.4;
      const text = String(data.cell.raw ?? '');
      doc.setFont('helvetica', data.column.index === 10 ? 'bold' : 'normal');
      let size = 6;
      doc.setFontSize(size);
      while (size > 4.6 && doc.getTextWidth(text) > available) {
        size = Math.round((size - 0.2) * 10) / 10;
        doc.setFontSize(size);
      }
      data.cell.styles.fontSize = size;
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawCompactHeader(doc, model, logo);
    },
    didDrawCell: (data) => {
      if (data.section !== 'body') return;

      if (data.column.index === 3) {
        const parts = productCells.get(data.row.index);
        if (parts) drawProductCell(doc, data.cell, parts);
        return;
      }

      if (data.column.index !== 1) return;
      const image = itemImages[data.row.index];
      if (!image) return;
      try {
        const size = Math.min(8.4, data.cell.height - 2);
        doc.addImage(
          image,
          'PNG',
          data.cell.x + (data.cell.width - size) / 2,
          data.cell.y + (data.cell.height - size) / 2,
          size,
          size,
        );
      } catch {
        /* ignore broken image */
      }
    },
  });

  y = (doc.lastAutoTable?.finalY || tableStart) + 5;

  const ensureSpace = (needed) => {
    if (y + needed > 278) {
      doc.addPage();
      drawCompactHeader(doc, model, logo);
      y = 23;
    }
  };

  ensureSpace(44);
  y = drawTotals(doc, model, y);

  ensureSpace(58);
  drawTermsAndBank(doc, model, y, signature);

  drawFooters(doc, model);

  const filename = `${String(model.quoteNo || 'Quotation').replace(/[\\/:*?"<>|]+/g, '-')}.pdf`;
  return { doc, model, filename };
}

export async function downloadQuotationPdf(input) {
  const { doc, filename } = await buildQuotationPdf(input);
  doc.save(filename);
  return filename;
}

export async function shareQuotationPdf(input) {
  const { doc, filename } = await buildQuotationPdf(input);
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({
      files: [file],
      title: filename.replace(/\.pdf$/i, ''),
      text: 'Aadi Enterprises quotation',
    });
    return 'shared';
  }
  doc.save(filename);
  return 'downloaded';
}
