const {
    default: makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    makeCacheableSignalKeyStore,
    isJidBroadcast,
    isJidNewsletter,
    ALL_WA_PATCH_NAMES
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { useSQLiteAuthState, deleteSQLiteSession, listSavedSessionIds } = require('./sqliteAuthState');

const BASE_DIR = path.join(__dirname, '..');
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;
const STORE_SAVE_DEBOUNCE_MS = 30000;
const MAX_MESSAGES_PER_CHAT = 50;

// Estrutura global para guardar múltiplas sessões
const sessions = {};

// Mapa em memória para aguardar confirmação de entrega (2 checks / status >= 3)
// Chave: `${sessionId}:${messageId}` -> Valor: callback de resolução
const pendingDeliveryAcks = new Map();
const deliveredMessageIds = new Set();

const WEBHOOKS_FILE = path.join(BASE_DIR, 'webhooks.json');
const SESSION_SETTINGS_FILE = path.join(BASE_DIR, 'session_settings.json');

function isIgnoredJid(jid) {
    if (!jid) return false;
    return isJidBroadcast(jid) || isJidNewsletter(jid) || jid === 'status@broadcast';
}

function getCachedGroup(sessionId, jid) {
    const cache = sessions[sessionId]?.groupCache;
    if (!cache || !jid) return undefined;
    const entry = cache.get(jid);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(jid);
        return undefined;
    }
    return entry.data;
}

function setCachedGroup(sessionId, group) {
    const cache = sessions[sessionId]?.groupCache;
    if (!cache || !group?.id) return;
    cache.set(group.id, {
        data: group,
        expiresAt: Date.now() + GROUP_CACHE_TTL_MS
    });
}

function markMessageDelivered(sessionId, messageId) {
    if (!messageId) return;
    const key = `${sessionId}:${messageId}`;
    deliveredMessageIds.add(key);
    setTimeout(() => deliveredMessageIds.delete(key), 120000); // Limpa cache após 2 min

    if (pendingDeliveryAcks.has(key)) {
        const resolveFn = pendingDeliveryAcks.get(key);
        pendingDeliveryAcks.delete(key);
        resolveFn(true);
    }
}

/**
 * Aguarda até que o WhatsApp confirme a entrega no aparelho (status >= 3 ou receipt)
 * Retorna true se entregue dentro do timeout, ou false se expirou (possível bloqueio silencioso)
 */
function waitForDeliveryAck(sessionId, messageId, timeoutMs = 12000) {
    const key = `${sessionId}:${messageId}`;
    if (deliveredMessageIds.has(key)) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (pendingDeliveryAcks.has(key)) {
                pendingDeliveryAcks.delete(key);
                resolve(false);
            }
        }, timeoutMs);

        pendingDeliveryAcks.set(key, (delivered) => {
            clearTimeout(timer);
            resolve(delivered);
        });
    });
}

function getWebhooks() {
    if (!fs.existsSync(WEBHOOKS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf8')); } catch (e) { return {}; }
}

function saveWebhooks(data) {
    fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(data, null, 2));
}

function getWebhook(sessionId) {
    return getWebhooks()[sessionId] || null;
}

function setWebhook(sessionId, url) {
    const data = getWebhooks();
    data[sessionId] = url;
    saveWebhooks(data);
}

function deleteWebhook(sessionId) {
    const data = getWebhooks();
    if (data[sessionId]) {
        delete data[sessionId];
        saveWebhooks(data);
    }
}

function getSessionSettings() {
    if (!fs.existsSync(SESSION_SETTINGS_FILE)) return {};
    try {
        const settings = JSON.parse(fs.readFileSync(SESSION_SETTINGS_FILE, 'utf8'));
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            return {};
        }
        return settings;
    } catch (e) {
        return {};
    }
}

function getOnlineStatus(sessionId) {
    return getSessionSettings()[sessionId]?.showOnline === true;
}

