// Smoke test da Fase 1: cria sala via REST, dois sockets entram, valida broadcasts.
// Run: node test/phase1.test.js   (com o servidor rodando em :3000)
import { io as ioClient } from 'socket.io-client';

const BASE = 'http://localhost:3000';
const log = (...a) => console.log('  ', ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
    // 1. Cria sala via REST
    const createRes = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostNickname: 'Paulo', maxPlayers: 4 }),
    });
    const room = await createRes.json();
    if (!createRes.ok) throw new Error('createRoom failed: ' + JSON.stringify(room));
    console.log(`✓ Sala criada: ${room.code}`);

    // 2. Host conecta e entra
    const host = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => host.once('connect', r));
    log(`host conectado (sid=${host.id})`);

    const hostJoin = await new Promise(r =>
        host.emit('room:join', { code: room.code, nickname: 'Paulo' }, r),
    );
    if (!hostJoin.ok) throw new Error('host join failed: ' + JSON.stringify(hostJoin));
    if (!hostJoin.you.isHost) throw new Error('host should be flagged as isHost');
    console.log(`✓ Host entrou (isHost=${hostJoin.you.isHost}, players=${hostJoin.room.playerCount})`);

    // 3. Convidado conecta — host deve receber broadcast
    const guest = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => guest.once('connect', r));

    const hostBroadcast = new Promise(r => host.once('room:player_joined', r));

    const guestJoin = await new Promise(r =>
        guest.emit('room:join', { code: room.code, nickname: 'Visitante' }, r),
    );
    if (!guestJoin.ok) throw new Error('guest join failed: ' + JSON.stringify(guestJoin));
    if (guestJoin.you.isHost) throw new Error('guest should NOT be host');
    console.log(`✓ Convidado entrou (isHost=${guestJoin.you.isHost}, players=${guestJoin.room.playerCount})`);

    const broadcast = await Promise.race([
        hostBroadcast,
        sleep(2000).then(() => null),
    ]);
    if (!broadcast) throw new Error('host did not receive room:player_joined broadcast');
    if (broadcast.nickname !== 'Visitante') throw new Error('wrong nickname in broadcast');
    console.log(`✓ Host recebeu broadcast: ${broadcast.nickname} entrou`);

    // 4. Nickname duplicado deve falhar
    const dup = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => dup.once('connect', r));
    const dupJoin = await new Promise(r =>
        dup.emit('room:join', { code: room.code, nickname: 'Paulo' }, r),
    );
    if (dupJoin.ok) throw new Error('duplicate nickname should fail');
    if (dupJoin.error !== 'nickname_taken') throw new Error('wrong error: ' + dupJoin.error);
    console.log(`✓ Apelido duplicado rejeitado (error=${dupJoin.error})`);
    dup.disconnect();

    // 5. Convidado sai — host deve receber room:player_left
    const leftPromise = new Promise(r => host.once('room:player_left', r));
    guest.disconnect();
    const left = await Promise.race([leftPromise, sleep(2000).then(() => null)]);
    if (!left) throw new Error('host did not receive room:player_left');
    if (left.nickname !== 'Visitante') {
        throw new Error('wrong nickname in left event: ' + JSON.stringify(left));
    }
    console.log(`✓ Host recebeu broadcast: ${left.nickname} saiu`);

    // 6. Host sai — host transfer (não aplicável aqui, sala fica vazia)
    host.disconnect();

    // 7. Sala cheia
    const small = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostNickname: 'A', maxPlayers: 2 }),
    }).then(r => r.json());

    const a = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => a.once('connect', r));
    await new Promise(r => a.emit('room:join', { code: small.code, nickname: 'A' }, r));

    const b = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => b.once('connect', r));
    await new Promise(r => b.emit('room:join', { code: small.code, nickname: 'B' }, r));

    const c = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => c.once('connect', r));
    const full = await new Promise(r =>
        c.emit('room:join', { code: small.code, nickname: 'C' }, r),
    );
    if (full.ok || full.error !== 'full') throw new Error('expected full, got: ' + JSON.stringify(full));
    console.log(`✓ Sala cheia rejeita 3º jogador (error=${full.error})`);
    a.disconnect(); b.disconnect(); c.disconnect();

    // 8. Transferência de host quando host sai
    const tr = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostNickname: 'H1', maxPlayers: 4 }),
    }).then(r => r.json());

    const h1 = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => h1.once('connect', r));
    await new Promise(r => h1.emit('room:join', { code: tr.code, nickname: 'H1' }, r));

    const h2 = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => h2.once('connect', r));
    await new Promise(r => h2.emit('room:join', { code: tr.code, nickname: 'H2' }, r));

    const hostChange = new Promise(r => h2.once('room:player_left', r));
    h1.disconnect();
    const hc = await Promise.race([hostChange, sleep(2000).then(() => null)]);
    if (!hc) throw new Error('h2 did not receive player_left');
    if (hc.newHostNickname !== 'H2') throw new Error('host transfer failed: ' + JSON.stringify(hc));
    console.log(`✓ Host transferido para ${hc.newHostNickname}`);
    h2.disconnect();

    console.log('\n  🎉 Todos os checks da Fase 1 passaram.');
    process.exit(0);
}

main().catch(err => {
    console.error('\n  ✗ FALHOU:', err.message);
    process.exit(1);
});
