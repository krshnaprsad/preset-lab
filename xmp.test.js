const X = require('./xmp.js');
const crypto = require('crypto');
let pass = 0, fail = 0;
function ok(c, m) { if (c) pass++; else { fail++; console.log('FAIL', m); } }
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function pics(seed, fn, n = 20000) { const r = rng(seed), px = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const v = fn(r(), r()); px[i * 4] = v[0]; px[i * 4 + 1] = v[1]; px[i * 4 + 2] = v[2]; px[i * 4 + 3] = 255; } return px; }
function mean(px, c) { let s = 0; const n = px.length / 4; for (let i = 0; i < n; i++) s += px[i * 4 + c]; return s / n; }
function maxDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }
const uuid = () => X.uuid(crypto.randomBytes(16));

// curves
const idt = X.curveTable([[0, 0], [255, 255]]);
ok(Math.abs(idt[128] - 128 / 255) < 1e-6 && idt[0] === 0 && Math.abs(idt[255] - 1) < 1e-6, 'identity curve table');
const bent = X.curveTable([[0, 0], [64, 40], [192, 220], [255, 255]]);
let mono = true; for (let i = 1; i < 256; i++) if (bent[i] < bent[i - 1] - 1e-9) mono = false;
ok(mono, 'curve is monotone, no overshoot');
ok(Math.abs(bent[64] * 255 - 40) < 0.5 && Math.abs(bent[192] * 255 - 220) < 0.5, 'curve passes through its points');

// identity settings leave a picture alone
const photo = pics(1, (a, b) => [a * 255, b * 255, (a + b) * 127]);
ok(maxDiff(X.render(photo, X.identity()), photo) <= 1, 'identity settings render unchanged');

// writer: structure and validity
const S0 = X.identity(); S0.sat = 12; S0.hue[0] = -8; S0.bsat[3] = 15; S0.curve = [[0, 0], [64, 52], [128, 140], [255, 255]]; S0.curveR = [[0, 0], [128, 134], [255, 255]];
const txt = X.write(S0, { name: 'Test look', group: 'Zero3', uuid: uuid() });
const problems = X.validate(txt);
ok(problems.length === 0, 'valid preset: ' + problems.join('; '));
ok(/crs:Saturation="\+12"/.test(txt) && /crs:HueAdjustmentRed="-8"/.test(txt) && /crs:SaturationAdjustmentGreen="\+15"/.test(txt), 'signed values written like Lightroom');
ok(/<rdf:li xml:lang="x-default">Test look<\/rdf:li>/.test(txt) && /<rdf:li xml:lang="x-default">Zero3<\/rdf:li>/.test(txt), 'name and group written');
ok(/crs:ToneCurveName2012="Custom"/.test(txt), 'custom curve flagged');
ok(!/HueAdjustmentOrange/.test(txt), 'untouched settings are left out');
ok(X.write(X.identity(), { name: 'Flat', uuid: uuid() }).indexOf('ToneCurvePV2012') < 0, 'no curves when nothing changed');
ok(X.validate(X.write(X.identity(), { name: 'Flat', uuid: uuid() })).length === 0, 'empty preset still valid');
const tricky = X.write(S0, { name: 'A & B <"x">', uuid: uuid() });
ok(X.validate(tricky).length === 0 && /A &amp; B &lt;&quot;x&quot;&gt;/.test(tricky), 'names are escaped');

// validator catches damage
ok(X.validate(txt.replace('</rdf:Description>', '')).length > 0, 'unclosed tag caught');
ok(X.validate(txt.replace('crs:Saturation="+12"', 'crs:Saturation="+140"')).length > 0, 'out of range caught');
ok(X.validate(txt.replace('crs:PresetType="Normal"', '')).length > 0, 'missing preset type caught');
ok(X.validate(txt.replace(/<rdf:li>255, 255<\/rdf:li>/, '<rdf:li>255, 10</rdf:li>')).length > 0, 'backwards curve caught');
ok(X.validate(txt.replace(/crs:UUID="[0-9A-F]+"/, 'crs:UUID="xyz"')).length > 0, 'bad UUID caught');

