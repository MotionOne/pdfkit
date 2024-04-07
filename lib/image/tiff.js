import zlib from 'zlib';

class TIFF {
  constructor(data, label) {
    this.label = label;
    this.image = data.image;
    this.width = this.image.width;
    this.height = this.image.height;
    this.imgData = this.image.imgData;
    this.obj = null;
  }

  embed(document) {
    this.document = document;
    if (this.obj) {
      return;
    }

    const hasAlphaChannel = this.image.hasAlphaChannel;

    this.obj = this.document.ref({
      Type: 'XObject',
      Subtype: 'Image',
      BitsPerComponent: hasAlphaChannel ? 8 : this.image.bits,
      Width: this.width,
      Height: this.height,
      Filter: 'FlateDecode'
    });

    if (!hasAlphaChannel) {
      const params = this.document.ref({
        Predictor: isInterlaced ? 1 : 15,
        Colors: this.image.colors,
        BitsPerComponent: this.image.bits,
        Columns: this.width
      });

      this.obj.data['DecodeParms'] = params;
      params.end();
    }

    this.obj.data['ColorSpace'] = this.image.colorSpace;
    if (this.image.colorSpace === 'DeviceCMYK') {
      //this.obj.data['Decode'] = [1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0];
    }

    if (hasAlphaChannel) {
      // For PNG color types 4 and 6, the transparency data is stored as a alpha
      // channel mixed in with the main image data. Separate this data out into an
      // SMask object and store it separately in the PDF.
      return this.splitAlphaChannel();
    }
    this.finalize();
  }

  finalize() {
    if (this.alphaChannel) {
      const sMask = this.document.ref({
        Type: 'XObject',
        Subtype: 'Image',
        Height: this.height,
        Width: this.width,
        BitsPerComponent: 8,
        Filter: 'FlateDecode',
        ColorSpace: 'DeviceGray',
        Decode: [0, 1]
      });

      sMask.end(this.alphaChannel);
      this.obj.data['SMask'] = sMask;
    }

    // add the actual image data
    this.obj.end(this.imgData);

    // free memory
    this.image = null;
    return (this.imgData = null);
  }

  splitAlphaChannel() {
    let pixels = this.imgData;
    let a, p;
    const colorCount = this.image.colors;
    const pixelCount = this.width * this.height;
    const imgData = Buffer.alloc(pixelCount * colorCount);
    const alphaChannel = Buffer.alloc(pixelCount);

    let i = (p = a = 0);
    const len = pixels.length;
    // For 16bit images copy only most significant byte (MSB) - PNG data is always stored in network byte order (MSB first)
    const skipByteCount = this.image.bits === 16 ? 1 : 0;
    while (i < len) {
      for (let colorIndex = 0; colorIndex < colorCount; colorIndex++) {
          imgData[p++] = pixels[i++];
          i += skipByteCount;
      }
      alphaChannel[a++] = pixels[i++];
      i += skipByteCount;
    }

    this.imgData = zlib.deflateSync(imgData);
    this.alphaChannel = zlib.deflateSync(alphaChannel);
    return this.finalize();
  }
}

export default TIFF;
