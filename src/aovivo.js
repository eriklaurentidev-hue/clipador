'use strict';
/**
 * Clipar live AO VIVO: o programa fica ligado na live, guarda os ultimos
 * minutos em pedacos de 4s (como um DVR) e corta na hora - quando a pessoa
 * aperta "CLIPAR AGORA" ou quando ele mesmo percebe que algo aconteceu.
 *
 * O objetivo e postar PRIMEIRO. Por isso nada aqui transcreve a live inteira:
 *   1. gravacao: yt-dlp acha o endereco da live, o ffmpeg grava em pedacos
 *      sem recodificar (-c copy) - o momento ja esta no disco quando acontece;
 *   2. deteccao: sinais leves e rapidos - o chat (Twitch/Kick) explodindo e o
 *      volume do streamer subindo de repente (grito, risada, susto). Tudo
 *      roda aqui no PC: nenhuma API, chave ou servico pago. O chat e lido
 *      do mesmo jeito que a pagina da live mostra pra qualquer visitante;
 *   3. corte: junta os pedacos do trecho e ja sai em 9:16, com preset rapido;
 *   4. depois do clipe pronto, transcreve SO ele (modelo pequeno) pra sugerir
 *      titulo e legenda do post - o clipe ja aparece antes disso.
 *
 * Uma live por vez: o clipador acompanha um streamer, e duas gravacoes +
 * render dividindo o mesmo processador atrasariam as duas.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const media = require('./media');
const baixador = require('./baixar');
const sessoes = require('./sessoes');
const legenda = require('./legenda');
const { gerarCopy } = require('./copy');
const { transcrever, fontsdirRelativo } = require('./pipeline');
const pastas = require('./pastas');

const DUR_PEDACO = 4;
// Folga que o original de cada clipe guarda antes e depois do corte: e o
// quanto da pra "ir e voltar" no editor depois que a live passou.
const MARGEM_EDICAO = 10;

// Quanto o nivel (0-100) precisa passar pra virar clipe automatico
const LIMIAR = { alta: 45, media: 60, baixa: 75 };

// ---------------------------------------------------------------- utilidades

function plataformaDe(url) {
  const u = String(url || '');
  if (/twitch\.tv/i.test(u)) return 'twitch';
  if (/kick\.com/i.test(u)) return 'kick';
  if (/youtube\.com|youtu\.be/i.test(u)) return 'youtube';
  return 'outra';
}

/** O nome do canal no link (twitch.tv/gaules -> gaules). Video gravado nao tem. */
function canalDoLink(url) {
  const u = String(url || '');
  let m = /twitch\.tv\/([A-Za-z0-9_]{2,})\/?(?:[?#].*)?$/i.exec(u);
  if (m && !/^(videos|directory|p|settings)$/i.test(m[1])) return m[1].toLowerCase();
  m = /kick\.com\/([A-Za-z0-9_-]{2,})\/?(?:[?#].*)?$/i.exec(u);
  if (m && !/^(video|videos|categories|browse)$/i.test(m[1])) return m[1].toLowerCase();
  return null;
}

/** Aceita "gaules" ou "twitch gaules"? Nao - so link. Mas completa o https. */
function normalizarLink(url) {
  let u = String(url || '').trim();
  if (u && !/^https?:\/\//i.test(u) && /^(www\.)?(twitch\.tv|kick\.com|youtube\.com|youtu\.be)\//i.test(u)) {
    u = 'https://' + u;
  }
  return u;
}

function hms(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

function limparNome(s) {
  return String(s || 'live')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'live';
}

function mediana(lista) {
  if (!lista.length) return 0;
  const o = lista.slice().sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

function rotuloDoNivel(n) {
  if (n >= 82) return { texto: 'Altissimo', cor: 'otimo' };
  if (n >= 68) return { texto: 'Alto', cor: 'bom' };
  if (n >= 54) return { texto: 'Medio', cor: 'medio' };
  return { texto: 'Baixo', cor: 'fraco' };
}

// ---------------------------------------------------------------- o link

/**
 * Pergunta pro yt-dlp se o link esta ao vivo e, se estiver, o endereco da
 * transmissao (.m3u8). Ate 1080p: acima disso o render fica lento e o
 * TikTok recomprime tudo pra 1080 de qualquer jeito.
 */
// Formato com imagem e som juntos, pro caminho em que o yt-dlp entrega a live
const FORMATO_UNICO = 'b[height<=1080][fps<=60]/b[height<=1080]/b';

/** O erro do ffmpeg/yt-dlp em frase de gente, pra aparecer na tela. */
function motivoDaFalha(bruto) {
  const t = String(bruto || '');
  if (/403|forbidden/i.test(t)) return 'o site recusou a conexão (403)';
  if (/404|not found/i.test(t)) return 'o endereço da live expirou (404)';
  if (/timed? ?out|timeout/i.test(t)) return 'a conexão demorou demais';
  if (/getaddrinfo|resolve|network|connection (refused|reset)/i.test(t)) return 'sem conexão com a internet ou com o site';
  if (/not currently live|offline/i.test(t)) return 'o canal saiu do ar';
  const linha = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
  return linha ? linha.replace(/^\[[^\]]+\]\s*/, '').slice(0, 120) : 'motivo desconhecido';
}

async function resolverAoVivo(url) {
  // YouTube pedindo "confirme que nao e um robo": tenta de novo com o login do navegador
  const extras = [[]].concat(/youtube\.com|youtu\.be/i.test(String(url))
    ? [['--cookies-from-browser', 'firefox'], ['--cookies-from-browser', 'edge'], ['--cookies-from-browser', 'chrome']]
    : []);
  let ultimo = null;
  for (const e of extras) {
    try { return await resolverAoVivoUma(url, e); }
    catch (err) { ultimo = err; if (!/sign in|not a bot|confirm/i.test(err.message)) throw err; }
  }
  throw new Error('O YouTube pediu pra confirmar que não é um robô. Abra o YouTube no Firefox, Edge ou Chrome, entre na sua conta e tente de novo.');
}

async function resolverAoVivoUma(url, extras) {
  const bin = await baixador.garantirYtDlp();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, [
      '--no-warnings', '--no-playlist',
      // Twitch e Kick mandam imagem e som juntos; o YouTube ao vivo manda
      // separados - ai vem um endereco de cada e a gravacao junta os dois
      '-f', 'b[height<=1080][fps<=60]/bv*[height<=1080][fps<=60]+ba/bv*[height<=1080]+ba/b/bv*+ba',
      '--print', '%(is_live)s\t%(uploader)s\t%(title)s',
      '--print', 'urls',
    ].concat(extras || [], [url]), { windowsHide: true });
    let saida = '';
    let erro = '';
    const relogio = setTimeout(() => { try { p.kill(); } catch (_) {} }, 60000);
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => { saida += d.toString(); });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erro += d.toString(); });
    p.on('error', (e) => { clearTimeout(relogio); reject(e); });
    p.on('close', (code) => {
      clearTimeout(relogio);
      if (code !== 0) {
        if (/not currently live|is offline|offline|not live|will begin|premieres? in|live event will begin/i.test(erro)) {
          return resolve({ aoVivo: false, offline: true });
        }
        const linha = erro.split(/\r?\n/).filter((l) => /ERROR/i.test(l)).pop() || 'Nao consegui abrir esse link.';
        return reject(new Error(linha.replace(/^ERROR:\s*/i, '').slice(0, 220)));
      }
      const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const [ehLive, canal, titulo] = (linhas[0] || '').split('\t');
      const enderecos = linhas.slice(1).filter((l) => /^https?:\/\//.test(l));
      const m3u8 = enderecos[0] || null;
      const audio = enderecos[1] || null;
      resolve({
        aoVivo: ehLive === 'True',
        canal: canal && canal !== 'NA' ? canal : null,
        titulo: titulo && titulo !== 'NA' ? titulo : null,
        m3u8,
        audio,
      });
    });
  });
}

