'use strict';
/**
 * Os projetos que ja foram gerados. Cada pasta dentro de saida/ e uma rodada,
 * com os clipes e o sessao.json que guarda o que precisa pra mexer neles de
 * novo. Daqui a janela lista, reabre e edita - sem baixar nem transcrever nada.
 *
 * Tambem e daqui que sai o video pra assistir no editor: o de um projeto, ou o
 * que a pessoa acabou de escolher na janela, antes de gerar qualquer corte.
 */

const fs = require('fs');
const path = require('path');

const media = require('./media');
const { achatarPalavras } = require('./score');
const { assinaturaDoArquivo, fonteDoClipe, chavesDasPalavras } = require('./pipeline');
const pastas = require('./pastas');
const sessoes = require('./sessoes');

function lerJson(arquivo) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { return null; }
}

/** A pasta onde ficam os projetos do perfil (saida/cortes). */
function raizDe(sessao) {
  return path.resolve(sessoes.pastaDeSaida(sessoes.pegar(sessao), pastas.saida()));
}

/**
 * Aceita so uma pasta que fica DIRETO dentro da pasta do perfil (saida/cortes
 * ). O caminho vem do navegador, entao nada de subir
 * diretorio nem apontar pra outro lugar.
 * @returns {string|null} o caminho absoluto, ou null se nao for um projeto
 */
function pastaDoProjeto(bruto) {
  if (!bruto) return null;
  const resolvido = path.resolve(String(bruto));
  const pai = path.dirname(resolvido);
  const raizes = Object.keys(sessoes.SESSOES).map(raizDe);
  if (!raizes.some((r) => path.relative(r, pai) === '')) return null;
  try { if (!fs.statSync(resolvido).isDirectory()) return null; } catch (_) { return null; }
  return resolvido;
}

/** O sessao.json de um projeto, ou null. So ele diz onde esta o video original. */
function sessaoDe(bruto) {
  const pasta = pastaDoProjeto(bruto);
  const sessao = pasta && lerJson(path.join(pasta, 'sessao.json'));
  return sessao ? { pasta, sessao } : null;
}

/** "1712345678901-FIZ_A_FUSAO_MAIS_RARA [psiaidCHTM8]" vira "FIZ A FUSAO MAIS RARA". */
function nomeBonito(video, pasta) {
  let nome = video
    ? path.basename(video, path.extname(video))
    : path.basename(pasta).replace(/_\d{4}(-\d{2}){4}$/, '');
  nome = nome
    .replace(/^\d{13}-/, '')               // carimbo do upload
    .replace(/\s*\[[\w-]{6,}\]\s*$/, '')    // id do YouTube
    .replace(/_+/g, ' ')
    .trim();
  return nome || path.basename(pasta);
}

/**
 * O sessao.json guarda caminhos absolutos. Se a pasta mudou de lugar (outro
 * disco, outro usuario), eles apontam pro nada - entao tudo e recalculado a
 * partir da pasta, e clipe cujo arquivo foi apagado na mao fica de fora.
 */
function clipesDaPasta(pasta, clipes) {
  return (clipes || []).map((c) => {
    const nomeArquivo = c.nomeArquivo || path.basename(String(c.arquivo || ''));
    if (!nomeArquivo) return null;
    const arquivo = path.join(pasta, nomeArquivo);
    if (!fs.existsSync(arquivo)) return null;
    const jpg = path.join(pasta, path.basename(nomeArquivo, path.extname(nomeArquivo)) + '.jpg');
    return Object.assign({}, c, {
      arquivo,
      nomeArquivo,
      miniatura: fs.existsSync(jpg) ? jpg : null,
    });
  }).filter(Boolean).sort((a, b) => (a.numero || 0) - (b.numero || 0));
}

function carregar(pasta) {
  const sessao = lerJson(path.join(pasta, 'sessao.json'));
  const relatorio = lerJson(path.join(pasta, 'relatorio.json'));
  if (!sessao && !relatorio) return null;

  const video = (sessao && sessao.video) || (relatorio && relatorio.videoOriginal) || '';
  let criado = relatorio && relatorio.gerado;
  if (!criado) {
    try { criado = fs.statSync(pasta).mtime.toISOString(); } catch (_) { criado = null; }
  }

  return { pasta, sessao, relatorio, video, criado, clipes: clipesDaPasta(pasta, (sessao || relatorio).clipes) };
}

