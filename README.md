Baileys WhatsApp API Engine & Evolution API Compatibility Layer
Esta API REST foi desenvolvida em Node.js com a biblioteca `@whiskeysockets/baileys` e oferece:
Camada Nativa Baileys API (`/api/:sessionId/...`) para controle total de sessões, mensagens, mídias, botões interativos e labels.
Camada de Compatibilidade Direta com Evolution API v2 (atendendo chamadas com ou sem prefixo `/api` como `/group/fetchAllGroups/{instance}`, `/message/sendText/{instance}`, `/message/sendButtons/{instance}`, etc.), permitindo que services PHP/Laravel (`EvolutionApiService.php` ou `BaileysApiService.php`) funcionem sem qualquer alteração.
Proteção Anti-Bloqueio para Pix & 2FA (`cta_copy`) com monitoramento real de entrega (2º check / `DELIVERY_ACK`), fallback automático em texto puro e Kill-Switch configurável por sessão.
Multi-Sessões Simultâneas com painel web interativo (`public/index.html`), reconexão automática e webhooks individuais por instância.
---
🚀 Guia de Instalação no Servidor
Você pode instalar a API em qualquer servidor VPS (Ubuntu, Debian, etc.) de duas maneiras:
---
Opção 1: Instalação Nativa via SSH com PM2 (Mais Leve)
> **Recomendado para servidores com pouca memória RAM (1 GB a 2 GB).**  
> Consumo mínimo de recursos, sem o overhead de containers.
Passo 1: Conecte via SSH no servidor e clone o repositório
```bash
git clone https://github.com/rddr14/baileys-api.git
cd baileys-api
```
Passo 2: Execute o script de instalação automatizado
O instalador cuidará de atualizar os pacotes, instalar o Node.js 20 LTS, o PM2, as dependências do projeto e subir a aplicação:
```bash
chmod +x install.sh
./install.sh
```
Comandos úteis no dia a dia (PM2):
Ver logs em tempo real: `pm2 logs baileys-api`
Status do serviço: `pm2 status`
Reiniciar aplicação: `pm2 restart baileys-api`
Parar aplicação: `pm2 stop baileys-api`
Garantir inicialização no boot do servidor: `pm2 startup && pm2 save`
---
Opção 2: Instalação via Docker & Docker Compose (Mais Prático)
> **Recomendado para servidores a partir de 2 GB de RAM ou quem busca isolamento total.**  
> Não requer instalação de Node.js no host e funciona identicamente em qualquer distribuição Linux.
Passo 1: Clone o repositório
```bash
git clone https://github.com/rddr14/baileys-api.git
cd baileys-api
```
Passo 2: Prepare o arquivo de ambiente
```bash
cp .env.example .env
```
(Opcional: edite o `.env` com `nano .env` para alterar a porta padrão `3000` ou o modo de proteção dos botões se desejar)
Passo 3: Inicie o container em segundo plano
```bash
docker compose up -d --build
```
Comandos úteis no dia a dia (Docker):
Ver logs em tempo real: `docker compose logs -f`
Status do container: `docker compose ps`
Reiniciar container: `docker compose restart`
Parar aplicação: `docker compose down`
Atualizar código: `git pull && docker compose up -d --build`
---
⚙️ Variáveis de Ambiente (`.env`)
Variável	Padrão	Descrição
`PORT`	`3000`	Porta HTTP onde a API e o Dashboard ficarão acessíveis
`WEBHOOK_URL`	`http://localhost:8000/api/whatsapp/webhook`	URL global de fallback para disparo de webhooks
`BUTTONS_MODE`	`smart_fallback`	Modo global padrão para envio de botões (`smart_fallback`, `dual`, `text_only` ou `button_only`)
`BUTTONS_FALLBACK_TIMEOUT_MS`	`12000`	Tempo limite (em ms) para aguardar o 2º check (`DELIVERY_ACK`) antes de disparar o fallback em texto
---
📑 Documentação dos Endpoints
Visão Geral e Compatibilidade com EvolutionApiService
Gestão de Grupos (fetchGroups, participantes e adição)
Gerenciamento de Instâncias, Status Online e Proteção de Botões
Envio de Mensagens, Mídias e Botões (Pix & 2FA)
Contatos, Perfil e Verificação de Números
Presença e Leitura (Typing, Recording, Read)
Histórico e Download de Mídias
Etiquetas / Labels (WhatsApp Business)
Webhooks Multi-Sessão
---
⚡ 1. Compatibilidade com `EvolutionApiService`
Todas as funções presentes no arquivo `/var/srv/app/Services/EvolutionApiService.php` foram mapeadas e implementadas na API:
Função no PHP (`EvolutionApiService`)	Endpoint HTTP da Evolution API	Suporte Baileys API
`fetchGroups()`	`GET /group/fetchAllGroups/{instance}`	✅ Retorna id, subject, owner, creation, size
`fetchGroupMembers($groupJid)`	`GET /group/participants/{instance}?groupJid=...`	✅ Retorna participantes, phoneNumber e admin
`addGroupParticipant($jid, $parts)`	`POST /group/updateParticipant/{instance}`	✅ Adiciona/atualiza membros no grupo
`startSession()`	`GET /instance/connect/{instance}`	✅ Conecta e retorna QR Code base64
`checkSessionStatus()`	`GET /instance/connectionState/{instance}`	✅ Retorna open, qrcode ou close
`createInstance()`	`POST /instance/create`	✅ Cria e inicializa a sessão
`logoutSession()`	`DELETE /instance/logout/{instance}`	✅ Desconecta a sessão
`deleteSession()` / `closeSession()`	`DELETE /instance/delete/{instance}`	✅ Remove credenciais e zera sessão
`findWebhookConfig()`	`GET /webhook/find/{instance}`	✅ Retorna status e URL configurada
`setWebhookConfig($payload)`	`POST /webhook/set/{instance}`	✅ Salva e ativa o webhook
`sendMessage()` / `sendText()`	`POST /message/sendText/{instance}`	✅ Envia mensagem de texto com quotedId
`sendButtons()`	`POST /message/sendButtons/{instance}`	✅ Envia botões (`copy`, `quick_reply`, `url`, `call`) com proteção
`forwardMessage()`	`POST /message/forwardMessage/{instance}`	✅ Encaminha mensagem existente
`sendListMessage()`	`POST /message/sendText/{instance}`	✅ Envia menu formatado com opções
`sendContactVcard()`	`POST /message/sendContact/{instance}`	✅ Envia vCard formatado
`sendPollMessage()`	`POST /message/sendPoll/{instance}`	✅ Envia enquete interativa nativa
`sendImage()`	`POST /message/sendMedia/{instance}`	✅ Suporta URL ou Base64
`sendFileBase64()` / `sendFileFromUrl()`	`POST /message/sendMedia/{instance}`	✅ Suporta arquivos e documentos
`sendVoiceBase64()` / `sendAudio()`	`POST /message/sendWhatsAppAudio/{instance}`	✅ Envia áudio PTT (gravado na hora)
`checkNumber($phone)`	`POST /chat/whatsappNumbers/{instance}`	✅ Valida se existe e resolve JID
`sendLocation()`	`POST /message/sendLocation/{instance}`	✅ Envia localização geográfica
`markAsRead()`	`POST /chat/markMessageAsRead/{instance}`	✅ Marca mensagem como lida
`markUnread()` / `markChatUnread()`	`POST /chat/markChatUnread/{instance}`	✅ Marca conversa como não lida
`reactMessage()`	`POST /message/reaction/{instance}`	✅ Reage com emoji
`sendTyping()` / `sendRecording()`	`POST /chat/sendPresence/{instance}`	✅ Simula 'digitando' ou 'gravando'
`findLabels()`	`GET /label/findLabels/{instance}`	✅ Lista etiquetas
`handleLabel()`	`POST /label/handleLabel/{instance}`	✅ Adiciona/remove etiqueta do chat
`fetchContacts()`	`POST /chat/findChats/{instance}`	✅ Lista contatos e últimas mensagens
`findContacts($filters)`	`POST /chat/findContacts/{instance}`	✅ Consulta contatos por número ou nome (com equivalência de 9º dígito e sem duplicatas `@lid`)
`updateContact($phone, $name)`	`POST /chat/updateContact/{instance}`	✅ Atualiza/define nome na agenda local da sessão
`syncContacts()`	`POST /chat/syncContacts/{instance}`	✅ Força ressincronização de contatos e AppState
`fetchHistory()`	`POST /chat/findMessages/{instance}`	✅ Retorna histórico paginado
`getMediaBase64()`	`POST /chat/getBase64FromMediaMessage/{instance}`	✅ Retorna base64 da mídia
`getProfilePicture()`	`POST /chat/fetchProfilePictureUrl/{instance}`	✅ Retorna URL da foto de perfil
`setOnlineStatus($bool)`	`PUT /instance/update/{instance}`	✅ Atualiza `alwaysOnline` e `buttonSettings`

