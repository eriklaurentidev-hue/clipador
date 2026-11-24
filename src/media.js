'use strict';
/** Tudo que fala com ffmpeg: inspecionar, extrair audio, medir energia e cortar. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const desempenho = require('./desempenho');

// No Windows o winget instala o ffmpeg mas o PATH so vale em processo novo,
// entao procuramos nos lugares conhecidos do WinGet. No Linux/container o
// Da pra apontar um binario proprio por variavel de ambiente ou pelo PATH.
function acharBinario(nome) {
  const doAmbiente = process.env[nome.toUpperCase() + '_PATH'];
  if (doAmbiente) return [doAmbiente];

  if (process.platform !== 'win32') {
    return [nome, '/usr/bin/' + nome, '/usr/local/bin/' + nome];
  }

  const candidatos = [nome + '.exe'];
  const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    for (const dir of fs.readdirSync(base)) {
      if (!/ffmpeg/i.test(dir)) continue;
      const raiz = path.join(base, dir);
      for (const sub of fs.readdirSync(raiz)) {
        const alvo = path.join(raiz, sub, 'bin', nome + '.exe');
        if (fs.existsSync(alvo)) candidatos.push(alvo);
      }
    }
  } catch (_) { /* pasta do winget pode nao existir */ }
  candidatos.push(path.join('C:\\', 'ffmpeg', 'bin', nome + '.exe'));
  return candidatos;
}

let FFMPEG = null;
let FFPROBE = null;

function testar(cmd) {
  return new Promise((resolve) => {
    const p = spawn(cmd, ['-version'], { windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

async function garantirFfmpeg() {
  if (FFMPEG && FFPROBE) return { ffmpeg: FFMPEG, ffprobe: FFPROBE };
  for (const c of acharBinario('ffmpeg')) {
    if (await testar(c)) { FFMPEG = c; break; }
  }
  for (const c of acharBinario('ffprobe')) {
    if (await testar(c)) { FFPROBE = c; break; }
  }
  if (!FFMPEG || !FFPROBE) {
    throw new Error('Nao encontrei o ffmpeg. Rode o instalar.bat.');
  }
  return { ffmpeg: FFMPEG, ffprobe: FFPROBE };
}

function rodar(cmd, args, opcoes) {
  opcoes = opcoes || {};
  // placa de video (se ligada) ou processador no modo leve/total
  const ajuste = desempenho.adaptarFfmpeg(args);
  if (!ajuste.placa) return rodarUma(cmd, ajuste.args, opcoes);
  // na placa: se ela falhar nesse corte, refaz no processador sem a pessoa perceber
  return rodarUma(cmd, ajuste.args, opcoes).catch((e) => {
    desempenho.marcarPlacaQuebrada();
    console.error('[placa de video] falhou, voltando pro processador:', String(e.message).slice(0, 300));
    return rodarUma(cmd, desempenho.argsDoFfmpeg(args), opcoes);
  });
}

function rodarUma(cmd, args, opcoes) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd: opcoes.cwd });
    desempenho.aliviar(p);
    let saida = '';
    let erro = '';

    p.stdout.setEncoding('utf8');

    p.stdout.on('data', (d) => {
      const t = d.toString();
      saida += t;
      if (opcoes.aoProgredir) {
        for (const linha of t.split(/\r?\n/)) {
          const m = /^out_time_ms=(\d+)/.exec(linha);
          if (m) opcoes.aoProgredir(Number(m[1]) / 1e6);
        }
      }
    });
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erro += d.toString(); if (erro.length > 60000) erro = erro.slice(-40000); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(saida);
      else reject(new Error('ffmpeg falhou (codigo ' + code + '):\n' + erro.split(/\r?\n/).slice(-12).join('\n')));
    });
  });
}

/** Duracao, resolucao e se tem audio. */
async function inspecionar(video) {
  const { ffprobe } = await garantirFfmpeg();
  const saida = await rodar(ffprobe, [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', video,
  ]);
  const info = JSON.parse(saida);
  const v = (info.streams || []).find((s) => s.codec_type === 'video');
  const a = (info.streams || []).find((s) => s.codec_type === 'audio');
  return {
    duracao: Number((info.format || {}).duration || 0),
    largura: v ? v.width : 0,
    altura: v ? v.height : 0,
    temAudio: !!a,
    temVideo: !!v,
    fps: v && v.r_frame_rate ? eval2(v.r_frame_rate) : 30,
  };
}

function eval2(fracao) {
  const p = String(fracao).split('/');
  const n = Number(p[0]);
  const d = Number(p[1] || 1);
  return d ? Math.round((n / d) * 100) / 100 : 30;
}

/** Extrai audio 16kHz mono - formato que o Whisper quer e que da pra medir energia. */
async function extrairAudio(video, destino, duracao, aoProgredir) {
  const { ffmpeg } = await garantirFfmpeg();
  await rodar(ffmpeg, [
    '-y', '-i', video,
    '-vn', '-ac', '1', '-ar', '16000',
    '-c:a', 'pcm_s16le',
    '-progress', 'pipe:1', '-nostats',
    '-loglevel', 'error',
    destino,
  ], {
    aoProgredir: (seg) => {
      if (aoProgredir && duracao > 0) aoProgredir(Math.min(1, seg / duracao));
    },
  });
  return destino;
}

/**
 * RMS por segundo do WAV, normalizado de 0 a 1 pelo percentil 95.
 * Le direto do arquivo - e PCM 16 bits mono, entao e so somar quadrados.
 */