/**
 * O que a janela pergunta quando a pessoa cola um link: e live acontecendo
 * agora, canal offline, ou video gravado (VOD)?
 */
async function checarLink(bruto) {
  const url = normalizarLink(bruto);
  if (!baixador.pareceLink(url)) throw new Error('Isso não parece um link.');
  const plataforma = plataformaDe(url);
  const canal = canalDoLink(url);

  // Link de VOD (twitch.tv/videos/..., kick.com/canal/videos/..., youtube
  // watch de video ja publicado) nunca e ao vivo - nem pergunta.
  const pareceVod = /twitch\.tv\/videos\/|kick\.com\/[^/]+\/videos\/|kick\.com\/video\/|clips\.twitch|\/clip\//i.test(url);
  // Link de UM video do YouTube (watch, youtu.be, shorts, live/ID): uma consulta so
  // responde se e live e qual e o video. Antes eram duas seguidas (uns 12s parado).
  if (/youtube\.com\/(watch|shorts\/|live\/)|youtu\.be\//i.test(url)) {
    const info = await baixador.espiar(url);
    if (info.aoVivo) return { url, plataforma, tipo: 'aovivo', canal: info.canal || canal, titulo: info.titulo };
    return { url, plataforma, tipo: 'video', canal: info.canal || canal, titulo: info.titulo, duracao: info.duracao };
  }
  if (!pareceVod) {
    try {
      const r = await resolverAoVivo(url);
      if (r.aoVivo) return { url, plataforma, tipo: 'aovivo', canal: r.canal || canal, titulo: r.titulo };
      if (r.offline) return { url, plataforma, tipo: 'offline', canal };
    } catch (e) {
      // canal sem live e sem video: o erro do yt-dlp e a melhor explicacao
      if (canal) throw e;
    }
  }
  const info = await baixador.espiar(url);
  return { url, plataforma, tipo: 'video', canal: info.canal || canal, titulo: info.titulo, duracao: info.duracao };
}

// ---------------------------------------------------------------- chat

const HYPE = /\b(kekw|lul|lmao|omegalul|pog|pogchamp|poggers|pogu|w+|clip|clipa|clipem|clipou|monka\w*|pepelaugh|icant|kkkk+|kkk|ksksk\w*|hahaha\w*|rsrs\w*|caralho|carai|mds|meu deus|nossa|eita|wtf|omg|gg|insano|absurdo)\b|\?{3,}|!{3,}/i;

/**
 * Chat da Twitch: IRC por WebSocket, como convidado anonimo (justinfan) -
 * le o chat publico, nao manda nada e nao precisa de conta.
 */
function chatTwitch(canal, aoMsg, aoStatus) {
  let ws = null;
  let fechado = false;
  const conectar = () => {
    if (fechado) return;
    try { ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'); } catch (e) { aoStatus('sem chat'); return; }
    ws.onopen = () => {
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + canal.toLowerCase());
      aoStatus('conectado');
    };
    ws.onmessage = (e) => {
      for (const l of String(e.data).split('\r\n')) {
        if (!l) continue;
        if (l.startsWith('PING')) { try { ws.send('PONG :tmi.twitch.tv'); } catch (_) {} continue; }
        const i = l.indexOf(' PRIVMSG #');
        if (i < 0) continue;
        const j = l.indexOf(' :', i);
        aoMsg(j > 0 ? l.slice(j + 2) : '');
      }
    };
    ws.onclose = () => { if (!fechado) { aoStatus('reconectando'); setTimeout(conectar, 3000); } };
    ws.onerror = () => {};
  };
  conectar();
  return () => { fechado = true; try { ws && ws.close(); } catch (_) {} };
}

/**
 * Chat da Kick: o mesmo canal publico (Pusher) que a pagina da Kick usa pra
 * mostrar o chat. A chave do Pusher muda de tempos em tempos - da pra trocar
 * pela variavel KICK_PUSHER_KEY. Se nao conectar, a deteccao segue so pelo
 * volume e a janela avisa.
 */
const CHAVES_KICK = (process.env.KICK_PUSHER_KEY ? [process.env.KICK_PUSHER_KEY] : [])
  .concat(['eb1d5f283081a78b932c', '32cbd69e4b950bf97679']);

