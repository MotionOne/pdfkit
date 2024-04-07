/*
PDFImage - embeds images in PDF documents
By Devon Govett
*/

import fs from 'fs';
import JPEG from './image/jpeg';
import PNG from './image/png';
import TIFF from './image/tiff';

class PDFImage {
  static open(src, label, opt={}) {
    let data;
    if (src.type == 'tiff') {
      let channels = src.bands - (src.has_alpha?1:0);
      data = {
        type: 'tiff',
        image: {
          width: src.width,
          height: src.height,
          hasAlphaChannel: src.has_alpha,
          colors: channels,
          colorSpace: src.is_cmyk ? 'DeviceCMYK' : 'DeviceRGB', 
          bits: 8,
          imgData: src.buf
        }
      }
    } else if (Buffer.isBuffer(src)) {
      data = src;
    } else if (src instanceof ArrayBuffer) {
      data = Buffer.from(new Uint8Array(src));
    }
    /* FIXED_BY_AMONSAGA */ 
    else if (src instanceof Uint8Array) {
      data = src;
    }
    /* FIXED_BY_AMONSAGA */
    else {
      let match;
      if ((match = /^data:.+;base64,(.*)$/.exec(src))) {
        data = Buffer.from(match[1], 'base64');
      } else {
        data = fs.readFileSync(src);
        if (!data) {
          return;
        }
      }
    }

    if (src.type == 'tiff') {
      return new TIFF(data, label);
    } else if (data[0] === 0xff && data[1] === 0xd8) {
      return new JPEG(data, label, opt);
    } else if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') {
      return new PNG(data, label);
    } else {
      throw new Error('Unknown image format.');
    }
  }
}

export default PDFImage;