function energiaPorSegundo(wav) {
  const buf = fs.readFileSync(wav);
  const inicioDados = acharChunkData(buf);
  const amostrasPorSeg = 16000;
  const bytesPorSeg = amostrasPorSeg * 2;
  const totalSeg = Math.floor((buf.length - inicioDados) / bytesPorSeg);
  const bruto = new Array(totalSeg);

  for (let s = 0; s < totalSeg; s++) {
    let soma = 0;
    const base = inicioDados + s * bytesPorSeg;
    // Amostra 1 a cada 8 - suficiente pra energia e 8x mais rapido
    let n = 0;
    for (let i = 0; i < amostrasPorSeg; i += 8) {
      const v = buf.readInt16LE(base + i * 2) / 32768;
      soma += v * v;
      n++;
    }
    bruto[s] = Math.sqrt(soma / Math.max(1, n));
  }

  const ordenado = bruto.slice().sort((a, b) => a - b);
  const p95 = ordenado[Math.floor(ordenado.length * 0.95)] || 1;
  return bruto.map((v) => Math.min(1, v / (p95 || 1)));
}

function acharChunkData(buf) {
  // Pula o header RIFF ate o chunk "data"
  let pos = 12;
  while (pos + 8 < buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const tam = buf.readUInt32LE(pos + 4);
    if (id === 'data') return pos + 8;
    pos += 8 + tam + (tam % 2);
  }
  return 44;
}

const LARGURA = 1080;
const ALTURA = 1920;

/** Garante numero par - o libx264 com yuv420p exige dimensao par. */
function par(n) {
  n = Math.round(n);
  return n % 2 ? n + 1 : n;
}

/**
 * Perfis de compressao. Recodificar sempre e lossy, mas de crf 15 pra baixo a
 * diferenca some no olho - e o TikTok/Reels recomprime tudo de novo mesmo.
 */
// maxrate: teto de bitrate. Sem ele, cena de muito movimento no crf 15 passa
// de 25 Mbps e um clipe de 3 min estoura o limite de upload do app do TikTok.
// 16 Mbps continua bem acima do que Shorts/TikTok/Reels entregam no feed.
const QUALIDADES = {
  maxima:  { crf: '15', preset: 'slow',     audio: '256k', maxrate: '16M' },
  alta:    { crf: '18', preset: 'medium',   audio: '192k', maxrate: '12M' },
  rapida:  { crf: '23', preset: 'veryfast', audio: '128k', maxrate: '8M' },
};

function perfilDeQualidade(nome) {
  // Num servidor com CPU compartilhada, 'maxima' (crf 15 + preset slow) pode
  // levar uma hora so de encode em 8 clipes. QUALIDADE_PADRAO deixa o dono do
  // servidor baixar a fasquia sem mudar cada rodada.
  const padrao = QUALIDADES[process.env.QUALIDADE_PADRAO] ? process.env.QUALIDADE_PADRAO : 'maxima';
  return QUALIDADES[nome] || QUALIDADES[padrao];
}

/** #RRGGBB do seletor de cor vira 0xRRGGBB, que e o formato que o ffmpeg entende. */
function corParaFfmpeg(cor) {
  const limpa = String(cor || '#ffffff').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(limpa) ? '0x' + limpa : '0xffffff';
}

/** Monta o pedaco de filtro que recorta uma regiao (em fracao do frame) e a encaixa num tamanho fixo. */
function recorteEncaixado(entrada, area, largura, altura, saida) {
  const a = area || { x: 0, y: 0, w: 1, h: 1 };
  const cx = Math.max(0, Math.min(0.999, a.x));
  const cy = Math.max(0, Math.min(0.999, a.y));
  const cw = Math.max(0.02, Math.min(1 - cx, a.w));
  const ch = Math.max(0.02, Math.min(1 - cy, a.h));

  return '[' + entrada + ']crop=' +
    'iw*' + cw.toFixed(5) + ':ih*' + ch.toFixed(5) + ':' +
    'iw*' + cx.toFixed(5) + ':ih*' + cy.toFixed(5) + ',' +
    'scale=' + largura + ':' + altura + ':force_original_aspect_ratio=increase:flags=lanczos,' +
    'crop=' + largura + ':' + altura + ',setsar=1[' + saida + ']';
}

/**
 * Tira as faixas pretas (cena de cinema, video com tarja) da area do jogo.
 * faixas = { cima, baixo, esq, dir } em fracao do quadro, vindas do cropdetect.
 */
