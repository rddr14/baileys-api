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
// 0. SSE HUB DE ATENDIMENTO EM TEMPO REAL
// ==========================================

const atendimentoSseClients = new Set();

function broadcastAtendimentoSse(payload) {
    const dataStr = `event: atendimento\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const clientRes of atendimentoSseClients) {
        try {
            clientRes.write(dataStr);
        } catch (_) {
            atendimentoSseClients.delete(clientRes);
        }
    }
}

router.get('/atendimento-events/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: Date.now() })}\n\n`);
    atendimentoSseClients.add(res);

    const heartbeat = setInterval(() => {
        try {
            res.write(`: heartbeat ${Date.now()}\n\n`);
        } catch (_) {
            clearInterval(heartbeat);
            atendimentoSseClients.delete(res);
        }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        atendimentoSseClients.delete(res);
    });
});

router.post('/atendimento-events/emit', (req, res) => {
    const body = req.body || {};
    const payload = {
        event: body.event || 'updated',
        atendimento_id: body.atendimento_id || null,
        session: body.session || null,
        phone: body.phone || null,
        timestamp: body.timestamp || Date.now(),
        payload: body.payload || {}
    };
    broadcastAtendimentoSse(payload);
    res.json({ success: true, clients: atendimentoSseClients.size });
});

// ==========================================
// 1. GERENCIAMENTO DE SESSÕES E DIRETÓRIO GLOBAL
// ==========================================

