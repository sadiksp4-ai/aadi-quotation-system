/**
 * Browser print / print-to-PDF for the quotation document.
 *
 * The exact same React document used in the on-screen preview is rendered to
 * static HTML inside a temporary iframe. This keeps print output aligned with
 * the preview without relying on screenshots.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuotationDocument, { QUOTATION_DOC_CSS } from '../components/QuotationDocument';
import { documentModel } from './quotation';

const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .ae-doc-root { gap: 0; }
  .ae-doc-page { box-shadow: none; margin: 0; }
  @page { size: A4; margin: 0; }
  @media print {
    .ae-doc-page { break-after: page; page-break-after: always; }
    .ae-doc-page:last-child { break-after: auto; page-break-after: auto; }
  }
`;

export function buildQuotationPrintHtml(input) {
  const model = input?.totals && input?.company ? input : documentModel(input);
  const markup = renderToStaticMarkup(createElement(QuotationDocument, { value: model }));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${String(model.quoteNo || 'Quotation').replace(/[<>&"]/g, '')}</title>
<style>${BASE_CSS}</style>
<style>${QUOTATION_DOC_CSS}</style>
</head>
<body>${markup}</body>
</html>`;
}

export function printQuotation(input) {
  const html = buildQuotationPrintHtml(input);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.border = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  let printed = false;
  const cleanup = () => {
    setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        /* ignore */
      }
    }, 1200);
  };
  const trigger = () => {
    if (printed) return;
    printed = true;
    try {
      const win = iframe.contentWindow;
      win.focus();
      win.print();
    } catch (error) {
      console.error('print quotation error', error);
      const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1200');
      if (popup) {
        popup.document.open();
        popup.document.write(html);
        popup.document.close();
        setTimeout(() => popup.print(), 400);
      }
    } finally {
      cleanup();
    }
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) return false;
  doc.open();
  doc.write(html);
  doc.close();

  const images = Array.from(doc.images || []);
  if (images.length === 0) {
    setTimeout(trigger, 350);
  } else {
    let pending = images.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) setTimeout(trigger, 350);
    };
    images.forEach((img) => {
      if (img.complete) done();
      else {
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }
    });
    setTimeout(trigger, 2500);
  }
  return true;
}
