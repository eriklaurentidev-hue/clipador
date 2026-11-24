'use strict';
/**
 * Titulo e gancho pra corte de LIVE DE JOGO.
 *
 * O que os cortes que viralizam tem em comum (e o que o titulo antigo nao tinha):
 *  - a palavra-chave na frente: QUEM (o streamer) + ONDE (o jogo). E o que a
 *    busca do TikTok/YouTube le pra entregar o video pra quem procura;
 *  - o QUE aconteceu, num tipo que a pessoa reconhece: risada, jogada, deu ruim,
 *    susto. Isso cria a lacuna ("o que ele fez?") que so fecha assistindo;
 *  - nunca a frase crua da fala quando a transcricao veio ruim - com o som do
 *    jogo por cima, o Whisper erra e o titulo vira frase sem sentido.
 *
 * Tudo local, sem IA de fora: regras + o que a live ja diz (titulo, canal, fala).
 */

// ---------------------------------------------------------------- jogo

// [regex, nome bonito, hashtags, kids] - a primeira que bater vale
const JOGOS = [
  [/\bgta\s*(6|vi)\b|\bvice city\b|\bleonida\b/i, 'GTA 6', ['gta6', 'gtavi', 'gta']],
  [/\bgta\s*rp\b|\bcidade alta\b|\bnowa?rp\b/i, 'GTA RP', ['gtarp', 'gta']],
  [/\bgta\b/i, 'GTA', ['gta', 'gtarp']],
  [/\bvalorant\b|\bvava\b/i, 'Valorant', ['valorant', 'valorantbr']],
  [/\bcs\s?2\b|\bcounter.?strike\b|\bcsgo\b|\bcs\s?go\b/i, 'CS2', ['cs2', 'counterstrike']],
  [/\bleague of legends\b|\blol\b|\bworlds\b|\bcblol\b/i, 'LoL', ['lol', 'leagueoflegends']],
  [/\bfree\s?fire\b|\bff\b/i, 'Free Fire', ['freefire', 'ff']],
  [/\bfortnite\b/i, 'Fortnite', ['fortnite', 'fortnitebr']],
  [/\bminecraft\b/i, 'Minecraft', ['minecraft', 'minecraftbrasil']],
  [/\bea\s?fc\b|\bfc\s?2[4-7]\b|\bfifa\b/i, 'EA FC', ['eafc', 'fifa']],
  [/\bwarzone\b|\bcall of duty\b|\bcod\b/i, 'Warzone', ['warzone', 'callofduty']],
  [/\bpath of exile\b|\bpoe\s?2?\b/i, 'Path of Exile 2', ['pathofexile', 'poe2']],
  [/\brocket league\b/i, 'Rocket League', ['rocketleague']],
  [/\bdota\b/i, 'Dota 2', ['dota2']],
  [/\brainbow six\b|\br6\b/i, 'Rainbow Six', ['r6', 'rainbowsix']],
  [/\bapex\b/i, 'Apex', ['apexlegends']],
  [/\bpubg\b/i, 'PUBG', ['pubg']],
  [/\bmarvel rivals\b/i, 'Marvel Rivals', ['marvelrivals']],
  [/\boverwatch\b/i, 'Overwatch', ['overwatch']],
  [/\btibia\b/i, 'Tibia', ['tibia']],
  [/\brust\b/i, 'Rust', ['rust']],
  [/\brobl(o|ó)x\b|\bbrainrot\b|\broube um\b/i, 'Roblox', ['roblox', 'robloxbrasil'], true],
];

// "GTA VOLTA AMANHA", "depois tem CS": o jogo citado nao e o desta live
const DEPOIS_DO_NOME = new RegExp("^[^a-z0-9]{0,4}(volta|voltamos|amanh[aã]|mais tarde|em breve|semana que vem)", "i"); // "GTA VOLTA AMANHA"
const ANTES_DO_NOME = new RegExp("(depois|amanh[aã]|ontem|mais tarde|em breve|pr[oó]xima live)( tem| e| vai ter| vem)?[^a-z0-9]{0,4}$", "i"); // "depois tem LoL"

