# API atrás do túnel e heartbeat

`APP_ORIGIN` define a origem dos links e das escritas permitidas. `COOKIE_SECURE=true` ativa o atributo Secure no cookie; use com HTTPS do túnel. `false` é só para desenvolvimento HTTP local. Cookie também é HttpOnly e SameSite Strict.

`TRUSTED_TUNNEL_PROXIES` é uma lista separada por vírgula de IPs/CIDRs dos **peers internos do cloudflared** que alcançam a API. Exemplo sintético: `172.30.0.10/32`, se esse for o IP fixado exclusivamente para o container do túnel. Não use um CIDR amplo da LAN, `trustProxy=true` ou os ranges públicos da Cloudflare: o peer aqui é o container interno.

O Fastify confia somente nessa lista. O rate limit lê `CF-Connecting-IP` apenas quando o socket vem de um peer permitido e o header contém um IP válido. Sem túnel confiável ou sem header válido, a chave é o IP do socket; `CF-Connecting-IP`/`X-Forwarded-For` falsificados em acesso direto não separam tentativas. A lista vazia (padrão) desliga a confiança nos headers. O app deve continuar sem porta pública na LAN, conforme a J4.

`HEARTBEAT_URL` vazia desliga o heartbeat. Quando configurada, o processo faz GET a cada 5 min, apenas se o banco responder; não há envio imediato ao iniciar. Requests não se sobrepõem, têm timeout de 10 s, não seguem redirects e não imprimem a URL. A URL pode conter token do monitor: configure pelo ambiente e trate como segredo. Shutdown remove o timer e aborta requests em andamento. O monitor deve tolerar pelo menos um intervalo de 5 min antes de alertar.

Nenhum túnel/monitor foi criado ou conectado. Os testes simulam HTTP e relógio e verificam confiança por peer, proteção contra header forjado, cookie HTTPS/origem e heartbeat ligado/desligado. A configuração real depende do IP interno do cloudflared e da URL do monitor fornecidos ao ambiente de operação.
