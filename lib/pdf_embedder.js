/*
PDFPageEmbedder - turns a page of an external PDF into a form XObject
*/

import {
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  decodePDFRawStream
} from 'pdf-lib';
import PDFBridge from './pdf_bridge';

// Moves the chosen box to the origin and applies the page's own /Rotate, which
// the spec defines as a clockwise rotation of the displayed page. The result
// occupies 0,0 to the displayed width and height, so placing only has to scale.
const formMatrix = (rect, rotation) => {
  const { x, y, width, height } = rect;

  switch (rotation) {
    case 90:
      return [0, -1, 1, 0, -y, x + width];
    case 180:
      return [-1, 0, 0, -1, x + width, y + height];
    case 270:
      return [0, 1, -1, 0, y + height, -x];
    default:
      return [1, 0, 0, 1, -x, -y];
  }
};

class PDFPageEmbedder {
  constructor(document, source) {
    this.document = document;
    this.source = source;
    this.forms = {};
  }

  get pageCount() {
    return this.source.pageCount;
  }

  size(page = 0, box = 'crop') {
    return this.source.size(page, box);
  }

  rotation(page = 0) {
    return this.source.rotation(page);
  }

  // One form XObject per page and box, however often it is placed
  embed(page = 0, box = 'crop') {
    const key = `${page}:${box}`;
    if (!this.forms[key]) {
      this.forms[key] = this.createForm(page, box);
    }
    return this.forms[key];
  }

  createForm(page, box) {
    const node = this.source.node(page);
    const bridge = new PDFBridge(this.document, this.source.context);
    const rect = this.source.box(page, box);

    // Decoded up front: a reference allocated and then abandoned would stop the
    // document ever finalising, so nothing that can throw may run after
    // document.ref().
    const content = this.content(page);

    const data = {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      Matrix: formMatrix(rect, this.source.rotation(page))
    };

    try {
      const resources = node.getInheritableAttribute(PDFName.of('Resources'));
      data.Resources = resources ? bridge.copy(resources) : {};

      // Without the transparency group, blending inside the page breaks
      const group = node.get(PDFName.of('Group'));
      if (group !== undefined) {
        data.Group = bridge.copy(group);
      }
    } catch (error) {
      bridge.release();
      throw error;
    }

    this.mergeOptionalContent(bridge);

    const ref = this.document.ref(data);
    ref.end(content);

    return { label: `Fx${++this.document._pdfCount}`, ref };
  }

  // Optional content groups live in the catalog, not on the page, so a placed
  // page that draws inside a layer needs its groups registered here too or a
  // viewer has nothing to resolve the /OC references against.
  mergeOptionalContent(bridge) {
    const entry = this.source.document.catalog.get(PDFName.of('OCProperties'));
    const properties = this.source.context.lookupMaybe(entry, PDFDict);
    if (!properties) return;

    const groups = this.source.context.lookupMaybe(
      properties.get(PDFName.of('OCGs')),
      PDFArray
    );
    if (!groups) return;

    const config = this.source.context.lookupMaybe(
      properties.get(PDFName.of('D')),
      PDFDict
    );
    const isHidden = this.hiddenTest(config);

    const root = this.document._root.data;
    if (!root.OCProperties) {
      root.OCProperties = { OCGs: [], D: { ON: [], OFF: [] } };
    }

    const known = root.OCProperties.OCGs;
    for (const group of groups.asArray()) {
      const copied = bridge.copy(group);
      if (known.includes(copied)) continue;

      known.push(copied);
      const state = isHidden(group)
        ? root.OCProperties.D.OFF
        : root.OCProperties.D.ON;
      state.push(copied);
    }

    // /Order drives the layer panel and may be nested with group titles, and
    // /RBGroups makes layers mutually exclusive. Both are copied as they stand,
    // never rebuilt from /OCGs, whose order is unrelated.
    for (const key of ['Order', 'RBGroups']) {
      const list = this.source.context.lookupMaybe(
        config && config.get(PDFName.of(key)),
        PDFArray
      );
      if (!list) continue;

      const copied = bridge.copy(list);
      root.OCProperties.D[key] = (root.OCProperties.D[key] || []).concat(copied);
    }
  }

  // A layer is hidden when the source config lists it under /OFF, or when the
  // base state is /OFF and it is not listed under /ON. Carrying this across
  // matters for jobs where a cut line ships switched off.
  hiddenTest(config) {
    const keyOf = ref =>
      ref instanceof PDFRef ? `${ref.objectNumber} ${ref.generationNumber}` : null;

    const listed = key => {
      const array =
        config &&
        this.source.context.lookupMaybe(config.get(PDFName.of(key)), PDFArray);
      const keys = {};
      if (array) {
        for (const ref of array.asArray()) {
          const id = keyOf(ref);
          if (id) keys[id] = true;
        }
      }
      return keys;
    };

    const off = listed('OFF');
    const on = listed('ON');
    const baseState = config && config.get(PDFName.of('BaseState'));
    const baseIsOff =
      baseState && baseState.asString && baseState.asString() === '/OFF';

    return group => {
      const id = keyOf(group);
      if (id && off[id]) return true;
      if (baseIsOff) return !(id && on[id]);
      return false;
    };
  }

  // A page's content can be split across several streams, and an operator may
  // straddle the boundary, so they are decoded and joined.
  content(page) {
    const contents = this.source.node(page).Contents();
    if (!contents) {
      return Buffer.alloc(0);
    }

    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map(ref => this.source.context.lookup(ref))
        : [contents];

    const parts = [];
    for (const stream of streams) {
      parts.push(Buffer.from(decodePDFRawStream(stream).decode()));
      parts.push(Buffer.from('\n'));
    }

    return Buffer.concat(parts);
  }
}

export default PDFPageEmbedder;
