/*
PDFBridge - copies objects parsed by pdf-lib into a pdfkit document
*/

import {
  PDFString,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFBool,
  PDFNull,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFRawStream
} from 'pdf-lib';
import PDFAbstractReference from './abstract_reference';

// A value pdfkit writes out verbatim. Used for tokens pdf-lib already serialises
// correctly so we never re-escape them, and never have to rely on
// Buffer.isBuffer - which does not recognise a native Buffer once pdfkit is
// bundled by browserify.
class PDFRawToken extends PDFAbstractReference {
  constructor(token) {
    super();
    this.token = token;
  }

  toString() {
    return this.token;
  }
}

class PDFBridge {
  constructor(document, context) {
    this.document = document;
    this.context = context;
    this.copied = {};
    this.created = [];
  }

  // Finalises anything left half written, so a failed copy cannot stop the
  // document from ever completing
  release() {
    for (const ref of this.created) {
      if (ref.offset === undefined) {
        ref.end();
      }
    }
  }

  copy(object) {
    if (object instanceof PDFRef) {
      return this.ref(object);
    }

    // PDFNull is exported as a singleton, so it cannot be used with instanceof
    if (object === PDFNull || object === undefined || object === null) {
      return null;
    }

    if (object instanceof PDFString || object instanceof PDFHexString) {
      return new PDFRawToken(object.toString());
    }

    // pdfkit turns a plain string into a name; asString() keeps #-escapes
    if (object instanceof PDFName) {
      return object.asString().slice(1);
    }

    if (object instanceof PDFNumber) {
      return object.asNumber();
    }

    if (object instanceof PDFBool) {
      return object.asBoolean();
    }

    if (object instanceof PDFArray) {
      return object.asArray().map(entry => this.copy(entry));
    }

    if (object instanceof PDFDict) {
      const out = {};
      for (const [key, value] of object.entries()) {
        out[key.asString().slice(1)] = this.copy(value);
      }
      return out;
    }

    throw new Error(
      `PDFBridge cannot copy ${object && object.constructor && object.constructor.name}`
    );
  }

  // Copies the object a source reference points at, once. Returns the pdfkit
  // reference standing in for it.
  ref(sourceRef) {
    const key = `${sourceRef.objectNumber} ${sourceRef.generationNumber}`;
    if (this.copied[key]) {
      return this.copied[key];
    }

    const source = this.context.lookup(sourceRef);

    if (source instanceof PDFRawStream) {
      return this.copyStream(key, source);
    }

    const data = {};
    const ref = this.document.ref(data);
    this.created.push(ref);
    this.copied[key] = ref;

    const value = this.copy(source);
    // Only a dictionary merges into the reference's data. Anything else is the
    // object's whole value - a string, name, number or array - and replaces it.
    if (source instanceof PDFDict) {
      Object.assign(data, value);
    } else {
      ref.data = value;
    }
    ref.end();

    return ref;
  }

  copyStream(key, source) {
    // /Filter has to be in place before doc.ref() runs: PDFReference decides in
    // its constructor whether to deflate, and re-deflating already encoded
    // bytes corrupts the stream.
    const data = {};
    const filter = source.dict.get(PDFName.of('Filter'));
    if (filter !== undefined) {
      data.Filter = this.copy(filter);
    }

    const ref = this.document.ref(data);
    this.created.push(ref);
    this.copied[key] = ref;

    for (const [name, value] of source.dict.entries()) {
      const entry = name.asString().slice(1);
      // Length is recomputed by pdfkit, Filter is already in place
      if (entry === 'Length' || entry === 'Filter') continue;
      data[entry] = this.copy(value);
    }

    ref.end(Buffer.from(source.contents));

    return ref;
  }
}

export default PDFBridge;
export { PDFRawToken };