function semFaixasPretas(area, faixas) {
  const a = area || { x: 0, y: 0, w: 1, h: 1 };
  if (!faixas) return a;
  const x0 = Math.max(a.x, faixas.esq || 0), y0 = Math.max(a.y, faixas.cima || 0);
  const x1 = Math.min(a.x + a.w, 1 - (faixas.dir || 0)), y1 = Math.min(a.y + a.h, 1 - (faixas.baixo || 0));
  // Se sobrar pouco, a medicao errou (cena escura): fica com a area original.
  if (x1 - x0 < a.w * 0.5 || y1 - y0 < a.h * 0.5) return a;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Tira uma fracao de BAIXO da area (onde o jogo escreve as falas das cenas). */
function semRodape(area, fracao) {
  const a = area || { x: 0, y: 0, w: 1, h: 1 };
  const f = Math.max(0, Math.min(0.3, Number(fracao) || 0));
  return f ? { ...a, h: a.h * (1 - f) } : a;
}

/**
 * Mede as faixas pretas de um trecho com o cropdetect do ffmpeg, olhando
 * alguns segundos espalhados. Fica com a MAIOR area com imagem: se algum
 * momento do trecho ocupa a tela toda, nao corta nada (melhor sobrar tarja
 * do que cortar o jogo).
 * @returns {Promise<object|null>} { cima, baixo, esq, dir } ou null se nao tem faixa
 */
async function acharFaixasPretas(video, inicio, duracao) {
  const { ffmpeg } = await garantirFfmpeg();
  const pontos = [0.15, 0.5, 0.85].map((f) => Math.max(0, inicio + duracao * f));
  let L = 0, A = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const t of pontos) {
    let saida = '';
    try {
      saida = await new Promise((resolve) => {
        const p = spawn(ffmpeg, ['-hide_banner', '-ss', String(t), '-i', video, '-t', '1.2', '-vf', 'cropdetect=limit=24:round=2:reset=0', '-f', 'null', '-'], { windowsHide: true });
        let err = ''; p.stderr.on('data', (d) => { err += d; if (err.length > 400000) err = err.slice(-200000); });
        p.on('close', () => resolve(err)); p.on('error', () => resolve(''));
      });
    } catch (_) { continue; }
    const tam = saida.match(/Stream[^\n]*Video:[^\n]*?(\d{3,5})x(\d{3,5})/);
    const achados = [...saida.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    if (!tam || !achados.length) continue;
    L = Number(tam[1]); A = Number(tam[2]);
    const [, w, h, x, y] = achados[achados.length - 1].map(Number);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  if (!L || x1 < 0) return null;
  const f = { cima: y0 / A, baixo: (A - y1) / A, esq: x0 / L, dir: (L - x1) / L };
  // Ignora bordinha (compressao, 1-2% de escuro): so vale faixa de verdade.
  for (const k of Object.keys(f)) f[k] = f[k] >= 0.03 ? Math.round(f[k] * 1000) / 1000 : 0;
  return (f.cima || f.baixo || f.esq || f.dir) ? f : null;
}

/**
 * O video ja tem legenda "queimada" na imagem (fala do jogo, legenda de edicao)?
 *
 * Sinal: na faixa de baixo do quadro, legenda e texto quase branco e sem cor com
 * contorno/sombra escura grudada. Medido em GTA 6: quadros com legenda dao 15 a
 * 42 pontos; gameplay, menu e HUD sem legenda ficam entre 0 e 5. Olha 10
 * momentos e so conclui "tem" se 2 ou mais passarem de 9 (legenda vai e volta;
 * um HUD branco num quadro so nao basta).
 * @returns {Promise<{tem:boolean, quadros:number, olhados:number}>}
 */
async function temLegendaQueimada(video, duracao, trecho) {
  const { ffmpeg } = await garantirFfmpeg();
  const L = 960, A = 540;
  const dur = duracao || 600;
  // Video inteiro: 10 momentos espalhados. Um trecho (um clipe): 5 momentos dentro dele.
  const instantes = trecho
    ? [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => trecho.inicio + trecho.duracao * f)
    : [0.08, 0.17, 0.26, 0.35, 0.44, 0.53, 0.62, 0.71, 0.8, 0.9].map((f) => Math.max(1, dur * f));
  let quadros = 0, olhados = 0;
  for (const t of instantes) {
    let b;
    try {
      b = await rodarBinario(ffmpeg, ['-ss', String(Math.max(0, t)), '-i', video, '-frames:v', '1', '-f', 'rawvideo',
        '-pix_fmt', 'rgb24', '-s', L + 'x' + A, '-loglevel', 'error', 'pipe:1']);
    } catch (_) { continue; }
    if (!b || b.length < L * A * 3) continue;
    olhados++;
    let n = 0;
    const y0 = Math.round(A * 0.72), y1 = Math.round(A * 0.96), x0 = Math.round(L * 0.15), x1 = Math.round(L * 0.85);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * L + x) * 3, r = b[i], g = b[i + 1], bl = b[i + 2];
        const mn = Math.min(r, g, bl);
        if (mn < 185 || Math.max(r, g, bl) - mn > 35) continue;
        for (const d of [6, -6, L * 6, -L * 6]) {   // 2 px pros lados (3 bytes por pixel)
          const j = i + d;
          if (b[j] + b[j + 1] + b[j + 2] < 180) { n++; break; }
        }
      }
    }
    const pontos = 1000 * n / ((y1 - y0) * (x1 - x0));
    if (pontos >= 9) quadros++;
  }
  // num clipe curto, 1 quadro com legenda ja basta; no video inteiro, 2 ou mais
  return { tem: quadros >= (trecho ? 1 : 2), quadros, olhados };
}

/**
 * Filtro de video conforme o formato escolhido.
 * @param {string} formato  original | vertical | blur | split
 * @param {object} recorte  usado no split: { topo, baixo, proporcaoTopo }
 */