async function setOnlineStatus(sessionId, showOnline) {
    const settings = getSessionSettings();
    settings[sessionId] = { ...settings[sessionId], showOnline };
    fs.writeFileSync(SESSION_SETTINGS_FILE, JSON.stringify(settings, null, 2));

    const session = sessions[sessionId];
    if (session?.connectionStatus === 'connected' && session.sock) {
        try {
            await session.sock.sendPresenceUpdate(showOnline ? 'available' : 'unavailable');
        } catch (error) {
            throw new Error(`Preferência salva, mas falhou ao atualizar a presença atual: ${error.message}`);
        }
    }
}

// Configurações de proteção para envio de botões (Pix / 2FA)
function getButtonSettings(sessionId) {
    const sessConfig = getSessionSettings()[sessionId] || {};
    return {
        mode: sessConfig.buttonMode || process.env.BUTTONS_MODE || 'smart_fallback', // 'smart_fallback' | 'dual' | 'text_only' | 'button_only'
        fallbackTimeoutMs: Number(sessConfig.fallbackTimeoutMs) || Number(process.env.BUTTONS_FALLBACK_TIMEOUT_MS) || 12000
    };
}

function setButtonSettings(sessionId, { mode, fallbackTimeoutMs }) {
    const validModes = ['smart_fallback', 'dual', 'text_only', 'button_only'];
    const cleanMode = validModes.includes(mode) ? mode : 'smart_fallback';
    const cleanTimeout = Math.max(3000, Math.min(60000, Number(fallbackTimeoutMs) || 12000));

    const settings = getSessionSettings();
    settings[sessionId] = {
        ...settings[sessionId],
        buttonMode: cleanMode,
        fallbackTimeoutMs: cleanTimeout
    };
    fs.writeFileSync(SESSION_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return getButtonSettings(sessionId);
}

// Função auxiliar para disparar os Webhooks com timeout e retry automático
async function sendWebhook(sessionId, event, data) {
    const url = getWebhook(sessionId);
    if (!url) return;

    const retryDelays = [1500, 3000];
    const maxAttempts = retryDelays.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await axios.post(url, { sessionId, event, data }, { timeout: 10000 });
            console.log(`[${sessionId}] Webhook disparado com sucesso (${event}) para ${url}`);
            return;
        } catch (e) {
            const status = e.response?.status;
            const isRetryable = !e.response || status >= 500;
            if (attempt < maxAttempts && isRetryable) {
                const delayMs = retryDelays[attempt - 1];
                console.warn(`[${sessionId}] Falha ao enviar webhook (${event}) tentativa ${attempt}/${maxAttempts} para ${url}: ${e.message}. Tentando novamente em ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
                console.error(`[${sessionId}] Falha ao enviar webhook para ${url}:`, e.message);
                return;
            }
        }
    }
}

// Função para carregar labels persistidos do disco
function getPersistedLabels(sessionId) {
    const file = path.join(BASE_DIR, `labels_${sessionId}.json`);
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function savePersistedLabels(sessionId, labels) {
    const file = path.join(BASE_DIR, `labels_${sessionId}.json`);
    fs.writeFileSync(file, JSON.stringify(labels, null, 2));
}

function pushMessageWithLimit(store, msg) {
    const jid = msg?.key?.remoteJid;
    if (!jid || isIgnoredJid(jid)) return false;

    if (!store.messages[jid]) store.messages[jid] = [];
    const list = store.messages[jid];
    const msgId = msg.key?.id;

    if (msgId) {
        const existingIndex = list.findIndex((item) => item.key?.id === msgId);
        if (existingIndex !== -1) {
            list[existingIndex] = msg;
            return true;
        }
    }

    list.push(msg);
    if (list.length > MAX_MESSAGES_PER_CHAT) {
        list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
    }
    return true;
}

function normalizeUserJid(jid) {
    if (!jid || typeof jid !== 'string') return null;
    const [user, server] = jid.split('@');
    if (!user || !server) return null;
    return `${user.split(':')[0]}@${server}`;
}

// Salva o pushName (nome público do WhatsApp) do remetente em store.contacts[].notify.
// Funciona para chats privados e grupos. NUNCA altera contact.name (nome da agenda).
function rememberPushName(store, msg) {
    const pushName = typeof msg?.pushName === 'string' ? msg.pushName.trim() : '';
    if (!pushName || msg?.key?.fromMe) return false;

    const remoteJid = msg.key?.remoteJid || '';
    if (!remoteJid || isIgnoredJid(remoteJid)) return false;

    const candidates = remoteJid.endsWith('@g.us')
        ? [msg.key?.participant, msg.key?.participantAlt]
        : [remoteJid, msg.key?.remoteJidAlt];

    const normalized = candidates.map(normalizeUserJid).filter(Boolean);
    const phoneJid = normalized.find((j) => j.endsWith('@s.whatsapp.net')) || null;
    const lidJid = normalized.find((j) => j.endsWith('@lid')) || null;
    if (!phoneJid && !lidJid) return false;

    let changed = false;
    const apply = (key, idJid) => {
        if (!store.contacts[key]) {
            store.contacts[key] = { id: idJid };
            changed = true;
        }
        const c = store.contacts[key];
        if (c.notify !== pushName) {
            c.notify = pushName;
            changed = true;
        }
        if (phoneJid && lidJid) {
            if (!c.lid) { c.lid = lidJid; changed = true; }
            if (!c.phoneNumber) { c.phoneNumber = phoneJid; changed = true; }
        }
    };

    if (phoneJid) {
        apply(phoneJid, phoneJid);
        const num = phoneJid.split('@')[0];
        if (num) apply(num, phoneJid);
    }
    if (lidJid) apply(lidJid, lidJid);

    return changed;
}

// Inicializa a store (memória local com snapshot leve em SQLite) para uma sessão específica
function createStore(sessionId, authDb) {
    const snapshot = authDb ? authDb.loadStoreSnapshot() : { chats: {}, contacts: {}, messages: {} };

    for (const jid of Object.keys(snapshot.messages || {})) {
        const list = snapshot.messages[jid];
        if (Array.isArray(list) && list.length > MAX_MESSAGES_PER_CHAT) {
            list.splice(0, list.length - MAX_MESSAGES_PER_CHAT);
        }
    }

    let dirty = false;
    let saveTimer = null;

    const store = {
        chats: snapshot.chats || {},
        contacts: snapshot.contacts || {},
        messages: snapshot.messages || {},
        labels: getPersistedLabels(sessionId),
        labelAssocs: {},
        flushSave: () => {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            if (!dirty || !authDb) return;
            dirty = false;
            try {
                authDb.saveStoreSnapshot(store);
            } catch (err) {
                console.error(`[${sessionId}] Falha ao persistir snapshot da store:`, err.message);
            }
        },
        scheduleStoreSave: () => {
            dirty = true;
            if (saveTimer || !authDb) return;
            saveTimer = setTimeout(() => {
                saveTimer = null;
                if (!dirty) return;
                dirty = false;
                try {
                    authDb.saveStoreSnapshot(store);
                } catch (err) {
                    console.error(`[${sessionId}] Falha ao persistir snapshot da store:`, err.message);
                }
            }, STORE_SAVE_DEBOUNCE_MS);
            if (typeof saveTimer.unref === 'function') {
                saveTimer.unref();
            }
        },
        bind: (ev) => {
            ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
                let changed = false;
                for (const chat of (chats || [])) {
                    if (chat?.id && !isIgnoredJid(chat.id)) {
                        store.chats[chat.id] = chat;
                        changed = true;
                    }
                }
                for (const contact of (contacts || [])) {
                    if (contact?.id && !isIgnoredJid(contact.id)) {
                        store.contacts[contact.id] = contact;
                        const num = contact.id.split('@')[0];
                        if (num) store.contacts[num] = contact;
                        changed = true;
                    }
                }
                for (const msg of (messages || [])) {
                    if (pushMessageWithLimit(store, msg)) {
                        changed = true;
                    }
                    if (rememberPushName(store, msg)) {
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('messages.upsert', async (m) => {
                sendWebhook(sessionId, 'messages.upsert', m);
                let changed = false;

                for (const msg of (m.messages || [])) {
                    const jid = msg.key?.remoteJid;
                    if (!jid || isIgnoredJid(jid)) continue;

                    if (pushMessageWithLimit(store, msg)) {
                        changed = true;
                    }

                    if (rememberPushName(store, msg)) {
                        changed = true;
                    }
                }

                if (changed) store.scheduleStoreSave();
            });

            ev.on('messages.update', (m) => {
                sendWebhook(sessionId, 'messages.update', m);
                let changed = false;
                for (const update of (m || [])) {
                    const jid = update.key?.remoteJid;
                    const msgId = update.key?.id;
                    const status = update.update?.status;

                    // Status 3 = DELIVERY_ACK (2 checks), 4 = READ, 5 = PLAYED
                    if (msgId && typeof status === 'number' && status >= 3) {
                        markMessageDelivered(sessionId, msgId);
                    }

                    if (jid && store.messages[jid]) {
                        const index = store.messages[jid].findIndex(msg => msg.key?.id === msgId);
                        if (index !== -1) {
                            Object.assign(store.messages[jid][index], update.update);
                            changed = true;
                        }
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('message-receipt.update', (m) => {
                sendWebhook(sessionId, 'message-receipt.update', m);
                for (const item of (m || [])) {
                    if (item?.key?.id) {
                        markMessageDelivered(sessionId, item.key.id);
                    }
                }
            });

            ev.on('labels.edit', (label) => {
                if (label.deleted) {
                    delete store.labels[label.id];
                } else {
                    store.labels[label.id] = label;
                }
                savePersistedLabels(sessionId, store.labels);
                sendWebhook(sessionId, 'labels.edit', label);
                console.log(`[${sessionId}] Label atualizado:`, label.name);
            });

            ev.on('labels.association', ({ type, association }) => {
                const jid = association?.chatId || association?.messageId;
                if (jid && association) {
                    if (type === 'add') {
                        if (!store.labelAssocs[jid]) store.labelAssocs[jid] = [];
                        if (!store.labelAssocs[jid].includes(association.labelId)) {
                            store.labelAssocs[jid].push(association.labelId);
                        }
                    } else {
                        if (store.labelAssocs[jid]) {
                            store.labelAssocs[jid] = store.labelAssocs[jid].filter(id => id !== association.labelId);
                        }
                    }
                    sendWebhook(sessionId, 'labels.association', {
                        type,
                        association,
                        chatId: jid,
                        labelId: association.labelId,
                        labelName: store.labels?.[association.labelId]?.name || ''
                    });
                }
            });

            ev.on('chats.set', ({ chats }) => {
                let changed = false;
                for (const chat of (chats || [])) {
                    if (chat?.id && !isIgnoredJid(chat.id)) {
                        store.chats[chat.id] = chat;
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('chats.upsert', (newChats) => {
                let changed = false;
                for (const chat of (newChats || [])) {
                    if (chat?.id && !isIgnoredJid(chat.id)) {
                        store.chats[chat.id] = chat;
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('chats.update', (updates) => {
                let changed = false;
                for (const update of (updates || [])) {
                    if (update?.id && store.chats[update.id]) {
                        Object.assign(store.chats[update.id], update);
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('contacts.set', ({ contacts }) => {
                let changed = false;
                for (const contact of (contacts || [])) {
                    if (contact?.id && !isIgnoredJid(contact.id)) {
                        store.contacts[contact.id] = contact;
                        const num = contact.id.split('@')[0];
                        if (num) store.contacts[num] = contact;
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('contacts.upsert', (newContacts) => {
                let changed = false;
                for (const contact of (newContacts || [])) {
                    if (contact?.id && !isIgnoredJid(contact.id)) {
                        store.contacts[contact.id] = contact;
                        const num = contact.id.split('@')[0];
                        if (num) store.contacts[num] = contact;
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('contacts.update', (updates) => {
                let changed = false;
                for (const update of (updates || [])) {
                    if (!update?.id || isIgnoredJid(update.id)) continue;
                    if (store.contacts[update.id]) {
                        Object.assign(store.contacts[update.id], update);
                        changed = true;
                    }
                    const num = update.id.split('@')[0];
                    if (num && store.contacts[num]) {
                        Object.assign(store.contacts[num], update);
                        changed = true;
                    }
                }
                if (changed) store.scheduleStoreSave();
            });

            ev.on('groups.upsert', (groups) => {
                for (const group of (groups || [])) {
                    setCachedGroup(sessionId, group);
                }
            });

            ev.on('groups.update', (updates) => {
                for (const update of (updates || [])) {
                    if (!update?.id) continue;
                    const cached = getCachedGroup(sessionId, update.id);
                    if (cached) {
                        setCachedGroup(sessionId, { ...cached, ...update });
                    }
                }
            });
        }
    };

    // Backfill: extrai pushNames das mensagens já persistidas (inclusive grupos)
    let backfilled = 0;
    for (const list of Object.values(store.messages || {})) {
        if (!Array.isArray(list)) continue;
        for (const msg of list) {
            if (rememberPushName(store, msg)) backfilled++;
        }
    }
    if (backfilled > 0) {
        console.log(`[${sessionId}] Backfill de pushName: ${backfilled} contato(s) atualizados a partir do histórico.`);
        store.scheduleStoreSave();
    }

    return store;
}

// Inicializa a conexão de uma sessão
async function connectToWhatsApp(sessionId) {
    if (!sessionId) throw new Error('Session ID é obrigatório');

    const existing = sessions[sessionId];
    if (existing?.connectionStatus === 'connected') {
        return existing.sock;
    }
    if (existing?.isConnecting) {
        return existing.sock;
    }

    if (existing?.reconnectTimer) {
        clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
    }

    sessions[sessionId] = {
        sock: null,
        store: existing?.store || null,
        authDb: existing?.authDb || null,
        groupCache: existing?.groupCache || new Map(),
        qrCodeUrl: null,
        connectionStatus: 'connecting',
        isConnecting: true,
        reconnectTimer: null
    };

    try {
        if (existing?.store?.flushSave) {
            existing.store.flushSave();
        }
        if (existing?.sock) {
            try { existing.sock.ev?.removeAllListeners(); } catch (_) {}
            try { existing.sock.ws?.close(); } catch (_) {}
        }
        if (existing?.authDb?.closeDb) {
            existing.authDb.closeDb();
        }

        const authDb = await useSQLiteAuthState(sessionId, BASE_DIR);
        const { state, saveCreds } = authDb;
        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`[${sessionId}] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const store = createStore(sessionId, authDb);
        sessions[sessionId].authDb = authDb;
        sessions[sessionId].store = store;

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 350,
            maxMsgRetryCount: 4,
            browser: ['Baileys API (Ubuntu)', 'Chrome', '10.0'],
            shouldIgnoreJid: (jid) => isIgnoredJid(jid),
            cachedGroupMetadata: async (jid) => getCachedGroup(sessionId, jid),
            getMessage: async (key) => {
                const currentStore = sessions[sessionId]?.store;
                if (!currentStore || !key?.remoteJid || !key?.id) return undefined;
                const list = currentStore.messages[key.remoteJid];
                if (!list) return undefined;
                const found = list.find((m) => m.key?.id === key.id);
                return found?.message || undefined;
            }
        });

        sessions[sessionId].sock = sock;
        store.bind(sock.ev);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            const currentSession = sessions[sessionId];
            if (!currentSession) return;

            if (connection || qr) {
                sendWebhook(sessionId, 'connection.update', update);
            }

            if (qr) {
                currentSession.isConnecting = false;
                currentSession.qrCodeUrl = await QRCode.toDataURL(qr);
                currentSession.connectionStatus = 'qr_ready';
                console.log(`[${sessionId}] QR Code gerado, aguardando scan...`);
            }

            if (connection === 'close') {
                currentSession.isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`[${sessionId}] Conexão fechada. Reconectar:`, shouldReconnect);

                if (shouldReconnect) {
                    currentSession.connectionStatus = 'reconnecting';
                    if (!currentSession.reconnectTimer) {
                        currentSession.reconnectTimer = setTimeout(() => {
                            if (sessions[sessionId]) {
                                sessions[sessionId].reconnectTimer = null;
                            }
                            connectToWhatsApp(sessionId).catch((err) => {
                                console.error(`[${sessionId}] Falha na reconexão automática:`, err.message);
                            });
                        }, 3000);
                    }
                } else {
                    console.log(`[${sessionId}] Dispositivo deslogado pelo WhatsApp. Limpando credenciais...`);
                    resetSession(sessionId).catch(err => console.error('Erro ao limpar sessão:', err));
                }
            } else if (connection === 'open') {
                currentSession.isConnecting = false;
                console.log(`[${sessionId}] Conexão estabelecida com sucesso!`);
                currentSession.connectionStatus = 'connected';
                currentSession.qrCodeUrl = null;
                if (getOnlineStatus(sessionId)) {
                    try {
                        await sock.sendPresenceUpdate('available');
                    } catch (error) {
                        console.error(`[${sessionId}] Falha ao aplicar status online configurado:`, error.message);
                    }
                }
            }
        });

        return sock;
    } catch (error) {
        if (sessions[sessionId]) {
            sessions[sessionId].isConnecting = false;
            sessions[sessionId].connectionStatus = 'disconnected';
        }
        throw error;
    }
}

