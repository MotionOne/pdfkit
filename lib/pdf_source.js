/*
PDFSource - reads an external PDF so its pages can be placed in a document
*/

import fs from 'fs';
import { PDFDocument as PDFLibDocument, PDFName, PDFNumber } from 'pdf-lib';

const BOXES = {
  media: 'MediaBox',
  crop: 'CropBox',
  trim: 'TrimBox',
  bleed: 'BleedBox',
  art: 'ArtBox'
};

// Everything pdfkit accepts for an image, so addPdf takes the same inputs
const toBytes = src => {
  if (typeof src === 'string') {
    const match = /^data:.+;base64,(.*)$/.exec(src);
    const buffer = match ? Buffer.from(match[1], 'base64') : fs.readFileSync(src);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  // Duck typed on purpose: instanceof is unreliable across realms - jsdom
  // against node under jest, preload against page in Electron.
  if (src && typeof src.byteLength === 'number') {
    if (src.buffer && typeof src.byteOffset === 'number') {
      // Buffer, or any other typed array view, without copying
      return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    }
    return new Uint8Array(src);
  }

  throw new Error('PDFSource needs a path, a Buffer, a Uint8Array or a data URL');
};

class PDFSource {
  static async open(src) {
    let document;
    try {
      document = await PDFLibDocument.load(toBytes(src), {
        updateMetadata: false
      });
    } catch (error) {
      if (/encrypt/i.test(error.message)) {
        throw new Error(
          'Cannot place an encrypted PDF. Remove the encryption first.'
        );
      }
      throw error;
    }

    return new PDFSource(document);
  }

  constructor(document) {
    this.document = document;
    this.context = document.context;
  }

  get pageCount() {
    return this.document.getPageCount();
  }

  node(pageIndex = 0) {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= this.pageCount
    ) {
      throw new Error(
        `page ${pageIndex} is out of range, the PDF has ${this.pageCount} page(s)`
      );
    }

    return this.document.getPage(pageIndex).node;
  }

  rotation(pageIndex = 0) {
    const node = this.node(pageIndex);
    const rotate = node.Rotate && node.Rotate();
    const degrees = rotate ? rotate.asNumber() : 0;
    return ((degrees % 360) + 360) % 360;
  }

  // The rectangle a placed page occupies, in PDF points and in source
  // coordinates. Falls back to the media box, as a viewer does.
  box(pageIndex = 0, box = 'crop') {
    const entry = BOXES[box];
    if (!entry) {
      throw new Error(`unknown box ${box}`);
    }

    const node = this.node(pageIndex);
    const array = node.getInheritableAttribute(PDFName.of(entry));
    const rect = array || node.MediaBox();
    const [x0, y0, x1, y1] = rect
      .asArray()
      .map(value => this.context.lookupMaybe(value, PDFNumber).asNumber());

    return {
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0)
    };
  }

  // What the page looks like once its own /Rotate is applied
  size(pageIndex = 0, box = 'crop') {
    const { width, height } = this.box(pageIndex, box);
    const quarterTurn = this.rotation(pageIndex) % 180 !== 0;

    return quarterTurn
      ? { width: height, height: width }
      : { width, height };
  }
}

export default PDFSource;
export { BOXES };
