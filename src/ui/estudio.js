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
  // Opção "Recortar a pessoa com IA" (depois do "Rosto do streamer em destaque")
  (function () {
    var alvo = $('capaRosto'); if (!alvo || $('capaRecorte')) return;
    var l = document.createElement('label'); l.className = 'marca-op';
    l.innerHTML = '<input type="checkbox" id="capaRecorte" checked><span><b>Recortar a pessoa com IA</b><small>Tira o streamer da moldura da webcam, com contorno e brilho. Na 1ª vez baixa ~9 MB.</small></span>';
    alvo.closest('label').after(l);
    l.querySelector('input').addEventListener('change', function () { desenharCapa(); });
  })();
  // ================= IA DO GEMINI (opcional, chave da própria pessoa) =================
  // A chave fica SÓ neste aparelho (localStorage) e vai direto do navegador pro Google: nunca passa pelo servidor do Clipador.
  var CHAVE_GEMINI = 'clipador.gemini.chave';
  var lerChave = function () { try { return localStorage.getItem(CHAVE_GEMINI) || ''; } catch (_) { return ''; } };
  var MODELOS_IMAGEM = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image-preview'];
  (function () {
    var depois = $('capaLote'); if (!depois || $('blocoGemini')) return;
    var b = document.createElement('div'); b.id = 'blocoGemini'; b.className = 'card'; b.style.marginTop = '12px'; b.style.padding = '14px';
    b.innerHTML = '<span class="rot" style="margin-top:0">🤖 IA do Gemini <span class="beta">OPCIONAL</span></span>' +
      '<div id="gemSem"><p class="dica" style="margin:0 0 8px">Com a sua chave do Gemini (grátis em <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>), a IA desenha uma capa nova a partir do seu clipe.</p>' +
      '<div class="linha" style="gap:6px"><input type="password" id="gemChave" placeholder="Cole a chave aqui" autocomplete="off" style="flex:1;min-width:0"><button class="btn peq" id="gemSalvar" type="button">Salvar</button></div>' +
      '<p class="dica" style="margin:6px 0 0">🔒 Fica só neste aparelho e vai direto pro Google. Dá pra remover quando quiser.</p></div>' +
      '<div id="gemCom" hidden><p class="dica" style="margin:0 0 8px">✓ Chave salva neste aparelho.</p>' +
      '<button class="btn pri" id="gemGerar" type="button" style="width:100%">✨ Gerar capa com IA</button>' +
      '<button class="btn peq" id="gemRemover" type="button" style="width:100%;margin-top:8px">Remover chave deste aparelho</button></div>' +
      '<div class="aviso" id="gemAviso" hidden></div>';
    depois.after(b);
    function pintar() { var tem = !!lerChave(); $('gemSem').hidden = tem; $('gemCom').hidden = !tem; }
    pintar();
    $('gemSalvar').addEventListener('click', function () { var k = $('gemChave').value.trim(); if (!/^[A-Za-z0-9_-]{20,}$/.test(k)) { mostrarGem('Essa chave não parece certa. Copie de novo no Google AI Studio.', true); return; }
      try { localStorage.setItem(CHAVE_GEMINI, k); } catch (_) {} $('gemChave').value = ''; mostrarGem(''); pintar(); });
    $('gemRemover').addEventListener('click', function () { try { localStorage.removeItem(CHAVE_GEMINI); } catch (_) {} mostrarGem('Chave removida deste aparelho.'); pintar(); });
    $('gemGerar').addEventListener('click', gerarComGemini);
  })();
  function mostrarGem(msg, erro) { var a = $('gemAviso'); if (!a) return; a.hidden = !msg; a.className = 'aviso' + (erro ? ' erro' : ''); a.textContent = msg || ''; }
  // imagem → base64 (JPEG) pra mandar pro Gemini
  function imagemBase64(fonte, maxLado) {
    var w = fonte.naturalWidth || fonte.width, h = fonte.naturalHeight || fonte.height, e = Math.min(1, (maxLado || 1280) / Math.max(w, h));
    var c = document.createElement('canvas'); c.width = Math.round(w * e); c.height = Math.round(h * e); c.getContext('2d').drawImage(fonte, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }
  async function gerarComGemini() {
    var chave = lerChave(); if (!chave) return;
    if (!C.img) { mostrarGem('Escolha a imagem da capa primeiro (um clipe ou uma imagem sua).', true); return; }
    var b = $('gemGerar'); b.disabled = true; b.textContent = 'A IA está desenhando… (até 1 min)'; mostrarGem('');
    var yt = C.formato === 'yt', texto = textoDeCapa(C.texto, 5) || 'O MOMENTO MAIS INSANO';
    var pedido = 'Crie uma capa (thumbnail) ' + (yt ? 'de YouTube, formato 16:9 horizontal' : 'vertical 9:16 pra Shorts/TikTok') + ' para um corte de live de jogo.\n' +
      '- Use a IMAGEM 1 (um momento do vídeo) como conteúdo principal. Se houver um streamer/webcam nela, destaque a pessoa: grande, recortada, com contorno branco e luz de contorno na cor ' + C.cor + ', mantendo o rosto reconhecível e sem mudar a identidade dela.\n' +
      '- Texto grande em português, exatamente: "' + texto + '". Letras grossas, alto contraste, legível no celular. Não escreva nenhum outro texto.\n' +
      '- Cores fortes e saturadas, um assunto claro, fundo do próprio jogo com profundidade.\n' +
      (C.refImg ? '- A IMAGEM 2 é só referência de CORES e de composição: NÃO copie texto, logotipo, marca nem pessoas dela.\n' : '') +
      '- Sem logotipos, sem marca d\'água. Deixe o canto inferior direito livre (ali fica a duração do vídeo).';
    var partes = [{ text: pedido }, { inline_data: { mime_type: 'image/jpeg', data: imagemBase64(C.img, 1280) } }];
    if (C.refImg) partes.push({ inline_data: { mime_type: 'image/jpeg', data: imagemBase64(C.refImg, 768) } });
    var ultimoErro = '';
    for (var i = 0; i < MODELOS_IMAGEM.length; i++) {
      for (var comFormato = 1; comFormato >= 0; comFormato--) {
        var corpo = { contents: [{ parts: partes }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } };
        if (comFormato) corpo.generationConfig.imageConfig = { aspectRatio: yt ? '16:9' : '9:16' };
        try {
          var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODELOS_IMAGEM[i] + ':generateContent', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo), referrerPolicy: 'no-referrer' });
          var j = await r.json().catch(function () { return {}; });
          if (!r.ok) {
            ultimoErro = (j.error && j.error.message) || ('erro ' + r.status);
            if (r.status === 400 && comFormato) continue;            // formato não aceito: tenta sem
            if (r.status === 401 || r.status === 403) { i = MODELOS_IMAGEM.length; break; } // chave inválida: para
            break;                                                    // modelo indisponível: próximo
          }
          var parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
          var im = parts.find(function (p) { return p.inlineData || p.inline_data; });
          if (!im) { ultimoErro = 'A IA respondeu sem imagem (pode ter recusado o pedido).'; break; }
          var dado = im.inlineData || im.inline_data, url = 'data:' + (dado.mimeType || dado.mime_type || 'image/png') + ';base64,' + dado.data;
          mostrarResultadoIA(await carregarImagem(url), yt);
          b.disabled = false; b.textContent = '✨ Gerar capa com IA'; mostrarGem('Pronto! A capa da IA está na lista "opções" (pode gerar de novo pra ter outra).');
          return;
        } catch (e) { ultimoErro = e.message || String(e); break; }
      }
    }
    b.disabled = false; b.textContent = '✨ Gerar capa com IA';
    mostrarGem('Não deu pra gerar com a IA: ' + ultimoErro + (/quota|exhausted|429/i.test(ultimoErro) ? ' (limite grátis da sua chave: tente mais tarde)' : ''), true);
  }
  // a capa da IA entra no topo da lista de opções, no tamanho certo (1280x720 ou 1080x1920) e pronta pra baixar em JPG
  function mostrarResultadoIA(img, yt) {
    var cv = document.createElement('canvas'), W = yt ? 1280 : 1080, H = yt ? 720 : 1920; cv.width = W; cv.height = H;
    var q = cobrirImg(img, 0, 0, img.naturalWidth, img.naturalHeight, W, H); cv.getContext('2d').drawImage(img, q[0], q[1], q[2], q[3], 0, 0, W, H);
    $('loteBox').hidden = false;
    var fig = document.createElement('figure'); if (!yt) fig.className = 'vert';
    var cap = document.createElement('figcaption'); cap.innerHTML = '<span>🤖 IA do Gemini</span>';
    var bt = document.createElement('button'); bt.className = 'btn peq'; bt.type = 'button'; bt.textContent = '⬇'; bt.title = 'Baixar';
    bt.addEventListener('click', function () { baixarCanvas(cv, 'capa-ia-gemini'); }); cap.appendChild(bt);
    fig.appendChild(cv); fig.appendChild(cap); $('lote').prepend(fig);
    fig.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

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
    C.refImg = im;
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
  var geracaoCapa = 0;
  function desenharCapa() {
    var cfg = { img: C.img, rosto: C.rosto, formato: C.formato, estilo: C.estilo, cor: C.cor, texto: C.texto, emoji: C.emoji, comRosto: $('capaRosto').checked, comSeta: $('capaSeta').checked, espelho: false };
    renderCapa(cfg, tela);
    // recorta a pessoa com IA e redesenha (a 1ª vez baixa ~9 MB e fica guardado)
    if (cfg.comRosto && cfg.img && cfg.rosto && $('capaRecorte') && $('capaRecorte').checked) {
      var g = ++geracaoCapa;
      recortePessoa(cfg.img, cfg.rosto).then(function (rc) { if (rc && g === geracaoCapa) { cfg.recorte = rc; renderCapa(cfg, tela); } });
    }
  }
  // Texto de capa: curto e forte. Mais de 5 palavras não se lê numa miniatura.
  function textoDeCapa(t, maxPalavras) {
    var ws = semEmoji(t || 'O MOMENTO MAIS INSANO').toUpperCase().replace(/[.!?…]+$/, '').split(/\s+/).filter(Boolean);
    ws = ws.slice(0, maxPalavras || 5);
    // não termina em palavra solta ("O MOMENTO MAIS INSANO DA")
    var solta = /^(DA|DE|DO|DAS|DOS|NO|NA|NOS|NAS|O|A|OS|AS|E|EM|QUE|COM|PRA|PARA|UM|UMA|SE|AO)$/;
    while (ws.length > 1 && solta.test(ws[ws.length - 1])) ws.pop();
    // curto demais pra ter sentido ("OLHA O"): usa a frase completa (até 5 palavras)
    if (maxPalavras && maxPalavras < 5 && ws.filter(function (w) { return !solta.test(w); }).length < 2) return textoDeCapa(t, 5);
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
    if (C.comRosto && C.recorte) {
      // pessoa recortada: grande, em pé, invadindo a borda de baixo, com contorno branco e brilho na cor de destaque
      var rc = C.recorte, alt = yt ? H * 0.98 : H * 0.5, larg = alt * rc.width / rc.height;
      if (larg > (yt ? W * 0.55 : W * 0.95)) { larg = yt ? W * 0.55 : W * 0.95; alt = larg * rc.height / rc.width; }
      var px0 = yt ? (esp ? 10 : W - larg - 10) : (W - larg) / 2, py0 = yt ? H - alt + 8 : 110;
      var branco = silhueta(rc, '#ffffff'), brilho = silhueta(rc, C.cor), esp2 = Math.max(5, Math.round(alt * 0.012));
      cx.save(); cx.shadowColor = C.cor; cx.shadowBlur = C.estilo === 'limpo' ? 0 : 70; cx.drawImage(brilho, px0, py0, larg, alt); cx.restore();
      for (var a = 0; a < 16; a++) { var an = a / 16 * Math.PI * 2; cx.drawImage(branco, px0 + Math.cos(an) * esp2, py0 + Math.sin(an) * esp2, larg, alt); }
      cx.filter = 'contrast(1.12) saturate(1.2) brightness(1.05)'; cx.drawImage(rc, px0, py0, larg, alt); cx.filter = 'none';
      caixaRosto = { x: px0 + larg * 0.1, y: py0 + alt * 0.08, w: larg * 0.8, h: alt * 0.6 };
      if (C.comSeta) seta(cx, C.cor, yt ? (esp ? px0 + larg + 30 : px0 - 30) : W * 0.82, yt ? py0 + alt * 0.3 : py0 + alt + 60, yt ? (esp ? Math.PI : 0) : -Math.PI / 2);
    } else if (C.comRosto && C.rosto && C.rosto.w < 0.9) {
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
    if (C.semTexto) return;
    var texto = textoDeCapa(C.texto, C.palavras), max = yt ? (caixaRosto ? W * 0.47 : W * 0.6) : W - 110, tam = yt ? 132 : 150, linhas = quebrarTexto(cx, texto, max, tam);
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
  // ---------- Pessoa recortada com IA (MediaPipe "selfie segmenter", 250 KB, roda no navegador) ----------
  var segmentador = null, segmentadorFalhou = false;
  async function obterSegmentador() {
    if (segmentador || segmentadorFalhou) return segmentador;
    try {
      var base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
      var mp = await import(base + '/vision_bundle.mjs');
      var arquivos = await mp.FilesetResolver.forVisionTasks(base + '/wasm');
      segmentador = await mp.ImageSegmenter.createFromOptions(arquivos, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
      });
    } catch (e) { segmentadorFalhou = true; segmentador = null; }
    return segmentador;
  }
  // Recorta a pessoa da área da webcam: devolve um canvas com fundo transparente (ou null).
  var recortes = new WeakMap();
  async function recortePessoa(img, r) {
    if (!img || !r || r.w >= 0.9) return null;
    var chave = r.x + ',' + r.y + ',' + r.w + ',' + r.h, cache = recortes.get(img) || {};
    if (chave in cache) return cache[chave];
    var seg = await obterSegmentador(); if (!seg) { cache[chave] = null; recortes.set(img, cache); return null; }
    var iw = img.naturalWidth, ih = img.naturalHeight, sw = r.w * iw, sh = r.h * ih, L = Math.min(768, Math.round(sw * 2)), A = Math.round(L * sh / sw);
    var cv = document.createElement('canvas'); cv.width = L; cv.height = A; var k = cv.getContext('2d', { willReadFrequently: true });
    k.imageSmoothingQuality = 'high'; k.drawImage(img, r.x * iw, r.y * ih, sw, sh, 0, 0, L, A);
    var res = null;
    try { res = seg.segment(cv); } catch (_) { cache[chave] = null; recortes.set(img, cache); return null; }
    var m = res.confidenceMasks && res.confidenceMasks[0], dados = m ? m.getAsFloat32Array() : null, mw = m ? m.width : 0, mh = m ? m.height : 0;
    var px = k.getImageData(0, 0, L, A), d = px.data, pessoa = 0, x0 = L, y0 = A, x1 = 0, y1 = 0;
    for (var y = 0; y < A; y++) for (var x = 0; x < L; x++) {
      var mx = Math.min(mw - 1, Math.floor(x * mw / L)), my = Math.min(mh - 1, Math.floor(y * mh / A)), c = dados ? dados[my * mw + mx] : 0;
      var a = Math.max(0, Math.min(1, (c - 0.35) / 0.3)); d[(y * L + x) * 4 + 3] = Math.round(a * 255);
      if (a > 0.5) { pessoa++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    try { res.close(); } catch (_) {}
    // pouca pessoa (webcam sem gente, só cenário): não vale recortar
    if (pessoa < L * A * 0.08) { cache[chave] = null; recortes.set(img, cache); return null; }
    k.putImageData(px, 0, 0);
    // só o retângulo da pessoa (com folga): assim ela ocupa a capa toda, não a webcam inteira
    var folga = Math.round(L * 0.03); x0 = Math.max(0, x0 - folga); y0 = Math.max(0, y0 - folga); x1 = Math.min(L - 1, x1 + folga); y1 = A - 1;
    var out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    cache[chave] = out; recortes.set(img, cache); return out;
  }
  // Silhueta da pessoa numa cor (pro contorno e pro brilho)
  function silhueta(recorte, cor) {
    var c = document.createElement('canvas'); c.width = recorte.width; c.height = recorte.height; var k = c.getContext('2d');
    k.drawImage(recorte, 0, 0); k.globalCompositeOperation = 'source-in'; k.fillStyle = cor; k.fillRect(0, 0, c.width, c.height); return c;
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
    var querRecorte = $('capaRecorte') && $('capaRecorte').checked;
    if (querRecorte) { b.textContent = 'Recortando a pessoa com IA…'; for (var f2 = 0; f2 < fontes.length; f2++) fontes[f2].recorte = await recortePessoa(fontes[f2].img, fontes[f2].rosto); b.textContent = 'Gerando 10 capas…'; }
    if (!fontes.length && C.img) fontes.push({ img: C.img, rosto: C.rosto, textos: [] });
    if (!fontes.length) { alert('Escolha uma imagem (ou gere clipes) primeiro.'); b.disabled = false; b.textContent = '✨ Gerar 10 capas diferentes'; return; }
    var cores = (C.paleta.length ? C.paleta : []).concat([C.cor, '#ffe14d', '#22d3ee', '#ff3b5c', '#a3ff3d']).filter(function (x, k, a) { return a.indexOf(x) === k; });
    var estilos = ['impacto', 'neon', 'impacto', 'limpo', 'neon'], textoBase = semEmoji(C.texto).toUpperCase();
    loteCfgs = [];
    for (var n = 0; n < 10; n++) {
      var fo = fontes[n % fontes.length], txts = [textoBase].concat(fo.textos.map(function (t) { return t.toUpperCase(); })).filter(Boolean);
      loteCfgs.push({ img: fo.img, rosto: fo.rosto, formato: C.formato, estilo: estilos[n % estilos.length], cor: cores[n % cores.length],
        texto: txts.length ? txts[n % txts.length] : 'O MOMENTO MAIS INSANO', emoji: n % 4 === 3 ? '' : fo.emoji, comRosto: !!fo.rosto, comSeta: n % 3 !== 2, espelho: n % 2 === 1,
        // metade com a pessoa recortada, metade na moldura; algumas com só 3 palavras e uma só com o rosto
        recorte: fo.recorte && n % 2 === 0 ? fo.recorte : null, palavras: n % 3 === 1 ? 3 : 5, semTexto: n === 8 && !!fo.recorte });
    }
    var box = $('lote'); box.innerHTML = ''; $('loteBox').hidden = false;
    loteCfgs.forEach(function (cfg, k) {
      var fig = document.createElement('figure'); if (cfg.formato !== 'yt') fig.className = 'vert';
      var cv = document.createElement('canvas'); renderCapa(cfg, cv);
      var cap = document.createElement('figcaption'); cap.innerHTML = '<span>' + (k + 1) + ' · ' + cfg.estilo + '</span>';
      var bt = document.createElement('button'); bt.className = 'btn peq'; bt.type = 'button'; bt.textContent = '⬇'; bt.title = 'Baixar';
      bt.addEventListener('click', function () { baixarCanvas(cv, 'capa-' + (k + 1)); });
      var ed = document.createElement('button'); ed.className = 'btn peq'; ed.type = 'button'; ed.textContent = '✎'; ed.title = 'Editar esta';
      ed.addEventListener('click', function () { C.img = cfg.img; C.rosto = cfg.rosto; if ($('capaRecorte')) $('capaRecorte').checked = !!cfg.recorte; C.estilo = cfg.estilo; C.cor = cfg.cor; C.texto = cfg.texto; $('capaTexto').value = cfg.texto; $('capaCor').value = cfg.cor; desenharCapa(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
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
