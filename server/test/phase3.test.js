// Smoke test da Fase 3: sincronização de bolinhas + servidor autoritativo de hits.
// Pré-requisito: servidor rodando em :3000 (pnpm dev).
import { io as ioClient } from 'socket.io-client';

const BASE = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function emitAck(socket, event, payload) {
    return new Promise(r => socket.emit(event, payload, r));
}

function once(socket, event, timeoutMs = 2000) {
    return Promise.race([
        new Promise(r => socket.once(event, r)),
        sleep(timeoutMs).then(() => null),
    ]);
}

async function joinAs(code, nickname) {
    const s = ioClient(BASE, { transports: ['websocket'] });
    await new Promise(r => s.once('connect', r));
    const ack = await emitAck(s, 'room:join', { code, nickname });
    if (!ack.ok) throw new Error(`${nickname} join failed: ${ack.error}`);
    return s;
}

async function main() {
    // 1. Cria sala + dois sockets
    const room = await fetch(`${BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostNickname: 'Host', maxPlayers: 4 }),
    }).then(r => r.json());
    console.log(`✓ Sala criada: ${room.code}`);

    const host  = await joinAs(room.code, 'Host');
    const guest = await joinAs(room.code, 'Guest');
    console.log('✓ Host + Guest entraram');

    // 2. Guest tenta começar partida → not_host
    {
        const ack = await emitAck(guest, 'game:start');
        if (ack.ok || ack.error !== 'not_host') throw new Error('expected not_host, got: ' + JSON.stringify(ack));
        console.log('✓ Guest bloqueado de iniciar partida (not_host)');
    }

    // 3. Host inicia partida → ambos recebem game:started
    {
        const hostEv = once(host, 'game:started');
        const guestEv = once(guest, 'game:started');
        const ack = await emitAck(host, 'game:start');
        if (!ack.ok) throw new Error('game:start failed: ' + JSON.stringify(ack));
        const [h, g] = await Promise.all([hostEv, guestEv]);
        if (!h || !g) throw new Error('clients did not receive game:started');
        if (h.status !== 'placing') throw new Error('status should be placing');
        console.log(`✓ Ambos receberam game:started (status=${h.status})`);
    }

    // 4. Guest tenta colocar bolinha → not_host
    {
        const ack = await emitAck(guest, 'sphere:place', { type: 'normal', x: 1, y: 0, z: -2 });
        if (ack.ok || ack.error !== 'not_host') throw new Error('guest place should fail');
        console.log('✓ Guest bloqueado de posicionar (not_host)');
    }

    // 5. Host posiciona 3 bolinhas → ambos veem
    const placed = [];
    for (const t of ['normal', 'fast', 'rare']) {
        const hostEv = once(host, 'sphere:placed');
        const guestEv = once(guest, 'sphere:placed');
        const ack = await emitAck(host, 'sphere:place', { type: t, x: Math.random(), y: 0, z: -2 });
        if (!ack.ok) throw new Error('place failed: ' + JSON.stringify(ack));
        const [h, g] = await Promise.all([hostEv, guestEv]);
        if (!h || !g) throw new Error('clients did not receive sphere:placed');
        if (h.id !== g.id) throw new Error('mismatched sphere id between clients');
        placed.push(h);
    }
    console.log(`✓ 3 bolinhas posicionadas e sincronizadas (ids: ${placed.map(p => p.id).join(', ')})`);

    // 6. Host inicia disputa
    {
        const hostEv = once(host, 'game:play_started');
        const guestEv = once(guest, 'game:play_started');
        const ack = await emitAck(host, 'game:play_start');
        if (!ack.ok) throw new Error('play_start failed: ' + JSON.stringify(ack));
        const [h, g] = await Promise.all([hostEv, guestEv]);
        if (!h || !g) throw new Error('clients did not receive play_started');
        console.log(`✓ Disputa iniciada (duration=${h.durationSec}s)`);
    }

    // 7. Host acerta a primeira bolinha
    {
        const hostEv = once(host, 'sphere:destroyed');
        const guestEv = once(guest, 'sphere:destroyed');
        const ack = await emitAck(host, 'sphere:shoot', { id: placed[0].id });
        if (!ack.ok) throw new Error('shoot failed: ' + JSON.stringify(ack));
        const [h, g] = await Promise.all([hostEv, guestEv]);
        if (h.hitBy !== 'Host' || h.points !== 10) throw new Error('wrong hit data: ' + JSON.stringify(h));
        if (h.totals?.Host?.score !== 10) throw new Error('wrong totals: ' + JSON.stringify(h.totals));
        console.log(`✓ Host acertou s1 (+${h.points} pts)`);
    }

    // 8. Guest acerta a segunda — score do guest é registrado
    {
        const hostEv = once(host, 'sphere:destroyed');
        const ack = await emitAck(guest, 'sphere:shoot', { id: placed[1].id });
        if (!ack.ok) throw new Error('guest shoot failed: ' + JSON.stringify(ack));
        const h = await hostEv;
        if (h.hitBy !== 'Guest' || h.points !== 20) throw new Error('wrong hit data: ' + JSON.stringify(h));
        if (h.totals?.Guest?.score !== 20) throw new Error('guest score not registered');
        console.log(`✓ Guest acertou s2 (+${h.points} pts)`);
    }

    // 9. Tentativa de atirar em bolinha já destruída → already_destroyed
    {
        const ack = await emitAck(host, 'sphere:shoot', { id: placed[0].id });
        if (ack.ok || ack.error !== 'already_destroyed') {
            throw new Error('expected already_destroyed, got: ' + JSON.stringify(ack));
        }
        console.log('✓ Tiro em bolinha já destruída rejeitado');
    }

    // 10. Última bolinha → game:ended com ranking
    {
        const hostEnd = once(host, 'game:ended');
        const guestEnd = once(guest, 'game:ended');
        await emitAck(host, 'sphere:shoot', { id: placed[2].id });
        const [h, g] = await Promise.all([hostEnd, guestEnd]);
        if (!h || !g) throw new Error('game:ended not broadcast');
        if (h.reason !== 'all_destroyed') throw new Error('wrong reason: ' + h.reason);
        if (!Array.isArray(h.ranking) || h.ranking.length !== 2) throw new Error('ranking malformed');
        // Host: 10 + 50 = 60; Guest: 20 → Host wins
        if (h.ranking[0].nickname !== 'Host' || h.ranking[0].score !== 60) {
            throw new Error('wrong ranking[0]: ' + JSON.stringify(h.ranking[0]));
        }
        if (h.ranking[1].nickname !== 'Guest' || h.ranking[1].score !== 20) {
            throw new Error('wrong ranking[1]: ' + JSON.stringify(h.ranking[1]));
        }
        console.log(`✓ game:ended broadcast — ranking: 1º ${h.ranking[0].nickname} (${h.ranking[0].score}), 2º ${h.ranking[1].nickname} (${h.ranking[1].score})`);
    }

    host.disconnect();
    guest.disconnect();
    console.log('\n  🎉 Todos os checks da Fase 3 passaram.');
    process.exit(0);
}

main().catch(err => {
    console.error('\n  ✗ FALHOU:', err.message);
    process.exit(1);
});
