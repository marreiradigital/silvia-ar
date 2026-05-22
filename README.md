# 🎯 Esferas da Taísa RA — Multiplayer

Um jogo **multiplayer de tiro em realidade aumentada (AR)** que roda 100% no navegador do celular. Os jogadores se reúnem em uma sala compartilhada, escaneiam um marcador QR físico para alinhar o mundo virtual, e disputam quem destrói mais esferas flutuantes no espaço ao redor — usando a câmera do celular e o giroscópio para mirar.

Sem app, sem instalação. Funciona em **Android** e **iOS** via Safari/Chrome.

---

## 📖 Sumário

- [Visão geral](#-visão-geral)
- [Como funciona o jogo](#-como-funciona-o-jogo)
- [Stack tecnológico](#-stack-tecnológico)
- [Fundamentos teóricos](#-fundamentos-teóricos)
- [Arquitetura](#-arquitetura)
- [Protocolo de rede](#-protocolo-de-rede)
- [Modelo de dados](#-modelo-de-dados)
- [Algoritmos centrais](#-algoritmos-centrais)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Rodando localmente](#-rodando-localmente)
- [Deploy em VPS](#-deploy-em-vps)
- [Como jogar](#-como-jogar)
- [Sobre o marcador QR](#-sobre-o-marcador-qr)
- [Análise de performance](#-análise-de-performance)
- [Análise de segurança](#-análise-de-segurança)
- [Roteiro de desenvolvimento](#-roteiro-de-desenvolvimento)
- [Decisões de design](#-decisões-de-design)
- [Limitações conhecidas](#-limitações-conhecidas)
- [Glossário](#-glossário)
- [Referências](#-referências)
- [Licença](#-licença)

---

## 🎮 Visão geral

**O conceito:** vários jogadores no mesmo espaço físico abrem o site no celular, entram numa sala compartilhada com um código de 6 letras, e disputam uma partida de tiro em AR. As esferas ficam **fixas no espaço real**: se um jogador atira e acerta a esfera B, ela desaparece para todos ao mesmo tempo. Vence quem fizer mais pontos antes que todas as esferas sejam destruídas (ou que o tempo acabe).

**O que torna isso tecnicamente interessante:**

- ✅ **Servidor autoritativo** (Server Authority Model) — o servidor controla as esferas; cliente nunca decide sozinho se acertou. Mesma família arquitetural dos motores Quake 3 e Counter-Strike.
- ✅ **Roda em iOS e Android sem WebXR** — usando exclusivamente APIs web padronizadas (DeviceOrientation, getUserMedia, WebGL).
- ✅ **Sistema de coordenadas distribuído** ancorado em um marcador físico (QR impresso), resolvendo o problema de alinhamento entre múltiplos celulares sem GPS nem SLAM.
- ✅ **Stack web puro** — Node.js + Three.js + Socket.IO, sem dependência de motor proprietário.
- ✅ **Anti-cheat por design** — toda destruição de esfera passa pela validação do servidor.

**O que não é:**

- ❌ Não é AR fotorrealista (não usa SLAM, ARKit nem ARCore).
- ❌ Não funciona com 6DOF (jogador precisa ficar parado e girar no eixo).
- ❌ Não tem matchmaking — jogadores combinam por fora e usam o código da sala.

---

## 🕹️ Como funciona o jogo

O fluxo de telas no cliente é uma **máquina de estados finitos** (FSM) com transições disparadas por interações do usuário e por broadcasts do servidor:

```
HOME (apelido)
   │
   ├─→ CRIAR SALA  ──→  POST /api/rooms → recebe código de 6 chars
   │                       │
   └─→ ENTRAR SALA ───→  digita código + apelido
                           │
                           ▼
                       LOBBY  (status='waiting')
                  ┌─ HOST vê "INICIAR PARTIDA"
                  └─ outros veem "Aguardando host..."
                           │
                           ▼ emit game:start  (host only)
                       CALIBRAR  (cliente-side; status='placing' no servidor)
                  "aponte pro marcador QR e toque CALIBRAR"
                  (cada jogador define seu alpha-zero independentemente)
                           │
                           ▼
                       PLACE (host) | WATCH (outros)
                  HOST emite sphere:place → servidor broadcast → todos renderizam
                           │
                           ▼ emit game:play_start  (host only)
                       PLAY  (status='playing', 60s timer)
                  Todos atiram nas mesmas esferas
                  Primeiro a acertar leva o ponto
                           │
                           ▼ (última esfera destruída ou timeout)
                       RANKING  (status='ended')
                  Pódio ordenado por (score DESC, hits DESC)
                           │
                           ▼ emit game:start  (host)
                       (volta pra CALIBRAR)
```

### Estados servidor-side por sala (em `src/games.js`)

| Status      | Transição válida                | Quem dispara     |
|-------------|--------------------------------|------------------|
| `waiting`   | → `placing`                     | host: `game:start`     |
| `placing`   | → `playing`                     | host: `game:play_start` (≥3 esferas)|
| `playing`   | → `ended`                       | servidor: última esfera ou timeout |
| `ended`     | → `placing` (nova partida)      | host: `game:start`     |

Transições inválidas retornam `{ ok: false, error: 'invalid_state' }`.

### Regras de pontuação padrão

| Tipo de esfera | Cor             | Pontos | Tamanho (raio THREE.js) | P(spawn) |
|---------------|-----------------|--------|-------------------------|----------|
| Normal        | ciano `#00ddff` | 10     | 0.18                    | 55%      |
| Rápida        | verde neon      | 20     | 0.15                    | 30%      |
| Rara          | vermelho fogo   | 50     | 0.13                    | 15%      |

Distribuição implementada por amostragem direta da CDF.

---

## 🧱 Stack tecnológico

### Cliente

| Tecnologia        | Versão  | Justificativa                                                          |
|-------------------|---------|------------------------------------------------------------------------|
| **HTML + JS vanilla** | ES2022  | Zero overhead de framework. No pipeline câmera + WebGL + WebSocket de mobile, cada KB de bundle e cada ms de pintura conta. |
| **Three.js**      | 0.169   | Render WebGL 3D. Implementa raycasting, geometria, materiais PBR e quaternions out-of-the-box. |
| **Socket.IO**     | 4.8     | Abstração sobre WebSocket com reconexão automática, fallback transparente pra long-polling, salas (rooms) nativas. |
| **DeviceOrientation API** | W3C  | Acesso ao IMU (giroscópio + acelerômetro + magnetômetro) via eventos `alpha`, `beta`, `gamma`. |
| **Media Capture API** | W3C | `navigator.mediaDevices.getUserMedia()` pra acessar a câmera traseira do dispositivo. |
| **localStorage**  | DOM Storage | Persiste apelido do jogador entre sessões. |

### Servidor

| Tecnologia          | Versão | Justificativa                                                  |
|---------------------|--------|----------------------------------------------------------------|
| **Node.js**         | 20 LTS | Event loop single-thread + V8 JIT, ideal pra I/O-bound (rede). Runtime único compartilhado com o front. |
| **ESM nativo**      | —      | `"type": "module"` no `package.json`; sem transpiladores. |
| **Express**         | 4.21   | HTTP minimal pra REST e arquivos estáticos.                 |
| **Socket.IO server**| 4.8    | Servidor com namespaces, rooms, ack callbacks.              |
| **mysql2/promise**  | 3.11   | Driver MySQL puro (sem ORM), prepared statements, pool de conexões. |
| **dotenv**          | 16.4   | Carregamento de variáveis de ambiente.                       |
| **PM2**             | latest | Process manager: keeps-alive, log rotation, zero-downtime reload. |

### Infraestrutura

| Tecnologia          | Por quê                                                              |
|---------------------|----------------------------------------------------------------------|
| **VPS Linux**       | Controle total, custo previsível, sem vendor lock-in.                |
| **CloudPanel**      | Painel web grátis pra Node.js + MySQL + nginx + Let's Encrypt.       |
| **MySQL 8**         | RDBMS maduro, InnoDB com row-level locking e MVCC.                   |
| **nginx**           | Reverse proxy com upgrade de HTTP→WebSocket (Connection: Upgrade).   |
| **Let's Encrypt**   | Certificados TLS gratuitos via ACME. HTTPS é obrigatório (câmera + giroscópio só funcionam em [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). |

---

## 🧮 Fundamentos teóricos

### 1. Modelo Servidor-Autoritativo (Server Authority)

Em sistemas multiplayer em tempo real, há um espectro de quem decide sobre o estado do jogo:

- **Peer-to-peer puro:** clientes negociam mudanças entre si. Vulnerável a cheats.
- **Cliente-autoritativo:** cliente informa o servidor o que aconteceu; servidor confia.
- **Servidor-autoritativo (este projeto):** cliente envia *intenções* ("quero atirar na esfera X"); servidor decide se aceita.

**Trade-offs do modelo servidor-autoritativo:**

| Vantagem                          | Custo                                                  |
|-----------------------------------|--------------------------------------------------------|
| Resistente a cheats triviais      | Latência adicional (round-trip antes do efeito visual) |
| Estado consistente entre clients  | Carga concentrada no servidor                          |
| Lógica de jogo centralizada       | Dependência de conectividade                           |

Mitigação da latência percebida: **feedback local imediato** (flash da câmera + vibração no `FIRE`) — só a destruição visual da esfera espera o broadcast do servidor.

### 2. Realidade aumentada: 3DOF vs 6DOF

**DOF** = Degrees of Freedom (graus de liberdade).

- **3DOF** — rastreia só **rotação** (yaw, pitch, roll). Jogador pode girar a cabeça mas não andar. Implementado via IMU (giroscópio).
- **6DOF** — rastreia rotação **+ translação** (x, y, z no espaço). Jogador pode andar pelo cenário. Requer câmera analisando o ambiente (SLAM) ou sensores externos.

| Característica         | 3DOF                       | 6DOF                       |
|------------------------|----------------------------|----------------------------|
| Sensores               | IMU                        | IMU + câmera/LIDAR (SLAM)  |
| Suporte iOS Safari     | ✅                         | ❌ (sem WebXR)             |
| Suporte Android Chrome | ✅                         | ✅ via WebXR               |
| Bateria                | Baixo consumo              | Alto consumo               |

Este projeto usa **3DOF** porque é a única opção que roda no iOS Safari sem app nativo.

### 3. Unidade de Medida Inercial (IMU) e DeviceOrientation

A IMU do celular combina:

- **Giroscópio MEMS** — mede velocidade angular (rad/s) em 3 eixos
- **Acelerômetro** — mede aceleração linear (m/s²) em 3 eixos, incluindo gravidade
- **Magnetômetro** — mede campo magnético (μT), usado pra orientação absoluta (norte)

O browser fusiona esses sinais via **sensor fusion** (filtro de Kalman ou variantes) e expõe pelo evento `deviceorientation` (ou `deviceorientationabsolute` quando disponível):

| Campo  | Faixa       | Significado                                |
|--------|-------------|--------------------------------------------|
| alpha  | 0° – 360°   | Yaw (rotação em torno do eixo Z — vertical) |
| beta   | -180° – 180°| Pitch (inclinação frente/trás)              |
| gamma  | -90° – 90°  | Roll (inclinação lateral)                   |

**Sutileza:** o `alpha` reportado pelo evento `deviceorientation` (sem `absolute`) é **relativo à orientação inicial do dispositivo**, não ao norte magnético. É por isso que esse jogo exige um passo de **calibração explícita** — o cliente captura o `alpha` no momento do tap e armazena como `orientBaseAlpha`. Daí em diante, `alpha_calibrado = alpha - orientBaseAlpha`.

### 4. Sistemas de coordenadas e calibração distribuída

Sem calibração, cada celular tem seu próprio referencial. Pra todos verem a esfera na mesma direção física, precisam **concordar** sobre onde está o "norte virtual".

**Solução adotada:** **calibração ancorada em referência visual compartilhada** — todos os jogadores apontam pro mesmo marcador QR físico e tocam CALIBRAR ao mesmo tempo. Isso define que "alpha = 0" significa "apontando pro QR" para todo mundo.

Depois da calibração, as coordenadas das esferas (x, y, z no frame do host) podem ser interpretadas igual pelos outros clientes, porque todos têm o mesmo "norte".

```
Antes da calibração:                Depois da calibração:
Host:     ↑                         Host:     ↑(α=0)
Guest:  ←                           Guest:    ↑(α=0)
QR:       •                         QR:       •  (todos apontados aqui)
```

### 5. Quaternions vs Ângulos de Euler

Ângulos de Euler (yaw, pitch, roll) sofrem do **gimbal lock**: quando dois eixos se alinham, perde-se um grau de liberdade.

Three.js representa rotações como **quaternions** (números hipercomplexos com 4 componentes: `[w, x, y, z]`, descobertos por Hamilton em 1843). Vantagens:

- Não sofrem de gimbal lock
- Composição via multiplicação quaterniônica (não-comutativa)
- Interpolação SLERP suave
- Mais compactos (4 floats vs matriz 3x3 = 9 floats)

A conversão DeviceOrientation → quaternion da câmera é feita em `setObjectQuaternion()` no cliente:

```javascript
eulerHelper.set(beta, alpha, -gamma, 'YXZ');
quaternion.setFromEuler(eulerHelper);
quaternion.multiply(q1Helper);                          // -π/2 em X (apontar p/ frente)
quaternion.multiply(setFromAxisAngle(zee, -orient));    // correção pela orientação da tela
```

A ordem `'YXZ'` reflete a convenção do W3C para `deviceorientation`.

### 6. Raycasting e detecção de colisão

Quando o jogador aperta FIRE, o cliente projeta um **raio** a partir da posição da câmera, na direção em que ela aponta:

```
P(t) = P_camera + t * direction,   t ≥ 0
```

E testa intersecção com cada **esfera viva** (objeto `THREE.Sphere`). Algoritmo:

Dada esfera de centro C e raio r, o raio intercepta se:
```
‖(P_camera - C) × direction‖ ≤ r * ‖direction‖
```

Three.js implementa isso em `raycaster.intersectObjects()` — complexidade O(n) onde n = número de meshes. Pra n ≤ 16 (limite do jogo), é praticamente instantâneo.

### 7. Modelo de concorrência do Node.js

Node.js usa um **event loop single-thread** (libuv) com I/O assíncrono não-bloqueante. Isso significa:

- **Não há race conditions clássicas** entre handlers de eventos — JavaScript não preempta
- Mas há **possíveis interleavings** quando handlers usam `await`
- Operações I/O (rede, disco) rodam fora da thread principal

No `games.js`, a detecção de "duas balas na mesma esfera" é segura porque a função `tryShoot()` é síncrona — não há await entre `if (!sphere.alive)` e `sphere.alive = false`. A primeira chamada vence; a segunda recebe `already_destroyed`.

---

## 🏗️ Arquitetura

### Visão de componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                        CELULAR DO JOGADOR                       │
│                                                                 │
│  ┌───────────┐  ┌─────────────┐  ┌─────────────────────────┐    │
│  │ Câmera    │  │ IMU         │  │  Canvas Three.js        │    │
│  │ traseira  │→ │ (alpha,     │→ │  (esferas + crosshair + │    │
│  │ (vídeo BG)│  │  beta,      │  │   radar + reticle)      │    │
│  └───────────┘  │  gamma)     │  └─────────────────────────┘    │
│                 └─────────────┘                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Socket.IO client                                        │   │
│  │  ├─ emit:  room:join, sphere:shoot, sphere:place...      │   │
│  │  └─ recv:  sphere:placed, sphere:destroyed, ...          │   │
│  └────────────────────────┬─────────────────────────────────┘   │
└──────────────────────────┬│┬─────────────────────────────────────┘
                           ▼│▼  WSS (WebSocket sobre TLS)
┌──────────────────────────┴┴┴────────────────────────────────────┐
│                  nginx (Reverse Proxy + TLS termination)        │
│                  upgrade HTTP/1.1 → WebSocket                   │
└──────────────────────────┬┬┬────────────────────────────────────┘
                           ▼│▼
┌──────────────────────────┴┴┴────────────────────────────────────┐
│                Node.js process (PM2 supervised)                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Express  ──  REST + arquivos estáticos                   │   │
│  │   POST /api/rooms      ─→ rooms-repo.createRoom()        │   │
│  │   GET  /api/rooms/:code ─→ rooms-repo.getRoom()          │   │
│  │   GET  /healthz                                          │   │
│  │   GET  /, /test.html, /favicon.svg → public/             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Socket.IO ─ handlers em src/sockets.js                   │   │
│  │   room:join/leave      → rooms-repo (persistência)       │   │
│  │   game:start/play_start                                  │   │
│  │   sphere:place/clear/shoot → games (estado em memória)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/games.js — estado autoritativo das partidas ativas   │   │
│  │   Map<roomCode, GameState>                               │   │
│  │   • spheres (Map id → {id, type, x, y, z, alive})        │   │
│  │   • scores  (Map nick → {score, hits})                   │   │
│  │   • timer fim-de-jogo (setTimeout)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ src/rooms-repo.js — Repository pattern                   │   │
│  │   createMemoryRepo() | createMysqlRepo()                 │   │
│  │   (escolha no boot via tryConnectDB)                     │   │
│  └─────────────────┬────────────────────────────────────────┘   │
└────────────────────┬┴──────────────────────────────────────────┘
                     ▼
              ┌──────────────┐
              │   MySQL 8    │   ← salas, jogadores, scores (Fase 4+)
              └──────────────┘
```

### Padrões de design aplicados

| Padrão                  | Onde                                  | Por quê |
|-------------------------|---------------------------------------|---------|
| **Repository**          | `src/rooms-repo.js`                   | Permite trocar implementação (memória/MySQL) sem mudar consumidores |
| **Factory function**    | `createRoomsRepo()`, `createGames()`  | Encapsula estado interno via closure (alternativa funcional a classes) |
| **Observer (pub/sub)**  | Socket.IO events                      | Servidor publica eventos → todos os clientes inscritos na sala recebem |
| **Finite State Machine**| `PHASES` no cliente, `status` no jogo | Transições explicitamente nomeadas e validadas |
| **Command** (RPC-like)  | Eventos cliente→servidor com ack      | Cliente expressa intenção; servidor confirma ou rejeita |
| **Module pattern (ESM)**| `import/export` em todo o servidor    | Encapsulamento + tree-shaking-ready |

### Garantias de consistência

Por usar TCP/WebSocket (não UDP), o sistema garante:

- **Ordenação** — eventos chegam na ordem em que foram enviados
- **Entrega** — eventos chegam (ou a conexão cai e o Socket.IO reabre)
- **Sem duplicação** — TCP não duplica pacotes

Mas **não garante**:

- **Latência uniforme** — pode variar (jitter)
- **Atomicidade entre dois clientes** — A vê o evento antes de B (ordem global). O servidor é o ponto serializador.

---

## 📡 Protocolo de rede

### Stack de camadas

```
Aplicação      │ Eventos JSON (room:join, sphere:shoot, ...)
─────────────────────────────────────────────────────────────
Socket.IO      │ Framing + reconexão + ack callbacks
─────────────────────────────────────────────────────────────
WebSocket      │ RFC 6455 — frames binários/texto sobre TCP
─────────────────────────────────────────────────────────────
TLS 1.2/1.3    │ Confidencialidade + integridade (Let's Encrypt)
─────────────────────────────────────────────────────────────
TCP            │ Ordenação, entrega confiável, controle de fluxo
─────────────────────────────────────────────────────────────
IP             │ Roteamento
```

### REST endpoints

| Método | Rota                  | Request                                                 | Response                                                   |
|--------|-----------------------|--------------------------------------------------------|-----------------------------------------------------------|
| POST   | `/api/rooms`          | `{ hostNickname, maxPlayers, scoringRules? }`           | `201 { code, hostNickname, maxPlayers, status, ... }`     |
| GET    | `/api/rooms/:code`    | —                                                       | `200 { code, ..., hasSlot } / 404 / 410`                  |
| GET    | `/healthz`            | —                                                       | `200 { ok, env, uptime, ts }`                              |

### Eventos Socket.IO

#### Cliente → servidor

| Evento              | Payload                          | Quem pode    | Validação servidor                            |
|---------------------|----------------------------------|--------------|----------------------------------------------|
| `room:join`         | `{ code, nickname }`             | qualquer     | código válido + apelido único + vaga         |
| `room:leave`        | —                                | qualquer     | —                                            |
| `game:start`        | —                                | host         | status ∈ {waiting, ended}                    |
| `sphere:place`      | `{ type, x, y, z }`              | host         | status=placing, type válido, < MAX_SPHERES   |
| `sphere:clear`      | —                                | host         | status=placing                               |
| `game:play_start`   | —                                | host         | status=placing, ≥ MIN_SPHERES (3)            |
| `sphere:shoot`      | `{ id }`                         | qualquer     | status=playing, sphere existe e está alive   |
| `ping:client`       | qualquer                          | qualquer     | —                                            |

#### Servidor → cliente

Eventos são **broadcasts pra todos os sockets na room**, exceto `hello` que é unicast.

| Evento                | Payload                                                                   |
|-----------------------|---------------------------------------------------------------------------|
| `hello`               | `{ id, ts }` (unicast no `connect`)                                       |
| `room:player_joined`  | `{ nickname, isHost, room }`                                              |
| `room:player_left`    | `{ nickname, newHostNickname, room }`                                     |
| `game:started`        | `{ status: 'placing', scoringRules }`                                     |
| `sphere:placed`       | `{ id, type, x, y, z, placedBy, alive: true }`                            |
| `sphere:cleared`      | —                                                                         |
| `game:play_started`   | `{ status: 'playing', durationSec }`                                      |
| `sphere:destroyed`    | `{ id, type, hitBy, points, totals: { [nick]: {score, hits} } }`          |
| `game:ended`          | `{ ranking: [{nickname, score, hits, rank}], reason: 'all_destroyed'\|'timeout' }` |

### Catálogo de erros (campo `error` nos acks)

| Código              | Significado                                          |
|---------------------|------------------------------------------------------|
| `invalid_code`      | Código não bate regex do alfabeto                    |
| `invalid_nickname`  | Apelido vazio ou > 20 chars                          |
| `not_found`         | Sala não existe                                      |
| `ended`             | Sala já encerrou                                     |
| `nickname_taken`    | Apelido em uso na sala                               |
| `full`              | Sala atingiu maxPlayers                              |
| `not_in_room`       | Socket não está em sala (chamou evento de game sem estar) |
| `not_host`          | Evento host-only chamado por não-host                |
| `invalid_state`     | Transição inválida da FSM                            |
| `invalid_type`      | Tipo de esfera não está em {normal, fast, rare}      |
| `max_spheres`       | Atingiu o limite (16)                                |
| `not_enough_spheres`| Tentou iniciar disputa com < 3 esferas               |
| `sphere_not_found`  | ID de esfera não existe                              |
| `already_destroyed` | Esfera já foi destruída                              |
| `server_error`      | Exceção não tratada no servidor                      |

### Diagrama de sequência: partida completa (2 jogadores)

```
Host                     Servidor                  Guest
 │                          │                        │
 │ POST /api/rooms          │                        │
 │─────────────────────────>│                        │
 │ 201 {code: "ABCD23"}     │                        │
 │<─────────────────────────│                        │
 │                          │                        │
 │ socket.connect()         │                        │
 │<────────────────────────>│                        │
 │ emit room:join           │                        │
 │═════════════════════════>│                        │
 │ ack {ok, you, room}      │                        │
 │<═════════════════════════│                        │
 │                          │  emit room:join        │
 │                          │<═══════════════════════│
 │                          │ ack {ok, you, room}    │
 │                          │═══════════════════════>│
 │ broadcast                │ broadcast              │
 │ room:player_joined       │                        │
 │<─────────────────────────│                        │
 │                          │                        │
 │ emit game:start          │                        │
 │═════════════════════════>│                        │
 │ broadcast                │ broadcast              │
 │ game:started             │                        │
 │<─────────────────────────│───────────────────────>│
 │                          │                        │
 │ [calibração local]       │                        │ [calibração local]
 │                          │                        │
 │ emit sphere:place (×3)   │                        │
 │═════════════════════════>│                        │
 │ broadcast sphere:placed  │ broadcast              │
 │<─────────────────────────│───────────────────────>│
 │                          │                        │
 │ emit game:play_start     │                        │
 │═════════════════════════>│                        │
 │ broadcast                │ broadcast              │
 │ game:play_started        │                        │
 │<─────────────────────────│───────────────────────>│
 │                          │                        │
 │                          │ setTimeout(60s) ⏰    │
 │                          │                        │
 │                          │  emit sphere:shoot s1  │
 │                          │<═══════════════════════│
 │ broadcast                │ broadcast              │
 │ sphere:destroyed         │                        │
 │<─────────────────────────│───────────────────────>│
 │ (atualiza HUD)           │                        │ (atualiza HUD)
 │                          │                        │
 │  emit sphere:shoot s1    │                        │
 │═════════════════════════>│                        │
 │ ack {ok:false,           │                        │
 │  error:already_destroyed}│                        │
 │<═════════════════════════│                        │
 │                          │                        │
 │      ... (mais tiros) ...                         │
 │                          │                        │
 │                          │ (última esfera destruída)
 │ broadcast game:ended     │ broadcast              │
 │<─────────────────────────│───────────────────────>│
 │ (mostra ranking)         │                        │ (mostra ranking)

Legenda:  ─── HTTP    ═══ WebSocket
```

---

## 🗄️ Modelo de dados

### Schema MySQL (Fase 1+)

```sql
CREATE TABLE rooms (
    code           CHAR(6)        NOT NULL PRIMARY KEY,
    host_nickname  VARCHAR(32)    NOT NULL,
    max_players    TINYINT UNSIGNED NOT NULL DEFAULT 8,
    status         ENUM('waiting','playing','ended') NOT NULL DEFAULT 'waiting',
    scoring_rules  JSON           NULL,
    created_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at       TIMESTAMP      NULL,
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE players (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    room_code   CHAR(6)         NOT NULL,
    nickname    VARCHAR(32)     NOT NULL,
    socket_id   VARCHAR(64)     NULL,
    is_host     TINYINT(1)      NOT NULL DEFAULT 0,
    joined_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at     TIMESTAMP       NULL,
    INDEX idx_room (room_code),
    INDEX idx_socket (socket_id),
    INDEX idx_active (room_code, left_at),
    CONSTRAINT fk_player_room FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Decisões de modelagem

**Por que `code CHAR(6)` como chave primária e não autoincrement?**
- Código é gerado uniformemente aleatório com unicidade garantida no insert. Não há benefício em ter um id sequencial.
- Lookups por código (operação dominante) ficam diretos.
- CHAR(6) com `utf8mb4_unicode_ci` ocupa 24 bytes; um BIGINT ocuparia 8 bytes — diferença irrelevante em escala desse domínio.

**Por que `players.socket_id` é nullable?**
- Soft state: quando um jogador desconecta, seta `socket_id = NULL` e `left_at = NOW()` (mantém o registro pra histórico).

**Por que `scoring_rules` é JSON e não tabela separada?**
- Esquema flexível (host pode definir pontos arbitrários por tipo).
- Cardinalidade 1:1 com a sala (não justifica join).
- MySQL 8 indexa expressões JSON se necessário (não foi necessário aqui).

**Por que índice `(room_code, left_at)` em vez de só `(room_code)`?**
- Query dominante: `SELECT ... FROM players WHERE room_code = ? AND left_at IS NULL`
- Esse índice composto cobre o predicado completo, permitindo **index-only scan**.

**Forma normal:**
- O schema está em **3FN** (Terceira Forma Normal). Não há dependências transitivas, não há campos calculáveis a partir de outros.

### Implementação dual (Repository pattern)

`src/rooms-repo.js` exporta `createRoomsRepo({ db })` que retorna a mesma interface em duas implementações:

```javascript
// Mesma interface, duas implementações:
{
  createRoom({ hostNickname, maxPlayers, scoringRules }) → Promise<Room>,
  getRoom(code) → Promise<Room | null>,
  addPlayer({ code, nickname, socketId }) → Promise<{ player, room } | { error }>,
  removePlayerBySocket(socketId) → Promise<{ code, leftNickname, ... } | null>,
  findPlayerBySocket(socketId) → Promise<{ code, nickname, isHost } | null>
}
```

A decisão (memória ou MySQL) ocorre no boot:

```javascript
const db = await tryConnectDB();      // null se DB_HOST vazio ou conexão falhou
const rooms = createRoomsRepo({ db }); // dispatcher escolhe impl
```

---

## 🧠 Algoritmos centrais

### 1. Geração de código de sala

```javascript
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    return code;
}
```

**Análise:**

- Alfabeto exclui `0/O` e `1/I/L` pra evitar ambiguidade visual e auditiva
- 32 caracteres × 6 posições = **32⁶ ≈ 1.07 × 10⁹** códigos únicos
- `crypto.randomInt()` usa **CSPRNG** (Cryptographically Secure PRNG), distribuição uniforme garantida
- Probabilidade de colisão com k salas ativas (Birthday paradox):

  P(colisão) ≈ 1 - exp(-k² / (2 × 32⁶))

  Pra k = 10000 salas ativas: P ≈ 4.66 × 10⁻⁵ (menos de 1 em 20.000)
- Retry loop: 10 tentativas antes de desistir (probabilidade conjunta de falha desprezível)

### 2. Conversão de orientação do device → quaternion da câmera

Vide `setObjectQuaternion()` em `public/index.html`. Implementação derivada do `DeviceOrientationControls` do Three.js. O cálculo:

```
q = q_euler(YXZ; β, α, -γ)   // ordem YXZ é a convenção W3C
q ⊗= q_x(-π/2)                // converte "z-up" do device pra "y-up" do Three.js
q ⊗= q_z(-orient)             // corrige rotação da tela (portrait/landscape)
```

Onde `⊗` é multiplicação quaterniônica e `α`, `β`, `γ` estão em radianos.

### 3. Raycasting da câmera contra esferas

```javascript
camForward.set(0, 0, -1).applyQuaternion(camera3.quaternion);  // vetor direção
raycaster.set(camera3.position, camForward);
raycaster.far = 50;
const hits = raycaster.intersectObjects(targets, false);
```

- Three.js implementa o algoritmo analítico para intersecção raio-esfera (resolvendo quadrática)
- Custo: **O(n)** brute-force; aceitável para n ≤ 16
- `intersectObjects(..., false)` desativa recursão em filhos (otimização)

### 4. Geração de QR code (em `marker.html`)

Usa a biblioteca [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) com:

- Nível de correção de erro **H** (Reed-Solomon, ~30% redundância)
- Payload `"SILVIA-AR-MARKER-V1"` (versionado para evoluções futuras)
- Renderização em SVG (escala sem perda) e PNG (2000px)

A correção H permite o marcador funcionar mesmo com manchas, dobras leves ou cobertura parcial — crítico pra detecção visual em ambiente real.

### 5. Animações no render loop

Cada esfera tem três estágios visuais:

| Estágio    | Trigger              | Duração | Função de easing                  |
|------------|----------------------|---------|-----------------------------------|
| Pop-in     | spawn                | 220ms   | `1 - (1-k)³` (ease-out cubic)     |
| Idle (bob) | ciclo eterno         | 1.8 Hz  | `sin(t·1.8 + φ)·0.06` (vertical)  |
| Pop-out    | destruição           | 260ms   | `scale = 1 + k·1.6, opacity = 1-k`|

Implementado dentro de `requestAnimationFrame` — sincronizado com refresh rate do display (60–120fps).

---

## 📁 Estrutura do projeto

```
silvia/
│
├── index.html                  # SINGLE-PLAYER original (referência histórica)
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
    ├── .env.example
    ├── .gitignore
    │
    ├── sql/
    │   └── 001_init.sql        # Schema MySQL (rooms + players)
    │
    ├── public/                 # Servido pelo Express em /
    │   ├── index.html          # Cliente do jogo (FSM: home→lobby→game→ranking)
    │   ├── test.html           # Painel de debug Socket.IO
    │   └── favicon.svg
    │
    ├── src/
    │   ├── index.js            # Bootstrap (Express + Socket.IO + wire-up)
    │   ├── db.js               # Pool MySQL opcional
    │   ├── codes.js            # Gerador de código de sala (CSPRNG)
    │   ├── rooms-repo.js       # Repository: memória OU MySQL
    │   ├── games.js            # Estado autoritativo de partidas (em memória)
    │   ├── routes.js           # REST endpoints
    │   └── sockets.js          # Socket.IO event handlers
    │
    └── test/
        ├── phase1.test.js      # 8 checks: lobby + host transfer + edge cases
        └── phase3.test.js      # 11 checks: gameplay autoritativo + ranking
```

---

## 🚀 Rodando localmente

### Pré-requisitos

- **Node.js 20+** ([nodejs.org](https://nodejs.org/))
- **pnpm 9+** — `npm i -g pnpm`
- (opcional) **MySQL 8** local

### Passo a passo

```bash
# 1. Clone o repo
git clone https://github.com/SEU-USER/silvia.git
cd silvia/server

# 2. Instale as dependências
pnpm install

# 3. Crie o .env a partir do template
cp .env.example .env
#   Windows PowerShell: Copy-Item .env.example .env

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

### URLs disponíveis

| URL                                  | O que é                                              |
|--------------------------------------|------------------------------------------------------|
| `http://localhost:3000/`             | Cliente do jogo                                      |
| `http://localhost:3000/test.html`    | Painel debug do Socket.IO                            |
| `http://localhost:3000/healthz`      | Health check                                         |
| `http://localhost:3000/favicon.svg`  | Favicon                                              |

### Limitações em PC

A câmera e o giroscópio **só funcionam em celular**. No desktop você consegue:

- ✅ Testar o lobby (criar sala, entrar, ver players em tempo real)
- ✅ Validar o Socket.IO via `test.html`
- ❌ Não consegue jogar a parte de AR (sem câmera nem IMU)

Para a AR funcionar, é necessário rodar em **secure context** (HTTPS ou `localhost`).

### Rodar os testes

```bash
# Com o servidor rodando em outra aba:
node test/phase1.test.js   # 8 checks
node test/phase3.test.js   # 11 checks
```

---

## 🌐 Deploy em VPS

Resumo do passo a passo (detalhe completo em [`server/README.md`](server/README.md)):

1. **DNS** — aponte subdomínio (ex.: `silvia.exemplo.com`) pro IP da VPS via registro A
2. **CloudPanel** — crie "Node.js Site", porta 3000, Node 20
3. **MySQL** — crie database `silvia` + usuário
4. **Schema** — `mysql -u silvia -p silvia < sql/001_init.sql`
5. **SSL** — Let's Encrypt + Force HTTPS
6. **nginx Vhost** — adicione headers de WebSocket upgrade
7. **Upload do código** — sincronize `server/` pra `~/htdocs/seu-dominio/server`
8. **`.env`** — preencha com credenciais reais
9. **PM2** — `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`

Validação: `https://seu-dominio/healthz` deve responder `{ ok: true }`.

### Configuração crítica do nginx

Sem o upgrade de WebSocket, Socket.IO cai pra long-polling (funciona mas é ineficiente). Bloco necessário:

```nginx
location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
    proxy_pass http://127.0.0.1:3000;
}
```

`proxy_read_timeout 86400;` (24h) impede que conexões idle sejam derrubadas.

---

## 📱 Como jogar

### Preparação (uma vez)

1. **Imprima o marcador QR:**
   - Abra `marker.html` no navegador → clique em **Imprimir**
   - Em **A4, papel fosco, escala 100%**, sem cortar a borda branca
   - Cole numa superfície rígida e plana

2. **Posicione o marcador:**
   - 🎯 Melhor: chão, centro do espaço
   - ✅ Ok: parede, altura do peito
   - ❌ Evite: superfícies curvas, iluminação direta forte

### Fluxo de uma partida

1. Todos: acessem a URL no celular (HTTPS), digitem o apelido
2. **Host:** "Criar sala", define máximo de jogadores, compartilha o código
3. **Outros:** "Entrar em sala", digitam o código
4. Quando todos estiverem no lobby, host toca em **"INICIAR PARTIDA"**
5. Todos apontam pro QR e tocam **"CALIBRAR"**
6. Host posiciona ≥3 esferas; outros veem em tempo real
7. Host toca **"INICIAR DISPUTA"** → 60 segundos de batalha
8. Quem destruir mais esferas vence (pontos: normal=10, rápida=20, rara=50)
9. Ranking aparece → host pode iniciar nova partida

---

## 📡 Sobre o marcador QR

### Função técnica

Cada celular tem um sistema de coordenadas próprio, derivado do magnetômetro ou da pose inicial do dispositivo. Sem alinhamento, esferas posicionadas pelo host aparecem em direções diferentes para cada jogador.

O marcador QR atua como **âncora visual compartilhada**: todos os jogadores apontam pra ele ao calibrar, e isso define que `α = 0` significa "apontando pro QR" pra todos. Depois da calibração, ele não precisa mais estar visível.

### Por que QR e não outros métodos

| Método                              | iOS | Android | Esforço | Decisão           |
|-------------------------------------|-----|---------|---------|-------------------|
| Bússola (norte magnético)           | ✅  | ✅      | Baixo   | Imprecisa indoor (interferência metálica) |
| **QR Code marker (calibração tap)** | ✅  | ✅      | Baixo   | **✓ adotado**     |
| QR com MindAR auto-detecção         | ✅  | ✅      | Médio   | Futuro (Fase 6+)  |
| WebXR + anchors                     | ❌  | ✅      | Alto    | Mata iOS          |
| ARKit/ARCore via app nativo         | ✅  | ✅      | Muito alto | Sem ser web    |

### Por que QR plano e não cubo?

O QR só serve como **âncora inicial** — não precisa ficar visível durante a partida. Cubo só seria necessário para **tracking contínuo de posição em 6DOF**, que o iOS Safari não suporta de qualquer forma.

### Geometria de impressão

- Tamanho recomendado: **13–20 cm de lado**
- Distância de uso: 1 a 3 m
- Quiet zone (borda branca): **≥ 4 módulos** (já calibrado em `marker.html`)
- Nível de correção de erro: **H** (~30% redundância)

---

## 📊 Análise de performance

### Bandwidth por jogador (estimativa)

| Cenário                      | Eventos/s | Payload médio | Tráfego (kbps) |
|------------------------------|-----------|----------------|----------------|
| Lobby (idle)                  | 0.05      | ~150B          | < 0.1          |
| Lobby ativo (join/leave)      | 0.5       | ~400B          | ~1.6           |
| Place phase                   | 0.3       | ~120B          | ~0.3           |
| Play phase (4 jogadores)      | ~5        | ~180B          | ~7             |
| Pior caso (16 esferas, 8 jogadores, tiros rápidos) | ~25 | ~200B  | ~40           |

Conclusão: **largura de banda mínima**, viável em conexão móvel 3G/4G modesta.

### Footprint de memória servidor

Por sala ativa, em memória:

```
GameState:
  ~ 24 bytes header
  + spheres Map: ~80 bytes/esfera × 16 = ~1.3 KB
  + scores Map: ~64 bytes/jogador × 8 = ~0.5 KB
  + timer handle: ~64 bytes
  ≈ 2 KB total
```

RoomState (memória ou MySQL row): ~500B + (~100B/jogador).

**1000 salas simultâneas:** ~3 MB de memória. Cabe folgado em uma VPS pequena (1GB RAM).

### Latência ponta-a-ponta (FIRE → esfera some)

```
   Cliente FIRE          ────┐  raycast local + UI feedback imediato (0ms)
                              │
                              ▼  emit sphere:shoot
   Rede (RTT/2)            ~30ms (4G típico, mesmo país)
   Servidor processa        ~1ms (lookup em Map, validação)
   Rede (RTT/2)            ~30ms
                              │
   Cliente recv ────────────┘ broadcast sphere:destroyed → animação de explosão
                              
   Total perceptível: ~60ms (jogo se sente responsivo abaixo de ~100ms)
```

### Otimizações implementadas

- **WebSocket sobre long-polling** (Socket.IO usa WebSocket por padrão)
- **Render apenas quando GAME está ativo** (canvas Three.js só recebe RAF nessa fase)
- **`BufferGeometry`** implícito no Three.js (geometria em ArrayBuffer; não alocação por frame)
- **Disposição explícita** de geometrias e materiais ao remover esferas (libera GPU memory)
- **Raycaster reusado** (instância única, não nova alocação por shot)
- **`requestAnimationFrame`** sincroniza com vsync — não desperdiça frames
- **`pingInterval/pingTimeout`** configurados (20s/25s) — balanceio entre detecção de desconexão e overhead

### Possíveis otimizações futuras

- **Delta encoding** nos broadcasts (enviar só o que mudou em vez do `room` completo)
- **MessagePack** binary protocol em vez de JSON
- **Pooling de geometrias** de esferas (3 instâncias compartilhadas por tipo)

---

## 🛡️ Análise de segurança

### Modelo de ameaças

| Ameaça                                   | Vetor                            | Mitigação                                        |
|------------------------------------------|----------------------------------|--------------------------------------------------|
| Cheater modifica score local             | Devtools no cliente              | Score só vem do servidor (broadcast)             |
| Cheater "acerta" todas as esferas        | Forja `sphere:shoot` em massa    | Servidor valida `alive`, `cooldown`, ordem       |
| Cheater entra em sala como host          | Forja `is_host` no socket        | Servidor consulta o repo, ignora pretensão do cliente |
| MITM intercepta credenciais              | Sniff de rede                    | HTTPS obrigatório (Let's Encrypt)                |
| DoS por flood de salas                   | Spam de `POST /api/rooms`        | Rate limit recomendado (nginx-side; não implementado v1) |
| XSS via apelido                          | Apelido com `<script>`           | `escapeHtml()` em todo render                    |
| SQL injection                            | Apelido com `'; DROP TABLE...`   | mysql2 prepared statements (queries parametrizadas) |
| Vazamento de credenciais                 | `.env` no repo                   | `.gitignore` cobre `.env`, só `.env.example` é commitado |

### Vetores **não cobertos** (escopo futuro)

- **Rate limiting** nas APIs REST (Fase 5)
- **Validação de tamanho de payload** em todos os eventos
- **Token de sessão** para reconexão segura (atualmente identifica por socket.id efêmero)
- **CSP (Content Security Policy) headers** — implementaria, mas o Three.js via CDN dificulta
- **Audit log** das ações de host

### Decisões positivas implementadas

- **CSPRNG pra códigos de sala** (`crypto.randomInt`) — impossível adivinhar
- **Alfabeto sem chars confundíveis** (sem `O/0`, `I/1`, `L`) — reduz erro de digitação social
- **Prepared statements** em todas as queries MySQL
- **CORS configurável** via `CORS_ORIGIN` no `.env`
- **Apelidos normalizados e limitados** (trim, max 20 chars, sem múltiplos espaços)

---

## 🛣️ Roteiro de desenvolvimento

| Fase | Entrega                                                  | Status |
|------|----------------------------------------------------------|--------|
| 0    | Esqueleto Express + Socket.IO + PM2 + plano de deploy    | ✅     |
| 1    | Sistema de salas (criar, entrar, broadcast em tempo real)| ✅     |
| 2    | Cliente multi-tela (home → criar/entrar → lobby → game → ranking) | ✅ |
| 3    | Servidor autoritativo de esferas + hits + ranking multi  | ✅     |
| 4    | Persistência MySQL de scores + regras customizáveis      | 🔜     |
| 5    | Polimento mobile: reconexão segura, wake lock, host saindo mid-game | 🔜 |
| 6    | (opcional) MindAR pra auto-detecção do QR                | 🔮     |

Cada fase tem smoke tests automatizados em `server/test/` validando os contratos críticos:

| Teste              | Cobertura                                                    | Status |
|--------------------|---------------------------------------------------------------|--------|
| `phase1.test.js`   | Criar sala, host transfer, full, nick duplicado, broadcast    | 8/8 ✓  |
| `phase3.test.js`   | Host-only events, sync de esferas, hits autoritativos, ranking| 11/11 ✓|

---

## 🎨 Decisões de design

### Vanilla JS em vez de React/Vue

- React/Vue + virtual DOM + reconciliação custam ~40KB gzip e ciclos de CPU extras
- Em mobile fraco com câmera + WebGL + Socket.IO ativos, cada ms conta
- O escopo do cliente cabe em uma única SPA sem necessidade de framework
- Padrão usado: imperativo direto sobre DOM, organizado por seções comentadas

### Socket.IO em vez de WebSocket puro

- **Reconexão automática** — mobile troca de rede constantemente (4G ↔ WiFi)
- **Salas nativas** (`io.to(roomCode).emit(...)`) — broadcast por sala sem implementação manual
- **Ack callbacks** (`socket.emit(ev, data, ackFn)`) — RPC-like sobre eventos
- **Fallback automático** pra long-polling se WebSocket for bloqueado por proxy

### mysql2 cru sem ORM

- Domínio minúsculo (2 tabelas, ~10 queries únicas)
- ORM (Prisma, Sequelize) introduziria peso desproporcional
- Migrations manuais via arquivos `.sql` numerados em `sql/`

### Sem Redis na v1

- Salas duram a partida (efêmeras), cabem em memória do processo Node
- Redis só seria necessário ao escalar pra múltiplos processos Node — escopo futuro
- Trade-off aceito: estado se perde se o processo cair (jogadores precisam reentrar)

### MySQL opcional em dev

- Repository pattern permite que `DB_HOST` vazio → memória; preenchido → MySQL
- Dev local não precisa instalar MySQL pra mexer em features de lobby/game
- Em produção, MySQL é obrigatório (persistência de partidas)

### Código de sala de 6 chars alfanuméricos

- Alfabeto sem `0/O/1/I/L` → 32 chars únicos → ~1 bilhão de combinações
- 6 chars é o sweet-spot UX entre facilidade de digitação e cardinalidade
- Fácil de ditar verbalmente entre amigos no espaço físico

### Calibração manual em vez de detecção automática

- Detecção automática (MindAR) requer biblioteca extra (~200KB) e processamento de imagem em cada frame
- Calibração manual ("aponte e toque") tem zero overhead computacional
- UX é equivalente — só requer instrução clara no banner

### Servidor único (não distribuído)

- Para a escala alvo (< 1000 salas simultâneas), um único Node.js basta
- Adicionar distribuição (load balancer + Redis sticky sessions) é Fase 6+
- Decisão: **simplicidade first, optimization later**

---

## ⚠️ Limitações conhecidas

| Limitação                                              | Razão                                          | Workaround           |
|--------------------------------------------------------|-----------------------------------------------|----------------------|
| Jogador não pode se mover (só girar no eixo)           | Web AR no iOS Safari = 3DOF, sem SLAM         | Regra da partida     |
| Esferas posicionadas relativas ao frame do host        | Calibração é manual via tap, não automática   | Fase 6 com MindAR    |
| Mid-game join não restaura esferas e scores            | Snapshot existe mas não foi cabeado no cliente | Fase 5               |
| Host sai mid-game → jogo trava                         | Falta lógica de transferência durante partida | Fase 5               |
| Sem chat de voz/texto entre jogadores                  | Fora do escopo da v1                          | -                    |
| Permissão de câmera + giroscópio bloqueia em modo privado/incognito (iOS) | Limite do iOS Safari        | Pedir pra usar aba normal |
| Magnetômetro impreciso em ambiente com metal           | Limitação física do sensor                    | Justifica QR como âncora |
| Sem rate limiting na API REST                          | Não implementado na v1                        | Fase 5               |

---

## 📚 Glossário

| Termo            | Definição                                                                  |
|------------------|----------------------------------------------------------------------------|
| **3DOF**         | 3 Degrees of Freedom — rotação em 3 eixos (yaw, pitch, roll)               |
| **6DOF**         | 6 Degrees of Freedom — 3DOF + translação (x, y, z)                         |
| **AR**           | Augmented Reality — realidade aumentada                                    |
| **CSPRNG**       | Cryptographically Secure Pseudo-Random Number Generator                    |
| **FSM**          | Finite State Machine — máquina de estados finitos                          |
| **IMU**          | Inertial Measurement Unit — sensor que combina giroscópio + acelerômetro + magnetômetro |
| **MVCC**         | Multi-Version Concurrency Control (InnoDB)                                 |
| **PWA**          | Progressive Web App                                                        |
| **Quaternion**   | Número hipercomplexo de 4 componentes, usado pra representar rotações 3D    |
| **Raycasting**   | Algoritmo de testar intersecção entre um raio e objetos no espaço          |
| **SLAM**         | Simultaneous Localization and Mapping                                       |
| **SLERP**        | Spherical Linear Interpolation — interpolação suave entre quaternions      |
| **Secure context** | Página servida via HTTPS ou em localhost; pré-requisito pra várias APIs DOM |
| **WSS**          | WebSocket Secure (WebSocket sobre TLS)                                     |

---

## 📖 Referências

### Especificações e APIs

- [W3C Device Orientation Event Specification](https://www.w3.org/TR/orientation-event/)
- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [WebGL 2.0 Specification](https://www.khronos.org/registry/webgl/specs/latest/2.0/)
- [WebSocket Protocol (RFC 6455)](https://tools.ietf.org/html/rfc6455)
- [MDN: Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)

### Documentação das libs

- [Three.js — DeviceOrientationControls](https://threejs.org/docs/#examples/en/controls/DeviceOrientationControls)
- [Three.js — Raycaster](https://threejs.org/docs/#api/en/core/Raycaster)
- [Three.js — Quaternion](https://threejs.org/docs/#api/en/math/Quaternion)
- [Socket.IO — Rooms](https://socket.io/docs/v4/rooms/)
- [Socket.IO — Emit cheatsheet](https://socket.io/docs/v4/emit-cheatsheet/)

### Conceitos teóricos

- Hamilton, W.R. (1843). *On a new species of imaginary quantities connected with the theory of quaternions.* Proceedings of the Royal Irish Academy. — origem dos quaternions.
- Lloyd, S. (1957). *Least squares quantization in PCM.* — base teórica de muitas técnicas de detecção em sinais ruidosos.
- Brewer, E. (2000). *Towards Robust Distributed Systems.* — Teorema CAP.

### Tutoriais úteis

- [Glenn Fiedler — *Networking for Game Programmers*](https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/) — referência clássica sobre arquitetura cliente-servidor em jogos.
- [Mozilla — *Sensor Fusion*](https://developer.mozilla.org/en-US/docs/Web/API/Sensor_APIs)

---

## 🤝 Contribuir

Issues e PRs bem-vindos. Por favor, ao abrir:

- **Issue:** descreva o problema + passos pra reproduzir + qual celular/browser
- **PR:** adicione/atualize testes em `server/test/` se mudar a API

### Convenções de código

- Variáveis e funções em `camelCase`
- Constantes em `SCREAMING_SNAKE_CASE`
- Indentação 4 espaços
- Sem ponto-e-vírgula opcional — usar sempre
- ESM puro (`import/export`, não `require/module.exports`)

---

## 📜 Licença

MIT — sinta-se livre pra usar, modificar e distribuir.

---

## 🙏 Créditos

Construído como um experimento de **AR multiplayer no navegador**, explorando os limites do que dá pra fazer com APIs web padronizadas sem depender de motores AR proprietários nem aplicativos nativos.

**Tecnologias:**

- [Three.js](https://threejs.org/) — renderização 3D no navegador
- [Socket.IO](https://socket.io/) — WebSocket com salas
- [Express](https://expressjs.com/) — HTTP server
- [MySQL](https://www.mysql.com/) — persistência
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) — gerador SVG do marcador
- [CloudPanel](https://www.cloudpanel.io/) (grátis) + [Let's Encrypt](https://letsencrypt.org/) (grátis) — infraestrutura