// read back
const back = X.read(txt);
ok(back.sat === 12 && back.hue[0] === -8 && back.bsat[3] === 15, 'values read back');
ok(JSON.stringify(back.curve) === JSON.stringify(S0.curve) && JSON.stringify(back.curveR) === JSON.stringify(S0.curveR) && X.isIdentityCurve(back.curveG), 'curves read back');
ok(maxDiff(X.render(photo, S0), X.render(photo, back)) === 0, 'file gives the same picture as the settings');

// derive: a brighter, warmer, more colourful reference
const src = pics(3, (a, b) => { const v = 40 + a * 120; return [v, v * 0.95 + b * 10, v * 0.9]; });
const ref = pics(4, (a, b) => { const v = 90 + a * 150; return [Math.min(255, v * 1.12 + 10), v * 0.98, v * 0.78]; });
const D = X.derive(src, ref, { tone: 1, colour: 1, detail: 0.5, keepClean: false });
const out = X.render(src, D);
ok(Math.abs(mean(out, 0) - mean(ref, 0)) < Math.abs(mean(src, 0) - mean(ref, 0)) * 0.5, 'red channel moves toward the reference');
ok(Math.abs(mean(out, 2) - mean(ref, 2)) < Math.abs(mean(src, 2) - mean(ref, 2)) * 0.5, 'blue channel moves toward the reference');
const yOf = p => 0.2126 * mean(p, 0) + 0.7152 * mean(p, 1) + 0.0722 * mean(p, 2);
ok(Math.abs(yOf(out) - yOf(ref)) < 10 && yOf(out) > yOf(src) + 20, 'brightness moves toward the reference');
const warm = (p) => mean(p, 0) - mean(p, 2);
ok(warm(out) > warm(src) + 5, 'warmer, like the reference');
ok(X.validate(X.write(D, { name: 'Derived', uuid: uuid() })).length === 0, 'derived preset is valid');
const desc = X.describe(D); ok(desc.length >= 2 && desc.every(l => typeof l === 'string'), 'plain description');

// matching a picture with itself changes (almost) nothing
const Self = X.derive(photo, photo, { tone: 1, colour: 1, detail: 1, keepClean: true });
ok(Self.sat === 0, 'self match: no saturation change');
ok(maxDiff(X.render(photo, Self), photo) <= 6, 'self match: picture stays put');

// strength sliders really scale things
const weak = X.derive(src, ref, { tone: 0.2, colour: 0.2, detail: 0, keepClean: false });
ok(Math.abs(yOf(X.render(src, weak)) - yOf(src)) < Math.abs(yOf(out) - yOf(src)), 'lower strength moves less');
const clean = X.derive(src, ref, { tone: 1, colour: 1, detail: 0, keepClean: true });
ok(clean.curve[0][1] === 0 && clean.curve[clean.curve.length - 1][1] === 255, 'clean blacks and whites pinned');
ok(D.hue.every(v => Math.abs(v) <= 30) && D.bsat.every(v => Math.abs(v) <= 40) && Math.abs(D.sat) <= 60, 'values stay in safe ranges');


