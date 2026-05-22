# 🎯 Esferas da Taísa RA — Multiplayer

Um jogo **multiplayer de tiro em realidade aumentada (AR)** que roda 100% no navegador do celular. Os jogadores se reúnem em uma sala compartilhada, escaneiam um marcador QR físico para alinhar o mundo virtual, e disputam quem destrói mais esferas flutuantes no espaço ao redor — usando a câmera do celular e o giroscópio para mirar.

Sem app, sem instalação. Funciona em **Android** e **iOS** via Safari/Chrome.

---

## 📖 Sumário

- [Visão geral](#-visão-geral)
- [Como funciona o jogo](#-como-funciona-o-jogo)
- [Stack tecnológico](#-stack-tecnológico)
- [Arquitetura](#-arquitetura)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Rodando localmente](#-rodando-localmente)
- [Deploy em VPS](#-deploy-em-vps)
- [Como jogar](#-como-jogar)
- [Sobre o marcador QR](#-sobre-o-marcador-qr)
- [Roteiro de desenvolvimento](#-roteiro-de-desenvolvimento)
- [Decisões de design](#-decisões-de-design)
- [Limitações conhecidas](#-limitações-conhecidas)
- [Licença](#-licença)

---

## 🎮 Visão geral

**O conceito:** vários jogadores no mesmo espaço físico abrem o site no celular, entram numa sala compartilhada com um código de 6 letras e disputam uma partida de tiro em AR. As esferas ficam **fixas no espaço real**: se um jogador atira e acerta a esfera B, ela desaparece para todos ao mesmo tempo. Vence quem fizer mais pontos antes que todas as esferas sejam destruídas (ou que o tempo acabe).

**Por que é interessante tecnicamente:**

- ✅ **Servidor autoritativo** — o servidor controla as esferas; cliente nunca decide sozinho se acertou
- ✅ **Roda em iOS e Android** (sem WebXR, que o Safari não suporta)
- ✅ **Web pura** — Node.js + Three.js, sem motor proprietário
- ✅ **Coordenadas compartilhadas via marcador físico** (QR impresso)
- ✅ **Anti-cheat básico** — todos os hits passam pelo servidor

**O que não é:**

- ❌ Não é AR fotorrealista (não usa SLAM nem detecção de planos)
- ❌ Não funciona com 6DOF (jogador precisa ficar parado e girar no eixo)
- ❌ Não tem matchmaking — os jogadores combinam por fora e usam o código da sala

---

## 🕹️ Como funciona o jogo

```
HOME (apelido)
   │
   ├─→ CRIAR SALA  ──→  recebe código de 6 chars (ex: ABCD23)
   │                       │
   └─→ ENTRAR SALA ───→  digita código + apelido
                           │
                           ▼
                       LOBBY
                  ┌─ HOST vê "INICIAR PARTIDA"
                  └─ outros veem "Aguardando host..."
                           │
                           ▼ (host toca iniciar)
                       CALIBRAR
                  "aponte pro marcador QR e toque CALIBRAR"
                  (cada jogador independentemente)
                           │
                           ▼
                       PLACE (host) | WATCH (outros)
                  HOST posiciona 3+ esferas; outros veem em tempo real
                           │
                           ▼ (host toca "INICIAR DISPUTA")
                       PLAY (60 segundos)
                  todos atiram nas mesmas esferas
                  primeiro a acertar leva o ponto
                           │
                           ▼ (sem esferas OU tempo esgotou)
                       RANKING
                  pódio com todos os jogadores ordenados por pontos
                           │
                           ▼ (host toca "Nova partida")
                       (volta pra CALIBRAR)
```

### Regras de pontuação padrão

| Tipo de esfera | Cor             | Pontos | Tamanho   |
|---------------|-----------------|--------|-----------|
| Normal        | ciano           | 10     | maior     |
| Rápida        | verde neon      | 20     | médio     |
| Rara          | vermelho fogo   | 50     | menor     |

A distribuição quando o host posiciona é aleatória: ~55% normal, ~30% rápida, ~15% rara.

---

## 🧱 Stack tecnológico

### Cliente

| Tecnologia        | Por quê                                                                      |
|-------------------|------------------------------------------------------------------------------|
| **HTML + JS vanilla** | Zero overhead de framework. Em câmera + WebGL no celular, cada KB conta.    |
| **Three.js** (CDN) | Render 3D no canvas (esferas, anéis, animações).                            |
| **Socket.IO**     | Tempo real com reconexão automática, fallback de transporte e namespaces. |
| **DeviceOrientation API** | Lê giroscópio do celular pra orientação da câmera virtual.            |
| **getUserMedia**  | Acessa a câmera traseira do celular pra fundo do AR.                       |

### Servidor

| Tecnologia        | Por quê                                                                |
|-------------------|----------------------------------------------------------------------|
| **Node.js 20** (ESM) | Runtime único entre front e back; ES modules nativos.                |
| **Express**       | HTTP minimal pra REST das salas + serve estáticos.                   |
| **Socket.IO**     | WebSocket com salas (rooms) nativas, perfeito pra broadcast por sala. |
| **mysql2/promise** | Driver MySQL leve (sem ORM).                                         |
| **dotenv**        | Variáveis de ambiente.                                                |
| **PM2**           | Mantém o processo Node vivo em produção, reinicia se cair.           |

### Infra (recomendação)

| Tecnologia          | Por quê                                                              |
|---------------------|----------------------------------------------------------------------|
| **VPS Linux**       | Controle total, custo previsível.                                    |
| **CloudPanel**      | Painel grátis pra Node.js + MySQL + nginx + Let's Encrypt.           |
| **MySQL 8**         | Persistência de salas + scores (entra na Fase 4).                    |
| **nginx**           | Reverse proxy com upgrade de WebSocket.                              |
| **Let's Encrypt**   | HTTPS gratuito (obrigatório pra câmera e giroscópio funcionarem).    |

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        CELULAR DO JOGADOR                       │
│                                                                 │
│  ┌───────────┐  ┌─────────────┐  ┌─────────────────────────┐    │
│  │ Câmera    │  │ Giroscópio  │  │  Canvas Three.js        │    │
│  │ traseira  │→ │ (alpha,     │→ │  (esferas + crosshair)  │    │
│  │ (vídeo BG)│  │  beta,      │  │                         │    │
│  └───────────┘  │  gamma)     │  └─────────────────────────┘    │
│                 └─────────────┘                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   Socket.IO client                                       │   │
│  │   ├─ emit:  room:join, sphere:shoot, sphere:place...     │   │
│  │   └─ recv:  sphere:placed, sphere:destroyed, ...         │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└──────────────────────────┬│┬─────────────────────────────────────┘
                           ▼│▼  WSS (WebSocket Secure)
┌──────────────────────────┴┴┴────────────────────────────────────┐
│                       nginx (HTTPS)                             │
│                  (faz upgrade pra WebSocket)                    │
└──────────────────────────┬┬┬────────────────────────────────────┘
                           ▼│▼
┌──────────────────────────┴┴┴────────────────────────────────────┐
│                      Node.js + Express                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/sockets.js — handlers Socket.IO                      │   │
│  │   room:join / leave    → rooms-repo.js (cria/lê)         │   │
│  │   game:start / play_start                                │   │
│  │   sphere:place / clear / shoot  → games.js (autoritativo)│   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/games.js — estado em memória das partidas ativas     │   │
│  │   Map<roomCode, GameState>                               │   │
│  │   • spheres (Map id → {id, type, x, y, z, alive})        │   │
│  │   • scores  (Map nick → {score, hits})                   │   │
│  │   • timer fim-de-jogo                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/rooms-repo.js — abstrai persistência das salas       │   │
│  │   Implementação dupla: memória OU MySQL                  │   │
│  │   (decisão automática baseada em DB_HOST do .env)        │   │
│  └─────────────────┬────────────────────────────────────────┘   │
└────────────────────┬┴──────────────────────────────────────────┘
                     ▼
              ┌──────────────┐
              │   MySQL 8    │   ← salas, jogadores, scores (Fase 4+)
              └──────────────┘
```

### Por que servidor autoritativo?

O servidor é a **única fonte de verdade** sobre as esferas. Mesmo que um cliente envie `sphere:shoot {id: "s1"}` em uma esfera que já foi destruída por outro, o servidor responde `already_destroyed` e ignora. Isso resolve:

1. **Cheaters básicos** — devtools aberto não consegue alterar o jogo dos outros
2. **Race conditions** — dois jogadores acertando ao mesmo tempo? Só o primeiro pacote leva o ponto
3. **Sincronização confiável** — todo cliente recebe os mesmos eventos na mesma ordem

O custo é uma latência de ~50-150ms entre apertar FIRE e ver a esfera sumir (round-trip pro servidor). Mascaramos com flash + vibração local imediatos.

### Repositório dual (memória/MySQL)

O `src/rooms-repo.js` exporta a mesma interface em duas implementações:

- **Memória** (sem `DB_HOST` no .env) — usa `Map` em memória. Tudo se perde ao reiniciar. Ótimo pra dev local sem instalar MySQL.
- **MySQL** (com `DB_HOST`) — persiste salas e jogadores. Necessário em produção.

A decisão acontece no boot (`src/db.js → tryConnectDB`).

---

## 📁 Estrutura do projeto

```
silvia/
│
├── index.html                  # Versão SINGLE-PLAYER original (referência histórica)
├── marker.html                 # Gerador do marcador QR pra imprimir
├── README.md                   # Este arquivo
├── .gitignore
│
└── server/                     # Backend Node.js + cliente multiplayer
    │
    ├── package.json
    ├── pnpm-lock.yaml
    ├── ecosystem.config.cjs    # Configuração do PM2
    ├── README.md               # Documentação técnica do servidor + deploy
    ├── .env.example            # Template das variáveis de ambiente
    ├── .gitignore
    │
    ├── sql/
    │   └── 001_init.sql        # Schema MySQL (tabelas rooms + players)
    │
    ├── public/
    │   ├── index.html          # Cliente do jogo (home → lobby → game → ranking)
    │   ├── test.html           # Painel de debug Socket.IO (Fase 1)
    │   └── favicon.svg         # Ícone do site
    │
    ├── src/
    │   ├── index.js            # Bootstrap: Express + Socket.IO + wire-up
    │   ├── db.js               # Pool MySQL opcional (retorna null se indisponível)
    │   ├── codes.js            # Gerador de código de sala (6 chars, sem 0/O/1/I/L)
    │   ├── rooms-repo.js       # CRUD de salas — implementação dual memória/MySQL
    │   ├── games.js            # Estado autoritativo das partidas ativas
    │   ├── routes.js           # REST API (POST /api/rooms, GET /api/rooms/:code)
    │   └── sockets.js          # Todos os event handlers do Socket.IO
    │
    └── test/
        ├── phase1.test.js      # Smoke test do lobby (8 checks)
        └── phase3.test.js      # Smoke test do multiplayer game (11 checks)
```

---

## 🚀 Rodando localmente

### Pré-requisitos

- **Node.js 20+** ([nodejs.org](https://nodejs.org/))
- **pnpm 9+** — instale com `npm i -g pnpm` se não tiver
- (opcional) **MySQL 8** local — caso queira testar com persistência

### Passo a passo

```bash
# 1. Clone o repo
git clone https://github.com/SEU-USER/silvia.git
cd silvia/server

# 2. Instale as dependências
pnpm install

# 3. Crie o .env a partir do template
cp .env.example .env
#   Windows PowerShell:  Copy-Item .env.example .env

# 4. (Opcional) Edite o .env se quiser usar MySQL local.
#    Deixando DB_HOST vazio, roda em memória — perfeito pra testar.

# 5. Suba o servidor
pnpm dev
```

Saída esperada:

```
[db] No MySQL — using in-memory store (dev only)
[silvia] http+ws listening on :3000 (development)
```

### Acessando

| URL                                  | O que é                                              |
|--------------------------------------|------------------------------------------------------|
| `http://localhost:3000/`             | Cliente do jogo (home → lobby → game)                |
| `http://localhost:3000/test.html`    | Painel debug do Socket.IO (criar/entrar em abas)     |
| `http://localhost:3000/healthz`      | Health check (JSON `{ ok: true, ... }`)              |
| `http://localhost:3000/favicon.svg`  | Favicon temático                                     |

### ⚠️ Limitações em PC

A câmera e o giroscópio **só funcionam em celular**. No desktop você consegue:
- ✅ Testar o lobby (criar sala, entrar, ver players em tempo real)
- ✅ Validar o Socket.IO via test.html
- ❌ Não consegue jogar a parte de AR

Pra testar com AR, precisa rodar em **HTTPS** (não `file://` nem HTTP) — daí o deploy em VPS com Let's Encrypt.

### Rodar os testes

```bash
# Com o servidor rodando em outra aba:
node test/phase1.test.js   # 8 checks do lobby
node test/phase3.test.js   # 11 checks do game
```

---

## 🌐 Deploy em VPS

Documentação completa e passo-a-passo está em [`server/README.md`](server/README.md). Resumo:

1. **DNS:** aponte um subdomínio (ex.: `silvia.exemplo.com`) pro IP da VPS via registro A
2. **CloudPanel:** crie um "Node.js Site", porta 3000, Node 20
3. **MySQL:** crie database `silvia` + usuário com senha forte
4. **Aplique o schema:** `mysql -u silvia -p silvia < sql/001_init.sql`
5. **SSL:** Let's Encrypt + Force HTTPS Redirect
6. **Vhost nginx:** confira os headers de WebSocket upgrade (snippet no `server/README.md`)
7. **Upload do código** pra `~/htdocs/seu-dominio/server` via SSH
8. **`.env`** em produção: preencha com as credenciais reais
9. **PM2:** `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`

Verificação final: `https://seu-dominio/healthz` deve responder `{ ok: true }`.

---

## 📱 Como jogar

### Preparação (uma vez só)

1. **Imprima o marcador QR:**
   - Abra `marker.html` no navegador
   - Clique em **Imprimir** (ou baixe SVG/PNG)
   - Em **A4, papel fosco, escala 100%**, sem cortar a borda branca
   - Cole numa superfície rígida e plana

2. **Posicione o marcador:**
   - 🎯 Melhor: chão, centro do espaço
   - ✅ Ok: parede, altura do peito
   - ❌ Evite: superfícies curvas, iluminação direta forte

### Fluxo de uma partida

**Todos os jogadores:**

1. Acesse a URL do site no celular (HTTPS)
2. Digite seu apelido na tela inicial

**O host:**

3. Toque em **"Criar sala"**, defina o máximo de jogadores
4. Compartilhe o **código de 6 letras** que aparece em destaque

**Os demais:**

5. Toque em **"Entrar em sala"**, digite o código e entre

**Todos (de volta no lobby):**

6. Quando todos estiverem na lista, o **host** toca em **"INICIAR PARTIDA"**
7. Cada jogador aponta a câmera pro marcador QR e toca em **"CALIBRAR"**
   (esse passo é o que faz todos verem as esferas no mesmo lugar físico)

**Posicionamento (só host):**

8. Host gira o celular pra apontar onde quer cada esfera e toca **"POSICIONAR"**
9. Os outros jogadores veem as esferas surgindo em tempo real
10. Com pelo menos 3 esferas, host toca **"INICIAR DISPUTA"**

**Disputa:**

11. Todos têm **60 segundos** pra acertar o máximo de esferas
12. Mire girando o celular — quando o crosshair fica **vermelho**, é um alvo
13. Toque qualquer botão **FIRE** (esquerdo ou direito) pra atirar
14. **Quem aperta FIRE primeiro leva o ponto** — a esfera some pra todos

**Ranking:**

15. Quando a última esfera é destruída (ou o tempo acaba), aparece o pódio
16. Host pode tocar em **"Nova partida"** pra começar outra disputa
17. Qualquer um pode tocar em **"Voltar pra sala"** pra retornar ao lobby

---

## 📡 Sobre o marcador QR

### Pra que serve

No mundo real, cada celular tem um sistema de coordenadas próprio (o "norte" do giroscópio depende de onde o aparelho está posicionado). Sem alinhamento, a esfera que aparece à direita pra você pode aparecer em cima pra o jogador ao lado.

O marcador QR resolve isso:

1. **Todos apontam pro mesmo ponto físico** ao calibrar
2. **Todos definem alpha-zero (orientação base) nessa direção**
3. **Daí pra frente, todos os celulares "concordam" sobre as direções**

Depois da calibração, o QR pode sair de cena — o jogo usa só o giroscópio.

### Por que QR, e não outros métodos

| Método                              | iOS | Android | Esforço | Decisão            |
|-------------------------------------|-----|---------|---------|--------------------|
| Bússola (norte magnético)           | ✅  | ✅      | Baixo   | Imprecisa em ambiente fechado |
| **QR Code marker (calibração tap)** | ✅  | ✅      | Baixo   | **✓ adotado**      |
| QR Code com MindAR auto-detecção    | ✅  | ✅      | Médio   | Futuro (Fase 6+)   |
| WebXR + anchors                     | ❌  | ✅      | Alto    | Mata iOS — descartado |

### Por que QR plano e não cubo?

O marcador QR só serve como **âncora inicial** — não precisa ficar visível durante a partida. Só é olhado uma vez (na calibração) e depois o giroscópio do celular cuida da orientação. Um cubo só seria necessário pra **tracking contínuo de posição em 6DOF**, que o iOS Safari não suporta de qualquer forma.

---

## 🛣️ Roteiro de desenvolvimento

| Fase | O que entrega                                            | Status |
|------|----------------------------------------------------------|--------|
| 0    | Esqueleto Express + Socket.IO + PM2 + plano de deploy    | ✅     |
| 1    | Sistema de salas (criar, entrar, broadcast em tempo real)| ✅     |
| 2    | Cliente multi-tela (home → criar/entrar → lobby → game → ranking) | ✅ |
| 3    | Servidor autoritativo de esferas + hits + ranking multi  | ✅     |
| 4    | Persistência MySQL de scores + regras customizáveis pelo host | 🔜 |
| 5    | Polimento mobile: reconexão, wake lock, host saindo mid-game  | 🔜 |
| 6    | (opcional) MindAR pra auto-detecção do QR                | 🔮     |

Cada fase tem seu próprio smoke test em `server/test/`, validando os contratos críticos.

---

## 🎨 Decisões de design

### Vanilla JS em vez de React/Vue

- React adiciona ~40KB gzip + virtual DOM em cima do canvas WebGL
- Em celulares fracos com câmera + WebGL + Socket.IO ativos, cada ms conta
- O escopo é compacto o bastante pra DOM nativo dar conta

### Socket.IO em vez de WebSocket puro

- **Reconexão automática** — mobile troca de rede toda hora (4G ↔ WiFi)
- **Salas nativas** (`io.to(roomCode).emit(...)`) — broadcast por sala sem esforço
- **Fallback pra long-polling** se WebSocket for bloqueado por proxy/firewall
- Custa ~4KB gzip no cliente. Vale.

### mysql2 cru sem ORM

- O domínio é minúsculo (2 tabelas, ~10 queries)
- ORM (Prisma, Sequelize) é peso morto no cold start
- Migrations manuais via arquivos `.sql` em `sql/`

### Sem Redis na v1

- Salas duram a partida (efêmeras), cabem em memória
- Redis só seria necessário escalando pra múltiplos processos Node — bem depois

### MySQL opcional em dev

- O `src/rooms-repo.js` funciona em memória OU MySQL
- Dev local não precisa instalar MySQL pra testar lobby/multiplayer
- Em produção, MySQL é obrigatório (persistência de histórico de partidas)

### Código de sala alfanumérico de 6 chars

- Alfabeto sem `0/O/1/I/L` → 32 chars únicos → ~1 bilhão de combinações
- Colisões praticamente impossíveis com retry de 10 tentativas
- Fácil de ditar verbalmente entre amigos

---

## ⚠️ Limitações conhecidas

| Limitação                                              | Razão                                          | Workaround           |
|--------------------------------------------------------|-----------------------------------------------|----------------------|
| Jogador não pode se mover (só girar no eixo)           | Web AR no iOS Safari = 3DOF, sem SLAM         | Regra da partida     |
| Esferas posicionadas relativas ao host (não ao QR)     | Calibração é manual via tap, não automática   | Fase 6 com MindAR    |
| Mid-game join não restaura esferas e scores            | Snapshot existe mas não foi cabeado no cliente | Fase 5               |
| Se host sai durante partida, jogo trava (sem transferência de comando) | Edge case não tratado | Fase 5               |
| Sem chat de voz/texto entre jogadores                  | Fora do escopo da v1                          | -                    |
| Permissão de câmera + giroscópio bloqueia em browsers em modo privado/incognito (iOS) | Limite do iOS Safari | Pedir pra usar aba normal |

---

## 🤝 Contribuir

Issues e PRs bem-vindos. Por favor, ao abrir:

- **Issue:** descreva o problema + passos pra reproduzir + qual celular/browser
- **PR:** adicione/atualize testes em `server/test/` se mudar a API

### Convenções

- Variáveis e funções em `camelCase`
- Constantes em `SCREAMING_SNAKE_CASE`
- Indentação 4 espaços
- Sem ponto-e-vírgula opcional — usar sempre

---

## 📜 Licença

MIT — sinta-se livre pra usar, modificar e distribuir.

---

## 🙏 Créditos

Construído como um experimento de **AR multiplayer no navegador**, explorando os limites do que dá pra fazer com APIs web padronizadas sem depender de motores AR proprietários.

Tecnologias:

- [Three.js](https://threejs.org/) — renderização 3D no navegador
- [Socket.IO](https://socket.io/) — WebSocket com salas
- [Express](https://expressjs.com/) — HTTP server
- [MySQL](https://www.mysql.com/) — persistência
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) — gerador SVG do marcador

E pra rodar online, [CloudPanel](https://www.cloudpanel.io/) (grátis) + [Let's Encrypt](https://letsencrypt.org/) (grátis).
