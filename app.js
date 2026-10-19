(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var cv = $('cv'), ctx = cv.getContext('2d');
  var MAXW = 960;

  var st = { foot: null, ref: null, settings: null, graded: null, split: 0.5 };

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
  function setFoot(img, label) {
    st.foot = img; cv.width = img.width; cv.height = img.height;
    $('footNote').textContent = label; refresh();
  }

  /* ---------- the settings ---------- */
  function opts() { return { tone: +$('pTone').value, colour: +$('pColour').value, detail: +$('pDetail').value, keepClean: $('pClean').checked }; }
  function say(t, cls) { var m = $('msg'); m.textContent = t; m.className = 'msg' + (cls ? ' ' + cls : ''); }

  var pending = 0;
  function refresh() { if (pending) return; pending = requestAnimationFrame(function () { pending = 0; run(); }); }
  function run() {
    var ul = $('report'); ul.innerHTML = '';
    function row(level, label, text) {
      var li = document.createElement('li'); li.className = level;
      var k = document.createElement('span'); k.className = 'k'; k.textContent = label;
      var tx = document.createElement('span'); tx.textContent = text; li.appendChild(k); li.appendChild(tx); ul.appendChild(li);
    }
    if (!st.ref || !st.foot) {
      st.settings = null; st.graded = null; $('dl').disabled = true;
      $('empty').textContent = st.ref ? '' : 'Choose a reference photo to see the match.';
      row('info', 'Note', 'Choose a reference photo to see the settings.');
      draw(); return;
    }
    st.settings = XMP.derive(st.foot.data, st.ref.data, opts());
    st.graded = new ImageData(XMP.render(st.foot.data, st.settings), st.foot.width, st.foot.height);
    $('empty').textContent = ''; $('dl').disabled = false;
    var d = XMP.describe(st.settings);
    if (!d.length) row('ok', 'Note', 'These two photos already look alike, so the preset changes almost nothing.');
    d.forEach(function (t) { row('ok', 'Sets', t); });
    row('info', 'Leaves', 'Exposure, contrast, white balance, sharpening, masks, crop and profile stay as they are on the photo you apply it to.');
    draw();
  }

  var bufB = document.createElement('canvas'), bufA = document.createElement('canvas');
  function draw() {
    if (!st.foot) return;
    var w = st.foot.width, h = st.foot.height;
    bufB.width = bufA.width = w; bufB.height = bufA.height = h;
    bufB.getContext('2d').putImageData(st.foot, 0, 0);
    ctx.clearRect(0, 0, w, h); ctx.drawImage(bufB, 0, 0);
    var tl = document.querySelector('.tagl'), tr = document.querySelector('.tagr');
    if (st.graded) {
      bufA.getContext('2d').putImageData(st.graded, 0, 0);
      var sx = Math.round(w * st.split);
      ctx.drawImage(bufA, sx, 0, w - sx, h, sx, 0, w - sx, h);
      ctx.fillStyle = '#fff'; ctx.fillRect(sx - 1, 0, 2, h);
      ctx.beginPath(); ctx.arc(sx, h / 2, 14, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = '700 15px system-ui,Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('\u2194', sx, h / 2 + 1);
      tl.style.display = tr.style.display = '';
    } else tl.style.display = tr.style.display = 'none';
  }

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
  function loadFoot(f) { if (!f) return; readImage(f, MAXW).then(function (img) { setFoot(img, 'Your photo: ' + f.name); }).catch(function (e) { say(e.message, 'err'); }); }
  var stage = $('stage');
  ['dragenter', 'dragover'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.add('drop'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.remove('drop'); }); });
  stage.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) loadFoot(f); });

  $('refBtn').onclick = function () { $('refFile').click(); };
  $('refFile').onchange = function () {
    var f = $('refFile').files[0]; $('refFile').value = ''; if (!f) return;
    readImage(f, 600).then(function (img) {
      st.ref = img;
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

  window.PRESET_STATE = st; // for checking in the console
  setFoot(sampleImage(), 'Showing the sample picture. Drop an image here, or use the button.');
})();