function filtroDeFormato(formato, recorte) {
  if (formato === 'original') return null;

  // Foco: usa so a area que a pessoa marcou (o jogo, em geral) e enquadra
  // ela em 9:16. Serve pro video que nao tem webcam separada.
  if (formato === 'foco') {
    const r = recorte || {};
    return recorteEncaixado('0:v', semRodape(semFaixasPretas(r.baixo, r.faixas), r.cortarBaixo), LARGURA, ALTURA, 'v');
  }

  if (formato === 'split') {
    // Estilo corte de streamer: a webcam em cima, o gameplay embaixo.
    const r = recorte || {};
    const fracao = Math.max(0.15, Math.min(0.6, r.proporcaoTopo || 0.3));
    const alturaTopo = par(ALTURA * fracao);
    const alturaBaixo = ALTURA - alturaTopo;

    // Jogo sem as faixas pretas de cinema (medidas antes do corte, ver
    // acharFaixasPretas): o enquadramento usa so a parte com imagem.
    const baixo = semRodape(semFaixasPretas(r.baixo, r.faixas), r.cortarBaixo);

    // Juncao em DEGRADE (padrao): a webcam desce um pouco alem da divisao e vai
    // sumindo por cima do comeco do jogo. Some a "faixa dura" entre os dois.
    // A mascara de transparencia e calculada uma vez (1 quadro) e repetida.
    if ((r.juncao || 'degrade') === 'degrade') {
      const funde = par(Math.max(80, Math.min(240, alturaTopo * 0.24)));
      const alturaCam = alturaTopo + funde;
      return [
        recorteEncaixado('0:v', r.topo, LARGURA, alturaCam, 'topoCru'),
        // nitidez so na webcam: ela costuma ser ampliada 2 a 3x e fica macia
        '[topoCru]unsharp=5:5:0.85:5:5:0,format=yuva420p[topoA]',
        'color=c=white:s=' + LARGURA + 'x' + alturaCam + ':r=1:d=1,format=gray,' +
          "geq=lum='if(lt(Y\\," + alturaTopo + ")\\,255\\,255*pow((H-Y)/" + funde + "\\,1.6))'[mascara]",
        '[topoA][mascara]alphamerge[topo]',
        recorteEncaixado('0:v', baixo, LARGURA, alturaBaixo, 'baixoCru'),
        '[baixoCru]format=yuv420p,pad=' + LARGURA + ':' + ALTURA + ':0:' + alturaTopo + ':black[fundo]',
        '[fundo][topo]overlay=0:0:format=yuv420:eof_action=repeat,setsar=1[v]',
      ].join(';');
    }

    // Juncao em LINHA: a faixa reta na divisa, na cor e grossura escolhidas.
    const linha = r.linha || {};
    const espessura = Math.max(0, Math.min(40, Number(linha.espessura) || 0));
    let divisoria = '';
    if (espessura > 0) {
      const cor = corParaFfmpeg(linha.cor);
      const y = Math.max(0, alturaTopo - Math.floor(espessura / 2));
      divisoria = ',drawbox=x=0:y=' + y + ':w=' + LARGURA + ':h=' + espessura +
                  ':color=' + cor + ':t=fill';
    }

    return [
      recorteEncaixado('0:v', r.topo, LARGURA, alturaTopo, 'topoCru'),
      '[topoCru]unsharp=5:5:0.85:5:5:0[topo]',
      recorteEncaixado('0:v', baixo, LARGURA, alturaBaixo, 'baixo'),
      '[topo][baixo]vstack=inputs=2,setsar=1' + divisoria + '[v]',
    ].join(';');
  }

  if (formato === 'blur') {
    // Video inteiro no centro, fundo borrado preenchendo o 9:16
    return '[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,' +
           'gblur=sigma=28,eq=brightness=-0.06[bg];' +
           '[0:v]scale=1080:-2:force_original_aspect_ratio=decrease:flags=lanczos[fg];' +
           '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]';
  }

  // vertical: preenche a tela cortando as laterais
  return '[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1[v]';
}

/**
 * Corta um clipe.
 * @param {object} o { video, inicio, duracao, destino, formato, arquivoAss,
 *                     pastaTrabalho, aoProgredir }
 */
async function cortarClipe(o) {
  const { ffmpeg } = await garantirFfmpeg();

  // Chamariz: os primeiros segundos mostram a carta que vai sair, depois o
  // video volta pro comeco da abertura e corre ate ela. Quem chega ja sabe
  // que vale esperar - e o gancho cobre justamente essa parte.
  // o.teaser = { inicio (tempo absoluto no video), duracao }
  const teaser = prepararTeaser(o);

  // Formato original tambem recodifica. Copiar bit a bit (-c copy) so consegue
  // comecar num quadro-chave: o clipe saia ate alguns segundos ANTES do ponto
  // escolhido e mais comprido que o pedido (medido: 9,3s num corte de 8s).

  const args = [
    '-y',
    '-ss', String(o.inicio),          // seek antes do input: rapido
    '-i', o.video,
    // com chamariz o resultado fica mais longo que o trecho lido
    '-t', String(o.duracao + (teaser ? teaser.duracao : 0)),
  ];

  const filtroBase = filtroDeFormato(o.formato, o.recorte);
  // A legenda entra depois do enquadramento, ja no tamanho final.
  // Rodamos o ffmpeg com cwd na pasta do .ass e passamos so o nome:
  // isso evita todo o inferno de escapar caminho do Windows no filtro.
  // fontsdir: fonte que vem com o programa (TikTok Sans do gancho do campeonato),
  // passada como caminho relativo a pasta de trabalho - sem ":" nem espaco pra escapar
  const legenda = o.arquivoAss ? "subtitles=" + o.arquivoAss + (o.fontsdir ? ":fontsdir=" + o.fontsdir : '') : null;

  // Monta a corrente em etapas, cada uma pegando o rotulo que a anterior
  // deixou. Assim enquadramento e legenda entram em qualquer combinacao sem
  // uma precisar saber da outra.
  const partes = [];
  let rotulo = '[0:v]';
  if (filtroBase) { partes.push(filtroBase); rotulo = '[v]'; }

  // O chamariz entra DEPOIS do enquadramento (pra sair ja no tamanho final) e
  // ANTES da legenda (pro gancho ficar por cima dos dois pedacos).
  let rotuloAudio = '0:a?';
  if (teaser) {
    const t0 = teaser.relativo.toFixed(3);
    const t1 = (teaser.relativo + teaser.duracao).toFixed(3);

    // Video e audio entram no MESMO concat. Fazer dois concats separados
    // dessincroniza: o corte de video cai em quadro e o de audio em amostra,
    // entao os dois pedacos saem com duracoes um pouco diferentes e o audio
    // desanda a partir da emenda. Com um concat so, o ffmpeg alinha o par.
    partes.push(rotulo + 'split=2[tzV1][tzV2]');
    partes.push('[tzV1]trim=start=' + t0 + ':end=' + t1 + ',setpts=PTS-STARTPTS[tzTV]');
    partes.push('[tzV2]setpts=PTS-STARTPTS[tzBV]');

    if (o.temAudio !== false) {
      partes.push('[0:a]asplit=2[tzA1][tzA2]');
      partes.push('[tzA1]atrim=start=' + t0 + ':end=' + t1 + ',asetpts=PTS-STARTPTS[tzTA]');
      partes.push('[tzA2]asetpts=PTS-STARTPTS[tzBA]');
      partes.push('[tzTV][tzTA][tzBV][tzBA]concat=n=2:v=1:a=1[vtz][atz]');
      rotulo = '[vtz]';
      rotuloAudio = '[atz]';
    } else {
      partes.push('[tzTV][tzBV]concat=n=2:v=1:a=0[vtz]');
      rotulo = '[vtz]';
    }
  }

  if (legenda) { partes.push(rotulo + legenda + '[vleg]'); rotulo = '[vleg]'; }

  if (partes.length) {
    args.push('-filter_complex', partes.join(';'), '-map', rotulo, '-map', rotuloAudio);
  }

  const q = perfilDeQualidade(o.qualidade);

  // O som comeca exatamente no zero, junto com a imagem: se o trecho tiver um vao
  // no comeco do audio (live gravada da Twitch/Kick as vezes tem), vira silencio.
  // Sem isso o arquivo dependia de "edit list", que o TikTok e o CapCut ignoram -
  // e a voz saia fora de tempo la (medido: 0,19s num clipe de VOD da Twitch).
  if (!teaser && o.temAudio !== false) args.push('-af', 'aresample=async=1:first_pts=0');

  args.push(
    '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf,
    '-maxrate', q.maxrate, '-bufsize', String(parseInt(q.maxrate, 10) * 2) + 'M',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.2',
    '-x264-params', 'ref=4:bframes=3:aq-mode=3',  // ajuda em gameplay, que tem muito movimento
    // Pronto pra postar em Shorts/TikTok/Reels sem erro: quadros por segundo
    // CONSTANTES (VOD da Twitch as vezes vem variavel e o Instagram dessincroniza
    // o som) e cor marcada como BT.709 (sem isso o Reels deixa a imagem "lavada").
    '-fps_mode', 'cfr',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', q.audio, '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    o.destino,
  );

  await rodar(ffmpeg, args, {
    cwd: o.pastaTrabalho,
    aoProgredir: (seg) => {
      const total = o.duracao + (teaser ? teaser.duracao : 0);
      if (o.aoProgredir) o.aoProgredir(Math.min(1, seg / total));
    },
  });
  return o.destino;
}

