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

// ==========================================
// 1. INSTÂNCIA & SESSÕES (Evolution Compat)
// ==========================================

// GET /instance/fetchInstances
router.get('/instance/fetchInstances', (req, res) => {
    try {
        const allSessions = whatsapp.getAllSessions();
        const instances = allSessions.map(s => ({
            instance: {
                instanceName: s.sessionId,
                owner: s.phone ? `${s.phone}@s.whatsapp.net` : null,
                profileName: s.name,
                profilePictureUrl: null,
                state: s.status === 'connected' ? 'open' : (s.status === 'qr_ready' ? 'qrcode' : 'close')
            }
        }));
        res.json(instances);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /instance/create
router.post('/instance/create', async (req, res) => {
    try {
        const { instanceName, webhook } = req.body;
        if (!instanceName) {
            return res.status(400).json({ error: 'instanceName é obrigatório.' });
        }
        if (webhook && webhook.url) {
            whatsapp.setWebhook(instanceName, webhook.url);
        }
        await whatsapp.connectToWhatsApp(instanceName);
        res.status(201).json({
            instance: {
                instanceName,
                status: 'created'
            },
            hash: {
                apikey: 'global'
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
router.put('/instance/update/:instance', (req, res) => {
    res.json({ status: 'SUCCESS', message: 'Configurações atualizadas' });
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
        url: url || ''
    });
});

// POST /webhook/set/:instance
router.post('/webhook/set/:instance', (req, res) => {
    const { instance } = req.params;
    const body = req.body || {};
    const webhookData = body.webhook || body;
    const url = webhookData.url;
    if (url) {
        whatsapp.setWebhook(instance, url);
    }
    res.json({
        status: 'SUCCESS',
        webhook: {
            enabled: !!url,
            url: url || ''
        }
    });
});

// ==========================================
// 3. ENVIO DE MENSAGENS (Evolution Compat)
// ==========================================

// POST /message/sendText/:instance
router.post('/message/sendText/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, text, options: msgOpts, quoted } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = formatJid(number);

        const options = {};
        if (quoted && quoted.key) {
            options.quoted = { key: quoted.key };
        } else if (msgOpts && msgOpts.quoted && msgOpts.quoted.key) {
            options.quoted = { key: msgOpts.quoted.key };
        }

        const result = await sock.sendMessage(jid, { text: text || '' }, options);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendMedia/:instance
router.post('/message/sendMedia/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, mediatype, mimetype, caption, media, fileName } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = formatJid(number);

        let buffer;
        if (media.startsWith('http://') || media.startsWith('https://')) {
            const axios = require('axios');
            const resp = await axios.get(media, { responseType: 'arraybuffer' });
            buffer = Buffer.from(resp.data);
        } else {
            const base64Data = media.includes(';base64,') ? media.split(';base64,')[1] : media;
            buffer = Buffer.from(base64Data, 'base64');
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

        const result = await sock.sendMessage(jid, messagePayload);
        res.json(result);
    } catch (e) {
        res.status(500).json({ status: 'ERROR', message: e.message });
    }
});

// POST /message/sendWhatsAppAudio/:instance
router.post('/message/sendWhatsAppAudio/:instance', requireConnection, async (req, res) => {
    try {
        const { instance } = req.params;
        const { number, audio } = req.body;
        const sock = whatsapp.getSocket(instance);
        const jid = formatJid(number);

        let buffer;
        if (audio.startsWith('http://') || audio.startsWith('https://')) {
            const axios = require('axios');
            const resp = await axios.get(audio, { responseType: 'arraybuffer' });
            buffer = Buffer.from(resp.data);
        } else {
            const base64Data = audio.includes(';base64,') ? audio.split(';base64,')[1] : audio;
            buffer = Buffer.from(base64Data, 'base64');
        }

        const result = await sock.sendMessage(jid, {
            audio: buffer,
            mimetype: 'audio/mp4',
            ptt: true
        });
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
        const jid = formatJid(number);

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
        const jid = formatJid(number);

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
        const jid = formatJid(number);

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
        const jid = formatJid(number);

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

                // 3. Tenta pegar do último pushName das mensagens
                if (!name && store?.messages?.[jid]) {
                    const msgs = store.messages[jid];
                    for (let i = msgs.length - 1; i >= 0; i--) {
                        if (msgs[i].pushName) {
                            name = msgs[i].pushName;
                            break;
                        }
                    }
                }

                // 4. Se for conta Business, busca businessProfile
                if (!name) {
                    try {
                        const bProfile = await sock.getBusinessProfile(jid);
                        if (bProfile && (bProfile.description || bProfile.email)) {
                            name = bProfile.description || null;
                        }
                    } catch (_) {}
                }

                // 5. Se ainda não achou, tenta o status/recado público
                if (!name) {
                    try {
                        const statusObj = await sock.fetchStatus(jid);
                        if (statusObj && statusObj.status) {
                            name = statusObj.status;
                        }
                    } catch (_) {}
                }

                results.push({
                    jid: jid,
                    exists: true,
                    number: clean,
                    name: name || null,
                    lid: check.lid || null
                });
            } else {
                results.push({
                    jid: null,
                    exists: false,
                    number: clean,
                    name: null,
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
        const jid = formatJid(number);

        await sock.sendPresenceUpdate(presence || 'composing', jid);
        if (delay && delay > 0) {
            setTimeout(async () => {
                try {
                    await sock.sendPresenceUpdate('paused', jid);
                } catch (_) {}
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
            const msgs = store.messages[jid] || [];
            const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
            return {
                remoteJid: jid,
                remoteJidAlt: null,
                pushName: c.name || null,
                name: c.name || null,
                isSaved: false,
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

// POST /chat/findMessages/:instance (Histórico com paginação)
router.post('/chat/findMessages/:instance', requireConnection, (req, res) => {
    try {
        const { instance } = req.params;
        const { where, options } = req.body || {};
        const store = whatsapp.getStore(instance);

        const remoteJid = where?.key?.remoteJid || where?.key?.remoteJidAlt;
        const limit = Number(options?.offset) || 20;

        let messagesList = [];
        if (remoteJid && store.messages[remoteJid]) {
            messagesList = [...store.messages[remoteJid]];
        } else {
            for (const j in store.messages) {
                messagesList = messagesList.concat(store.messages[j]);
            }
        }

        // Ordena por timestamp descendente
        messagesList.sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));

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
        res.json({
            base64: buffer.toString('base64'),
            mimetype: 'application/octet-stream',
            fileName: 'file'
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
        const jid = formatJid(number);

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

        const list = Object.values(groupsObj).map(g => ({
            id: g.id,
            subject: g.subject || 'Sem Nome',
            name: g.subject || 'Sem Nome',
            owner: g.owner || null,
            creation: g.creation || null,
            size: g.participants ? g.participants.length : (g.size || 0),
            participants: req.query.getParticipants === 'true' ? g.participants : undefined
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

        const participants = (metadata.participants || []).map(p => {
            const userNumber = p.id.split('@')[0];
            return {
                id: p.id,
                phoneNumber: userNumber,
                admin: p.admin || null // 'admin' | 'superadmin' | null
            };
        });

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
                } catch (_) {}
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
        const jid = formatJid(number);

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

module.exports = router;
