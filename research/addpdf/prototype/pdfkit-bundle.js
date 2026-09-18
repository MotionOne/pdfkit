// Resolves the pdfkit build the harness should run against.
//   PDFKIT_BUNDLE=/path/to/pdfkit.js  node batch.js ...
// Default order: this repo's own build output, then the edicus-prepress copy.
var fs = require('fs');
var path = require('path');

var candidates = [
  process.env.PDFKIT_BUNDLE,
  path.resolve(__dirname, '../../../js/pdfkit.js'),
  path.resolve(__dirname, '../../../js/pdfkit.standalone.js'),
  path.resolve(__dirname, '../../../../edicus-prepress/src/app/library/pdfkit/pdfkit.standalone.js')
].filter(Boolean);

var found = candidates.filter(function (p) { return fs.existsSync(p); })[0];

if (!found) {
  throw new Error(
    'no pdfkit build found. Run `npm run build` in the repo root, or set PDFKIT_BUNDLE.\n  tried:\n    ' +
    candidates.join('\n    ')
  );
}

var PDFDocument = require(found);
PDFDocument.__bundlePath = found;
module.exports = PDFDocument;