/**
 * Confere o chamariz pedido e devolve o tempo DENTRO da janela lida.
 * Ele tem que cair dentro do corte: um chamariz que aponta pra fora da
 * janela faria o ffmpeg cortar quadro vazio.
 * @returns {object|null} { relativo, duracao }
 */
function prepararTeaser(o) {
  const t = o.teaser;
  if (!t || !isFinite(Number(t.inicio))) return null;
  const dur = Math.max(1, Math.min(6, Number(t.duracao) || 3));
  const relativo = Number(t.inicio) - Number(o.inicio);
  if (!(relativo >= 0) || relativo + dur > Number(o.duracao)) return null;
  return { relativo, duracao: dur };
}

// Video de live (Twitch, Kick) vem em faixa de cor "limitada" e o gerador de
// JPG do ffmpeg novo recusa isso. Converter pra faixa cheia resolve - e e o
// que o JPG espera de qualquer jeito.
const JPG_CHEIO = 'scale=out_range=full,format=yuvj420p';

/** Uma imagem do meio do clipe, pra mostrar na tela. */
async function gerarMiniatura(video, segundo, destino, vertical) {
  const { ffmpeg } = await garantirFfmpeg();
  const vf = vertical
    ? 'scale=360:640:force_original_aspect_ratio=increase,crop=360:640,' + JPG_CHEIO
    : 'scale=360:-2,' + JPG_CHEIO;
  try {
    await rodar(ffmpeg, [
      '-y', '-ss', String(segundo), '-i', video,
      '-frames:v', '1', '-vf', vf, '-q:v', '4',
      '-loglevel', 'error', destino,
    ]);
    return destino;
  } catch (_) {
    return null; // miniatura e enfeite, nao vale derrubar o processo
  }
}

/** Igual ao rodar(), mas junta a saida como bytes - pra ler frame cru. */
function rodarBinario(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const pedacos = [];
    let erro = '';
    p.stdout.on('data', (d) => pedacos.push(d));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d) => { erro += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(pedacos));
      else reject(new Error('ffmpeg falhou: ' + erro.split(/\r?\n/).slice(-6).join('\n')));
    });
  });
}

const AMOSTRA_L = 320;
const AMOSTRA_A = 180;

/** Um frame pequeno em RGB cru, pra analisar pixel a pixel sem depender de biblioteca. */
async function amostrarFrame(video, segundo) {
  const { ffmpeg } = await garantirFfmpeg();
  const buf = await rodarBinario(ffmpeg, [
    '-ss', String(Math.max(0, segundo)), '-i', video,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', AMOSTRA_L + 'x' + AMOSTRA_A, '-loglevel', 'error', 'pipe:1',
  ]);
  return buf.length >= AMOSTRA_L * AMOSTRA_A * 3 ? buf : null;
}

function pixel(buf, x, y) {
  const i = (y * AMOSTRA_L + x) * 3;
  return [buf[i], buf[i + 1], buf[i + 2]];
}

