-- Esquema inicial — Esferas da Taísa RA (multiplayer)
-- Aplicar uma vez no banco MySQL provisionado pelo CloudPanel.
--
--   mysql -u silvia -p silvia < sql/001_init.sql

CREATE TABLE IF NOT EXISTS rooms (
    code           CHAR(6)        NOT NULL PRIMARY KEY,
    host_nickname  VARCHAR(32)    NOT NULL,
    max_players    TINYINT UNSIGNED NOT NULL DEFAULT 8,
    status         ENUM('waiting', 'playing', 'ended') NOT NULL DEFAULT 'waiting',
    scoring_rules  JSON           NULL,
    created_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at       TIMESTAMP      NULL,
    INDEX idx_status (status),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS players (
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
