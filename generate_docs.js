const fs = require('fs');
const path = require('path');

const endpointsData = [
    // ---------------- INSTÂNCIAS ----------------
    {
        category: "Instâncias & Sessões",
        id: "fetch-instances",
        method: "GET",
        path: "/instance/fetchInstances",
        tag: "Evolution Compat",
        summary: "Listar todas as instâncias",
        description: "Retorna a lista completa de instâncias cadastradas nos formatos Evolution v2 (raiz) e v1 (bloco instance), com status, número do proprietário, nome do perfil, alwaysOnline e buttonMode.",
        headers: { "Content-Type": "application/json" },
        queryParams: [],
        body: null,
        response: [
            {
                name: "quark_vendas2",
                instanceName: "quark_vendas2",
                token: "quark_vendas2",
                connectionStatus: "open",
                ownerJid: "556196829335@s.whatsapp.net",
                profileName: "Quarkgps",
                profilePicUrl: null,
                buttonMode: "smart_fallback",
                alwaysOnline: false,
                instance: {
                    instanceName: "quark_vendas2",
                    owner: "556196829335@s.whatsapp.net",
                    profileName: "Quarkgps",
                    profilePictureUrl: null,
                    state: "open",
                    status: "open"
                }
            }
        ]
    },
    {
        category: "Instâncias & Sessões",
        id: "create-instance",
        method: "POST",
        path: "/instance/create",
        tag: "Evolution Compat",
        summary: "Criar ou inicializar instância",
        description: "Cria uma nova instância e inicia o socket Baileys. Aceita webhook como string ou objeto { url, enabled } e aplica alwaysOnline/showOnline se informado.",
        headers: { "Content-Type": "application/json" },
        body: {
            instanceName: "minha_instancia",
            alwaysOnline: false,
            webhook: {
                enabled: true,
                url: "https://meusite.com/webhook"
            }
        },
        response: {
            instance: {
                instanceName: "minha_instancia",
                status: "created"
            },
            hash: {
                apikey: "minha_instancia"
            }
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "connect-instance",
        method: "GET",
        path: "/instance/connect/{instance}",
        tag: "Evolution Compat",
        summary: "Conectar e obter QR Code",
        description: "Inicia a conexão da instância com os servidores do WhatsApp e retorna a string e imagem Base64 do QR Code para leitura.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome identificador da instância (ex: quark_vendas2)" }],
        body: null,
        response: {
            base64: "data:image/png;base64,iVBORw0KGgo...",
            qrcode: "data:image/png;base64,iVBORw0KGgo...",
            instance: {
                instanceName: "quark_vendas2",
                state: "qrcode"
            }
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "connection-state",
        method: "GET",
        path: "/instance/connectionState/{instance}",
        tag: "Evolution Compat",
        summary: "Consultar estado da conexão",
        description: "Verifica se a instância está conectada ('open'), aguardando leitura de QR ('qrcode') ou desconectada ('close').",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: {
            instance: {
                instanceName: "quark_vendas2",
                state: "open"
            }
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "update-instance",
        method: "PUT",
        path: "/instance/update/{instance}",
        tag: "Evolution Compat",
        summary: "Atualizar configurações da instância",
        description: "Persiste configurações da instância como presença online permanente (alwaysOnline / showOnline) e modo de proteção dos botões Pix/2FA (mode / protectionMode / fallbackTimeoutMs).",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            alwaysOnline: false,
            mode: "smart_fallback",
            fallbackTimeoutMs: 12000
        },
        response: {
            status: "SUCCESS",
            message: "Configurações atualizadas",
            alwaysOnline: false,
            buttonSettings: {
                mode: "smart_fallback",
                fallbackTimeoutMs: 12000
            }
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "logout-instance",
        method: "DELETE",
        path: "/instance/logout/{instance}",
        tag: "Evolution Compat",
        summary: "Desconectar sessão (Logout)",
        description: "Envia o comando de logout ao WhatsApp sem apagar os dados salvos no banco local.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: {
            status: "SUCCESS",
            message: "Desconectado com sucesso"
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "delete-instance",
        method: "DELETE",
        path: "/instance/delete/{instance}",
        tag: "Evolution Compat",
        summary: "Excluir e resetar instância",
        description: "Desconecta e remove permanentemente as credenciais e arquivos de autenticação SQLite do disco.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: {
            status: "SUCCESS",
            message: "Instância removida com sucesso"
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "get-online-status",
        method: "GET",
        path: "/api/{sessionId}/online-status",
        tag: "Nativo Baileys",
        summary: "Consultar status online configurado",
        description: "Retorna se a sessão está configurada para aparecer como Online (available) automaticamente ao conectar.",
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: null,
        response: {
            success: true,
            showOnline: false
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "put-online-status",
        method: "PUT",
        path: "/api/{sessionId}/online-status",
        tag: "Nativo Baileys",
        summary: "Alterar status online (available / unavailable)",
        description: "Salva a preferência de visibilidade online em session_settings.json e aplica imediatamente no socket conectado.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: {
            showOnline: false
        },
        response: {
            success: true,
            showOnline: false,
            message: "Status online atualizado com sucesso."
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "get-button-settings",
        method: "GET",
        path: "/api/{sessionId}/button-settings",
        tag: "Nativo Baileys",
        summary: "Consultar proteção anti-bloqueio de botões",
        description: "Retorna o modo de proteção ativo para botões interativos (smart_fallback, dual, text_only ou button_only) e o timeout de fallback.",
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: null,
        response: {
            success: true,
            mode: "smart_fallback",
            fallbackTimeoutMs: 12000
        }
    },
    {
        category: "Instâncias & Sessões",
        id: "put-button-settings",
        method: "PUT",
        path: "/api/{sessionId}/button-settings",
        tag: "Nativo Baileys",
        summary: "Configurar proteção anti-bloqueio de botões",
        description: "Altera o modo padrão da sessão para envio de botões Pix e 2FA (Kill-Switch instantâneo via text_only ou smart_fallback).",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: {
            mode: "smart_fallback",
            fallbackTimeoutMs: 12000
        },
        response: {
            success: true,
            mode: "smart_fallback",
            fallbackTimeoutMs: 12000,
            message: "Configuração de proteção de botões salva com sucesso."
        }
    },

    // ---------------- MENSAGENS ----------------
    {
        category: "Envio de Mensagens",
        id: "send-text",
        method: "POST",
        path: "/message/sendText/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar mensagem de texto",
        description: "Envia mensagem de texto simples ou com citação de mensagem anterior (quoted/quotedId) e suporte a delay/typingDelay simulando digitação antes do envio.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            text: "Olá! Como podemos ajudar você hoje?",
            delay: 1200,
            quoted: {
                key: {
                    id: "AC0194EA5636AC624A511CA447832E25"
                }
            }
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0CA1234567890ABCDEF"
            },
            message: {
                conversation: "Olá! Como podemos ajudar você hoje?"
            },
            messageTimestamp: 1787870700,
            status: "PENDING"
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-buttons",
        method: "POST",
        path: "/message/sendButtons/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar botões interativos (PIX, URL, 2FA, Respostas)",
        description: "Envia botões nativos modernos com os 4 modos de proteção anti-bloqueio (smart_fallback, dual, text_only, button_only). Suporta copy, url, call e quick_reply.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            title: "Fatura QuarkGPS Disponível",
            description: "Olá Evanderson! Sua fatura no valor de R$ 99,90 já está disponível para pagamento.",
            footer: "Atendimento QuarkGPS",
            protectionMode: "smart_fallback",
            buttons: [
                {
                    type: "copy",
                    displayText: "Copiar Código Pix",
                    copyCode: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000"
                },
                {
                    type: "url",
                    displayText: "Ver Fatura Online",
                    url: "https://financeiro.quarkgps.com/fatura/12345"
                },
                {
                    type: "reply",
                    displayText: "Confirmar Pagamento",
                    id: "btn_confirmar_pagamento"
                }
            ]
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0FF8899AABBCCDDEEFF"
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-copy-shortcut",
        method: "POST",
        path: "/api/{sessionId}/messages/copy",
        tag: "Nativo Baileys",
        summary: "Atalho dedicado para Pix Copia e Cola / 2FA",
        description: "Endpoint simplificado que monta automaticamente o botão cta_copy com proteção anti-bloqueio ativa.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: {
            number: "5561991748140",
            title: "Fatura em Aberto • Pix",
            body: "Utilize o botão abaixo para copiar o código Pix:",
            footer: "Pagamento com baixa automática",
            buttonText: "Copiar Chave Pix",
            code: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000"
        },
        response: {
            success: true,
            modeUsed: "smart_fallback",
            fallbackTimeoutMs: 12000,
            messageId: "3EB0FF8899AABBCCDDEEFF",
            resolvedJid: "556191748140@s.whatsapp.net"
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-media",
        method: "POST",
        path: "/message/sendMedia/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar mídia (Imagem, Documento, Vídeo)",
        description: "Envia arquivos de imagem, áudio, vídeo ou PDF/documento via URL pública ou Base64, com suporte a delay e quoted.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            mediatype: "document",
            mimetype: "application/pdf",
            caption: "Segue a sua fatura detalhada em anexo.",
            media: "https://meusite.com/arquivos/fatura_12345.pdf",
            fileName: "Fatura_QuarkGPS.pdf"
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0CC9988776655443322"
            },
            message: {
                documentMessage: {
                    title: "Fatura_QuarkGPS.pdf"
                }
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-audio",
        method: "POST",
        path: "/message/sendWhatsAppAudio/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar áudio gravado na hora (PTT)",
        description: "Envia áudio como se tivesse sido gravado diretamente pelo microfone do WhatsApp (ptt: true), com simulação opcional de 'recording' via delay.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            audio: "https://meusite.com/audios/mensagem_boas_vindas.mp3",
            delay: 1500
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0DD1122334455667788"
            },
            message: {
                audioMessage: {
                    ptt: true
                }
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-contact",
        method: "POST",
        path: "/message/sendContact/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar cartão de contato (vCard)",
        description: "Envia um ou mais contatos formatados em vCard com nome completo e número de telefone.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            contact: [
                {
                    fullName: "Suporte Técnico QuarkGPS",
                    wuid: "556198775247",
                    phoneNumber: "+55 61 9877-5247"
                }
            ]
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0AA9988776655443311"
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-location",
        method: "POST",
        path: "/message/sendLocation/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar localização geográfica",
        description: "Envia um ponto geográfico com latitude, longitude, nome e endereço do local.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            name: "Sede QuarkGPS",
            address: "Brasília - DF, Brasil",
            latitude: -15.7942,
            longitude: -47.8822
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0BB1122334455667799"
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-poll",
        method: "POST",
        path: "/message/sendPoll/{instance}",
        tag: "Evolution Compat",
        summary: "Enviar enquete interativa",
        description: "Cria e envia uma votação interativa nativa com múltiplas opções para um chat individual ou grupo.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            name: "Como você avalia nosso atendimento?",
            values: [
                "Excelente 🌟",
                "Bom 👍",
                "Regular 😐",
                "Ruim 👎"
            ],
            selectableCount: 1
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0EE1122334455667700"
            }
        }
    },
    {
        category: "Envio de Mensagens",
        id: "send-reaction",
        method: "POST",
        path: "/message/reaction/{instance}",
        tag: "Evolution Compat",
        summary: "Reagir com emoji",
        description: "Insere ou remove uma reação emoji em uma mensagem existente.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: false,
                id: "AC0194EA5636AC624A511CA447832E25"
            },
            reaction: "👍"
        },
        response: {
            status: "SUCCESS"
        }
    },
    {
        category: "Envio de Mensagens",
        id: "forward-message",
        method: "POST",
        path: "/message/forwardMessage/{instance}",
        tag: "Evolution Compat",
        summary: "Encaminhar mensagem existente",
        description: "Encaminha uma mensagem armazenada no cache da sessão para outro número ou grupo (também responde no alias /message/forwardMessages/{instance}).",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            message: {
                key: {
                    remoteJid: "556191748140@s.whatsapp.net",
                    id: "AC0194EA5636AC624A511CA447832E25"
                }
            }
        },
        response: {
            key: {
                remoteJid: "556191748140@s.whatsapp.net",
                fromMe: true,
                id: "3EB0FF112233445566"
            }
        }
    },

    // ---------------- CONTATOS & PERFIL ----------------
    {
        category: "Contatos & Perfil",
        id: "find-contacts",
        method: "POST",
        path: "/chat/findContacts/{instance}",
        tag: "Evolution Compat",
        summary: "Consultar contatos por número ou nome",
        description: "Consulta contatos salvos no banco da sessão sem duplicatas @lid. Suporta busca por número (com equivalência automática do 9º dígito no Brasil e fallback online via onWhatsApp), por nome da agenda (name) ou perfil do WhatsApp (pushName).",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            where: {
                number: "5561991748140"
            }
        },
        response: [
            {
                id: "556191748140@s.whatsapp.net",
                remoteJid: "556191748140@s.whatsapp.net",
                number: "556191748140",
                name: "Evanderson Pimentel",
                pushName: "Evanderson Pimentel",
                pushname: "Evanderson Pimentel",
                verifiedName: null,
                lid: "256538430161035@lid"
            }
        ]
    },
    {
        category: "Contatos & Perfil",
        id: "whatsapp-numbers",
        method: "POST",
        path: "/chat/whatsappNumbers/{instance}",
        tag: "Evolution Compat",
        summary: "Validar se número possui WhatsApp (onWhatsApp)",
        description: "Valida em tempo real junto aos servidores do WhatsApp se uma lista de telefones possui conta ativa, retornando o JID oficial, nome, pushName e lid.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            numbers: ["5561991748140", "5511999999999"]
        },
        response: [
            {
                jid: "556191748140@s.whatsapp.net",
                exists: true,
                number: "5561991748140",
                name: "Evanderson Pimentel",
                pushName: "Evanderson Pimentel",
                pushname: "Evanderson Pimentel",
                lid: "256538430161035@lid"
            }
        ]
    },
    {
        category: "Contatos & Perfil",
        id: "get-profile",
        method: "GET",
        path: "/api/{sessionId}/profile/{phone}",
        tag: "Nativo Baileys",
        summary: "Perfil completo com Foto em alta resolução",
        description: "Retorna a existência do número, nome da agenda, pushName público, recado/status e a URL direta da Foto de Perfil em alta definição.",
        pathParams: [
            { name: "sessionId", description: "Identificador da sessão/instância" },
            { name: "phone", description: "Número de telefone com DDI e DDD (ex: 5561991748140)" }
        ],
        body: null,
        response: {
            exists: true,
            jid: "556191748140@s.whatsapp.net",
            number: "5561991748140",
            name: "Evanderson Pimentel",
            pushName: "Evanderson Pimentel",
            pushname: "Evanderson Pimentel",
            status: "Disponível",
            profilePicUrl: "https://pps.whatsapp.net/v/t61.24694-24/...",
            lid: null
        }
    },
    {
        category: "Contatos & Perfil",
        id: "native-contacts",
        method: "GET",
        path: "/api/{sessionId}/contacts",
        tag: "Nativo Baileys",
        summary: "Listar ou filtrar contatos (Nativo GET)",
        description: "Retorna contatos únicos da sessão com suporte a query params ?search=, ?number= ou ?name=.",
        pathParams: [{ name: "sessionId", description: "Identificador da sessão" }],
        queryParams: [
            { name: "search", description: "Busca livre por nome ou número" },
            { name: "number", description: "Filtra por número (com tolerância de 9º dígito)" },
            { name: "name", description: "Filtra por nome da agenda ou pushName" }
        ],
        body: null,
        response: {
            success: true,
            count: 1,
            contacts: [
                {
                    id: "556191748140@s.whatsapp.net",
                    number: "556191748140",
                    name: "Evanderson Pimentel",
                    pushName: "Evanderson Pimentel",
                    pushname: "Evanderson Pimentel"
                }
            ]
        }
    },
    {
        category: "Contatos & Perfil",
        id: "update-contact",
        method: "POST",
        path: "/chat/updateContact/{instance}",
        tag: "Evolution Compat",
        summary: "Definir ou atualizar nome do contato localmente",
        description: "Salva ou corrige o nome de contato na agenda local da sessão, permitindo atribuir apelidos ou nomes cadastrados no seu sistema/CRM.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "556191748140",
            name: "Gordinho",
            pushName: "Evanderson Pimentel"
        },
        response: {
            status: "SUCCESS",
            contact: {
                id: "556191748140@s.whatsapp.net",
                name: "Gordinho",
                notify: "Evanderson Pimentel"
            }
        }
    },
    {
        category: "Contatos & Perfil",
        id: "sync-contacts",
        method: "POST",
        path: "/chat/syncContacts/{instance}",
        tag: "Evolution Compat",
        summary: "Forçar ressincronização de contatos com o WhatsApp",
        description: "Dispara uma solicitação de ressincronização completa do AppState com o WhatsApp para puxar atualizações recentes de contatos e conversas do aparelho.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: {
            status: "SUCCESS",
            result: {
                success: true,
                message: "Ressincronização de AppState/contatos disparada."
            }
        }
    },

    // ---------------- CONVERSAS & HISTÓRICO ----------------
    {
        category: "Conversas & Histórico",
        id: "find-chats",
        method: "POST",
        path: "/chat/findChats/{instance}",
        tag: "Evolution Compat",
        summary: "Listar conversas recentes",
        description: "Retorna a lista de conversas salvas na sessão enriquecidas com dados da agenda/pushName e a última mensagem trocada.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {},
        response: [
            {
                remoteJid: "556191748140@s.whatsapp.net",
                remoteJidAlt: null,
                name: "Evanderson Pimentel",
                pushName: "Evanderson Pimentel",
                isSaved: true,
                lastMessage: {
                    messageTimestamp: 1787870700,
                    pushName: "Evanderson Pimentel",
                    message: {
                        conversation: "Tudo bem por aí?"
                    }
                }
            }
        ]
    },
    {
        category: "Conversas & Histórico",
        id: "find-messages",
        method: "POST",
        path: "/chat/findMessages/{instance}",
        tag: "Evolution Compat",
        summary: "Buscar mensagens do histórico com paginação",
        description: "Obtém as mensagens armazenadas de um determinado chat (com equivalência automática de 9º dígito e remoteJidAlt) ordenadas por data descendente.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            where: {
                key: {
                    remoteJid: "556191748140@s.whatsapp.net"
                }
            },
            options: {
                offset: 20
            }
        },
        response: {
            messages: {
                records: [
                    {
                        key: {
                            remoteJid: "556191748140@s.whatsapp.net",
                            fromMe: true,
                            id: "AC0194EA5636AC624A511CA447832E25"
                        },
                        messageTimestamp: 1787870700,
                        pushName: "Quarkgps",
                        message: {
                            conversation: "Olá!"
                        }
                    }
                ]
            }
        }
    },
    {
        category: "Conversas & Histórico",
        id: "mark-as-read",
        method: "POST",
        path: "/chat/markMessageAsRead/{instance}",
        tag: "Evolution Compat",
        summary: "Marcar mensagem como lida",
        description: "Envia a confirmação de visualização (2 checks azuis) para mensagens recebidas.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            readMessages: [
                {
                    remoteJid: "556191748140@s.whatsapp.net",
                    id: "AC0194EA5636AC624A511CA447832E25"
                }
            ]
        },
        response: {
            status: "SUCCESS"
        }
    },
    {
        category: "Conversas & Histórico",
        id: "mark-chat-unread",
        method: "POST",
        path: "/chat/markChatUnread/{instance}",
        tag: "Evolution Compat",
        summary: "Marcar conversa como não lida",
        description: "Marca o chat como não lido no WhatsApp Web e no aparelho conectado.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            chat: "556191748140@s.whatsapp.net"
        },
        response: {
            status: "SUCCESS"
        }
    },
    {
        category: "Conversas & Histórico",
        id: "send-presence",
        method: "POST",
        path: "/chat/sendPresence/{instance}",
        tag: "Evolution Compat",
        summary: "Simular presença (digitando / gravando)",
        description: "Simula o status 'digitando...' (composing) ou 'gravando áudio...' (recording) no chat com duração configurável.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            presence: "composing",
            delay: 2000
        },
        response: {
            status: "SUCCESS"
        }
    },
    {
        category: "Conversas & Histórico",
        id: "get-media-base64",
        method: "POST",
        path: "/chat/getBase64FromMediaMessage/{instance}",
        tag: "Evolution Compat",
        summary: "Baixar mídia em Base64",
        description: "Descriptografa e converte qualquer mídia recebida (áudio, foto, documento, vídeo) em uma string Base64.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            message: {
                key: {
                    remoteJid: "556191748140@s.whatsapp.net",
                    id: "AC0194EA5636AC624A511CA447832E25"
                }
            }
        },
        response: {
            mimetype: "audio/ogg; codecs=opus",
            fileName: "file",
            base64: "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwH..."
        }
    },
    {
        category: "Conversas & Histórico",
        id: "fetch-profile-picture",
        method: "POST",
        path: "/chat/fetchProfilePictureUrl/{instance}",
        tag: "Evolution Compat",
        summary: "Obter URL da foto de perfil",
        description: "Retorna a URL direta da foto de perfil de um contato ou grupo.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140"
        },
        response: {
            profilePictureUrl: "https://pps.whatsapp.net/v/t61.24694-24/..."
        }
    },

    // ---------------- GRUPOS ----------------
    {
        category: "Gestão de Grupos",
        id: "fetch-groups",
        method: "GET",
        path: "/group/fetchAllGroups/{instance}",
        tag: "Evolution Compat",
        summary: "Listar todos os grupos",
        description: "Lista todos os grupos do WhatsApp dos quais a instância conectada participa atualmente.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        queryParams: [{ name: "getParticipants", description: "false para resumido ou true para incluir todos os membros" }],
        body: null,
        response: [
            {
                id: "120363431549216760@g.us",
                subject: "Grupo Vendas QuarkGPS",
                owner: "556195654825@s.whatsapp.net",
                creation: 1711200000,
                size: 28,
                participants: []
            }
        ]
    },
    {
        category: "Gestão de Grupos",
        id: "group-participants",
        method: "GET",
        path: "/group/participants/{instance}",
        tag: "Evolution Compat",
        summary: "Listar membros do grupo",
        description: "Retorna a lista completa de membros participantes de um grupo e se são administradores.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        queryParams: [{ name: "groupJid", description: "JID oficial do grupo (ex: 120363431549216760@g.us)" }],
        body: null,
        response: {
            participants: [
                {
                    id: "556191748140@s.whatsapp.net",
                    phoneNumber: "556191748140",
                    admin: "admin"
                }
            ]
        }
    },
    {
        category: "Gestão de Grupos",
        id: "update-participant",
        method: "POST",
        path: "/group/updateParticipant/{instance}",
        tag: "Evolution Compat",
        summary: "Adicionar, remover ou promover membros",
        description: "Adiciona novos números, remove membros ou altera privilégios de administrador (ações: add, remove, promote, demote).",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            groupJid: "120363431549216760@g.us",
            action: "add",
            participants: ["5561991748140"]
        },
        response: [
            {
                status: "200",
                jid: "556191748140@s.whatsapp.net"
            }
        ]
    },

    // ---------------- ETIQUETAS (LABELS) ----------------
    {
        category: "Etiquetas & Labels",
        id: "find-labels",
        method: "GET",
        path: "/label/findLabels/{instance}",
        tag: "Evolution Compat",
        summary: "Listar etiquetas cadastradas",
        description: "Retorna todas as etiquetas (tags/labels coloridas) cadastradas na conta do WhatsApp Business (com resync automático do AppState se vazio).",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: [
            {
                id: "1",
                name: "Novo Cliente",
                color: 1
            },
            {
                id: "2",
                name: "Pagamento Pendente",
                color: 2
            }
        ]
    },
    {
        category: "Etiquetas & Labels",
        id: "handle-label",
        method: "POST",
        path: "/label/handleLabel/{instance}",
        tag: "Evolution Compat",
        summary: "Adicionar ou remover etiqueta do chat",
        description: "Vincula ou desvincula uma etiqueta de cor de uma conversa (action: 'add' ou 'remove').",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            number: "5561991748140",
            labelId: "1",
            action: "add"
        },
        response: {
            status: "SUCCESS"
        }
    },
    {
        category: "Etiquetas & Labels",
        id: "create-label",
        method: "POST",
        path: "/api/{sessionId}/labels/create",
        tag: "Nativo Baileys",
        summary: "Criar nova etiqueta no WhatsApp Business",
        description: "Cria uma etiqueta colorida (color de 0 a 19) diretamente na conta Business conectada.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "sessionId", description: "ID da sessão" }],
        body: {
            name: "Cliente VIP",
            color: 5
        },
        response: {
            success: true,
            message: "Etiqueta criada com sucesso!",
            label: { id: "10", name: "Cliente VIP", color: 5 }
        }
    },
    {
        category: "Etiquetas & Labels",
        id: "delete-label",
        method: "DELETE",
        path: "/api/{sessionId}/labels/{labelId}",
        tag: "Nativo Baileys",
        summary: "Excluir etiqueta pelo ID",
        description: "Remove a etiqueta do WhatsApp Business e do cache local da sessão.",
        pathParams: [
            { name: "sessionId", description: "ID da sessão" },
            { name: "labelId", description: "ID da etiqueta" }
        ],
        body: null,
        response: {
            success: true,
            message: "Etiqueta 10 removida com sucesso!"
        }
    },

    // ---------------- WEBHOOKS & EVENTOS ----------------
    {
        category: "Webhooks & Eventos",
        id: "find-webhook",
        method: "GET",
        path: "/webhook/find/{instance}",
        tag: "Evolution Compat",
        summary: "Consultar webhook configurado",
        description: "Retorna a URL de webhook ativa, flags e lista de eventos habilitados para a instância.",
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: null,
        response: {
            enabled: true,
            url: "https://novo.quarkgps.com/api/wpp-webhook/router",
            webhook_by_events: false,
            webhook_base64: false,
            events: ["CONNECTION_UPDATE", "MESSAGES_UPSERT", "MESSAGES_UPDATE", "SEND_MESSAGE", "NEW_TOKEN"],
            headers: {}
        }
    },
    {
        category: "Webhooks & Eventos",
        id: "set-webhook",
        method: "POST",
        path: "/webhook/set/{instance}",
        tag: "Evolution Compat",
        summary: "Configurar ou desativar URL de webhook",
        description: "Define a URL HTTP/HTTPS que receberá os eventos em JSON (com 3 tentativas automáticas de retry). Envie enabled: false para remover.",
        headers: { "Content-Type": "application/json" },
        pathParams: [{ name: "instance", description: "Nome da instância" }],
        body: {
            webhook: {
                enabled: true,
                url: "https://novo.quarkgps.com/api/wpp-webhook/router"
            }
        },
        response: {
            status: "SUCCESS",
            webhook: {
                enabled: true,
                url: "https://novo.quarkgps.com/api/wpp-webhook/router",
                webhook_by_events: false,
                webhook_base64: false
            }
        }
    },
    {
        category: "Webhooks & Eventos",
        id: "sse-stream",
        method: "GET",
        path: "/api/atendimento-events/stream",
        tag: "Nativo Baileys",
        summary: "Stream de eventos em tempo real (SSE)",
        description: "Conexão persistente Server-Sent Events (SSE) para ouvir eventos de atendimento e mensagens instantâneas diretamente no front-end.",
        headers: { "Accept": "text/event-stream" },
        body: null,
        response: {
            event: "message.created",
            atendimento_id: 123,
            session: "quark_financeiro",
            timestamp: 1787870700000
        }
    },
    {
        category: "Webhooks & Eventos",
        id: "sse-emit",
        method: "POST",
        path: "/api/atendimento-events/emit",
        tag: "Nativo Baileys",
        summary: "Emitir evento para clientes SSE conectados",
        description: "Publica um evento no hub SSE para atualizar painéis de atendimento abertos em tempo real.",
        headers: { "Content-Type": "application/json" },
        body: {
            event: "message.created",
            atendimento_id: 123,
            session: "quark_financeiro",
            phone: "5561991748140"
        },
        response: {
            success: true,
            clients: 2
        }
    }
];