function diferencaEntreLinhas(buf, eixo, pos, de, ate, salto) {
  let soma = 0, n = 0;
  for (let t = de; t <= ate; t++) {
    let a, b;
    if (eixo === 'x') {           // borda vertical: compara colunas
      if (pos - salto < 0 || pos + salto >= AMOSTRA_L) return null;
      a = pixel(buf, pos - salto, t); b = pixel(buf, pos + salto, t);
    } else {                       // borda horizontal: compara linhas
      if (pos - salto < 0 || pos + salto >= AMOSTRA_A) return null;
      a = pixel(buf, t, pos - salto); b = pixel(buf, t, pos + salto);
    }
    soma += (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
    n++;
  }
  return n ? soma / n : null;
}

/**
 * A webcam sobreposta cria uma quebra brusca de imagem na moldura dela.
 * Se a gente compara os pixels de dentro com os de fora da borda e a diferenca
 * e MUITO maior que a variacao normal da imagem, tem uma janela ali.
 * Quando o streamer poe a cara em tela cheia, essa quebra some.
 */
function medirBordaDaWebcam(buf, area) {
  const x0 = Math.round(area.x * AMOSTRA_L);
  const y0 = Math.round(area.y * AMOSTRA_A);
  const x1 = Math.round((area.x + area.w) * AMOSTRA_L);
  const y1 = Math.round((area.y + area.h) * AMOSTRA_A);
  if (x1 - x0 < 12 || y1 - y0 < 12) return null;

  const salto = 3;
  const candidatos = [
    diferencaEntreLinhas(buf, 'x', x1, y0 + 3, y1 - 3, salto),  // borda direita
    diferencaEntreLinhas(buf, 'x', x0, y0 + 3, y1 - 3, salto),  // borda esquerda
    diferencaEntreLinhas(buf, 'y', y1, x0 + 3, x1 - 3, salto),  // borda de baixo
    diferencaEntreLinhas(buf, 'y', y0, x0 + 3, x1 - 3, salto),  // borda de cima
  ].filter((v) => v != null);

  if (!candidatos.length) return null;

  // Referencia: o quanto a imagem muda naturalmente na mesma distancia.
  const referencias = [];
  for (let f = 0.2; f <= 0.8; f += 0.15) {
    const d1 = diferencaEntreLinhas(buf, 'x', Math.round(AMOSTRA_L * f), 20, AMOSTRA_A - 20, salto);
    const d2 = diferencaEntreLinhas(buf, 'y', Math.round(AMOSTRA_A * f), 20, AMOSTRA_L - 20, salto);
    if (d1 != null) referencias.push(d1);
    if (d2 != null) referencias.push(d2);
  }
  const base = referencias.length
    ? referencias.reduce((a, b) => a + b, 0) / referencias.length : 1;

  const maiorBorda = Math.max.apply(null, candidatos);
  return maiorBorda / Math.max(1.5, base);
}

/**
 * Mede so as bordas que ficam POR CIMA do video (as que nao encostam na beirada
 * da tela), e devolve a mais fraca delas.
 *
 * Usar a borda mais fraca, e nao a mais forte, e o que separa uma webcam de
 * verdade de um acaso: a janela da webcam tem moldura marcada em TODOS os lados
 * que ficam sobre o gameplay. Um pedaco qualquer de cenario pode ter uma linha
 * forte de um lado so - e essa, no minimo, cai fora.
 */
function forcaDaMolduraInteira(buf, area) {
  const x0 = Math.round(area.x * AMOSTRA_L);
  const y0 = Math.round(area.y * AMOSTRA_A);
  const x1 = Math.round((area.x + area.w) * AMOSTRA_L);
  const y1 = Math.round((area.y + area.h) * AMOSTRA_A);
  if (x1 - x0 < 12 || y1 - y0 < 12) return null;

  const salto = 3;
  const margem = 4;   // encostado na beirada da tela nao conta como moldura
  const bordas = [];

  if (x0 > margem) bordas.push(diferencaEntreLinhas(buf, 'x', x0, y0 + 3, y1 - 3, salto));
  if (x1 < AMOSTRA_L - margem) bordas.push(diferencaEntreLinhas(buf, 'x', x1, y0 + 3, y1 - 3, salto));
  if (y0 > margem) bordas.push(diferencaEntreLinhas(buf, 'y', y0, x0 + 3, x1 - 3, salto));
  if (y1 < AMOSTRA_A - margem) bordas.push(diferencaEntreLinhas(buf, 'y', y1, x0 + 3, x1 - 3, salto));

  const validas = bordas.filter((v) => v != null);
  if (validas.length < 2) return null;   // sem pelo menos 2 lados sobre o video, nao da pra afirmar nada

  const referencias = [];
  for (let f = 0.2; f <= 0.8; f += 0.15) {
    const d1 = diferencaEntreLinhas(buf, 'x', Math.round(AMOSTRA_L * f), 20, AMOSTRA_A - 20, salto);
    const d2 = diferencaEntreLinhas(buf, 'y', Math.round(AMOSTRA_A * f), 20, AMOSTRA_L - 20, salto);
    if (d1 != null) referencias.push(d1);
    if (d2 != null) referencias.push(d2);
  }
  const base = referencias.length
    ? referencias.reduce((a, b) => a + b, 0) / referencias.length : 1;

  return Math.min.apply(null, validas) / Math.max(1.5, base);
}

/** Mudanca media de cor entre dois frames, dentro de uma area. */
function mudancaEntreFrames(b1, b2, area) {
  const x0 = Math.round(area.x * AMOSTRA_L);
  const y0 = Math.round(area.y * AMOSTRA_A);
  const x1 = Math.round((area.x + area.w) * AMOSTRA_L);
  const y1 = Math.round((area.y + area.h) * AMOSTRA_A);
  let soma = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * AMOSTRA_L + x) * 3;
      soma += (Math.abs(b1[i] - b2[i]) + Math.abs(b1[i + 1] - b2[i + 1]) + Math.abs(b1[i + 2] - b2[i + 2])) / 3;
      n++;
    }
  }
  return n ? soma / n : 0;
}

/**
 * Procura a webcam sozinho, varrendo os cantos do video.
 *
 * O sinal que funciona nao e a moldura (o HUD do jogo tem bordas retas tao
 * fortes quanto) nem o tom de pele (cenario de Roblox e cheio de marrom que
 * passa por pele). E a ESTABILIDADE NO TEMPO: entre dois momentos distantes do
 * video o gameplay muda por completo, enquanto a webcam continua mostrando a
 * mesma pessoa, no mesmo lugar, com o mesmo fundo. A janela da webcam e, de
 * longe, a regiao que menos muda.
 *
 * Isso importa porque marcar essa caixa no canto errado estraga TODOS os
 * clipes de uma vez, e em silencio: o programa recorta um pedaco de cenario
 * pro topo e ainda conclui "ele esta em tela cheia" quando nao acha moldura.
 *
 * @returns {Promise<object|null>} { area, canto, estabilidade } ou null
 */
