# silvia-server

Servidor multiplayer do **Esferas da Taísa RA**.

- **Fase 0:** esqueleto Express + Socket.IO + PM2 + deploy CloudPanel ✅
- **Fase 1:** sistema de salas (criar, entrar, broadcast de jogadores) ✅
- **Fase 2:** cliente multi-tela (home → criar/entrar → lobby → jogo → ranking) ✅
- **Fase 3:** servidor autoritativo de bolinhas + hits + ranking multiplayer ✅
- Fase 4: persistência de scores no MySQL + regras customizadas (em breve)

---

## Rodando local (Windows / dev)

Pré-requisitos: Node 20+ e pnpm.

```bash
# Na pasta server/
pnpm install
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
pnpm dev
```

**Dev sem MySQL:** se `DB_HOST` no `.env` estiver vazio, o servidor usa armazenamento em memória — perfeito pra mexer no código sem instalar MySQL localmente. Salas somem quando o servidor reinicia (esperado em dev).

**Dev com MySQL local:** preenche o `.env` e roda o schema:

```bash
mysql -u silvia -p silvia < sql/001_init.sql
```

### Validar manualmente

- **`http://localhost:3000/`** → cliente do jogo (home → lobby → jogo → ranking)
- `http://localhost:3000/healthz` → JSON `{ ok: true, ... }`
- `http://localhost:3000/test.html` → painel de debug (criar/entrar em abas separadas)

⚠️ Pra rodar a parte AR (câmera + giroscópio), tem que acessar via **HTTPS** ou **localhost**. `file://` não funciona — câmera e DeviceOrientation só funcionam em contexto seguro.

### Smoke test automatizado

Com o servidor rodando em `:3000` em outra aba:

```bash
node test/phase1.test.js
```

Cobre: criar sala, host join, guest join, broadcast, nickname duplicado, sala cheia, transferência de host.

---

## Deploy no CloudPanel — passo a passo

### 1. Subdomínio
No seu DNS, aponte um subdomínio (ex.: `silvia.seudominio.com`) pro IP da VPS via registro **A**.

### 2. CloudPanel → criar Node.js site
- **Sites → Add Site → Create a Node.js Site**
- Domain: `silvia.seudominio.com`
- Node.js version: **20 (LTS)** ou superior
- App root: `/htdocs/silvia.seudominio.com/server` (o painel cria `/htdocs/<domain>/` automaticamente; vamos colocar o backend em uma subpasta `server/`)
- App port: **3000** (mesmo do `.env`)

### 3. Banco MySQL
- **Databases → Add Database**
- Database Name: `silvia`
- User: `silvia`, gere uma senha forte e **anote**.
- Host: `127.0.0.1`, Port: `3306`

(banco fica configurado mas o servidor só conecta na Fase 1)

### 4. SSL
- **Sites → silvia.seudominio.com → SSL/TLS → Actions → New Let's Encrypt Certificate**
- Marcar "Force HTTPS Redirect".

### 5. nginx — WebSocket upgrade
CloudPanel já configura proxy reverso pra Node, mas precisamos confirmar o upgrade de WebSocket.

- **Sites → silvia.seudominio.com → Vhost** (editar diretamente)
- Garantir que dentro do `location /` ou em um bloco específico existem estas linhas:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 86400;
proxy_pass http://127.0.0.1:3000;
```

Salvar → o painel recarrega o nginx automaticamente.

### 6. Subir o código
Pelo terminal SSH (usuário do site, **não root**):

```bash
cd ~/htdocs/silvia.seudominio.com
# clone seu repo OU rsync da pasta server/ daqui pra essa pasta
# (a partir daqui assumimos que server/ está em ~/htdocs/silvia.seudominio.com/server)

cd server
# instalar pnpm globalmente pro usuário (uma vez só)
npm i -g pnpm
pnpm install --prod

# copiar e editar o .env
cp .env.example .env
nano .env
#   PORT=3000
#   NODE_ENV=production
#   CORS_ORIGIN=https://silvia.seudominio.com
#   DB_PASSWORD=<a senha que você anotou>
```

### 7. PM2
```bash
# instalar PM2 (uma vez)
npm i -g pm2

# subir o app
pm2 start ecosystem.config.cjs
pm2 save

# fazer PM2 iniciar com a VPS
pm2 startup
# (rodar o comando que ele imprimir)
```

### 8. Validar
- `https://silvia.seudominio.com/healthz` → JSON `{ ok: true, ... }`
- Em qualquer página com `https://`, abrir DevTools console:

