import zlib from 'zlib';

const MARKERS = [
  0xffc0,
  0xffc1,
  0xffc2,
  0xffc3,
  0xffc5,
  0xffc6,
  0xffc7,
  0xffc8,
  0xffc9,
  0xffca,
  0xffcb,
  0xffcc,
  0xffcd,
  0xffce,
  0xffcf
];

const COLOR_SPACE_MAP = {
  1: 'DeviceGray',
  3: 'DeviceRGB',
  4: 'DeviceCMYK'
};

class JPEG {
  constructor(data, label, opt={}) {
    let marker;
    this.data = data;
    this.label = label;
    this.channels = 3;

    if (opt.invert_cmyk_jpg) {
      this.invert_cmyk_jpg = opt.invert_cmyk_jpg;
    }
    if (opt.icc) {
      this.icc = opt.icc;
    }

    if (this.data.readUInt16BE(0) !== 0xffd8) {
      throw 'SOI not found in JPEG';
    }

    let pos = 2;
    while (pos < this.data.length) {
      marker = this.data.readUInt16BE(pos);
      pos += 2;
      if (MARKERS.includes(marker)) {
        break;
      }
      pos += this.data.readUInt16BE(pos);
    }

    if (!MARKERS.includes(marker)) {
      throw 'Invalid JPEG.';
    }
    pos += 2;

    this.bits = this.data[pos++];
    this.height = this.data.readUInt16BE(pos);
    pos += 2;

    this.width = this.data.readUInt16BE(pos);
    pos += 2;

    this.channels = this.data[pos++];
    this.colorSpace = COLOR_SPACE_MAP[this.channels];

    this.obj = null;
  }

  embed(document) {
    if (this.obj) {
      return;
    }

    if (this.icc) {
      this.colorSpace = document.getColorSpaceRef(this.icc.name);
      if (!this.colorSpace) {
        const icc_data_buf = Buffer.alloc(this.icc.data.length);
        for (let i=0, end=this.icc.data.length; i<end; i++) {
          icc_data_buf[i] = this.icc.data[i];
        }
        this.icc.data = null;
  
        let icc_deflated_data = zlib.deflateSync(icc_data_buf);
        let icc_obj = document.ref({ Filter: 'FlateDecode', Length: icc_deflated_data.length, N: this.channels });
        icc_obj.end(icc_deflated_data);
  
        this.colorSpace = document.ref([ 'ICCBased', icc_obj ]);
        this.colorSpace.end();
  
        document.addColorSpaceWithRef(this.icc.name, this.colorSpace);
      }
    }

    this.obj = document.ref({
      Type: 'XObject',
      Subtype: 'Image',
      BitsPerComponent: this.bits,
      Width: this.width,
      Height: this.height,
      ColorSpace: this.colorSpace,
      Filter: 'DCTDecode'
    });

    // add extra decode params for CMYK images. By swapping the
    // min and max values from the default, we invert the colors. See
    // section 4.8.4 of the spec.
    if ((this.icc && this.icc.is_cmyk) || this.colorSpace === 'DeviceCMYK') {
      if (this.invert_cmyk_jpg) {
        this.obj.data['Decode'] = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
      }
      else {
        this.obj.data['Decode'] = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0];
      }
    }

    this.obj.end(this.data);

    // free memory
    return (this.data = null);
  }
}

export default JPEG;