router.post('/directory/sync-crm', (req, res) => {
    try {
        const records = Array.isArray(req.body?.records) ? req.body.records : [];
        const synced = whatsapp.globalDirectory.bulkSyncCrm(records);
        res.json({
            success: true,
            synced,
            stats: whatsapp.globalDirectory.getStats()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/directory/stats', (req, res) => {
    try {
        res.json({
            success: true,
            stats: whatsapp.globalDirectory.getStats()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/directory/resolve/:query', (req, res) => {
    try {
        const identity = whatsapp.globalDirectory.resolveIdentity(req.params.query);
        res.json({ success: true, identity });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

router.get('/:sessionId/online-status', (req, res) => {
    try {
        res.json({ success: true, showOnline: whatsapp.getOnlineStatus(req.params.sessionId) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:sessionId/online-status', async (req, res) => {
    const { showOnline } = req.body;
    if (typeof showOnline !== 'boolean') {
        return res.status(400).json({ error: '"showOnline" deve ser true ou false.' });
    }

    try {
        await whatsapp.setOnlineStatus(req.params.sessionId, showOnline);
        res.json({ success: true, showOnline, message: 'Status online atualizado com sucesso.' });
    } catch (error) {
        console.error(`[${req.params.sessionId}] Falha ao atualizar status online:`, error);
        res.status(500).json({ error: error.message });
    }
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
        if (check.lid) {
            whatsapp.globalDirectory.recordLidMapping(check.lid, jid);
        }

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

        let userStatus = null;
        try {
            const statusObj = await sock.fetchStatus(jid);
            if (statusObj && statusObj.status) {
                userStatus = statusObj.status;
            }
        } catch (_) {}

        const dir = whatsapp.globalDirectory.resolveIdentity(jid)
            || whatsapp.globalDirectory.resolveIdentity(cleanNumber);

        res.json({
            exists: true,
            jid: jid,
            number: cleanNumber,
            name: name || dir?.name || pushName || null,
            pushName: pushName || dir?.pushName || name || null,
            pushname: pushName || dir?.pushName || name || null,
            crmName: dir?.crmName || null,
            crmContext: dir?.crmContext || null,
            verifiedName: contact?.verifiedName || dir?.verifiedName || null,
            status: userStatus || null,
            profilePicUrl,
            lid: check.lid || contact?.lid || dir?.lid || null,
            isBusiness: Boolean(dir?.isBusiness)
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
            const rawBase64 = String(base64);
            const cleanBase64 = rawBase64.includes(';base64,') ? rawBase64.split(';base64,')[1] : rawBase64;
            buffer = Buffer.from(cleanBase64, 'base64');
            mimetype = req.body.mimetype || 'application/octet-stream';
            fileName = req.body.fileName || req.body.filename || 'arquivo';
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
            if (mimetype && mimetype !== 'application/octet-stream') messagePayload.mimetype = mimetype;
            if (caption) messagePayload.caption = caption;
        } else if (mediaType === 'video') {
            messagePayload.video = buffer;
            if (mimetype && mimetype !== 'application/octet-stream') messagePayload.mimetype = mimetype;
            if (caption) messagePayload.caption = caption;
        } else if (mediaType === 'audio') {
            messagePayload.audio = buffer;
            if (mimetype && mimetype !== 'application/octet-stream') messagePayload.mimetype = mimetype;
            if (ptt === true || ptt === 'true' || ptt === '1' || ptt === 1) messagePayload.ptt = true;
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

// ==========================================
// CONFIGURAÇÕES DE PROTEÇÃO DE BOTÕES (PIX / 2FA)
// ==========================================

router.get('/:sessionId/button-settings', (req, res) => {
    try {
        res.json({ success: true, ...whatsapp.getButtonSettings(req.params.sessionId) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/:sessionId/button-settings', (req, res) => {
    try {
        const { mode, fallbackTimeoutMs } = req.body;
        const updated = whatsapp.setButtonSettings(req.params.sessionId, { mode, fallbackTimeoutMs });
        res.json({ success: true, ...updated, message: 'Configuração de proteção de botões salva com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Helper centralizado para envio de textos/códigos de contingência (Pix e 2FA)
 * Envia os códigos 'copy' em balões isolados para facilitar o "segurar e copiar" no celular.
 */
async function sendFallbackTextAndCodes(sock, jid, { title, body, footer, buttons = [], sendMainText = true }) {
    const sentFallbackIds = [];

    if (sendMainText) {
        const parts = [];
        if (title) parts.push(`*${title}*`);
        if (body) parts.push(body);

        // Lista links, telefones ou opções caso não sejam botões de cópia
        const extraLines = [];
        buttons.forEach((btn, idx) => {
            const bType = btn.type || 'quick_reply';
            if (bType === 'url' && btn.url) {
                extraLines.push(`🔗 *${btn.text || 'Link'}:* ${btn.url}`);
            } else if (bType === 'call' && btn.phone) {
                extraLines.push(`📞 *${btn.text || 'Telefone'}:* ${btn.phone}`);
            } else if (bType === 'quick_reply' && buttons.every(b => (b.type || 'quick_reply') !== 'copy')) {
                extraLines.push(`• ${btn.text || `Opção ${idx + 1}`}`);
            }
        });

        if (extraLines.length > 0) parts.push(extraLines.join('\n'));
        if (footer) parts.push(`_${footer}_`);

        const mainRes = await sock.sendMessage(jid, { text: parts.join('\n\n') });
        if (mainRes?.key?.id) sentFallbackIds.push(mainRes.key.id);
    }

    // Dispara cada botão do tipo 'copy' (Pix ou 2FA) isolado em uma mensagem limpa
    const copyButtons = buttons.filter(b => b.type === 'copy' && (b.code || b.text));
    for (const copyBtn of copyButtons) {
        const rawCode = String(copyBtn.code || copyBtn.text).trim();
        await new Promise(r => setTimeout(r, 400));
        const codeRes = await sock.sendMessage(jid, { text: rawCode });
        if (codeRes?.key?.id) sentFallbackIds.push(codeRes.key.id);
    }

    return sentFallbackIds;
}

// Envia mensagem com botões interativos + Camada de Proteção Anti-Bloqueio (Pix / 2FA)
async function handleSendButtons(req, res) {
    try {
        const sessionId = req.params.sessionId;
        const { number, title, body, footer, buttons, protectionMode, fallbackTimeoutMs } = req.body;
        if (!number || !body) {
            return res.status(400).json({ error: 'Faltando "number" ou "body" (texto principal).' });
        }

        const sock = whatsapp.getSocket(sessionId);
        let jid;
        try {
            jid = await resolveJid(sock, number);
        } catch (e) {
            return res.status(422).json({ success: false, error: e.message });
        }

        const sessionBtnConfig = whatsapp.getButtonSettings(sessionId);
        const activeMode = protectionMode || sessionBtnConfig.mode || 'smart_fallback';
        const activeTimeout = Number(fallbackTimeoutMs) || sessionBtnConfig.fallbackTimeoutMs || 12000;

        const inputButtons = Array.isArray(buttons) && buttons.length > 0
            ? buttons
            : [
                { type: 'quick_reply', text: 'Sim ✅', id: 'btn_sim' },
                { type: 'quick_reply', text: 'Não ❌', id: 'btn_nao' }
            ];

        // MODO 1: Kill-Switch ativo (text_only) -> Nem tenta enviar botão interativo, envia direto em texto + código isolado
        if (activeMode === 'text_only') {
            const fallbackIds = await sendFallbackTextAndCodes(sock, jid, {
                title,
                body,
                footer,
                buttons: inputButtons,
                sendMainText: true
            });

            return res.json({
                success: true,
                modeUsed: 'text_only',
                messageId: fallbackIds[0] || null,
                fallbackMessageIds: fallbackIds,
                resolvedJid: jid
            });
        }

        // Formata os botões interativos (formato oficial moderno do WhatsApp)
        const formattedButtons = inputButtons.map((btn, index) => {
            const btnType = btn.type || 'quick_reply';
            if (btnType === 'url') {
                return {
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || 'Abrir Link',
                        url: btn.url,
                        merchant_url: btn.url
                    })
                };
            } else if (btnType === 'call') {
                return {
                    name: 'cta_call',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || 'Ligar',
                        phone_number: btn.phone
                    })
                };
            } else if (btnType === 'copy') {
                return {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || 'Copiar Código',
                        id: btn.id || `copy_${index + 1}`,
                        copy_code: btn.code || btn.text
                    })
                };
            } else {
                return {
                    name: 'quick_reply',
                    buttonParamsJson: JSON.stringify({
                        display_text: btn.text || `Opção ${index + 1}`,
                        id: btn.id || `btn_${index + 1}`
                    })
                };
            }
        });

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

        await sock.relayMessage(
            jid,
            msg.message,
            {
                messageId: msg.key.id,
                additionalNodes: [
                    {
                        tag: 'biz',
                        attrs: {},
                        content: [
                            {
                                tag: 'interactive',
                                attrs: { type: 'native_flow', v: '1' },
                                content: [
                                    {
                                        tag: 'native_flow',
                                        attrs: { v: '9', name: 'mixed' }
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        );

        // MODO 2: Dupla Garantia (dual) -> Envia o botão interativo e logo em seguida manda o código puro separado
        if (activeMode === 'dual') {
            setTimeout(async () => {
                try {
                    await sendFallbackTextAndCodes(sock, jid, {
                        title,
                        body,
                        footer,
                        buttons: inputButtons,
                        sendMainText: false // O texto já foi no botão, envia apenas o código puro isolado
                    });
                } catch (err) {
                    console.error(`[${sessionId}] Erro no envio secundário (dual):`, err.message);
                }
            }, 600);
        }

        // MODO 3: Fallback Inteligente (smart_fallback) -> Monitora se o 2º check chega no tempo limite
        if (activeMode === 'smart_fallback') {
            whatsapp.waitForDeliveryAck(sessionId, msg.key.id, activeTimeout).then(async (delivered) => {
                if (!delivered) {
                    console.warn(`[${sessionId}] ⚠️ Botão ${msg.key.id} para ${jid} não confirmou entrega (2 checks) em ${activeTimeout}ms. Disparando fallback em texto!`);
                    try {
                        await sendFallbackTextAndCodes(sock, jid, {
                            title,
                            body,
                            footer,
                            buttons: inputButtons,
                            sendMainText: true
                        });
                    } catch (err) {
                        console.error(`[${sessionId}] Falha ao enviar fallback automático:`, err.message);
                    }
                } else {
                    console.log(`[${sessionId}] ✓ Botão ${msg.key.id} confirmado pelo aparelho de destino (2 checks).`);
                }
            });
        }

        res.json({
            success: true,
            modeUsed: activeMode,
            fallbackTimeoutMs: activeMode === 'smart_fallback' ? activeTimeout : null,
            messageId: msg.key.id,
            resolvedJid: jid,
            buttonsCount: formattedButtons.length
        });
    } catch (error) {
        console.error('Erro ao enviar botões:', error);
        res.status(500).json({ error: 'Falha ao enviar botões.', detail: error.message });
    }
}

router.post('/:sessionId/messages/buttons', requireConnection, handleSendButtons);

// Rota dedicada e simplificada para Pix Copia e Cola e códigos 2FA
router.post('/:sessionId/messages/copy', requireConnection, async (req, res) => {
    const { number, title, body, footer, buttonText, code, protectionMode, fallbackTimeoutMs } = req.body;
    req.body = {
        number,
        title: title || '',
        body: body || 'Utilize o botão abaixo para copiar o código:',
        footer: footer || '',
        protectionMode,
        fallbackTimeoutMs,
        buttons: [
            {
                type: 'copy',
                text: buttonText || 'Copiar Código',
                code: code
            }
        ]
    };
    return handleSendButtons(req, res);
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
        const meta = whatsapp.getMessageMetadata(req.params.sessionId, req.params.messageId);
        res.json({
            success: true,
            base64: buffer.toString('base64'),
            mimetype: meta.mimetype || 'application/octet-stream',
            fileName: meta.fileName || null
        });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

// ==========================================
// 3. CONSULTAS DE LISTAS
// ==========================================

function extractLastMessagePreview(msg) {
    if (!msg || !msg.message) return '';
    let m = msg.message;
    for (let i = 0; i < 4; i++) {
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
        else if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
        else if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;
        else if (m.viewOnceMessageV2Extension?.message) m = m.viewOnceMessageV2Extension.message;
        else if (m.documentWithCaptionMessage?.message) m = m.documentWithCaptionMessage.message;
        else break;
    }

    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage) return m.imageMessage.caption || '[Imagem]';
    if (m.videoMessage) return m.videoMessage.caption || '[Vídeo]';
    if (m.audioMessage) return '[Áudio]';
    if (m.documentMessage) return m.documentMessage.caption || `[Documento] ${m.documentMessage.fileName || ''}`.trim();
    if (m.stickerMessage) return '[Figurinha]';
    if (m.locationMessage || m.liveLocationMessage) return '[Localização]';
    if (m.contactMessage) return `[Contato] ${m.contactMessage.displayName || ''}`.trim();
    return '';
}

function normalizeMessageTimestamp(rawTs, fallbackTs = 0) {
    let ts = rawTs;
    if (ts && typeof ts === 'object' && typeof ts.low === 'number') {
        ts = ts.low;
    }
    ts = Number(ts) || Number(fallbackTs) || 0;
    if (ts > 10000000000) {
        ts = Math.floor(ts / 1000);
    }
    return ts;
}

router.get('/:sessionId/chats', requireConnection, (req, res) => {
    const store = whatsapp.getStore(req.params.sessionId);
    const chats = Object.values(store.chats || {}).map((chat) => {
        const jid = chat.id;
        const msgs = store.messages?.[jid] || [];
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const contact = store.contacts?.[jid] || null;
        const lastMessageText = extractLastMessagePreview(lastMsg);
        const ts = normalizeMessageTimestamp(
            lastMsg?.messageTimestamp || chat.conversationTimestamp,
            0
        );
        const pushname = chat.name
            || chat.pushName
            || contact?.name
            || contact?.notify
            || (!lastMsg?.key?.fromMe ? lastMsg?.pushName : null)
            || null;

        return {
            ...chat,
            last_message: lastMessageText,
            timestamp: ts,
            from_me: Boolean(lastMsg?.key?.fromMe),
            pushname
        };
    });
    res.json({ success: true, chats });
});

router.post('/:sessionId/chats/mark-unread', requireConnection, async (req, res) => {
    try {
        const { number, chat } = req.body || {};
        const target = chat || number;
        if (!target) {
            return res.status(400).json({ error: 'Faltando "number" ou "chat".' });
        }
        const sock = whatsapp.getSocket(req.params.sessionId);
        let jid;
        try {
            jid = await resolveJid(sock, target);
        } catch (_) {
            const clean = String(target).replace(/@.*/g, '').replace(/[^0-9]/g, '');
            jid = String(target).includes('@') ? String(target) : `${clean}@s.whatsapp.net`;
        }
        await sock.chatModify({ markRead: false }, jid);
        res.json({ success: true, jid });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao marcar chat como não lido.', detail: error.message });
    }
});

router.post('/:sessionId/chats/fetch-history', requireConnection, async (req, res) => {
    try {
        const { jid, count } = req.body || {};
        if (!jid) {
            return res.status(400).json({ success: false, error: 'Parâmetro "jid" é obrigatório.' });
        }
        const result = await whatsapp.fetchChatHistory(req.params.sessionId, { jid, count });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao solicitar histórico sob demanda.', detail: error.message });
    }
});

router.get('/:sessionId/contacts', requireConnection, (req, res) => {
    try {
        const store = whatsapp.getStore(req.params.sessionId);
        const search = (req.query.search || req.query.query || '').trim().toLowerCase();
        const number = (req.query.number || '').replace(/[^0-9]/g, '');
        const name = (req.query.name || '').trim().toLowerCase();

        const lidInfo = new Map();
        for (const c of Object.values(store.contacts || {})) {
            if (c?.id && c.id.endsWith('@lid')) {
                lidInfo.set(c.id, c);
            }
        }

        const uniqueContactsMap = new Map();
        for (const c of Object.values(store.contacts || {})) {
            if (c?.id && !c.id.endsWith('@g.us') && !c.id.endsWith('@lid')) {
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
                        number: contactNumber,
                        name: contactName,
                        pushName: contactPushName,
                        pushname: contactPushName,
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
        }

        for (const c of Object.values(store.chats || {})) {
            if (c?.id && !c.id.endsWith('@g.us') && !c.id.endsWith('@lid')) {
                const jid = c.id;
                const contactNumber = jid.split('@')[0] || '';
                const dir = whatsapp.globalDirectory.resolveIdentity(jid);
                const chatName = c.name || dir?.name || null;
                const chatPushName = whatsapp.findGlobalPushName(jid) || dir?.pushName || chatName;
                if (!uniqueContactsMap.has(jid)) {
                    uniqueContactsMap.set(jid, {
                        id: jid,
                        number: contactNumber,
                        name: chatName,
                        pushName: chatPushName,
                        pushname: chatPushName,
                        crmName: dir?.crmName || null,
                        verifiedName: dir?.verifiedName || null,
                        lid: c.accountLid || dir?.lid || null,
                        isMyContact: false
                    });
                }
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

        if (number) {
            contacts = contacts.filter(c => matchPhone(c.number, number));
        }

        if (name) {
            contacts = contacts.filter(c => 
                (c.name && c.name.toLowerCase().includes(name)) || 
                (c.pushName && c.pushName.toLowerCase().includes(name))
            );
        }

        if (search) {
            contacts = contacts.filter(c => 
                matchPhone(c.number, search) ||
                (c.name && c.name.toLowerCase().includes(search)) ||
                (c.pushName && c.pushName.toLowerCase().includes(search))
            );
        }

        res.json({ success: true, count: contacts.length, contacts });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao buscar contatos.', detail: error.message });
    }
});

router.post('/:sessionId/contacts/update', requireConnection, (req, res) => {
    try {
        const { number, name, pushName } = req.body;
        if (!number || (!name && !pushName)) {
            return res.status(400).json({ success: false, error: 'Faltando number e name (ou pushName).' });
        }
        const updated = whatsapp.updateContact(req.params.sessionId, { number, name, pushName });
        res.json({ success: true, contact: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao atualizar contato.', detail: error.message });
    }
});

router.post('/:sessionId/contacts/sync', requireConnection, async (req, res) => {
    try {
        const result = await whatsapp.resyncSessionContacts(req.params.sessionId);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao ressincronizar contatos.', detail: error.message });
    }
});

router.post('/:sessionId/contacts/save-device', requireConnection, async (req, res) => {
    try {
        const { phone, name } = req.body || {};
        if (!phone || !name) {
            return res.status(400).json({ success: false, error: 'Parâmetros "phone" e "name" são obrigatórios.' });
        }
        const result = await whatsapp.saveContactToWhatsApp(req.params.sessionId, { phone, name });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: 'Falha ao salvar contato no aparelho.', detail: error.message });
    }
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
        const participants = await Promise.all(
            (metadata.participants || []).map((p) => whatsapp.resolveParticipantIdentity(req.params.sessionId, p))
        );
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