```js
const script = document.createElement('script');
script.src = 'https://cdn.socket.io/4.8.0/socket.io.min.js';
document.head.appendChild(script);
script.onload = () => {
    const s = io('wss://silvia.seudominio.com');
    s.on('connect', () => console.log('connected', s.id));
    s.on('hello', d => console.log('hello', d));
    s.emit('ping:client', { t: Date.now() }, ack => console.log('ack', ack));
};
```

Você deve ver `connected <id>`, `hello {...}` e `ack { pong: true, ... }`.

🎉 Saída da Fase 0 atingida: `wss://silvia.seudominio.com` aceita conexão.

---

## Comandos úteis no servidor

```bash
pm2 status                  # ver app rodando
pm2 logs silvia-server      # logs em tempo real
pm2 restart silvia-server   # reiniciar
pm2 reload silvia-server    # reload zero-downtime
pm2 monit                   # painel ncurses
```

---

## API da Fase 1

### REST

| Método | Rota | Body / Params | Resposta |
|---|---|---|---|
| `POST` | `/api/rooms` | `{ hostNickname, maxPlayers (2-32), scoringRules? }` | `201 { code, hostNickname, maxPlayers, status, ... }` |
| `GET`  | `/api/rooms/:code` | — | `200 { code, hostNickname, maxPlayers, status, playerCount, hasSlot }` · `404 { error: "not_found" }` · `410 { error: "ended" }` |

### Socket.IO

**Cliente → servidor**

| Evento | Payload | Ack |
|---|---|---|
| `room:join` | `{ code, nickname }` | `{ ok: true, you: {nickname, isHost}, room }` ou `{ ok: false, error }` |
| `room:leave` | — | `{ ok: true }` |
| `ping:client` | qualquer | `{ pong: true, ts, echo }` |

Erros possíveis: `invalid_code`, `invalid_nickname`, `not_found`, `ended`, `nickname_taken`, `full`, `server_error`.

**Servidor → cliente (broadcast na sala)**

| Evento | Payload |
|---|---|
| `hello` | `{ id, ts }` (na conexão) |
| `room:player_joined` | `{ nickname, isHost, room }` |
| `room:player_left` | `{ nickname, newHostNickname, room }` |

`room` em todo broadcast contém o estado completo atualizado, então o cliente nunca precisa reconciliar manualmente.

---

## API da Fase 3 (jogo multiplayer)

Todos os eventos a seguir são host-only exceto `sphere:shoot` (qualquer jogador).
Servidor é autoritativo: cria os IDs das bolinhas, valida cooldown/estado, computa scores.

**Cliente → servidor**

| Evento | Payload | Quem |
|---|---|---|
| `game:start` | — | host (sala em waiting/ended) |
| `sphere:place` | `{ type, x, y, z }` (type: normal/fast/rare) | host (status=placing) |
| `sphere:clear` | — | host (status=placing) |
| `game:play_start` | — | host (≥3 bolinhas posicionadas) |
| `sphere:shoot` | `{ id }` | qualquer (status=playing) |

Erros: `not_in_room`, `not_host`, `invalid_state`, `invalid_type`, `max_spheres`, `not_enough_spheres`, `sphere_not_found`, `already_destroyed`.

**Servidor → cliente (broadcast na sala)**

| Evento | Payload |
|---|---|
| `game:started` | `{ status: 'placing', scoringRules }` |
| `sphere:placed` | `{ id, type, x, y, z, placedBy, alive: true }` |
| `sphere:cleared` | — |
| `game:play_started` | `{ status: 'playing', durationSec }` |
| `sphere:destroyed` | `{ id, type, hitBy, points, totals: { [nick]: { score, hits } } }` |
| `game:ended` | `{ ranking: [{ nickname, score, hits, rank }], reason: 'all_destroyed' \| 'timeout' }` |

**Posicionamento das bolinhas:**
- Coordenadas armazenadas no servidor são as do **frame local do jogador host**.
- Pra ficarem no mesmo lugar físico pra todos, os jogadores precisam ter **calibrado o alpha-zero apontando pro mesmo marcador QR**.
- A fase CALIBRATE do cliente faz isso: jogador aponta a câmera pro QR e toca CALIBRAR → seu alpha-zero vira essa direção.
