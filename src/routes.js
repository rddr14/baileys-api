const express = require('express');
const router = express.Router();
const whatsapp = require('./whatsapp');
const multer = require('multer');
const fs = require('fs');
const { proto, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

const upload = multer({ dest: 'uploads/' });

/**
 * Valida e resolve o JID correto de um número via onWhatsApp().
 * Retorna o JID oficial do WhatsApp (pode corrigir dígitos do número).
 * Lança um erro se o número não existir no WhatsApp.
 */
async function resolveJid(sock, number) {
    if (typeof number === 'string' && (number.includes('@g.us') || number.includes('@broadcast') || number.includes('@newsletter') || number.includes('@lid'))) {
        return number;
    }
    // Limpa o número: remove @..., espaços, +, hífens
    const cleanNumber = String(number).replace(/@.*/g, '').replace(/[^0-9]/g, '');
    
    const [result] = await sock.onWhatsApp(cleanNumber);
    
    if (!result || !result.exists) {
        throw new Error(`Número ${cleanNumber} não encontrado no WhatsApp.`);
    }
    
    return result.jid; // JID oficial e corrigido pelo WhatsApp
}

// Middleware genérico para rotas que exigem conexão
function requireConnection(req, res, next) {
    const { sessionId } = req.params;
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID é obrigatório na URL.' });
    }
    
    try {
        const sock = whatsapp.getSocket(sessionId);
        if (whatsapp.getStatus(sessionId) !== 'connected') {
            return res.status(503).json({ error: `Sessão ${sessionId} não está conectada ao WhatsApp.` });
        }
        next();
    } catch (e) {
        return res.status(404).json({ error: e.message });
    }
}

// ==========================================
// 1. GERENCIAMENTO DE SESSÕES
// ==========================================

// Lista todas as sessões ativas no servidor
router.get('/sessions', (req, res) => {
    res.json({ success: true, sessions: whatsapp.getAllSessions() });
});

