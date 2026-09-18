// Places the external page at 1:1 on a sheet the size of its trim box, so the
// result can be compared against the source side by side in a viewer.
//   node research/addpdf/sample-1to1.js [external.pdf]
var fs = require('fs');
var path = require('path');
var PDFDocument = require('./prototype/pdfkit-bundle');

var EXTERNAL =
  process.argv[2] ||
  'C:/Users/harry/Downloads/icc프로파일 포함 pdf파일 샘플/altona_visual_1v2a_x3.pdf';
var OUT = path.resolve(__dirname, 'sample-1to1.pdf');
var BOX = process.argv[3] || 'trim';

var started = Date.now();
var probe = new PDFDocument({ autoFirstPage: false });

probe.openPdf(EXTERNAL).then(function(art) {
  var size = art.size(0, BOX);

  var doc = new PDFDocument({
    size: [size.width, size.height],
    margin: 0,
    compress: true,
    pdfVersion: '1.4'
  });
  var chunks = [];
  doc.on('data', function(chunk) { chunks.push(chunk); });
  doc.on('end', function() {
    var buffer = Buffer.concat(chunks);
    fs.writeFileSync(OUT, buffer);
    console.log('source   : ' + path.basename(EXTERNAL));
    console.log('box      : ' + BOX + ', ' + size.width + ' x ' + size.height + ' pt');
    console.log('placed   : 1:1, filling the sheet');
    console.log('output   : ' + OUT + ' (' + (buffer.length / 1048576).toFixed(1) + 'MB, ' +
      (Date.now() - started) + 'ms)');
  });

  // the handle belongs to the document that opened it, so open it again here
  return doc.openPdf(EXTERNAL).then(function(placed) {
    doc.placePdf(placed, 0, 0, { box: BOX });
    doc.end();
  });
}).catch(function(error) {
  console.log('FAILED ' + error.stack);
  process.exitCode = 1;
});
