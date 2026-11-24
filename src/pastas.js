'use strict';
/**
 * Onde o programa grava tudo: cortes, videos baixados, gravacao da live e a
 * pasta de trabalho (audio, transcricoes, imagens). Fica tudo dentro de UMA
 * pasta de dados, que a pessoa escolhe nos Ajustes (outro disco, outra pasta).
 *
 * Todo mundo pergunta o caminho aqui na hora de usar - nunca guarda numa
 * constante - entao trocar a pasta vale na hora, sem reiniciar o programa.
 *
 * Qual pasta vale, nesta ordem:
 *   1. a que a pessoa escolheu nos Ajustes (config.json)
 *   2. a variavel DADOS (o programa instalado aponta pra Videos\Clipador)
 *   3. D:\Clipador, se o D: existir (o C: costuma viver cheio). Se ja existir
 *      D:\CortadorAutomatico (nome antigo), continua nela.
 *   4. a propria pasta do programa
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

/** O arquivo de configuracao fica fora da pasta de dados: ela pode mudar de lugar. */
function arquivoConfig(nome) {
  const base = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), nome || 'Clipador')
    : path.join(os.homedir(), nome ? '.cortador-automatico' : '.clipador');
  return path.join(base, 'config.json');
}

function lerConfig() {
  // Sem config do Clipador ainda? Le a do nome antigo (Cortador Automatico),
  // pra nao perder os ajustes. O proximo gravarConfig ja salva no lugar novo.
  for (const arq of [arquivoConfig(), arquivoConfig('CortadorAutomatico')]) {
    try { return JSON.parse(fs.readFileSync(arq, 'utf8')) || {}; } catch (_) { /* tenta o proximo */ }
  }
  return {};
}

function gravarConfig(cfg) {
  const arq = arquivoConfig();
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(cfg, null, 2), 'utf8');
}

/** A pasta de dados quando nada foi escolhido. */
function padrao() {
  if (process.env.DADOS) return process.env.DADOS;
  if (process.platform === 'win32' && fs.existsSync('D:/')) {
    // Nome antigo do programa: se a pasta ja existe, continua nela pra nao perder nada.
    if (fs.existsSync('D:/CortadorAutomatico')) return 'D:\\CortadorAutomatico';
    return 'D:\\Clipador';
  }
  return RAIZ;
}

let atual = (() => {
  const escolhida = lerConfig().pastaDados;
  return escolhida && path.isAbsolute(escolhida) ? escolhida : padrao();
})();

const dados = () => atual;
const saida = () => path.join(atual, 'saida');
const trabalho = () => path.join(atual, 'trabalho');
const baixados = () => path.join(atual, 'baixados');
const aoVivo = () => path.join(atual, 'ao-vivo');

/**
 * Passa a gravar em outra pasta. Testa se da pra criar e escrever nela antes
 * de trocar - pasta protegida ou disco cheio vira erro aqui, nao no meio de um corte.
 * @param {string|null} pasta  null volta pro padrao
 */
function mudar(pasta) {
  if (pasta == null || pasta === '') {
    const cfg = lerConfig();
    delete cfg.pastaDados;
    gravarConfig(cfg);
    atual = padrao();
    return atual;
  }
  const alvo = path.resolve(String(pasta).trim());
  if (!path.isAbsolute(alvo)) throw new Error('Escolha uma pasta completa, com o disco (ex.: E:\\Cortes).');
  try {
    fs.mkdirSync(alvo, { recursive: true });
    const teste = path.join(alvo, '.teste-cortador-' + Date.now());
    fs.writeFileSync(teste, 'ok');
    fs.unlinkSync(teste);
  } catch (e) {
    throw new Error('Não consegui gravar nessa pasta (' + (e.code || e.message) + '). Escolha outra ou outro disco.');
  }
  const cfg = lerConfig();
  cfg.pastaDados = alvo;
  gravarConfig(cfg);
  atual = alvo;
  return atual;
}

/** Os discos do PC com o espaco livre, pra escolher na tela. */
function discos() {
  if (process.platform !== 'win32') {
    return [espacoDe('/', '/')].filter(Boolean);
  }
  const lista = [];
  for (const letra of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const raiz = letra + ':\\';
    if (!fs.existsSync(raiz)) continue;
    const d = espacoDe(raiz, letra + ':');
    if (d) lista.push(d);
  }
  return lista;
}

function espacoDe(raiz, nome) {
  try {
    const s = fs.statfsSync(raiz);
    const gb = (n) => Math.round((n / 1073741824) * 10) / 10;
    return { nome, raiz, livreGb: gb(s.bavail * s.bsize), totalGb: gb(s.blocks * s.bsize) };
  } catch (_) {
    return null; // leitor de cartao vazio, disco de rede fora do ar
  }
}

/** Espaco livre no disco da pasta atual, em GB (ou null). */
function livreAtual() {
  try {
    const s = fs.statfsSync(atual);
    return Math.round(((s.bavail * s.bsize) / 1073741824) * 10) / 10;
  } catch (_) { return null; }
}

module.exports = { lerConfig, gravarConfig, dados, saida, trabalho, baixados, aoVivo, mudar, discos, livreAtual, padrao, arquivoConfig, RAIZ };