> 📖 **Documentação Interativa RESTful:** Acesse `http://localhost:3000/docs` (ou `https://baileys.novo.quarkgps.com/docs`) para visualizar todos os endpoints, parâmetros, regras Baileys/Evolution e exemplos copiáveis em cURL, PHP e JS.
---
👥 2. Gestão de Grupos
A. Listar Grupos em que a Instância Participa (`fetchGroups`)
Endpoint Evolution: `GET /group/fetchAllGroups/:instance?getParticipants=false`
Endpoint Nativo Baileys: `GET /api/:sessionId/groups`
```bash
curl -X GET "http://localhost:3000/group/fetchAllGroups/minha_instancia?getParticipants=false"
```
B. Listar Membros do Grupo (`fetchGroupMembers`)
Endpoint Evolution: `GET /group/participants/:instance?groupJid=120363406397022141@g.us`
Endpoint Nativo Baileys: `GET /api/:sessionId/groups/:groupJid/participants`
```bash
curl -X GET "http://localhost:3000/group/participants/minha_instancia?groupJid=556185990051-1487599073@g.us"
```
C. Adicionar/Remover Membros do Grupo (`addGroupParticipant`)
Endpoint Evolution: `POST /group/updateParticipant/:instance`
Endpoint Nativo Baileys: `POST /api/:sessionId/groups/:groupJid/participants`
```bash
curl -X POST "http://localhost:3000/group/updateParticipant/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "groupJid": "556185990051-1487599073@g.us",
    "action": "add",
    "participants": ["5561999999999"]
  }'
```
(Opções de action: `add`, `remove`, `promote`, `demote`)
---
📱 3. Instâncias e Sessões
Conectar / Obter QR Code: `GET /instance/connect/:instance` ou `GET /api/:sessionId/qr`
Verificar Estado da Conexão: `GET /instance/connectionState/:instance` ou `GET /api/:sessionId/status`
Listar Todas as Instâncias: `GET /instance/fetchInstances` ou `GET /api/sessions`
Desconectar Instância: `DELETE /instance/logout/:instance` ou `POST /api/:sessionId/logout`
Excluir Instância (Reset Total): `DELETE /instance/delete/:instance` ou `DELETE /api/:sessionId/session`
Consultar status online: `GET /api/:sessionId/online-status`
Configurar status online: `PUT /api/:sessionId/online-status` com `{"showOnline": true}` ou `{"showOnline": false}`
Consultar proteção de botões: `GET /api/:sessionId/button-settings`
Configurar proteção de botões: `PUT /api/:sessionId/button-settings` com `{"mode": "smart_fallback", "fallbackTimeoutMs": 12000}`
Por padrão, cada sessão não aparece como online (`showOnline: false`) e utiliza o modo `smart_fallback` para botões interativos. Ambas as preferências são salvas em `session_settings.json` e reaplicadas automaticamente ao reiniciar o servidor.
---
💬 4. Envio de Mensagens e Mídias
A. Envio de Texto
```bash
curl -X POST "http://localhost:3000/message/sendText/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "text": "Olá! Segue sua mensagem."
  }'
```
B. Envio de Botões Interativos e Proteção Anti-Bloqueio (Pix & 2FA)
Você pode enviar botões usando:
Rota Completa (Nativa): `POST /api/:sessionId/messages/buttons`
Rota Simplificada (Atalho Pix/2FA): `POST /api/:sessionId/messages/copy`
Rota Compatível Evolution: `POST /message/sendButtons/:instance`
Tipos de botões suportados no array `buttons`:
Tipo (`type`)	Campos adicionais	Ação no WhatsApp
`copy`	`code`	Copia o código Pix Copia e Cola ou senha 2FA para a área de transferência (`cta_copy`)
`quick_reply`	`id` (opcional)	Envia uma resposta rápida de volta ao chat/webhook
`url`	`url`	Abre um link externo no navegador (`cta_url`)
`call`	`phone`	Inicia uma chamada telefônica para o número indicado (`cta_call`)
🛡️ Modos de Proteção Anti-Bloqueio (`protectionMode`):
Para evitar que atualizações silenciosas da Meta impeçam o cliente de receber códigos críticos (Pix ou 2FA), a API oferece 4 modos de operação (configuráveis por sessão no painel ou individualmente por requisição):
`smart_fallback` (Padrão recomendado): Envia a mensagem com o botão interativo e monitora os eventos `messages.update` e `message-receipt.update`. Se o aparelho de destino não confirmar o 2º check (`status >= 3`) dentro de `fallbackTimeoutMs` (padrão `12000` ms), a API envia automaticamente o texto principal seguido de um balão isolado apenas com o código puro.
`dual` (Dupla garantia): Envia o card com o botão interativo e, 600ms depois, envia o código puro isolado em um segundo balão. Ideal para clientes que usam versões antigas do WhatsApp Web.
`text_only` (Kill-Switch / Contingência imediata): Ignora o envio de `interactiveMessage` e dispara diretamente a mensagem em texto formatado + um balão separado contendo apenas o código Pix/2FA puro (fácil de copiar com um toque). Permite contornar bloqueios globais da Meta imediatamente pelo painel sem alterar o código do seu ERP/sistema.
`button_only`: Envia exclusivamente o botão nativo, sem disparar mensagens secundárias.
Exemplo 1: Envio de Pix Copia e Cola ou 2FA (Rota Completa)
```bash
curl -X POST "http://localhost:3000/api/minha_instancia/messages/buttons" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "title": "Código de Verificação (2FA)",
    "body": "Seu código de acesso descartável é *849201*.\nToque no botão abaixo para copiar:",
    "footer": "Quark GPS • Expira em 5 minutos",
    "protectionMode": "smart_fallback",
    "fallbackTimeoutMs": 12000,
    "buttons": [
      {
        "type": "copy",
        "text": "Copiar Código 2FA",
        "code": "849201"
      }
    ]
  }'
```
Exemplo 2: Rota de Atalho Dedicada para Pix / 2FA (`/messages/copy`)
```bash
curl -X POST "http://localhost:3000/api/minha_instancia/messages/copy" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "title": "Fatura em Aberto • Pix",
    "body": "Utilize o botão abaixo para copiar o código Pix Copia e Cola:",
    "footer": "Pagamento com baixa automática",
    "buttonText": "Copiar Chave Pix",
    "code": "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000"
  }'
```
Exemplo 3: Múltiplos Botões Combinados (`quick_reply`, `url` e `copy`)
```bash
curl -X POST "http://localhost:3000/api/minha_instancia/messages/buttons" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "title": "Atendimento",
    "body": "Escolha uma opção ou copie o código.",
    "footer": "Quark GPS",
    "buttons": [
      {
        "type": "quick_reply",
        "text": "Falar com atendente",
        "id": "falar_atendente"
      },
      {
        "type": "url",
        "text": "Abrir portal",
        "url": "https://example.com"
      },
      {
        "type": "copy",
        "text": "Copiar código",
        "code": "554499"
      }
    ]
  }'
```
C. Envio de Áudio PTT (Gravado na hora)
```bash
curl -X POST "http://localhost:3000/message/sendWhatsAppAudio/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "audio": "data:audio/ogg;base64,GkXfo59ChoEBQveBAULygQRC..."
  }'
```
D. Envio de Imagem ou Documento com Legenda
```bash
curl -X POST "http://localhost:3000/message/sendMedia/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "mediatype": "document",
    "media": "https://meudominio.com/contrato.pdf",
    "fileName": "Contrato.pdf",
    "caption": "Seu contrato em anexo."
  }'
```
E. Envio de Enquete Nativa (`sendPollMessage`)
```bash
curl -X POST "http://localhost:3000/message/sendPoll/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "name": "Qual o melhor dia para a visita?",
    "values": ["Segunda-feira", "Quarta-feira", "Sexta-feira"],
    "selectableCount": 1
  }'
```
---
🔍 5. Contatos, Perfil e Verificação
Verificar Número no WhatsApp (`checkNumber`)
```bash
curl -X POST "http://localhost:3000/chat/whatsappNumbers/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["556191748140", "5511999999999"]
  }'
```
Buscar Foto de Perfil e Status (`getProfilePicture`)
Endpoint Evolution: `POST /chat/fetchProfilePictureUrl/:instance`
Endpoint Nativo Completo: `GET /api/:sessionId/profile/:phone`
```bash
curl -X POST "http://localhost:3000/chat/fetchProfilePictureUrl/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{ "number": "556191748140" }'
```
---
⏳ 6. Presença e Leitura
Simular Digitando ou Gravando Áudio:
```bash
curl -X POST "http://localhost:3000/chat/sendPresence/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "presence": "composing",
    "delay": 3000
  }'
```
Marcar Mensagem como Lida (Blue Ticks):
```bash
curl -X POST "http://localhost:3000/chat/markMessageAsRead/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "readMessages": [
      { "remoteJid": "556191748140@s.whatsapp.net", "id": "3EB047DDFA672AD9CBBADF" }
    ]
  }'
```
---
🗂️ 7. Histórico e Download de Mídias
Consultar Histórico de Mensagens (`fetchHistory`)
```bash
curl -X POST "http://localhost:3000/chat/findMessages/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "where": {
      "key": { "remoteJid": "556191748140@s.whatsapp.net" }
    },
    "options": { "offset": 20 }
  }'
```
Baixar Mídia de uma Mensagem em Base64 (`getMediaBase64`)
Endpoint Evolution: `POST /chat/getBase64FromMediaMessage/:instance`
Endpoint Nativo Baileys: `GET /api/:sessionId/messages/download-media/:messageId`
```bash
curl -X POST "http://localhost:3000/chat/getBase64FromMediaMessage/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "key": { "id": "3EB047DDFA672AD9CBBADF" }
    }
  }'
```
---
🏷️ 8. Etiquetas / Labels (WhatsApp Business)
Listar Etiquetas (`findLabels`): `GET /label/findLabels/:instance` ou `GET /api/:sessionId/labels`
Criar Nova Etiqueta: `POST /api/:sessionId/labels/create` com `{"name": "Cliente VIP", "color": 5}`
Excluir Etiqueta: `DELETE /api/:sessionId/labels/:labelId`
Vincular/Remover Etiqueta do Chat (`handleLabel`):
```bash
curl -X POST "http://localhost:3000/label/handleLabel/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "labelId": "1",
    "action": "add"
  }'
```
---
🔔 9. Webhooks Multi-Sessão
Cada sessão pode enviar eventos para o seu sistema em tempo real.
Configurar Webhook: `POST /webhook/set/:instance` ou `POST /api/:sessionId/webhook`
```bash
curl -X POST "http://localhost:3000/webhook/set/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://meudominio.com/api/webhook" }'
```
Eventos disparados:
`messages.upsert`: Novas mensagens recebidas ou enviadas (incluindo respostas de botões `quick_reply`).
`messages.update`: Edições e atualizações de status de entrega (`status: 3` = entregue / 2 checks, `status: 4` = lida).
`message-receipt.update`: Confirmação detalhada de recebimento e leitura pelo aparelho.
`connection.update`: Atualização do estado do WebSocket e geração de QR Code.