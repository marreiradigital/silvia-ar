import { generateRoomCode } from './codes.js';

const MIN_NICK = 1;
const MAX_NICK = 20;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 32;
const DEFAULT_MAX_PLAYERS = 8;
const CODE_GEN_ATTEMPTS = 10;

function normalizeNickname(n) {
    return String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NICK);
}

function clampMaxPlayers(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return DEFAULT_MAX_PLAYERS;
    return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, v));
}

export function createRoomsRepo({ db }) {
    return db ? createMysqlRepo(db) : createMemoryRepo();
}

// ──────────────────────────────────────────────────────────────
// In-memory implementation (dev sem MySQL)
// ──────────────────────────────────────────────────────────────
function createMemoryRepo() {
    const rooms = new Map();        // code -> RoomState
    const socketIndex = new Map();  // socketId -> code

    function shape(r) {
        return {
            code: r.code,
            hostNickname: r.hostNickname,
            maxPlayers: r.maxPlayers,
            status: r.status,
            scoringRules: r.scoringRules,
            createdAt: r.createdAt,
            players: Array.from(r.players.values()).map(p => ({
                nickname: p.nickname,
                isHost: p.isHost,
            })),
            playerCount: r.players.size,
        };
    }

    async function findUniqueCode() {
        for (let i = 0; i < CODE_GEN_ATTEMPTS; i++) {
            const c = generateRoomCode();
            const r = rooms.get(c);
            if (!r || r.status === 'ended') return c;
        }
        throw new Error('Could not generate unique room code');
    }

    async function createRoom({ hostNickname, maxPlayers, scoringRules }) {
        const code = await findUniqueCode();
        const room = {
            code,
            hostNickname: normalizeNickname(hostNickname),
            maxPlayers: clampMaxPlayers(maxPlayers),
            status: 'waiting',
            scoringRules: scoringRules ?? null,
            createdAt: new Date().toISOString(),
            players: new Map(),
        };
        rooms.set(code, room);
        return shape(room);
    }

    async function getRoom(code) {
        const r = rooms.get(code);
        return r ? shape(r) : null;
    }

    async function addPlayer({ code, nickname, socketId }) {
        const r = rooms.get(code);
        if (!r) return { error: 'not_found' };
        if (r.status === 'ended') return { error: 'ended' };

        const nick = normalizeNickname(nickname);
        if (nick.length < MIN_NICK) return { error: 'invalid_nickname' };
        for (const p of r.players.values()) {
            if (p.nickname.toLowerCase() === nick.toLowerCase()) {
                return { error: 'nickname_taken' };
            }
        }
        if (r.players.size >= r.maxPlayers) return { error: 'full' };

        const isHost =
            r.players.size === 0 &&
            r.hostNickname.toLowerCase() === nick.toLowerCase();

        r.players.set(socketId, { nickname: nick, isHost });
        socketIndex.set(socketId, code);

        return {
            player: { nickname: nick, isHost },
            room: shape(r),
        };
    }

    async function removePlayerBySocket(socketId) {
        const code = socketIndex.get(socketId);
        if (!code) return null;
        socketIndex.delete(socketId);

        const r = rooms.get(code);
        if (!r) return null;

        const player = r.players.get(socketId);
        r.players.delete(socketId);

        let newHostNickname = null;
        if (player?.isHost && r.players.size > 0) {
            const [, nextPlayer] = r.players.entries().next().value;
            nextPlayer.isHost = true;
            newHostNickname = nextPlayer.nickname;
        }

        return {
            code,
            leftNickname: player?.nickname ?? null,
            newHostNickname,
            room: shape(r),
        };
    }

    async function findPlayerBySocket(socketId) {
        const code = socketIndex.get(socketId);
        if (!code) return null;
        const r = rooms.get(code);
        if (!r) return null;
        const p = r.players.get(socketId);
        if (!p) return null;
        return { code, nickname: p.nickname, isHost: p.isHost };
    }

    return { createRoom, getRoom, addPlayer, removePlayerBySocket, findPlayerBySocket };
}

