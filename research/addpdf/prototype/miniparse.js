// Minimal PDF reader: classic xref tables only. Feasibility spike, not production code.
var zlib = require('zlib');

var WS = { 0x00: 1, 0x09: 1, 0x0a: 1, 0x0c: 1, 0x0d: 1, 0x20: 1 };
var DELIM = { 0x28: 1, 0x29: 1, 0x3c: 1, 0x3e: 1, 0x5b: 1, 0x5d: 1, 0x7b: 1, 0x7d: 1, 0x2f: 1, 0x25: 1 };

// Wrapper types so the importer can tell PDF types apart
function PName(raw) { this.raw = raw; }   // name text WITHOUT leading slash, still #xx-escaped
function PRef(num, gen) { this.num = num; this.gen = gen; }
function PStr(buf) { this.buf = buf; }    // byte-exact string payload
function PStream(dict, raw) { this.dict = dict; this.raw = raw; }

function Lexer(buf, pos) { this.buf = buf; this.pos = pos || 0; }

Lexer.prototype.skipWS = function () {
  while (this.pos < this.buf.length) {
    var c = this.buf[this.pos];
    if (WS[c]) { this.pos++; }
    else if (c === 0x25) { while (this.pos < this.buf.length && this.buf[this.pos] !== 0x0a && this.buf[this.pos] !== 0x0d) this.pos++; }
    else break;
  }
};

Lexer.prototype.readToken = function () {
  this.skipWS();
  var start = this.pos;
  while (this.pos < this.buf.length && !WS[this.buf[this.pos]] && !DELIM[this.buf[this.pos]]) this.pos++;
  if (this.pos === start) this.pos++;
  return this.buf.toString('binary', start, this.pos);
};

Lexer.prototype.parseObject = function (doc) {
  this.skipWS();
  var c = this.buf[this.pos];

  if (c === 0x2f) {                                   // name
    this.pos++;
    var s = this.pos;
    while (this.pos < this.buf.length && !WS[this.buf[this.pos]] && !DELIM[this.buf[this.pos]]) this.pos++;
    return new PName(this.buf.toString('binary', s, this.pos));
  }

  if (c === 0x5b) {                                   // array
    this.pos++;
    var arr = [];
    for (;;) {
      this.skipWS();
      if (this.pos >= this.buf.length) throw new Error('unterminated array');
      if (this.buf[this.pos] === 0x5d) { this.pos++; break; }
      arr.push(this.parseObject(doc));
    }
    return arr;
  }

  if (c === 0x3c && this.buf[this.pos + 1] === 0x3c) { // dict (maybe stream)
    this.pos += 2;
    var dict = {};
    for (;;) {
      this.skipWS();
      if (this.pos >= this.buf.length) throw new Error('unterminated dictionary');
      if (this.buf[this.pos] === 0x3e && this.buf[this.pos + 1] === 0x3e) { this.pos += 2; break; }
      var key = this.parseObject(doc);
      if (!(key instanceof PName)) throw new Error('non-name dictionary key at ' + this.pos);
      dict[key.raw] = this.parseObject(doc);
    }
    var save = this.pos;
    this.skipWS();
    if (this.buf.toString('binary', this.pos, this.pos + 6) === 'stream') {
      this.pos += 6;
      if (this.buf[this.pos] === 0x0d) this.pos++;
      if (this.buf[this.pos] === 0x0a) this.pos++;
      var len = dict.Length;
      if (len instanceof PRef) len = doc.get(len.num);
      var raw = this.buf.slice(this.pos, this.pos + len);
      this.pos += len;
      return new PStream(dict, raw);
    }
    this.pos = save;
    return dict;
  }

  if (c === 0x28) {                                   // literal string
    this.pos++;
    var out = [], depth = 1;
    while (this.pos < this.buf.length) {
      var ch = this.buf[this.pos++];
      if (ch === 0x5c) { out.push(ch); out.push(this.buf[this.pos++]); continue; }
      if (ch === 0x28) depth++;
      if (ch === 0x29) { depth--; if (depth === 0) break; }
      out.push(ch);
    }
    return new PStr(Buffer.from(out));
  }

  if (c === 0x3c) {                                   // hex string
    this.pos++;
    var hs = this.pos;
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0x3e) this.pos++;
    if (this.pos >= this.buf.length) throw new Error('unterminated hex string at ' + hs);
    var hex = this.buf.toString('binary', hs, this.pos).replace(/[^0-9a-fA-F]/g, '');
    this.pos++;
    if (hex.length & 1) hex += '0';
    return new PStr(Buffer.from(hex, 'hex'));
  }

  var savedPos = this.pos;
  var tok = this.readToken();
  if (/^[+-]?[\d.]+$/.test(tok)) {                    // number, or "n g R"
    var s1 = this.pos;
    var t2 = this.readToken();
    if (/^\d+$/.test(t2)) {
      var s2 = this.pos;
      var t3 = this.readToken();
      if (t3 === 'R') return new PRef(parseInt(tok, 10), parseInt(t2, 10));
      this.pos = s2;
    }
    this.pos = s1;
    return parseFloat(tok);
  }
  if (tok === 'true') return true;
  if (tok === 'false') return false;
  if (tok === 'null') return null;
  this.pos = savedPos + tok.length;
  return { __kw: tok };
};

