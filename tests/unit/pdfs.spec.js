import PDFKitDocument from '../../lib/document';
import { logData } from './helpers';
import {
  PDFDocument as PDFLibDocument,
  PDFName,
  PDFString,
  degrees
} from 'pdf-lib';

const KITCHEN_SINK = 'examples/kitchen-sink.pdf'; // page 1 is 612 x 792

const output = chunks =>
  Buffer.concat(
    chunks.map(chunk =>
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'binary')
    )
  ).toString('binary');

// pdfkit rounds every number it writes to six decimals
const round = value => Math.round(value * 1e6) / 1e6;

const newDocument = () =>
  new PDFKitDocument({ compress: false, size: [1000, 1000], margin: 0 });

describe('placePdf', () => {
  test('draws the page at its own size when no size is given', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 40, 60);
    document.end();

    // 612 x 792 at 1:1, flipped back over the page transform: y + height
    expect(output(data)).toContain('q\n1 0 0 -1 40 852 cm\n/Fx1 Do\nQ');
  });

  test('scales to the given width and keeps the aspect ratio', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 40, 60, { width: 306 });
    document.end();

    // 306 / 612 = 0.5, so height becomes 396 and y + height is 456
    expect(output(data)).toContain('q\n0.5 0 0 -0.5 40 456 cm\n/Fx1 Do\nQ');
  });

  test('registers the placed page as a form XObject on the page', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/XObject <<\n/Fx1 ');
    expect(written).toContain('/Subtype /Form');
    expect(written).toContain('/BBox [0 0 612 792]');
  });

  test('advances the cursor when the position comes from the document', async () => {
    const document = newDocument();
    const art = await document.openPdf(KITCHEN_SINK);
    document.x = 10;
    document.y = 20;

    document.placePdf(art, { width: 306 });

    expect(document.y).toBe(20 + 396);
  });

  test('scales to the given height', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { height: 396 });
    document.end();

    expect(output(data)).toContain('q\n0.5 0 0 -0.5 0 396 cm\n/Fx1 Do\nQ');
  });

  test('takes width and height together, without keeping the ratio', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { width: 306, height: 198 });
    document.end();

    // 306/612 = 0.5 across, 198/792 = 0.25 down
    expect(output(data)).toContain('q\n0.5 0 0 -0.25 0 198 cm\n/Fx1 Do\nQ');
  });

  test('scales by a factor', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { scale: 0.25 });
    document.end();

    expect(output(data)).toContain('q\n0.25 0 0 -0.25 0 198 cm\n/Fx1 Do\nQ');
  });

  test('fits inside the given box', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { fit: [300, 300] });
    document.end();

    // taller than wide, so the height is the limit: 300/792
    const scale = round(300 / 792);
    expect(output(data)).toContain(`q\n${scale} 0 0 -${scale} 0 300 cm\n/Fx1 Do\nQ`);
  });

  test('covers the given box', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { cover: [300, 300] });
    document.end();

    // covering 300 wide needs 300/612, which overflows the height
    const scale = round(300 / 612);
    const height = round((792 * 300) / 612);
    expect(output(data)).toContain(
      `q\n${scale} 0 0 -${scale} 0 ${height} cm\n/Fx1 Do\nQ`
    );
  });

  test('centres inside the fit box', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, {
      fit: [300, 300],
      align: 'center',
      valign: 'center'
    });
    document.end();

    const scale = round(300 / 792);
    const width = (612 * 300) / 792;
    // the drawn page is narrower than the box, so it shifts right
    expect(output(data)).toContain(
      `q\n${scale} 0 0 -${scale} ${round((300 - width) / 2)} 300 cm\n/Fx1 Do\nQ`
    );
  });

  test('aligns right and bottom inside the fit box', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, {
      fit: [300, 300],
      align: 'right',
      valign: 'bottom'
    });
    document.end();

    const scale = round(300 / 792);
    const width = (612 * 300) / 792;
    expect(output(data)).toContain(
      `q\n${scale} 0 0 -${scale} ${round(300 - width)} 300 cm\n/Fx1 Do\nQ`
    );
  });

  test('returns the document so calls can be chained', async () => {
    const document = newDocument();
    const art = await document.openPdf(KITCHEN_SINK);

    expect(document.placePdf(art, 0, 0)).toBe(document);
  });
});