// Inicia (ou reinicia) uma sessão
router.post('/:sessionId/start', async (req, res) => {
    try {
        await whatsapp.connectToWhatsApp(req.params.sessionId);
        res.json({ success: true, message: `Sessão ${req.params.sessionId} iniciada.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Status da Sessão
router.get('/:sessionId/status', (req, res) => {
    const status = whatsapp.getStatus(req.params.sessionId);
    res.json({ success: true, status });
});

// Retorna o QR Code em Base64
router.get('/:sessionId/qr', (req, res) => {
    const qrCode = whatsapp.getQrCode(req.params.sessionId);
    if (qrCode) {
        res.json({ success: true, qrCodeBase64: qrCode });
    } else {
        res.status(404).json({ error: 'QR Code ainda não está disponível ou já foi escaneado.' });
    }
});

// Logout da Sessão
router.post('/:sessionId/logout', requireConnection, async (req, res) => {
    try {
        await whatsapp.logout(req.params.sessionId);
        res.json({ success: true, message: 'Dispositivo desconectado com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao fazer logout.' });
    }
});

// Apaga totalmente a sessão (Delete file)
router.delete('/:sessionId/session', async (req, res) => {
    try {
        await whatsapp.resetSession(req.params.sessionId);
        res.json({ success: true, message: 'Sessão apagada completamente. Reinicie para escanear.' });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao resetar sessão.' });
    }
});

// ==========================================
// 2. GERENCIAMENTO DE WEBHOOKS
// ==========================================

router.get('/:sessionId/webhook', (req, res) => {
    const url = whatsapp.getWebhook(req.params.sessionId);
    res.json({ success: true, webhookUrl: url });
});

router.post('/:sessionId/webhook', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'A URL do webhook é obrigatória' });
    whatsapp.setWebhook(req.params.sessionId, url);
    res.json({ success: true, message: 'Webhook configurado com sucesso' });
});

router.delete('/:sessionId/webhook', (req, res) => {
    whatsapp.deleteWebhook(req.params.sessionId);
    res.json({ success: true, message: 'Webhook removido com sucesso' });
});

// ==========================================
// 3. ROTAS DE MENSAGENS E INTERAÇÕES
// ==========================================

// Verifica se um número existe no WhatsApp e retorna o JID correto
router.get('/:sessionId/check-number', requireConnection, async (req, res) => {
    try {
        const { number } = req.query;
        if (!number) return res.status(400).json({ error: 'Passe o parâmetro ?number=551199...' });
        
        const sock = whatsapp.getSocket(req.params.sessionId);
        const cleanNumber = number.replace(/@.*/g, '').replace(/[^0-9]/g, '');
        const [result] = await sock.onWhatsApp(cleanNumber);
        
        if (!result || !result.exists) {
            return res.json({ success: true, exists: false, number: cleanNumber, jid: null });
        }
        
        res.json({ success: true, exists: true, number: cleanNumber, jid: result.jid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Perfil e foto de perfil por número (compatibilidade BaileysApiService e WppConnect)
router.get('/:sessionId/profile/:phone', requireConnection, async (req, res) => {
    try {
        const { phone } = req.params;
        const sock = whatsapp.getSocket(req.params.sessionId);
        const store = whatsapp.getStore(req.params.sessionId);
        const cleanNumber = phone.replace(/@.*/g, '').replace(/[^0-9]/g, '');
        const [check] = await sock.onWhatsApp(cleanNumber);

        if (!check || !check.exists) {
            return res.json({ exists: false, jid: null, profilePicUrl: null, name: null, status: null });
        }

        const jid = check.jid;
        let profilePicUrl = null;
        try {
            profilePicUrl = await sock.profilePictureUrl(jid, 'image');
        } catch (_) {}

        let name = null;
        const contact = store?.contacts?.[jid] || store?.contacts?.[cleanNumber];
        if (contact && (contact.name || contact.notify || contact.verifiedName)) {
            name = contact.name || contact.notify || contact.verifiedName;
        }
        if (!name && store?.chats?.[jid]) {
            name = store.chats[jid].name || store.chats[jid].pushName;
        }

        let userStatus = null;
        try {
            const statusObj = await sock.fetchStatus(jid);
            if (statusObj && statusObj.status) {
                userStatus = statusObj.status;
            }
        } catch (_) {}

        res.json({
            exists: true,
            jid: jid,
            number: cleanNumber,
            name: name || userStatus || null,
            status: userStatus || null,
            profilePicUrl,
            lid: check.lid || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:sessionId/messages/text', requireConnection, async (req, res) => {
    try {
        const { number, message, quotedId, typingDelay } = req.body;
        if (!number || !message) {
            return res.status(400).json({ error: 'Faltando "number" ou "message".' });
        }

        const sock = whatsapp.getSocket(req.params.sessionId);
        
        // Valida e corrige o JID via WhatsApp
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }

        // Se informou typingDelay (em ms), simula o digitando com log de tempo
        if (typingDelay && parseInt(typingDelay, 10) > 0) {
            const delayMs = parseInt(typingDelay, 10);
            const startTyping = Date.now();
            console.log(`\n[${req.params.sessionId}] Simulando digitação por ${delayMs} ms para ${jid}...`);
            await sock.sendPresenceUpdate('composing', jid);
            await new Promise(resolve => setTimeout(resolve, delayMs));
            await sock.sendPresenceUpdate('paused', jid).catch(() => {});
            console.log(`[${req.params.sessionId}] Digitação finalizada após ${Date.now() - startTyping} ms. Enviando mensagem...`);
        }
        
        console.log(`[${req.params.sessionId}] Enviando para JID resolvido: ${jid}`);
        const options = quotedId ? { quoted: { key: { id: quotedId, remoteJid: jid } } } : {};
        
        const result = await sock.sendMessage(jid, { text: message }, options);
        res.json({ success: true, resolvedJid: jid, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar mensagem.', detail: error.message });
    }
});

router.post('/:sessionId/messages/media', upload.single('file'), requireConnection, async (req, res) => {
    try {
        const { number, caption, type, quotedId, ptt, base64 } = req.body;
        const file = req.file;

        if (!number || (!file && !base64)) {
            return res.status(400).json({ error: 'Faltando "number" ou o arquivo (file/base64).' });
        }

        const sock = whatsapp.getSocket(req.params.sessionId);

        // Valida e corrige o JID via WhatsApp
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }
        
        console.log(`[${req.params.sessionId}] Enviando mídia para JID resolvido: ${jid}`);
        
        let buffer, mimetype, fileName;

        if (base64) {
            buffer = Buffer.from(base64, 'base64');
        } else {
            buffer = fs.readFileSync(file.path);
            mimetype = file.mimetype;
            fileName = file.originalname;
            fs.unlinkSync(file.path);
        }
        
        const messagePayload = {};
        const mediaType = type || 'document';

        if (mediaType === 'image') {
            messagePayload.image = buffer;
            if (caption) messagePayload.caption = caption;
        } else if (mediaType === 'video') {
            messagePayload.video = buffer;
            if (caption) messagePayload.caption = caption;
        } else if (mediaType === 'audio') {
            messagePayload.audio = buffer;
            if (ptt) messagePayload.ptt = true;
        } else {
            messagePayload.document = buffer;
            if (mimetype) messagePayload.mimetype = mimetype;
            if (fileName) messagePayload.fileName = fileName;
            if (caption) messagePayload.caption = caption;
        }

        const options = quotedId ? { quoted: { key: { id: quotedId, remoteJid: jid } } } : {};
        const result = await sock.sendMessage(jid, messagePayload, options);
        
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar mídia.' });
    }
});

// Envia mensagem com botões interativos (Quick Reply, URL ou Telefone)
router.post('/:sessionId/messages/buttons', requireConnection, async (req, res) => {
    try {
        const { number, title, body, footer, buttons } = req.body;
        if (!number || !body) {
            return res.status(400).json({ error: 'Faltando "number" ou "body" (texto principal).' });
        }

        const sock = whatsapp.getSocket(req.params.sessionId);
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }

        // Formata os botões interativos (formato oficial moderno do WhatsApp)
        const formattedButtons = [];
        if (Array.isArray(buttons) && buttons.length > 0) {
            buttons.forEach((btn, index) => {
                const btnType = btn.type || 'quick_reply';
                if (btnType === 'url') {
                    formattedButtons.push({
                        name: 'cta_url',
                        buttonParamsJson: JSON.stringify({
                            display_text: btn.text || 'Abrir Link',
                            url: btn.url,
                            merchant_url: btn.url
                        })
                    });
                } else if (btnType === 'call') {
                    formattedButtons.push({
                        name: 'cta_call',
                        buttonParamsJson: JSON.stringify({
                            display_text: btn.text || 'Ligar',
                            phone_number: btn.phone
                        })
                    });
                } else if (btnType === 'copy') {
                    formattedButtons.push({
                        name: 'cta_copy',
                        buttonParamsJson: JSON.stringify({
                            display_text: btn.text || 'Copiar Código',
                            copy_code: btn.code || btn.text
                        })
                    });
                } else {
                    // Resposta rápida padrão (quick_reply)
                    formattedButtons.push({
                        name: 'quick_reply',
                        buttonParamsJson: JSON.stringify({
                            display_text: btn.text || `Opção ${index + 1}`,
                            id: btn.id || `btn_${index + 1}`
                        })
                    });
                }
            });
        } else {
            // Botões padrão de teste caso não envie nenhum
            formattedButtons.push(
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Sim ✅', id: 'btn_sim' }) },
                { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Não ❌', id: 'btn_nao' }) }
            );
        }

        // Monta o payload do Interactive Message
        const interactiveMessage = {
            body: { text: body },
            footer: footer ? { text: footer } : undefined,
            header: title ? { title: title, hasMediaAttachment: false } : undefined,
            nativeFlowMessage: {
                buttons: formattedButtons,
                messageParamsJson: ''
            }
        };

        const messageContent = {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2
                    },
                    interactiveMessage: interactiveMessage
                }
            }
        };

        const msg = generateWAMessageFromContent(
            jid,
            messageContent,
            { userJid: sock.user.id }
        );

        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });

        res.json({
            success: true,
            messageId: msg.key.id,
            resolvedJid: jid,
            buttonsCount: formattedButtons.length
        });
    } catch (error) {
        console.error('Erro ao enviar botões:', error);
        res.status(500).json({ error: 'Falha ao enviar botões.', detail: error.message });
    }
});

router.post('/:sessionId/presence', requireConnection, async (req, res) => {
    const startTime = Date.now();
    try {
        const { number, action = 'composing', duration, wait = false } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        const parsedDuration = duration ? parseInt(duration, 10) : null;
        
        console.log(`\n================ [PRESENCE UPDATE INÍCIO] ================`);
        console.log(`[${req.params.sessionId}] Destino : ${jid}`);
        console.log(`[${req.params.sessionId}] Ação    : ${action}`);
        console.log(`[${req.params.sessionId}] Duração solicitada no payload: ${parsedDuration !== null ? parsedDuration + ' ms' : 'indefinida (padrão WhatsApp)'}`);
        console.log(`[${req.params.sessionId}] Modo de espera (wait): ${wait ? 'SIM (síncrono)' : 'NÃO (assíncrono em background)'}`);
        console.log(`[${req.params.sessionId}] Horário : ${new Date().toISOString()}`);

        await sock.sendPresenceUpdate(action, jid);
        console.log(`[${req.params.sessionId}] Status "${action}" enviado com sucesso ao WhatsApp.`);

        if (parsedDuration && parsedDuration > 0) {
            if (wait) {
                // Se wait=true, a requisição aguarda o tempo todo antes de responder
                await new Promise(resolve => setTimeout(resolve, parsedDuration));
                await sock.sendPresenceUpdate('paused', jid).catch(() => {});
                const elapsed = Date.now() - startTime;
                console.log(`[${req.params.sessionId}] Status "paused" enviado. Ficou "${action}" por exatamente: ${elapsed} ms.`);
                console.log(`================ [PRESENCE UPDATE FIM] ================\n`);
                return res.json({ success: true, action, durationMs: parsedDuration, elapsedMs: elapsed });
            } else {
                // Assíncrono com setTimeout
                setTimeout(async () => {
                    try {
                        await sock.sendPresenceUpdate('paused', jid);
                        const elapsed = Date.now() - startTime;
                        console.log(`[${req.params.sessionId}] Status "paused" enviado após timeout. Ficou "${action}" por: ${elapsed} ms.`);
                        console.log(`================ [PRESENCE UPDATE FIM] ================\n`);
                    } catch (err) {
                        console.error(`[${req.params.sessionId}] Erro ao pausar presença:`, err.message);
                    }
                }, parsedDuration);
            }
        } else {
            console.log(`================ [PRESENCE UPDATE FIM (sem duration)] ================\n`);
        }

        res.json({ success: true, action, durationMs: parsedDuration });
    } catch (error) {
        console.error(`[${req.params.sessionId}] Falha no sendPresenceUpdate:`, error);
        res.status(500).json({ error: error.message || 'Falha ao atualizar presença.' });
    }
});

router.post('/:sessionId/messages/location', requireConnection, async (req, res) => {
    try {
        const { number, lat, lng, name, address } = req.body;
        if (!number || lat === undefined || lng === undefined) {
            return res.status(400).json({ error: 'Faltando "number", "lat" ou "lng".' });
        }
        const sock = whatsapp.getSocket(req.params.sessionId);
        
        // Valida e corrige o JID via WhatsApp (essencial para números do Brasil com/sem 9)
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }
        
        console.log(`[${req.params.sessionId}] Enviando localização para JID resolvido: ${jid}`);
        const result = await sock.sendMessage(jid, { 
            location: { degreesLatitude: Number(lat), degreesLongitude: Number(lng), name: name || '', address: address || '' } 
        });
        res.json({ success: true, resolvedJid: jid, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar localização.', detail: error.message });
    }
});

// Envia enquete interativa
router.post('/:sessionId/messages/poll', requireConnection, async (req, res) => {
    try {
        const { number, name, values, selectableCount = 1 } = req.body;
        if (!number || !name || !Array.isArray(values) || values.length < 2) {
            return res.status(400).json({ error: 'Faltando number, name da enquete ou array de opções (mínimo 2).' });
        }
        const sock = whatsapp.getSocket(req.params.sessionId);
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }
        const result = await sock.sendMessage(jid, {
            poll: {
                name: name,
                values: values,
                selectableCount: Number(selectableCount) || 1
            }
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar enquete.', detail: error.message });
    }
});

// Envia vCard / Cartão de contato
router.post('/:sessionId/messages/contact', requireConnection, async (req, res) => {
    try {
        const { number, contactName, contactPhone } = req.body;
        if (!number || !contactName || !contactPhone) {
            return res.status(400).json({ error: 'Faltando number, contactName ou contactPhone.' });
        }
        const sock = whatsapp.getSocket(req.params.sessionId);
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }
        const cleanContact = contactPhone.replace(/[^0-9]/g, '');
        const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${cleanContact}:+${cleanContact}\nEND:VCARD`;
        const result = await sock.sendMessage(jid, {
            contacts: {
                displayName: contactName,
                contacts: [{ vcard }]
            }
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao enviar contato.', detail: error.message });
    }
});

router.post('/:sessionId/messages/react', requireConnection, async (req, res) => {
    try {
        const { number, messageId, emoji } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        
        const result = await sock.sendMessage(jid, { 
            react: { text: emoji, key: { id: messageId, remoteJid: jid } } 
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao reagir.' });
    }
});

router.post('/:sessionId/messages/read', requireConnection, async (req, res) => {
    try {
        const { number, messageId } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        
        await sock.readMessages([{ remoteJid: jid, id: messageId, participant: jid }]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao marcar como lida.' });
    }
});

router.get('/:sessionId/messages/download-media/:messageId', requireConnection, async (req, res) => {
    try {
        const buffer = await whatsapp.downloadMedia(req.params.sessionId, req.params.messageId);
        res.json({ success: true, base64: buffer.toString('base64') });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

// ==========================================
// 3. CONSULTAS DE LISTAS
// ==========================================

router.get('/:sessionId/chats', requireConnection, (req, res) => {
    const store = whatsapp.getStore(req.params.sessionId);
    res.json({ success: true, chats: Object.values(store.chats) });
});

router.get('/:sessionId/contacts', requireConnection, (req, res) => {
    const store = whatsapp.getStore(req.params.sessionId);
    res.json({ success: true, contacts: Object.values(store.contacts) });
});

router.get('/:sessionId/groups', requireConnection, async (req, res) => {
    try {
        const sock = whatsapp.getSocket(req.params.sessionId);
        let groups = [];
        try {
            const participating = await sock.groupFetchAllParticipating();
            groups = Object.values(participating).map(g => ({
                id: g.id,
                name: g.subject || 'Sem Nome',
                subject: g.subject || 'Sem Nome',
                owner: g.owner || null,
                creation: g.creation || null,
                size: g.participants ? g.participants.length : 0,
                participants: g.participants || []
            }));
        } catch (_) {
            const store = whatsapp.getStore(req.params.sessionId);
            groups = Object.values(store.chats).filter(c => c.id && c.id.endsWith('@g.us')).map(c => ({
                id: c.id,
                name: c.name || 'Sem Nome',
                subject: c.name || 'Sem Nome',
                size: 0
            }));
        }
        res.json({ success: true, groups });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao listar grupos.', detail: error.message });
    }
});

// Detalhes completos e metadados brutos do grupo
router.get('/:sessionId/groups/:groupJid', requireConnection, async (req, res) => {
    try {
        let { groupJid } = req.params;
        if (!groupJid.endsWith('@g.us')) groupJid += '@g.us';
        const sock = whatsapp.getSocket(req.params.sessionId);
        const metadata = await sock.groupMetadata(groupJid);
        
        let pictureUrl = null;
        try {
            pictureUrl = await sock.profilePictureUrl(groupJid, 'image');
        } catch (_) {}

        let inviteCode = null;
        try {
            inviteCode = await sock.groupInviteCode(groupJid);
        } catch (_) {}

        res.json({
            success: true,
            metadata,
            pictureUrl,
            inviteCode: inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : null
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao obter metadados do grupo.', detail: error.message });
    }
});

// Membros / Participantes de um grupo específico
router.get('/:sessionId/groups/:groupJid/participants', requireConnection, async (req, res) => {
    try {
        let { groupJid } = req.params;
        if (!groupJid.endsWith('@g.us')) groupJid += '@g.us';
        const sock = whatsapp.getSocket(req.params.sessionId);
        const metadata = await sock.groupMetadata(groupJid);
        const participants = (metadata.participants || []).map(p => {
            const rawPhone = p.phoneNumber ? p.phoneNumber.split('@')[0] : p.id.split('@')[0];
            return {
                id: p.id,
                phoneNumber: rawPhone,
                admin: p.admin || null,
                isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                isSuperAdmin: p.admin === 'superadmin'
            };
        });
        res.json({ success: true, participants });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao obter participantes do grupo.', detail: error.message });
    }
});

router.post('/:sessionId/groups/create', requireConnection, async (req, res) => {
    try {
        const { subject, participants } = req.body;
        if (!subject || !participants || !Array.isArray(participants)) {
            return res.status(400).json({ error: 'Faltando subject ou array de participants' });
        }
        
        const formattedParticipants = participants.map(p => p.includes('@s.whatsapp.net') ? p : `${p}@s.whatsapp.net`);
        const sock = whatsapp.getSocket(req.params.sessionId);
        const result = await sock.groupCreate(subject, formattedParticipants);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao criar grupo.' });
    }
});

// Adicionar / Remover / Alterar participante no grupo
router.post('/:sessionId/groups/:groupJid/participants', requireConnection, async (req, res) => {
    try {
        let { groupJid } = req.params;
        const { participants, action = 'add' } = req.body;
        if (!groupJid.endsWith('@g.us')) groupJid += '@g.us';
        if (!participants) return res.status(400).json({ error: 'Faltando participants' });

        const sock = whatsapp.getSocket(req.params.sessionId);
        const list = (Array.isArray(participants) ? participants : [participants]).map(p => {
            const clean = String(p).replace(/[^0-9]/g, '');
            return `${clean}@s.whatsapp.net`;
        });
        const result = await sock.groupParticipantsUpdate(groupJid, list, action);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao atualizar participantes do grupo.', detail: error.message });
    }
});

// ==========================================
// 4. ROTAS DE LABELS (ETIQUETAS)
// ==========================================

// Lista todos os labels disponíveis no WhatsApp Business
router.get('/:sessionId/labels', requireConnection, async (req, res) => {
    try {
        const store = whatsapp.getStore(req.params.sessionId);
        let labels = Object.values(store.labels || {});
        
        // Se ainda não tiver labels na RAM, força o Baileys a sincronizar os patches do appState
        if (labels.length === 0) {
            const sock = whatsapp.getSocket(req.params.sessionId);
            if (sock && typeof sock.resyncAppState === 'function') {
                try {
                    console.log(`[${req.params.sessionId}] Forçando resyncAppState para obter Labels...`);
                    await sock.resyncAppState(['regular_high', 'regular_low', 'regular', 'critical_unblock_low', 'critical_block'], false);
                    // Aguarda 1.5 segundo para processar as mutações que disparam labels.edit
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    labels = Object.values(store.labels || {});
                } catch (syncErr) {
                    console.error('Erro ao executar resyncAppState:', syncErr);
                }
            }
        }
        
        res.json({ success: true, labels });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cria uma nova etiqueta no WhatsApp Business
router.post('/:sessionId/labels/create', requireConnection, async (req, res) => {
    try {
        const { name, color = 0, id } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'O nome da etiqueta é obrigatório.' });
        }

        const store = whatsapp.getStore(req.params.sessionId);
        const sock = whatsapp.getSocket(req.params.sessionId);

        // Se não informar ID, gera o próximo ID baseado nos existentes ou timestamp
        const existingIds = Object.keys(store.labels || {}).map(Number).filter(n => !isNaN(n));
        const nextId = id ? String(id) : String(existingIds.length > 0 ? Math.max(...existingIds) + 1 : Math.floor(Date.now() / 1000));

        await sock.addLabel('', {
            id: nextId,
            name: String(name),
            color: Number(color) || 0,
            deleted: false
        });

        res.json({ 
            success: true, 
            message: 'Etiqueta criada com sucesso!',
            label: { id: nextId, name, color: Number(color) || 0 }
        });
    } catch (error) {
        console.error('Erro ao criar etiqueta:', error);
        res.status(500).json({ error: error.message || 'Falha ao criar etiqueta.' });
    }
});

// Exclui uma etiqueta do WhatsApp Business pelo ID
router.delete('/:sessionId/labels/:labelId', requireConnection, async (req, res) => {
    try {
        const { labelId } = req.params;
        const sock = whatsapp.getSocket(req.params.sessionId);
        const store = whatsapp.getStore(req.params.sessionId);

        await sock.addLabel('', {
            id: String(labelId),
            deleted: true
        });

        // Remove do cache em memória e do disco se existir
        if (store && store.labels && store.labels[labelId]) {
            delete store.labels[labelId];
        }

        res.json({ 
            success: true, 
            message: `Etiqueta ${labelId} removida com sucesso!` 
        });
    } catch (error) {
        console.error('Erro ao remover etiqueta:', error);
        res.status(500).json({ error: error.message || 'Falha ao remover etiqueta.' });
    }
});

router.post('/:sessionId/labels/chat/add', requireConnection, async (req, res) => {
    try {
        const { number, labelId } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        await sock.addChatLabel(jid, String(labelId));
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao adicionar label:', error);
        res.status(500).json({ error: error.message || 'Falha ao adicionar etiqueta ao chat.' });
    }
});

router.post('/:sessionId/labels/chat/remove', requireConnection, async (req, res) => {
    try {
        const { number, labelId } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        await sock.removeChatLabel(jid, String(labelId));
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao remover label:', error);
        res.status(500).json({ error: error.message || 'Falha ao remover etiqueta.' });
    }
});

router.post('/:sessionId/labels/message/add', requireConnection, async (req, res) => {
    try {
        const { number, messageId, labelId } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        await sock.addMessageLabel(jid, messageId, String(labelId));
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao adicionar etiqueta na mensagem.' });
    }
});

router.post('/:sessionId/labels/message/remove', requireConnection, async (req, res) => {
    try {
        const { number, messageId, labelId } = req.body;
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        const sock = whatsapp.getSocket(req.params.sessionId);
        await sock.removeMessageLabel(jid, messageId, String(labelId));
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao remover label de mensagem:', error);
        res.status(500).json({ error: error.message || 'Falha ao remover etiqueta.' });
    }
});

module.exports = router;
