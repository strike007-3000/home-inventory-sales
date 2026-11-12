import { jsPDF } from 'jspdf';
import { formatInr, PAYMENT_METHOD_LABELS, type PaymentMethod, type SaleRecord } from './domain';

// Type scale (pt): title, emphasis, body, label.
const T = 26, E = 12, B = 10, L = 8;

const num = (paise: number) => formatInr(paise).replace('₹', '').trim();
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16; // page margin
const RIGHT = PAGE_W - M;

export function buildInvoicePdf(sale: SaleRecord): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const gift = sale.isGift;
  let y = M;

  const text = (s: string, x: number, size: number, opts: { bold?: boolean | undefined; align?: 'left' | 'right'; gray?: boolean } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size);
    doc.setTextColor(opts.gray ? 110 : 20);
    doc.text(s, x, y, { align: opts.align ?? 'left' });
  };
  const rule = (color = 215) => { doc.setDrawColor(color).setLineWidth(0.2).line(M, y, RIGHT, y); };

  // Built-in PDF fonts have no ₹ glyph, so draw it as vector strokes next to the number.
  const rupee = (x: number, size: number) => {
    const h = size * 0.3528 * 0.72; // cap height in mm
    const w = h * 0.62;
    const top = y - h;
    doc.setDrawColor(20).setLineWidth(size * 0.0075 * 3.5).setLineCap('butt').setLineJoin('miter');
    doc.line(x, top, x + w, top); // top bar
    doc.line(x, top + h * 0.2, x + w, top + h * 0.2); // second bar
    // Bowl then diagonal leg.
    doc.lines([[w * 0.45, 0], [w * 0.5, 0, w * 0.5, h * 0.42, 0, h * 0.42], [-w * 0.45, 0], [w * 0.7, h * 0.58]], x + w * 0.1, top, [1, 1], 'S');
    return w;
  };
  // Amount with the ₹ symbol, right- or left-aligned at x; `prefix` (e.g. "-") precedes the symbol.
  const amount = (paise: number, x: number, size: number, opts: { bold?: boolean | undefined; align?: 'left' | 'right'; prefix?: string } = {}) => {
    const n = num(paise);
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size);
    const pre = opts.prefix ? `${opts.prefix} ` : '';
    const preW = pre ? doc.getTextWidth(pre) : 0;
    const symW = size * 0.3528 * 0.72 * 0.62;
    const gap = size * 0.3528 * 0.2;
    const total = preW + symW + gap + doc.getTextWidth(n);
    let cx = opts.align === 'right' ? x - total : x;
    if (pre) { doc.setTextColor(20).text(pre, cx, y); cx += preW; }
    rupee(cx, size);
    doc.setTextColor(20).text(n, cx + symW + gap, y);
  };

  // Header: title on the left, invoice meta on the right.
  text('INVOICE', M, T, { bold: true });
  const status = sale.status === 'cancelled' ? 'CANCELLED' : gift ? 'GIFT' : sale.paymentStatus === 'paid' ? 'PAID' : sale.paymentStatus === 'partial' ? 'PARTIALLY PAID' : 'UNPAID';
  text(`Invoice no. ${sale.saleNumber}`, RIGHT, E, { bold: true, align: 'right' });
  y += 6;
  text(`Date: ${dateOf(`${sale.saleDate ?? sale.soldAt.slice(0, 10)}T00:00:00`)}`, RIGHT, B, { align: 'right', gray: true });
  y += 6;
  text(status, RIGHT, B, { bold: true, align: 'right' });
  y += 8;
  rule(40);
  y += 8;

  if (sale.customerName) {
    text(gift ? 'GIFTED TO' : 'BILLED TO', M, L, { bold: true, gray: true });
    y += 5.5;
    text(sale.customerName, M, E, { bold: true });
    y += 9;
  }

  // Items table.
  const cols = gift
    ? { name: M + 2, qty: RIGHT - 2 }
    : { name: M + 2, qty: 118, rate: 152, amount: RIGHT - 2 };
  const header = () => {
    doc.setFillColor(240, 240, 240).rect(M, y, RIGHT - M, 9, 'F');
    y += 6;
    text('ITEM', cols.name, L, { bold: true });
    text('QTY', cols.qty, L, { bold: true, align: 'right' });
    if (!gift) {
      text('RATE', cols.rate!, L, { bold: true, align: 'right' });
      text('AMOUNT', cols.amount!, L, { bold: true, align: 'right' });
    }
    y += 6;
  };
  header();
  const nameWidth = (gift ? cols.qty - 20 : cols.qty - 26) - cols.name;
  for (const line of sale.lines) {
    const nameLines: string[] = doc.setFont('helvetica', 'normal').setFontSize(B).splitTextToSize(line.productName, nameWidth);
    const rowH = nameLines.length * 5 + 4;
    if (y + rowH > PAGE_H - 50) {
      doc.addPage();
      y = M;
      header();
    }
    y += 5;
    doc.setFont('helvetica', 'normal').setFontSize(B).setTextColor(20).text(nameLines, cols.name, y);
    text(String(line.quantity), cols.qty, B, { align: 'right' });
    if (!gift) {
      amount(line.unitPricePaise, cols.rate!, B, { align: 'right' });
      amount(line.lineTotalPaise, cols.amount!, B, { bold: true, align: 'right' });
    }
    y += rowH - 5;
    rule(232);
  }
  y += 8;

  // Totals block, right-aligned.
  const row = (label: string, paise: number, opts: { bold?: boolean | undefined; size?: number; prefix?: string } = {}) => {
    const size = opts.size ?? B;
    text(label, 128, size, { bold: opts.bold });
    amount(paise, RIGHT - 2, size, { bold: opts.bold, align: 'right', ...(opts.prefix ? { prefix: opts.prefix } : {}) });
    y += size * 0.55 + 2.5;
  };
  if (gift) {
    text('Gift - no payment due', M, E, { bold: true });
    y += 8;
  } else {
    if (y > PAGE_H - 70) { doc.addPage(); y = M; }
    row('Subtotal', sale.subtotalPaise);
    if (sale.discountPaise > 0) row('Discount', sale.discountPaise, { prefix: '-' });
    doc.setDrawColor(40).setLineWidth(0.4).line(128, y - 2, RIGHT, y - 2);
    y += 3;
    row(sale.paymentStatus === 'paid' ? 'Total paid' : 'Total', sale.totalPaise, { bold: true, size: E });
    if (sale.paymentStatus !== 'paid') {
      row('Amount received', sale.paidPaise ?? 0);
      row('Balance due', sale.balancePaise ?? 0, { bold: true, size: E });
    }
    y += 4;

    if (sale.payments?.length) {
      if (y > PAGE_H - 50) { doc.addPage(); y = M; }
      text(sale.payments.length === 1 ? 'PAYMENT' : 'PAYMENTS', M, L, { bold: true, gray: true });
      y += 2;
      rule();
      for (const p of sale.payments) {
        if (y > PAGE_H - 30) { doc.addPage(); y = M; }
        y += 6;
        text(`${dateOf(p.receivedAt)}  -  ${PAYMENT_METHOD_LABELS[p.paymentMethod as PaymentMethod] ?? p.paymentMethod}`, M, B);
        amount(p.amountPaise, RIGHT - 2, B, { bold: true, align: 'right' });
        y += 2;
        rule(232);
      }
      y += 4;
    }
  }

  if (sale.status === 'cancelled') {
    y += 4;
    text(`Cancelled${sale.cancellationReason ? `: ${sale.cancellationReason}` : ''}`, M, B, { bold: true });
  } else {
    // Footer pinned to the bottom of the last page.
    y = PAGE_H - 14;
    doc.setFont('helvetica', 'bold').setFontSize(E).setTextColor(20).text('Thank you for your purchase!', PAGE_W / 2, y, { align: 'center' });
  }
  return doc;
}