describe('placePdf boxes and caching', () => {
  const withTrimBox = async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([600, 800]);
    page.setTrimBox(20, 30, 500, 700);
    return source.save();
  };

  test('draws the requested box', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withTrimBox());

    document.placePdf(art, 0, 0, { box: 'trim' });
    document.end();

    expect(output(data)).toContain('/BBox [20 30 520 730]');
  });

  test('places the same page twice from one form XObject', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(KITCHEN_SINK);

    document.placePdf(art, 0, 0, { width: 100 });
    document.placePdf(art, 200, 0, { width: 100 });
    document.end();

    const written = output(data);
    expect(written.match(/\/Subtype \/Form/g)).toHaveLength(1);
    expect(written.match(/\/Fx1 Do/g)).toHaveLength(2);
  });

  test('builds a separate form for a different box of the same page', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withTrimBox());

    document.placePdf(art, 0, 0, { box: 'media', width: 100 });
    document.placePdf(art, 200, 0, { box: 'trim', width: 100 });
    document.end();

    const written = output(data);
    expect(written.match(/\/Subtype \/Form/g)).toHaveLength(2);
    expect(written).toContain('/Fx1 Do');
    expect(written).toContain('/Fx2 Do');
  });

  test('reuses the parsed PDF when the same path is opened again', async () => {
    const document = newDocument();

    const first = await document.openPdf(KITCHEN_SINK);
    const second = await document.openPdf(KITCHEN_SINK);

    expect(second).toBe(first);
  });

  test('copies the transparency group so blending survives', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    page.node.set(
      PDFName.of('Group'),
      source.context.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' })
    );
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await source.save());

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/Group <<');
    expect(written).toContain('/S /Transparency');
  });
});

describe('placePdf with a rotated page', () => {
  const rotatedPdf = async rotation => {
    const source = await PDFLibDocument.create();
    source.addPage([600, 800]).setRotation(degrees(rotation));
    return source.save();
  };

  test('a page without rotation only moves the box origin', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await rotatedPdf(0));

    document.placePdf(art, 0, 0);
    document.end();

    expect(output(data)).toContain('/Matrix [1 0 0 1 0 0]');
  });

  test('bakes a 90 degree rotation into the form matrix', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await rotatedPdf(90));

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/BBox [0 0 600 800]');
    expect(written).toContain('/Matrix [0 -1 1 0 0 600]');
    // displayed 800 x 600, so the placement covers that at 1:1
    expect(written).toContain('q\n1 0 0 -1 0 600 cm\n/Fx1 Do\nQ');
  });

  test('bakes a 180 degree rotation into the form matrix', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await rotatedPdf(180));

    document.placePdf(art, 0, 0);
    document.end();

    expect(output(data)).toContain('/Matrix [-1 0 0 -1 600 800]');
  });

  test('bakes a 270 degree rotation into the form matrix', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await rotatedPdf(270));

    document.placePdf(art, 0, 0);
    document.end();

    expect(output(data)).toContain('/Matrix [0 1 -1 0 800 0]');
  });
});

