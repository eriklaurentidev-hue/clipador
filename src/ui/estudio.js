/* Clipador · Estúdio: abas, pop-up de apoio, Capas e Postagens.
   Arquivo ÚNICO usado pelo programa do PC (src/ui/estudio.js) e pelo app online
   (copiado pra online/site/app/estudio.js pelo gerar-site.mjs). Edite só aqui. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var primeiroEmoji = function (t) { var m = String(t || '').match(/(\p{Extended_Pictographic})/u); return m ? m[1] : ''; };
  var semEmoji = function (t) { return String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim(); };

  // ---------- abas ----------
  document.querySelectorAll('[data-secao]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-secao]').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      ['Videos', 'Capas', 'Posts'].forEach(function (n) { if ($('sec' + n)) $('sec' + n).hidden = n !== b.dataset.secao; });
      if (b.dataset.secao === 'Capas') { listarClipesCapa(); desenharCapa(); }
      if (b.dataset.secao === 'Posts') { listarClipesPost(); pintarPosts(); }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
  function grupo(id, cb) { $(id).addEventListener('click', function (e) { var b = e.target.closest('[aria-pressed]'); if (!b) return; this.querySelectorAll('[aria-pressed]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); cb(b); }); }
  var clipes = function () { return window.__clipesGerados || []; };

  // ================= APOIO (pop-up depois que os clipes ficam prontos) =================
  var APOIO = { r8: 'https://pay.cakto.com.br/5ws9rqq_1363888', r15: 'https://pay.cakto.com.br/r5a725i_1363906', r20: 'https://pay.cakto.com.br/bp5cbqc_1363919' };
  function popApoio() {
    try { if (sessionStorage.getItem('clipador.apoio.visto')) return; sessionStorage.setItem('clipador.apoio.visto', '1'); } catch (_) {}
    var f = document.createElement('div'); f.className = 'fundo-modal'; f.setAttribute('role', 'dialog'); f.setAttribute('aria-modal', 'true');
    f.innerHTML = '<div class="modal"><button class="fechar" type="button" aria-label="Fechar">×</button><div style="font-size:40px">💜</div>' +
      '<h2>Seus clipes ficaram prontos!</h2><p>O Clipador é grátis e vai continuar grátis. Se ele te economizou tempo, ajude a manter e melhorar:</p>' +
      '<div class="valores"><a target="_blank" rel="noopener" href="' + APOIO.r8 + '"><b>R$ 8</b><small>um café</small></a>' +
      '<a class="dest" target="_blank" rel="noopener" href="' + APOIO.r20 + '"><b>R$ 20</b><small>por mês · mais ajuda</small></a>' +
      '<a target="_blank" rel="noopener" href="' + APOIO.r15 + '"><b>R$ 15</b><small>um lanche</small></a></div>' +
      '<button class="btn peq agora-nao" type="button">Agora não</button><p class="dica" style="margin:12px 0 0">Nenhuma função é bloqueada pra quem não apoia.</p></div>';
    var fechar = function () { f.remove(); };
    f.addEventListener('click', function (e) { if (e.target === f || e.target.closest('.fechar, .agora-nao')) fechar(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(f);
  }
  window.addEventListener('clipador-pronto', popApoio);
  // Capas e Postagens estão em BETA: selo no título + pedido de apoio pra acelerar as melhorias.
  [['secCapas', 'Capas em teste: cada apoio acelera rosto recortado com IA, mais estilos e capa animada.'],
   ['secPosts', 'Postagens em teste: com apoio, a próxima etapa é postar sozinho no TikTok, Reels e Shorts.']].forEach(function (x) {
    var sec = $(x[0]); if (!sec) return;
    var h1 = sec.querySelector('h1'); if (h1 && !h1.querySelector('.beta')) { var b = document.createElement('span'); b.className = 'beta'; b.textContent = 'BETA'; h1.appendChild(document.createTextNode(' ')); h1.appendChild(b); }
    var av = document.createElement('div'); av.className = 'aviso'; av.style.margin = '0 0 16px'; av.style.alignItems = 'center';
    av.innerHTML = '<span style="font-size:20px">🧪</span><span style="flex:1"></span><button class="btn peq pri" type="button">💜 Apoiar</button>';
    av.querySelector('span:nth-child(2)').textContent = x[1];
    av.querySelector('button').addEventListener('click', function () { try { sessionStorage.removeItem('clipador.apoio.visto'); } catch (_) {} popApoio(); });
    var sub = sec.querySelector('.sub'); if (sub) sub.after(av);
  });
  window.__popApoio = popApoio; // teste

  // ================= CAPAS =================
  var C = { img: null, rosto: null, formato: 'yt', estilo: 'impacto', cor: '#ffe14d', texto: '', paleta: [] };
  var tela = $('capaTela'), cx = tela.getContext('2d');
  function carregarImagem(src) { return new Promise(function (ok, falha) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = falha; i.src = src; }); }
  function listarClipesCapa() {
    var box = $('capaClipes'); box.innerHTML = '';
    clipes().filter(function (c) { return c.quadro; }).forEach(function (c, k) {
      var im = document.createElement('img'); im.src = c.quadro; im.alt = c.titulo; im.title = c.titulo;
      im.addEventListener('click', async function () { box.querySelectorAll('img').forEach(function (x) { x.classList.toggle('sel', x === im); });
        C.img = await carregarImagem(c.quadro); C.rosto = c.rosto; C.emoji = primeiroEmoji(c.titulo); if (!$('capaTexto').value) { $('capaTexto').value = semEmoji(c.gancho || c.titulo).toUpperCase(); C.texto = $('capaTexto').value; } desenharCapa(); });
      box.appendChild(im);
      if (k === 0 && !C.img) im.click();
    });
    $('capaSemClipes').textContent = box.children.length ? 'Ou envie outra imagem:' : 'Gere clipes na aba Vídeos pra usar o momento deles, ou envie uma imagem:';
  }
  window.addEventListener('clipador-clipe', function () { if (!$('secCapas').hidden) listarClipesCapa(); });
  $('capaImagem').addEventListener('change', async function () { var f = this.files[0]; if (!f) return; C.img = await carregarImagem(URL.createObjectURL(f)); C.rosto = null; desenharCapa(); });

  // Referência: tira as cores fortes da capa do canal (só as cores; a imagem não é usada).
  $('capaRef').addEventListener('change', async function () {
    var f = this.files[0]; if (!f) return; var u = URL.createObjectURL(f); $('capaRefMini').src = u; $('capaRefMini').hidden = false; usarReferencia(await carregarImagem(u));
  });
  $('capaPuxar').addEventListener('click', async function () {
    var b = this, link = $('capaLinkRef').value.trim(); if (!link) return; b.disabled = true; b.textContent = 'Puxando…';
    try {
      var r = await fetch('/api/capa?url=' + encodeURIComponent(link)); var j = await r.json();
      if (!r.ok || j.erro) throw new Error(j.erro || 'Não consegui puxar a capa.');
      var bytes = window.ClipadorHls ? await window.ClipadorHls.buscar(j.capa, 'bytes')
        : new Uint8Array(await (await fetch('/api/imagem?u=' + encodeURIComponent(j.capa))).arrayBuffer());
      var u = URL.createObjectURL(new Blob([bytes]));
      $('capaRefMini').src = u; $('capaRefMini').hidden = false; usarReferencia(await carregarImagem(u));
      if (!C.img) { C.img = await carregarImagem(u); C.rosto = null; } // sem clipe ainda: a própria capa vira a base pra recriar
      desenharCapa();
    } catch (e) { alert(e.message || String(e)); }
    b.disabled = false; b.textContent = 'Puxar capa';
  });
  function usarReferencia(im) {
    var c2 = document.createElement('canvas'); c2.width = 96; c2.height = 54; var k = c2.getContext('2d', { willReadFrequently: true }); k.drawImage(im, 0, 0, 96, 54);
    var px = k.getImageData(0, 0, 96, 54).data, caixas = {};
    for (var i = 0; i < px.length; i += 4) {
      var r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
      if (mx < 60) continue;
      var chave = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5), c = caixas[chave] || (caixas[chave] = { r: 0, g: 0, b: 0, n: 0, peso: 0 });
      c.r += r; c.g += g; c.b += b; c.n++; c.peso += 0.3 + sat * 1.7;
    }
    var lista = Object.keys(caixas).map(function (ch) { var c = caixas[ch]; return { r: c.r / c.n, g: c.g / c.n, b: c.b / c.n, peso: c.peso }; }).sort(function (a, b) { return b.peso - a.peso; });
    var hex = function (c) { return '#' + [c.r, c.g, c.b].map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join(''); };
    var escolhidas = []; lista.forEach(function (c) { if (escolhidas.length < 6 && escolhidas.every(function (e) { return Math.abs(e.r - c.r) + Math.abs(e.g - c.g) + Math.abs(e.b - c.b) > 90; })) escolhidas.push(c); });
    var pal = $('paleta'); pal.innerHTML = '';
    escolhidas.forEach(function (c, n) { var i = document.createElement('i'); i.style.background = hex(c); i.title = hex(c); i.addEventListener('click', function () { $('capaCor').value = hex(c); C.cor = hex(c); desenharCapa(); }); pal.appendChild(i); });
    // destaque = a cor mais "viva" da referência
    var viva = escolhidas.slice().sort(function (a, b) { var s = function (c) { var mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return (mx - mn) + mx * 0.2; }; return s(b) - s(a); })[0];
    if (viva) { $('capaCor').value = hex(viva); C.cor = hex(viva); }
    C.paleta = escolhidas.map(hex);
    desenharCapa();
  }
  $('capaTexto').addEventListener('input', function () { C.texto = this.value; desenharCapa(); });
  $('capaCor').addEventListener('input', function () { C.cor = this.value; desenharCapa(); });
  $('capaRosto').addEventListener('change', desenharCapa); $('capaSeta').addEventListener('change', desenharCapa);
  grupo('capaFormato', function (b) { C.formato = b.dataset.cf; desenharCapa(); });
  grupo('capaEstilo', function (b) { C.estilo = b.dataset.ce; desenharCapa(); });

  function cobrirImg(img, sx, sy, sw, sh, aw, ah) {
    var ra = aw / ah; if (sw / sh > ra) { var nw = sh * ra; sx += (sw - nw) / 2; sw = nw; } else { var nh = sw / ra; sy += (sh - nh) / 2; sh = nh; }
    return [sx, sy, sw, sh];
  }
  function quebrarTexto(cx, t, max, tam) {
    cx.font = '900 ' + tam + 'px "Arial Black", system-ui, sans-serif'; var ps = t.split(/\s+/), linhas = [], at = '';
    ps.forEach(function (p) { var x = at ? at + ' ' + p : p; if (cx.measureText(x).width > max && at) { linhas.push(at); at = p; } else at = x; }); if (at) linhas.push(at);
    return linhas;
  }
  function desenharCapa() { renderCapa({ img: C.img, rosto: C.rosto, formato: C.formato, estilo: C.estilo, cor: C.cor, texto: C.texto, emoji: C.emoji, comRosto: $('capaRosto').checked, comSeta: $('capaSeta').checked, espelho: false }, tela); }
  // Texto de capa: curto e forte. Mais de 5 palavras não se lê numa miniatura.
  function textoDeCapa(t) {
    var ws = semEmoji(t || 'O MOMENTO MAIS INSANO').toUpperCase().replace(/[.!?…]+$/, '').split(/\s+/).filter(Boolean);
    ws = ws.slice(0, 5);
    // não termina em palavra solta ("O MOMENTO MAIS INSANO DA")
    while (ws.length > 2 && /^(DA|DE|DO|DAS|DOS|NO|NA|NOS|NAS|O|A|OS|AS|E|EM|QUE|COM|PRA|PARA|UM|UMA|SE|AO)$/.test(ws[ws.length - 1])) ws.pop();
    return ws.join(' ');
  }
  function renderCapa(C, tela) {
    var cx = tela.getContext('2d');
    var yt = C.formato === 'yt', W = yt ? 1280 : 1080, H = yt ? 720 : 1920; tela.width = W; tela.height = H;
    cx.fillStyle = '#0a0a0f'; cx.fillRect(0, 0, W, H);
    if (!C.img) { cx.fillStyle = '#6c7286'; cx.font = '600 32px system-ui'; cx.textAlign = 'center'; cx.fillText('Escolha a imagem da capa ←', W / 2, H / 2); return; }
    var img = C.img, iw = img.naturalWidth, ih = img.naturalHeight, esp = !!C.espelho;
    // fundo: imagem mais viva, com contraste
    var f = cobrirImg(img, 0, 0, iw, ih, W, H);
    cx.filter = C.estilo === 'limpo' ? 'saturate(1.12) contrast(1.06)' : 'saturate(1.4) contrast(1.18) brightness(.92)';
    cx.drawImage(img, f[0], f[1], f[2], f[3], 0, 0, W, H); cx.filter = 'none';
    // tom da cor de destaque (leve) + vinheta
    cx.save(); cx.globalCompositeOperation = 'overlay'; cx.globalAlpha = C.estilo === 'limpo' ? 0.08 : 0.16; cx.fillStyle = C.cor; cx.fillRect(0, 0, W, H); cx.restore();
    var vin = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vin.addColorStop(0, 'rgba(0,0,0,0)'); vin.addColorStop(1, 'rgba(0,0,0,.55)'); cx.fillStyle = vin; cx.fillRect(0, 0, W, H);
    // escurece o lado do texto pra ele saltar
    var g = yt ? (esp ? cx.createLinearGradient(W, 0, W * 0.3, 0) : cx.createLinearGradient(0, 0, W * 0.7, 0)) : cx.createLinearGradient(0, H, 0, H * 0.38);
    g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(1, 'rgba(0,0,0,0)'); cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    if (C.estilo === 'neon') { var gn = cx.createRadialGradient(W * (esp ? .2 : .8), H * .35, 10, W * (esp ? .2 : .8), H * .35, W * .6); gn.addColorStop(0, C.cor + '66'); gn.addColorStop(1, 'transparent'); cx.fillStyle = gn; cx.fillRect(0, 0, W, H); }

    // rosto grande: recorte FECHADO na pessoa (o centro-alto da webcam), moldura dupla e sombra, invadindo a borda
    var caixaRosto = null;
    if (C.comRosto && C.rosto && C.rosto.w < 0.9) {
      var r = C.rosto, fx = focoDoRosto(img, r);
      var rw = yt ? W * 0.44 : W * 0.8, rh = rw * (yt ? 0.82 : 0.78), rx = yt ? (esp ? 34 : W - rw - 34) : (W - rw) / 2, ry = yt ? H - rh + 22 : 120;
      var q = cobrirImg(img, fx.x * iw, fx.y * ih, fx.w * iw, fx.h * ih, rw, rh);
      cx.save(); cx.translate(rx + rw / 2, ry + rh / 2); cx.rotate(yt ? (esp ? -0.035 : 0.035) : -0.02);
      cx.shadowColor = 'rgba(0,0,0,.7)'; cx.shadowBlur = 50; cx.shadowOffsetY = 18;
      cx.fillStyle = C.cor; roundRect(cx, -rw / 2 - 14, -rh / 2 - 14, rw + 28, rh + 28, 30); cx.fill();
      cx.shadowColor = C.estilo === 'limpo' ? 'transparent' : C.cor; cx.shadowBlur = C.estilo === 'neon' ? 60 : 0; cx.shadowOffsetY = 0;
      cx.fillStyle = '#fff'; roundRect(cx, -rw / 2 - 5, -rh / 2 - 5, rw + 10, rh + 10, 22); cx.fill(); cx.shadowBlur = 0;
      cx.save(); roundRect(cx, -rw / 2, -rh / 2, rw, rh, 18); cx.clip(); cx.filter = 'contrast(1.12) saturate(1.2) brightness(1.04)';
      cx.drawImage(img, q[0], q[1], q[2], q[3], -rw / 2, -rh / 2, rw, rh); cx.filter = 'none'; cx.restore(); cx.restore();
      caixaRosto = { x: rx, y: ry, w: rw, h: rh };
      if (C.comSeta) seta(cx, C.cor, yt ? rx + rw * (esp ? 0.84 : 0.16) : W * 0.8, yt ? ry - 56 : ry + rh + 80, yt ? Math.PI * (esp ? 0.6 : 0.4) : -Math.PI / 2);
    }
    // figurinha: o emoji do título do clipe, grande, no canto do rosto
    if (C.emoji) {
      // no canto de FORA da foto (longe do texto)
      var ex = caixaRosto ? (yt ? (esp ? caixaRosto.x + 20 : caixaRosto.x + caixaRosto.w - 20) : caixaRosto.x + caixaRosto.w - 50) : (yt ? (esp ? 120 : W - 120) : W - 150);
      var ey = caixaRosto ? caixaRosto.y + (yt ? 10 : 40) : (yt ? 120 : 260);
      cx.save(); cx.translate(ex, ey); cx.rotate(esp ? 0.18 : -0.18); cx.font = (yt ? 120 : 150) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.shadowColor = 'rgba(0,0,0,.6)'; cx.shadowBlur = 24; cx.fillText(C.emoji, 0, 0); cx.restore();
    }
    // texto: curto, o maior que couber em até 3 linhas; última linha em destaque
    var texto = textoDeCapa(C.texto), max = yt ? (caixaRosto ? W * 0.47 : W * 0.6) : W - 110, tam = yt ? 132 : 150, linhas = quebrarTexto(cx, texto, max, tam);
    while ((linhas.length > 3 || linhas.some(function (l) { return cx.measureText(l).width > max; })) && tam > 56) { tam -= 6; linhas = quebrarTexto(cx, texto, max, tam); }
    linhas = linhas.slice(0, 3);
    cx.textAlign = yt ? (esp ? 'right' : 'left') : 'center'; cx.textBaseline = 'alphabetic'; cx.lineJoin = 'round';
    var passo = tam * 1.06, x0 = yt ? (esp ? W - 52 : 52) : W / 2, alturaBloco = linhas.length * passo, y0 = yt ? (H - alturaBloco) / 2 + tam * 0.84 - (caixaRosto ? 20 : 0) : H * 0.64;
    linhas.forEach(function (l, i) {
      var y = y0 + i * passo, ultima = i === linhas.length - 1 && linhas.length > 1;
      cx.font = '900 ' + tam + 'px "Arial Black", system-ui, sans-serif';
      var larg = cx.measureText(l).width;
      if (ultima && C.estilo === 'impacto') {
        // tarja tipo marca-texto atrás da última linha, texto escuro por cima
        var bx = cx.textAlign === 'left' ? x0 - 14 : cx.textAlign === 'right' ? x0 - larg - 14 : x0 - larg / 2 - 14;
        cx.save(); cx.translate(bx + (larg + 28) / 2, y - tam * 0.36); cx.rotate(esp ? 0.015 : -0.015);
        cx.fillStyle = C.cor; cx.shadowColor = 'rgba(0,0,0,.55)'; cx.shadowBlur = 18; roundRect(cx, -(larg + 28) / 2, -tam * 0.6, larg + 28, tam * 1.12, 12); cx.fill(); cx.restore();
        cx.fillStyle = corTexto(C.cor); cx.fillText(l, x0, y);
        return;
      }
      if (C.estilo === 'neon') { cx.shadowColor = ultima ? C.cor : '#fff'; cx.shadowBlur = 26; }
      cx.lineWidth = C.estilo === 'limpo' ? 9 : Math.round(tam * 0.17); cx.strokeStyle = '#000'; cx.strokeText(l, x0, y);
      cx.fillStyle = ultima ? C.cor : '#fff'; cx.fillText(l, x0, y); cx.shadowBlur = 0;
    });
  }
  // Onde está o ROSTO dentro da webcam: procura os tons de pele e centraliza ali com
  // aproximação. A webcam costuma ter cadeira, parede e luz em volta: sem isso a capa
  // mostrava mais cenário que pessoa. Sem pele suficiente, usa a webcam inteira.
  var focos = new WeakMap();
  function focoDoRosto(img, r) {
    var chave = r.x + ',' + r.y + ',' + r.w + ',' + r.h, cache = focos.get(img) || {}; if (cache[chave]) return cache[chave];
    var iw = img.naturalWidth, ih = img.naturalHeight, L = 120, A = Math.max(20, Math.round(L * (r.h * ih) / (r.w * iw)));
    var cv = document.createElement('canvas'); cv.width = L; cv.height = A; var k = cv.getContext('2d', { willReadFrequently: true });
    k.drawImage(img, r.x * iw, r.y * ih, r.w * iw, r.h * ih, 0, 0, L, A);
    var px = k.getImageData(0, 0, L, A).data, sx = 0, sy = 0, n = 0;
    for (var y = 0; y < A; y++) for (var x = 0; x < L; x++) {
      var i = (y * L + x) * 4, R = px[i], G = px[i + 1], B = px[i + 2];
      var Y = 0.299 * R + 0.587 * G + 0.114 * B, Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B, Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
      if (Y > 55 && Cr > 136 && Cr < 175 && Cb > 80 && Cb < 128 && R > G && R > B) { var peso = y < A * 0.75 ? 1.5 : 0.6; sx += x * peso; sy += y * peso; n += peso; }
    }
    var foco = { x: r.x, y: r.y, w: r.w, h: r.h };
    if (n > L * A * 0.025) {
      var cxr = sx / n / L, cyr = sy / n / A, fw = 0.62, fh = 0.78;
      var nx = Math.max(0, Math.min(1 - fw, cxr - fw / 2)), ny = Math.max(0, Math.min(1 - fh, cyr - fh * 0.42));
      foco = { x: r.x + nx * r.w, y: r.y + ny * r.h, w: r.w * fw, h: r.h * fh };
    }
    cache[chave] = foco; focos.set(img, cache); return foco;
  }
  // texto preto ou branco, o que ler melhor em cima da cor de destaque
  function corTexto(hex) { var v = parseInt(String(hex).slice(1), 16), r = v >> 16 & 255, g2 = v >> 8 & 255, b = v & 255; return (r * 0.299 + g2 * 0.587 + b * 0.114) > 150 ? '#0b0b0f' : '#ffffff'; }
  function roundRect(cx, x, y, w, h, r) { cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); }
  function seta(cx, cor, x, y, ang) {
    cx.save(); cx.translate(x, y); cx.rotate(ang); cx.fillStyle = cor; cx.strokeStyle = '#000'; cx.lineWidth = 8; cx.lineJoin = 'round';
    cx.beginPath(); cx.moveTo(-70, -16); cx.lineTo(10, -16); cx.lineTo(10, -40); cx.lineTo(70, 0); cx.lineTo(10, 40); cx.lineTo(10, 16); cx.lineTo(-70, 16); cx.closePath(); cx.stroke(); cx.fill(); cx.restore();
  }
  // 10 capas diferentes de uma vez: troca estilo, cor, momento, texto e lado.
  var loteCfgs = [];
  $('capaLote').addEventListener('click', async function () {
    var b = this; b.disabled = true; b.textContent = 'Gerando 10 capas…';
    var fontes = [];
    var cs = clipes().filter(function (c) { return c.quadro; });
    for (var i = 0; i < cs.length; i++) fontes.push({ img: await carregarImagem(cs[i].quadro), rosto: cs[i].rosto, emoji: primeiroEmoji(cs[i].titulo), textos: [semEmoji(cs[i].gancho), semEmoji(cs[i].titulo)].filter(Boolean) });
    if (!fontes.length && C.img) fontes.push({ img: C.img, rosto: C.rosto, textos: [] });
    if (!fontes.length) { alert('Escolha uma imagem (ou gere clipes) primeiro.'); b.disabled = false; b.textContent = '✨ Gerar 10 capas diferentes'; return; }
    var cores = (C.paleta.length ? C.paleta : []).concat([C.cor, '#ffe14d', '#22d3ee', '#ff3b5c', '#a3ff3d']).filter(function (x, k, a) { return a.indexOf(x) === k; });
    var estilos = ['impacto', 'neon', 'impacto', 'limpo', 'neon'], textoBase = semEmoji(C.texto).toUpperCase();
    loteCfgs = [];
    for (var n = 0; n < 10; n++) {
      var fo = fontes[n % fontes.length], txts = [textoBase].concat(fo.textos.map(function (t) { return t.toUpperCase(); })).filter(Boolean);
      loteCfgs.push({ img: fo.img, rosto: fo.rosto, formato: C.formato, estilo: estilos[n % estilos.length], cor: cores[n % cores.length],
        texto: txts.length ? txts[n % txts.length] : 'O MOMENTO MAIS INSANO', emoji: n % 4 === 3 ? '' : fo.emoji, comRosto: !!fo.rosto, comSeta: n % 3 !== 2, espelho: n % 2 === 1 });
    }
    var box = $('lote'); box.innerHTML = ''; $('loteBox').hidden = false;
    loteCfgs.forEach(function (cfg, k) {
      var fig = document.createElement('figure'); if (cfg.formato !== 'yt') fig.className = 'vert';
      var cv = document.createElement('canvas'); renderCapa(cfg, cv);
      var cap = document.createElement('figcaption'); cap.innerHTML = '<span>' + (k + 1) + ' · ' + cfg.estilo + '</span>';
      var bt = document.createElement('button'); bt.className = 'btn peq'; bt.type = 'button'; bt.textContent = '⬇'; bt.title = 'Baixar';
      bt.addEventListener('click', function () { baixarCanvas(cv, 'capa-' + (k + 1)); });
      var ed = document.createElement('button'); ed.className = 'btn peq'; ed.type = 'button'; ed.textContent = '✎'; ed.title = 'Editar esta';
      ed.addEventListener('click', function () { C.img = cfg.img; C.rosto = cfg.rosto; C.estilo = cfg.estilo; C.cor = cfg.cor; C.texto = cfg.texto; $('capaTexto').value = cfg.texto; $('capaCor').value = cfg.cor; desenharCapa(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      var gr = document.createElement('span'); gr.style.display = 'flex'; gr.style.gap = '4px'; gr.appendChild(ed); gr.appendChild(bt); cap.appendChild(gr);
      fig.appendChild(cv); fig.appendChild(cap); box.appendChild(fig);
    });
    b.disabled = false; b.textContent = '✨ Gerar 10 capas diferentes';
  });
  // JPG de até 2 MB: é o limite de capa do YouTube (PNG grande era recusado lá).
  function baixarCanvas(cv, nome) {
    (function tenta(q) { cv.toBlob(function (bl) { if (bl.size > 2 * 1048576 && q > 0.6) return tenta(q - 0.08);
      var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = nome + '.jpg'; a.click(); }, 'image/jpeg', q); })(0.94);
  }
  $('loteBaixar').addEventListener('click', function () { var cvs = $('lote').querySelectorAll('canvas'); cvs.forEach(function (cv, k) { setTimeout(function () { baixarCanvas(cv, 'capa-' + (k + 1)); }, k * 350); }); });
  $('capaBaixar').addEventListener('click', function () {
    if (!C.img) return; baixarCanvas(tela, 'capa-clipador-' + (C.formato === 'yt' ? 'youtube' : 'vertical'));
  });

  // ================= POSTAGENS =================
  var CHAVE = 'clipador.postagens.v1', rede = 'TikTok';
  // Vídeos agendados ficam guardados no navegador (IndexedDB): dá pra ver e baixar depois, mesmo fechando o site.
  function banco() { return new Promise(function (ok, falha) { var r = indexedDB.open('clipador', 1); r.onupgradeneeded = function () { r.result.createObjectStore('videos'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { falha(r.error); }; }); }
  async function guardarVideo(id, blob) { var db = await banco(); return new Promise(function (ok, falha) { var t = db.transaction('videos', 'readwrite'); t.objectStore('videos').put(blob, id); t.oncomplete = function () { ok(); }; t.onerror = function () { falha(t.error); }; }); }
  async function lerVideo(id) { var db = await banco(); return new Promise(function (ok) { var r = db.transaction('videos').objectStore('videos').get(id); r.onsuccess = function () { ok(r.result || null); }; r.onerror = function () { ok(null); }; }); }
  async function apagarVideo(id) { try { var db = await banco(); db.transaction('videos', 'readwrite').objectStore('videos').delete(id); } catch (_) {} }
  window.__clipadorVideo = { lerVideo: lerVideo }; // teste
  var ler = function () { try { return JSON.parse(localStorage.getItem(CHAVE) || '[]'); } catch (_) { return []; } };
  var gravar = function (l) { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (_) {} };
  grupo('postRede', function (b) { rede = b.dataset.r; });
  function listarClipesPost() {
    var sel = $('postClipe'), atual = sel.value; sel.innerHTML = '';
    clipes().forEach(function (c) { var o = document.createElement('option'); o.value = 'c' + c.numero; o.textContent = 'Clipe ' + c.numero + ' · ' + c.titulo; sel.appendChild(o); });
    var o2 = document.createElement('option'); o2.value = 'livre'; o2.textContent = 'Outro vídeo (escrevo a legenda)'; sel.appendChild(o2);
    if (atual) sel.value = atual; preencherLegenda();
    if (!$('postQuando').value) { var d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() < 12 ? 12 : d.getHours() < 18 ? 18 : d.getHours() < 21 ? 21 : 36); var z = new Date(d - d.getTimezoneOffset() * 60000); $('postQuando').value = z.toISOString().slice(0, 16); }
  }
  function preencherLegenda() { var c = clipes().find(function (x) { return 'c' + x.numero === $('postClipe').value; }); if (c) $('postLegenda').value = c.legenda; }
  $('postClipe').addEventListener('change', preencherLegenda);
  $('postAgendar').addEventListener('click', async function () {
    var q = $('postQuando').value; if (!q) return;
    var c = clipes().find(function (x) { return 'c' + x.numero === $('postClipe').value; });
    var id = Date.now().toString(36), temVideo = false;
    if (c && c.blob) { try { await guardarVideo(id, c.blob); temVideo = true; } catch (e) { alert('Não deu pra guardar o vídeo no navegador (pouco espaço?). A postagem foi agendada mesmo assim: baixe o clipe antes.'); } }
    var l = ler(); l.push({ id: id, titulo: c ? c.titulo : (semEmoji($('postLegenda').value).split('\n')[0] || 'Postagem'), legenda: $('postLegenda').value, rede: rede, quando: new Date(q).toISOString(), feito: false, video: temVideo, ext: c ? c.ext : '', arquivo: c && c.arquivo ? c.arquivo : '' });
    l.sort(function (a, b) { return a.quando.localeCompare(b.quando); }); gravar(l); pintarPosts(); agendarAvisos();
    try { if (Notification.permission === 'default') Notification.requestPermission(); } catch (_) {}
  });
  function pintarPosts() {
    var l = ler(), box = $('postLista'); box.innerHTML = ''; $('postVazio').hidden = l.length > 0;
    l.forEach(function (p) {
      var d = new Date(p.quando), el = document.createElement('div'); el.className = 'post' + (p.feito ? ' feito' : '');
      el.innerHTML = '<div class="quando"><b></b><small></small></div><div><span class="rede"></span> <b class="tit"></b><div class="txt"></div></div>' +
        '<div class="acoes">' + (p.video || p.arquivo ? '<button class="btn peq video" type="button">⬇ Vídeo</button>' : '') + '<button class="btn peq copiar" type="button">📋 Copiar</button><button class="btn peq ics" type="button">📆</button><button class="btn peq ok" type="button">✓</button><button class="btn peq del" type="button">✕</button></div>';
      el.querySelector('.quando b').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      el.querySelector('.quando small').textContent = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      el.querySelector('.rede').textContent = p.rede; el.querySelector('.tit').textContent = p.titulo; el.querySelector('.txt').textContent = p.legenda;
      el.querySelector('.copiar').addEventListener('click', function () { var b = this; navigator.clipboard.writeText(p.legenda).then(function () { b.textContent = '✓ Copiado'; setTimeout(function () { b.textContent = '📋 Copiar'; }, 1500); }); });
      el.querySelector('.ics').title = 'Adicionar ao calendário'; el.querySelector('.ics').addEventListener('click', function () { baixarIcs([p]); });
      el.querySelector('.ok').title = 'Marcar como postado'; el.querySelector('.ok').addEventListener('click', function () { var l2 = ler(); l2.forEach(function (x) { if (x.id === p.id) x.feito = !x.feito; }); gravar(l2); pintarPosts(); });
      el.querySelector('.del').title = 'Excluir'; el.querySelector('.del').addEventListener('click', function () { apagarVideo(p.id); gravar(ler().filter(function (x) { return x.id !== p.id; })); pintarPosts(); });
      if (p.arquivo && !p.video) el.querySelector('.video').addEventListener('click', function () { var a = document.createElement('a'); a.href = p.arquivo; a.download = ''; a.click(); });
      if (p.video) el.querySelector('.video').addEventListener('click', async function () { var bl = await lerVideo(p.id); if (!bl) { alert('O vídeo não está mais guardado neste navegador.'); return; } var a = document.createElement('a'); a.href = URL.createObjectURL(bl); a.download = 'clipe-' + p.id + '.' + (p.ext || 'mp4'); a.click(); });
      box.appendChild(el);
    });
  }
  // .ics: o calendário do celular/Google avisa na hora, mesmo com o site fechado
  function baixarIcs(lista) {
    var dt = function (iso) { return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); };
    var esc = function (t) { return String(t || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, function (m) { return '\\' + m; }); };
    var linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Clipador//Postagens//PT'];
    lista.filter(function (p) { return !p.feito; }).forEach(function (p) {
      var fim = new Date(new Date(p.quando).getTime() + 15 * 60000).toISOString();
      linhas.push('BEGIN:VEVENT', 'UID:' + p.id + '@clipador', 'DTSTAMP:' + dt(new Date().toISOString()), 'DTSTART:' + dt(p.quando), 'DTEND:' + dt(fim),
        'SUMMARY:' + esc('Postar no ' + p.rede + ': ' + p.titulo), 'DESCRIPTION:' + esc('Legenda pra colar:\n\n' + p.legenda),
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('Hora de postar no ' + p.rede), 'TRIGGER:-PT5M', 'END:VALARM', 'END:VEVENT');
    });
    linhas.push('END:VCALENDAR');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([linhas.join('\r\n')], { type: 'text/calendar' })); a.download = 'postagens-clipador.ics'; a.click();
  }
  $('postIcsTodos').addEventListener('click', function () { baixarIcs(ler()); });
  // aviso na hora, com o site aberto (a lista fica salva neste navegador)
  var timers = [];
  function agendarAvisos() {
    timers.forEach(clearTimeout); timers = [];
    ler().forEach(function (p) { var ms = new Date(p.quando) - Date.now(); if (p.feito || ms < 0 || ms > 864e5) return;
      timers.push(setTimeout(function () { try { navigator.serviceWorker.getRegistration().then(function (r) { var op = { body: 'Legenda pronta: abra o Clipador e copie.', icon: (window.ClipadorHls ? '/img/icone-192.png' : '/ui/icone-192.png'), tag: p.id }; if (r) r.showNotification('Hora de postar no ' + p.rede + ': ' + p.titulo, op); else new Notification('Hora de postar no ' + p.rede, op); }); } catch (_) {} }, ms)); });
  }
  agendarAvisos();
})();