function resumir(p) {
  const opcoes = (p.sessao && p.sessao.opcoes) || {};
  const porNota = p.clipes.slice().sort((a, b) => (b.nota || 0) - (a.nota || 0));
  return {
    pasta: p.pasta,
    sessao: sessoes.pegar(opcoes.sessao).id,
    nome: (p.relatorio && p.relatorio.nome) || nomeBonito(p.video, p.pasta),
    aoVivo: !!(p.relatorio && p.relatorio.aoVivo),
    videoExiste: !!p.video && fs.existsSync(p.video),
    // pasta de versao antiga nao tem sessao.json: da pra assistir, nao pra refazer
    editavel: !!p.sessao,
    criado: p.criado,
    duracaoVideo: (p.sessao && p.sessao.duracaoVideo) || (p.relatorio && p.relatorio.duracaoOriginal) || 0,
    formato: opcoes.formato || (p.relatorio && p.relatorio.formato) || null,
    // rodada feita so de um pedaco do video
    trecho: opcoes.trecho
      ? { inicio: opcoes.trecho.inicio, fim: opcoes.trecho.fim, modo: opcoes.modoTrecho || 'melhores' }
      : null,
    quantidade: p.clipes.length,
    melhorNota: porNota.length ? porNota[0].nota : null,
    capas: porNota.slice(0, 3).map((c) => c.miniatura).filter(Boolean),
  };
}

/** Os projetos da sessao que ainda tem clipe, do mais novo pro mais antigo. */
function listar(sessao) {
  const raiz = raizDe(sessao);
  let itens = [];
  try { itens = fs.readdirSync(raiz, { withFileTypes: true }); } catch (_) { return []; }
  const id = sessoes.pegar(sessao).id;
  return itens
    .filter((d) => d.isDirectory())
    .map((d) => carregar(path.join(raiz, d.name)))
    .filter((p) => p && p.clipes.length)
    .map(resumir)
    .filter((r) => r.sessao === id)
    .sort((a, b) => String(b.criado || '').localeCompare(String(a.criado || '')));
}

/** Um projeto inteiro, pronto pra janela mostrar e editar. */
function abrir(bruto) {
  const pasta = pastaDoProjeto(bruto);
  const p = pasta && carregar(pasta);
  if (!p) return null;

  const opcoes = (p.sessao && p.sessao.opcoes) || {};
  const relatorioTxt = path.join(pasta, 'RELATORIO.txt');
  return Object.assign(resumir(p), {
    clipes: p.clipes,
    // So o que a janela usa. A chave da IA fica no disco, nao vai pro navegador.
    opcoes: {
      formato: opcoes.formato || null,
      quantidade: opcoes.quantidade || null,
      minDur: opcoes.minDur || null,
      maxDur: opcoes.maxDur || null,
      legendar: !!opcoes.legendar,
    },
    temTranscricao: !!(p.sessao && p.sessao.transcricao && fs.existsSync(p.sessao.transcricao)),
    relatorio: fs.existsSync(relatorioTxt) ? relatorioTxt : null,
  });
}

// ---------------------------------------------------------------- de onde vem o video

// Videos que a propria janela escolheu (dialogo, envio, link baixado). Tocar
// um arquivo so porque o navegador mandou o caminho abriria qualquer arquivo
// do PC pra quem conseguisse falar com o programa.
const liberados = new Set();