describe('placePdf with optional content', () => {
  const withLayer = async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const ocg = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Layer 1') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({ OCGs: [ocg], D: { Order: [ocg], ON: [ocg] } })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: ocg } })
    );
    return source.save();
  };

  test('registers the layers in the catalog so viewers can resolve them', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withLayer());

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/Type /OCG');
    expect(written).toContain('/OCProperties');
    expect(document._root.data.OCProperties.OCGs).toHaveLength(1);
  });

  // two layers, as a die-cut job has: artwork visible, cut line hidden
  const withTwoLayers = async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const artwork = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('CMYK') })
    );
    const cut = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Cut') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({
        OCGs: [artwork, cut],
        D: { Order: [artwork, cut], ON: [artwork], OFF: [cut] }
      })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: artwork, MC1: cut } })
    );
    page.node.set(
      PDFName.of('Contents'),
      source.context.register(
        source.context.stream(
          '/OC /MC0 BDC 1 0 0 rg 0 0 50 50 re f EMC /OC /MC1 BDC 0 0 1 RG 0 0 50 50 re S EMC'
        )
      )
    );
    return source.save();
  };

  test('keeps a layer that was off by default off', async () => {
    const document = newDocument();
    const art = await document.openPdf(await withTwoLayers());

    document.placePdf(art, 0, 0);
    document.end();

    const config = document._root.data.OCProperties.D;
    expect(document._root.data.OCProperties.OCGs).toHaveLength(2);
    expect(config.ON).toHaveLength(1);
    expect(config.OFF).toHaveLength(1);
    // the hidden one must be the second group, as in the source order
    expect(config.OFF[0]).toBe(document._root.data.OCProperties.OCGs[1]);
  });

  test('keeps the layer order of the source', async () => {
    const document = newDocument();
    const art = await document.openPdf(await withTwoLayers());

    document.placePdf(art, 0, 0);
    document.end();

    const properties = document._root.data.OCProperties;
    expect(properties.D.Order).toEqual(properties.OCGs);
  });

  test('keeps the panel order the source gave, not the order of /OCGs', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const first = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Front') })
    );
    const second = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Back') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({
        OCGs: [first, second],
        // the panel shows them the other way round
        D: { Order: [second, first], ON: [first, second] }
      })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: first, MC1: second } })
    );

    const document = newDocument();
    const art = await document.openPdf(await source.save());

    document.placePdf(art, 0, 0);
    document.end();

    const properties = document._root.data.OCProperties;
    expect(properties.D.Order).toEqual([properties.OCGs[1], properties.OCGs[0]]);
  });

  test('does not invent an order when the source has none', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const group = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Watermark') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({ OCGs: [group], D: { ON: [group] } })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: group } })
    );

    const document = newDocument();
    const art = await document.openPdf(await source.save());

    document.placePdf(art, 0, 0);
    document.end();

    expect(document._root.data.OCProperties.OCGs).toHaveLength(1);
    expect(document._root.data.OCProperties.D.Order).toBeUndefined();
  });

  test('carries radio button groups across', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const a = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Option A') })
    );
    const b = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Option B') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({
        OCGs: [a, b],
        D: { Order: [a, b], ON: [a], OFF: [b], RBGroups: [[a, b]] }
      })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: a, MC1: b } })
    );

    const document = newDocument();
    const art = await document.openPdf(await source.save());

    document.placePdf(art, 0, 0);
    document.end();

    const groups = document._root.data.OCProperties.D.RBGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  test('carries the layer names across', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withTwoLayers());

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('(CMYK)');
    expect(written).toContain('(Cut)');
  });

  test('keeps the marked content operators that select the layers', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withTwoLayers());

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/OC /MC0 BDC');
    expect(written).toContain('/OC /MC1 BDC');
    expect(written.match(/EMC/g)).toHaveLength(2);
  });

  test('keeps the form resources pointing at the copied layers', async () => {
    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await withTwoLayers());

    document.placePdf(art, 0, 0);
    document.end();

    const written = output(data);
    expect(written).toContain('/Properties <<');
    expect(written).toMatch(/\/MC0 \d+ 0 R/);
    expect(written).toMatch(/\/MC1 \d+ 0 R/);
  });

  test('a source with a base state of off keeps every layer off', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const group = source.context.register(
      source.context.obj({ Type: 'OCG', Name: PDFString.of('Guides') })
    );
    source.catalog.set(
      PDFName.of('OCProperties'),
      source.context.obj({
        OCGs: [group],
        D: { BaseState: PDFName.of('OFF'), Order: [group] }
      })
    );
    page.node.set(
      PDFName.of('Resources'),
      source.context.obj({ Properties: { MC0: group } })
    );

    const document = newDocument();
    const art = await document.openPdf(await source.save());

    document.placePdf(art, 0, 0);
    document.end();

    const config = document._root.data.OCProperties.D;
    expect(config.OFF).toHaveLength(1);
    expect(config.ON).toHaveLength(0);
  });

  test('does not register the same layer twice', async () => {
    const document = newDocument();
    const art = await document.openPdf(await withLayer());

    document.placePdf(art, 0, 0, { width: 50 });
    document.placePdf(art, 60, 0, { width: 50 });
    document.end();

    expect(document._root.data.OCProperties.OCGs).toHaveLength(1);
  });
});

describe('placePdf failures', () => {
  test('a page it cannot decode still leaves the document finishable', async () => {
    const source = await PDFLibDocument.create();
    const page = source.addPage([100, 100]);
    const undecodable = source.context.register(
      source.context.stream('nonsense', { Filter: PDFName.of('CCITTFaxDecode') })
    );
    page.node.set(PDFName.of('Contents'), undecodable);

    const document = newDocument();
    const data = logData(document);
    const art = await document.openPdf(await source.save());

    expect(() => document.placePdf(art, 0, 0)).toThrow();
    document.end();

    // a reference left unfinalised would stop the document ever completing
    expect(document._waiting).toBe(0);
    expect(output(data)).toContain('%%EOF');
  });

  test('an out of range page is reported before anything is written', async () => {
    const document = newDocument();
    const art = await document.openPdf(KITCHEN_SINK);

    expect(() => document.placePdf(art, 0, 0, { page: 99 })).toThrow(/page/i);

    expect(document._waiting).toBeGreaterThan(0); // only the document's own objects
    document.end();
    expect(document._waiting).toBe(0);
  });
});

describe('addPdf', () => {
  test('opens and places in one call', async () => {
    const document = newDocument();
    const data = logData(document);

    await document.addPdf(KITCHEN_SINK, 40, 60, { width: 306 });
    document.end();

    expect(output(data)).toContain('q\n0.5 0 0 -0.5 40 456 cm\n/Fx1 Do\nQ');
  });
});
