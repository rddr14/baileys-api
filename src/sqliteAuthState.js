const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');

const PREFIX = 'auth_info_baileys_';
const DEFAULT_BASE_DIR = path.join(__dirname, '..');

const fixKey = (name) => name?.replace(/\//g, '__')?.replace(/:/g, '-');

/**
 * Abre e configura o banco SQLite de uma sessão em modo WAL.
 */
function openSessionDatabase(sessionId, baseDir = DEFAULT_BASE_DIR) {
    const dbPath = path.join(baseDir, `${PREFIX}${sessionId}.db`);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('temp_store = MEMORY');
    db.pragma('cache_size = -4000');

    db.exec(`
        CREATE TABLE IF NOT EXISTS auth_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS session_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    return { db, dbPath };
}

/**
 * Migra arquivos JSON da pasta legada auth_info_baileys_<sessionId> para o SQLite.
 * Só remove a pasta legada após validar a gravação de creds.json (quando presente).
 */
function migrateLegacyAuthFolder(sessionId, db, baseDir = DEFAULT_BASE_DIR) {
    const legacyDir = path.join(baseDir, `${PREFIX}${sessionId}`);
    if (!fs.existsSync(legacyDir)) {
        return false;
    }

    let stat;
    try {
        stat = fs.statSync(legacyDir);
    } catch (_) {
        return false;
    }

    if (!stat.isDirectory()) {
        return false;
    }

    const entries = fs.readdirSync(legacyDir).filter((file) => file.endsWith('.json'));
    const hasLegacyCreds = entries.includes('creds.json');
    const upsertStmt = db.prepare('INSERT OR REPLACE INTO auth_state (key, value) VALUES (?, ?)');

    const validItems = [];
    for (const filename of entries) {
        const filePath = path.join(legacyDir, filename);
        const raw = fs.readFileSync(filePath, 'utf8');
        try {
            JSON.parse(raw);
            validItems.push([fixKey(filename), raw]);
        } catch (err) {
            if (filename === 'creds.json') {
                throw new Error(`[${sessionId}] Falha ao validar creds.json legado durante migração: ${err.message}`);
            }
            console.warn(`[${sessionId}] Ignorando arquivo JSON inválido na migração (${filename}): ${err.message}`);
        }
    }

    const runMigration = db.transaction((items) => {
        for (const [key, value] of items) {
            upsertStmt.run(key, value);
        }
    });

    runMigration(validItems);

    if (hasLegacyCreds) {
        const row = db.prepare('SELECT value FROM auth_state WHERE key = ?').get('creds.json');
        if (!row || !row.value) {
            throw new Error(`[${sessionId}] Verificação pós-migração falhou: creds.json não encontrado no SQLite.`);
        }
        try {
            JSON.parse(row.value, BufferJSON.reviver);
        } catch (err) {
            throw new Error(`[${sessionId}] Verificação pós-migração falhou: creds.json inválido no SQLite (${err.message}).`);
        }
    }

    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.rmSync(legacyDir, { recursive: true, force: true });
    console.log(`[${sessionId}] Migração concluída: ${validItems.length} registros movidos para SQLite e pasta legada removida.`);
    return true;
}

/**
 * Seleciona os 200 chats mais ativos e até 50 mensagens mais recentes por chat para snapshot leve.
 */
function buildTrimmedMessagesSnapshot(messagesObj, maxChats = 200, maxMessagesPerChat = 50) {
    const chatEntries = Object.entries(messagesObj || {})
        .filter(([, list]) => Array.isArray(list) && list.length > 0)
        .map(([jid, list]) => {
            const trimmed = list.slice(-maxMessagesPerChat);
            const lastMsg = trimmed[trimmed.length - 1];
            const ts = Number(lastMsg?.messageTimestamp) || 0;
            return { jid, trimmed, ts };
        });

    chatEntries.sort((a, b) => b.ts - a.ts);

    const result = {};
    for (const entry of chatEntries.slice(0, maxChats)) {
        result[entry.jid] = entry.trimmed;
    }
    return result;
}

/**
 * Inicializa AuthState + persistência leve de store em SQLite para uma sessão Baileys.
 */
async function useSQLiteAuthState(sessionId, baseDir = DEFAULT_BASE_DIR) {
    const { db, dbPath } = openSessionDatabase(sessionId, baseDir);

    migrateLegacyAuthFolder(sessionId, db, baseDir);

    const selectAuthStmt = db.prepare('SELECT value FROM auth_state WHERE key = ?');
    const upsertAuthStmt = db.prepare('INSERT OR REPLACE INTO auth_state (key, value) VALUES (?, ?)');
    const deleteAuthStmt = db.prepare('DELETE FROM auth_state WHERE key = ?');

    const selectStoreStmt = db.prepare('SELECT value FROM session_store WHERE key = ?');
    const upsertStoreStmt = db.prepare('INSERT OR REPLACE INTO session_store (key, value) VALUES (?, ?)');

    const readData = (key) => {
        if (!db.open) return null;
        const row = selectAuthStmt.get(fixKey(key));
        if (!row) return null;
        try {
            return JSON.parse(row.value, BufferJSON.reviver);
        } catch (_) {
            return null;
        }
    };

    const writeData = (data, key) => {
        if (!db.open) return;
        upsertAuthStmt.run(fixKey(key), JSON.stringify(data, BufferJSON.replacer));
    };

    const creds = readData('creds.json') || initAuthCreds();

    const loadStoreSnapshot = () => {
        const snapshot = { chats: {}, contacts: {}, messages: {} };
        if (!db.open) return snapshot;

        for (const field of ['chats', 'contacts', 'messages']) {
            const row = selectStoreStmt.get(field);
            if (!row) continue;
            try {
                const parsed = JSON.parse(row.value, BufferJSON.reviver);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    snapshot[field] = parsed;
                }
            } catch (_) {}
        }
        return snapshot;
    };

    const saveStoreSnapshot = (store) => {
        if (!db.open || !store) return;

        const trimmedMessages = buildTrimmedMessagesSnapshot(store.messages, 200, 50);
        const payload = [
            ['chats', JSON.stringify(store.chats || {}, BufferJSON.replacer)],
            ['contacts', JSON.stringify(store.contacts || {}, BufferJSON.replacer)],
            ['messages', JSON.stringify(trimmedMessages, BufferJSON.replacer)]
        ];

        const saveTx = db.transaction((items) => {
            for (const [key, value] of items) {
                upsertStoreStmt.run(key, value);
            }
        });

        saveTx(payload);
    };

    const closeDb = () => {
        if (!db.open) return;
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (_) {}
        try {
            db.close();
        } catch (_) {}
    };

    return {
        dbPath,
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = readData(`${type}-${id}.json`);
                        if (type === 'app-state-sync-key' && value) {
                            value = proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    if (!db.open) return;
                    const entries = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            entries.push([fixKey(`${category}-${id}.json`), value]);
                        }
                    }

                    if (entries.length === 0) return;

                    const batchTx = db.transaction((items) => {
                        for (const [keyName, value] of items) {
                            if (value) {
                                upsertAuthStmt.run(keyName, JSON.stringify(value, BufferJSON.replacer));
                            } else {
                                deleteAuthStmt.run(keyName);
                            }
                        }
                    });

                    batchTx(entries);
                }
            }
        },
        saveCreds: async () => {
            writeData(creds, 'creds.json');
        },
        loadStoreSnapshot,
        saveStoreSnapshot,
        closeDb
    };
}

/**
 * Lista todos os sessionIds salvos em disco (arquivos .db ou pastas legadas).
 */
function listSavedSessionIds(baseDir = DEFAULT_BASE_DIR) {
    if (!fs.existsSync(baseDir)) return [];

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const sessionIds = new Set();

    for (const entry of entries) {
        if (!entry.name.startsWith(PREFIX)) continue;

        if (entry.isDirectory()) {
            const id = entry.name.slice(PREFIX.length);
            if (id) sessionIds.add(id);
        } else if (entry.isFile() && entry.name.endsWith('.db')) {
            const id = entry.name.slice(PREFIX.length, -3);
            if (id) sessionIds.add(id);
        }
    }

    return Array.from(sessionIds);
}

/**
 * Remove o banco SQLite (.db, -wal, -shm) e eventual pasta legada de uma sessão.
 */
function deleteSQLiteSession(sessionId, baseDir = DEFAULT_BASE_DIR) {
    const dbBase = path.join(baseDir, `${PREFIX}${sessionId}.db`);
    for (const filePath of [dbBase, `${dbBase}-wal`, `${dbBase}-shm`]) {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, { force: true });
        }
    }

    const legacyDir = path.join(baseDir, `${PREFIX}${sessionId}`);
    if (fs.existsSync(legacyDir)) {
        fs.rmSync(legacyDir, { recursive: true, force: true });
    }
}

module.exports = {
    useSQLiteAuthState,
    listSavedSessionIds,
    deleteSQLiteSession
};
