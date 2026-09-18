import PDFSource from '../pdf_source';
import PDFPageEmbedder from '../pdf_embedder';

export default {
  initPdfs() {
    this._pdfRegistry = {};
    return (this._pdfCount = 0);
  },

  // Parses an external PDF. Asynchronous because pdf-lib's parser yields to the
  // event loop; the returned handle places synchronously, as often as you like.
  openPdf(src, options = {}) {
    const key = options.pdf_id || (typeof src === 'string' ? src : null);
    if (key && this._pdfRegistry[key]) {
      return Promise.resolve(this._pdfRegistry[key]);
    }

    return PDFSource.open(src).then(source => {
      const handle = new PDFPageEmbedder(this, source);
      if (key) {
        this._pdfRegistry[key] = handle;
      }
      return handle;
    });
  },

  placePdf(handle, x, y, options = {}) {
    if (typeof x === 'object' && x !== null) {
      options = x;
      x = null;
      y = null;
    } else if (typeof y === 'object' && y !== null) {
      options = y;
      y = null;
    }

    const page = options.page || 0;
    const box = options.box || 'crop';
    const source = handle.size(page, box);

    let left = x != null ? x : options.x;
    if (left == null) left = this.x;
    let top = y != null ? y : options.y;
    if (top == null) top = this.y;

    let { width: w, height: h } = source;
    let bw;
    let bh;

    if (options.width && options.height) {
      w = options.width;
      h = options.height;
    } else if (options.width) {
      w = options.width;
      h = (source.height * options.width) / source.width;
    } else if (options.height) {
      h = options.height;
      w = (source.width * options.height) / source.height;
    } else if (options.scale) {
      w = source.width * options.scale;
      h = source.height * options.scale;
    } else if (options.fit || options.cover) {
      [bw, bh] = options.fit || options.cover;
      const boxRatio = bw / bh;
      const sourceRatio = source.width / source.height;
      const widthLeads = options.fit
        ? sourceRatio > boxRatio
        : sourceRatio < boxRatio;

      if (widthLeads) {
        w = bw;
        h = bw / sourceRatio;
      } else {
        h = bh;
        w = bh * sourceRatio;
      }
    }

    if (options.fit || options.cover) {
      if (options.align === 'center') {
        left = left + bw / 2 - w / 2;
      } else if (options.align === 'right') {
        left = left + bw - w;
      }

      if (options.valign === 'center') {
        top = top + bh / 2 - h / 2;
      } else if (options.valign === 'bottom') {
        top = top + bh - h;
      }
    }

    const { label, ref } = handle.embed(page, box);
    if (this.page.xobjects[label] == null) {
      this.page.xobjects[label] = ref;
    }

    // Move the cursor below the placement when it followed the flow
    if (this.y === top) {
      this.y += h;
    }

    this.save();
    this.transform(w / source.width, 0, 0, -h / source.height, left, top + h);
    this.addContent(`/${label} Do`);
    this.restore();

    return this;
  },

  addPdf(src, x, y, options) {
    return this.openPdf(src, typeof x === 'object' && x !== null ? x : options).then(
      handle => this.placePdf(handle, x, y, options)
    );
  }
};
