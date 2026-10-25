import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32 } from '../../src/xlsx';

describe('buildXlsx', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a valid stored zip with escaped text, numbers and blanks', async () => {
    const bytes = new Uint8Array(await buildXlsx('Inv', ['A', 'B'], [['R&B <x>', 12.5], ['', 3]]).arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(6);

    let offset = 0;
    let sheet = '';
    for (let i = 0; i < 6; i++) {
      const size = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLen));
      const data = bytes.slice(offset + 30 + nameLen, offset + 30 + nameLen + size);
      expect(view.getUint32(offset + 14, true)).toBe(crc32(data));
      if (name === 'xl/worksheets/sheet1.xml') sheet = new TextDecoder().decode(data);
      offset += 30 + nameLen + size;
    }
    expect(sheet).toContain('R&amp;B &lt;x&gt;');
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).not.toContain('r="A3"');
  });
});
