require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const routes = require('./routes');
const evolutionRoutes = require('./evolutionRoutes');
const whatsapp = require('./whatsapp');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Garante que o diretório de uploads existe
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Roteamento
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', routes);

// Camada de compatibilidade 100% com Evolution API v2 (atende rotas como /group/fetchAllGroups/..., /message/sendText/..., etc)
app.use(evolutionRoutes);
app.use('/api', evolutionRoutes);

// Iniciando as conexões ativas com WhatsApp
console.log('Procurando sessões ativas no disco...');
const folders = fs.readdirSync(__dirname + '/..');
let activeSessions = 0;
for (const folder of folders) {
    if (folder.startsWith('auth_info_baileys_')) {
        const sessionId = folder.replace('auth_info_baileys_', '');
        console.log(`Auto-conectando sessão: ${sessionId}`);
        whatsapp.connectToWhatsApp(sessionId);
        activeSessions++;
    }
}

if (activeSessions === 0) {
    console.log('Nenhuma sessão salva encontrada. Chame a rota /api/:sessionId/start para começar.');
}

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`API rodando na porta ${PORT}`);
    console.log(`========================================`);
    console.log(`Verificar status : GET  http://localhost:${PORT}/api/status`);
    console.log(`Obter QR Code    : GET  http://localhost:${PORT}/api/qr`);
    console.log(`Enviar Mensagem  : POST http://localhost:${PORT}/api/messages/text`);
    console.log(`========================================\n`);
});
