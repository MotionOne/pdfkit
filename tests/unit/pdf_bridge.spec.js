import fs from 'fs';
import PDFKitDocument from '../../lib/document';
import PDFObject from '../../lib/object';
import PDFBridge from '../../lib/pdf_bridge';
import { logData } from './helpers';
import {
  PDFDocument as PDFLibDocument,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFBool,
  PDFNull,
  PDFArray,
  PDFDict,
  PDFContext
} from 'pdf-lib';

const written = chunks =>
  Buffer.concat(
    chunks.map(chunk =>
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary')
    )
  ).toString('binary');

describe('PDFBridge', () => {
  describe('strings', () => {
    test('a literal string stays a string instead of leaking as a name', () => {
      const bridge = new PDFBridge();

      const value = bridge.copy(PDFString.of('/period/space'));

      expect(PDFObject.convert(value)).toBe('(/period/space)');
    });

    test('a hex string keeps its hex form', () => {
      const bridge = new PDFBridge();

      const value = bridge.copy(PDFHexString.of('FEFF00410042'));

      expect(PDFObject.convert(value)).toBe('<FEFF00410042>');
    });
  });

  describe('names and scalars', () => {
    test('a name is emitted exactly as pdf-lib serialises it, escapes included', () => {
      const bridge = new PDFBridge();
      const name = PDFName.of('PANTONE 185 C');

      const value = bridge.copy(name);

      expect(PDFObject.convert(value)).toBe(name.asString());
    });

    test('numbers keep their value', () => {
      const bridge = new PDFBridge();

      // PDFObject.convert hands numbers back as numbers, not as text
      expect(PDFObject.convert(bridge.copy(PDFNumber.of(841.89)))).toBe(841.89);
    });

    test('booleans convert', () => {
      const bridge = new PDFBridge();

      expect(PDFObject.convert(bridge.copy(PDFBool.True))).toBe('true');
      expect(PDFObject.convert(bridge.copy(PDFBool.False))).toBe('false');
    });

    test('null converts - PDFNull is a singleton, not a class', () => {
      const bridge = new PDFBridge();

      expect(PDFObject.convert(bridge.copy(PDFNull))).toBe('null');
    });
  });

  describe('containers', () => {
    test('an array converts element by element', () => {
      const bridge = new PDFBridge();
      const context = PDFContext.create();
      const array = PDFArray.withContext(context);
      array.push(PDFNumber.of(0));
      array.push(PDFNumber.of(0));
      array.push(PDFNumber.of(612));
      array.push(PDFName.of('Foo'));

      const value = bridge.copy(array);

      expect(PDFObject.convert(value)).toBe('[0 0 612 /Foo]');
    });

    test('a dictionary converts key by key', () => {
      const bridge = new PDFBridge();
      const context = PDFContext.create();
      const dict = PDFDict.withContext(context);
      dict.set(PDFName.of('Subtype'), PDFName.of('Form'));
      dict.set(PDFName.of('FormType'), PDFNumber.of(1));

      const value = bridge.copy(dict);

      expect(PDFObject.convert(value)).toBe('<<\n/Subtype /Form\n/FormType 1\n>>');
    });

    test('nested containers convert', () => {
      const bridge = new PDFBridge();
      const context = PDFContext.create();
      const bbox = PDFArray.withContext(context);
      bbox.push(PDFNumber.of(0));
      bbox.push(PDFNumber.of(10));
      const dict = PDFDict.withContext(context);
      dict.set(PDFName.of('BBox'), bbox);

      const value = bridge.copy(dict);

      expect(PDFObject.convert(value)).toBe('<<\n/BBox [0 10]\n>>');
    });
  });

  describe('indirect objects', () => {
    let source;

    const findFlateStream = context =>
      context
        .enumerateIndirectObjects()
        .find(
          ([, object]) =>
            object instanceof PDFRawStream &&
            object.dict.get(PDFName.of('Filter')) !== undefined
        );

    beforeAll(async () => {
      const buffer = fs.readFileSync('examples/kitchen-sink.pdf');
      // jsdom and node do not share a Uint8Array, so hand pdf-lib one this
      // environment recognises
      const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      source = await PDFLibDocument.load(bytes, { updateMetadata: false });
    });

    test('a source reference is copied once and reused', () => {
      const document = new PDFKitDocument();
      const bridge = new PDFBridge(document, source.context);
      const [ref] = findFlateStream(source.context);

      const first = bridge.copy(ref);
      const second = bridge.copy(ref);

      expect(first).toBe(second);
    });

    test('a copied reference is written as an indirect reference', () => {
      const document = new PDFKitDocument();
      const bridge = new PDFBridge(document, source.context);
      const [ref] = findFlateStream(source.context);

      const copied = bridge.copy(ref);

      expect(PDFObject.convert(copied)).toMatch(/^\d+ 0 R$/);
    });

    test('an indirect object holding a string is written as a string', () => {
      const document = new PDFKitDocument();
      const chunks = logData(document);
      const context = PDFContext.create();
      const bridge = new PDFBridge(document, context);
      // an OCG's /Name is an indirect string in some real files
      const ref = context.register(PDFString.of('Watermark'));

      bridge.copy(ref);
      document.end();

      // logData records what _write was handed, before it appends a newline
      expect(written(chunks)).toContain('obj(Watermark)endobj');
    });

    test('an indirect object holding a name is written as a name', () => {
      const document = new PDFKitDocument();
      const chunks = logData(document);
      const context = PDFContext.create();
      const bridge = new PDFBridge(document, context);
      const ref = context.register(PDFName.of('OCG'));

      bridge.copy(ref);
      document.end();

      expect(written(chunks)).toContain('obj/OCGendobj');
    });

    test('an indirect object holding an array is written as an array', () => {
      const document = new PDFKitDocument();
      const chunks = logData(document);
      const context = PDFContext.create();
      const bridge = new PDFBridge(document, context);
      const ref = context.register(context.obj([1, 2]));

      bridge.copy(ref);
      document.end();

      expect(written(chunks)).toContain('obj[1 2]endobj');
    });

    test('a raw stream lands in the output byte for byte, with no re-encoding', () => {
      const document = new PDFKitDocument({ compress: true });
      const chunks = logData(document);
      const bridge = new PDFBridge(document, source.context);
      const [ref, stream] = findFlateStream(source.context);

      bridge.copy(ref);
      document.end();

      const output = Buffer.concat(
        chunks.map(chunk => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary')))
      );
      expect(output.includes(Buffer.from(stream.contents))).toBe(true);
    });
  });
});