function getSocket(sessionId) {
    if (!sessions[sessionId] || !sessions[sessionId].sock) {
        throw new Error(`Sessão ${sessionId} não iniciada`);
    }
    return sessions[sessionId].sock;
}

function getStatus(sessionId) {
    if (!sessions[sessionId]) return 'not_found';
    return sessions[sessionId].connectionStatus;
}

function getQrCode(sessionId) {
    if (!sessions[sessionId]) return null;
    return sessions[sessionId].qrCodeUrl;
}

function getStore(sessionId) {
    if (!sessions[sessionId]) return null;
    return sessions[sessionId].store;
}

function getSavedSessionIds() {
    return listSavedSessionIds(BASE_DIR);
}

function getAllSessions() {
    const list = [];
    const webhooks = getWebhooks();

    const knownSessions = new Set([
        ...Object.keys(sessions),
        ...getSavedSessionIds()
    ]);

    for (const id of knownSessions) {
        const sess = sessions[id];
        const creds = sess?.sock?.authState?.creds;
        const me = creds?.me;
        const btnSettings = getButtonSettings(id);

        list.push({
            sessionId: id,
            status: sess ? sess.connectionStatus : 'offline',
            name: me?.name || null,
            phone: me?.id ? me.id.split(':')[0].split('@')[0] : null,
            platform: creds?.platform || null,
            webhookUrl: webhooks[id] || null,
            buttonMode: btnSettings.mode
        });
    }
    return list;
}

