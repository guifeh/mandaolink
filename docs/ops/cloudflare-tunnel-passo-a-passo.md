# Cloudflare Tunnel: passo a passo (para o Guilherme)

Objetivo: deixar o painel (PWA) acessível pelo celular em `https://painel.<seu-dominio>`, com HTTPS, sem abrir porta no roteador. O PC de casa só faz conexão de saída para a Cloudflare.

## O que o Guilherme cria (uma vez, ~20 min)
1. **Conta na Cloudflare** (plano gratuito).
2. **Um domínio na Cloudflare.** Duas opções:
   - comprar um pela própria Cloudflare; ou
   - usar um domínio que já tem, trocando os nameservers no registrador para os que a Cloudflare indicar. A propagação pode levar algumas horas.
3. **Ativar o Zero Trust** (plano gratuito) e criar um **túnel do tipo `cloudflared`** com o nome `mandaolink`. Pode ser que peça um cartão mesmo no plano gratuito; não verifiquei.
4. No túnel, adicionar um **hostname público**:
   - subdomínio `painel`, domínio `<seu-dominio>`;
   - serviço `HTTP`, URL `app:3000`.
5. **Copiar o token do túnel** que o painel mostra. Ele é um segredo: não colar em chat nem em e-mail. Entregar pelo cofre de chaves do OpenBot (o time pede pela tela de chave de API) ou colar direto no `.env` do PC, na linha `TUNNEL_TOKEN=`.
6. Informar ao time o endereço final, por exemplo `painel.meudominio.com.br`. Esse endereço não é segredo.

## O que o sistema configura (o time faz)
- Serviço `cloudflared` no `docker-compose.yml`, com `tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}`, `restart: unless-stopped` e na mesma rede do `app`.
- O `app` deixa de publicar a porta para a rede: só `127.0.0.1:3000`, ou nenhuma porta, porque o túnel alcança o app pela rede interna.
- `.env`: `APP_ORIGIN=https://painel.<seu-dominio>`, `COOKIE_SECURE=true` e `TUNNEL_TOKEN=...`.
- Fastify com `trustProxy` e IP do cliente lido de `CF-Connecting-IP`. Sem isso, todo acesso parece vir do container do túnel, e o limite de tentativas do login vale para todos de uma vez: 5 pedidos de link por minuto bloqueiam o próprio dono.
- Heartbeat de saída a cada 5 min para o monitor de uptime. O túnel não substitui esse aviso.
- Opcional: uma política do Cloudflare Access (código por e-mail) na frente do painel, como 2ª camada além do link mágico. Pode atrapalhar o PWA quando a sessão do Access expirar; testar antes de ligar.

## Como conferir
- No painel da Cloudflare, o túnel aparece como saudável.
- `https://painel.<seu-dominio>/saude` responde `{"status":"ok"}` pelo 4G do celular, com o Wi-Fi desligado.
- O PWA instala no celular e o Web Push chega.