// ──────────────────────────────────────────────────────────────
// MySQL implementation
// ──────────────────────────────────────────────────────────────
function createMysqlRepo(pool) {
    const socketIndex = new Map(); // socketId -> { code, playerId }

    async function findUniqueCode() {
        for (let i = 0; i < CODE_GEN_ATTEMPTS; i++) {
            const c = generateRoomCode();
            const [rows] = await pool.query(
                "SELECT 1 FROM rooms WHERE code = ? AND status <> 'ended' LIMIT 1",
                [c],
            );
            if (rows.length === 0) return c;
        }
        throw new Error('Could not generate unique room code');
    }

    async function createRoom({ hostNickname, maxPlayers, scoringRules }) {
        const code = await findUniqueCode();
        const host = normalizeNickname(hostNickname);
        const max = clampMaxPlayers(maxPlayers);
        await pool.query(
            'INSERT INTO rooms (code, host_nickname, max_players, scoring_rules) VALUES (?, ?, ?, ?)',
            [code, host, max, scoringRules ? JSON.stringify(scoringRules) : null],
        );
        return await getRoom(code);
    }

    async function getRoom(code) {
        const [roomRows] = await pool.query(
            'SELECT code, host_nickname, max_players, status, scoring_rules, created_at FROM rooms WHERE code = ?',
            [code],
        );
        if (roomRows.length === 0) return null;
        const r = roomRows[0];

        const [playerRows] = await pool.query(
            'SELECT nickname, is_host FROM players WHERE room_code = ? AND left_at IS NULL ORDER BY joined_at ASC',
            [code],
        );

        return {
            code: r.code,
            hostNickname: r.host_nickname,
            maxPlayers: r.max_players,
            status: r.status,
            scoringRules: r.scoring_rules,
            createdAt: r.created_at,
            players: playerRows.map(p => ({
                nickname: p.nickname,
                isHost: !!p.is_host,
            })),
            playerCount: playerRows.length,
        };
    }

    async function addPlayer({ code, nickname, socketId }) {
        const room = await getRoom(code);
        if (!room) return { error: 'not_found' };
        if (room.status === 'ended') return { error: 'ended' };

        const nick = normalizeNickname(nickname);
        if (nick.length < MIN_NICK) return { error: 'invalid_nickname' };
        if (room.players.some(p => p.nickname.toLowerCase() === nick.toLowerCase())) {
            return { error: 'nickname_taken' };
        }
        if (room.playerCount >= room.maxPlayers) return { error: 'full' };

        const isHost =
            room.playerCount === 0 &&
            room.hostNickname.toLowerCase() === nick.toLowerCase();

        const [res] = await pool.query(
            'INSERT INTO players (room_code, nickname, socket_id, is_host) VALUES (?, ?, ?, ?)',
            [code, nick, socketId, isHost ? 1 : 0],
        );
        socketIndex.set(socketId, { code, playerId: res.insertId });

        return {
            player: { nickname: nick, isHost },
            room: await getRoom(code),
        };
    }

    async function removePlayerBySocket(socketId) {
        const idx = socketIndex.get(socketId);
        if (!idx) return null;
        socketIndex.delete(socketId);

        const [playerRows] = await pool.query(
            'SELECT nickname, is_host FROM players WHERE id = ? AND left_at IS NULL',
            [idx.playerId],
        );
        if (playerRows.length === 0) return null;

        const leftNickname = playerRows[0].nickname;
        const wasHost = !!playerRows[0].is_host;

        await pool.query(
            'UPDATE players SET left_at = NOW(), socket_id = NULL WHERE id = ?',
            [idx.playerId],
        );

        let newHostNickname = null;
        if (wasHost) {
            const [next] = await pool.query(
                'SELECT id, nickname FROM players WHERE room_code = ? AND left_at IS NULL ORDER BY joined_at ASC LIMIT 1',
                [idx.code],
            );
            if (next.length > 0) {
                await pool.query('UPDATE players SET is_host = 1 WHERE id = ?', [next[0].id]);
                newHostNickname = next[0].nickname;
            }
        }

        return {
            code: idx.code,
            leftNickname,
            newHostNickname,
            room: await getRoom(idx.code),
        };
    }

    async function findPlayerBySocket(socketId) {
        const idx = socketIndex.get(socketId);
        if (!idx) return null;
        const [rows] = await pool.query(
            'SELECT nickname, is_host FROM players WHERE id = ? AND left_at IS NULL',
            [idx.playerId],
        );
        if (rows.length === 0) return null;
        return {
            code: idx.code,
            nickname: rows[0].nickname,
            isHost: !!rows[0].is_host,
        };
    }

    return { createRoom, getRoom, addPlayer, removePlayerBySocket, findPlayerBySocket };
}
