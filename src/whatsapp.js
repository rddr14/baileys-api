const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const fs = require('fs');
const axios = require('axios');

// Estrutura global para guardar múltiplas sessões
const sessions = {}; 
/*
sessions = {
    [sessionId]: {
        sock: Object,
        store: Object,
        qrCodeUrl: String | null,
        connectionStatus: String
    }
}
*/

const WEBHOOKS_FILE = __dirname + '/../webhooks.json';

function getWebhooks() {
    if (!fs.existsSync(WEBHOOKS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(WEBHOOKS_FILE)); } catch (e) { return {}; }
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

// Função auxiliar para disparar os Webhooks
async function sendWebhook(sessionId, event, data) {
    const url = getWebhook(sessionId);
    if (!url) return;
    try {
        await axios.post(url, { sessionId, event, data });
        console.log(`[${sessionId}] Webhook disparado com sucesso (${event}) para ${url}`);
        console.log(`Payload enviado:`, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`[${sessionId}] Falha ao enviar webhook para ${url}:`, e.message);
    }
}

// Função para carregar labels persistidos do disco
function getPersistedLabels(sessionId) {
    const file = `${__dirname}/../labels_${sessionId}.json`;
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}

function savePersistedLabels(sessionId, labels) {
    const file = `${__dirname}/../labels_${sessionId}.json`;
    fs.writeFileSync(file, JSON.stringify(labels, null, 2));
}

// Inicializa a store (memória local) para uma sessão específica
function createStore(sessionId) {
    const store = {
        chats: {},
        contacts: {},
        messages: {},
        labels: getPersistedLabels(sessionId), // Carrega labels do disco
        labelAssocs: {}, // Associações: { [jid]: [labelId, ...] }
        bind: (ev) => {
            ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest }) => {
                for (const chat of chats) { store.chats[chat.id] = chat; }
                for (const contact of contacts) { store.contacts[contact.id] = contact; }
                for (const msg of (messages || [])) {
                    const jid = msg.key.remoteJid;
                    if (!store.messages[jid]) store.messages[jid] = [];
                    store.messages[jid].push(msg);
                }
            });

            ev.on('messages.upsert', async (m) => {
                sendWebhook(sessionId, 'messages.upsert', m);
                for (const msg of m.messages) {
                    const jid = msg.key.remoteJid;
                    if (!store.messages[jid]) store.messages[jid] = [];
                    store.messages[jid].push(msg);
                    
                    if (store.messages[jid].length > 100) {
                        store.messages[jid].splice(0, store.messages[jid].length - 100);
                    }

                    // Se a mensagem contiver o pushName do contato, salva no cache de contatos
                    if (msg.pushName && jid && !jid.endsWith('@g.us')) {
                        if (!store.contacts[jid]) store.contacts[jid] = { id: jid };
                        store.contacts[jid].name = msg.pushName;
                        store.contacts[jid].notify = msg.pushName;
                        const num = jid.split('@')[0];
                        if (num) {
                            if (!store.contacts[num]) store.contacts[num] = { id: jid };
                            store.contacts[num].name = msg.pushName;
                            store.contacts[num].notify = msg.pushName;
                        }
                    }
                }
            });

            ev.on('messages.update', (m) => {
                sendWebhook(sessionId, 'messages.update', m);
                for (const update of m) {
                    const jid = update.key.remoteJid;
                    if (store.messages[jid]) {
                        const index = store.messages[jid].findIndex(msg => msg.key.id === update.key.id);
                        if (index !== -1) {
                            Object.assign(store.messages[jid][index], update.update);
                        }
                    }
                }
            });

            ev.on('message-receipt.update', (m) => {
                sendWebhook(sessionId, 'message-receipt.update', m);
            });

            // Captura labels e suas associações (WhatsApp Business)
            ev.on('labels.edit', (label) => {
                if (label.deleted) {
                    delete store.labels[label.id];
                } else {
                    store.labels[label.id] = label;
                }
                savePersistedLabels(sessionId, store.labels);
                console.log(`[${sessionId}] Label atualizado:`, label.name);
            });

            ev.on('labels.association', ({ type, association }) => {
                const jid = association.chatId || association.messageId;
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
            });

            ev.on('chats.set', ({ chats }) => {
                for (const chat of (chats || [])) { store.chats[chat.id] = chat; }
            });

            ev.on('chats.upsert', newChats => {
                for (const chat of newChats) { store.chats[chat.id] = chat; }
            });

            ev.on('chats.update', updates => {
                for (const update of updates) {
                    if (store.chats[update.id]) {
                        Object.assign(store.chats[update.id], update);
                    }
                }
            });

            ev.on('contacts.set', ({ contacts }) => {
                for (const contact of (contacts || [])) {
                    store.contacts[contact.id] = contact;
                    const num = contact.id ? contact.id.split('@')[0] : null;
                    if (num) store.contacts[num] = contact;
                }
            });

            ev.on('contacts.upsert', newContacts => {
                for (const contact of newContacts) {
                    store.contacts[contact.id] = contact;
                    const num = contact.id ? contact.id.split('@')[0] : null;
                    if (num) store.contacts[num] = contact;
                }
            });

            ev.on('contacts.update', updates => {
                for (const update of updates) {
                    if (store.contacts[update.id]) {
                        Object.assign(store.contacts[update.id], update);
                    }
                    const num = update.id ? update.id.split('@')[0] : null;
                    if (num && store.contacts[num]) {
                        Object.assign(store.contacts[num], update);
                    }
                }
            });
        }
    };
    return store;
}

