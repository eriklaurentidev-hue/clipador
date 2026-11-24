'use strict';
/**
 * Monta a legenda .ass no estilo dos cortes que rodam bem:
 * poucas palavras por vez, fonte grossa com contorno preto e a palavra
 * que esta sendo dita naquele instante destacada em amarelo.
 */

const fs = require('fs');

const PALAVRAS_POR_BLOCO = 3;

// Cores no formato ASS: &HAABBGGRR (sim, e BGR invertido)
const BRANCO = '&H00FFFFFF';
const AMARELO = '&H0000E5FF';
const PRETO = '&H00000000';

function tempoAss(s) {
  // arredonda pro centesimo ANTES de separar: 59.996 virava "0:00:60.00"
  const cs = Math.round(Math.max(0, Number(s) || 0) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const seg = (cs % 6000) / 100;
  return h + ':' + String(m).padStart(2, '0') + ':' + seg.toFixed(2).padStart(5, '0');
}

// Legenda nao pode ficar parada na tela durante um silencio: se a proxima
// palavra demora mais que isso, o bloco fecha e a palavra some logo depois de dita.
const PAUSA_QUEBRA = 0.7;
const SEGURA_DEPOIS = 0.35;

/** Agrupa em blocos de ate 3 palavras, sem juntar palavras separadas por pausa. */
function montarBlocos(palavras, maximo) {
  const lista = (palavras || [])
    .filter((p) => p && isFinite(p.inicio) && isFinite(p.fim) && String(p.texto || '').trim())
    .slice().sort((a, b) => a.inicio - b.inicio);
  const blocos = [];
  let atual = [];
  for (const p of lista) {
    const ultima = atual[atual.length - 1];
    if (atual.length && (atual.length >= maximo || p.inicio - ultima.fim > PAUSA_QUEBRA)) { blocos.push(atual); atual = []; }
    atual.push(p);
  }
  if (atual.length) blocos.push(atual);
  return blocos;
}

function escapar(t) {
  return String(t)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function cabecalho(opcoes) {
  const fonte = opcoes.fonte || 'Arial Black';
  const tamanho = opcoes.tamanho || 78;
  const margemBaixo = opcoes.margemBaixo || 300;
  const margemGancho = opcoes.margemGancho || 150;
  // No meio da tela o gancho e o centro das atencoes: letra maior
  const tamanhoGancho = opcoes.tamanhoGancho || (opcoes.posicaoGancho === 'meio' ? 74 : 62);
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // estilo "amarela": a legenda toda amarela (padrao dos cortes de podcast/react)
    'Style: Corte,' + fonte + ',' + tamanho + ',' + (opcoes.estiloLegenda === 'amarela' ? AMARELO : BRANCO) + ',' + AMARELO + ',' + PRETO + ',&H64000000,' +
      '-1,0,0,0,100,100,1,0,1,7,4,2,70,70,' + margemBaixo + ',1',
    // Alignment 8 = em cima, centralizado; 5 = bem no meio da tela. BorderStyle 3
    // desenha uma tarja atras do texto: legivel por cima de qualquer imagem.
    'Style: Gancho,' + fonte + ',' + tamanhoGancho + ',' + BRANCO + ',' + BRANCO + ',' + PRETO + ',&HC8000000,' +
      '-1,0,0,0,100,100,0,0,3,10,0,' + (opcoes.posicaoGancho === 'meio' ? 5 : 8) + ',60,60,' +
      (opcoes.posicaoGancho === 'meio' ? 0 : margemGancho) + ',1',
    estiloFixo(opcoes.textoFixo, fonte),
    // cartao do nome: caixa azul (BorderStyle 3 = tarja), texto branco
    'Style: Nome,' + fonte + ',68,' + BRANCO + ',' + BRANCO + ',&H00F08B3D,&H00000000,-1,0,0,0,100,100,2,0,3,20,0,5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

// ---------------------------------------------------------------- texto fixo

/**
 * Texto que a pessoa escreve pra ir em todo clipe ("AO VIVO AGORA",
 * "@meucanal", "O MAIS INSANO DA LIVE"...). Diferente do gancho, que sai da
 * fala: esse e fixo, no lugar escolhido, o clipe todo ou so no comeco.
 *
 * textoFixo = { texto, posicao: 'topo'|'meio'|'baixo', duracao (s, 0 = todo),
 *               cor: 'branco'|'amarelo', tamanho }
 * "/" no texto quebra a linha onde a pessoa quiser.
 */
const MARGEM_FIXO = { topo: 210, meio: 0, baixo: 430 };
const ALINHA_FIXO = { topo: 8, meio: 5, baixo: 2 };

function posicaoFixo(t) {
  return MARGEM_FIXO[t && t.posicao] != null ? t.posicao : 'meio';
}

function estiloFixo(t, fonte) {
  const pos = posicaoFixo(t);
  const tamanho = Math.max(40, Math.min(130, Number(t && t.tamanho) || 76));
  const cor = t && t.cor === 'amarelo' ? AMARELO : BRANCO;
  // contorno grosso + sombra, sem tarja: legivel em cima do jogo sem tampar
  return 'Style: Fixo,' + fonte + ',' + tamanho + ',' + cor + ',' + cor + ',' + PRETO + ',&H96000000,' +
    '-1,0,0,0,100,100,0,0,1,8,3,' + ALINHA_FIXO[pos] + ',60,60,' + MARGEM_FIXO[pos] + ',1';
}

function linhaFixo(t) {
  const bruto = semEmojis(t && t.texto);
  if (!bruto) return null;
  const tamanho = Math.max(40, Math.min(130, Number(t.tamanho) || 76));
  const porLinha = Math.max(10, Math.round((26 * 62) / tamanho));
  const texto = bruto.includes('/')
    ? bruto.split('/').map((p) => escapar(p.trim()).toUpperCase()).filter(Boolean).slice(0, 4).join('\\N')
    : quebrarGancho(escapar(bruto).toUpperCase(), porLinha);
  // 0 = o clipe inteiro (10h cobre qualquer corte)
  const ate = Number(t.duracao) > 0 ? Number(t.duracao) : 36000;
  return 'Dialogue: 2,' + tempoAss(0) + ',' + tempoAss(ate) + ',Fixo,,0,0,0,,' + texto;
}

/**
 * Emoji some do texto queimado: a fonte do video renderiza ele como um
 * quadradinho preto. No titulo que a pessoa copia pra legenda, ele fica.
 */
function semEmojis(texto) {
  return String(texto || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Quebra o gancho em 2 linhas equilibradas. Uma linha muito comprida some
 * na lateral do celular e ninguem le a tempo.
 */
function quebrarGancho(texto, porLinha) {
  const palavras = String(texto).split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if (atual && (atual + ' ' + p).length > porLinha) { linhas.push(atual); atual = p; }
    else atual = atual ? atual + ' ' + p : p;
  }
  if (atual) linhas.push(atual);
  return linhas.slice(0, 3).join('\\N');
}

/**
 * @param {Array} palavras  [{inicio, fim, texto}] em tempo ABSOLUTO do video
 * @param {number} offset   segundo em que o clipe comeca (pra zerar o tempo)
 * @param {string} destino  caminho do .ass
 */
function gerarAss(palavras, offset, destino, opcoes) {
  opcoes = opcoes || {};
  const linhas = [cabecalho(opcoes)];

  // O gancho fica na tela nos primeiros segundos. E o que segura quem parou de
  // rolar antes mesmo de entender o audio - e muita gente assiste sem som.
  const semEmoji = semEmojis(opcoes.gancho);
  if (semEmoji.length >= 8) {
    const duracao = Math.max(2, Math.min(8, opcoes.duracaoGancho || 4));
    // letra maior, menos letra por linha: 26 cabe no tamanho 62
    const porLinha = Math.max(14, Math.round((26 * 62) / (opcoes.tamanhoGancho || (opcoes.posicaoGancho === 'meio' ? 74 : 62))));
    const texto = quebrarGancho(escapar(semEmoji).toUpperCase(), porLinha);
    linhas.push('Dialogue: 1,' + tempoAss(0) + ',' + tempoAss(duracao) + ',Gancho,,0,0,0,,{\\fad(180,320)}' + texto);
  }

  // cartao com o nome do streamer, centralizado na linha entre a webcam e o jogo
  const nome = semEmojis(opcoes.textoFixo && opcoes.textoFixo.nome).slice(0, 30);
  if (nome && opcoes.alturaDivisao) {
    linhas.push('Dialogue: 3,' + tempoAss(0) + ',' + tempoAss(36000) + ',Nome,,0,0,0,,{\\pos(540,' + Math.round(opcoes.alturaDivisao) + ')}' + escapar(nome).toUpperCase());
  }

  const fixo = linhaFixo(opcoes.textoFixo);
  if (fixo) linhas.push(fixo);

  // A legenda palavra-por-palavra e o gancho sao independentes: a pessoa pode
  // querer so o gancho no topo, sem a legenda embaixo cobrindo o resto do video.
  // Agrupa em blocos curtos - texto comprido na tela ninguem le
  // (palavra que ja tinha terminado antes do clipe comecar nao entra)
  const doClipe = (palavras || []).filter((p) => p && Number(p.fim) - offset > 0.05);
  const blocos = opcoes.incluirPalavras !== false ? montarBlocos(doClipe, PALAVRAS_POR_BLOCO) : [];

  for (let b = 0; b < blocos.length; b++) {
    const bloco = blocos[b];
    // o bloco seguinte nunca pode entrar com este ainda na tela: duas legendas
    // ao mesmo tempo o ffmpeg empilha uma em cima da outra
    const proximoBloco = blocos[b + 1] ? blocos[b + 1][0].inicio - offset : Infinity;
    for (let i = 0; i < bloco.length; i++) {
      const atual = bloco[i];
      const inicio = Math.max(0, atual.inicio - offset);
      // dentro do bloco a palavra segura ate a proxima comecar (evita piscada);
      // a ultima segura um tico depois de dita, sem invadir o proximo bloco
      const proxima = bloco[i + 1];
      const desejado = proxima ? proxima.inicio - offset : atual.fim - offset + SEGURA_DEPOIS;
      const fim = Math.max(inicio + 0.12, Math.min(desejado, proximoBloco));
      if (fim <= 0) continue; // palavra que terminou antes do clipe comecar

      const texto = bloco.map((p, j) => {
        const limpo = escapar(p.texto);
        if (j === i) {
          // estilo "amarela": tudo ja e amarelo, a palavra dita so cresce um tico
          if (opcoes.estiloLegenda === 'amarela') return '{\\fscx110\\fscy110}' + limpo + '{\\fscx100\\fscy100}';
          // palavra sendo dita: amarela e um tico maior
          return '{\\c' + AMARELO + '\\fscx108\\fscy108}' + limpo + '{\\c' + BRANCO + '\\fscx100\\fscy100}';
        }
        return limpo;
      }).join(' ');

      linhas.push(
        'Dialogue: 0,' + tempoAss(inicio) + ',' + tempoAss(fim) + ',Corte,,0,0,0,,' + texto
      );
    }
  }

  fs.writeFileSync(destino, linhas.join('\n'), 'utf8');
  return destino;
}

/** Legenda .srt simples, pra quem quiser editar depois no CapCut/Premiere. */
function gerarSrt(palavras, offset, destino) {
  const blocos = montarBlocos((palavras || []).filter((p) => p && Number(p.fim) - offset > 0.05), 8);

  const partes = blocos.map((g, idx) => {
    const ini = Math.max(0, g[0].inicio - offset);
    const seguinte = blocos[idx + 1] ? blocos[idx + 1][0].inicio - offset : Infinity;
    const fim = Math.max(ini + 0.3, Math.min(g[g.length - 1].fim - offset, seguinte));
    return [
      String(idx + 1),
      tempoSrt(ini) + ' --> ' + tempoSrt(fim),
      g.map((p) => p.texto).join(' ').replace(/\s+/g, ' ').trim(),
      '',
    ].join('\n');
  });

  fs.writeFileSync(destino, partes.join('\n'), 'utf8');
  return destino;
}

function tempoSrt(s) {
  // arredonda pro milesimo ANTES de separar: 1.9996 virava "00:00:01,1000"
  const total = Math.round(Math.max(0, Number(s) || 0) * 1000);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const seg = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
         String(seg).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}

/** Onde fica a linha entre a webcam e o jogo (formato rosto + jogo), em pixels do 1080x1920. */
function alturaDaDivisao(formato, recorte) {
  if (formato !== 'split') return null;
  const fracao = Math.max(0.15, Math.min(0.6, (recorte && recorte.proporcaoTopo) || 0.3));
  return Math.round(1920 * fracao / 2) * 2;
}

module.exports = {
  gerarAss, gerarSrt, alturaDaDivisao,
  // texto fixo ou cartao com o nome: os dois precisam do .ass
  temTextoFixo: (t) => !!(semEmojis(t && t.texto) || semEmojis(t && t.nome)),
};