function unwrapBaileysMessageContent(message) {
    let current = message;
    for (let i = 0; i < 4 && current; i++) {
        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
        } else if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
        } else if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
        } else if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
        } else if (current.documentWithCaptionMessage?.message) {
            current = current.documentWithCaptionMessage.message;
        } else {
            break;
        }
    }
    return current || {};
}

function getPhoneVariants(phoneOrJid) {
    if (!phoneOrJid) return [];
    const raw = String(phoneOrJid);
    const clean = raw.replace(/@.*/g, '').replace(/\D/g, '');
    if (!clean) return [raw];
    const variants = new Set([clean]);
    if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
        const ddd = clean.slice(2, 4);
        const suffix = clean.slice(-8);
        variants.add(`55${ddd}9${suffix}`);
        variants.add(`55${ddd}${suffix}`);
    }
    return Array.from(variants);
}

function findChatMessagesByPhone(sessionId, phoneOrJid) {
    const store = getStore(sessionId);
    if (!store || !store.messages) return [];

    if (!phoneOrJid) {
        const all = [];
        for (const j in store.messages) {
            all.push(...(store.messages[j] || []));
        }
        return all;
    }

    const rawStr = String(phoneOrJid);
    const variants = new Set(getPhoneVariants(rawStr));
    const collected = [];
    const seenIds = new Set();

    const addIfMatch = (msg) => {
        const id = msg?.key?.id;
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);
        collected.push(msg);
    };

    for (const [jidKey, list] of Object.entries(store.messages)) {
        const jidClean = jidKey.replace(/@.*/g, '').replace(/\D/g, '');
        const keyMatches = jidKey === rawStr || (jidClean && variants.has(jidClean));

        for (const msg of (list || [])) {
            if (keyMatches) {
                addIfMatch(msg);
                continue;
            }
            const alt = msg?.key?.remoteJidAlt || '';
            const altClean = alt.replace(/@.*/g, '').replace(/\D/g, '');
            if (alt && (alt === rawStr || (altClean && variants.has(altClean)))) {
                addIfMatch(msg);
            }
        }
    }

    return collected;
}