function chatKick(slug, aoMsg, aoStatus) {
  let ws = null;
  let fechado = false;
  let chaveIdx = 0;
  let sala = null;

  const conectar = () => {
    if (fechado || !sala) return;
    if (chaveIdx >= CHAVES_KICK.length) { aoStatus('sem chat'); return; }
    const chave = CHAVES_KICK[chaveIdx];
    try {
      ws = new WebSocket('wss://ws-us2.pusher.com/app/' + chave + '?protocol=7&client=js&version=8.4.0&flash=false');
    } catch (e) { aoStatus('sem chat'); return; }
    let deuCerto = false;
    ws.onmessage = (e) => {
      let j;
      try { j = JSON.parse(e.data); } catch (_) { return; }
      if (j.event === 'pusher:connection_established') {
        ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: 'chatrooms.' + sala + '.v2' } }));
      } else if (j.event === 'pusher_internal:subscription_succeeded') {
        deuCerto = true;
        aoStatus('conectado');
      } else if (j.event === 'pusher:error') {
        // chave velha: tenta a proxima
        chaveIdx++;
        try { ws.close(); } catch (_) {}
      } else if (/ChatMessageEvent/.test(j.event || '')) {
        let d = j.data;
        try { d = typeof d === 'string' ? JSON.parse(d) : d; } catch (_) { d = {}; }
        aoMsg((d && d.content) || '');
      } else if (j.event === 'pusher:ping') {
        try { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); } catch (_) {}
      }
    };
    ws.onclose = () => {
      if (fechado) return;
      if (!deuCerto && chaveIdx >= CHAVES_KICK.length) { aoStatus('sem chat'); return; }
      aoStatus('reconectando');
      setTimeout(conectar, 3000);
    };
    ws.onerror = () => {};
  };

  fetch('https://kick.com/api/v2/channels/' + encodeURIComponent(slug), { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((j) => { sala = j && j.chatroom && j.chatroom.id; if (sala) conectar(); else aoStatus('sem chat'); })
    .catch(() => aoStatus('sem chat'));

  return () => { fechado = true; try { ws && ws.close(); } catch (_) {} };
}

// ---------------------------------------------------------------- a sessao

class SessaoAoVivo {
  /**
   * @param {object} o  { url, formato, recorte, duracao, auto, sensibilidade,
   *                      bufferMin, salvarOriginal, sugerirTitulo }
   * @param {function} emitir  manda um evento pra janela
   */
  constructor(o, emitir) {
    this.url = normalizarLink(o.url);
    this.plataforma = plataformaDe(this.url);
    this.canal = canalDoLink(this.url);
    this.formato = ['split', 'vertical', 'foco', 'blur', 'original'].includes(o.formato) ? o.formato : 'vertical';
    this.recorte = o.recorte || null;
    this.semFaixasPretas = o.semFaixasPretas !== false; // opção: tirar a tarja preta do jogo/filme
    this.duracao = limitar(Number(o.duracao) || 30, 10, 120);
    this.auto = o.auto !== false;
    this.sensibilidade = LIMIAR[o.sensibilidade] ? o.sensibilidade : 'media';
    this.bufferMin = limitar(Number(o.bufferMin) || 20, 3, 120);
    this.salvarOriginal = o.salvarOriginal !== false;
    this.sugerirTitulo = o.sugerirTitulo !== false;
    // o chat publico da live: sem conta e sem chave, mas da pra desligar
    this.lerChat = o.lerChat !== false;
    this.idioma = /^[a-z]{2}$|^auto$/.test(String(o.idioma || '')) ? o.idioma : 'pt';
    // texto fixo na tela de todo clipe: { texto, posicao, duracao, cor, tamanho }
    this.textoFixo = o.textoFixo || null;
    // "preparar": conecta e ja guarda a live, mas so clipa depois que a pessoa
    // marcar webcam/foco/texto e apertar "Comecar a clipar"
    this.clipando = !o.preparar;
    this.emitir = emitir;

    this.id = Date.now().toString(36);
    this.dir = path.join(pastas.aoVivo(), this.id);
    this.estado = 'conectando';
    this.chatStatus = o.lerChat === false ? 'desligado' : (this.plataforma === 'youtube' ? 'sem chat' : 'conectando');
    this.titulo = null;
    this.inicio = Date.now();

    this.pedacos = [];       // { nome, arquivo, t0, dur, travas }
    this.lidosPorRodada = 0;
    this.rodada = 0;
    this.proxNumero = 0;
    this.total = 0;          // segundos gravados (linha do tempo da sessao)
    this.ancora = null;      // { wall, t }: o fim do pedaco mais novo e quando chegou

    this.audio = [];         // { t, db } a cada meio segundo
    this.chat = [];          // { w (ms), peso }
    this.historicoChat = []; // taxa a cada segundo, pra linha de base
    this.ultimoGatilho = -Infinity;
    this.pendente = null;    // gatilho esperando o resto do trecho ser gravado

    this.fila = [];          // clipes pra renderizar
    this.renderizando = false;
    this.originais = [];     // clipes esperando o original com folga (pra editar)
    this.fazendoOriginal = false;
    this.clipes = [];
    this.parado = false;
  }

  async iniciar() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.status('conectando', 'Procurando a live...');
    const r = await resolverAoVivo(this.url);
    if (!r.aoVivo || !r.m3u8) {
      throw new Error(r.offline
        ? 'Esse canal não está ao vivo agora. Pra live que já acabou, use o modo "Vídeo gravado" com o link do VOD.'
        : 'Esse link não é de uma live acontecendo agora.');
    }
    this.titulo = r.titulo;
    this.canal = this.canal || limparNome(r.canal || 'live').toLowerCase();
    this.nomeCanal = r.canal || this.canal;

    const perfil = sessoes.pegar();
    const d = new Date();
    const dois = (n) => String(n).padStart(2, '0');
    const carimbo = d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate()) + '_' + dois(d.getHours()) + 'h' + dois(d.getMinutes());
    this.pasta = path.join(sessoes.pastaDeSaida(perfil, pastas.saida()), limparNome(this.nomeCanal) + '_ao-vivo_' + carimbo);
    fs.mkdirSync(this.pasta, { recursive: true });

    this.gravar(r.m3u8, r.audio);
    this.ligarChat();
    this.relogio = setInterval(() => this.tique(), 1000);
  }

  status(estado, msg) {
    this.estado = estado;
    this.emitir(Object.assign({ tipo: 'estado', msg: msg || null }, this.resumo()));
  }

  resumo() {
    return {
      estado: this.estado,
      url: this.url,
      plataforma: this.plataforma,
      canal: this.nomeCanal || this.canal,
      titulo: this.titulo,
      chat: this.chatStatus,
      gravado: Math.round(this.total),
      buffer: Math.round(this.pedacos.reduce((s, p) => s + p.dur, 0)),
      desde: this.inicio,
      auto: this.auto,
      sensibilidade: this.sensibilidade,
      duracao: this.duracao,
      formato: this.formato,
      pasta: this.pasta || null,
      quantidade: this.clipes.length,
      clipando: this.clipando,
      textoFixo: this.textoFixo,
      // o pedaco mais novo: e dele que sai a imagem pra marcar webcam e foco
      ultimoPedaco: this.ultimoPedaco(),
      // por que ainda nao tem imagem (a tela de preparo mostra)
      problema: this.ultimoProblema || null,
      viaYtDlp: !!this.viaYtDlp,
    };
  }

  // ------------------------------------------------------------ gravacao

  async gravar(m3u8, audio) {
    if (this.plataforma === 'twitch') return this.gravarTwitch(m3u8);
    const { ffmpeg } = await media.garantirFfmpeg();
    this.rodada++;
    this.lidosPorRodada = 0;
    const csv = path.join(this.dir, 'lista-' + this.rodada + '.csv');
    this.csvAtual = csv;
    const pedacosAntes = this.pedacos.length;
    this.ultimoPedacoEm = Date.now();

    // Segundo caminho: o proprio yt-dlp baixa a live e entrega pro ffmpeg.
    // Ele manda os cabecalhos que o site espera - passa onde o ffmpeg direto
    // toma recusa (aconteceu com a Kick no PC de quem usa).
    let yt = null;
    let entrada = ['-i', m3u8];
    if (this.viaYtDlp) {
      const bin = await baixador.garantirYtDlp();
      yt = spawn(bin, ['--no-warnings', '--no-part', '--hls-use-mpegts', '-f', FORMATO_UNICO, '-o', '-', this.url], { windowsHide: true });
      yt.stderr.setEncoding('utf8');
      yt.stderr.on('data', (d) => { this.erroYt = (String(this.erroYt || '') + d.toString()).slice(-600); });
      yt.on('error', () => {});
      this.procYt = yt;
      entrada = ['-i', 'pipe:0'];
      audio = null;
    }
    const args = [
      '-hide_banner', '-loglevel', 'error',
    ].concat(this.viaYtDlp ? [] : ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'])
    .concat(entrada).concat(audio ? [
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      '-i', audio, '-map', '0:v:0', '-map', '1:a:0',
    ] : ['-map', '0:v:0', '-map', '0:a:0?']).concat([
      '-c', 'copy',
      '-f', 'segment', '-segment_time', String(DUR_PEDACO), '-reset_timestamps', '1',
      '-segment_start_number', String(this.proxNumero),
      '-segment_list', csv, '-segment_list_type', 'csv',
      path.join(this.dir, 'p%07d.ts'),
    ]);
    this.proc = spawn(ffmpeg, args, { windowsHide: true });
    if (yt) { yt.stdout.pipe(this.proc.stdin); this.proc.stdin.on('error', () => {}); }
    let erro = '';
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { erro = (erro + d.toString()).slice(-800); });
    this.proc.on('close', () => {
      this.proc = null;
      if (yt) { try { yt.kill(); } catch (_) {} this.procYt = null; }
      this.lerLista(); // o ultimo pedaco
      if (this.parado) return;

      // Caiu sem gravar nada: e recusa, nao queda. Diz o motivo na tela e,
      // na segunda vez, troca pro caminho pelo yt-dlp.
      if (this.pedacos.length === pedacosAntes) {
        this.falhasSeguidas = (this.falhasSeguidas || 0) + 1;
        this.ultimoProblema = motivoDaFalha(erro + ' ' + (yt ? this.erroYt || '' : ''));
        if (this.falhasSeguidas >= 2 && !this.viaYtDlp) {
          this.viaYtDlp = true;
          this.emitir({ tipo: 'aviso', msg: 'Não consegui gravar direto (' + this.ultimoProblema + '). Tentando gravar pelo yt-dlp...' });
        } else {
          this.emitir({ tipo: 'aviso', msg: 'A gravação não começou: ' + this.ultimoProblema + '. Tentando de novo...' });
        }
      } else {
        this.falhasSeguidas = 0;
      }
      this.status('reconectando', this.ultimoProblema && this.falhasSeguidas ? 'Tentando de novo: ' + this.ultimoProblema : 'A transmissão caiu. Reconectando...');
      setTimeout(() => this.reconectar(), 3000);
    });
    this.status('gravando', 'Gravando a live.');
  }

  /**
   * Twitch: le a playlist da live direto, pedaco por pedaco (2s cada).
   *
   * Pra quem assiste sem login a Twitch costura anuncio dentro da propria
   * transmissao - 30s logo ao conectar, e mais quando o streamer roda
   * comercial. O pedaco de live vem marcado como "live" e o de anuncio como
   * "Amazon|..." (ou outro nome): aqui o anuncio e jogado fora, entao nenhum
   * clipe sai com a tela roxa de "Commercial break". Durante o anuncio a
   * Twitch nao manda a live, entao esse pedaco fica sem gravar.
   */
  async gravarTwitch(m3u8) {
    const rodada = ++this.rodada;
    let ultimoSeq = -1;
    let falhas = 0;
    let emAnuncio = false;
    this.status('gravando', 'Gravando a live.');

    const passo = async () => {
      if (this.parado || rodada !== this.rodada) return;
      try {
        const r = await fetch(m3u8, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error('playlist ' + r.status);
        const texto = await r.text();
        if (/#EXT-X-ENDLIST/.test(texto) && !/#EXTINF/.test(texto)) throw new Error('fim');
        let seq = Number((/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(texto) || [])[1] || 0);
        let inf = null;
        const novos = [];
        for (const linha of texto.split(/\r?\n/)) {
          if (linha.startsWith('#EXTINF:')) {
            const m = /#EXTINF:([\d.]+),?(.*)$/.exec(linha);
            inf = { dur: Number(m && m[1]) || 2, titulo: (m && m[2] || '').trim() };
          } else if (linha && !linha.startsWith('#')) {
            if (inf && seq > ultimoSeq) novos.push({ seq, url: new URL(linha, m3u8).href, dur: inf.dur, anuncio: !!inf.titulo && inf.titulo !== 'live' });
            seq++;
            inf = null;
          }
        }
        for (const s of novos) {
          if (this.parado || rodada !== this.rodada) return;
          ultimoSeq = s.seq;
          if (s.anuncio) {
            if (!emAnuncio) {
              emAnuncio = true;
              this.emitir({ tipo: 'aviso', msg: 'A Twitch está passando anúncio: esse pedaço é pulado (nenhum clipe sai com anúncio).' });
            }
            continue;
          }
          if (emAnuncio) { emAnuncio = false; this.emitir({ tipo: 'aviso', msg: 'Anúncio acabou, voltou a gravar a live.' }); }
          const resp = await fetch(s.url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const nome = 'p' + String(this.proxNumero++).padStart(7, '0') + '.ts';
          const arquivo = path.join(this.dir, nome);
          fs.writeFileSync(arquivo, Buffer.from(await resp.arrayBuffer()));
          this.adicionarPedaco(nome, arquivo, s.dur);
        }
        falhas = 0;
      } catch (e) {
        if (++falhas >= 5 || /fim/.test(e.message)) {
          if (rodada !== this.rodada || this.parado) return;
          this.status('reconectando', 'A transmissão caiu. Reconectando...');
          return setTimeout(() => this.reconectar(), 3000);
        }
      }
      setTimeout(passo, 1500);
    };
    passo();
  }

  async reconectar() {
    if (this.parado) return;
    try {
      const r = await resolverAoVivo(this.url);
      if (!r.aoVivo || !r.m3u8) {
        this.status('encerrada', 'A live acabou. Os clipes feitos estão salvos.');
        return this.parar(true);
      }
      this.gravar(r.m3u8, r.audio);
    } catch (e) {
      this.emitir({ tipo: 'aviso', msg: 'Não consegui reconectar (' + e.message + '). Tentando de novo...' });
      setTimeout(() => this.reconectar(), 8000);
    }
  }

  /** Le os pedacos que o ffmpeg ja fechou (o csv so lista pedaco completo). */
  lerLista() {
    let texto;
    try { texto = fs.readFileSync(this.csvAtual, 'utf8'); } catch (_) { return; }
    const linhas = texto.split(/\r?\n/).filter(Boolean);
    const novas = linhas.slice(this.lidosPorRodada);
    this.lidosPorRodada = linhas.length;
    for (const l of novas) {
      const [nome, ini, fim] = l.split(',');
      const dur = Math.max(0.1, Number(fim) - Number(ini));
      if (!isFinite(dur)) continue;
      const n = Number((/(\d+)\.ts$/.exec(nome) || [])[1]);
      if (isFinite(n)) this.proxNumero = n + 1;
      this.adicionarPedaco(nome, path.join(this.dir, nome), dur);
    }
  }

  adicionarPedaco(nome, arquivo, dur) {
    const p = { nome, arquivo, t0: this.total, dur, travas: 0 };
    this.pedacos.push(p);
    this.total += dur;
    this.ancora = { wall: Date.now(), t: this.total };
    this.ultimoPedacoEm = Date.now();
    this.ultimoProblema = null;
    this.medirAudio(p);
  }

  /** Volume a cada meio segundo, em dB - o pico de grito/risada aparece aqui. */
  async medirAudio(p) {
    const { ffmpeg } = await media.garantirFfmpeg();
    const s = await new Promise((res) => {
      const proc = spawn(ffmpeg, ['-hide_banner', '-i', p.arquivo,
        '-af', 'aresample=8000,asetnsamples=4000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
        '-f', 'null', '-'], { windowsHide: true });
      let t = '';
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => { t += d.toString(); });
      proc.on('close', () => res(t));
      proc.on('error', () => res(''));
    });
    const vals = [...s.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -90 : Number(m[1])));
    vals.forEach((db, i) => this.audio.push({ t: p.t0 + i * 0.5, db: isFinite(db) ? Math.max(-90, db) : -90 }));
    // so os ultimos 6 minutos importam pra linha de base
    const corte = this.total - 360;
    while (this.audio.length && this.audio[0].t < corte) this.audio.shift();
  }

  // ------------------------------------------------------------ chat

  ligarChat() {
    if (!this.lerChat) return;
    const aoMsg = (texto) => this.chat.push({ w: Date.now(), peso: HYPE.test(texto) ? 2 : 1 });
    const aoStatus = (s) => {
      if (s === this.chatStatus) return;
      this.chatStatus = s;
      if (s === 'sem chat') {
        this.emitir({ tipo: 'aviso', msg: 'Não consegui ler o chat dessa live: a detecção automática vai usar só o volume do streamer.' });
      }
      this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
    };
    if (this.plataforma === 'twitch' && this.canal) this.fecharChat = chatTwitch(this.canal, aoMsg, aoStatus);
    else if (this.plataforma === 'kick' && this.canal) this.fecharChat = chatKick(this.canal, aoMsg, aoStatus);
    else this.chatStatus = 'sem chat';
  }

  /** "Agora" na linha do tempo da gravacao. */
  agora() {
    if (!this.ancora) return 0;
    return this.ancora.t + (Date.now() - this.ancora.wall) / 1000;
  }

  // ------------------------------------------------------------ o relogio

  tique() {
    if (this.parado) return;
    this.lerLista();
    this.proximoOriginal();
    this.limparBuffer();

    // Cao de guarda: o ffmpeg pode ficar "conectado" sem gravar nada (site
    // segurando a conexao). 40s sem pedaco novo = derruba e tenta de novo,
    // em vez de deixar a tela esperando a primeira imagem pra sempre.
    if (this.proc && this.ultimoPedacoEm && Date.now() - this.ultimoPedacoEm > 40000) {
      this.ultimoPedacoEm = Date.now();
      try { this.proc.kill(); } catch (_) {}
    }

    const nivel = this.medirNivel();
    if (nivel) {
      this.emitir(Object.assign({ tipo: 'nivel' }, nivel, { gravado: Math.round(this.total) }));
      if (this.clipando && this.auto && !this.pendente && nivel.nivel >= LIMIAR[this.sensibilidade] &&
          this.agora() - this.ultimoGatilho > Math.max(35, this.duracao * 0.9)) {
        this.disparar(nivel);
      }
    }

    // o gatilho espera o "depois" do lance ser gravado pra cortar
    if (this.pendente && this.total >= this.pendente.fim) {
      const p = this.pendente;
      this.pendente = null;
      this.enfileirar(p);
    }
  }

  medirNivel() {
    if (this.total < 30) return null;
    const agoraW = Date.now();

    // chat: mensagens (com peso) nos ultimos 5s, contra a mediana dos ultimos 5 min
    let cur = 0;
    while (this.chat.length && this.chat[0].w < agoraW - 300000) this.chat.shift();
    for (let i = this.chat.length - 1; i >= 0 && this.chat[i].w >= agoraW - 5000; i--) cur += this.chat[i].peso;
    this.historicoChat.push(cur);
    if (this.historicoChat.length > 300) this.historicoChat.shift();
    const baseChat = mediana(this.historicoChat);
    const temChat = this.chatStatus === 'conectado' && this.historicoChat.length >= 20;
    const razao = (cur + 1) / (baseChat + 1);
    const notaChat = temChat && cur >= 4 ? limitar((razao - 1.6) / 2.4, 0, 1) : 0;

    // audio: o mais alto dos ultimos 4s gravados, contra a mediana
    const fim = this.total;
    const recentes = this.audio.filter((a) => a.t >= fim - 4).map((a) => a.db);
    const base = mediana(this.audio.filter((a) => a.db > -80).map((a) => a.db));
    const pico = recentes.length ? Math.max.apply(null, recentes) : -90;
    // sem medicao recente (o pedaco novo ainda esta sendo medido) nao inventa numero
    const delta = this.audio.length > 40 && recentes.length ? Math.max(0, pico - base) : null;
    const notaAudio = delta == null ? 0 : limitar((delta - 6) / 10, 0, 1);

    // os dois juntos valem mais; um so, bem forte, tambem dispara
    const junto = temChat ? 0.6 * notaChat + 0.5 * notaAudio : notaAudio;
    const n = Math.round(100 * limitar(Math.max(junto, notaChat * 0.85, notaAudio * 0.8), 0, 1));

    return {
      nivel: n,
      chat: cur,
      chatBase: Math.round(baseChat * 10) / 10,
      razaoChat: Math.round(razao * 10) / 10,
      deltaDb: delta == null ? null : Math.round(delta * 10) / 10,
      notaChat, notaAudio,
    };
  }

  disparar(nivel) {
    // o pico: o chat reage uns 3s depois do lance; o grito e na hora
    const t = this.agora() - (nivel.notaChat >= nivel.notaAudio ? 3 : 1);
    const antes = this.duracao * 0.7;
    const motivos = [];
    if (nivel.notaChat > 0) motivos.push({ fator: 'Chat explodiu (' + nivel.razaoChat + 'x o normal)', pontos: Math.round(nivel.notaChat * 50) });
    if (nivel.notaAudio > 0) motivos.push({ fator: 'Pico de volume (+' + nivel.deltaDb + ' dB)', pontos: Math.round(nivel.notaAudio * 50) });
    this.ultimoGatilho = t;
    this.pendente = {
      origem: 'auto',
      inicio: Math.max(0, t - antes),
      fim: t + (this.duracao - antes),
      nota: nivel.nivel,
      motivos,
    };
    // trava os pedacos que vao ser usados, pro buffer nao apagar antes do corte
    this.travar(this.pendente, 1);
    this.emitir({ tipo: 'gatilho', origem: 'auto', motivos, nivel: nivel.nivel, emSegundos: Math.max(0, Math.round(this.pendente.fim - this.total)) });
  }

  /** CLIPAR AGORA: os ultimos N segundos que ja estao gravados. */
  cliparAgora(segundos) {
    if (!this.clipando) throw new Error('Termine de configurar e aperte "Começar a clipar".');
    if (this.total < 5) throw new Error('Ainda não deu tempo de gravar nada. Espere alguns segundos.');
    const dur = limitar(Number(segundos) || this.duracao, 5, 180);
    const fim = this.total;
    const pedido = {
      origem: 'manual',
      inicio: Math.max(this.pedacos.length ? this.pedacos[0].t0 : 0, fim - dur),
      fim,
      nota: null,
      motivos: [{ fator: 'Você apertou CLIPAR', pontos: 0 }],
    };
    this.ultimoGatilho = this.agora();
    this.travar(pedido, 1);
    this.enfileirar(pedido, true);
    this.emitir({ tipo: 'gatilho', origem: 'manual', motivos: pedido.motivos, emSegundos: 0 });
  }

  travar(pedido, d) {
    for (const p of this.pedacos) {
      if (p.t0 < pedido.fim + 1 && p.t0 + p.dur > pedido.inicio - 1) p.travas = Math.max(0, p.travas + d);
    }
  }

  limparBuffer() {
    const limite = this.total - this.bufferMin * 60;
    while (this.pedacos.length && this.pedacos[0].t0 + this.pedacos[0].dur < limite && !this.pedacos[0].travas) {
      const p = this.pedacos.shift();
      try { fs.unlinkSync(p.arquivo); } catch (_) {}
    }
  }

  // ------------------------------------------------------------ corte

  enfileirar(pedido, naFrente) {
    if (naFrente) this.fila.unshift(pedido); else this.fila.push(pedido);
    this.proximoRender();
  }

  async proximoRender() {
    if (this.renderizando || !this.fila.length) return;
    this.renderizando = true;
    const pedido = this.fila.shift();
    try {
      await this.renderizar(pedido);
    } catch (e) {
      this.emitir({ tipo: 'aviso', msg: 'Um clipe falhou: ' + (e.message || e) });
    } finally {
      this.travar(pedido, -1);
      this.renderizando = false;
      this.proximoRender();
    }
  }

  async renderizar(pedido) {
    const { ffmpeg } = await media.garantirFfmpeg();
    const usados = this.pedacos.filter((p) => p.t0 < pedido.fim && p.t0 + p.dur > pedido.inicio && fs.existsSync(p.arquivo));
    if (!usados.length) throw new Error('esse trecho já saiu do buffer');

    const numero = this.clipes.length + 1;
    const nomeBase = 'clipe-' + String(numero).padStart(2, '0') + '-' + hms(pedido.inicio).replace(/:/g, '-');
    const lista = path.join(this.dir, nomeBase + '.txt');
    fs.writeFileSync(lista, usados.map((p) => "file '" + p.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');

    const deslocamento = Math.max(0, pedido.inicio - usados[0].t0);
    const dur = Math.min(pedido.fim, usados[usados.length - 1].t0 + usados[usados.length - 1].dur) - Math.max(pedido.inicio, usados[0].t0);
    const mp4 = path.join(this.pasta, nomeBase + '.mp4');
    const t0 = Date.now();
    this.emitir({ tipo: 'renderizando', numero, origem: pedido.origem });

    let filtro = media.filtroDeFormato(this.formato, this.recorte);
    // texto fixo da tela (.ass na pasta de trabalho, o ffmpeg roda la dentro)
    let ass = null;
    if (filtro && legenda.temTextoFixo(this.textoFixo)) {
      fs.mkdirSync(pastas.trabalho(), { recursive: true });
      ass = 'aovivo-texto-' + this.id + '.ass';
      legenda.gerarAss([], 0, path.join(pastas.trabalho(), ass), { incluirPalavras: false, textoFixo: this.textoFixo, alturaDivisao: legenda.alturaDaDivisao(this.formato, this.recorte) });
    }
    // Voz atrasada: pular direto pro meio da lista de pedacos (concat + -ss)
    // fazia a imagem so comecar no proximo quadro-chave, 1-2s depois do som -
    // e TikTok/CapCut, que ignoram esse vao, tocavam a voz atrasada. Agora os
    // pedacos viram primeiro UM arquivo continuo (comeca num quadro-chave,
    // imagem e som juntos) e o corte exato e feito nele. Em .mkv, e nao .ts:
    // o .ts nao tem indice e o pulo caia depois do quadro-chave (mesmo vao).
    const junto = path.join(this.dir, nomeBase + '-junto.mkv');
    await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'matroska', junto]);
    try { fs.unlinkSync(lista); } catch (_) {}

    // Opção "sem faixas pretas": mede a tarja no trecho e o jogo ocupa só a parte com imagem.
    if (filtro && this.semFaixasPretas && this.recorte && (this.formato === 'split' || this.formato === 'foco')) {
      try {
        const faixas = await media.acharFaixasPretas(junto, deslocamento, dur);
        if (faixas) filtro = media.filtroDeFormato(this.formato, { ...this.recorte, faixas });
      } catch (_) { /* sem medição: segue com o enquadramento marcado */ }
    }

    let args;
    try {
      if (filtro) {
        // -ss antes da entrada num arquivo comum: corte exato (decodifica desde
        // o quadro-chave e descarta o que vem antes), e o clipe comeca no 0 -
        // o texto "so no comeco" conta a partir dali.
        const fs2 = ass ? filtro.replace(/\[v\]$/, ',subtitles=' + ass + (fontsdirRelativo() ? ':fontsdir=' + fontsdirRelativo() : '') + '[v]') : filtro;
        args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', deslocamento.toFixed(3),
          '-i', junto, '-t', dur.toFixed(3),
          '-filter_complex', fs2, '-map', '[v]', '-map', '0:a?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'];
      } else {
        // sem mexer na imagem, mas recodificando: copiar (-c copy) so comeca num
        // quadro-chave, e o clipe saia ate alguns segundos antes do lance e mais
        // comprido que o pedido. Recodificar corta no quadro exato.
        args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', deslocamento.toFixed(3), '-i', junto,
          '-t', dur.toFixed(3), '-map', '0:v:0', '-map', '0:a?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'];
      }
      args.push('-movflags', '+faststart', mp4);
      await media.rodar(ffmpeg, args, { cwd: pastas.trabalho() });

    } finally {
      try { fs.unlinkSync(junto); } catch (_) {}
    }

    const jpg = path.join(this.pasta, nomeBase + '.jpg');
    try { await media.gerarMiniatura(mp4, Math.min(dur / 2, 8), jpg, this.formato !== 'original'); } catch (_) {}

    const nota = pedido.nota != null ? pedido.nota : 70;
    const clipe = {
      numero,
      origem: pedido.origem,
      nota,
      rotulo: rotuloDoNivel(nota),
      titulo: (this.nomeCanal || this.canal || 'Live') + ' ao vivo · ' + hms(pedido.inicio),
      titulos: [],
      inicio: Math.round(pedido.inicio * 10) / 10,
      fim: Math.round((pedido.inicio + dur) * 10) / 10,
      duracao: Math.round(dur * 10) / 10,
      inicioTexto: hms(pedido.inicio),
      fimTexto: hms(pedido.inicio + dur),
      quando: new Date().toISOString(),
      motivos: pedido.motivos,
      texto: '',
      hashtags: /\bgta\b|vice city|leonida/i.test(this.titulo || '') ? ['gta6', 'gtavi', 'gta'] : ['cortes', 'live'],
      arquivo: mp4,
      nomeArquivo: path.basename(mp4),
      original: null,
      miniatura: fs.existsSync(jpg) ? jpg : null,
      formatoUsado: this.formato,
      // o enquadramento e o texto de quando o clipe saiu: o editor refaz igual
      recorte: this.recorte || null,
      textoFixo: this.textoFixo || null,
      legendar: false,
      tamanhoMb: Math.round((fs.statSync(mp4).size / 1048576) * 10) / 10,
      segundosPraFicarPronto: Math.round((Date.now() - t0) / 100) / 10,
    };
    // titulo com SEO na hora (streamer + jogo + o que aconteceu), sem esperar a
    // fala: assim o clipe ja sai pronto pra postar. Melhora quando a fala chega.
    try {
      const cp = gerarCopy({ texto: '', inicio: pedido.inicio, motivos: pedido.motivos, origem: pedido.origem },
        { texto: this.titulo || '', canal: this.nomeCanal || this.canal || '', evitar: (this.titulosUsados = this.titulosUsados || new Set()) }, sessoes.pegar());
      if (cp && cp.titulo) { clipe.titulo = cp.titulo; clipe.titulos = cp.titulos; clipe.hashtags = cp.hashtags; this.titulosUsados.add(cp.titulo.toLowerCase()); }
    } catch (_) { /* fica o titulo simples */ }
    clipe.legendaPost = clipe.titulo + '\n\n' + clipe.hashtags.map((h) => '#' + h).join(' ');
    this.clipes.push(clipe);
    this.gravarRelatorio();
    this.emitir({ tipo: 'clipe', clipe });

    this.agendarOriginal(clipe, pedido.inicio);
  }

  // ------------------------------------------------------------ edicao

  /**
   * Pra editar um clipe da live depois (ir, voltar, mexer na legenda), ele
   * precisa de um original proprio: o buffer da live e apagado. Assim que a
   * live gravar a folga depois do lance, monta a versao deitada com 10s antes
   * e 10s depois, transcreve a fala dela e guarda tudo na pasta do projeto.
   * O clipe ja apareceu pronto antes disso - nada aqui atrasa o "postar primeiro".
   */
  agendarOriginal(clipe, inicioNaLive) {
    const job = {
      clipe,
      inicioNaLive,
      inicio: Math.max(0, inicioNaLive - MARGEM_EDICAO),
      fim: inicioNaLive + clipe.duracao + MARGEM_EDICAO,
    };
    this.travar(job, 1);
    this.originais.push(job);
    this.proximoOriginal();
  }

  async proximoOriginal() {
    if (this.fazendoOriginal || !this.originais.length) return;
    const job = this.originais[0];
    // espera a folga depois do lance ser gravada (ou a live parar)
    if (!this.parado && this.total < job.fim) return;
    this.fazendoOriginal = true;
    this.originais.shift();
    const clipe = job.clipe;
    const base = path.basename(clipe.nomeArquivo, '.mp4');
    try {
      const { ffmpeg } = await media.garantirFfmpeg();
      const usados = this.pedacos.filter((p) => p.t0 < job.fim && p.t0 + p.dur > job.inicio && fs.existsSync(p.arquivo));
      if (!usados.length) throw new Error('esse trecho já saiu do buffer');
      const lista = path.join(this.dir, base + '-orig.txt');
      fs.writeFileSync(lista, usados.map((p) => "file '" + p.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'").join('\n'), 'utf8');
      const junto = path.join(this.dir, base + '-orig.mkv');
      const original = path.join(this.pasta, base + '-original.mp4');
      try {
        await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lista,
          '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'matroska', junto]);
        await media.rodar(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', junto,
          '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', original]);
      } finally {
        try { fs.unlinkSync(lista); } catch (_) {}
        try { fs.unlinkSync(junto); } catch (_) {}
      }

      // O original comeca no primeiro pedaco (que sempre abre num quadro-chave):
      // o clipe fica a "offset" segundos dele.
      const zero = usados[0].t0;
      const ultimo = usados[usados.length - 1];
      const offset = Math.round(Math.max(0, job.inicioNaLive - zero) * 100) / 100;
      clipe.original = original;
      clipe.fonte = {
        video: path.basename(original),
        duracao: Math.round((ultimo.t0 + ultimo.dur - zero) * 100) / 100,
        zeroNaLive: Math.round(zero * 100) / 100,
      };
      clipe.inicio = offset;
      clipe.fim = Math.round((offset + clipe.duracao) * 100) / 100;
      this.gravarRelatorio();
      this.emitir({ tipo: 'clipe-atualizado', clipe });

      // a fala do original: legenda editavel no editor e o titulo sugerido
      fs.mkdirSync(pastas.trabalho(), { recursive: true });
      const wav = path.join(pastas.trabalho(), 'aovivo-' + this.id + '-' + clipe.numero + '.wav');
      const fala = path.join(this.pasta, base + '-fala.json');
      try {
        await media.extrairAudio(original, wav, clipe.fonte.duracao);
        const t = await transcrever(wav, fala, clipe.fonte.duracao, 'base', this.idioma);
        clipe.fonte.transcricao = path.basename(fala);
        const palavras = (t.segmentos || []).reduce((acc, s) => acc.concat(s.palavras || []), [])
          .filter((p) => p.fim > offset && p.inicio < offset + clipe.duracao);
        const texto = palavras.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim();
        clipe.texto = texto;
        if (this.sugerirTitulo) {
          const cp = gerarCopy({ texto, inicio: offset, tags: [], palavras, motivos: clipe.motivos, origem: clipe.origem },
            { texto: this.titulo || '', canal: this.nomeCanal || this.canal || '', evitar: (this.titulosUsados = this.titulosUsados || new Set()) }, sessoes.pegar());
          if (clipe.titulo) this.titulosUsados.delete(String(clipe.titulo).toLowerCase());
          clipe.titulo = cp.titulo;
          this.titulosUsados.add(String(cp.titulo).toLowerCase());
          clipe.titulos = cp.titulos;
          clipe.hashtags = cp.hashtags;
          clipe.legendaPost = cp.legenda;
        }
        this.gravarRelatorio();
        this.emitir({ tipo: 'clipe-atualizado', clipe });
      } catch (e) {
        // trecho sem fala (so jogo, so musica) nao e erro: so fica sem legenda
        if (!/fala nenhuma/i.test(e.message)) this.emitir({ tipo: 'aviso', msg: 'Não consegui ouvir a fala do clipe ' + clipe.numero + ' (' + e.message + ').' });
      } finally {
        try { fs.unlinkSync(wav); } catch (_) {}
      }
    } catch (e) {
      this.emitir({ tipo: 'aviso', msg: 'O clipe ' + clipe.numero + ' está pronto, mas não deu pra preparar a edição dele (' + e.message + ').' });
    } finally {
      this.travar(job, -1);
      this.fazendoOriginal = false;
      this.proximoOriginal();
    }
  }

  gravarRelatorio() {
    const r = {
      nome: (this.nomeCanal || this.canal || 'live') + ' · ao vivo',
      videoOriginal: this.url,
      aoVivo: true,
      plataforma: this.plataforma,
      tituloDaLive: this.titulo,
      duracaoOriginal: Math.round(this.total),
      gerado: new Date(this.inicio).toISOString(),
      sessao: sessoes.pegar().id,
      formato: this.formato,
      clipes: this.clipes,
    };
    try { fs.writeFileSync(path.join(this.pasta, 'relatorio.json'), JSON.stringify(r, null, 2), 'utf8'); } catch (_) {}
    // o que o editor precisa pra refazer um clipe: cada clipe traz o proprio
    // original e enquadramento (campo fonte), entao aqui fica so o geral
    const sessao = {
      aoVivo: true,
      video: null,
      duracaoVideo: 0,
      opcoes: {
        sessao: sessoes.pegar().id, formato: this.formato, recorte: this.recorte, textoFixo: this.textoFixo,
        legendar: false, textoGancho: false, qualidade: 'alta', detectarWebcam: false, idioma: this.idioma,
      },
      clipes: this.clipes,
    };
    try { fs.writeFileSync(path.join(this.pasta, 'sessao.json'), JSON.stringify(sessao, null, 2), 'utf8'); } catch (_) {}
  }

  /** Um clipe refeito no editor passa a valer na lista da live (e no disco). */
  atualizarClipe(novo) {
    const i = this.clipes.findIndex((c) => c.numero === novo.numero);
    if (i < 0) return;
    this.clipes[i] = Object.assign({}, this.clipes[i], novo);
    this.gravarRelatorio();
    this.emitir({ tipo: 'clipe-atualizado', clipe: this.clipes[i] });
  }

  ajustar(o) {
    if (o.auto != null) this.auto = !!o.auto;
    if (LIMIAR[o.sensibilidade]) this.sensibilidade = o.sensibilidade;
    if (o.duracao) this.duracao = limitar(Number(o.duracao) || 30, 10, 120);
    if (['split', 'vertical', 'foco', 'blur', 'original'].includes(o.formato)) this.formato = o.formato;
    if (o.recorte) this.recorte = o.recorte;
    if (typeof o.semFaixasPretas === 'boolean') this.semFaixasPretas = o.semFaixasPretas;
    if (o.textoFixo !== undefined) this.textoFixo = o.textoFixo;
    if (o.clipando === true && !this.clipando) {
      this.clipando = true;
      // o nivel de antes nao dispara clipe: o automatico comeca agora
      this.ultimoGatilho = this.agora();
    }
    this.emitir(Object.assign({ tipo: 'estado' }, this.resumo()));
  }

  /** Ultimo pedaco gravado - pra mostrar a imagem da live e marcar a webcam. */
  ultimoPedaco() {
    return this.ultimosPedacos(1)[0] || null;
  }

  /** Os N pedacos mais novos que ainda estao no disco, do mais novo pro mais velho. */
  ultimosPedacos(n) {
    const lista = [];
    for (let i = this.pedacos.length - 1; i >= 0 && lista.length < n; i--) {
      if (fs.existsSync(this.pedacos[i].arquivo)) lista.push(this.pedacos[i].arquivo);
    }
    return lista;
  }

  parar(jaEncerrada) {
    if (this.parado) return;
    this.parado = true;
    clearInterval(this.relogio);
    if (this.fecharChat) this.fecharChat();
    if (this.proc) { try { this.proc.kill(); } catch (_) {} }
    if (this.procYt) { try { this.procYt.kill(); } catch (_) {} }
    // o que ainda esta na fila termina; depois o buffer (temporario) e apagado
    const limpar = () => {
      // termina os clipes na fila e os originais (pra editar) antes de apagar o buffer
      if (this.renderizando || this.fila.length || this.fazendoOriginal || this.originais.length) {
        this.proximoOriginal();
        return setTimeout(limpar, 2000);
      }
      for (const p of this.pedacos) { try { fs.unlinkSync(p.arquivo); } catch (_) {} }
      try {
        for (const n of fs.readdirSync(this.dir)) fs.unlinkSync(path.join(this.dir, n));
        fs.rmdirSync(this.dir);
      } catch (_) {}
      // conectou e cancelou sem clipar: a pasta do projeto ficou vazia.
      // rmdir so apaga pasta VAZIA - se tiver qualquer clipe, ela fica.
      if (!this.clipes.length && this.pasta) { try { fs.rmdirSync(this.pasta); } catch (_) {} }
    };
    setTimeout(limpar, 1500);
    if (!jaEncerrada) this.status('parado', 'Parou de gravar. Os clipes feitos estão salvos.');
  }
}

/**
 * O buffer e temporario: se o programa fechou no meio de uma live, os pedacos
 * ficaram pra tras. Ao abrir, apaga essas sobras (so .ts/.csv/.txt da pasta
 * ao-vivo - os clipes prontos ficam na pasta de saida, que nunca e tocada).
 */
function limparSobras() {
  let pastas = [];
  try { pastas = fs.readdirSync(pastas.aoVivo(), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return; }
  for (const d of pastas) {
    const dir = path.join(pastas.aoVivo(), d.name);
    try {
      for (const n of fs.readdirSync(dir)) {
        if (/\.(ts|mkv|csv|txt)$/i.test(n)) fs.unlinkSync(path.join(dir, n));
      }
      fs.rmdirSync(dir);
    } catch (_) {}
  }
}

module.exports = { SessaoAoVivo, limparSobras, checarLink, resolverAoVivo, plataformaDe, canalDoLink };