async function acharWebcam(video, duracao) {
  const dur = duracao || 600;
  // Bem espalhados de proposito: se os frames forem proximos, o gameplay
  // tambem parece estavel e o sinal some.
  // Mais instantes do que o minimo: se o arquivo estiver incompleto (download
  // interrompido), parte deles falha e ainda sobram 3 ou mais pra comparar.
  const instantes = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((f) => Math.max(1, dur * f));

  const frames = [];
  for (const t of instantes) {
    if (frames.length >= 6) break;
    try {
      const buf = await amostrarFrame(video, t);
      if (buf) frames.push(buf);
    } catch (_) { /* um frame ruim nao invalida a busca */ }
  }
  if (frames.length < 3) return null;

  // Mapa de "quanto cada ponto muda" (media entre todos os pares de frames) e
  // a tabela de somas dele: com isso a mudanca media de QUALQUER caixa sai em
  // 4 contas, e da pra testar milhares de posicoes num instante.
  const L = AMOSTRA_L, A = AMOSTRA_A;
  const mapa = new Float64Array(L * A);
  let pares = 0;
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const b1 = frames[i], b2 = frames[j];
      for (let p = 0, k = 0; p < L * A; p++, k += 3) {
        mapa[p] += (Math.abs(b1[k] - b2[k]) + Math.abs(b1[k + 1] - b2[k + 1]) + Math.abs(b1[k + 2] - b2[k + 2])) / 3;
      }
      pares++;
    }
  }
  const soma = new Float64Array((L + 1) * (A + 1));   // soma[y][x] = tudo acima e a esquerda
  for (let y = 0; y < A; y++) {
    let linha = 0;
    for (let x = 0; x < L; x++) {
      linha += mapa[y * L + x] / pares;
      soma[(y + 1) * (L + 1) + x + 1] = soma[y * (L + 1) + x + 1] + linha;
    }
  }
  function mudancaMedia(area) {
    const x0 = Math.max(0, Math.round(area.x * L)), y0 = Math.max(0, Math.round(area.y * A));
    const x1 = Math.min(L, Math.round((area.x + area.w) * L)), y1 = Math.min(A, Math.round((area.y + area.h) * A));
    const n = (x1 - x0) * (y1 - y0);
    if (n <= 0) return 0;
    const W = L + 1;
    return (soma[y1 * W + x1] - soma[y0 * W + x1] - soma[y1 * W + x0] + soma[y0 * W + x0]) / n;
  }

  // Referencia: o quanto a tela inteira muda entre esses mesmos momentos.
  const geral = mudancaMedia({ x: 0, y: 0, w: 1, h: 1 });
  if (geral < 5) return null;   // video praticamente parado: nao da pra concluir nada

  // A webcam quase sempre encosta numa BORDA, mas nem sempre num canto: muito
  // streamer deixa ela na lateral, um pouco abaixo do topo (ou acima do fim).
  // Entao testa caixas ao longo das 4 bordas, em varios tamanhos e nos formatos
  // de camera comuns (16:9, 3:2 e 4:3; num video 16:9, h = w * 16 / (9 * formato)).
  const m = 0.005, passo = 0.01;
  const candidatos = [];
  for (let w = 0.14; w <= 0.40 + 1e-9; w += 0.02) {
    for (const formato of [16 / 9, 3 / 2, 4 / 3]) {
      const h = w * 16 / (9 * formato);
      if (h > 0.5) continue;
      for (let y = m; y <= 1 - h - m + 1e-9; y += passo) {
        candidatos.push({ x: m, y, w, h });
        candidatos.push({ x: 1 - w - m, y, w, h });
      }
      for (let x = m + passo; x < 1 - w - m - 1e-9; x += passo) {
        candidatos.push({ x, y: m, w, h });
        candidatos.push({ x, y: 1 - h - m, w, h });
      }
    }
  }
  let menor = Infinity;
  const notas = candidatos.map((area) => {
    const razao = mudancaMedia(area) / geral;   // quanto menor, mais estavel
    if (razao < menor) menor = razao;
    return { area, razao };
  });

  // Precisa mudar bem menos que a tela toda pra ser webcam, e nao um pedaco
  // de cenario que por acaso ficou parado.
  if (menor > 0.62) return null;

  // Uma caixa pequena DENTRO da webcam e tao estavel quanto a webcam inteira.
  // Pra pegar a moldura toda, fica com a MAIOR caixa que continua quase tao
  // estavel quanto a melhor (se crescer pra dentro do jogo, a mudanca sobe).
  const limite = Math.min(0.62, menor * 1.12 + 0.02);
  let melhor = null;
  for (const c of notas) {
    if (c.razao > limite) continue;
    const tam = c.area.w * c.area.h;
    if (!melhor || tam > melhor.tam + 1e-9 || (Math.abs(tam - melhor.tam) < 1e-9 && c.razao < melhor.razao)) {
      melhor = { ...c, tam };
    }
  }

  const a = melhor.area, cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  const lado = cx < 0.5 ? 'esquerdo' : 'direito';
  const canto = cy < 0.3 ? 'superior ' + lado : cy > 0.7 ? 'inferior ' + lado : 'lado ' + lado;
  const arred = (v) => Math.round(v * 1000) / 1000;
  return {
    area: { x: arred(a.x), y: arred(a.y), w: arred(a.w), h: arred(a.h) },
    canto,
    estabilidade: Math.round((1 - melhor.razao) * 100),   // 0 a 100, quanto maior mais confianca
  };
}

/**
 * Olha alguns instantes do trecho e diz se a webcam esta separada ali.
 * @returns {object} { temWebcam, forca, amostras }
 */