function getMessageMetadata(sessionId, messageId) {
    const store = getStore(sessionId);
    if (!store || !store.messages || !messageId) {
        return { mimetype: null, fileName: null };
    }

    let targetMsg = null;
    for (const jid in store.messages) {
        targetMsg = (store.messages[jid] || []).find(m => m.key?.id === messageId);
        if (targetMsg) break;
    }

    if (!targetMsg || !targetMsg.message) {
        return { mimetype: null, fileName: null };
    }

    const content = unwrapBaileysMessageContent(targetMsg.message);
    if (content.imageMessage) {
        return {
            mimetype: content.imageMessage.mimetype || 'image/jpeg',
            fileName: null
        };
    }
    if (content.videoMessage) {
        return {
            mimetype: content.videoMessage.mimetype || 'video/mp4',
            fileName: null
        };
    }
    if (content.audioMessage) {
        return {
            mimetype: content.audioMessage.mimetype || 'audio/ogg',
            fileName: null
        };
    }
    if (content.documentMessage) {
        return {
            mimetype: content.documentMessage.mimetype || 'application/octet-stream',
            fileName: content.documentMessage.fileName || content.documentMessage.title || 'documento'
        };
    }
    if (content.stickerMessage) {
        return {
            mimetype: content.stickerMessage.mimetype || 'image/webp',
            fileName: 'sticker.webp'
        };
    }

    return { mimetype: null, fileName: null };
}

