# Segurança

## Achou uma falha?

Mande para **suportes.compras@gmail.com** com o assunto "Segurança Clipador". **Não abra uma issue pública** com os detalhes: assim dá tempo de corrigir antes que alguém use a falha.

Conte o que conseguiu fazer, em qual versão e, se der, os passos para repetir. A resposta sai em até 7 dias.

## Como o Clipador protege quem usa

- Roda **no PC** da pessoa e só escuta em `127.0.0.1`. Na rede (`REDE=1`) ou em servidor, pede **senha**.
- Não manda vídeo nem dado nenhum para fora, a não ser o que a pessoa pede: baixar o vídeo pelo link, ler o chat público da live e atualizar o yt-dlp.
- Não tem conta, chave de API nem banco de dados.
- O instalador é montado pelo GitHub Actions a partir deste código.

## Para quem mexe no código

- **Nunca** coloque chave, token ou senha no código ou num commit. Use variável de ambiente (`.env`, que já está no `.gitignore`).
- Se uma chave vazar num commit, **troque a chave na hora**. Apagar o commit não basta, porque a chave já pode ter sido copiada.
