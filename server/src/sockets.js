import { isValidRoomCode, normalizeRoomCode } from './codes.js';

export function attachSocketHandlers(io, { rooms, games }) {
    // Per-room timer references (so timeouts can be cancelled if game ends early).
    const playTimers = new Map(); // roomCode -> setTimeout handle

    function clearPlayTimer(code) {
        const t = playTimers.get(code);
        if (t) { clearTimeout(t); playTimers.delete(code); }
    }

    function endGameAndBroadcast(code, reason) {
        clearPlayTimer(code);
        const res = games.end(code, reason);
        if (res.ok) {
            io.to(code).emit('game:ended', { ranking: res.ranking, reason });
        }
    }

    io.on('connection', (socket) => {
        console.log(`[ws] + ${socket.id}`);
        socket.emit('hello', { id: socket.id, ts: Date.now() });

        // ── Room join/leave (Fase 1) ──
        socket.on('room:join', async (payload, ack) => {
            try {
                const { code: rawCode, nickname } = payload ?? {};
                const code = normalizeRoomCode(rawCode);
                if (!isValidRoomCode(code)) return ack?.({ ok: false, error: 'invalid_code' });

                const result = await rooms.addPlayer({ code, nickname, socketId: socket.id });
                if (result.error) return ack?.({ ok: false, error: result.error });

                socket.join(code);

                // Se já existe partida em andamento, manda o snapshot pro novato.
                const snap = games.snapshot(code);

                ack?.({ ok: true, you: result.player, room: result.room, game: snap });
                socket.to(code).emit('room:player_joined', {
                    nickname: result.player.nickname,
                    isHost: result.player.isHost,
                    room: result.room,
                });
            } catch (err) {
                console.error('[room:join]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        socket.on('room:leave', async (_payload, ack) => {
            try {
                const result = await rooms.removePlayerBySocket(socket.id);
                if (result) {
                    socket.leave(result.code);
                    io.to(result.code).emit('room:player_left', {
                        nickname: result.leftNickname,
                        newHostNickname: result.newHostNickname,
                        room: result.room,
                    });
                }
                ack?.({ ok: true });
            } catch (err) {
                console.error('[room:leave]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        // ── Game lifecycle (Fase 3) ──
        // Host starts the game: lobby → placing (resetando se já havia partida)
        socket.on('game:start', async (_payload, ack) => {
            try {
                const me = await rooms.findPlayerBySocket(socket.id);
                if (!me) return ack?.({ ok: false, error: 'not_in_room' });
                if (!me.isHost) return ack?.({ ok: false, error: 'not_host' });

                // Limpa qualquer timer de partida pendente — host está reiniciando do zero
                clearPlayTimer(me.code);

                const room = await rooms.getRoom(me.code);
                const result = games.start(me.code, room?.scoringRules);
                if (!result.ok) return ack?.(result);

                io.to(me.code).emit('game:started', {
                    status: result.status,
                    scoringRules: result.scoringRules,
                });
                ack?.({ ok: true });
            } catch (err) {
                console.error('[game:start]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        // Host places a sphere — broadcast to all (incluindo o host, pra renderizar com mesmo id)
        socket.on('sphere:place', async (payload, ack) => {
            try {
                const me = await rooms.findPlayerBySocket(socket.id);
                if (!me) return ack?.({ ok: false, error: 'not_in_room' });
                if (!me.isHost) return ack?.({ ok: false, error: 'not_host' });

                const result = games.placeSphere(me.code, me.nickname, payload ?? {});
                if (!result.ok) return ack?.(result);

                io.to(me.code).emit('sphere:placed', result.sphere);
                ack?.({ ok: true, sphere: result.sphere });
            } catch (err) {
                console.error('[sphere:place]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        socket.on('sphere:clear', async (_payload, ack) => {
            try {
                const me = await rooms.findPlayerBySocket(socket.id);
                if (!me) return ack?.({ ok: false, error: 'not_in_room' });
                if (!me.isHost) return ack?.({ ok: false, error: 'not_host' });

                const result = games.clearSpheres(me.code);
                if (!result.ok) return ack?.(result);

                io.to(me.code).emit('sphere:cleared');
                ack?.({ ok: true });
            } catch (err) {
                console.error('[sphere:clear]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        // Host starts the play phase: placing → playing (com timer)
        socket.on('game:play_start', async (_payload, ack) => {
            try {
                const me = await rooms.findPlayerBySocket(socket.id);
                if (!me) return ack?.({ ok: false, error: 'not_in_room' });
                if (!me.isHost) return ack?.({ ok: false, error: 'not_host' });

                const result = games.startPlay(me.code);
                if (!result.ok) return ack?.(result);

                io.to(me.code).emit('game:play_started', {
                    status: result.status,
                    durationSec: result.durationSec,
                });
                ack?.({ ok: true });

                clearPlayTimer(me.code);
                playTimers.set(
                    me.code,
                    setTimeout(() => endGameAndBroadcast(me.code, 'timeout'), result.durationSec * 1000),
                );
            } catch (err) {
                console.error('[game:play_start]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        // Any player shoots — server validates + broadcasts
        socket.on('sphere:shoot', async (payload, ack) => {
            try {
                const me = await rooms.findPlayerBySocket(socket.id);
                if (!me) return ack?.({ ok: false, error: 'not_in_room' });

                const id = payload?.id;
                if (typeof id !== 'string' || !id) return ack?.({ ok: false, error: 'invalid_sphere_id' });

                const result = games.tryShoot(me.code, id, me.nickname);
                if (!result.ok) return ack?.(result);

                io.to(me.code).emit('sphere:destroyed', {
                    ...result.destroyed,
                    totals: result.totals,
                });
                ack?.({ ok: true });

                if (result.lastSphere) endGameAndBroadcast(me.code, 'all_destroyed');
            } catch (err) {
                console.error('[sphere:shoot]', err);
                ack?.({ ok: false, error: 'server_error' });
            }
        });

        // ── Misc ──
        socket.on('ping:client', (data, ack) => {
            ack?.({ pong: true, ts: Date.now(), echo: data ?? null });
        });

        socket.on('disconnect', async (reason) => {
            console.log(`[ws] - ${socket.id} (${reason})`);
            try {
                const result = await rooms.removePlayerBySocket(socket.id);
                if (result) {
                    io.to(result.code).emit('room:player_left', {
                        nickname: result.leftNickname,
                        newHostNickname: result.newHostNickname,
                        room: result.room,
                    });
                }
            } catch (err) {
                console.error('[disconnect cleanup]', err);
            }
        });
    });
}
