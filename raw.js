/* Preset Lab: reads the picture inside a camera RAW file (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 and others).
   RAW files carry a full-size JPEG preview made by the camera. This finds the biggest one and returns its bytes.
   It does not decode the raw sensor data. Everything happens in the browser. */
(function (root) {
  'use strict';
  var R = {};
  R.EXT = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'raw', 'pef', 'ptx', 'srw', 'x3f', '3fr', 'fff', 'erf', 'kdc', 'dcr', 'mrw', 'mef', 'mos', 'iiq', 'cap', 'gpr'];
  R.isRaw = function (name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return !!m && R.EXT.indexOf(m[1].toLowerCase()) >= 0; };
  R.accept = 'image/*,' + R.EXT.map(function (e) { return '.' + e; }).join(',');

  /* Length of a JPEG that starts at i (FFD8), or 0 if it does not parse to a clean end. */
  function jpegEnd(b, i) {
    var n = b.length, p = i + 2, sawFrame = false;
    while (p + 4 <= n) {
      if (b[p] !== 0xFF) return 0;
      var m = b[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xD9) return sawFrame ? p + 2 - i : 0;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      var len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2) return 0;
      if (m === 0xC0 || m === 0xC1 || m === 0xC2) sawFrame = true;
      if (m === 0xDA) {
        p += 2 + len;
        while (p + 1 < n) { /* entropy data: skip until a real marker */
          if (b[p] === 0xFF && b[p + 1] !== 0 && !(b[p + 1] >= 0xD0 && b[p + 1] <= 0xD7)) break;
          p++;
        }
        continue;
      }
      p += 2 + len;
    }
    return 0;
  }
  /* All embedded JPEGs, biggest first. Pictures nested inside another JPEG (its thumbnail) are skipped. */
  R.previews = function (b, minBytes) {
    var out = [], n = b.length, i = 0; minBytes = minBytes || 30000;
    while (i + 3 < n) {
      if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) {
        var len = jpegEnd(b, i);
        if (len >= minBytes) { out.push({ start: i, length: len }); i += len; continue; }
        if (len > 0) { i += len; continue; }
      }
      i++;
    }
    return out.sort(function (a, c) { return c.length - a.length; });
  };
  function u16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
  function u32(b, o, le) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  /* Orientation (1-8) from a TIFF block that starts at t, or 0 if there is none. */
  R.tiffOrientation = function (b, t) {
    if (t + 8 > b.length) return 0;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4D && b[t + 1] === 0x4D)) return 0;
    var ifd = t + u32(b, t + 4, le); if (ifd + 2 > b.length) return 0;
    var cnt = u16(b, ifd, le);
    for (var k = 0; k < cnt && ifd + 2 + k * 12 + 12 <= b.length; k++) {
      var e = ifd + 2 + k * 12;
      if (u16(b, e, le) === 0x0112) { var v = u16(b, e + 8, le); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  };
  /* Orientation stored inside a JPEG (Exif block), or 0 when it has none. */
  R.jpegOrientation = function (b, start) {
    var p = start + 2, n = b.length;
    while (p + 4 < n && b[p] === 0xFF) {
      var m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) return R.tiffOrientation(b, p + 10);
      if (m === 0xDA || len < 2) break;
      p += 2 + len;
    }
    return 0;
  };
  /* Pick the picture to use. Returns { start, length, orient (turn still needed, 1 = none), count } or null. */
  R.pick = function (b) {
    var list = R.previews(b); if (!list.length) return null;
    var best = list[0], own = R.jpegOrientation(b, best.start), file = R.tiffOrientation(b, 0);
    return { start: best.start, length: best.length, orient: own ? 1 : (file || 1), count: list.length, candidates: list };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.RAWX = R;
})(typeof self !== 'undefined' ? self : this);
