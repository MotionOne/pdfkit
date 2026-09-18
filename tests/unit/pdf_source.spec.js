import fs from 'fs';
import PDFKitDocument from '../../lib/document';
import PDFSource from '../../lib/pdf_source';
import { PDFDocument as PDFLibDocument, degrees } from 'pdf-lib';

const KITCHEN_SINK = 'examples/kitchen-sink.pdf';

// jsdom and node do not share a Uint8Array, so hand pdf-lib one this
// environment recognises
const asBytes = buffer =>
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

const pdfkitBytes = options =>
  new Promise(resolve => {
    const document = new PDFKitDocument(options);
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.text('hello', 40, 40);
    document.end();
  });

describe('PDFSource.open', () => {
  test('opens a PDF from a file path', async () => {
    const source = await PDFSource.open(KITCHEN_SINK);

    expect(source.pageCount).toBe(4);
  });

  test('opens a PDF from a Buffer', async () => {
    const source = await PDFSource.open(fs.readFileSync(KITCHEN_SINK));

    expect(source.pageCount).toBe(4);
  });

  test('opens a PDF from a Uint8Array', async () => {
    const source = await PDFSource.open(asBytes(fs.readFileSync(KITCHEN_SINK)));

    expect(source.pageCount).toBe(4);
  });

  test('refuses an encrypted PDF with a clear message', async () => {
    const encrypted = await pdfkitBytes({ userPassword: 'secret' });

    await expect(PDFSource.open(encrypted)).rejects.toThrow(/encrypted/i);
  });

  test('refuses something that is not a PDF', async () => {
    await expect(PDFSource.open(Buffer.from('not a pdf'))).rejects.toThrow();
  });
});

describe('PDFSource geometry', () => {
  test('reports the page size in points', async () => {
    const source = await PDFSource.open(KITCHEN_SINK);

    expect(source.size(0)).toEqual({ width: 612, height: 792 });
  });

  test('reports the requested box', async () => {
    const document = await PDFLibDocument.create();
    const page = document.addPage([600, 800]);
    page.setTrimBox(20, 30, 500, 700);

    const source = await PDFSource.open(await document.save());

    expect(source.size(0, 'media')).toEqual({ width: 600, height: 800 });
    expect(source.size(0, 'trim')).toEqual({ width: 500, height: 700 });
  });

  test('falls back to the media box when the requested box is absent', async () => {
    const source = await PDFSource.open(KITCHEN_SINK);

    expect(source.size(0, 'trim')).toEqual({ width: 612, height: 792 });
  });

  test('reports the page rotation', async () => {
    const document = await PDFLibDocument.create();
    document.addPage([600, 800]).setRotation(degrees(90));

    const source = await PDFSource.open(await document.save());

    expect(source.rotation(0)).toBe(90);
  });

  test('swaps width and height for a page rotated by 90 degrees', async () => {
    const document = await PDFLibDocument.create();
    document.addPage([600, 800]).setRotation(degrees(90));

    const source = await PDFSource.open(await document.save());

    expect(source.size(0)).toEqual({ width: 800, height: 600 });
  });

  test('rejects an out of range page index', async () => {
    const source = await PDFSource.open(KITCHEN_SINK);

    expect(() => source.size(4)).toThrow(/page/i);
  });
});