// manual adjustments
function adj(o) { const S = X.identity(); Object.assign(S, o); return S; }
const grey = pics(7, (a) => { const v = a * 255; return [v, v, v]; });
const dark = pics(8, (a) => { const v = a * 60; return [v, v, v]; }), light = pics(9, (a) => { const v = 195 + a * 60; return [v, v, v]; });
ok(mean(X.render(grey, adj({ exposure: 1 })), 1) > mean(grey, 1) + 20, 'exposure up brightens');
ok(mean(X.render(grey, adj({ exposure: -1 })), 1) < mean(grey, 1) - 20, 'exposure down darkens');
const cH = X.render(grey, adj({ contrast: 60 }));
ok(mean(X.render(dark, adj({ contrast: 60 })), 1) < mean(dark, 1) && mean(X.render(light, adj({ contrast: 60 })), 1) > mean(light, 1), 'contrast pushes darks down and lights up');
ok(mean(X.render(dark, adj({ shadows: 80 })), 1) > mean(dark, 1) + 5 && Math.abs(mean(X.render(light, adj({ shadows: 80 })), 1) - mean(light, 1)) < 3, 'shadows lift darks only');
ok(mean(X.render(light, adj({ highlights: -80 })), 1) < mean(light, 1) - 5 && Math.abs(mean(X.render(dark, adj({ highlights: -80 })), 1) - mean(dark, 1)) < 3, 'highlights pull lights only');
ok(mean(X.render(light, adj({ whites: 80 })), 1) >= mean(light, 1) && mean(X.render(dark, adj({ blacks: -80 })), 1) < mean(dark, 1), 'whites and blacks move their ends');
const warmed = X.render(grey, adj({ temp: 60 })); ok(mean(warmed, 0) > mean(warmed, 2) + 5, 'temperature up is warmer');
const tinted = X.render(grey, adj({ tint: 60 })); ok(mean(tinted, 1) < mean(tinted, 0) - 3, 'tint up is more magenta');
const dull = pics(10, () => [120, 110, 100]), vivid = pics(11, () => [230, 40, 30]);
const spread = (p) => Math.abs(mean(p, 0) - mean(p, 2));
ok(spread(X.render(dull, adj({ vibrance: 80 }))) / spread(dull) > spread(X.render(vivid, adj({ vibrance: 80 }))) / spread(vivid) + 0.15, 'vibrance helps dull colours more');
const all = adj({ exposure: 0.8, contrast: 15, highlights: -30, shadows: 25, whites: 10, blacks: -10, vibrance: 20, temp: 10, tint: -6, sat: 8, curve: [[0, 0], [100, 90], [255, 255]] });
const allBack = X.read(X.write(all, { name: 'x', uuid: uuid() }));
ok(maxDiff(X.render(photo, all), X.render(photo, allBack)) <= 1, 'manual settings survive the file round trip');
ok(X.validate(X.write(all, { name: 'x', uuid: uuid() })).length === 0, 'manual preset is valid');
ok(/crs:Exposure2012="\+0\.80"/.test(X.write(all, { name: 'x', uuid: uuid() })) && /crs:IncrementalTint="-6"/.test(X.write(all, { name: 'x', uuid: uuid() })), 'Adobe names used');
ok(X.validate(X.write(adj({ exposure: 0.5 }), { name: 'x', uuid: uuid() }).replace('+0.50', '+7.00')).length > 0, 'exposure out of range caught');
ok(X.validate(X.write(adj({ contrast: 30 }), { name: 'x', uuid: uuid() }).replace('"+30"', '"+300"')).length > 0, 'contrast out of range caught');
ok(maxDiff(X.render(photo, X.identity()), photo) <= 1, 'identity still untouched');

/* ---- built-in library ---- */
const fs = require('fs'), vm = require('vm');
const win = { PRESETS: [] }, ctx = vm.createContext({ window: win });
[1, 2, 3, 4].forEach((n) => vm.runInContext(fs.readFileSync(__dirname + '/presets-' + n + '.js', 'utf8'), ctx));
ok(win.PRESETS.length === 340, 'library has 340 presets (got ' + win.PRESETS.length + ')');
ok(new Set(win.PRESETS.map((p) => p.n)).size === 340, 'every library name is different');
ok(win.PRESETS.every((p) => !/[\u2014]/.test(p.n) && p.n.length <= 40), 'names are short and have no long dash');
let libBad = 0, libDiff = 0;
win.PRESETS.forEach((p) => {
  const S = X.fromPreset(p), t = X.write(S, { name: p.n, group: p.g, uuid: uuid(), copyright: p.k, contact: p.ci, cluster: p.cl });
  if (X.validate(t).length) libBad++;
  const B = X.read(t); if (maxDiff(X.render(photo, S, 64), X.render(photo, B, 64)) > 1) libDiff++;
  if (p.k && t.indexOf('crs:Copyright="' + p.k + '"') < 0) libBad++;
});
ok(libBad === 0, 'every library preset writes a valid file with its credit text kept');
ok(libDiff === 0, 'every library preset reads back to the same picture');
const lumP = X.render(photo, adj({ lum: [100, 100, 100, 100, 100, 100, 100, 100] }), 64); ok(maxDiff(lumP, photo) > 4, 'colour brightness bands change the picture');
const splitP = X.render(grey, Object.assign(X.identity(), { extra: { SplitToningShadowHue: 220, SplitToningShadowSaturation: 80 } }), 64); ok(mean(splitP, 2) > mean(splitP, 0) + 2, 'split toning runs');
const vigS = Object.assign(X.identity(), { extra: { PostCropVignetteAmount: -80 } });
const vg = X.render(pics(12, () => [200, 200, 200]), vigS, 64), vgi = vg.length / 4;
ok(vg[0] < vg[(156 * 64 + 32) * 4], 'vignette darkens the corners');

