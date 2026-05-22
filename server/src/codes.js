import { randomInt } from 'node:crypto';

// 32 chars, sem 0/O e 1/I/L (evita confusão visual em código impresso/falado)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode() {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    return code;
}

export function normalizeRoomCode(raw) {
    return String(raw ?? '')
        .toUpperCase()
        .replace(/[^A-Z2-9]/g, '')
        .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(s) {
    if (typeof s !== 'string' || s.length !== ROOM_CODE_LENGTH) return false;
    for (const c of s) if (!ALPHABET.includes(c)) return false;
    return true;
}