async function detectarWebcam(video, inicio, duracao, area) {
  // Aqui NAO da pra usar a moldura como sinal: em gameplay de Roblox a tela
  // toda e cheia de linhas retas fortes (HUD, shop, inventario), entao a
  // moldura da webcam nao se destaca e a medicao acusa "sem webcam" com a
  // webcam na tela - estragando o corte.
  //
  // O sinal certo e o mesmo que acha a webcam: ESTABILIDADE. Dentro do trecho,
  // a janelinha da webcam muda pouco (mesma pessoa, mesmo fundo) enquanto o
  // gameplay muda muito. Se a regiao da webcam mudar tanto quanto o resto da
  // tela, e porque nao tem webcam ali - o quadro inteiro virou a cara dele.
  const instantes = [0.12, 0.35, 0.6, 0.85].map((f) => inicio + duracao * f);

  const frames = [];
  for (const t of instantes) {
    try {
      const buf = await amostrarFrame(video, t);
      if (buf) frames.push(buf);
    } catch (_) { /* um frame ruim nao invalida a analise */ }
  }

  // Sem material pra decidir: assume o formato normal do canal, que e o que
  // acerta na maioria dos trechos.
  if (frames.length < 2) return { temWebcam: true, razao: null, amostras: frames.length };

  function mudancaMedia(alvo) {
    let soma = 0, pares = 0;
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        soma += mudancaEntreFrames(frames[i], frames[j], alvo);
        pares++;
      }
    }
    return pares ? soma / pares : 0;
  }

  const geral = mudancaMedia({ x: 0, y: 0, w: 1, h: 1 });
  // Cena parada (menu, pausa): nao da pra separar webcam de gameplay porque
  // nada se move. Mantem o formato do canal.
  if (geral < 4) return { temWebcam: true, razao: null, amostras: frames.length };

  const naWebcam = mudancaMedia(area);
  const razao = naWebcam / geral;

  // Nenhum sinal sozinho e confiavel:
  //  - a ESTABILIDADE falha quando o gameplay esta parado e ele gesticula
  //    falando: a webcam muda mais que a tela e parece nao existir;
  //  - a MOLDURA falha porque o HUD do jogo tem linhas retas tao fortes quanto.
  //
  // Trocar o enquadramento sem necessidade estraga o corte, enquanto deixar de
  // trocar so mantem o formato de sempre. Como errar custa caro e nao errar
  // custa pouco, so mudamos quando os DOIS sinais concordam que a webcam sumiu.
  const bordas = [];
  for (const buf of frames) {
    const f = medirBordaDaWebcam(buf, area);
    if (f != null) bordas.push(f);
  }
  bordas.sort((a, b) => a - b);
  const bordaMediana = bordas.length ? bordas[Math.floor(bordas.length / 2)] : null;

  const estabilidadeDiz = razao >= 0.78;                        // regiao muda quase tanto quanto a tela
  const molduraDiz = bordaMediana != null && bordaMediana < 1.2; // sem quebra de imagem na borda
  const semWebcam = estabilidadeDiz && molduraDiz;

  return {
    temWebcam: !semWebcam,
    razao: Math.round(razao * 100) / 100,
    borda: bordaMediana == null ? null : Math.round(bordaMediana * 100) / 100,
    amostras: frames.length,
    // Faixa cinzenta: um sinal aponta pra tela cheia e o outro nao. Nao troca
    // o enquadramento, mas avisa pra pessoa conferir aquele clipe.
    misto: estabilidadeDiz !== molduraDiz,
  };
}

/** Um frame cru do video, pro usuario marcar onde esta a webcam e o jogo. */
async function gerarFrame(video, segundo, destino, largura) {
  const { ffmpeg } = await garantirFfmpeg();
  const filtro = ['-frames:v', '1', '-vf', 'scale=' + (largura || 960) + ':-2,' + JPG_CHEIO, '-q:v', '3', '-loglevel', 'error', destino];
  const saiu = () => { try { return fs.statSync(destino).size > 0; } catch (_) { return false; } };
  try { fs.unlinkSync(destino); } catch (_) {}
  try {
    await rodar(ffmpeg, ['-y', '-ss', String(Math.max(0, segundo)), '-i', video].concat(filtro));
  } catch (_) { /* tenta sem pular, abaixo */ }
  // Pedaco de live que nao comeca num quadro-chave (gravacao pelo yt-dlp) ou
  // mais curto que o segundo pedido: pega o primeiro quadro que der pra ler.
  if (!saiu()) await rodar(ffmpeg, ['-y', '-i', video].concat(filtro));
  if (!saiu()) throw new Error('nenhuma imagem nesse pedaço');
  return destino;
}

/** Um frame ja montado no formato final - serve pra conferir antes de gerar tudo. */
// extra = { ass, fontsdir, cwd }: desenha por cima o texto da tela (.ass),
// do mesmo jeito que o clipe final - so faz sentido nos formatos em pe.
async function gerarPrevia(video, segundo, formato, recorte, destino, extra) {
  const { ffmpeg } = await garantirFfmpeg();
  const filtro = filtroDeFormato(formato, recorte);
  const texto = extra && extra.ass
    ? ',subtitles=' + extra.ass + (extra.fontsdir ? ':fontsdir=' + extra.fontsdir : '') : '';

  const args = ['-y', '-ss', String(Math.max(0, segundo)), '-i', video, '-frames:v', '1'];
  if (filtro) args.push('-filter_complex', filtro.replace(/\[v\]$/, texto + ',' + JPG_CHEIO + '[v]'), '-map', '[v]');
  else args.push('-vf', JPG_CHEIO);
  args.push('-q:v', '3', '-loglevel', 'error', destino);

  await rodar(ffmpeg, args, { cwd: extra && extra.cwd });
  return destino;
}

module.exports = {
  garantirFfmpeg,
  inspecionar,
  extrairAudio,
  energiaPorSegundo,
  cortarClipe,
  gerarMiniatura,
  gerarFrame,
  detectarWebcam,
  acharWebcam,
  gerarPrevia,
  filtroDeFormato,
  acharFaixasPretas,
  temLegendaQueimada,
  rodar,
};