function escapeHtml(str) {
    if (typeof str !== 'string') str = JSON.stringify(str, null, 2);
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

function buildHtml() {
    const defaultBase = "https://baileys.novo.quarkgps.com";
    const defaultInst = "quark_vendas2";

    const categories = {};
    endpointsData.forEach(ep => {
        if (!categories[ep.category]) categories[ep.category] = [];
        categories[ep.category].push(ep);
    });

    let sidebarHtml = `
        <div class="nav-category">
            <div class="nav-category-title"><span>Arquitetura</span></div>
            <a href="#regras-evoapi" class="nav-link" data-search="regras evoapi baileys 9 digito lid pushname botoes pix webhook">
                <span class="method-badge GET" style="background:rgba(16,185,129,0.2);color:#10b981;border-color:rgba(16,185,129,0.4);">DOC</span>
                <span class="link-label">Regras Baileys &amp; EvoAPI</span>
            </a>
        </div>`;

    for (const [cat, eps] of Object.entries(categories)) {
        sidebarHtml += `
        <div class="nav-category" data-cat="${escapeHtml(cat)}">
            <div class="nav-category-title">
                <span>${escapeHtml(cat)}</span>
                <span class="count-badge">${eps.length}</span>
            </div>`;
        eps.forEach(ep => {
            sidebarHtml += `
            <a href="#${ep.id}" class="nav-link" id="link_${ep.id}" data-search="${escapeHtml((ep.summary + ' ' + ep.path + ' ' + ep.method + ' ' + cat).toLowerCase())}">
                <span class="method-badge ${ep.method}">${ep.method}</span>
                <span class="link-label">${escapeHtml(ep.summary)}</span>
            </a>`;
        });
        sidebarHtml += `</div>`;
    }

    let cardsHtml = '';
    endpointsData.forEach(ep => {
        const displayPath = ep.path.replace('{instance}', `<span class="inst-var">{instance}</span>`)
                                   .replace('{sessionId}', `<span class="inst-var">{sessionId}</span>`)
                                   .replace('{phone}', '5561991748140');

        const resolvedPath = ep.path.replace('{instance}', defaultInst).replace('{sessionId}', defaultInst).replace('{phone}', '5561991748140').replace('{labelId}', '10');

        let curlCode = `curl -X ${ep.method} "${defaultBase}${resolvedPath}"`;
        if (ep.headers) {
            for (const [k, v] of Object.entries(ep.headers)) {
                curlCode += ` \\\n  -H "${k}: ${v}"`;
            }
        }
        if (ep.body && (ep.method === 'POST' || ep.method === 'PUT')) {
            curlCode += ` \\\n  -d '${JSON.stringify(ep.body, null, 2)}'`;
        }

        let phpCode = `$response = Http::withHeaders([\n`;
        if (ep.headers) {
            for (const [k, v] of Object.entries(ep.headers)) {
                phpCode += `    "${k}" => "${v}",\n`;
            }
        }
        phpCode += `])->${ep.method.toLowerCase()}("${defaultBase}${resolvedPath}"`;
        if (ep.body && (ep.method === 'POST' || ep.method === 'PUT')) {
            phpCode += `, [\n`;
            for (const [k, v] of Object.entries(ep.body)) {
                phpCode += `    "${k}" => ${JSON.stringify(v)},\n`;
            }
            phpCode += `]`;
        }
        phpCode += `);\n\n$data = $response->json();`;

        let jsCode = `const response = await fetch("${defaultBase}${resolvedPath}", {\n`;
        jsCode += `  method: "${ep.method}",\n`;
        if (ep.headers) {
            jsCode += `  headers: ${JSON.stringify(ep.headers, null, 4).replace(/\n/g, '\n  ')},\n`;
        }
        if (ep.body && (ep.method === 'POST' || ep.method === 'PUT')) {
            jsCode += `  body: JSON.stringify(${JSON.stringify(ep.body, null, 4).replace(/\n/g, '\n  ')})\n`;
        }
        jsCode += `});\nconst result = await response.json();`;

        cardsHtml += `
        <div class="endpoint-card" id="${ep.id}" data-search="${escapeHtml((ep.summary + ' ' + ep.path + ' ' + ep.method + ' ' + ep.category).toLowerCase())}" data-path="${escapeHtml(ep.path)}" data-method="${ep.method}" data-body='${ep.body ? escapeHtml(JSON.stringify(ep.body)) : ""}'>
            <div class="endpoint-header">
                <div class="endpoint-route">
                    <span class="method-badge ${ep.method}">${ep.method}</span>
                    <span class="path-display">${displayPath}</span>
                </div>
                <div style="display:flex; align-items:center; gap:0.6rem;">
                    <span class="tag-badge">${ep.tag}</span>
                    <span class="status-pill">200 OK</span>
                </div>
            </div>

            <div class="endpoint-body">
                <h3 class="endpoint-title">${escapeHtml(ep.summary)}</h3>
                <p class="endpoint-desc">${escapeHtml(ep.description)}</p>`;

        if (ep.pathParams || ep.queryParams) {
            cardsHtml += `
                <div class="params-section">
                    <div class="params-title">Parâmetros da Requisição</div>
                    <table class="param-table">
                        <thead><tr><th>Parâmetro</th><th>Tipo</th><th>Descrição</th></tr></thead>
                        <tbody>`;
            (ep.pathParams || []).forEach(p => {
                cardsHtml += `<tr><td><span class="param-name">:${escapeHtml(p.name)}</span></td><td><span class="badge-type path">PATH</span></td><td>${escapeHtml(p.description)}</td></tr>`;
            });
            (ep.queryParams || []).forEach(p => {
                cardsHtml += `<tr><td><span class="param-name">?${escapeHtml(p.name)}</span></td><td><span class="badge-type query">QUERY</span></td><td>${escapeHtml(p.description)}</td></tr>`;
            });
            cardsHtml += `</tbody></table></div>`;
        }

        cardsHtml += `
                <div class="code-box">
                    <div class="code-header">
                        <div class="code-tabs">
                            <button type="button" class="tab-btn active" onclick="switchSnippetTab(this, '${ep.id}_curl')">cURL</button>
                            <button type="button" class="tab-btn" onclick="switchSnippetTab(this, '${ep.id}_php')">PHP (Laravel)</button>
                            <button type="button" class="tab-btn" onclick="switchSnippetTab(this, '${ep.id}_js')">JavaScript</button>
                        </div>
                        <button type="button" class="btn-copy" onclick="copyCardSnippet('${ep.id}')">📋 Copiar</button>
                    </div>

                    <div id="${ep.id}_curl" class="tab-content"><pre><code class="code-curl">${escapeHtml(curlCode)}</code></pre></div>
                    <div id="${ep.id}_php" class="tab-content" style="display:none;"><pre><code class="code-php">${escapeHtml(phpCode)}</code></pre></div>
                    <div id="${ep.id}_js" class="tab-content" style="display:none;"><pre><code class="code-js">${escapeHtml(jsCode)}</code></pre></div>
                </div>`;

        if (ep.response) {
            cardsHtml += `
                <div style="margin-top:1.5rem;">
                    <div class="params-title">Exemplo de Resposta (JSON):</div>
                    <div class="code-box" style="margin-top:0.4rem;">
                        <pre><code>${escapeHtml(JSON.stringify(ep.response, null, 2))}</code></pre>
                    </div>
                </div>`;
        }

        cardsHtml += `
            </div>
        </div>`;
    });

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Baileys API - Documentação RESTful</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Fira+Code:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #10B981;
            --primary-hover: #059669;
            --primary-glow: rgba(16, 185, 129, 0.25);
            --bg-dark: #0a0e17;
            --sidebar-bg: #0d131f;
            --surface: #131b2e;
            --surface-hover: #1a253e;
            --border: rgba(255, 255, 255, 0.08);
            --border-active: rgba(16, 185, 129, 0.4);
            --text: #f1f5f9;
            --text-muted: #94a3b8;
            --get-color: #3b82f6;
            --post-color: #10b981;
            --put-color: #f59e0b;
            --delete-color: #ef4444;
            --code-bg: #090d16;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
        body { background-color: var(--bg-dark); color: var(--text); display: flex; min-height: 100vh; overflow-x: hidden; }
        #sidebar { width: 320px; background: var(--sidebar-bg); border-right: 1px solid var(--border); height: 100vh; position: fixed; top: 0; left: 0; overflow-y: auto; display: flex; flex-direction: column; z-index: 100; }
        .sidebar-header { padding: 1.5rem; border-bottom: 1px solid var(--border); background: rgba(13, 19, 31, 0.95); backdrop-filter: blur(10px); position: sticky; top: 0; z-index: 10; }
        .logo-area { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
        .logo-badge { background: var(--primary-glow); border: 1px solid var(--primary); color: var(--primary); width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.2rem; }
        .logo-text h1 { font-size: 1.1rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
        .logo-text span { font-size: 0.75rem; color: var(--primary); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em; }
        .search-box { position: relative; }
        .search-box input { width: 100%; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.8rem 0.6rem 2.2rem; color: var(--text); font-size: 0.85rem; outline: none; transition: all 0.2s; }
        .search-box input:focus { border-color: var(--primary); background: rgba(16, 185, 129, 0.05); box-shadow: 0 0 0 3px var(--primary-glow); }
        .search-icon { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.85rem; }
        .sidebar-nav { padding: 1rem; flex: 1; }
        .nav-category { margin-bottom: 1.5rem; }
        .nav-category-title { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em; margin-bottom: 0.5rem; padding-left: 0.5rem; display: flex; align-items: center; justify-content: space-between; }
        .count-badge { font-size: 0.7rem; opacity: 0.6; background: rgba(255, 255, 255, 0.06); padding: 0.1rem 0.4rem; border-radius: 4px; }
        .nav-link { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem; border-radius: 6px; color: #cbd5e1; text-decoration: none; font-size: 0.82rem; transition: all 0.15s; margin-bottom: 2px; }
        .nav-link:hover { background: var(--surface-hover); color: #fff; }
        .link-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .method-badge { font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; letter-spacing: 0.04em; min-width: 44px; text-align: center; font-family: 'Fira Code', monospace; }
        .method-badge.GET { background: rgba(59, 130, 246, 0.2); color: var(--get-color); border: 1px solid rgba(59, 130, 246, 0.4); }
        .method-badge.POST { background: rgba(16, 185, 129, 0.2); color: var(--post-color); border: 1px solid rgba(16, 185, 129, 0.4); }
        .method-badge.PUT { background: rgba(245, 158, 11, 0.2); color: var(--put-color); border: 1px solid rgba(245, 158, 11, 0.4); }
        .method-badge.DELETE { background: rgba(239, 68, 68, 0.2); color: var(--delete-color); border: 1px solid rgba(239, 68, 68, 0.4); }
        #content { margin-left: 320px; flex: 1; padding: 2.5rem 3.5rem 5rem; max-width: 1300px; }
        .settings-bar { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem 1.75rem; margin-bottom: 2.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.5rem; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
        .setting-group { display: flex; align-items: center; gap: 0.75rem; }
        .setting-label { font-size: 0.8rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; }
        .setting-input { background: var(--code-bg); border: 1px solid var(--border); color: #fff; padding: 0.45rem 0.8rem; border-radius: 6px; font-size: 0.85rem; font-family: 'Fira Code', monospace; min-width: 260px; outline: none; transition: all 0.2s; }
        .setting-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-glow); }
        .btn-dash { display: inline-flex; align-items: center; gap: 0.5rem; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); color: #fff; text-decoration: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 500; transition: all 0.2s; }
        .btn-dash:hover { background: var(--surface-hover); border-color: var(--primary); color: var(--primary); }
        .hero { margin-bottom: 2rem; }
        .hero h1 { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 0.75rem; }
        .hero p { color: var(--text-muted); font-size: 1.05rem; line-height: 1.6; max-width: 850px; }
        .rules-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 2.5rem; }
        .rule-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.2rem; }
        .rule-card h4 { font-size: 0.95rem; font-weight: 700; color: var(--primary); margin-bottom: 0.45rem; }
        .rule-card p { font-size: 0.85rem; color: #cbd5e1; line-height: 1.5; }
        .rule-card code { background: var(--code-bg); padding: 0.1rem 0.35rem; border-radius: 4px; font-family: 'Fira Code', monospace; font-size: 0.78rem; color: #38bdf8; }
        .endpoint-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 2rem; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.15); scroll-margin-top: 1.5rem; transition: border-color 0.2s; }
        .endpoint-card:hover { border-color: rgba(255, 255, 255, 0.15); }
        .endpoint-header { padding: 1.25rem 1.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); background: rgba(255, 255, 255, 0.015); flex-wrap: wrap; gap: 1rem; }
        .endpoint-route { display: flex; align-items: center; gap: 0.75rem; font-family: 'Fira Code', monospace; font-size: 1rem; font-weight: 600; }
        .inst-var { color: var(--primary); }
        .tag-badge { font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 4px; background: rgba(16, 185, 129, 0.1); color: var(--primary); border: 1px solid var(--primary-glow); font-weight: 600; }
        .status-pill { font-family: 'Fira Code', monospace; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; background: rgba(16, 185, 129, 0.15); color: var(--primary); border: 1px solid var(--primary-glow); }
        .endpoint-body { padding: 1.5rem; }
        .endpoint-title { font-size: 1.15rem; margin-bottom: 0.4rem; font-weight: 700; }
        .endpoint-desc { color: #cbd5e1; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
        .params-section { margin-bottom: 1.5rem; }
        .params-title { font-size: 0.8rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.75rem; letter-spacing: 0.05em; }
        .param-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-bottom: 1rem; }
        .param-table th { text-align: left; padding: 0.5rem 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); font-size: 0.75rem; text-transform: uppercase; }
        .param-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
        .param-name { font-family: 'Fira Code', monospace; color: #38bdf8; font-weight: 600; }
        .badge-type { font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px; }
        .badge-type.path { color: #f59e0b; background: rgba(245, 158, 11, 0.15); }
        .badge-type.query { color: #3b82f6; background: rgba(59, 130, 246, 0.15); }
        .code-box { background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-top: 1rem; }
        .code-header { background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid var(--border); padding: 0.5rem 1rem; display: flex; align-items: center; justify-content: space-between; }
        .code-tabs { display: flex; gap: 0.5rem; }
        .tab-btn { background: none; border: none; color: var(--text-muted); padding: 0.35rem 0.7rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .tab-btn:hover { color: #fff; }
        .tab-btn.active { background: rgba(255, 255, 255, 0.08); color: var(--primary); }
        .btn-copy { background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border); color: #cbd5e1; padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.7rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; transition: all 0.2s; }
        .btn-copy:hover { background: var(--primary-glow); color: var(--primary); border-color: var(--primary); }
        pre { padding: 1rem 1.25rem; font-family: 'Fira Code', monospace; font-size: 0.85rem; line-height: 1.5; color: #e2e8f0; overflow-x: auto; }
        @media (max-width: 900px) { #sidebar { display: none; } #content { margin-left: 0; padding: 1.5rem; } }
    </style>
</head>
<body>
    <aside id="sidebar">
        <div class="sidebar-header">
            <div class="logo-area">
                <div class="logo-badge">B</div>
                <div class="logo-text">
                    <h1>Baileys API</h1>
                    <span>Documentação REST</span>
                </div>
            </div>
            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="searchInput" placeholder="Filtrar rotas ou nomes..." oninput="filterEndpoints()">
            </div>
        </div>
        <nav class="sidebar-nav" id="sidebarNav">${sidebarHtml}</nav>
    </aside>

    <main id="content">
        <div class="settings-bar">
            <div class="setting-group">
                <span class="setting-label">Base URL:</span>
                <input type="text" id="baseUrlInput" class="setting-input" value="${defaultBase}" oninput="updateAllDynamicCode()">
            </div>
            <div class="setting-group">
                <span class="setting-label">Instância Ativa:</span>
                <input type="text" id="instanceInput" class="setting-input" style="min-width: 140px;" value="${defaultInst}" oninput="updateAllDynamicCode()">
            </div>
            <a href="/" class="btn-dash">📊 Abrir Dashboard</a>
        </div>

        <div class="hero">
            <h1>Referência da API RESTful (Baileys + EvoAPI v2)</h1>
            <p>
                API multi-sessão baseada em Baileys com compatibilidade direta com <strong>Evolution API v2</strong> e rotas nativas.
                Todas as rotas Evolution respondem tanto na raiz (ex: <code>/message/sendText/{instance}</code>) quanto sob <code>/api</code>.
            </p>
        </div>

        <div id="regras-evoapi" class="rules-grid">
            <div class="rule-card">
                <h4>1. Dual-Layer Routing</h4>
                <p>Use rotas no padrão Evolution API na raiz ou com prefixo <code>/api</code>. O sistema Laravel (<code>EvolutionApiService</code> e <code>BaileysApiService</code>) funciona de forma transparente.</p>
            </div>
            <div class="rule-card">
                <h4>2. 9º Dígito (BR) &amp; Desduplicação @lid</h4>
                <p>Números brasileiros com ou sem o 9º dígito são resolvidos via <code>onWhatsApp</code> e casados pelos últimos 8 dígitos. Registros <code>@lid</code> são mesclados ao JID real sem duplicar contatos.</p>
            </div>
            <div class="rule-card">
                <h4>3. name vs pushName</h4>
                <p><code>name</code> representa o nome salvo na agenda da sessão; <code>pushName</code> (com alias <code>pushname</code>) traz o nome público do perfil no WhatsApp, com fallback inteligente entre sessões.</p>
            </div>
            <div class="rule-card">
                <h4>4. Proteção Anti-Bloqueio Pix &amp; 2FA</h4>
                <p>Suporte aos 4 modos: <code>smart_fallback</code> (aguarda 2 checks), <code>dual</code> (botão + código puro), <code>text_only</code> (Kill-Switch) e <code>button_only</code>.</p>
            </div>
            <div class="rule-card">
                <h4>5. Webhooks &amp; Retries</h4>
                <p>Dispara <code>messages.upsert</code>, <code>messages.update</code>, <code>message-receipt.update</code>, <code>connection.update</code>, <code>labels.edit</code> e <code>labels.association</code> com até 3 tentativas automáticas.</p>
            </div>
        </div>

        <div id="endpointsContainer">${cardsHtml}</div>
    </main>

    <script src="/docs.js"></script>
</body>
</html>`;
}

fs.writeFileSync(path.join(__dirname, 'public/docs.html'), buildHtml());
console.log('Documentação pré-renderizada com sucesso em public/docs.html!');
