/* Preset Lab - pure logic, no browser code, so Node can test it.
   Reads two pictures, works out Lightroom / Camera Raw settings that move one toward the other,
   renders those settings for the preview, and writes and reads the .xmp preset file. */
(function (root) {
  'use strict';
  var X = {};
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  X.clamp = clamp;

  /* ---------- colour maths (OKLab) ---------- */
  function toLinExact(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toGamExact(c) { c = clamp(c, 0, 1); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  /* Lookup tables with interpolation: the same maths, much faster per pixel. */
  var TN = 8192, LIN = new Float32Array(TN + 2), GAM = new Float32Array(TN + 2);
  for (var ti = 0; ti <= TN + 1; ti++) { LIN[ti] = toLinExact(Math.min(1, ti / TN)); GAM[ti] = toGamExact(Math.min(1, ti / TN)); }
  function toLin(c) { c = c < 0 ? 0 : c > 1 ? 1 : c; var x = c * TN, i = x | 0, f = x - i; return LIN[i] + (LIN[i + 1] - LIN[i]) * f; }
  function toGam(c) { c = c < 0 ? 0 : c > 1 ? 1 : c; var x = c * TN, i = x | 0, f = x - i; return GAM[i] + (GAM[i + 1] - GAM[i]) * f; }
  function rgbToLab(r, g, b, o) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
      m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  }
  function labToRgb(L, a, b, o) {
    var l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.2914855480 * b;
    l = l * l * l; m = m * m * m; s = s * s * s;
    o[0] = toGam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
    o[1] = toGam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
    o[2] = toGam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  }

  /* ---------- the colour bands of the HSL panel ---------- */
  X.BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  var CENTRES = [29, 60, 105, 142, 195, 264, 300, 335];  // hue angles in OKLab degrees
  /* Two neighbouring bands share each hue, their weights add up to 1. */
  function bandWeights(h, w) {
    var i, j, d, t, k;
    h = ((h % 360) + 360) % 360;
    for (k = 0; k < 8; k++) w[k] = 0;
    for (i = 0; i < 8; i++) {
      j = (i + 1) % 8;
      d = ((CENTRES[j] - CENTRES[i]) + 360) % 360;
      t = ((h - CENTRES[i]) + 360) % 360;
      if (t <= d) { t = t / d; t = t * t * (3 - 2 * t); w[i] = 1 - t; w[j] = t; return; }
    }
  }

  /* ---------- settings ---------- */
  X.curveIdentity = function () { return [[0, 0], [255, 255]]; };
  X.identity = function () {
    return { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, temp: 0, tint: 0, sat: 0, hue: [0, 0, 0, 0, 0, 0, 0, 0], bsat: [0, 0, 0, 0, 0, 0, 0, 0], curve: X.curveIdentity(), curveR: X.curveIdentity(), curveG: X.curveIdentity(), curveB: X.curveIdentity(), lum: [0, 0, 0, 0, 0, 0, 0, 0], extra: {} };
  };
  /* Settings that are kept and written, with their file names. Signed ones are written with + or -. */
  X.EXTRA_SIGNED = ['Texture', 'Clarity2012', 'Dehaze', 'ShadowTint', 'RedHue', 'RedSaturation', 'GreenHue', 'GreenSaturation', 'BlueHue', 'BlueSaturation'];
  X.EXTRA_PLAIN = ['SplitToningShadowHue', 'SplitToningShadowSaturation', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'SplitToningBalance',
    'ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights', 'ParametricShadowSplit', 'ParametricMidtoneSplit', 'ParametricHighlightSplit',
    'GrainAmount', 'GrainSize', 'GrainFrequency', 'PostCropVignetteAmount', 'PostCropVignetteMidpoint', 'PostCropVignetteFeather', 'PostCropVignetteRoundness', 'PostCropVignetteStyle', 'PostCropVignetteHighlightContrast'];
  var EXTRA_DEF = { ParametricShadowSplit: 25, ParametricMidtoneSplit: 50, ParametricHighlightSplit: 75, PostCropVignetteMidpoint: 50, PostCropVignetteFeather: 50, GrainSize: 25, GrainFrequency: 50, PostCropVignetteStyle: 1 };
  /* Turn a library preset ({v: file values, c: curves}) into settings. */
  X.fromPreset = function (p) {
    var S = X.identity(), v = p.v || {};
    S.exposure = v.Exposure2012 || 0; S.contrast = v.Contrast2012 || 0; S.highlights = v.Highlights2012 || 0; S.shadows = v.Shadows2012 || 0;
    S.whites = v.Whites2012 || 0; S.blacks = v.Blacks2012 || 0; S.vibrance = v.Vibrance || 0; S.sat = v.Saturation || 0;
    S.temp = v.IncrementalTemperature || 0; S.tint = v.IncrementalTint || 0;
    X.BANDS.forEach(function (n, i) { S.hue[i] = v['HueAdjustment' + n] || 0; S.bsat[i] = v['SaturationAdjustment' + n] || 0; S.lum[i] = v['LuminanceAdjustment' + n] || 0; });
    X.EXTRA_SIGNED.concat(X.EXTRA_PLAIN).forEach(function (k) { if (v[k] !== undefined) S.extra[k] = v[k]; });
    var c = p.c || {};
    if (c.m) S.curve = c.m.map(function (q) { return q.slice(); });
    if (c.r) S.curveR = c.r.map(function (q) { return q.slice(); });
    if (c.g) S.curveG = c.g.map(function (q) { return q.slice(); });
    if (c.b) S.curveB = c.b.map(function (q) { return q.slice(); });
    return S;
  };
  function ex(S, k) { var v = S.extra && S.extra[k]; return v === undefined ? (EXTRA_DEF[k] || 0) : v; }
  function hsv2rgb(h, o) { h = ((h % 360) + 360) % 360 / 60; var f = h - Math.floor(h), i = Math.floor(h) % 6, q = 1 - f; var t = [[1, f, 0], [q, 1, 0], [0, 1, f], [0, q, 1], [f, 0, 1], [1, 0, q]][i]; o[0] = t[0]; o[1] = t[1]; o[2] = t[2]; }
  function isIdCurve(c) { return c.length === 2 && c[0][0] === 0 && c[0][1] === 0 && c[1][0] === 255 && c[1][1] === 255; }
  X.isIdentityCurve = isIdCurve;

  /* A smooth curve through the points that never overshoots (monotone cubic), as a 256 entry table. */
  X.curveTable = function (pts) {
    var n = pts.length, i, t = new Float32Array(256), xs = [], ys = [], dx = [], m = [], d = [];
    for (i = 0; i < n; i++) { xs.push(pts[i][0]); ys.push(pts[i][1]); }
    for (i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / dx[i]); }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    var seg = 0;
    for (var x = 0; x < 256; x++) {
      if (x <= xs[0]) { t[x] = ys[0] / 255; continue; }
      if (x >= xs[n - 1]) { t[x] = ys[n - 1] / 255; continue; }
      while (seg < n - 2 && x > xs[seg + 1]) seg++;
      var h = dx[seg], u = (x - xs[seg]) / h, u2 = u * u, u3 = u2 * u;
      var v = (2 * u3 - 3 * u2 + 1) * ys[seg] + (u3 - 2 * u2 + u) * h * m[seg] + (-2 * u3 + 3 * u2) * ys[seg + 1] + (u3 - u2) * h * m[seg + 1];
      t[x] = clamp(v, 0, 255) / 255;
    }
    return t;
  };
  function look(t, v) { var x = clamp(v, 0, 1) * 255, i = Math.min(254, Math.floor(x)), f = x - i; return t[i] + (t[i + 1] - t[i]) * f; }

  /* ---------- render: apply the settings to pixels (RGBA bytes) ---------- */
  function ss01(a, b, x) { var u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); }
  X.render = function (px, S, width) {
    var out = new Uint8ClampedArray(px.length), n = px.length / 4, w = [0, 0, 0, 0, 0, 0, 0, 0], lab = [0, 0, 0], rgb = [0, 0, 0];
    var LU = S.lum || [0, 0, 0, 0, 0, 0, 0, 0], useLum = LU.some(function (v) { return v !== 0; });
    var useColour = S.sat !== 0 || useLum || S.hue.some(function (v) { return v !== 0; }) || S.bsat.some(function (v) { return v !== 0; });
    var PS = ex(S, 'ParametricShadows') / 100, PD = ex(S, 'ParametricDarks') / 100, PL = ex(S, 'ParametricLights') / 100, PH = ex(S, 'ParametricHighlights') / 100;
    var sp1 = ex(S, 'ParametricShadowSplit') / 100, sp2 = ex(S, 'ParametricMidtoneSplit') / 100, sp3 = ex(S, 'ParametricHighlightSplit') / 100;
    var usePar = PS || PD || PL || PH, cS = sp1 / 2, cD = (sp1 + sp2) / 2, cL = (sp2 + sp3) / 2, cH = (sp3 + 1) / 2;
    var stSh = ex(S, 'SplitToningShadowSaturation') / 100, stHi = ex(S, 'SplitToningHighlightSaturation') / 100, useSplit = stSh > 0 || stHi > 0;
    var cSh = [0, 0, 0], cHi = [0, 0, 0], pivot = 0.5 + ex(S, 'SplitToningBalance') / 200;
    if (useSplit) { hsv2rgb(ex(S, 'SplitToningShadowHue'), cSh); hsv2rgb(ex(S, 'SplitToningHighlightHue'), cHi); cSh = cSh.map(function (x) { return x - (0.2126 * cSh[0] + 0.7152 * cSh[1] + 0.0722 * cSh[2]); }); cHi = cHi.map(function (x) { return x - (0.2126 * cHi[0] + 0.7152 * cHi[1] + 0.0722 * cHi[2]); }); }
    var vAmt = ex(S, 'PostCropVignetteAmount') / 100, useVig = !!width && vAmt !== 0, vMid = ex(S, 'PostCropVignetteMidpoint') / 100, vFe = ex(S, 'PostCropVignetteFeather') / 100;
    var vH = width ? n / width : 1, vA0 = vMid * 0.9, vA1 = vA0 + vFe * 0.7 + 0.05;
    var tm = X.curveTable(S.curve), tr = X.curveTable(S.curveR), tg = X.curveTable(S.curveG), tb = X.curveTable(S.curveB);
    var gs = 1 + S.sat / 100, i, k, r, g, b;
    var flat = !useLum && S.hue.every(function (v) { return v === 0; }) && S.bsat.every(function (v) { return v === 0; });
    var E = S.exposure || 0, CO = (S.contrast || 0) / 100, HI = (S.highlights || 0) / 100, SH = (S.shadows || 0) / 100, WH = (S.whites || 0) / 100, BL = (S.blacks || 0) / 100;
    var VI = (S.vibrance || 0) / 100, TE = (S.temp || 0) / 100, TI = (S.tint || 0) / 100;
    var useWB = E !== 0 || TE !== 0 || TI !== 0, useTone = CO || HI || SH || WH || BL || usePar, useVib = VI !== 0;
    var gE = Math.pow(2, E), gR = gE * Math.pow(2, 0.5 * TE), gB = gE * Math.pow(2, -0.5 * TE), gG = gE * Math.pow(2, -0.3 * TI);
    for (i = 0; i < n; i++) {
      r = px[i * 4] / 255; g = px[i * 4 + 1] / 255; b = px[i * 4 + 2] / 255;
      if (useWB) { r = toGam(toLin(r) * gR); g = toGam(toLin(g) * gG); b = toGam(toLin(b) * gB); }
      if (useTone) {
        var Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, dY = 0;
        dY += SH * 0.35 * (1 - Y) * (1 - Y) * Math.min(1, Y * 6);
        dY += HI * 0.3 * Y * Y * Math.min(1, (1 - Y) * 6);
        dY += WH * 0.2 * ss01(0.55, 1, Y);
        dY += BL * 0.2 * (1 - ss01(0, 0.45, Y));
        dY -= CO * 0.16 * Math.sin(2 * Math.PI * Y);
        if (usePar) { var gz = function (c) { var z = (Y - c) / 0.17; return Math.exp(-z * z); }; dY += 0.16 * (PS * gz(cS) + PD * gz(cD) + PL * gz(cL) + PH * gz(cH)); }
        r = clamp(r + dY, 0, 1); g = clamp(g + dY, 0, 1); b = clamp(b + dY, 0, 1);
      }
      if (useVib) {
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b), sv = mx > 0 ? (mx - mn) / mx : 0, bo = VI * (1 - sv) * 0.8, me = (r + g + b) / 3;
        r = clamp(r + (r - me) * bo, 0, 1); g = clamp(g + (g - me) * bo, 0, 1); b = clamp(b + (b - me) * bo, 0, 1);
      }
      if (useColour && flat) {
        rgbToLab(r, g, b, lab);
        labToRgb(lab[0], lab[1] * gs, lab[2] * gs, rgb); r = rgb[0]; g = rgb[1]; b = rgb[2];
      } else if (useColour) {
        rgbToLab(r, g, b, lab);
        var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
        if (C > 1e-5) {
          var h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI, dh = 0, f = 0;
          bandWeights(h, w);
          var dl = 0; for (k = 0; k < 8; k++) { dh += w[k] * S.hue[k]; f += w[k] * (1 + S.bsat[k] / 100); dl += w[k] * LU[k]; }
          lab[0] = clamp(lab[0] + dl * 0.0022, 0, 1);
          var C2 = C * gs * f, h2 = (h + dh * 0.3) * Math.PI / 180;
          labToRgb(lab[0], C2 * Math.cos(h2), C2 * Math.sin(h2), rgb); r = rgb[0]; g = rgb[1]; b = rgb[2];
        }
      }
      r = look(tr, look(tm, r)); g = look(tg, look(tm, g)); b = look(tb, look(tm, b));
      if (useSplit) {
        var Y2 = 0.2126 * r + 0.7152 * g + 0.0722 * b, wh2 = ss01(pivot - 0.3, pivot + 0.3, Y2), ws = (1 - wh2) * stSh * 0.3, wi = wh2 * stHi * 0.3;
        r = clamp(r + cSh[0] * ws + cHi[0] * wi, 0, 1); g = clamp(g + cSh[1] * ws + cHi[1] * wi, 0, 1); b = clamp(b + cSh[2] * ws + cHi[2] * wi, 0, 1);
      }
      if (useVig) {
        var px_ = i % width, py_ = (i - px_) / width, dx = (px_ + 0.5) / width * 2 - 1, dy = (py_ + 0.5) / vH * 2 - 1, dd = Math.sqrt((dx * dx + dy * dy) / 2), vt = ss01(vA0, vA1, dd);
        if (vAmt < 0) { var vf = 1 + vAmt * vt * 0.9; r *= vf; g *= vf; b *= vf; } else { var vw = vAmt * vt * 0.7; r += (1 - r) * vw; g += (1 - g) * vw; b += (1 - b) * vw; }
      }
      out[i * 4] = Math.round(r * 255);
      out[i * 4 + 1] = Math.round(g * 255);
      out[i * 4 + 2] = Math.round(b * 255);
      out[i * 4 + 3] = px[i * 4 + 3];
    }
    return out;
  };

  /* ---------- work out the settings ---------- */
  function sampleStats(px, step) {
    var n = px.length / 4, w = [0, 0, 0, 0, 0, 0, 0, 0], lab = [0, 0, 0], i, k, cnt = 0, sumC = 0;
    var bw = [], bc = [], bx = [], by = [];
    for (k = 0; k < 8; k++) { bw.push(0); bc.push(0); bx.push(0); by.push(0); }
    for (i = 0; i < n; i += step) {
      rgbToLab(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255, lab);
      if (lab[0] < 0.1 || lab[0] > 0.95) continue;
      var C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]); cnt++; sumC += C;
      if (C < 0.02) continue;
      var h = Math.atan2(lab[2], lab[1]);
      bandWeights(h * 180 / Math.PI, w);
      for (k = 0; k < 8; k++) { bw[k] += w[k]; bc[k] += w[k] * C; bx[k] += w[k] * C * Math.cos(h); by[k] += w[k] * C * Math.sin(h); }
    }
    return { n: cnt, meanC: cnt ? sumC / cnt : 0, bw: bw, bc: bc, bx: bx, by: by };
  }
  function circDiff(a, b) { var d = ((a - b) % 360 + 540) % 360 - 180; return d; }
  function lumaHist(px) {
    var h = new Float64Array(256), n = px.length / 4, i;
    for (i = 0; i < n; i++) h[Math.round(0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2])]++;
    for (i = 0; i < 256; i++) h[i] /= n;
    return h;
  }
  function cdf(h) { var c = new Float64Array(256), s = 0; for (var i = 0; i < 256; i++) { s += h[i]; c[i] = s; } return c; }
  var TONE_X = [0, 16, 32, 64, 96, 128, 160, 192, 224, 240, 255];

  function toneCurve(a, ref, opts) {
    var ca = cdf(lumaHist(a)), cr = cdf(lumaHist(ref)), f = new Float64Array(256), v, u = 0;
    for (v = 0; v < 256; v++) { while (u < 255 && cr[u] < ca[v]) u++; f[v] = u; }
    var sm = new Float64Array(256), R = 5, j;
    for (v = 0; v < 256; v++) { var s = 0, c = 0; for (j = -R; j <= R; j++) { var q = v + j; if (q < 0 || q > 255) continue; s += f[q]; c++; } sm[v] = s / c; }
    var pts = [], prev = 0;
    TONE_X.forEach(function (x) {
      var y = x + opts.tone * (sm[x] - x);
      if (opts.keepClean && (x === 0 || x === 255)) y = x;
      y = clamp(Math.round(y), 0, 255); if (y < prev) y = prev; prev = y; pts.push([x, y]);
    });
    return pts;
  }
  function castCurves(b, ref, opts) {
    function zoneMeans(px) {
      var z = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], n = px.length / 4, i, y, k;
      for (i = 0; i < n; i++) {
        y = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]; k = y < 85 ? 0 : y < 170 ? 1 : 2;
        z[k][0] += px[i * 4]; z[k][1] += px[i * 4 + 1]; z[k][2] += px[i * 4 + 2]; z[k][3]++;
      }
      return z.map(function (q) { return { n: q[3] / n, m: q[3] ? [q[0] / q[3], q[1] / q[3], q[2] / q[3]] : [0, 0, 0] }; });
    }
    var zb = zoneMeans(b), zr = zoneMeans(ref), centres = [48, 128, 208], res = [[], [], []], zi, c;
    var off = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (zi = 0; zi < 3; zi++) {
      if (zb[zi].n < 0.02 || zr[zi].n < 0.02) continue;
      var d = [0, 1, 2].map(function (cc) { return zr[zi].m[cc] - zb[zi].m[cc]; }), avg = (d[0] + d[1] + d[2]) / 3;
      for (c = 0; c < 3; c++) off[zi][c] = clamp((d[c] - avg) * opts.colour, -22, 22);
    }
    for (c = 0; c < 3; c++) {
      var pts = [[0, 0]], prev = 0;
      for (zi = 0; zi < 3; zi++) { var y = clamp(Math.round(centres[zi] + off[zi][c]), 0, 255); if (y < prev) y = prev; prev = y; pts.push([centres[zi], y]); }
      pts.push([255, 255]); res[c] = pts;
    }
    return res;
  }

  /* opts: tone, colour, detail (all 0 to 1), keepClean (bool). Returns the settings. */
  X.derive = function (src, ref, opts) {
    opts = opts || {};
    var o = { tone: opts.tone == null ? 0.8 : opts.tone, colour: opts.colour == null ? 0.7 : opts.colour, detail: opts.detail == null ? 0.5 : opts.detail, keepClean: opts.keepClean !== false };
    var S = X.identity(), k;
    var ss = sampleStats(src, 3), rs = sampleStats(ref, 3);
    if (ss.n > 50 && rs.n > 50 && ss.meanC > 1e-4) {
      S.sat = Math.round(clamp((rs.meanC / ss.meanC - 1) * 100 * o.colour, -60, 60));
    }
    var a1 = X.render(src, S);
    if (o.detail > 0) {
      var s1 = sampleStats(a1, 3);
      for (k = 0; k < 8; k++) {
        var ms = s1.bw[k] / Math.max(1, s1.n), mr = rs.bw[k] / Math.max(1, rs.n);
        if (ms < 0.03 || mr < 0.03) continue;
        var cs = s1.bc[k] / s1.bw[k], cr = rs.bc[k] / rs.bw[k];
        S.bsat[k] = Math.round(clamp((cr / cs - 1) * 100 * 0.5 * o.detail, -40, 40));
        var hs = Math.atan2(s1.by[k], s1.bx[k]) * 180 / Math.PI, hr = Math.atan2(rs.by[k], rs.bx[k]) * 180 / Math.PI;
        S.hue[k] = Math.round(clamp(circDiff(hr, hs) / 30 * 100 * 0.5 * o.detail, -30, 30));
      }
    }
    var a = X.render(src, S);
    S.curve = toneCurve(a, ref, o);
    var b = X.render(src, S);
    var cc = castCurves(b, ref, o);
    S.curveR = cc[0]; S.curveG = cc[1]; S.curveB = cc[2];
    return S;
  };

  /* Plain words for what is in the preset. */
  X.describe = function (S) {
    var out = [];
    if (!isIdCurve(S.curve)) out.push('Tone curve with ' + S.curve.length + ' points (light and dark balance)');
    if (!isIdCurve(S.curveR) || !isIdCurve(S.curveG) || !isIdCurve(S.curveB)) out.push('Red, green and blue curves (colour tint in shadows, mids and highlights)');
    function adj(label, v, d) { if (v) out.push(label + ' ' + (v > 0 ? '+' : '') + (d ? v.toFixed(d) : v)); }
    adj('Exposure', S.exposure, 2); adj('Contrast', S.contrast); adj('Highlights', S.highlights); adj('Shadows', S.shadows); adj('Whites', S.whites); adj('Blacks', S.blacks);
    adj('Temperature (relative)', S.temp); adj('Tint (relative)', S.tint); adj('Vibrance', S.vibrance);
    if (S.sat) out.push('Saturation ' + (S.sat > 0 ? '+' : '') + S.sat);
    var bands = [];
    X.BANDS.forEach(function (nm, i) {
      var p = [];
      if (S.hue[i]) p.push('hue ' + (S.hue[i] > 0 ? '+' : '') + S.hue[i]);
      if (S.bsat[i]) p.push('saturation ' + (S.bsat[i] > 0 ? '+' : '') + S.bsat[i]);
      if (p.length) bands.push(nm + ' ' + p.join(', '));
    });
    if (bands.length) out.push('Colour mixer: ' + bands.join('; '));
    var lb = [];
    X.BANDS.forEach(function (nm, i) { if (S.lum && S.lum[i]) lb.push(nm + ' ' + (S.lum[i] > 0 ? '+' : '') + S.lum[i]); });
    if (lb.length) out.push('Colour brightness: ' + lb.join('; '));
    var E = S.extra || {};
    if (E.SplitToningShadowSaturation || E.SplitToningHighlightSaturation) out.push('Split toning (colour in the shadows and highlights)');
    if (E.ParametricShadows || E.ParametricDarks || E.ParametricLights || E.ParametricHighlights) out.push('Parametric curve (shadows, darks, lights, highlights)');
    if (E.PostCropVignetteAmount) out.push('Vignette ' + (E.PostCropVignetteAmount > 0 ? '+' : '') + E.PostCropVignetteAmount);
    if (E.Clarity2012) out.push('Clarity ' + (E.Clarity2012 > 0 ? '+' : '') + E.Clarity2012);
    if (E.Texture) out.push('Texture ' + (E.Texture > 0 ? '+' : '') + E.Texture);
    if (E.Dehaze) out.push('Dehaze ' + (E.Dehaze > 0 ? '+' : '') + E.Dehaze);
    if (E.GrainAmount) out.push('Grain ' + E.GrainAmount);
    if (E.RedHue || E.RedSaturation || E.GreenHue || E.GreenSaturation || E.BlueHue || E.BlueSaturation || E.ShadowTint) out.push('Calibration (primary colours)');
    return out;
  };

  /* ---------- the .xmp file ---------- */
  var XMPTK = 'Adobe XMP Core 5.6-c140 79.160451, 2017/05/06-01:08:21';
  function sgn(v) { return (v > 0 ? '+' : '') + v; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  X.uuid = function (bytes) { var s = ''; for (var i = 0; i < 16; i++) s += ('0' + (bytes[i] & 255).toString(16)).slice(-2); return s.toUpperCase(); };
  function curveXml(tag, pts) {
    return '   <crs:' + tag + '>\n    <rdf:Seq>\n' + pts.map(function (p) { return '     <rdf:li>' + p[0] + ', ' + p[1] + '</rdf:li>'; }).join('\n') + '\n    </rdf:Seq>\n   </crs:' + tag + '>\n';
  }
  function alt(tag, text) {
    return '   <crs:' + tag + '>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">' + esc(text) + '</rdf:li>\n    </rdf:Alt>\n   </crs:' + tag + '>\n';
  }
  /* meta: {name, group, uuid} */
  X.write = function (S, meta) {
    var name = meta.name || 'Preset Lab look', attrs = [
      'crs:PresetType="Normal"', 'crs:Cluster="' + esc(meta.cluster || '') + '"', 'crs:UUID="' + meta.uuid + '"', 'crs:SupportsAmount="False"', 'crs:SupportsColor="True"',
      'crs:SupportsMonochrome="True"', 'crs:SupportsHighDynamicRange="True"', 'crs:SupportsNormalDynamicRange="True"', 'crs:SupportsSceneReferred="True"',
      'crs:SupportsOutputReferred="True"', 'crs:CameraModelRestriction=""', 'crs:Copyright="' + esc(meta.copyright || '') + '"', 'crs:ContactInfo="' + esc(meta.contact || '') + '"', 'crs:Version="11.1"', 'crs:ProcessVersion="11.0"'
    ];
    if (S.temp) attrs.push('crs:IncrementalTemperature="' + sgn(S.temp) + '"');
    if (S.tint) attrs.push('crs:IncrementalTint="' + sgn(S.tint) + '"');
    if (S.vibrance) attrs.push('crs:Vibrance="' + sgn(S.vibrance) + '"');
    if (S.exposure) attrs.push('crs:Exposure2012="' + (S.exposure > 0 ? '+' : '') + S.exposure.toFixed(2) + '"');
    if (S.contrast) attrs.push('crs:Contrast2012="' + sgn(S.contrast) + '"');
    if (S.highlights) attrs.push('crs:Highlights2012="' + sgn(S.highlights) + '"');
    if (S.shadows) attrs.push('crs:Shadows2012="' + sgn(S.shadows) + '"');
    if (S.whites) attrs.push('crs:Whites2012="' + sgn(S.whites) + '"');
    if (S.blacks) attrs.push('crs:Blacks2012="' + sgn(S.blacks) + '"');
    if (S.sat) attrs.push('crs:Saturation="' + sgn(S.sat) + '"');
    X.BANDS.forEach(function (n, i) { if (S.hue[i]) attrs.push('crs:HueAdjustment' + n + '="' + sgn(S.hue[i]) + '"'); });
    X.BANDS.forEach(function (n, i) { if (S.bsat[i]) attrs.push('crs:SaturationAdjustment' + n + '="' + sgn(S.bsat[i]) + '"'); });
    X.BANDS.forEach(function (n, i) { if (S.lum && S.lum[i]) attrs.push('crs:LuminanceAdjustment' + n + '="' + sgn(S.lum[i]) + '"'); });
    X.EXTRA_SIGNED.forEach(function (k) { var v = S.extra && S.extra[k]; if (v) attrs.push('crs:' + k + '="' + sgn(v) + '"'); });
    X.EXTRA_PLAIN.forEach(function (k) { var v = S.extra && S.extra[k]; if (v !== undefined && v !== (EXTRA_DEF[k] || 0)) attrs.push('crs:' + k + '="' + v + '"'); });
    var curves = !isIdCurve(S.curve) || !isIdCurve(S.curveR) || !isIdCurve(S.curveG) || !isIdCurve(S.curveB);
    if (curves) attrs.push('crs:ToneCurveName2012="Custom"');
    attrs.push('crs:HasSettings="True"');
    var s = '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="' + XMPTK + '">\n <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n  <rdf:Description rdf:about=""\n    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"\n' +
      attrs.map(function (a) { return '   ' + a; }).join('\n') + '>\n';
    s += alt('Name', name) + alt('ShortName', '') + alt('SortName', '') + alt('Group', meta.group || '') + alt('Description', meta.description || 'Made with Preset Lab by Zero3');
    if (curves) {
      s += curveXml('ToneCurvePV2012', S.curve) + curveXml('ToneCurvePV2012Red', S.curveR) + curveXml('ToneCurvePV2012Green', S.curveG) + curveXml('ToneCurvePV2012Blue', S.curveB);
    }
    s += '  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n';
    return s;
  };

  /* Read a preset written by write() (or a similar Lightroom preset) back into settings. Settings it does not know are ignored. */
  X.read = function (text) {
    var S = X.identity(), m;
    function num(name) { var r = new RegExp('crs:' + name + '="([-+]?[0-9.]+)"').exec(text); return r ? parseFloat(r[1]) : 0; }
    S.sat = num('Saturation'); S.vibrance = num('Vibrance'); S.temp = num('IncrementalTemperature'); S.tint = num('IncrementalTint');
    S.exposure = num('Exposure2012'); S.contrast = num('Contrast2012'); S.highlights = num('Highlights2012'); S.shadows = num('Shadows2012'); S.whites = num('Whites2012'); S.blacks = num('Blacks2012');
    X.BANDS.forEach(function (n, i) { S.hue[i] = num('HueAdjustment' + n); S.bsat[i] = num('SaturationAdjustment' + n); });
    X.BANDS.forEach(function (n, i) { S.lum[i] = num('LuminanceAdjustment' + n); });
    X.EXTRA_SIGNED.concat(X.EXTRA_PLAIN).forEach(function (k) { var r = new RegExp('crs:' + k + '="([-+]?[0-9.]+)"').exec(text); if (r) S.extra[k] = parseFloat(r[1]); });
    function curve(tag) {
      var r = new RegExp('<crs:' + tag + '>\\s*<rdf:Seq>([\\s\\S]*?)</rdf:Seq>').exec(text);
      if (!r) return X.curveIdentity();
      var pts = [], re = /<rdf:li>\s*(\d+)\s*,\s*(\d+)\s*<\/rdf:li>/g;
      while ((m = re.exec(r[1]))) pts.push([+m[1], +m[2]]);
      return pts.length >= 2 ? pts : X.curveIdentity();
    }
    S.curve = curve('ToneCurvePV2012'); S.curveR = curve('ToneCurvePV2012Red'); S.curveG = curve('ToneCurvePV2012Green'); S.curveB = curve('ToneCurvePV2012Blue');
    return S;
  };

  /* Check a preset file against the published Camera Raw schema and the layout Lightroom writes. Returns a list of problems (empty is good). */
  X.validate = function (text) {
    var p = [], m;
    if (/\u2014/.test(text)) p.push('contains a long dash');
    if (!/^<x:xmpmeta xmlns:x="adobe:ns:meta\/"/.test(text)) p.push('does not start with x:xmpmeta');
    if (!/xmlns:rdf="http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#"/.test(text)) p.push('missing the RDF namespace');
    if (!/xmlns:crs="http:\/\/ns\.adobe\.com\/camera-raw-settings\/1\.0\/"/.test(text)) p.push('missing the Camera Raw namespace');
    if (!/crs:PresetType="Normal"/.test(text)) p.push('PresetType is not Normal');
    if (!/crs:UUID="[0-9A-F]{32}"/.test(text)) p.push('UUID is not 32 hex characters');
    if (!/crs:ProcessVersion="11\.0"/.test(text)) p.push('missing ProcessVersion');
    var tagRe = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g, stack = [];
    var stripped = text.replace(/<\?[\s\S]*?\?>/g, '');
    var rest = stripped.replace(tagRe, function (all, close, name, at, self, off) {
      if (self) return ''; if (close) { var top = stack.pop(); if (top !== name) p.push('tag ' + name + ' closes ' + top); } else stack.push(name); return '';
    });
    if (stack.length) p.push('unclosed tag ' + stack[stack.length - 1]);
    if (/[<>]/.test(rest)) p.push('stray angle bracket');
    var ranges = /crs:(Saturation|Vibrance|IncrementalTemperature|IncrementalTint|Contrast2012|Highlights2012|Shadows2012|Whites2012|Blacks2012|HueAdjustment\w+|SaturationAdjustment\w+|LuminanceAdjustment\w+|Texture|Clarity2012|Dehaze)="([^"]*)"/g;
    while ((m = ranges.exec(text))) { var v = Number(m[2]); if (!/^[-+]?\d+$/.test(m[2]) || v < -100 || v > 100) p.push(m[1] + ' is out of range: ' + m[2]); }
    var ex = /crs:Exposure2012="([^"]*)"/.exec(text);
    if (ex && (!/^[-+]?\d+(\.\d+)?$/.test(ex[1]) || Math.abs(Number(ex[1])) > 5)) p.push('Exposure2012 is out of range: ' + ex[1]);
    var cur = /<crs:(ToneCurvePV2012\w*)>\s*<rdf:Seq>([\s\S]*?)<\/rdf:Seq>/g;
    while ((m = cur.exec(text))) {
      var pts = [], re = /<rdf:li>\s*(\d+)\s*,\s*(\d+)\s*<\/rdf:li>/g, q;
      while ((q = re.exec(m[2]))) pts.push([+q[1], +q[2]]);
      if (pts.length < 2) { p.push(m[1] + ' has fewer than 2 points'); continue; }
      for (var i = 0; i < pts.length; i++) {
        if (pts[i][0] > 255 || pts[i][1] > 255) p.push(m[1] + ' has a point above 255');
        if (i && pts[i][0] <= pts[i - 1][0]) p.push(m[1] + ' x values are not rising');
        if (i && pts[i][1] < pts[i - 1][1]) p.push(m[1] + ' goes backwards');
      }
    }
    return p;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = X; else root.XMP = X;
})(typeof self !== 'undefined' ? self : this);
