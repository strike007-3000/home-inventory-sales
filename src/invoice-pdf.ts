import { jsPDF } from 'jspdf';
import { formatInr, PAYMENT_METHOD_LABELS, type PaymentMethod, type SaleRecord } from './domain';

// Built-in PDF fonts have no ₹ glyph, so the PDF writes "Rs." instead.
const money = (paise: number) => formatInr(paise).replace('₹', 'Rs. ');
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

  // Header: title on the left, invoice meta on the right.
  text('INVOICE', M, 26, { bold: true });
  const status = sale.status === 'cancelled' ? 'CANCELLED' : gift ? 'GIFT' : sale.paymentStatus === 'paid' ? 'PAID' : sale.paymentStatus === 'partial' ? 'PARTIALLY PAID' : 'UNPAID';
  text(`Invoice no. ${sale.saleNumber}`, RIGHT, 11, { bold: true, align: 'right' });
  y += 6;
  text(`Date: ${dateOf(`${sale.saleDate ?? sale.soldAt.slice(0, 10)}T00:00:00`)}`, RIGHT, 10, { align: 'right', gray: true });
  y += 6;
  text(status, RIGHT, 10, { bold: true, align: 'right' });
  y += 8;
  rule(40);
  y += 8;

  if (sale.customerName) {
    text(gift ? 'GIFTED TO' : 'BILLED TO', M, 8, { bold: true, gray: true });
    y += 5.5;
    text(sale.customerName, M, 12, { bold: true });
    y += 9;
  }

  // Items table.
  const cols = gift
    ? { name: M + 2, qty: RIGHT - 2 }
    : { name: M + 2, qty: 118, rate: 152, amount: RIGHT - 2 };
  const header = () => {
    doc.setFillColor(240, 240, 240).rect(M, y, RIGHT - M, 9, 'F');
    y += 6;
    text('ITEM', cols.name, 8.5, { bold: true });
    text('QTY', cols.qty, 8.5, { bold: true, align: 'right' });
    if (!gift) {
      text('RATE', cols.rate!, 8.5, { bold: true, align: 'right' });
      text('AMOUNT', cols.amount!, 8.5, { bold: true, align: 'right' });
    }
    y += 6;
  };
  header();
  const nameWidth = (gift ? cols.qty - 20 : cols.qty - 26) - cols.name;
  for (const line of sale.lines) {
    const nameLines: string[] = doc.setFont('helvetica', 'normal').setFontSize(10.5).splitTextToSize(line.productName, nameWidth);
    const rowH = nameLines.length * 5 + 4;
    if (y + rowH > PAGE_H - 50) {
      doc.addPage();
      y = M;
      header();
    }
    y += 5;
    doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(20).text(nameLines, cols.name, y);
    text(String(line.quantity), cols.qty, 10.5, { align: 'right' });
    if (!gift) {
      text(money(line.unitPricePaise), cols.rate!, 10.5, { align: 'right' });
      text(money(line.lineTotalPaise), cols.amount!, 10.5, { bold: true, align: 'right' });
    }
    y += rowH - 5;
    rule(232);
  }
  y += 8;

  // Totals block, right-aligned.
  const row = (label: string, value: string, opts: { bold?: boolean | undefined; size?: number } = {}) => {
    const size = opts.size ?? 10.5;
    text(label, 128, size, { bold: opts.bold });
    text(value, RIGHT - 2, size, { bold: opts.bold, align: 'right' });
    y += size * 0.55 + 2.5;
  };
  if (gift) {
    text('Gift - no payment due', M, 11, { bold: true });
    y += 8;
  } else {
    if (y > PAGE_H - 70) { doc.addPage(); y = M; }
    row('Subtotal', money(sale.subtotalPaise));
    if (sale.discountPaise > 0) row('Discount', `- ${money(sale.discountPaise)}`);
    doc.setDrawColor(40).setLineWidth(0.4).line(128, y - 2, RIGHT, y - 2);
    y += 3;
    row(sale.paymentStatus === 'paid' ? 'Total paid' : 'Total', money(sale.totalPaise), { bold: true, size: 12.5 });
    if (sale.paymentStatus !== 'paid') {
      row('Amount received', money(sale.paidPaise ?? 0));
      row('Balance due', money(sale.balancePaise ?? 0), { bold: true, size: 12.5 });
    }
    y += 4;

    if (sale.payments?.length) {
      if (y > PAGE_H - 50) { doc.addPage(); y = M; }
      text(sale.payments.length === 1 ? 'PAYMENT' : 'PAYMENTS', M, 8, { bold: true, gray: true });
      y += 2;
      rule();
      for (const p of sale.payments) {
        if (y > PAGE_H - 30) { doc.addPage(); y = M; }
        y += 6;
        text(`${dateOf(p.receivedAt)}  -  ${PAYMENT_METHOD_LABELS[p.paymentMethod as PaymentMethod] ?? p.paymentMethod}`, M, 10);
        text(money(p.amountPaise), RIGHT - 2, 10, { bold: true, align: 'right' });
        y += 2;
        rule(232);
      }
      y += 4;
    }
  }

  if (sale.status === 'cancelled') {
    y += 4;
    text(`Cancelled${sale.cancellationReason ? `: ${sale.cancellationReason}` : ''}`, M, 10, { bold: true });
  } else {
    // Footer pinned to the bottom of the last page.
    y = PAGE_H - 14;
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20).text('Thank you for your purchase!', PAGE_W / 2, y, { align: 'center' });
  }
  return doc;
}