/* ---- RAW preview finder ---- */
const RW = require('./raw.js');
function fakeJpeg(size, extra) { const body = []; body.push(0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0); if (extra) { body.push(0xFF, 0xE1, (extra.length + 2) >> 8, (extra.length + 2) & 255); extra.forEach((v) => body.push(v)); } body.push(0xFF, 0xC0, 0, 11, 8, 0, 8, 0, 8, 1, 1, 0x11, 0, 0xFF, 0xDA, 0, 8, 1, 1, 0, 0, 63, 0); for (let i = 0; i < size; i++) body.push(i % 251 + 1 > 254 ? 7 : (i % 250) + 1, ...(i % 97 === 0 ? [0xFF, 0x00] : [])); body.push(0xFF, 0xD9); return body; }
const thumb = fakeJpeg(3000), big = fakeJpeg(60000, thumb), mid = fakeJpeg(40000);
const tiffHdr = [0x49, 0x49, 0x2A, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
const rawLike = new Uint8Array([...tiffHdr, ...new Array(500).fill(0x55), ...mid, ...new Array(300).fill(0xFF), ...big, ...new Array(100).fill(9)]);
const pk = RW.pick(rawLike);
ok(pk && pk.length === big.length, 'RAW finder picks the biggest preview and skips the thumbnail inside it');
ok(pk && pk.orient === 6, 'RAW finder reads the turn from the file header when the preview has none');
ok(RW.pick(new Uint8Array(5000).fill(3)) === null, 'RAW finder returns nothing for a file with no picture');
ok(RW.isRaw('IMG_1.CR3') && RW.isRaw('a.dng') && !RW.isRaw('photo.jpg'), 'RAW extensions recognised');

/* ---- strength and highlight safety ---- */
const bb = win.PRESETS.find((p) => p.n === 'Bright Blue Shadows'), bbS = X.fromPreset(bb);
ok(maxDiff(X.render(photo, X.scale(bbS, 0), 64), photo) <= 1, 'strength 0 gives back the original picture');
ok(X.scale(bbS, 1) === bbS, 'strength 100 leaves the preset as it is');
const half = X.scale(bbS, 0.5);
ok(half.hue.every((v, i) => v === Math.round(bbS.hue[i] * 0.5)) && Math.abs(half.exposure - bbS.exposure * 0.5) < 0.01, 'strength 50 halves the settings');
ok(X.validate(X.write(half, { name: 'x', uuid: uuid() })).length === 0, 'a reduced preset still writes a valid file');
const crv = X.fromPreset(win.PRESETS.find((p) => p.c && p.c.m)); const crvH = X.scale(crv, 0.5);
ok(crvH.curve.every((p, i) => i === 0 || p[1] >= crvH.curve[i - 1][1]), 'a reduced curve still never goes backwards');
const brightRow = new Uint8ClampedArray(256 * 4); for (let x = 0; x < 256; x++) { brightRow[x * 4] = 235 + x / 255 * 20; brightRow[x * 4 + 1] = 222 + x / 255 * 33; brightRow[x * 4 + 2] = 195 + x / 255 * 60; brightRow[x * 4 + 3] = 255; }
const bo = X.render(brightRow, bbS, 256), seen = new Set(); for (let x = 0; x < 256; x++) seen.add(bo[x * 4] + ',' + bo[x * 4 + 1] + ',' + bo[x * 4 + 2]);
ok(seen.size > 50, 'bright cream tones keep their detail instead of going flat (' + seen.size + ' different colours)');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
