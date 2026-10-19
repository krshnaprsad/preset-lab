(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d');
  var MAXW = 960;

  var st = { proxy: null, fast: false, fid: 0, derivedKey: '', derived: null, curveOv: null, man: {}, file: null, foot: null, ref: null, settings: null, graded: null, split: 0.5 };

  /* ---------- images ---------- */
  function toImageData(bmp, maxW) {
    var w = bmp.width, h = bmp.height, s = Math.min(1, maxW / w);
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, c.width, c.height);
    return x.getImageData(0, 0, c.width, c.height);
  }
  function readImage(file, maxW) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { try { res(toImageData(im, maxW)); } catch (e) { rej(e); } URL.revokeObjectURL(url); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That file did not open as a picture.')); };
      im.src = url;
    });
  }
  function sampleImage() {
    var c = document.createElement('canvas'); c.width = MAXW; c.height = 540;
    var x = c.getContext('2d'), g;
    g = x.createLinearGradient(0, 0, 0, 330); g.addColorStop(0, '#3d6fb0'); g.addColorStop(0.7, '#a9c4d8'); g.addColorStop(1, '#e8d2b0');
    x.fillStyle = g; x.fillRect(0, 0, MAXW, 330);
    g = x.createLinearGradient(0, 330, 0, 540); g.addColorStop(0, '#5d7a45'); g.addColorStop(1, '#2a3a24');
    x.fillStyle = g; x.fillRect(0, 330, MAXW, 210);
    x.fillStyle = '#f3efe6'; x.beginPath(); x.ellipse(220, 120, 110, 36, 0, 0, 7); x.fill(); x.beginPath(); x.ellipse(310, 105, 80, 28, 0, 0, 7); x.fill();
    x.fillStyle = '#6a6f78'; x.beginPath(); x.moveTo(520, 330); x.lineTo(700, 150); x.lineTo(900, 330); x.fill();
    var skins = ['#f1c9a8', '#d9a47c', '#b57a52', '#8a5636', '#5e3a24'];
    for (var i = 0; i < 5; i++) { x.fillStyle = skins[i]; x.beginPath(); x.arc(90 + i * 72, 400, 30, 0, 7); x.fill(); }
    var cols = ['#e03a3a', '#e8872f', '#e8d93a', '#3fb856', '#2fb6c8', '#3a63e0', '#9a4be0', '#e04bb0'];
    for (i = 0; i < 8; i++) { x.fillStyle = cols[i]; x.fillRect(470 + i * 56, 380, 50, 46); }
    for (i = 0; i < 12; i++) { var v = Math.round(i / 11 * 255); x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(470 + i * 37, 444, 37, 70); }
    x.fillStyle = '#000'; x.fillRect(40, 456, 360, 58);
    x.fillStyle = '#fff'; x.font = '700 28px system-ui,Arial'; x.fillText('Sample frame', 60, 496);
    return x.getImageData(0, 0, c.width, c.height);
  }
  function makeProxy(img) {
    var w = Math.min(img.width, 480), h = Math.max(1, Math.round(img.height * w / img.width));
    if (w === img.width) return img;
    var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0);
    var d = document.createElement('canvas'); d.width = w; d.height = h; var x = d.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h); return x.getImageData(0, 0, w, h);
  }
  function setFoot(img, label, file) {
    st.fid++; st.file = file || null; st.foot = img; st.proxy = makeProxy(img); cv.width = img.width; cv.height = img.height;
    $('footNote').textContent = label; refresh();
  }

  /* ---------- the settings ---------- */
  function opts() { return { tone: +$('pTone').value, colour: +$('pColour').value, detail: +$('pDetail').value, keepClean: $('pClean').checked }; }
  function say(t, cls) { var m = $('msg'); m.textContent = t; m.className = 'msg' + (cls ? ' ' + cls : ''); }

  var pending = 0, idleT = 0;
  function refresh(fastOk) {
    clearTimeout(idleT);
    if (fastOk) { st.fast = true; idleT = setTimeout(function () { st.fast = false; run(); }, 180); } else st.fast = false;
    if (pending) return; pending = requestAnimationFrame(function () { pending = 0; run(); });
  }
  function run() {
    var ul = $('report'); ul.innerHTML = '';
    function row(level, label, text) {
      var li = document.createElement('li'); li.className = level;
      var k = document.createElement('span'); k.className = 'k'; k.textContent = label;
      var tx = document.createElement('span'); tx.textContent = text; li.appendChild(k); li.appendChild(tx); ul.appendChild(li);
    }
    if (!st.foot) { st.settings = null; st.graded = null; $('dl').disabled = true; $('dlPic').disabled = true; draw(); return; }
    var o = opts(), key = st.fid + '|' + JSON.stringify(o) + '|' + (st.ref ? 1 : 0);
    if (key !== st.derivedKey) { st.fast = false; st.derived = st.ref ? XMP.derive(st.foot.data, st.ref.data, o) : XMP.identity(); st.derivedKey = key; }
    var S = JSON.parse(JSON.stringify(st.derived));
    TUNE.forEach(function (t) { var v = st.man[t.id] || 0; if (t.id === 'sat') S.sat = Math.max(-100, Math.min(100, S.sat + v)); else S[t.id] = v; });
    if (st.curveOv) S.curve = st.curveOv.map(function (p) { return p.slice(); });
    st.settings = S;
    var srcImg = (st.fast && key === st.derivedKey && st.proxy) ? st.proxy : st.foot;
    st.graded = new ImageData(XMP.render(srcImg.data, S), srcImg.width, srcImg.height);
    var d = XMP.describe(S), any = d.length > 0;
    $('empty').textContent = (!st.ref && !any) ? 'Choose a reference photo, or move a slider, to see the change.' : '';
    $('dl').disabled = !any; $('dlPic').disabled = !any;
    drawCurve();
    if (!any) row('info', 'Note', st.ref ? 'These two photos already look alike, so the preset changes almost nothing.' : 'Nothing set yet. Choose a reference photo or move a slider.');
    var d = XMP.describe(st.settings);
    d.forEach(function (t) { row('ok', 'Sets', t); });
    row('info', 'Leaves', 'Anything not listed above (sharpening, noise, masks, crop, profile, Color Grading wheels) stays as it is on the photo you apply it to.');
    draw();
  }

  var bufB = document.createElement('canvas'), bufA = document.createElement('canvas');
  function draw() {
    if (!st.foot) return;
    var w = st.foot.width, h = st.foot.height;
    bufB.width = w; bufB.height = h;
    bufB.getContext('2d').putImageData(st.foot, 0, 0);
    ctx.clearRect(0, 0, w, h); ctx.drawImage(bufB, 0, 0);
    var tl = document.querySelector('.tagl'), tr = document.querySelector('.tagr');
    if (st.graded) {
      var sx = Math.round(w * st.split), sc = st.graded.width / w;
      bufA.width = st.graded.width; bufA.height = st.graded.height; bufA.getContext('2d').putImageData(st.graded, 0, 0);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bufA, sx * sc, 0, (w - sx) * sc, h * sc, sx, 0, w - sx, h);
      ctx.fillStyle = '#fff'; ctx.fillRect(sx - 1, 0, 2, h);
      ctx.beginPath(); ctx.arc(sx, h / 2, 14, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = '700 15px system-ui,Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('\u2194', sx, h / 2 + 1);
      tl.style.display = tr.style.display = '';
    } else tl.style.display = tr.style.display = 'none';
  }

  /* ---------- fine tune sliders ---------- */
  var TUNE = [
    { id: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, d: 2 },
    { id: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
    { id: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
    { id: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
    { id: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
    { id: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
    { id: 'temp', label: 'Temperature', min: -100, max: 100, step: 1 },
    { id: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
    { id: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1 },
    { id: 'sat', label: 'Saturation', min: -100, max: 100, step: 1 }
  ];
  (function buildTune() {
    var box = $('tune');
    TUNE.forEach(function (t) {
      var lab = document.createElement('label'); lab.className = 'rng';
      var sp = document.createElement('span'); sp.textContent = t.label;
      var inp = document.createElement('input'); inp.type = 'range'; inp.min = t.min; inp.max = t.max; inp.step = t.step; inp.value = 0; inp.id = 'm_' + t.id;
      var val = document.createElement('span'); val.id = 'mv_' + t.id; val.textContent = '0';
      function show() { var v = +inp.value; val.textContent = (v > 0 ? '+' : '') + (t.d ? v.toFixed(t.d) : v); }
      inp.oninput = function () { st.man[t.id] = +inp.value; show(); refresh(true); };
      inp.ondblclick = function () { inp.value = 0; st.man[t.id] = 0; show(); refresh(); };
      lab.appendChild(sp); lab.appendChild(inp); lab.appendChild(val); box.appendChild(lab);
    });
    $('tuneReset').onclick = function () {
      TUNE.forEach(function (t) { st.man[t.id] = 0; $('m_' + t.id).value = 0; $('mv_' + t.id).textContent = '0'; }); refresh();
    };
  })();

  /* ---------- curve editor (light and dark balance) ---------- */
  var cc = $('curveCv'), cx = cc.getContext('2d'), CS = cc.width, dragI = -1;
  function curPts() { return st.curveOv || (st.settings ? st.settings.curve : XMP.curveIdentity()); }
  function drawCurve() {
    cx.fillStyle = '#0b0b0b'; cx.fillRect(0, 0, CS, CS);
    cx.strokeStyle = '#222'; cx.lineWidth = 1;
    for (var g = 1; g < 4; g++) { cx.beginPath(); cx.moveTo(g * CS / 4, 0); cx.lineTo(g * CS / 4, CS); cx.moveTo(0, g * CS / 4); cx.lineTo(CS, g * CS / 4); cx.stroke(); }
    var pts = curPts(), t = XMP.curveTable(pts);
    cx.strokeStyle = '#f2f2f2'; cx.lineWidth = 2; cx.beginPath();
    for (var i = 0; i < 256; i++) { var X0 = i / 255 * CS, Y0 = CS - t[i] * CS; if (i) cx.lineTo(X0, Y0); else cx.moveTo(X0, Y0); }
    cx.stroke();
    pts.forEach(function (p, k) { cx.beginPath(); cx.arc(p[0] / 255 * CS, CS - p[1] / 255 * CS, k === dragI ? 6 : 4.5, 0, 7); cx.fillStyle = '#fff'; cx.fill(); cx.strokeStyle = '#000'; cx.lineWidth = 1.5; cx.stroke(); });
    $('curveNote').textContent = st.curveOv ? 'Curve edited by hand. Match sliders no longer change it.' : (st.ref ? 'Curve from the match. Drag a point to change it.' : 'Drag a point or click the line to add one.');
    $('curveReset').hidden = !st.curveOv;
  }
  function cpos(e) { var r = cc.getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(255, (e.clientX - r.left) / r.width * 255))), Math.round(Math.max(0, Math.min(255, 255 - (e.clientY - r.top) / r.height * 255)))]; }
  function fixMono(pts, i) {
    // keep x between neighbours and y never going backwards
    if (i > 0 && i < pts.length - 1) {
      pts[i][0] = Math.max(pts[i - 1][0] + 1, Math.min(pts[i + 1][0] - 1, pts[i][0]));
    } else pts[i][0] = i === 0 ? 0 : 255;
    var lo = i > 0 ? pts[i - 1][1] : 0, hi = i < pts.length - 1 ? pts[i + 1][1] : 255;
    pts[i][1] = Math.max(lo, Math.min(hi, pts[i][1]));
  }
  cc.addEventListener('pointerdown', function (e) {
    var p = cpos(e), pts = curPts().map(function (q) { return q.slice(); }), best = -1, bd = 14;
    pts.forEach(function (q, k) { var d = Math.hypot((q[0] - p[0]) * cc.getBoundingClientRect().width / 255, (q[1] - p[1]) * cc.getBoundingClientRect().height / 255); if (d < bd) { bd = d; best = k; } });
    if (best < 0) {
      var k2 = 0; while (k2 < pts.length && pts[k2][0] < p[0]) k2++;
      if (k2 === 0 || k2 >= pts.length || pts[k2][0] === p[0] || pts[k2 - 1][0] === p[0]) return;
      pts.splice(k2, 0, p); best = k2;
    }
    dragI = best; st.curveOv = pts; cc.setPointerCapture(e.pointerId); fixMono(pts, best); refresh(true);
  });
  cc.addEventListener('pointermove', function (e) {
    if (dragI < 0 || !st.curveOv) return; var p = cpos(e); st.curveOv[dragI] = p; fixMono(st.curveOv, dragI); refresh();
  });
  cc.addEventListener('pointerup', function () { dragI = -1; refresh(); });
  cc.addEventListener('dblclick', function (e) {
    var p = cpos(e), pts = curPts().map(function (q) { return q.slice(); });
    for (var k = 1; k < pts.length - 1; k++) if (Math.hypot(pts[k][0] - p[0], pts[k][1] - p[1]) < 12) { pts.splice(k, 1); st.curveOv = pts; refresh(); return; }
  });
  $('curveReset').onclick = function () { st.curveOv = null; refresh(); };

  /* ---------- compare handle ---------- */
  var dragging = false;
  function moveSplit(e) { var r = cv.getBoundingClientRect(); st.split = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)); draw(); }
  cv.addEventListener('pointerdown', function (e) { dragging = true; cv.setPointerCapture(e.pointerId); moveSplit(e); });
  cv.addEventListener('pointermove', function (e) { if (dragging) moveSplit(e); });
  cv.addEventListener('pointerup', function () { dragging = false; });

  /* ---------- inputs ---------- */
  $('footBtn').onclick = function () { $('footFile').click(); };
  $('footFile').onchange = function () { loadFoot($('footFile').files[0]); $('footFile').value = ''; };
  $('sampleBtn').onclick = function () { setFoot(sampleImage(), 'Showing the sample picture. Drop an image here, or use the button.'); };
  function loadFoot(f) { if (!f) return; readImage(f, MAXW).then(function (img) { setFoot(img, 'Your photo: ' + f.name, f); }).catch(function (e) { say(e.message, 'err'); }); }
  var stage = $('stage');
  ['dragenter', 'dragover'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.add('drop'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.remove('drop'); }); });
  stage.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) loadFoot(f); });

  $('refBtn').onclick = function () { $('refFile').click(); };
  $('refFile').onchange = function () {
    var f = $('refFile').files[0]; $('refFile').value = ''; if (!f) return;
    readImage(f, 600).then(function (img) {
      st.ref = img; st.fid++;
      var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0);
      var t = $('refThumb'); t.src = c.toDataURL('image/jpeg', 0.8); t.hidden = false;
      $('refBtn').textContent = 'Change reference photo'; refresh();
    }).catch(function (e) { say(e.message, 'err'); });
  };
  [['pTone', 'pToneVal'], ['pColour', 'pColourVal'], ['pDetail', 'pDetailVal']].forEach(function (p) {
    $(p[0]).oninput = function () { $(p[1]).textContent = (+$(p[0]).value).toFixed(2); refresh(); };
  });
  $('pClean').onchange = refresh;

  /* ---------- export ---------- */
  function cleanName() { return ($('name').value || 'Preset Lab look').replace(/[^\w\- .]/g, '').trim() || 'Preset Lab look'; }
  function cleanGroup() { return ($('group').value || '').replace(/[^\w\- .]/g, '').trim(); }
  $('dl').onclick = function () {
    if (!st.settings) return;
    var bytes = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(bytes);
    var text = XMP.write(st.settings, { name: cleanName(), group: cleanGroup(), uuid: XMP.uuid(bytes) });
    var problems = XMP.validate(text);
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) problems.push('the browser could not read it as XML');
    var back = XMP.read(text), a = XMP.render(st.foot.data, st.settings), b = XMP.render(st.foot.data, back), m = 0;
    for (var i = 0; i < a.length; i++) { var d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
    if (m > 1) problems.push('the file gives a different picture from the preview (largest difference ' + m + ' of 255)');
    if (problems.length) { say('Not saved. ' + problems.join('; ') + '.', 'err'); return; }
    say('Saved. Check passed: the file is valid XML in the Camera Raw layout and reads back to the same picture as the preview.', 'ok');
    var url = URL.createObjectURL(new Blob([text], { type: 'application/rdf+xml' })), a2 = document.createElement('a');
    a2.href = url; a2.download = cleanName() + '.xmp'; document.body.appendChild(a2); a2.click(); a2.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  /* ---------- export the edited picture ---------- */
  var MAX_PIXELS = 60e6;
  function picSay(t, cls) { var m = $('picMsg'); m.textContent = t; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  function fullImage() {
    if (!st.file) return Promise.resolve(st.foot);
    return readImage(st.file, 1e9);
  }
  $('dlPic').onclick = function () {
    if (!st.settings) return;
    var btn = $('dlPic'); btn.disabled = true; picSay('Working on the full size picture...');
    var settings = st.settings, fmt = $('picFmt').value, base = cleanName();
    setTimeout(function () {
      fullImage().then(function (img) {
        if (img.width * img.height > MAX_PIXELS) throw new Error('That photo is too large to edit in the browser (over 60 megapixels). Use a smaller export of it.');
        var out = new ImageData(XMP.render(img.data, settings), img.width, img.height);
        var c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').putImageData(out, 0, 0);
        return new Promise(function (res, rej) {
          c.toBlob(function (b) { b ? res({ blob: b, w: img.width, h: img.height }) : rej(new Error('The browser could not make the picture file.')); }, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 1);
        });
      }).then(function (r) {
        var url = URL.createObjectURL(r.blob), a = document.createElement('a');
        a.href = url; a.download = base + ' edited.' + fmt; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        picSay('Saved ' + r.w + ' x ' + r.h + ' ' + fmt.toUpperCase() + '. This is the tool\'s own preview, so Lightroom may differ slightly.', 'ok');
      }).catch(function (e) { picSay(e.message || 'Could not save the picture.', 'err'); }).then(function () { btn.disabled = !st.settings; });
    }, 30);
  };

  window.PRESET_STATE = st; // for checking in the console
  setFoot(sampleImage(), 'Showing the sample picture. Drop an image here, or use the button.');
})();