// Inicializa a conexão de uma sessão
async function connectToWhatsApp(sessionId) {
    if (!sessionId) throw new Error('Session ID é obrigatório');
    
    // Se a sessão já estiver ativa na RAM, retorna ela
    if (sessions[sessionId] && sessions[sessionId].connectionStatus === 'connected') {
        return sessions[sessionId].sock;
    }

    // Inicializa estado padrão
    sessions[sessionId] = {
        sock: null,
        store: createStore(sessionId),
        qrCodeUrl: null,
        connectionStatus: 'connecting'
    };

    const { state, saveCreds } = await useMultiFileAuthState(`auth_info_baileys_${sessionId}`);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`[${sessionId}] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        syncFullHistory: true,
        browser: ['Baileys API (Ubuntu)', 'Chrome', '10.0']
    });

    sessions[sessionId].sock = sock;
    sessions[sessionId].store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (connection || qr) {
            sendWebhook(sessionId, 'connection.update', update);
        }
        
        if (qr) {
            sessions[sessionId].qrCodeUrl = await QRCode.toDataURL(qr);
            sessions[sessionId].connectionStatus = 'qr_ready';
            console.log(`[${sessionId}] QR Code gerado, aguardando scan...`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[${sessionId}] Conexão fechada. Reconectar:`, shouldReconnect);
            
            if (shouldReconnect) {
                sessions[sessionId].connectionStatus = 'reconnecting';
                setTimeout(() => connectToWhatsApp(sessionId), 3000);
            } else {
                console.log(`[${sessionId}] Dispositivo deslogado pelo WhatsApp (ou sessão expirou). Limpando credenciais automaticamente...`);
                // Precisamos chamar a função que deleta a pasta
                resetSession(sessionId).catch(err => console.error('Erro ao limpar sessão:', err));
            }
        } else if (connection === 'open') {
            console.log(`[${sessionId}] Conexão estabelecida com sucesso!`);
            sessions[sessionId].connectionStatus = 'connected';
            sessions[sessionId].qrCodeUrl = null;
        }
    });

    return sock;
}

// Métodos Getters
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

function getAllSessions() {
    const list = [];
    const webhooks = getWebhooks();
    
    // Lista das pastas no disco também para cobrir sessões não conectadas no momento
    const dirFolders = fs.readdirSync(__dirname + '/..');
    const knownSessions = new Set(Object.keys(sessions));
    for (const folder of dirFolders) {
        if (folder.startsWith('auth_info_baileys_')) {
            knownSessions.add(folder.replace('auth_info_baileys_', ''));
        }
    }

    for (const id of knownSessions) {
        const sess = sessions[id];
        const creds = sess?.sock?.authState?.creds;
        const me = creds?.me;
        
        list.push({
            sessionId: id,
            status: sess ? sess.connectionStatus : 'offline',
            name: me?.name || null,
            phone: me?.id ? me.id.split(':')[0].split('@')[0] : null,
            platform: creds?.platform || null,
            webhookUrl: webhooks[id] || null
        });
    }
    return list;
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
    await logout(sessionId);
    
    const folderPath = `auth_info_baileys_${sessionId}`;
    if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
    }
    
    delete sessions[sessionId];
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
    getAllSessions,
    getWebhook,
    setWebhook,
    deleteWebhook
};
