// Reads our own output back with pdf-lib. Any "Invalid object ref" warning here
// means we wrote something malformed - the string-leak trap shows up this way.
var fs = require('fs');
var path = require('path');
var pl = require('pdf-lib');

var target = process.argv[2] || path.resolve(__dirname, 'acceptance-out.pdf');
var buffer = fs.readFileSync(target);
var bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

pl.PDFDocument.load(bytes, { updateMetadata: false })
  .then(function(document) {
    var context = document.context;
    var page = document.getPage(0).node;
    var xobjects = page.Resources().lookup(pl.PDFName.of('XObject'), pl.PDFDict);
    var names = xobjects.keys().map(function(key) {
      return key.asString();
    });
    var form = context.lookup(xobjects.get(pl.PDFName.of('Fx1')));

    console.log(
      'RESULT pages=' +
        document.getPageCount() +
        ' objects=' +
        context.enumerateIndirectObjects().length +
        ' xobjects=' +
        names.join(',')
    );
    console.log(
      'RESULT form subtype=' +
        form.dict.get(pl.PDFName.of('Subtype')).asString() +
        ' hasResources=' +
        !!form.dict.get(pl.PDFName.of('Resources')) +
        ' bbox=' +
        form.dict.get(pl.PDFName.of('BBox')).toString().replace(/\s+/g, ' ')
    );
  })
  .catch(function(error) {
    console.log('RESULT FAILED ' + error.message.slice(0, 120));
    process.exitCode = 1;
  });
