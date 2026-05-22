import { isValidRoomCode, normalizeRoomCode } from './codes.js';

export function mountRoutes(app, { rooms }) {
    app.post('/api/rooms', async (req, res) => {
        try {
            const { hostNickname, maxPlayers, scoringRules } = req.body ?? {};

            if (typeof hostNickname !== 'string' || hostNickname.trim().length === 0) {
                return res.status(400).json({ error: 'invalid_host_nickname' });
            }
            const max = Number(maxPlayers);
            if (!Number.isFinite(max) || max < 2 || max > 32) {
                return res.status(400).json({ error: 'invalid_max_players' });
            }

            const room = await rooms.createRoom({
                hostNickname,
                maxPlayers: max,
                scoringRules: scoringRules ?? null,
            });
            res.status(201).json(room);
        } catch (err) {
            console.error('[POST /api/rooms]', err);
            res.status(500).json({ error: 'server_error' });
        }
    });

    app.get('/api/rooms/:code', async (req, res) => {
        try {
            const code = normalizeRoomCode(req.params.code);
            if (!isValidRoomCode(code)) {
                return res.status(400).json({ error: 'invalid_code' });
            }
            const room = await rooms.getRoom(code);
            if (!room) return res.status(404).json({ error: 'not_found' });
            if (room.status === 'ended') return res.status(410).json({ error: 'ended' });

            res.json({
                code: room.code,
                hostNickname: room.hostNickname,
                maxPlayers: room.maxPlayers,
                status: room.status,
                playerCount: room.playerCount,
                hasSlot: room.playerCount < room.maxPlayers,
            });
        } catch (err) {
            console.error('[GET /api/rooms/:code]', err);
            res.status(500).json({ error: 'server_error' });
        }
    });
}
