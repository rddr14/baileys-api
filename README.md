# Baileys WhatsApp API Engine & Evolution API Compatibility Layer

Esta API REST foi desenvolvida em Node.js com a biblioteca `@whiskeysockets/baileys` e oferece:
1. **Camada Nativa Baileys API** (`/api/:sessionId/...`) para controle total de sessões, mensagens, mídias e labels.
2. **Camada de Compatibilidade Direta com Evolution API v2** (atendendo chamadas com ou sem prefixo `/api` como `/group/fetchAllGroups/{instance}`, `/message/sendText/{instance}`, etc.), permitindo que services PHP/Laravel (`EvolutionApiService.php` ou `BaileysApiService.php`) funcionem sem qualquer alteração.
3. **Multi-Sessões Simultâneas** com reconexão automática e webhooks individuais por instância.

---

## 🚀 Guia de Instalação no Servidor

Você pode instalar a API em qualquer servidor VPS (Ubuntu, Debian, etc.) de duas maneiras:

---

### Opção 1: Instalação Nativa via SSH com PM2 (Mais Leve)
> **Recomendado para servidores com pouca memória RAM (1 GB a 2 GB).**  
> Consumo mínimo de recursos, sem o overhead de containers.

#### Passo 1: Conecte via SSH no servidor e clone o repositório
```bash
git clone https://github.com/rddr14/baileys-api.git
cd baileys-api
```

#### Passo 2: Execute o script de instalação automatizado
O instalador cuidará de atualizar os pacotes, instalar o Node.js 20 LTS, o PM2, as dependências do projeto e subir a aplicação:
```bash
chmod +x install.sh
./install.sh
```

#### Comandos úteis no dia a dia (PM2):
* **Ver logs em tempo real:** `pm2 logs baileys-api`
* **Status do serviço:** `pm2 status`
* **Reiniciar aplicação:** `pm2 restart baileys-api`
* **Parar aplicação:** `pm2 stop baileys-api`
* **Garantir inicialização no boot do servidor:** `pm2 startup && pm2 save`

---

### Opção 2: Instalação via Docker & Docker Compose (Mais Prático)
> **Recomendado para servidores a partir de 2 GB de RAM ou quem busca isolamento total.**  
> Não requer instalação de Node.js no host e funciona identicamente em qualquer distribuição Linux.

#### Passo 1: Clone o repositório
```bash
git clone https://github.com/rddr14/baileys-api.git
cd baileys-api
```

#### Passo 2: Prepare o arquivo de ambiente
```bash
cp .env.example .env
```
*(Opcional: edite o `.env` com `nano .env` para alterar a porta padrão `3000` se desejar)*

#### Passo 3: Inicie o container em segundo plano
```bash
docker compose up -d --build
```

#### Comandos úteis no dia a dia (Docker):
* **Ver logs em tempo real:** `docker compose logs -f`
* **Status do container:** `docker compose ps`
* **Reiniciar container:** `docker compose restart`
* **Parar aplicação:** `docker compose down`
* **Atualizar código:** `git pull && docker compose up -d --build`

---

## ⚙️ Variáveis de Ambiente (`.env`)

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta HTTP onde a API ficará acessível |
| `WEBHOOK_URL` | `http://localhost:8000/api/whatsapp/webhook` | URL global de fallback para disparo de webhooks |

---

## 📑 Documentação dos Endpoints

