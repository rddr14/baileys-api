const express = require('express');
const router = express.Router();
const whatsapp = require('./whatsapp');
const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

// Middleware para verificar conexão da sessão
function requireConnection(req, res, next) {
    const { instance } = req.params;
    if (!instance) {
        return res.status(400).json({ error: 'Instance/Session ID é obrigatório na URL.' });
    }
    try {
        const sock = whatsapp.getSocket(instance);
        if (whatsapp.getStatus(instance) !== 'connected') {
            return res.status(503).json({ error: `Instância ${instance} não está conectada ao WhatsApp.` });
        }
        next();
    } catch (e) {
        return res.status(404).json({ error: e.message });
    }
}

function formatJid(number) {
    if (!number) return null;
    const clean = String(number).replace(/@.*/g, '').replace(/[^0-9]/g, '');
    if (number.includes('@g.us')) return `${clean}@g.us`;
    return `${clean}@s.whatsapp.net`;
}

async function resolveJid(sock, number) {
    if (!number) return null;
    const str = String(number);
    if (str.includes('@g.us') || str.includes('@broadcast') || str.includes('@newsletter') || str.includes('@lid')) {
        return str;
    }
    const clean = str.replace(/@.*/g, '').replace(/[^0-9]/g, '');
    try {
        const [result] = await sock.onWhatsApp(clean);
        if (result && result.exists && result.jid) {
            return result.jid;
        }
    } catch (_) { }
    return `${clean}@s.whatsapp.net`;
}

// ==========================================
// 1. INSTÂNCIA & SESSÕES (Evolution Compat)
// ==========================================

