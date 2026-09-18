// Prints the optional content (layer) structure of a PDF, so the source and
// what we produced can be compared.
//   node research/addpdf/inspect-layers.js <file.pdf> [pageIndex]
var fs = require('fs');
var path = require('path');
var pl = require('pdf-lib');

var target = process.argv[2];
var pageIndex = process.argv[3] ? parseInt(process.argv[3], 10) : 0;

var buffer = fs.readFileSync(target);
var bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

const name = obj => (obj && obj.asString ? obj.asString() : String(obj));

const label = (context, ref) => {
  var group = context.lookup(ref);
  if (!(group instanceof pl.PDFDict)) return '(not a dict)';
  var title = group.get(pl.PDFName.of('Name'));
  var resolved = context.lookupMaybe(title, pl.PDFString) ||
    context.lookupMaybe(title, pl.PDFHexString);
  var text = resolved ? resolved.decodeText() : '(unnamed)';
  var kind = group.get(pl.PDFName.of('Type'));
  return text + ' [' + name(context.lookupMaybe(kind, pl.PDFName) || kind) + ']';
};

pl.PDFDocument.load(bytes, { updateMetadata: false }).then(function(document) {
  var context = document.context;
  console.log('=== ' + path.basename(target) + ' ===');

  var properties = context.lookupMaybe(
    document.catalog.get(pl.PDFName.of('OCProperties')),
    pl.PDFDict
  );

  if (!properties) {
    console.log('catalog /OCProperties : absent - no layers');
  } else {
    var groups = context.lookupMaybe(properties.get(pl.PDFName.of('OCGs')), pl.PDFArray);
    console.log('catalog /OCProperties/OCGs : ' + (groups ? groups.size() : 0));
    if (groups) {
      groups.asArray().forEach(function(ref, index) {
        console.log('   ' + index + '. ' + label(context, ref));
      });
    }

    var config = context.lookupMaybe(properties.get(pl.PDFName.of('D')), pl.PDFDict);
    if (config) {
      ['ON', 'OFF', 'Order'].forEach(function(key) {
        var list = context.lookupMaybe(config.get(pl.PDFName.of(key)), pl.PDFArray);
        if (!list) return;
        console.log('   /D /' + key + ' : ' +
          list.asArray().map(function(ref) { return label(context, ref); }).join(', '));
      });
      var base = config.get(pl.PDFName.of('BaseState'));
      if (base) console.log('   /D /BaseState : ' + name(base));
    }
  }

  // layers referenced from the page, directly or through a placed form
  var visit = function(resources, depth) {
    if (!resources) return;
    var properties2 = resources.lookupMaybe(pl.PDFName.of('Properties'), pl.PDFDict);
    if (properties2) {
      properties2.entries().forEach(function(entry) {
        console.log('   '.repeat(depth) + 'resources /Properties ' + entry[0].asString() +
          ' -> ' + label(context, entry[1]));
      });
    }
    var xobjects = resources.lookupMaybe(pl.PDFName.of('XObject'), pl.PDFDict);
    if (xobjects && depth < 4) {
      xobjects.entries().forEach(function(entry) {
        var stream = context.lookup(entry[1]);
        if (!stream || !stream.dict) return;
        var subtype = stream.dict.get(pl.PDFName.of('Subtype'));
        if (!subtype || subtype.asString() !== '/Form') return;
        console.log('   '.repeat(depth) + 'form ' + entry[0].asString() + ':');
        var oc = stream.dict.get(pl.PDFName.of('OC'));
        if (oc) console.log('   '.repeat(depth + 1) + '/OC -> ' + label(context, oc));
        visit(
          context.lookupMaybe(stream.dict.get(pl.PDFName.of('Resources')), pl.PDFDict),
          depth + 1
        );
      });
    }
  };

  console.log('page ' + pageIndex + ':');
  visit(document.getPage(pageIndex).node.Resources(), 1);

  // marked content operators in the page's own content
  var contents = document.getPage(pageIndex).node.Contents();
  if (contents) {
    var streams = contents instanceof pl.PDFArray
      ? contents.asArray().map(function(ref) { return context.lookup(ref); })
      : [contents];
    var text = streams
      .map(function(stream) {
        return Buffer.from(pl.decodePDFRawStream(stream).decode()).toString('binary');
      })
      .join('\n');
    var bdc = (text.match(/\/OC\s*\/\S+\s+BDC/g) || []).length;
    console.log('   page content: ' + bdc + ' /OC ... BDC marker(s)');
  }
}).catch(function(error) {
  console.log('FAILED ' + error.message.slice(0, 120));
  process.exitCode = 1;
});
