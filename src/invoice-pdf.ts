import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { formatInr, PAYMENT_METHOD_LABELS, type PaymentMethod, type SaleRecord } from './domain';

// Type scale (pt): title, emphasis, body, label.
const T = 26, E = 12, B = 11, L = 8;

const SELLER = 'Neeta Gore'; // no business name
const PHONE = '+91 99872 73980';
const UPI_ID = 'neetapgore@okaxis';

// Colours match the app's tokens (src/styles.css): --ink, --blue, --blue-soft, --line.
const INK: [number, number, number] = [23, 25, 29];
const BLUE: [number, number, number] = [20, 104, 232];
const BLUE_DARK: [number, number, number] = [14, 86, 195]; // --blue-dark: 4.5:1+ for small text
const BLUE_SOFT: [number, number, number] = [234, 242, 255];
const MUTED: [number, number, number] = [110, 117, 128];

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

  const text = (s: string, x: number, size: number, opts: { bold?: boolean | undefined; align?: 'left' | 'right'; gray?: boolean; blue?: boolean } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(size);
    doc.setTextColor(...(opts.blue ? BLUE_DARK : opts.gray ? MUTED : INK));
    doc.text(s, x, y, { align: opts.align ?? 'left' });
  };
  const rule = (color = 227) => { doc.setDrawColor(color, color + 3, color + 7).setLineWidth(0.2).line(M, y, RIGHT, y); };

  // Built-in PDF fonts have no ₹ glyph, so draw it as vector strokes next to the number.
  const rupee = (x: number, size: number) => {
    const h = size * 0.3528 * 0.72; // cap height in mm
    const w = h * 0.62;
    const top = y - h;
    doc.setDrawColor(...INK).setLineWidth(size * 0.0075 * 3.5).setLineCap('butt').setLineJoin('miter');
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
    if (pre) { doc.setTextColor(...INK).text(pre, cx, y); cx += preW; }
    rupee(cx, size);
    doc.setTextColor(...INK).text(n, cx + symW + gap, y);
  };

  // Header: title on the left, invoice meta on the right.
  text('INVOICE', M, T, { bold: true, blue: true });
  const status = sale.status === 'cancelled' ? 'CANCELLED' : gift ? 'GIFT' : sale.paymentStatus === 'paid' ? 'PAID' : sale.paymentStatus === 'partial' ? 'PARTIALLY PAID' : 'UNPAID';
  // Display-only: stored sale numbers are random (SALE-yyyymmdd-XXXXXXXX); the id is sequential.
  const saleYear = (sale.saleDate ?? sale.soldAt).slice(0, 4);
  text(`Invoice no. INV-${saleYear}-${String(sale.id).padStart(4, '0')}`, RIGHT, E, { bold: true, align: 'right' });
  y += 6;
  text(`Date: ${dateOf(`${sale.saleDate ?? sale.soldAt.slice(0, 10)}T00:00:00`)}`, RIGHT, B, { align: 'right', gray: true });
  y += 6;
  // Status as a coloured pill so it scans at a glance.
  const pill: Record<string, [[number, number, number], [number, number, number]]> = {
    PAID: [[220, 245, 229], [22, 101, 52]],
    'PARTIALLY PAID': [[254, 243, 199], [146, 64, 14]],
    UNPAID: [[254, 243, 199], [146, 64, 14]],
    CANCELLED: [[254, 226, 226], [153, 27, 27]],
    GIFT: [BLUE_SOFT, BLUE_DARK],
  };
  const [pillBg, pillFg] = pill[status]!;
  doc.setFont('helvetica', 'bold').setFontSize(L);
  const pw = doc.getTextWidth(status) + 7;
  doc.setFillColor(...pillBg).roundedRect(RIGHT - pw, y - 4.4, pw, 6.4, 3.2, 3.2, 'F');
  doc.setTextColor(...pillFg).text(status, RIGHT - pw / 2, y, { align: 'center' });
  y += 8;
  doc.setDrawColor(...BLUE).setLineWidth(0.8).line(M, y, RIGHT, y);
  y += 8;

  const toX = 110;
  text('FROM', M, L, { bold: true, gray: true });
  if (sale.customerName) text(gift ? 'GIFTED TO' : 'BILLED TO', toX, L, { bold: true, gray: true });
  y += 6;
  text(SELLER, M, E, { bold: true });
  y += 5.5;
  text(PHONE, M, B, { gray: true });
  y -= 5.5;
  let extra = 0;
  if (sale.customerName) {
    // Names can be up to 200 chars: wrap to the billed-to column and push the layout down for extra lines.
    const nameLines: string[] = doc.setFont('helvetica', 'bold').setFontSize(E).splitTextToSize(sale.customerName, RIGHT - toX);
    doc.setTextColor(...INK).text(nameLines, toX, y);
    extra = Math.max(0, nameLines.length - 2) * 5.5;
  }
  y += 15 + extra;

  // Items table.
  const cols = gift
    ? { name: M + 2, qty: RIGHT - 2 }
    : { name: M + 2, qty: 118, rate: 152, amount: RIGHT - 2 };
  const header = () => {
    doc.setFillColor(...BLUE_SOFT).rect(M, y, RIGHT - M, 10, 'F');
    y += 6.5;
    text('ITEM', cols.name, L, { bold: true, blue: true });
    text('QTY', cols.qty, L, { bold: true, align: 'right', blue: true });
    if (!gift) {
      text('RATE', cols.rate!, L, { bold: true, align: 'right', blue: true });
      text('AMOUNT', cols.amount!, L, { bold: true, align: 'right', blue: true });
    }
    y += 6.5;
  };
  header();
  const nameWidth = (gift ? cols.qty - 20 : cols.qty - 26) - cols.name;
  for (const line of sale.lines) {
    const nameLines: string[] = doc.setFont('helvetica', 'normal').setFontSize(B).splitTextToSize(line.productName, nameWidth);
    const rowH = nameLines.length * 5.6 + 7;
    if (y + rowH > PAGE_H - 50) {
      doc.addPage();
      y = M;
      header();
    }
    y += 6.5;
    doc.setFont('helvetica', 'normal').setFontSize(B).setTextColor(...INK).text(nameLines, cols.name, y);
    text(String(line.quantity), cols.qty, B, { align: 'right' });
    if (!gift) {
      amount(line.unitPricePaise, cols.rate!, B, { align: 'right' });
      amount(line.lineTotalPaise, cols.amount!, B, { bold: true, align: 'right' });
    }
    y += rowH - 6.5;
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
    const totalsTop = y;
    row('Subtotal', sale.subtotalPaise);
    if (sale.discountPaise > 0) row('Discount', sale.discountPaise, { prefix: '-' });
    const paid = sale.paymentStatus === 'paid';
    if (!paid) doc.setDrawColor(...INK).setLineWidth(0.4).line(128, y - 2, RIGHT, y - 2);
    y += 3;
    if (paid) doc.setFillColor(...BLUE_SOFT).rect(124, y - 6, RIGHT - 124, 10, 'F'); // highlight the final figure
    row(paid ? 'Total paid' : 'Total', sale.totalPaise, { bold: true, size: E });
    if (sale.paymentStatus !== 'paid') {
      row('Amount received', sale.paidPaise ?? 0);
      y += 1;
      doc.setFillColor(...BLUE_SOFT).rect(124, y - 6, RIGHT - 124, 10, 'F');
      row('Balance due', sale.balancePaise ?? 0, { bold: true, size: E });
    }
    y += 4;

    // UPI QR for the balance due, left of the totals. The amount is pre-filled in the payment link.
    const due = sale.balancePaise ?? 0;
    if (sale.status === 'completed' && due > 0) {
      const qr = qrcode(0, 'M');
      qr.addData(`upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(SELLER)}&am=${(due / 100).toFixed(2)}&cu=INR`);
      qr.make();
      const n = qr.getModuleCount();
      const size = 34, cell = size / n, qx = M, qy = totalsTop + 1;
      doc.setFillColor(...INK);
      for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (qr.isDark(row, col)) doc.rect(qx + col * cell, qy + row * cell, cell + 0.02, cell + 0.02, 'F');
      const ly = y;
      y = qy + size + 5;
      text('Scan to pay with any UPI app', qx, L, { bold: true, blue: true });
      y += 4;
      text(`UPI ID: ${UPI_ID}`, qx, L, { gray: true });
      y = Math.max(ly, y + 6);
    }

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
    doc.setFont('helvetica', 'bold').setFontSize(E).setTextColor(...INK).text('Thank you for your purchase!', PAGE_W / 2, y, { align: 'center' });
  }
  return doc;
}
