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

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