1. [Visão Geral e Compatibilidade com EvolutionApiService](#-1-compatibilidade-com-evolutionapiservice)
2. [Gestão de Grupos (fetchGroups, participantes e adição)](#-2-gestão-de-grupos)
3. [Gerenciamento de Instâncias e Sessões](#-3-instâncias-e-sessões)
4. [Envio de Mensagens e Mídias](#-4-envio-de-mensagens-e-mídias)
5. [Contatos, Perfil e Verificação de Números](#-5-contatos-perfil-e-verificação)
6. [Presença e Leitura (Typing, Recording, Read)](#-6-presença-e-leitura)
7. [Histórico e Download de Mídias](#-7-histórico-e-download-de-mídias)
8. [Etiquetas / Labels (WhatsApp Business)](#-8-etiquetas--labels-whatsapp-business)
9. [Webhooks Multi-Sessão](#-9-webhooks-multi-sessão)

---

## ⚡ 1. Compatibilidade com `EvolutionApiService`

Todas as funções presentes no arquivo `/var/srv/app/Services/EvolutionApiService.php` foram mapeadas e implementadas na API:

| Função no PHP (`EvolutionApiService`) | Endpoint HTTP da Evolution API | Suporte Baileys API |
| :--- | :--- | :--- |
| `fetchGroups()` | `GET /group/fetchAllGroups/{instance}` | ✅ Retorna id, subject, owner, creation, size |
| `fetchGroupMembers($groupJid)` | `GET /group/participants/{instance}?groupJid=...` | ✅ Retorna participantes, phoneNumber e admin |
| `addGroupParticipant($jid, $parts)`| `POST /group/updateParticipant/{instance}` | ✅ Adiciona/atualiza membros no grupo |
| `startSession()` | `GET /instance/connect/{instance}` | ✅ Conecta e retorna QR Code base64 |
| `checkSessionStatus()` | `GET /instance/connectionState/{instance}` | ✅ Retorna open, qrcode ou close |
| `createInstance()` | `POST /instance/create` | ✅ Cria e inicializa a sessão |
| `logoutSession()` | `DELETE /instance/logout/{instance}` | ✅ Desconecta a sessão |
| `deleteSession()` / `closeSession()` | `DELETE /instance/delete/{instance}` | ✅ Remove credenciais e zera sessão |
| `findWebhookConfig()` | `GET /webhook/find/{instance}` | ✅ Retorna status e URL configurada |
| `setWebhookConfig($payload)` | `POST /webhook/set/{instance}` | ✅ Salva e ativa o webhook |
| `sendMessage()` / `sendText()` | `POST /message/sendText/{instance}` | ✅ Envia mensagem de texto com quotedId |
| `forwardMessage()` | `POST /message/forwardMessage/{instance}` | ✅ Encaminha mensagem existente |
| `sendListMessage()` | `POST /message/sendText/{instance}` | ✅ Envia menu formatado com opções |
| `sendContactVcard()` | `POST /message/sendContact/{instance}` | ✅ Envia vCard formatado |
| `sendPollMessage()` | `POST /message/sendPoll/{instance}` | ✅ Envia enquete interativa nativa |
| `sendImage()` | `POST /message/sendMedia/{instance}` | ✅ Suporta URL ou Base64 |
| `sendFileBase64()` / `sendFileFromUrl()` | `POST /message/sendMedia/{instance}` | ✅ Suporta arquivos e documentos |
| `sendVoiceBase64()` / `sendAudio()` | `POST /message/sendWhatsAppAudio/{instance}`| ✅ Envia áudio PTT (gravado na hora) |
| `checkNumber($phone)` | `POST /chat/whatsappNumbers/{instance}` | ✅ Valida se existe e resolve JID |
| `sendLocation()` | `POST /message/sendLocation/{instance}` | ✅ Envia localização geográfica |
| `markAsRead()` | `POST /chat/markMessageAsRead/{instance}` | ✅ Marca mensagem como lida |
| `markUnread()` / `markChatUnread()` | `POST /chat/markChatUnread/{instance}` | ✅ Marca conversa como não lida |
| `reactMessage()` | `POST /message/reaction/{instance}` | ✅ Reage com emoji |
| `sendTyping()` / `sendRecording()` | `POST /chat/sendPresence/{instance}` | ✅ Simula 'digitando' ou 'gravando' |
| `findLabels()` | `GET /label/findLabels/{instance}` | ✅ Lista etiquetas |
| `handleLabel()` | `POST /label/handleLabel/{instance}` | ✅ Adiciona/remove etiqueta do chat |
| `fetchContacts()` | `POST /chat/findChats/{instance}` | ✅ Lista contatos e últimas mensagens |
| `fetchHistory()` | `POST /chat/findMessages/{instance}` | ✅ Retorna histórico paginado |
| `getMediaBase64()` | `POST /chat/getBase64FromMediaMessage/{instance}` | ✅ Retorna base64 da mídia |
| `getProfilePicture()` | `POST /chat/fetchProfilePictureUrl/{instance}` | ✅ Retorna URL da foto de perfil |

---

## 👥 2. Gestão de Grupos

### A. Listar Grupos em que a Instância Participa (`fetchGroups`)
- **Endpoint Evolution:** `GET /group/fetchAllGroups/:instance?getParticipants=false`
- **Endpoint Nativo Baileys:** `GET /api/:sessionId/groups`
```bash
curl -X GET "http://localhost:3000/group/fetchAllGroups/minha_instancia?getParticipants=false"
```

### B. Listar Membros do Grupo (`fetchGroupMembers`)
- **Endpoint Evolution:** `GET /group/participants/:instance?groupJid=120363406397022141@g.us`
- **Endpoint Nativo Baileys:** `GET /api/:sessionId/groups/:groupJid/participants`
```bash
curl -X GET "http://localhost:3000/group/participants/minha_instancia?groupJid=556185990051-1487599073@g.us"
```

### C. Adicionar/Remover Membros do Grupo (`addGroupParticipant`)
- **Endpoint Evolution:** `POST /group/updateParticipant/:instance`
- **Endpoint Nativo Baileys:** `POST /api/:sessionId/groups/:groupJid/participants`
```bash
curl -X POST "http://localhost:3000/group/updateParticipant/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "groupJid": "556185990051-1487599073@g.us",
    "action": "add",
    "participants": ["5561999999999"]
  }'
```
*(Opções de action: `add`, `remove`, `promote`, `demote`)*

---

## 📱 3. Instâncias e Sessões

- **Conectar / Obter QR Code:** `GET /instance/connect/:instance` ou `GET /api/:sessionId/qr`
- **Verificar Estado da Conexão:** `GET /instance/connectionState/:instance` ou `GET /api/:sessionId/status`
- **Listar Todas as Instâncias:** `GET /instance/fetchInstances` ou `GET /api/sessions`
- **Desconectar Instância:** `DELETE /instance/logout/:instance` ou `POST /api/:sessionId/logout`
- **Excluir Instância (Reset Total):** `DELETE /instance/delete/:instance` ou `DELETE /api/:sessionId/session`

---

## 💬 4. Envio de Mensagens e Mídias

### Envio de Texto
```bash
curl -X POST "http://localhost:3000/message/sendText/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "text": "Olá! Segue sua mensagem."
  }'
```

### Envio de Áudio PTT (Gravado na hora)
```bash
curl -X POST "http://localhost:3000/message/sendWhatsAppAudio/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "audio": "data:audio/ogg;base64,GkXfo59ChoEBQveBAULygQRC..."
  }'
```

### Envio de Imagem ou Documento com Legenda
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

### Envio de Enquete Nativa (`sendPollMessage`)
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

## 🔍 5. Contatos, Perfil e Verificação

### Verificar Número no WhatsApp (`checkNumber`)
```bash
curl -X POST "http://localhost:3000/chat/whatsappNumbers/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["556191748140", "5511999999999"]
  }'
```

### Buscar Foto de Perfil (`getProfilePicture`)
```bash
curl -X POST "http://localhost:3000/chat/fetchProfilePictureUrl/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{ "number": "556191748140" }'
```

---

## ⏳ 6. Presença e Leitura

- **Simular Digitando ou Gravando Áudio:**
```bash
curl -X POST "http://localhost:3000/chat/sendPresence/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "556191748140",
    "presence": "composing",
    "delay": 3000
  }'
```

- **Marcar Mensagem como Lida (Blue Ticks):**
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

## 🏷️ 7. Etiquetas / Labels (WhatsApp Business)

- **Listar Etiquetas (`findLabels`):** `GET /label/findLabels/:instance` ou `GET /api/:sessionId/labels`
- **Vincular Etiqueta ao Chat (`handleLabel`):**
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

## 🔔 8. Webhooks Multi-Sessão

Cada sessão pode enviar eventos para o seu sistema em tempo real.
- **Configurar Webhook:** `POST /webhook/set/:instance` ou `POST /api/:sessionId/webhook`
```bash
curl -X POST "http://localhost:3000/webhook/set/minha_instancia" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://meudominio.com/api/webhook" }'
```

**Eventos disparados:**
- `messages.upsert`: Novas mensagens recebidas ou enviadas.
- `messages.update`: Edições e atualizações de status.
- `message-receipt.update`: Confirmação de entrega e leitura.
- `connection.update`: Atualização do estado do WebSocket.