// GET /instance/fetchInstances
router.get('/instance/fetchInstances', (req, res) => {
    try {
        const allSessions = whatsapp.getAllSessions();
        const instances = allSessions.map(s => {
            const state = s.status === 'connected' ? 'open' : (s.status === 'qr_ready' ? 'qrcode' : 'close');
            const ownerJid = s.phone ? `${s.phone}@s.whatsapp.net` : null;
            const btnSettings = whatsapp.getButtonSettings(s.sessionId);
            const alwaysOnline = whatsapp.getOnlineStatus(s.sessionId);
            return {
                name: s.sessionId,
                instanceName: s.sessionId,
                token: s.sessionId,
                connectionStatus: state,
                ownerJid,
                profileName: s.name,
                profilePicUrl: null,
                buttonMode: btnSettings.mode,
                alwaysOnline,
                instance: {
                    instanceName: s.sessionId,
                    owner: ownerJid,
                    profileName: s.name,
                    profilePictureUrl: null,
                    state: state,
                    status: state
                }
            };
        });
        res.json(instances);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /instance/create
router.post('/instance/create', async (req, res) => {
    try {
        const { instanceName, webhook, alwaysOnline, showOnline } = req.body;
        if (!instanceName) {
            return res.status(400).json({ error: 'instanceName é obrigatório.' });
        }
        const webhookUrl = typeof webhook === 'string' ? webhook : webhook?.url;
        if (webhookUrl) {
            whatsapp.setWebhook(instanceName, webhookUrl);
        }
        if (alwaysOnline !== undefined || showOnline !== undefined) {
            await whatsapp.setOnlineStatus(instanceName, Boolean(alwaysOnline ?? showOnline)).catch(() => { });
        }
        await whatsapp.connectToWhatsApp(instanceName);
        res.status(201).json({
            instance: {
                instanceName,
                status: 'created'
            },
            hash: {
                apikey: instanceName
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /instance/connect/:instance
router.get('/instance/connect/:instance', async (req, res) => {
    const { instance } = req.params;
    try {
        const status = whatsapp.getStatus(instance);
        if (status === 'not_found' || status === 'disconnected') {
            await whatsapp.connectToWhatsApp(instance);
        }
        const qrCodeBase64 = whatsapp.getQrCode(instance);
        const currentStatus = whatsapp.getStatus(instance);

        res.json({
            base64: qrCodeBase64,
            qrcode: qrCodeBase64,
            instance: {
                instanceName: instance,
                state: currentStatus === 'connected' ? 'open' : (qrCodeBase64 ? 'qrcode' : 'connecting')
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /instance/connectionState/:instance
router.get('/instance/connectionState/:instance', (req, res) => {
    const { instance } = req.params;
    const status = whatsapp.getStatus(instance);
    if (status === 'not_found') {
        return res.status(404).json({ error: 'Instance not found' });
    }
    const state = status === 'connected' ? 'open' : (status === 'qr_ready' ? 'qrcode' : 'close');
    res.json({
        instance: {
            instanceName: instance,
            state: state
        }
    });
});

// DELETE /instance/logout/:instance
router.delete('/instance/logout/:instance', async (req, res) => {
    const { instance } = req.params;
    try {
        await whatsapp.logout(instance);
        res.json({ status: 'SUCCESS', message: 'Desconectado com sucesso' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// DELETE /instance/delete/:instance
router.delete('/instance/delete/:instance', async (req, res) => {
    const { instance } = req.params;
    try {
        await whatsapp.resetSession(instance);
        res.json({ status: 'SUCCESS', message: 'Instância removida com sucesso' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// PUT /instance/update/:instance
router.put('/instance/update/:instance', async (req, res) => {
    try {
        const { instance } = req.params;
        const { alwaysOnline, showOnline, mode, protectionMode, fallbackTimeoutMs } = req.body || {};

        if (alwaysOnline !== undefined || showOnline !== undefined) {
            await whatsapp.setOnlineStatus(instance, Boolean(alwaysOnline ?? showOnline));
        }

        if (mode !== undefined || protectionMode !== undefined || fallbackTimeoutMs !== undefined) {
            whatsapp.setButtonSettings(instance, {
                mode: mode || protectionMode,
                fallbackTimeoutMs
            });
        }

        res.json({
            status: 'SUCCESS',
            message: 'Configurações atualizadas',
            alwaysOnline: whatsapp.getOnlineStatus(instance),
            buttonSettings: whatsapp.getButtonSettings(instance)
        });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// ==========================================
// 2. WEBHOOK CONFIG (Evolution Compat)
// ==========================================

// GET /webhook/find/:instance
router.get('/webhook/find/:instance', (req, res) => {
    const { instance } = req.params;
    const url = whatsapp.getWebhook(instance);
    res.json({
        enabled: !!url,
        url: url || '',
        webhook_by_events: false,
        webhook_base64: false,
        events: [
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE',
            'NEW_TOKEN'
        ],
        headers: {}
    });
});

// POST /webhook/set/:instance
router.post('/webhook/set/:instance', (req, res) => {
    const { instance } = req.params;
    const body = req.body || {};
    const webhookData = body.webhook || body;
    const url = webhookData.url;
    const enabled = webhookData.enabled !== undefined ? Boolean(webhookData.enabled) : Boolean(url);

    if (!enabled || !url) {
        whatsapp.deleteWebhook(instance);
    } else {
        whatsapp.setWebhook(instance, url);
    }

    res.json({
        status: 'SUCCESS',
        webhook: {
            enabled: Boolean(enabled && url),
            url: (enabled && url) ? url : '',
            webhook_by_events: Boolean(webhookData.webhook_by_events ?? webhookData.webhookByEvents ?? false),
            webhook_base64: Boolean(webhookData.base64 ?? webhookData.webhookBase64 ?? false),
            events: Array.isArray(webhookData.events) ? webhookData.events : [
                'CONNECTION_UPDATE',
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
                'SEND_MESSAGE',
                'NEW_TOKEN'
            ],
            headers: (webhookData.headers && typeof webhookData.headers === 'object') ? webhookData.headers : {}
        }
    });
});

// Helper para resolver mensagem citada (quoted) na store
function resolveQuotedOption(instance, jid, reqBody) {
    const { quoted, options: msgOpts, quotedId } = reqBody || {};
    const qKey = quoted?.key || msgOpts?.quoted?.key || (quotedId ? { id: quotedId } : null);
    if (!qKey || !qKey.id) return {};

    const store = whatsapp.getStore(instance);
    if (store && store.messages) {
        const chatMsgs = store.messages[jid] || [];
        const found = chatMsgs.find(m => m.key?.id === qKey.id);
        if (found) {
            return { quoted: found };
        }
        for (const list of Object.values(store.messages)) {
            const anyFound = (list || []).find(m => m.key?.id === qKey.id);
            if (anyFound) {
                return { quoted: anyFound };
            }
        }
    }

    return {
        quoted: {
            key: {
                remoteJid: qKey.remoteJid || jid,
                fromMe: Boolean(qKey.fromMe),
                id: qKey.id
            },
            message: quoted?.message || { conversation: '' }
        }
    };
}

// ==========================================
// 3. ENVIO DE MENSAGENS (Evolution Compat)
// ==========================================

// POST /message/sendText/:instance
router.post('/message/sendText/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, text, textMessage, message, options: msgOpts, delay, typingDelay } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const finalText = text ?? textMessage?.text ?? message ?? '';
        const delayMs = Number(delay ?? typingDelay ?? msgOpts?.delay ?? 0);

        if (delayMs > 0) {
            const safeDelay = Math.min(delayMs, 15000);
            await sock.sendPresenceUpdate('composing', jid).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, safeDelay));
            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
        }

        const options = resolveQuotedOption(instance, jid, req.body);
        const result = await sock.sendMessage(jid, { text: String(finalText) }, options);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendMedia/:instance
router.post('/message/sendMedia/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, mediatype, mimetype, caption, media, fileName, delay, options: msgOpts } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        let buffer;
        if (media.startsWith('http://') || media.startsWith('https://')) {
            const axios = require('axios');
            const resp = await axios.get(media, { responseType: 'arraybuffer' });
            buffer = Buffer.from(resp.data);
        } else {
            const base64Data = media.includes(';base64,') ? media.split(';base64,')[1] : media;
            buffer = Buffer.from(base64Data, 'base64');
        }

        const delayMs = Number(delay ?? msgOpts?.delay ?? 0);
        if (delayMs > 0) {
            const safeDelay = Math.min(delayMs, 15000);
            await sock.sendPresenceUpdate('composing', jid).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, safeDelay));
            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
        }

        const messagePayload = {};
        if (mediatype === 'image') {
            messagePayload.image = buffer;
            if (caption) messagePayload.caption = caption;
        } else if (mediatype === 'video') {
            messagePayload.video = buffer;
            if (caption) messagePayload.caption = caption;
        } else if (mediatype === 'audio') {
            messagePayload.audio = buffer;
            messagePayload.mimetype = mimetype || 'audio/ogg';
        } else {
            messagePayload.document = buffer;
            if (caption) messagePayload.caption = caption;
            if (fileName) messagePayload.fileName = fileName;
            if (mimetype) messagePayload.mimetype = mimetype;
        }

        const options = resolveQuotedOption(instance, jid, req.body);
        const result = await sock.sendMessage(jid, messagePayload, options);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendWhatsAppAudio/:instance
router.post('/message/sendWhatsAppAudio/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, audio, delay, options: msgOpts } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        let buffer;
        if (audio.startsWith('http://') || audio.startsWith('https://')) {
            const axios = require('axios');
            const resp = await axios.get(audio, { responseType: 'arraybuffer' });
            buffer = Buffer.from(resp.data);
        } else {
            const base64Data = audio.includes(';base64,') ? audio.split(';base64,')[1] : audio;
            buffer = Buffer.from(base64Data, 'base64');
        }

        const delayMs = Number(delay ?? msgOpts?.delay ?? 0);
        if (delayMs > 0) {
            const safeDelay = Math.min(delayMs, 15000);
            await sock.sendPresenceUpdate('recording', jid).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, safeDelay));
            await sock.sendPresenceUpdate('paused', jid).catch(() => { });
        }

        const options = resolveQuotedOption(instance, jid, req.body);
        const result = await sock.sendMessage(jid, {
            audio: buffer,
            mimetype: 'audio/mp4',
            ptt: true
        }, options);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendLocation/:instance
router.post('/message/sendLocation/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, latitude, longitude, name, address } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const result = await sock.sendMessage(jid, {
            location: {
                degreesLatitude: Number(latitude),
                degreesLongitude: Number(longitude),
                name: name || '',
                address: address || ''
            }
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendContact/:instance
router.post('/message/sendContact/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, contact } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const contactsList = Array.isArray(contact) ? contact : [contact];
        const vcards = contactsList.map(c => {
            const cleanPhone = (c.phoneNumber || c.wuid || '').replace(/[^0-9]/g, '');
            return `BEGIN:VCARD\nVERSION:3.0\nFN:${c.fullName || cleanPhone}\nTEL;type=CELL;type=VOICE;waid=${cleanPhone}:+${cleanPhone}\nEND:VCARD`;
        });

        const result = await sock.sendMessage(jid, {
            contacts: {
                displayName: contactsList[0]?.fullName || 'Contato',
                contacts: vcards.map(vcard => ({ vcard }))
            }
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendPoll/:instance
router.post('/message/sendPoll/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, name, values, selectableCount } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const result = await sock.sendMessage(jid, {
            poll: {
                name: name || 'Enquete',
                values: Array.isArray(values) ? values : [],
                selectableCount: Number(selectableCount) || 1
            }
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/reaction/:instance
router.post('/message/reaction/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { reaction, key } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = key?.remoteJid || formatJid(req.body.number);

        const result = await sock.sendMessage(jid, {
            react: {
                text: reaction,
                key: key
            }
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/forwardMessage/:instance & /message/forwardMessages/:instance
const handleForward = async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, message, messages } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const msgObj = message || (Array.isArray(messages) ? messages[0] : null);
        const messageId = msgObj?.key?.id;
        const fromJid = msgObj?.key?.remoteJid;

        const store = whatsapp.getStore(instance);
        let targetMsg = null;
        if (store) {
            for (const chatJid in store.messages) {
                targetMsg = store.messages[chatJid].find(m => m.key.id === messageId);
                if (targetMsg) break;
            }
        }

        if (targetMsg) {
            const forwardResult = await sock.sendMessage(jid, { forward: targetMsg });
            return res.json(forwardResult);
        } else {
            // Se não encontrou o buffer da mensagem na store, encaminha payload básico
            return res.status(404).json({ status: 'ERROR', message: 'Mensagem original não encontrada no cache para encaminhar.' });
        }
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
};
router.post('/message/forwardMessage/:instance', requireConnection, handleForward);
router.post('/message/forwardMessages/:instance', requireConnection, handleForward);

// ==========================================
// 4. CHAT E PRESENÇA (Evolution Compat)
// ==========================================

// POST /chat/whatsappNumbers/:instance
router.post('/chat/whatsappNumbers/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { numbers } = req.body;
        const sock = whatsapp.getSocket(instance);
        const store = whatsapp.getStore(instance);
        const list = Array.isArray(numbers) ? numbers : [numbers];

        const results = [];
        for (const num of list) {
            const clean = String(num).replace(/[^0-9]/g, '');
            const [check] = await sock.onWhatsApp(clean);
            if (check && check.exists) {
                const jid = check.jid;
                if (check.lid) {
                    whatsapp.globalDirectory.recordLidMapping(check.lid, jid);
                }

                let name = null;

                // 1. Tenta pegar da store de contatos
                const contact = store?.contacts?.[jid] || store?.contacts?.[clean];
                if (contact && (contact.name || contact.notify || contact.verifiedName)) {
                    name = contact.name || contact.notify || contact.verifiedName;
                }

                // 2. Tenta pegar da store de chats
                if (!name && store?.chats?.[jid]) {
                    name = store.chats[jid].name || store.chats[jid].pushName;
                }

                // 3. Tenta pegar do último pushName de mensagens recebidas (!fromMe)
                if (!name && store?.messages?.[jid]) {
                    const msgs = store.messages[jid];
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (!msgs[i].key?.fromMe && msgs[i].pushName) {
                            name = msgs[i].pushName;
                            break;
                        }
                    }
                }

                // 4. Busca pushName
                let pushName = contact?.notify || null;
                if (!pushName && store?.messages?.[jid]) {
                    const msgs = store.messages[jid];
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (!msgs[i].key?.fromMe && msgs[i].pushName) {
                            pushName = msgs[i].pushName;
                            break;
                        }
                    }
                }
                if (!pushName && store?.chats?.[jid]) {
                    pushName = store.chats[jid].pushName || null;
                }
                if (!pushName) {
                    pushName = whatsapp.findGlobalPushName(jid) || null;
                }

                const dir = whatsapp.globalDirectory.resolveIdentity(jid)
                    || whatsapp.globalDirectory.resolveIdentity(clean);

                results.push({
                    jid: jid,
                    exists: true,
                    number: clean,
                    name: name || dir?.name || pushName || null,
                    pushName: pushName || dir?.pushName || name || null,
                    pushname: pushName || dir?.pushName || name || null,
                    crmName: dir?.crmName || null,
                    lid: check.lid || contact?.lid || dir?.lid || null
                });
            } else {
                results.push({
                    jid: null,
                    exists: false,
                    number: clean,
                    name: null,
                    pushName: null,
                    pushname: null,
                    lid: null
                });
            }
        }
        res.json(results);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/sendPresence/:instance
router.post('/chat/sendPresence/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, presence, delay } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        await sock.sendPresenceUpdate(presence || 'composing', jid);
        if (delay && delay > 0) {
            setTimeout(async () => {
                try {
                    await sock.sendPresenceUpdate('paused', jid);
                } catch (_) { }
            }, delay);
        }
        res.json({ status: 'SUCCESS' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/markMessageAsRead/:instance
router.post('/chat/markMessageAsRead/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { readMessages } = req.body;
        const sock = whatsapp.getSocket(instance);

        if (Array.isArray(readMessages)) {
            const keys = readMessages.map(m => ({
                remoteJid: m.remoteJid,
                id: m.id,
                participant: m.participant || m.remoteJid
            }));
            await sock.readMessages(keys);
        }
        res.json({ status: 'SUCCESS' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/markChatUnread/:instance
router.post('/chat/markChatUnread/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { chat } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = formatJid(chat);

        await sock.chatModify({ markRead: false }, jid);
        res.json({ status: 'SUCCESS' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/findChats/:instance
router.post('/chat/findChats/:instance', requireConnection, (req, res) => {
    try {
        const { instance } = req.params;
        const store = whatsapp.getStore(instance);
        const chats = Object.values(store.chats || {}).map(c => {
            const jid = c.id;
            const msgs = store.messages?.[jid] || [];
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
            const cleanNum = jid ? jid.split('@')[0] : '';
            const contact = store.contacts?.[jid] || (cleanNum ? store.contacts?.[cleanNum] : null);
            const pushName = contact?.notify
                || (!lastMsg?.key?.fromMe ? lastMsg?.pushName : null)
                || whatsapp.findGlobalPushName(jid)
                || c.pushName
                || c.name
                || null;
            const name = contact?.name || c.name || pushName || null;

            return {
                remoteJid: jid,
                remoteJidAlt: lastMsg?.key?.remoteJidAlt || null,
                pushName,
                name,
                isSaved: Boolean(contact?.name),
                profilePicUrl: null,
                lastMessage: lastMsg ? {
                    key: lastMsg.key,
                    pushName: lastMsg.pushName,
                    messageTimestamp: lastMsg.messageTimestamp,
                    message: lastMsg.message
                } : null
            };
        });
        res.json(chats);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST ou GET /chat/findContacts/:instance (Busca de contatos por número ou nome)
const handleFindContacts = async (req, res) => {
    try {
        const { instance } = req.params;
        const store = whatsapp.getStore(instance);
        const sock = whatsapp.getSocket(instance);

        const body = req.body || {};
        const where = body.where || {};
        const query = (body.query || body.search || req.query.query || req.query.search || '').trim().toLowerCase();
        const filterName = (where.name || where.pushName || body.name || req.query.name || '').trim().toLowerCase();
        const filterNumber = (where.number || where.id || where.remoteJid || body.number || req.query.number || '').replace(/[^0-9]/g, '');

        // Mapeia lid -> jid real (@s.whatsapp.net) para evitar duplicatas @lid
        const lidToJid = new Map();
        const lidInfo = new Map();

        for (const c of Object.values(store.contacts || {})) {
            if (!c?.id || c.id.endsWith('@g.us')) continue;
            if (c.id.endsWith('@lid')) {
                lidInfo.set(c.id, c);
            } else if (c.lid) {
                lidToJid.set(c.lid, c.id);
            }
        }
        for (const ch of Object.values(store.chats || {})) {
            if (ch?.id && !ch.id.endsWith('@g.us') && !ch.id.endsWith('@lid') && ch.accountLid) {
                lidToJid.set(ch.accountLid, ch.id);
            }
        }

        const uniqueContactsMap = new Map();
        for (const c of Object.values(store.contacts || {})) {
            if (!c?.id || c.id.endsWith('@g.us')) continue;
            if (c.id.endsWith('@lid')) {
                // Se temos o JID real para esse @lid, apenas mesclamos mais abaixo
                continue;
            }

            const jid = c.id;
            const contactNumber = jid.split('@')[0] || '';
            const lidRecord = c.lid ? lidInfo.get(c.lid) : null;
            const dir = whatsapp.globalDirectory.resolveIdentity(jid);
            const contactName = c.name || lidRecord?.name || dir?.name || c.notify || lidRecord?.notify || c.verifiedName || null;
            let contactPushName = c.notify || lidRecord?.notify || dir?.pushName || null;
            if (!contactPushName) {
                contactPushName = whatsapp.findGlobalPushName(jid) || contactName || null;
            }

            if (!uniqueContactsMap.has(jid)) {
                uniqueContactsMap.set(jid, {
                    id: jid,
                    remoteJid: jid,
                    number: contactNumber,
                    pushName: contactPushName,
                    pushname: contactPushName,
                    name: contactName,
                    crmName: dir?.crmName || null,
                    verifiedName: c.verifiedName || dir?.verifiedName || null,
                    lid: c.lid || dir?.lid || null,
                    isMyContact: Boolean(c.name)
                });
            } else {
                const existing = uniqueContactsMap.get(jid);
                if (contactName && !existing.name) {
                    existing.name = contactName;
                }
                if (contactPushName && !existing.pushName) {
                    existing.pushName = contactPushName;
                    existing.pushname = contactPushName;
                }
                if (c.name) existing.isMyContact = true;
            }
        }

        for (const c of Object.values(store.chats || {})) {
            if (!c?.id || c.id.endsWith('@g.us') || c.id.endsWith('@lid')) continue;
            const jid = c.id;
            const contactNumber = jid.split('@')[0] || '';
            const dir = whatsapp.globalDirectory.resolveIdentity(jid);
            const chatName = c.name || dir?.name || null;
            const chatPushName = whatsapp.findGlobalPushName(jid) || dir?.pushName || chatName;
            if (!uniqueContactsMap.has(jid)) {
                uniqueContactsMap.set(jid, {
                    id: jid,
                    remoteJid: jid,
                    number: contactNumber,
                    pushName: chatPushName,
                    pushname: chatPushName,
                    name: chatName,
                    crmName: dir?.crmName || null,
                    verifiedName: dir?.verifiedName || null,
                    lid: c.accountLid || dir?.lid || null,
                    isMyContact: false
                });
            }
        }

        let contacts = Array.from(uniqueContactsMap.values());

        const matchPhone = (contactNum, searchNum) => {
            if (!contactNum || !searchNum) return false;
            const cClean = String(contactNum).replace(/[^0-9]/g, '');
            const sClean = String(searchNum).replace(/[^0-9]/g, '');
            if (!cClean || !sClean) return false;
            if (cClean === sClean) return true;
            if (cClean.includes(sClean)) return true;
            if (cClean.length >= 8 && sClean.length >= 8) {
                return cClean.slice(-8) === sClean.slice(-8);
            }
            return false;
        };

        if (filterNumber) {
            contacts = contacts.filter(c => matchPhone(c.number, filterNumber));
        }

        if (filterName) {
            contacts = contacts.filter(c =>
                (c.name && c.name.toLowerCase().includes(filterName)) ||
                (c.pushName && c.pushName.toLowerCase().includes(filterName)) ||
                (c.crmName && c.crmName.toLowerCase().includes(filterName))
            );
        }

        if (query) {
            contacts = contacts.filter(c =>
                matchPhone(c.number, query) ||
                (c.name && c.name.toLowerCase().includes(query)) ||
                (c.pushName && c.pushName.toLowerCase().includes(query)) ||
                (c.crmName && c.crmName.toLowerCase().includes(query))
            );
        }

        // Complementa com matches do diretório global (CRM + histórico unificado)
        if (filterNumber || filterName || query) {
            const existingJids = new Set(contacts.map(c => c.id));
            const dirMatches = [];
            if (filterNumber) {
                const resolved = whatsapp.globalDirectory.resolveIdentity(filterNumber);
                if (resolved) dirMatches.push(resolved);
            }
            const textTerm = filterName || query;
            if (textTerm) {
                const resolved = /^\d{8,}$/.test(textTerm)
                    ? whatsapp.globalDirectory.resolveIdentity(textTerm)
                    : null;
                if (resolved) dirMatches.push(resolved);
                dirMatches.push(...whatsapp.globalDirectory.searchIdentities(textTerm, 50));
            }

            for (const dir of dirMatches) {
                if (!dir?.jid || existingJids.has(dir.jid)) continue;
                existingJids.add(dir.jid);
                contacts.push({
                    id: dir.jid,
                    remoteJid: dir.jid,
                    number: dir.phone,
                    pushName: dir.pushName || dir.name || null,
                    pushname: dir.pushName || dir.name || null,
                    name: dir.name || dir.pushName || null,
                    crmName: dir.crmName || null,
                    verifiedName: dir.verifiedName || null,
                    lid: dir.lid || null,
                    isMyContact: Boolean(dir.addressbookName)
                });
            }
        }

        // Se buscou por um número específico (>=10 dígitos) e não estava na store, resolve online via onWhatsApp
        const targetPhoneLookup = filterNumber || (/^\d{10,}$/.test(query) ? query : '');
        if (contacts.length === 0 && targetPhoneLookup && targetPhoneLookup.length >= 10 && sock) {
            try {
                const [check] = await sock.onWhatsApp(targetPhoneLookup);
                if (check && check.exists && check.jid) {
                    if (check.lid) {
                        whatsapp.globalDirectory.recordLidMapping(check.lid, check.jid);
                    }
                    const dir = whatsapp.globalDirectory.resolveIdentity(check.jid);
                    const resolvedName = dir?.name || whatsapp.findGlobalPushName(check.jid) || null;
                    const resolvedPush = dir?.pushName || resolvedName;
                    contacts.push({
                        id: check.jid,
                        remoteJid: check.jid,
                        number: check.jid.split('@')[0],
                        pushName: resolvedPush,
                        pushname: resolvedPush,
                        name: resolvedName,
                        crmName: dir?.crmName || null,
                        verifiedName: dir?.verifiedName || null,
                        lid: check.lid || dir?.lid || null,
                        isMyContact: Boolean(dir?.addressbookName)
                    });
                }
            } catch (_) { }
        }

        res.json(contacts);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
};

router.post('/chat/findContacts/:instance', requireConnection, handleFindContacts);
router.get('/chat/findContacts/:instance', requireConnection, handleFindContacts);

// POST /chat/updateContact/:instance (Atualiza ou define o nome de um contato localmente)
router.post('/chat/updateContact/:instance', requireConnection, (req, res) => {
    try {
        const { instance } = req.params;
        const { number, name, pushName } = req.body;
        if (!number || (!name && !pushName)) {
            return res.status(400).json({ status: 'ERROR', message: 'Parâmetro number e name (ou pushName) são obrigatórios.' });
        }
        const updated = whatsapp.updateContact(instance, { number, name, pushName });
        res.json({ status: 'SUCCESS', contact: updated });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/syncContacts/:instance (Força ressincronização de contatos com o WhatsApp)
router.post('/chat/syncContacts/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const result = await whatsapp.resyncSessionContacts(instance);
        res.json({ status: 'SUCCESS', result });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/fetchHistoryOnDemand/:instance (Solicita histórico sob demanda para um chat/grupo)
router.post('/chat/fetchHistoryOnDemand/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { jid, remoteJid, count } = req.body || {};
        const targetJid = jid || remoteJid;
        if (!targetJid) {
            return res.status(400).json({ status: 'ERROR', message: 'Parâmetro jid é obrigatório.' });
        }
        const result = await whatsapp.fetchChatHistory(instance, { jid: targetJid, count });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/saveContactOnDevice/:instance (Salva/edita contato na agenda do aparelho WhatsApp)
router.post('/chat/saveContactOnDevice/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { phone, number, name } = req.body || {};
        const targetPhone = phone || number;
        if (!targetPhone || !name) {
            return res.status(400).json({ status: 'ERROR', message: 'Parâmetros phone e name são obrigatórios.' });
        }
        const result = await whatsapp.saveContactToWhatsApp(instance, { phone: targetPhone, name });
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/findMessages/:instance (Histórico com paginação)
router.post('/chat/findMessages/:instance', requireConnection, (req, res) => {
    try {
        const { instance } = req.params;
        const { where, options } = req.body || {};

        const remoteJid = where?.key?.remoteJid || where?.key?.remoteJidAlt || null;
        const limit = Number(options?.offset) || 20;

        let messagesList = whatsapp.findChatMessagesByPhone(instance, remoteJid);

        // Ordena por timestamp descendente
        messagesList.sort((a, b) => (Number(b.messageTimestamp || 0)) - (Number(a.messageTimestamp || 0)));

        const records = messagesList.slice(0, limit);
        res.json({
            messages: {
                records: records
            }
        });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /chat/getBase64FromMediaMessage/:instance
router.post('/chat/getBase64FromMediaMessage/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { message } = req.body;
        const messageId = message?.key?.id;

        if (!messageId) {
            return res.status(400).json({ error: 'message.key.id é obrigatório.' });
        }

        const buffer = await whatsapp.downloadMedia(instance, messageId);
        const meta = whatsapp.getMessageMetadata(instance, messageId);
        res.json({
            base64: buffer.toString('base64'),
            mimetype: meta.mimetype || 'application/octet-stream',
            fileName: meta.fileName || 'file'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /chat/fetchProfilePictureUrl/:instance
router.post('/chat/fetchProfilePictureUrl/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        try {
            const url = await sock.profilePictureUrl(jid, 'image');
            res.json({ profilePictureUrl: url });
        } catch (_) {
            res.json({ profilePictureUrl: null });
        }
    } catch (e) {
        res.status(500).json({ profilePictureUrl: null });
    }
});

// ==========================================
// 5. GRUPOS (Evolution Compat - fetchGroups, members, add)
// ==========================================

// GET /group/fetchAllGroups/:instance?getParticipants=false
router.get('/group/fetchAllGroups/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const sock = whatsapp.getSocket(instance);

        let groupsObj = {};
        try {
            groupsObj = await sock.groupFetchAllParticipating();
        } catch (fetchErr) {
            // Fallback para store se falhar chamada de rede
            const store = whatsapp.getStore(instance);
            const chatGroups = Object.values(store.chats || {}).filter(c => c.id && c.id.endsWith('@g.us'));
            for (const cg of chatGroups) {
                groupsObj[cg.id] = {
                    id: cg.id,
                    subject: cg.name || 'Sem Nome',
                    owner: null,
                    creation: null,
                    participants: []
                };
            }
        }

        const includeParticipants = req.query.getParticipants === 'true';
        const list = await Promise.all(Object.values(groupsObj).map(async (g) => {
            let participants;
            if (includeParticipants) {
                participants = await Promise.all(
                    (g.participants || []).map((p) => whatsapp.resolveParticipantIdentity(instance, p))
                );
            }
            return {
                id: g.id,
                subject: g.subject || 'Sem Nome',
                name: g.subject || 'Sem Nome',
                owner: g.owner || null,
                creation: g.creation || null,
                size: g.participants ? g.participants.length : (g.size || 0),
                participants
            };
        }));

        res.json(list);
    } catch (e) {
        console.error('Erro em fetchAllGroups:', e);
        res.status(500).json({ error: e.message });
    }
});

// GET /group/participants/:instance?groupJid=...
router.get('/group/participants/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        let groupJid = req.query.groupJid;
        if (!groupJid) {
            return res.status(400).json({ error: 'Parâmetro groupJid é obrigatório.' });
        }
        if (!groupJid.endsWith('@g.us')) {
            groupJid += '@g.us';
        }

        const sock = whatsapp.getSocket(instance);
        const metadata = await sock.groupMetadata(groupJid);

        const participants = await Promise.all(
            (metadata.participants || []).map((p) => whatsapp.resolveParticipantIdentity(instance, p))
        );

        res.json({ participants });
    } catch (e) {
        console.error('Erro em group/participants:', e);
        res.status(500).json({ error: e.message, participants: [] });
    }
});

// POST /group/updateParticipant/:instance (action: add, remove, promote, demote)
router.post('/group/updateParticipant/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        let { groupJid, action = 'add', participants } = req.body;
        if (!groupJid || !participants) {
            return res.status(400).json({ error: 'Faltando groupJid ou participants.' });
        }
        if (!groupJid.endsWith('@g.us')) {
            groupJid += '@g.us';
        }

        const sock = whatsapp.getSocket(instance);
        const formattedList = (Array.isArray(participants) ? participants : [participants]).map(p => {
            const clean = String(p).replace(/[^0-9]/g, '');
            return `${clean}@s.whatsapp.net`;
        });

        const result = await sock.groupParticipantsUpdate(groupJid, formattedList, action);
        res.json(result);
    } catch (e) {
        console.error('Erro em updateParticipant:', e);
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// ==========================================
// 6. LABELS / ETIQUETAS (Evolution Compat)
// ==========================================

// GET /label/findLabels/:instance
router.get('/label/findLabels/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const store = whatsapp.getStore(instance);
        let labels = Object.values(store.labels || {});

        if (labels.length === 0) {
            const sock = whatsapp.getSocket(instance);
            if (sock && typeof sock.resyncAppState === 'function') {
                try {
                    await sock.resyncAppState(['regular_high', 'regular_low', 'regular', 'critical_unblock_low', 'critical_block'], false);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    labels = Object.values(store.labels || {});
                } catch (_) { }
            }
        }

        res.json(labels);
    } catch (e) {
        res.status(500).json([]);
    }
});

// POST /label/handleLabel/:instance (action: add | remove)
router.post('/label/handleLabel/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, labelId, action = 'add' } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        if (action === 'remove') {
            await sock.removeChatLabel(jid, String(labelId));
        } else {
            await sock.addChatLabel(jid, String(labelId));
        }

        res.json({ status: 'SUCCESS' });
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});
// POST /message/sendButtons/:instance (Compatível com proteção de Pix e 2FA)
router.post('/message/sendButtons/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, title, description, body, footer, buttons, protectionMode, fallbackTimeoutMs } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = await resolveJid(sock, number);

        const btnConfig = whatsapp.getButtonSettings(instance);
        const activeMode = protectionMode || btnConfig.mode || 'smart_fallback';
        const activeTimeout = Number(fallbackTimeoutMs) || btnConfig.fallbackTimeoutMs || 12000;
        const mainText = body || description || '';

        const rawButtons = Array.isArray(buttons) ? buttons : [];

        if (activeMode === 'text_only') {
            const mainMsg = await sock.sendMessage(jid, {
                text: [title ? `*${title}*` : '', mainText, footer ? `_${footer}_` : ''].filter(Boolean).join('\n\n')
            });
            for (const b of rawButtons.filter(x => x.type === 'copy' && (x.code || x.copyCode))) {
                await new Promise(r => setTimeout(r, 400));
                await sock.sendMessage(jid, { text: String(b.code || b.copyCode).trim() });
            }
            return res.json(mainMsg);
        }

        const formattedButtons = rawButtons.map((btn, i) => {
            const bType = btn.type || 'quick_reply';
            if (bType === 'copy') {
                return {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || btn.displayText || 'Copiar Código',
                        id: btn.id || `copy_${i + 1}`,
                        copy_code: btn.code || btn.copyCode || btn.text
                    })
                };
            } else if (bType === 'url') {
                return {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || btn.displayText || 'Abrir Link',
                        url: btn.url,
                        merchant_url: btn.url
                    })
                };
            } else if (bType === 'call') {
                return {
                    name: 'cta_call',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || btn.displayText || 'Ligar',
                        phone_number: btn.phone || btn.phoneNumber
                    })
                };
            }
            return {
                name: 'quick_reply',
                buttonParamsJson: JSON.stringify({
                    display_text: btn.text || btn.displayText || `Opção ${i + 1}`,
                    id: btn.id || `btn_${i + 1}`
                })
            };
        });

        const msg = generateWAMessageFromContent(
            jid,
            {
                viewOnceMessage: {
                    message: {
                        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                        interactiveMessage: {
                            body: { text: mainText },
                            footer: footer ? { text: footer } : undefined,
                            header: title ? { title, hasMediaAttachment: false } : undefined,
                            nativeFlowMessage: { buttons: formattedButtons, messageParamsJson: '' }
                        }
                    }
                }
            },
            { userJid: sock.user.id }
        );

        await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: [{
                tag: 'biz',
                attrs: {},
                content: [{
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }]
            }]
        });

        if (activeMode === 'dual') {
            setTimeout(async () => {
                try {
                    for (const b of rawButtons.filter(x => x.type === 'copy' && (x.code || x.copyCode || x.text))) {
                        await new Promise(r => setTimeout(r, 400));
                        await sock.sendMessage(jid, { text: String(b.code || b.copyCode || b.text).trim() });
                    }
                } catch (_) { }
            }, 600);
        }

        if (activeMode === 'smart_fallback') {
            whatsapp.waitForDeliveryAck(instance, msg.key.id, activeTimeout).then(async (delivered) => {
                if (!delivered) {
                    await sock.sendMessage(jid, {
                        text: [title ? `*${title}*` : '', mainText, footer ? `_${footer}_` : ''].filter(Boolean).join('\n\n')
                    });
                    for (const b of rawButtons.filter(x => x.type === 'copy' && (x.code || x.copyCode || x.text))) {
                        await new Promise(r => setTimeout(r, 400));
                        await sock.sendMessage(jid, { text: String(b.code || b.copyCode || b.text).trim() });
                    }
                }
            });
        }

        res.json(msg);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});
module.exports = router;