async function downloadMedia(sessionId, messageId) {
    if (!sessions[sessionId]) throw new Error(`Sessão ${sessionId} não encontrada.`);

    const store = sessions[sessionId].store;
    let msg = null;

    for (const jid in store.messages) {
        msg = store.messages[jid].find(m => m.key.id === messageId);
        if (msg) break;
    }

    if (!msg) throw new Error('Mensagem não encontrada na memória (pode ter expirado).');

    const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        { },
        { logger: pino({ level: 'silent' }), reuploadRequest: sessions[sessionId].sock.updateMediaMessage }
    );
    return buffer;
}

async function logout(sessionId) {
    if (sessions[sessionId] && sessions[sessionId].sock) {
        await sessions[sessionId].sock.logout();
        sessions[sessionId].connectionStatus = 'disconnected';
    }
}

async function resetSession(sessionId) {
    const sess = sessions[sessionId];
    if (sess?.reconnectTimer) {
        clearTimeout(sess.reconnectTimer);
        sess.reconnectTimer = null;
    }
    if (sess?.store?.flushSave) {
        sess.store.flushSave();
    }

    try {
        await logout(sessionId);
    } catch (_) {}

    if (sess?.sock) {
        try { sess.sock.ev?.removeAllListeners(); } catch (_) {}
        try { sess.sock.ws?.close(); } catch (_) {}
    }
    if (sess?.authDb?.closeDb) {
        sess.authDb.closeDb();
    }

    deleteSQLiteSession(sessionId, BASE_DIR);
    delete sessions[sessionId];
}

