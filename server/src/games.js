// Estado em memória de partidas ativas (uma por sala).
// Persistência (final score, histórico) entra na Fase 4 via MySQL.

const DEFAULT_SCORING = { normal: 10, fast: 20, rare: 50 };
const VALID_TYPES = new Set(['normal', 'fast', 'rare']);
const MIN_SPHERES = 3;
const MAX_SPHERES = 16;
const DEFAULT_DURATION_SEC = 60;

export function createGames() {
    /** @type {Map<string, GameState>} */
    const games = new Map();

    function ensure(code, scoringRules) {
        if (!games.has(code)) {
            games.set(code, {
                status: 'waiting',
                spheres: new Map(),
                scores: new Map(),
                sphereCounter: 0,
                playedAt: null,
                scoringRules: scoringRules || DEFAULT_SCORING,
            });
        }
        return games.get(code);
    }

    function get(code) {
        return games.get(code) || null;
    }

    function snapshot(code) {
        const g = games.get(code);
        if (!g) return null;
        return {
            status: g.status,
            spheres: Array.from(g.spheres.values()).filter(s => s.alive),
            scores: Object.fromEntries(g.scores),
            scoringRules: g.scoringRules,
        };
    }

    function start(code, scoringRules) {
        // Host pode reiniciar de qualquer estado (incluindo placing/playing).
        // Caller (sockets.js) é responsável por limpar o playTimer pendente.
        const g = ensure(code, scoringRules);
        g.spheres = new Map();
        g.scores = new Map();
        g.sphereCounter = 0;
        g.status = 'placing';
        return { ok: true, status: g.status, scoringRules: g.scoringRules };
    }

    function placeSphere(code, byNick, { type, x, y, z }) {
        const g = games.get(code);
        if (!g) return { ok: false, error: 'no_game' };
        if (g.status !== 'placing') return { ok: false, error: 'invalid_state' };
        if (!VALID_TYPES.has(type)) return { ok: false, error: 'invalid_type' };
        if (g.spheres.size >= MAX_SPHERES) return { ok: false, error: 'max_spheres' };

        const id = 's' + (++g.sphereCounter);
        const sphere = {
            id,
            type,
            x: Number(x) || 0,
            y: Number(y) || 0,
            z: Number(z) || 0,
            alive: true,
            placedBy: byNick,
        };
        g.spheres.set(id, sphere);
        return { ok: true, sphere };
    }

    function clearSpheres(code) {
        const g = games.get(code);
        if (!g) return { ok: false, error: 'no_game' };
        if (g.status !== 'placing') return { ok: false, error: 'invalid_state' };
        g.spheres = new Map();
        return { ok: true };
    }

    function startPlay(code) {
        const g = games.get(code);
        if (!g) return { ok: false, error: 'no_game' };
        if (g.status !== 'placing') return { ok: false, error: 'invalid_state' };
        if (g.spheres.size < MIN_SPHERES) {
            return { ok: false, error: 'not_enough_spheres', min: MIN_SPHERES };
        }
        g.status = 'playing';
        g.playedAt = Date.now();
        return { ok: true, status: g.status, durationSec: DEFAULT_DURATION_SEC };
    }

    function tryShoot(code, sphereId, byNick) {
        const g = games.get(code);
        if (!g) return { ok: false, error: 'no_game' };
        if (g.status !== 'playing') return { ok: false, error: 'invalid_state' };

        const sphere = g.spheres.get(sphereId);
        if (!sphere) return { ok: false, error: 'sphere_not_found' };
        if (!sphere.alive) return { ok: false, error: 'already_destroyed' };

        sphere.alive = false;

        const points = g.scoringRules[sphere.type] ?? 0;
        const s = g.scores.get(byNick) || { score: 0, hits: 0 };
        s.score += points;
        s.hits += 1;
        g.scores.set(byNick, s);

        let aliveCount = 0;
        for (const sp of g.spheres.values()) if (sp.alive) aliveCount++;

        return {
            ok: true,
            destroyed: { id: sphere.id, type: sphere.type, hitBy: byNick, points },
            totals: Object.fromEntries(g.scores),
            lastSphere: aliveCount === 0,
        };
    }

    function end(code, reason) {
        const g = games.get(code);
        if (!g) return { ok: false, error: 'no_game' };
        if (g.status === 'ended') return { ok: false, error: 'already_ended' };

        g.status = 'ended';
        const ranking = Array.from(g.scores.entries())
            .map(([nickname, s]) => ({ nickname, score: s.score, hits: s.hits }))
            .sort((a, b) => (b.score - a.score) || (b.hits - a.hits))
            .map((entry, i) => ({ ...entry, rank: i + 1 }));

        return { ok: true, ranking, reason };
    }

    function reset(code) {
        games.delete(code);
    }

    return {
        get, snapshot,
        start, placeSphere, clearSpheres, startPlay, tryShoot, end, reset,
    };
}