function PDFReader(buf) {
  this.buf = buf;
  this.xref = {};
  this.trailer = {};
  this.cache = {};
  this._readXref();
}

PDFReader.prototype._readXref = function () {
  var tail = this.buf.toString('binary', Math.max(0, this.buf.length - 2048));
  var re = /startxref\s+(\d+)/g, last = null, m;
  while ((m = re.exec(tail))) last = m[1];
  if (!last) throw new Error('no startxref found');

  var offset = parseInt(last, 10);
  var seen = {};
  while (offset != null && !seen[offset]) {
    seen[offset] = 1;
    var lex = new Lexer(this.buf, offset);
    var kw = lex.readToken();
    if (kw !== 'xref') {
      throw new Error('SPIKE LIMIT: cross-reference stream (PDF 1.5+) at offset ' + offset + ', token=' + kw);
    }
    for (;;) {
      lex.skipWS();
      var save = lex.pos;
      var t = lex.readToken();
      if (t === 'trailer') break;
      var start = parseInt(t, 10);
      var count = parseInt(lex.readToken(), 10);
      if (isNaN(start) || isNaN(count)) { lex.pos = save; break; }
      for (var i = 0; i < count; i++) {
        lex.skipWS();
        var off = parseInt(this.buf.toString('binary', lex.pos, lex.pos + 10), 10);
        var type = this.buf.toString('binary', lex.pos + 17, lex.pos + 18);
        lex.pos += 18;
        var num = start + i;
        if (type === 'n' && this.xref[num] === undefined) this.xref[num] = off;
      }
    }
    var tr = lex.parseObject(this);
    for (var k in tr) if (this.trailer[k] === undefined) this.trailer[k] = tr[k];
    offset = tr.Prev != null ? tr.Prev : null;
  }
};

PDFReader.prototype.get = function (num) {
  if (this.cache[num] !== undefined) return this.cache[num];
  var off = this.xref[num];
  if (off === undefined) return null;
  var lex = new Lexer(this.buf, off);
  lex.readToken(); lex.readToken();
  var kw = lex.readToken();
  if (kw !== 'obj') throw new Error('bad object header for ' + num + ': ' + kw);
  var val = lex.parseObject(this);
  this.cache[num] = val;
  return val;
};

PDFReader.prototype.resolve = function (o) {
  while (o instanceof PRef) o = this.get(o.num);
  return o;
};

PDFReader.prototype.decode = function (st) {
  var f = this.resolve(st.dict.Filter);
  if (f == null) return st.raw;
  var name = f instanceof PName ? f.raw
    : (Array.isArray(f) && f.length === 1 && f[0] instanceof PName ? f[0].raw : null);
  if (name === 'FlateDecode') return zlib.inflateSync(st.raw);
  throw new Error('SPIKE LIMIT: unsupported filter ' + (name || JSON.stringify(f)));
};

// Page lookup honouring attribute inheritance from the page tree
PDFReader.prototype.getPage = function (index) {
  var root = this.resolve(this.trailer.Root);
  var pages = this.resolve(root.Pages);
  var INHERIT = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
  var self = this, found = null, n = 0, seen = {}, depth = 0;

  function walk(nodeRef, inherited) {
    if (found) return;
    if (nodeRef instanceof PRef) {
      if (seen[nodeRef.num]) throw new Error('cyclic page tree at obj ' + nodeRef.num);
      seen[nodeRef.num] = 1;
    }
    if (++depth > 64) throw new Error('page tree too deep');
    var node = self.resolve(nodeRef);
    if (!node || typeof node !== 'object') throw new Error('bad page tree node');
    var inh = {};
    for (var k in inherited) inh[k] = inherited[k];
    INHERIT.forEach(function (key) { if (node[key] !== undefined) inh[key] = node[key]; });
    var type = node.Type instanceof PName ? node.Type.raw : null;
    if (type === 'Page' || (!node.Kids && node.Contents !== undefined)) {
      if (n++ === index) found = { dict: node, inherited: inh };
      return;
    }
    var kids = self.resolve(node.Kids) || [];
    for (var i = 0; i < kids.length && !found; i++) walk(kids[i], inh);
    depth--;
  }

  walk(pages, {});
  return found;
};

module.exports = {
  PDFReader: PDFReader, Lexer: Lexer,
  PName: PName, PRef: PRef, PStr: PStr, PStream: PStream
};