/** O jogo pelo titulo da live, nome do arquivo e (por ultimo) a fala. */
function detectarJogo(contexto, fala) {
  const onde = [String(contexto || ''), String(fala || '')];
  for (const texto of onde) {
    const t = texto.replace(/[_-]+/g, ' ');
    for (const [re, nome, tags, kids] of JOGOS) {
      const m = re.exec(t);
      if (!m) continue;
      // na fala (ultimo recurso) o streamer cita outros jogos de passagem: so vale se repetir
      if (texto === onde[1] && (t.match(new RegExp(re.source, 'gi')) || []).length < 3) continue;
      // "GTA VOLTA AMANHA", "depois tem CS": o jogo citado nao e o desta live
      const antes = t.slice(Math.max(0, m.index - 20), m.index);
      const depois = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
      if (DEPOIS_DO_NOME.test(depois) || ANTES_DO_NOME.test(antes)) continue;
      return { nome, tags, kids: !!kids };
    }
  }
  return null;
}

/** "paulinho-o-loko" -> "Paulinho O Loko"; "mwzera" -> "Mwzera". */
function nomeDoStreamer(canal) {
  const c = String(canal || '').trim();
  if (!c || /^(live|ao vivo|canal|twitch|kick|youtube|na|null|undefined)$/i.test(c)) return null;
  if (/[A-Z]/.test(c) && !/[-_]/.test(c)) return c; // ja vem com maiusculas (YouTube): mantem
  return c.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((p, i) => (i > 0 && /^(o|a|os|as|de|da|do|das|dos|e)$/i.test(p) ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

// ---------------------------------------------------------------- fala

/**
 * A fala desse trecho da pra confiar? Confianca media do Whisper e cara de
 * frase de verdade (nao "80 ÃO CHAU ZI"). Fala ruim nao vira titulo.
 */
function qualidadeDaFala(corte) {
  const palavras = corte.palavras || [];
  const comConf = palavras.filter((p) => p && p.conf != null);
  const conf = comConf.length ? comConf.reduce((s, p) => s + Number(p.conf), 0) / comConf.length : null;
  const tokens = String(corte.texto || '').toLowerCase().match(/[a-zà-ú0-9]+/g) || [];
  const curtas = tokens.filter((t) => t.length <= 2).length / Math.max(1, tokens.length);
  const unicas = new Set(tokens).size / Math.max(1, tokens.length);
  const ruim = (conf != null && conf < 0.62) || tokens.length < 4 || curtas > 0.45 || unicas < 0.35;
  return { conf, ruim };
}

// ---------------------------------------------------------------- tipo do momento

const RISADA = /\b(k{3,}\w*|(?:ha){2,}h?|(?:he){3,}|(?:hu){3,}|rs(?:rs)+|risos?|rindo|chorei de rir|morri de rir)\b/i;
const JOGADA = /\b(ace|clutch|matei|matou|amassei|amassou|headshot|na cabe[cç]a|ganhamos|ganhei|vit[oó]ria|booyah|limpei|limpou|virada|virou o jogo|um contra (dois|tr[eê]s|quatro|cinco)|1v[1-5]|quadra|penta|triple kill|double kill|fugi|fugiu|escapei|escapou|consegui|conseguiu|zerei|dropou|lend[aá]rio)\b/i;
const DEU_RUIM = /\b(morri|morreu|perdi|perdemos|perdeu|tiltei|tiltou|errei|errou|deu ruim|me ferrei|se ferrou|bugou|travou|explodiu|capotou|bateu|presos?|pres[ao]|me pegaram|pegaram)\b/i;
const SUSTO = /\b(n[aã]o acredito|meu deus|mds|caraca|caramba|socorro|que isso|o que foi isso|nossa|eita|surreal|absurdo|insano|bizarro|olha isso)\b/i;

/**
 * Que tipo de momento e esse. Com fala ruim, so vale o sinal que nao depende
 * da transcricao: risada escrita ("kkkk") e o pico de reacao (voz + imagem).
 */
function tipoDoMomento(corte, falaRuim) {
  const t = String(corte.texto || '');
  const motivos = (corte.motivos || []).map((m) => String(m.fator || m)).join(' | ');
  const temPico = /momento|pico|grito|volume|chat/i.test(motivos) || corte.origem === 'auto';
  if (RISADA.test(t)) return 'risada';
  if (!falaRuim) {
    if (JOGADA.test(t)) return 'jogada';
    if (DEU_RUIM.test(t)) return 'ruim';
    if (SUSTO.test(t)) return 'susto';
  }
  if (/chat/i.test(motivos)) return 'chat';
  return temPico ? 'susto' : 'generico';
}

// ---------------------------------------------------------------- titulo e gancho

// {S} = streamer, {J} = jogo. Variantes pra 8 cortes da mesma live nao sairem iguais.
const TITULOS = {
  risada: ['{S} não aguentou de rir nessa{noJ} 😂', '{S} chorou de rir com isso{noJ} 😂', 'Ninguém segurou a risada nessa live do {S}{noJ} 😂'],
  jogada: ['{S} fez a jogada mais insana da live{noJ} 🔥', 'Que jogada do {S}{noJ} 🔥', '{S} amassou nessa{noJ} 🔥'],
  ruim: ['Deu muito ruim pro {S}{noJ} 😭', '{S} não esperava esse final{noJ} 😭', 'O {S} se ferrou nessa{noJ} 😭'],
  susto: ['{S} não acreditou no que aconteceu{noJ} 😱', '{S} surtou com isso{noJ} 😱', 'O momento mais insano da live do {S}{noJ} 😱', '{S} ficou sem reação{noJ} 😳', 'Olha a reação do {S} nessa{noJ} 😱', '{S} gritou demais nessa{noJ} 😱', 'Ninguém esperava isso na live do {S}{noJ} 🤯'],
  chat: ['O chat foi à loucura com o {S}{noJ} 🤯', 'Ninguém esperava isso na live do {S}{noJ} 🤯'],
  generico: ['O momento mais insano da live do {S}{noJ} 😱', '{S} não esperava por isso{noJ} 👀', 'Olha o que aconteceu na live do {S}{noJ} 👀', 'Esse momento do {S}{noJ} foi demais 🔥', 'Espera o final dessa do {S}{noJ} 👀'],
};
const TITULOS_SEM_STREAMER = {
  risada: ['Ninguém aguentou de rir nessa{noJ} 😂', 'A risada mais sincera da live{noJ} 😂'],
  jogada: ['A jogada mais insana da live{noJ} 🔥', 'Que jogada foi essa{noJ}? 🔥'],
  ruim: ['Deu muito ruim nessa{noJ} 😭', 'Ninguém esperava esse final{noJ} 😭'],
  susto: ['Ninguém acreditou no que aconteceu{noJ} 😱', 'O momento mais insano da live{noJ} 😱', 'Olha essa reação{noJ} 😱', 'Ninguém esperava isso{noJ} 🤯'],
  chat: ['O chat foi à loucura com isso{noJ} 🤯'],
  generico: ['O momento mais insano da live{noJ} 😱', 'Ninguém esperava por isso{noJ} 👀'],
};
// gancho queimado na tela (curto; o emoji some no video)
const GANCHOS = {
  risada: ['NÃO AGUENTEI DE RIR', 'ELE CHOROU DE RIR', 'TENTA NÃO RIR'],
  jogada: ['QUE JOGADA FOI ESSA?', 'OLHA O QUE ELE FEZ', 'ESSA FOI INSANA'],
  ruim: ['DEU MUITO RUIM NO FINAL', 'ELE NÃO ESPERAVA ESSA', 'ESPERA O FINAL'],
  susto: ['ELE NÃO ESPERAVA ISSO', 'OLHA O QUE ACONTECEU', 'NINGUÉM ACREDITOU'],
  chat: ['O CHAT FOI À LOUCURA', 'NINGUÉM ESPERAVA ISSO'],
  generico: ['ESPERA O FINAL', 'OLHA O QUE ACONTECEU', 'VOCÊ NÃO VAI ACREDITAR'],
};

function escolher(lista, semente) {
  let h = 0;
  const s = String(semente || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return lista[h % lista.length];
}

// Palavrao no titulo derruba alcance (TikTok limita) - na fala do video fica.
const PALAVRAO = /\b(caralh\w*|porra\w*|fod\w*|merd\w*|put[ao]\w*|fdp|krl|crl|pqp|buceta|cu|viad\w*|arrombad\w*)\b/gi;
function semPalavrao(t) {
  return String(t || '').replace(PALAVRAO, '').replace(/\s{2,}/g, ' ').replace(/^[\s,.!?]+/, '').trim();
}

/**
 * Titulos com SEO pra live de jogo. O primeiro e o recomendado (palavra-chave
 * na frente); se a fala estiver boa, a frase mais forte dela vem como opcao.
 * @param {object} info  { streamer, jogo }
 * @param {object} extra { fraseForte } frase da fala ja escolhida pelo copy.js
 */
function titulosDeJogo(corte, info, extra) {
  const fala = qualidadeDaFala(corte);
  const tipo = tipoDoMomento(corte, fala.ruim);
  const semente = String(corte.inicio || 0) + '|' + String(corte.texto || '').slice(0, 40);
  const noJ = info.jogo ? ' no ' + info.jogo : '';
  const montar = (modelo) => modelo.replace(/\{S\}/g, info.streamer || '').replace(/\{noJ\}/g, noJ).replace(/\s+/g, ' ').trim();
  const base = info.streamer ? TITULOS : TITULOS_SEM_STREAMER;
  const lista = base[tipo] || base.generico;

  const titulos = [];
  const add = (texto, estilo) => {
    const t = String(texto || '').replace(/\s+/g, ' ').trim();
    if (t.length >= 12 && !titulos.some((x) => x.texto.toLowerCase() === t.toLowerCase())) titulos.push({ texto: t, estilo });
  };
  const evitar = (extra && extra.evitar) || new Set();
  const ordem = lista.map((_, i) => lista[(lista.indexOf(escolher(lista, semente)) + i) % lista.length]);
  const livres = ordem.map(montar).filter((t) => !evitar.has(t.toLowerCase()));
  add(livres[0] || montar(ordem[0]), 'seo');
  // a fala, so quando da pra confiar nela - e com a palavra-chave na frente
  // (frase com palavrao ou so risada fica de fora: tirar a palavra quebra a frase)
  const fraseOk = extra && extra.fraseForte && !new RegExp(PALAVRAO.source, 'i').test(extra.fraseForte) && !RISADA.test(extra.fraseForte);
  if (!fala.ruim && fraseOk) {
    const frase = semPalavrao(extra.fraseForte);
    if (frase.length >= 15) add((info.streamer ? info.streamer + ': ' : '') + '"' + frase.charAt(0).toUpperCase() + frase.slice(1) + '"' + (info.jogo ? ' | ' + info.jogo : ''), 'fala');
  }
  add(livres[1] || montar(ordem[1 % ordem.length]), 'seo');
  return { titulos: titulos.slice(0, 3), tipo, falaRuim: fala.ruim };
}

function ganchoDeJogo(corte) {
  const fala = qualidadeDaFala(corte);
  const tipo = tipoDoMomento(corte, fala.ruim);
  return escolher(GANCHOS[tipo] || GANCHOS.generico, String(corte.inicio || 0) + '|' + tipo);
}

module.exports = { detectarJogo, nomeDoStreamer, qualidadeDaFala, tipoDoMomento, titulosDeJogo, ganchoDeJogo, semPalavrao, JOGOS };