let isShuttingDown = false;
function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Recebido ${signal}. Salvando stores e fechando bancos SQLite...`);
    for (const [id, sess] of Object.entries(sessions)) {
        try {
            if (sess.reconnectTimer) {
                clearTimeout(sess.reconnectTimer);
                sess.reconnectTimer = null;
            }
            if (sess.store?.flushSave) {
                sess.store.flushSave();
            }
            if (sess.authDb?.closeDb) {
                sess.authDb.closeDb();
            }
        } catch (err) {
            console.error(`[${id}] Erro ao fechar sessão no shutdown:`, err.message);
        }
    }
    process.exit(0);
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function resyncSessionContacts(sessionId) {
    const sock = getSocket(sessionId);
    if (sock && typeof sock.resyncAppState === 'function') {
        await sock.resyncAppState(ALL_WA_PATCH_NAMES, false);
        return { success: true, message: 'Ressincronização de AppState/contatos disparada.' };
    }
    return { success: false, message: 'Socket não suporta resyncAppState.' };
}

function updateContact(sessionId, { number, name, pushName }) {
    const store = getStore(sessionId);
    const cleanNumber = String(number).replace(/[^0-9]/g, '');
    const jid = number.includes('@') ? number : `${cleanNumber}@s.whatsapp.net`;

    if (!store.contacts[jid]) {
        store.contacts[jid] = { id: jid };
    }
    if (name !== undefined) store.contacts[jid].name = name;
    if (pushName !== undefined) store.contacts[jid].notify = pushName;

    if (cleanNumber) {
        if (!store.contacts[cleanNumber]) store.contacts[cleanNumber] = { id: jid };
        if (name !== undefined) store.contacts[cleanNumber].name = name;
        if (pushName !== undefined) store.contacts[cleanNumber].notify = pushName;
    }

    if (store.chats[jid] && name) {
        store.chats[jid].name = name;
    }

    if (store.scheduleStoreSave) {
        store.scheduleStoreSave();
    }

    return store.contacts[jid];
}

function findGlobalPushName(phoneOrJid, excludeSessionId = null) {
    if (!phoneOrJid) return null;
    const cleanNumber = String(phoneOrJid).replace(/[^0-9]/g, '');
    if (!cleanNumber) return null;
    const jid = `${cleanNumber}@s.whatsapp.net`;
    const last8 = cleanNumber.length >= 8 ? cleanNumber.slice(-8) : cleanNumber;

    // 1. Verifica se alguma sessão conectada é do próprio dono deste número
    for (const [sessId, sess] of Object.entries(sessions)) {
        const creds = sess?.sock?.authState?.creds;
        const me = creds?.me;
        if (me?.name) {
            const mePhone = me.id ? me.id.split(':')[0].split('@')[0] : '';
            if (mePhone === cleanNumber || (mePhone.length >= 8 && cleanNumber.length >= 8 && mePhone.slice(-8) === last8)) {
                return me.name;
            }
        }
    }

    // 2. Procura nas outras sessões ativas (mensagens recebidas com pushName ou contatos)
    for (const [sessId, sess] of Object.entries(sessions)) {
        if (sessId === excludeSessionId) continue;
        const store = sess?.store;
        if (!store) continue;

        // Verifica mensagens recebidas deste número
        for (const targetKey of [jid, cleanNumber]) {
            const msgs = store.messages?.[targetKey];
            if (msgs && Array.isArray(msgs)) {
                for (let i = msgs.length - 1; i >= 0; i--) {
                    if (!msgs[i].key?.fromMe && msgs[i].pushName) {
                        return msgs[i].pushName;
                    }
                }
            }
        }

        // Verifica contatos das outras sessões
        for (const targetKey of [jid, cleanNumber]) {
            const c = store.contacts?.[targetKey];
            if (c?.notify && c.notify !== c.name) {
                return c.notify;
            }
            if (c?.name && c.name !== 'Você') {
                return c.name;
            }
        }
    }

    return null;
}

module.exports = {
    connectToWhatsApp,
    getSocket,
    getStatus,
    getQrCode,
    getStore,
    logout,
    resetSession,
    downloadMedia,
    findChatMessagesByPhone,
    getMessageMetadata,
    getAllSessions,
    getSavedSessionIds,
    getWebhook,
    setWebhook,
    deleteWebhook,
    getOnlineStatus,
    setOnlineStatus,
    getButtonSettings,
    setButtonSettings,
    waitForDeliveryAck,
    resyncSessionContacts,
    updateContact,
    findGlobalPushName
};
