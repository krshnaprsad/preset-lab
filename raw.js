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
    var out = [], n = b.length, i = 0; minBytes = minBytes || 10000;
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
  /* The turn still needed for the preview that starts at `start` (1 = none). */
  R.orientFor = function (b, start) { var own = R.jpegOrientation(b, start), file = R.tiffOrientation(b, 0); return own ? 1 : (file || 1); };
  /* Pick the picture to use. Returns { start, length, orient (turn still needed, 1 = none), count } or null. */
  R.pick = function (b) {
    var list = R.previews(b); if (!list.length) return null;
    var best = list[0], own = R.jpegOrientation(b, best.start), file = R.tiffOrientation(b, 0);
    return { start: best.start, length: best.length, orient: own ? 1 : (file || 1), count: list.length, candidates: list };
  };

  /* ---------- plain Bayer DNG (no preview picture inside) ---------- */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  function readIfd(b, t, off, le, tags) {
    if (off + 2 > b.length) return null;
    var cnt = u16(b, off, le), out = {}, k, e, tag, type, n, size, vo, vals, i;
    for (k = 0; k < cnt && off + 2 + k * 12 + 12 <= b.length; k++) {
      e = off + 2 + k * 12; tag = u16(b, e, le); type = u16(b, e + 2, le); n = u32(b, e + 4, le);
      size = (TSIZE[type] || 1) * n; vo = size <= 4 ? e + 8 : t + u32(b, e + 8, le);
      if (vo + size > b.length || n > 4000000) continue;
      vals = [];
      for (i = 0; i < n; i++) {
        if (type === 3) vals.push(u16(b, vo + i * 2, le));
        else if (type === 4) vals.push(u32(b, vo + i * 4, le));
        else if (type === 1 || type === 7) vals.push(b[vo + i]);
        else if (type === 5) { var d = u32(b, vo + i * 8 + 4, le); vals.push(d ? u32(b, vo + i * 8, le) / d : 0); }
        else if (type === 10) { var sn = u32(b, vo + i * 8, le) | 0, sd = u32(b, vo + i * 8 + 4, le) | 0; vals.push(sd ? sn / sd : 0); }
        else if (type === 8) { var sv = u16(b, vo + i * 2, le); vals.push(sv > 32767 ? sv - 65536 : sv); }
        else break;
      }
      out[tag] = vals;
    }
    return out;
  }
  function inv3(m) {
    var a = m[0], bb = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + bb * B + c * C;
    if (!det) return null;
    return [A / det, -(bb * i - c * h) / det, (bb * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - bb * g) / det, (a * e - bb * d) / det];
  }
  function mul3(p, q) { var o = [], r, c, k; for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) { var s = 0; for (k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; o.push(s); } return o; }
  /* Find the uncompressed Bayer image in a DNG and turn it into a picture at half size (each 2 x 2 block becomes one pixel).
     Returns { width, height, data (RGBA), orient } or { error }. */
  /* lossless JPEG (SOF3) decoder, as used inside compressed DNG sensor data */
  var hcache = {};
  function huffTable(b, p, cnt) {
    var key = '', i, k; for (i = 0; i < 16 + cnt; i++) key += String.fromCharCode(b[p + i]);
    if (hcache[key]) return hcache[key];
    var tab = new Uint16Array(65536), code = 0, idx = 16;
    for (var len = 1; len <= 16; len++) {
      for (k = 0; k < b[p + len - 1]; k++) {
        var sym = b[p + idx++], lo = code << (16 - len), hi = lo + (1 << (16 - len));
        for (var q = lo; q < hi; q++) tab[q] = (len << 8) | sym;
        code++;
      }
      code <<= 1;
    }
    hcache = {}; hcache[key] = tab; return tab;
  }
  R.decodeLJ = function (b, start, end) {
    var p = start, tabs = {}, i, nf = 0, w = 0, h = 0, prec = 0, comps = [], pred = 1, pt = 0, dri = 0;
    if (b[p] !== 0xFF || b[p + 1] !== 0xD8) return null;
    p += 2;
    while (p < end) {
      if (b[p] !== 0xFF) { p++; continue; }
      var m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xC3) { prec = b[p + 4]; h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8]; nf = b[p + 9]; for (i = 0; i < nf; i++) comps.push({ id: b[p + 10 + i * 3], td: 0 }); }
      else if (m === 0xC0 || m === 0xC1 || m === 0xC2 || m === 0xC9) return null;
      else if (m === 0xC4) { var q = p + 4; while (q < p + 2 + len) { var tc = b[q] >> 4, th = b[q] & 15, n = 0, z; for (z = 1; z <= 16; z++) n += b[q + z]; tabs[th] = huffTable(b, q + 1, n); q += 17 + n; } }
      else if (m === 0xDD) dri = (b[p + 4] << 8) | b[p + 5];
      else if (m === 0xDA) {
        var ns = b[p + 4]; for (i = 0; i < ns; i++) { var cid = b[p + 5 + i * 2], tdv = b[p + 6 + i * 2] >> 4; for (var c = 0; c < comps.length; c++) if (comps[c].id === cid) comps[c].td = tdv; }
        pred = b[p + 5 + ns * 2]; pt = b[p + 7 + ns * 2] & 15; p += 2 + len; break;
      }
      p += 2 + len;
    }
    if (!w || !h || !nf || prec < 2 || prec > 16 || pred < 1 || pred > 7) return null;
    var out = new Uint16Array(w * h * nf), bitbuf = 0, bits = 0, pos = p, ci, x, y, rowLen = w * nf;
    function fill() {
      while (bits <= 24) {
        var v = 0;
        if (pos < end) { v = b[pos]; if (v === 0xFF) { var n2 = b[pos + 1]; if (n2 === 0) pos += 2; else { v = 0; } } else pos++; }
        bitbuf = (bitbuf << 8) | v; bits += 8;
        bitbuf >>>= 0;
      }
    }
    var tl = []; for (ci = 0; ci < nf; ci++) tl.push(tabs[comps[ci].td] || tabs[0]);
    if (!tl[0]) return null;
    var init = 1 << (prec - pt - 1), mcu = 0, mask = 0xFFFF;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (dri && mcu && mcu % dri === 0) {
          /* restart marker: skip to it and reset the bit buffer */
          bits = 0; bitbuf = 0; while (pos < end && !(b[pos] === 0xFF && b[pos + 1] >= 0xD0 && b[pos + 1] <= 0xD7)) pos++; pos += 2;
        }
        for (ci = 0; ci < nf; ci++) {
          if (bits < 20) fill();
          var e = tl[ci][(bitbuf >>> (bits - 16)) & 0xFFFF], l = e >> 8, s = e & 255;
          if (!l) return null;
          bits -= l; var diff = 0;
          if (s) {
            if (s === 16) diff = 32768; else {
              if (bits < s) fill();
              diff = (bitbuf >>> (bits - s)) & ((1 << s) - 1); bits -= s;
              if (diff < (1 << (s - 1))) diff -= (1 << s) - 1;
            }
          }
          var o = y * rowLen + x * nf + ci, px;
          if (y === 0 || (dri && mcu % dri === 0)) px = (x === 0 || (dri && mcu % dri === 0)) ? init : out[o - nf];
          else if (x === 0) px = out[o - rowLen];
          else {
            var ra = out[o - nf], rb = out[o - rowLen], rc = out[o - rowLen - nf];
            switch (pred) { case 1: px = ra; break; case 2: px = rb; break; case 3: px = rc; break; case 4: px = ra + rb - rc; break; case 5: px = ra + ((rb - rc) >> 1); break; case 6: px = rb + ((ra - rc) >> 1); break; default: px = (ra + rb) >> 1; }
          }
          out[o] = ((px + diff) & mask);
        }
        mcu++;
      }
    }
    if (pt) for (i = 0; i < out.length; i++) out[i] <<= pt;
    return { width: w, height: h, nf: nf, prec: prec, data: out };
  };

  R.decodeBayer = function (b) {
    var le = b[0] === 0x49 && b[1] === 0x49;
    if (!(le || (b[0] === 0x4D && b[1] === 0x4D))) return { error: 'not a TIFF based file' };
    var ifd0 = readIfd(b, 0, u32(b, 4, le), le); if (!ifd0) return { error: 'unreadable' };
    var list = [ifd0], subs = ifd0[330] || [], i, c;
    for (i = 0; i < subs.length; i++) { var s = readIfd(b, 0, subs[i], le); if (s) list.push(s); }
    var cfa = null;
    function isSensor(d) { return d && d[262] && (d[262][0] === 32803 || (d[262][0] === 34892 && (d[277] || [1])[0] === 3)) && (d[273] || d[324]) && d[256] && d[257] && (d[256][0] > 600); }
    for (i = 0; i < list.length; i++) if (isSensor(list[i])) { cfa = list[i]; break; }
    if (!cfa) return { error: 'no sensor data' };
    var comp = (cfa[259] || [1])[0], bits = (cfa[258] || [16])[0], w = cfa[256][0], h = cfa[257][0];
    if (comp === 52546) return { error: 'jpegxl' };
    if (comp !== 1 && comp !== 7) return { error: 'compressed', comp: comp };
    var lin3 = cfa[262][0] === 34892, SP = lin3 ? 3 : 1;
    if (!lin3 && (!cfa[33422] || cfa[33422].length < 4)) return { error: 'no colour pattern' };
    if (cfa[33421] && (cfa[33421][0] !== 2 || cfa[33421][1] !== 2)) return { error: 'unusual pattern' };
    if (w * h > 120e6) return { error: 'too large' };
    var tiled = !!cfa[324], offs = tiled ? cfa[324] : cfa[273], cnts = tiled ? cfa[325] : cfa[279];
    if (!offs || !cnts) return { error: 'no strips' };
    var raw = new Uint16Array(w * h * SP), pos = 0, j, tw = tiled ? (cfa[322] || [w])[0] : w, th = tiled ? (cfa[323] || [h])[0] : ((cfa[278] || [h])[0]);
    var across = Math.ceil(w / tw);
    for (i = 0; i < offs.length; i++) {
      var tx = tiled ? (i % across) * tw : 0, ty = tiled ? Math.floor(i / across) * th : i * th, tdat, tcols, trows;
      if (ty >= h) break;
      if (comp === 7) {
        var dj = R.decodeLJ(b, offs[i], offs[i] + cnts[i]);
        if (!dj) return { error: 'compressed', comp: 7 };
        tdat = dj.data; tcols = dj.width * dj.nf; trows = dj.height;
      } else if (bits === 16) {
        tcols = tw * SP; trows = tiled ? th : Math.min(th, h - ty); tdat = new Uint16Array(tcols * trows);
        for (j = 0; j < tdat.length && j * 2 + 1 < cnts[i]; j++) tdat[j] = le ? b[offs[i] + j * 2] | (b[offs[i] + j * 2 + 1] << 8) : (b[offs[i] + j * 2] << 8) | b[offs[i] + j * 2 + 1];
      } else if (bits >= 8 && bits < 16) {
        tcols = tw * SP; trows = tiled ? th : Math.min(th, h - ty); tdat = new Uint16Array(tcols * trows);
        var bp = offs[i] * 8, rowBits = Math.ceil(tcols * bits / 8) * 8, rr0, cc0;
        for (rr0 = 0; rr0 < trows; rr0++) { var bpos = offs[i] * 8 + rr0 * rowBits; for (cc0 = 0; cc0 < tcols; cc0++) { var vv0 = 0, k0; for (k0 = 0; k0 < bits; k0++) { var bi = bpos + cc0 * bits + k0; vv0 = (vv0 << 1) | ((b[bi >> 3] >> (7 - (bi & 7))) & 1); } tdat[rr0 * tcols + cc0] = vv0; } }
      } else return { error: 'unsupported bit depth', bits: bits };
      var ry, rx, cw = Math.min(tcols, (w - tx) * SP);
      for (ry = 0; ry < trows && ty + ry < h; ry++) { var so = ry * tcols, dof = ((ty + ry) * w + tx) * SP; for (rx = 0; rx < cw; rx++) raw[dof + rx] = tdat[so + rx]; }
    }
    var pat = lin3 ? [0, 1, 1, 2] : cfa[33422].slice(0, 4); /* 0 red, 1 green, 2 blue */
    var wl = (ifd0[50717] || cfa[50717] || [65535])[0], bl = cfa[50714] || ifd0[50714] || [0], bld = cfa[50713] || ifd0[50713] || [1, 1];
    function blackAt(px, py) { var bw = bld[0] || 1, bh = bld[1] || 1, k2 = (py % bh) * bw + (px % bw); return bl.length ? (bl[k2 % bl.length] || 0) : 0; }
    var neutral = ifd0[50728] || cfa[50728], gains = [1, 1, 1];
    if (neutral && neutral.length >= 3 && neutral[0] > 0 && neutral[1] > 0 && neutral[2] > 0) gains = [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]];
    var cm = ifd0[50722] && (ifd0[50779] || [])[0] === 21 ? ifd0[50722] : (ifd0[50721] || ifd0[50722]);
    var wxy = ifd0[50729] || cfa[50729];
    if (!(neutral && neutral.length >= 3) && wxy && wxy.length >= 2 && wxy[1] > 0 && cm && cm.length >= 9) {
      var XYZ = [wxy[0] / wxy[1], 1, (1 - wxy[0] - wxy[1]) / wxy[1]], nn = [0, 1, 2].map(function (q) { return cm[q * 3] * XYZ[0] + cm[q * 3 + 1] * XYZ[1] + cm[q * 3 + 2] * XYZ[2]; });
      if (nn[0] > 0 && nn[1] > 0 && nn[2] > 0) gains = [nn[1] / nn[0], 1, nn[1] / nn[2]];
    }
    var toRgb = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (cm && cm.length >= 9) {
      var rgb2xyz = [0.412453, 0.357580, 0.180423, 0.212671, 0.715160, 0.072169, 0.019334, 0.119193, 0.950227];
      var camRgb = mul3(cm.slice(0, 9), rgb2xyz), r2;
      for (r2 = 0; r2 < 3; r2++) { var sm = camRgb[r2 * 3] + camRgb[r2 * 3 + 1] + camRgb[r2 * 3 + 2]; if (sm) for (c = 0; c < 3; c++) camRgb[r2 * 3 + c] /= sm; }
      var iv = inv3(camRgb); if (iv) toRgb = iv;
    }
    var F = w * h > 36e6 ? 4 : 2, W2 = Math.floor(w / F), H2 = Math.floor(h / F), lin = new Float32Array(W2 * H2 * 3), x, y, den = Math.max(1, wl - 0);
    for (y = 0; y < H2; y++) for (x = 0; x < W2; x++) {
      var acc = [0, 0, 0], cn = [0, 0, 0], dy, dx;
      for (dy = 0; dy < F; dy++) for (dx = 0; dx < F; dx++) {
        var px = x * F + dx, py = y * F + dy, ch = pat[(dy & 1) * 2 + (dx & 1)], v;
        if (lin3) { for (var cc = 0; cc < 3; cc++) { v = raw[(py * w + px) * 3 + cc] - blackAt(px, py); acc[cc] += v < 0 ? 0 : v; cn[cc]++; } }
        else { v = raw[py * w + px] - blackAt(px, py); acc[ch] += v < 0 ? 0 : v; cn[ch]++; }
      }
      var rr = acc[0] / Math.max(1, cn[0]), gg = acc[1] / Math.max(1, cn[1]), bb2 = acc[2] / Math.max(1, cn[2]);
      var span = Math.max(1, wl - (bl[0] || 0));
      rr = rr / span * gains[0]; gg = gg / span * gains[1]; bb2 = bb2 / span * gains[2];
      var o2 = (y * W2 + x) * 3;
      lin[o2] = toRgb[0] * rr + toRgb[1] * gg + toRgb[2] * bb2; lin[o2 + 1] = toRgb[3] * rr + toRgb[4] * gg + toRgb[5] * bb2; lin[o2 + 2] = toRgb[6] * rr + toRgb[7] * gg + toRgb[8] * bb2;
    }
    /* automatic exposure: put the 99.5th percentile of brightness near white */
    var hist = new Uint32Array(4096), np = W2 * H2, step = Math.max(1, (np / 200000) | 0), cntS = 0, k3;
    var hi = 0; for (k3 = 0; k3 < np; k3 += step) { var yv = 0.2126 * lin[k3 * 3] + 0.7152 * lin[k3 * 3 + 1] + 0.0722 * lin[k3 * 3 + 2]; if (yv > hi) hi = yv; }
    var top = Math.max(hi, 1e-6), bin = 4095 / top;
    for (k3 = 0; k3 < np; k3 += step) { var y2 = 0.2126 * lin[k3 * 3] + 0.7152 * lin[k3 * 3 + 1] + 0.0722 * lin[k3 * 3 + 2]; hist[Math.max(0, Math.min(4095, (y2 * bin) | 0))]++; cntS++; }
    var acc2 = 0, p995 = top; for (k3 = 4095; k3 >= 0; k3--) { acc2 += hist[k3]; if (acc2 >= cntS * 0.005) { p995 = (k3 + 1) / bin; break; } }
    var gain = Math.max(0.3, Math.min(20, 0.95 / Math.max(p995, 1e-6)));
    var out = new Uint8ClampedArray(np * 4), lut = new Uint8ClampedArray(4096);
    for (k3 = 0; k3 < 4096; k3++) { var l = k3 / 4095; var gm = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; gm = gm * 0.65 + (gm * gm * (3 - 2 * gm)) * 0.35; lut[k3] = Math.round(gm * 255); }
    for (k3 = 0; k3 < np; k3++) for (c = 0; c < 3; c++) { var vv = lin[k3 * 3 + c] * gain; out[k3 * 4 + c] = lut[vv <= 0 ? 0 : vv >= 1 ? 4095 : (vv * 4095 + 0.5) | 0]; out[k3 * 4 + 3] = 255; }
    return { width: W2, height: H2, scale: F, data: out, orient: R.tiffOrientation(b, 0) || 1 };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.RAWX = R;
})(typeof self !== 'undefined' ? self : this);