function chaveDoCaminho(caminho) {
  const p = path.resolve(String(caminho));
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/** Marca um video escolhido na janela como liberado pra assistir no editor. */
function liberarVideo(caminho) {
  if (caminho) liberados.add(chaveDoCaminho(caminho));
}

/** A transcricao desse video, se ele ja foi ouvido alguma vez. Prefere a mais precisa. */
function transcricaoGuardada(assinatura) {
  for (const modelo of ['medium', 'small', 'base']) {
    const arquivo = path.join(pastas.trabalho(), assinatura + '-' + modelo + '-v2.json');
    if (fs.existsSync(arquivo)) return arquivo;
  }
  return null;
}

/**
 * De onde vem o video pra assistir: { pasta } de um projeto, ou { caminho } do
 * video que acabou de ser escolhido na janela.
 * @returns {object|null} { video, assinatura, duracao, transcricao }
 */
function fonteDe(pedido) {
  pedido = pedido || {};
  if (pedido.pasta && pedido.clipe) {
    // um clipe da live: o original e a fala dele, guardados na pasta do projeto
    const s = sessaoDe(pedido.pasta);
    const clipe = s && (s.sessao.clipes || []).find((c) => String(c.numero) === String(pedido.clipe));
    if (clipe && clipe.fonte) {
      const f = fonteDoClipe(s.pasta, s.sessao, clipe);
      if (!fs.existsSync(f.video)) return null;
      return { video: f.video, assinatura: f.assinatura, duracao: f.duracao, transcricao: f.transcricao };
    }
  }
  if (pedido.pasta) {
    const s = sessaoDe(pedido.pasta);
    if (!s || !s.sessao.video || !fs.existsSync(s.sessao.video)) return null;
    return {
      video: s.sessao.video,
      assinatura: s.sessao.assinatura || assinaturaDoArquivo(s.sessao.video),
      duracao: Number(s.sessao.duracaoVideo) || 0,
      transcricao: s.sessao.transcricao,
    };
  }
  if (pedido.caminho) {
    // O caminho do jeito que veio: e com ele que a assinatura do cache foi feita
    const video = String(pedido.caminho);
    if (!liberados.has(chaveDoCaminho(video)) || !fs.existsSync(video)) return null;
    const assinatura = assinaturaDoArquivo(video);
    return { video, assinatura, duracao: 0, transcricao: transcricaoGuardada(assinatura) };
  }
  return null;
}

/** O video pra tocar no player. */
function videoDe(pedido) {
  const f = fonteDe(pedido);
  return f ? f.video : null;
}

/** As palavras ditas entre dois instantes do video, pro editor. */
function palavras(pedido, de, ate) {
  const f = fonteDe(pedido);
  if (!f) return null;
  const transcricao = f.transcricao && lerJson(f.transcricao);
  if (!transcricao) return { palavras: [], semTranscricao: true };

  const a = Number(de) || 0;
  const b = Number(ate) || 0;
  // a chave de cada palavra conta sobre a transcricao inteira (ver chavesDasPalavras)
  const todas = achatarPalavras(transcricao);
  const chaves = chavesDasPalavras(todas);
  const saida = [];
  todas.forEach((p, n) => {
    if (p.fim > a && p.inicio < b) {
      saida.push({ i: Math.round(p.inicio * 100) / 100, f: Math.round(p.fim * 100) / 100, t: p.texto, k: chaves[n] });
    }
  });
  return { palavras: saida };
}

// ---------------------------------------------------------------- tira de imagens

const emAndamento = new Map(); // arquivo -> promessa, pra nao gerar a mesma imagem duas vezes

/**
 * Uma imagem pequena do video num instante. E o que monta a tira da linha do
 * tempo no editor. Fica em cache, entao reabrir o mesmo video e na hora.
 * @returns {Promise<string|null>} o caminho do jpg
 */
async function quadro(pedido, segundo) {
  const f = fonteDe(pedido);
  if (!f) return null;

  // Meio segundo de resolucao: a tira nao precisa de mais, e o cache acerta mais.
  const fimDoVideo = Math.max(0, (f.duracao || Infinity) - 0.5);
  const t = Math.min(fimDoVideo, Math.max(0, Math.round((Number(segundo) || 0) * 2) / 2));

  const pasta = path.join(pastas.trabalho(), 'quadros');
  const chave = f.assinatura + '-' + Math.round(t * 10);
  const alvo = path.join(pasta, chave + '.jpg');
  if (fs.existsSync(alvo)) return alvo;

  let tarefa = emAndamento.get(alvo);
  if (!tarefa) {
    tarefa = gerarQuadro(f.video, t, pasta, chave, alvo)
      .finally(() => emAndamento.delete(alvo));
    emAndamento.set(alvo, tarefa);
  }
  await tarefa;
  return fs.existsSync(alvo) ? alvo : null;
}

async function gerarQuadro(video, t, pasta, chave, alvo) {
  fs.mkdirSync(pasta, { recursive: true });
  // Grava com outro nome e so depois renomeia: quem pedir a imagem no meio
  // da gravacao nunca recebe um jpg pela metade.
  const temp = path.join(pasta, chave + '-' + Date.now() + '.jpg');
  try {
    await media.gerarFrame(video, t, temp, 192);
    fs.renameSync(temp, alvo);
  } finally {
    try { fs.unlinkSync(temp); } catch (_) {}
  }
}

module.exports = { listar, abrir, pastaDoProjeto, liberarVideo, videoDe, palavras, quadro };
