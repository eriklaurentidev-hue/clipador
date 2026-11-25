'use strict';
/**
 * Opções extras do Clipador:
 *  - tirarMusica: remonta um clipe só com a VOZ (tira a música de fundo, que é o
 *    motivo mais comum de o TikTok/YouTube derrubar corte de live). Usa o Demucs;
 *    se ele não estiver instalado, instala sozinho na primeira vez.
 *  - videoLongo: junta os cortes de um projeto num vídeo 16:9 pro YouTube, em
 *    ordem de tempo, e escreve os capítulos prontos pra colar na descrição.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const media = require('./media');
const pastas = require('./pastas');

function rodarPython(python, args, aoLinha) {
  return new Promise((resolve, reject) => {
    const p = spawn(python, args, { windowsHide: true });
    let err = '', buf = '';
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l && aoLinha) aoLinha(l); }
    });
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(err.split(/\r?\n/).filter(Boolean).slice(-3).join(' ') || ('codigo ' + code))));
  });
}

let demucsPronto = null;
/** Garante o Demucs no Python do programa. Instala na 1ª vez (~300 MB, uns minutos). */
async function garantirDemucs(python, avisar) {
  if (demucsPronto) return true;
  try { await rodarPython(python, ['-c', 'import demucs, soundfile']); demucsPronto = true; return true; } catch (_) {}
  if (avisar) avisar('Instalando o removedor de música (só na primeira vez, uns minutos)...');
  await rodarPython(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', 'demucs==4.0.1', 'soundfile']);
  await rodarPython(python, ['-c', 'import demucs, soundfile']);
  demucsPronto = true;
  return true;
}

/** Troca o áudio do clipe pela faixa só de voz. Devolve true se conseguiu. */
async function tirarMusica(mp4, python, avisar) {
  await garantirDemucs(python, avisar);
  const { ffmpeg } = await media.garantirFfmpeg();
  const base = path.join(pastas.trabalho(), 'voz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
  const wav = base + '.wav', voz = base + '-voz.wav', saida = base + '.mp4';
  try {
    await media.rodar(ffmpeg, ['-y', '-i', mp4, '-vn', '-ac', '2', '-ar', '44100', '-loglevel', 'error', wav]);
    if (avisar) avisar('Tirando a música de fundo (deixando só a voz)...');
    await rodarPython(python, [path.join(__dirname, '..', 'py', 'separar_voz.py'), '--audio', wav, '--voz', voz]);
    if (!fs.existsSync(voz)) throw new Error('o separador não devolveu a voz');
    await media.rodar(ffmpeg, ['-y', '-i', mp4, '-i', voz, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', '-loglevel', 'error', saida]);
    fs.copyFileSync(saida, mp4);
    return true;
  } finally {
    for (const f of [wav, voz, saida]) { try { fs.unlinkSync(f); } catch (_) {} }
  }
}

const mmss = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/**
 * Vídeo longo 16:9 pro YouTube com os cortes do projeto (ordem de tempo) e os capítulos.
 * Regras do YouTube pros capítulos: o 1º em 0:00, pelo menos 3, cada um com 10 s ou mais.
 * @returns {Promise<{arquivo, capitulos, aviso}>}
 */
async function videoLongo(pasta, aoProgredir) {
  let sessao;
  try { sessao = JSON.parse(fs.readFileSync(path.join(pasta, 'sessao.json'), 'utf8')); } catch (_) { throw new Error('Esse projeto não tem o sessao.json (versão antiga).'); }
  if (!sessao.video || !fs.existsSync(sessao.video)) throw new Error('O vídeo original desse projeto não está mais no mesmo lugar.');
  const cortes = (sessao.clipes || []).filter((c) => c.fim > c.inicio).sort((a, b) => a.inicio - b.inicio);
  if (!cortes.length) throw new Error('Esse projeto não tem cortes.');
  const { ffmpeg } = await media.garantirFfmpeg();
  const partes = [], capitulos = [];
  let t = 0;
  cortes.forEach((c, i) => {
    const dur = c.fim - c.inicio;
    capitulos.push(mmss(t) + ' ' + String(c.titulo || ('Parte ' + (i + 1))).replace(/\s+/g, ' ').trim());
    partes.push('[0:v]trim=start=' + c.inicio.toFixed(3) + ':end=' + c.fim.toFixed(3) + ',setpts=PTS-STARTPTS,' +
      'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v' + i + '];' +
      '[0:a]atrim=start=' + c.inicio.toFixed(3) + ':end=' + c.fim.toFixed(3) + ',asetpts=PTS-STARTPTS,aresample=48000[a' + i + ']');
    t += dur;
  });
  const junta = cortes.map((_, i) => '[v' + i + '][a' + i + ']').join('') + 'concat=n=' + cortes.length + ':v=1:a=1[v][a]';
  const arquivo = path.join(pasta, 'video-longo-youtube.mp4');
  const args = ['-y', '-i', sessao.video, '-filter_complex', partes.join(';') + ';' + junta, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-loglevel', 'error', arquivo];
  await media.rodar(ffmpeg, args, { aoProgredir: aoProgredir ? (seg) => aoProgredir(Math.min(1, seg / t)) : undefined, duracao: t });
  const txt = path.join(pasta, 'capitulos-youtube.txt');
  fs.writeFileSync(txt, capitulos.join('\n') + '\n', 'utf8');
  const curtos = cortes.filter((c) => c.fim - c.inicio < 10).length;
  const aviso = cortes.length < 3 ? 'O YouTube só mostra capítulos com 3 ou mais partes: esse projeto tem ' + cortes.length + '.'
    : curtos ? curtos + ' parte(s) têm menos de 10 s: o YouTube pode não mostrar os capítulos.' : null;
  return { arquivo, capitulos: capitulos.join('\n'), arquivoCapitulos: txt, duracao: t, aviso };
}

module.exports = { garantirDemucs, tirarMusica, videoLongo };
