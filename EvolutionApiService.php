<?php

namespace App\Services;

use App\Interfaces\WhatsappServiceInterface;
use App\Models\WppconnectSession;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Exception;

class EvolutionApiService implements WhatsappServiceInterface
{
    protected WppconnectSession $session;
    protected string $baseUrl;
    protected array $headers;

    public function __construct(WppconnectSession $session)
    {
        $this->session = $session;
        // Remove barra final se houver
        $this->baseUrl = rtrim($session->serverurl, '/');
        
        // Headers globais (usando a API Key do .env/docker)
        $this->headers = [
            'apikey' => $session->secretkey, 
            'Content-Type' => 'application/json'
        ];
    }

    /**
     * ===========================================================================================
     * MÉTODO CENTRALIZADOR DE REQUISIÇÕES (LOGS E TRATAMENTO DE ERRO)
     * ===========================================================================================
     */
    private function httpPost(string $endpointType, array $payload): array
    {
        // Monta a URL: {baseUrl}/{endpointType}/{instanceName}
        $url = "{$this->baseUrl}/{$endpointType}/{$this->session->session}";

        // 1. LOG DE ENTRADA
//        Log::info("[EvolutionAPI] Request para: {$endpointType}", [
//            'instance' => $this->session->session,
//            'payload' => $payload
//        ]);

        try {
            $response = Http::withHeaders($this->headers)
                            ->timeout(45) // Timeout razoável para mídia
                            ->post($url, $payload);

            // 2. LOG DE ERRO HTTP
            if ($response->failed()) {
                Log::error("[EvolutionAPI] Falha HTTP {$response->status()}", [
                    'body' => $response->body(),
                    'url' => $url
                ]);
                return [
                    'status' => 'ERROR', 
                    'error' => $response->json() ?? $response->body(),
                    'http_code' => $response->status()
                ];
            }

            // 3. LOG DE SUCESSO
            $data = $response->json();
            // Logamos apenas sucesso resumido para não poluir demais se o retorno for grande
//            Log::info("[EvolutionAPI] Sucesso (HTTP 200/201)");
            
            return $data;

        } catch (Exception $e) {
            // 4. LOG DE EXCEÇÃO
            Log::critical("[EvolutionAPI] Exceção CRÍTICA: " . $e->getMessage(), [
                'trace' => $e->getTraceAsString()
            ]);
            
            return [
                'status' => 'ERROR', 
                'message' => 'Exception: ' . $e->getMessage()
            ];
        }
    }

    /**
     * ===========================================================================================
     * 1. GERENCIAMENTO DE SESSÃO (SETUP, CONNECT, STATUS)
     * ===========================================================================================
     */

    public function startSession(): array
    {
        Log::info("[EvolutionAPI] Iniciando Sessão: {$this->session->session}");

        // 1. Auto-recovery: Se não tem token, busca ou cria
        if (empty($this->session->token)) {
            $existingToken = $this->getTokenFromApi();
            
            if ($existingToken) {
                $this->session->token = $existingToken;
                $this->session->save();
            } else {
                try {
                    $this->createInstance();
                } catch (Exception $e) {
                    Log::error("[EvolutionAPI] Erro fatal createInstance: " . $e->getMessage());
                    return ['status' => 'ERROR', 'qrcode' => null, 'message' => $e->getMessage()];
                }
            }
        }

        // 2. Conecta
        $url = "{$this->baseUrl}/instance/connect/{$this->session->session}";
        
        try {
            $response = Http::withHeaders($this->headers)->get($url);

            if ($response->failed()) {
                Log::error("[EvolutionAPI] Falha ao conectar instância.", ['body' => $response->body()]);
                $this->session->updateStatus('ERROR');
                return ['status' => 'ERROR', 'qrcode' => null, 'message' => $response->body()];
            }

            $data = $response->json();
            
            // Pega QR Code (Base64)
            $qrcode = $data['base64']
                ?? $data['qrcode']
                ?? ($data['qrCode']['base64'] ?? null)
                ?? null;
            $state = $data['instance']['state']
                ?? $data['state']
                ?? $data['status']
                ?? 'connecting';
            $mappedStatus = $this->mapStatus($state, $qrcode);
            $this->session->updateStatus($mappedStatus);
            
            return [
                'status' => $mappedStatus,
                'qrcode' => $qrcode
            ];

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Exceção no startSession: " . $e->getMessage());
            $this->session->updateStatus('ERROR');
            return ['status' => 'ERROR', 'qrcode' => null];
        }
    }

    public function checkSessionStatus(): array
    {
        $url = "{$this->baseUrl}/instance/connectionState/{$this->session->session}";
        
        try {
            $response = Http::withHeaders($this->headers)->get($url);
            
            if ($response->failed()) {
                if ($response->status() === 404) {
                     $this->session->updateStatus('DISCONNECTED');
                     return ['status' => 'DISCONNECTED', 'qrcode' => null];
                }
                $this->session->updateStatus('ERROR');
                return ['status' => 'ERROR', 'qrcode' => null];
            }

            $data = $response->json();
            $state = $data['instance']['state']
                ?? $data['state']
                ?? $data['status']
                ?? 'close';
            $qrcode = null;
            
            // Lógica para pegar o QR Code se estiver desconectado
            if ($state === 'close' || $state === 'connecting') {
                 $connectResponse = Http::withHeaders($this->headers)->get("{$this->baseUrl}/instance/connect/{$this->session->session}");
                 if ($connectResponse->successful()) {
                     $cData = $connectResponse->json();
                     $qrcode = $cData['base64']
                        ?? $cData['qrcode']
                        ?? ($cData['qrCode']['base64'] ?? null)
                        ?? null;
                     if($qrcode) $state = 'qrcode'; 
                 }
            }

            $mappedStatus = $this->mapStatus($state, $qrcode);
            $this->session->updateStatus($mappedStatus);

            return [
                'status' => $mappedStatus,
                'qrcode' => $qrcode
            ];

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Exceção checkSessionStatus: " . $e->getMessage());
            $this->session->updateStatus('ERROR');
            return ['status' => 'ERROR', 'qrcode' => null];
        }
    }

    public function createInstance(): void
    {
        $url = "{$this->baseUrl}/instance/create";
        
        $payload = [
            'instanceName' => $this->session->session,
            'qrcode' => false, 
            'integration' => 'WHATSAPP-BAILEYS',
            'reject_call' => false,
            'alwaysOnline' => false,
            'syncFullHistory' => false,
        ];

        if (!empty($this->session->webhook)) {
            $payload['webhook'] = [
                'enabled' => true,
                'url' => $this->session->webhook,
                'events' => ['APPLICATION_STARTUP', 'QRCODE_UPDATED', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'SEND_MESSAGE', 'CONNECTION_UPDATE']
            ];
        }

        Log::info("[EvolutionAPI] Criando Instância...", $payload);

        $response = Http::withHeaders($this->headers)->post($url, $payload);
        
        if ($response->failed()) {
            if ($response->status() === 403) {
                throw new Exception("Chave Global incorreta (403).");
            }
            if ($response->status() === 409) {
                 Log::info("[EvolutionAPI] Instância já existia (409).");
            } else {
                throw new Exception("Erro ao criar instância: " . $response->body());
            }
        }

        $token = $this->getTokenFromApi();
        if ($token) {
            $this->session->token = $token;
            $this->session->save();
            Log::info("[EvolutionAPI] Token recuperado e salvo.");
        } else {
            Log::warning("[EvolutionAPI] Instância criada/existente, mas falha ao recuperar token.");
        }
    }

    public function getTokenFromApi(): ?string
    {
        $url = "{$this->baseUrl}/instance/fetchInstances";
        try {
            $response = Http::withHeaders($this->headers)->get($url);

            if ($response->failed() || !is_array($response->json())) {
                return null;
            }

            foreach ($response->json() as $instanceData) {
                if (($instanceData['name'] ?? null) === $this->session->session) {
                    return $instanceData['token'] ?? null;
                }
            }
            return null;
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Erro getTokenFromApi: " . $e->getMessage());
            return null;
        }
    }

    public function logoutSession(): bool
    {
        $url = "{$this->baseUrl}/instance/logout/{$this->session->session}";
        try {
            $response = Http::withHeaders($this->headers)->delete($url);
            if ($response->successful()) {
                $this->session->updateStatus('DISCONNECTED');
                return true;
            }
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Logout falhou: " . $e->getMessage());
        }
        return false;
    }

    public function deleteSession(): bool
    {
        $url = "{$this->baseUrl}/instance/delete/{$this->session->session}";
        try {
            $response = Http::withHeaders($this->headers)->delete($url);
            if ($response->successful()) {
                $this->session->updateStatus('CLOSED');
                $this->session->token = null;
                $this->session->save();
                return true;
            }
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Delete falhou: " . $e->getMessage());
        }
        return false;
    }

    public function closeSession(): bool
    {
        return $this->deleteSession(); 
    }
    
    public function setOnlineStatus(bool $isOnline): array
    {
        // Endpoint de update para definir alwaysOnline
        $url = "{$this->baseUrl}/instance/update/{$this->session->session}";
        $payload = ['alwaysOnline' => $isOnline];

        try {
            Log::info("[EvolutionAPI] Set Online Status: " . ($isOnline ? 'ON' : 'OFF'));
            $response = Http::withHeaders($this->headers)->put($url, $payload);
            return $response->json();
        } catch(Exception $e) {
            Log::error("[EvolutionAPI] setOnlineStatus error: " . $e->getMessage());
            return ['status' => 'ERROR'];
        }
    }

    public function findWebhookConfig(): array
    {
        $url = "{$this->baseUrl}/webhook/find/{$this->session->session}";

        try {
            $response = Http::withHeaders($this->headers)->get($url);

            if ($response->failed()) {
                return [
                    'success' => false,
                    'status' => $response->status(),
                    'error_code' => $this->mapProviderErrorCode($response->status()),
                    'data' => $response->json() ?? ['raw' => $response->body()],
                ];
            }

            $data = $response->json();
            if (!is_array($data)) {
                $data = [];
            }

            return [
                'success' => true,
                'status' => $response->status(),
                'data' => $data,
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'status' => 500,
                'error_code' => 'PROVIDER_EXCEPTION',
                'data' => ['message' => $e->getMessage()],
            ];
        }
    }

    public function setWebhookConfig(array $payload): array
    {
        $url = "{$this->baseUrl}/webhook/set/{$this->session->session}";

        try {
            $normalizedPayload = $this->normalizeWebhookPayloadForProvider($payload);

            // Quark/Evolution pode exigir payload dentro da chave-raiz "webhook".
            $primaryPayload = ['webhook' => $normalizedPayload];
            $response = Http::withHeaders($this->headers)->post($url, $primaryPayload);
            $primaryBody = $response->json() ?? ['raw' => $response->body()];

            if ($response->successful()) {
                $data = $response->json();
                if (!is_array($data)) {
                    $data = [];
                }

                return [
                    'success' => true,
                    'status' => $response->status(),
                    'data' => $data,
                ];
            }

            if ($response->status() === 400) {
                $supportedEvents = $this->extractSupportedEventsFromProviderError($primaryBody);

                if (count($supportedEvents) > 0 && isset($normalizedPayload['events']) && is_array($normalizedPayload['events'])) {
                    $resolvedEvents = $this->resolveEventsForProvider($normalizedPayload['events'], $supportedEvents);

                    if (count($resolvedEvents) > 0 && $resolvedEvents !== array_values($normalizedPayload['events'])) {
                        $retryPayload = $normalizedPayload;
                        $retryPayload['events'] = $resolvedEvents;

                        Log::warning('evolution_webhook_set_retry_supported_events', [
                            'url' => $url,
                            'original_events' => $normalizedPayload['events'],
                            'resolved_events' => $resolvedEvents,
                            'supported_events' => $supportedEvents,
                        ]);

                        $retryResponse = Http::withHeaders($this->headers)->post($url, ['webhook' => $retryPayload]);
                        $retryBody = $retryResponse->json() ?? ['raw' => $retryResponse->body()];

                        if ($retryResponse->successful()) {
                            $data = $retryResponse->json();
                            if (!is_array($data)) {
                                $data = [];
                            }

                            return [
                                'success' => true,
                                'status' => $retryResponse->status(),
                                'data' => $data,
                            ];
                        }

                        return [
                            'success' => false,
                            'status' => $retryResponse->status(),
                            'error_code' => $this->mapProviderErrorCode($retryResponse->status()),
                            'data' => $retryBody,
                        ];
                    }
                }
            }

            // Se o provider ainda reclamar da chave raiz "webhook", não devemos mascarar o erro
            // com fallback plano, pois isso só repete/agrava o problema e atrapalha o debug.
            $primaryBodyText = is_array($primaryBody) ? json_encode($primaryBody) : (string) $primaryBody;
            if (
                is_string($primaryBodyText)
                && (
                    str_contains(strtolower($primaryBodyText), 'requires property "webhook"')
                    || str_contains(strtolower($primaryBodyText), 'webhook.headers is not of a type(s) object')
                )
            ) {
                Log::warning('evolution_webhook_set_primary_failed_requires_webhook', [
                    'url' => $url,
                    'status' => $response->status(),
                    'payload_mode' => 'wrapped_webhook',
                    'request_preview' => [
                        'webhook' => [
                            'enabled' => $normalizedPayload['enabled'] ?? null,
                            'url' => $normalizedPayload['url'] ?? null,
                            'headers_type' => gettype($normalizedPayload['headers'] ?? null),
                        ],
                    ],
                    'response' => $primaryBody,
                ]);

                return [
                    'success' => false,
                    'status' => $response->status(),
                    'error_code' => $this->mapProviderErrorCode($response->status()),
                    'data' => $primaryBody,
                ];
            }

            // Fallback de compatibilidade para provedores antigos que aceitam formato plano.
            if ($response->status() === 400) {
                $fallbackResponse = Http::withHeaders($this->headers)->post($url, $normalizedPayload);
                $fallbackBody = $fallbackResponse->json() ?? ['raw' => $fallbackResponse->body()];

                Log::warning('evolution_webhook_set_fallback_attempt', [
                    'url' => $url,
                    'primary_status' => $response->status(),
                    'primary_response' => $primaryBody,
                    'fallback_status' => $fallbackResponse->status(),
                    'fallback_response' => $fallbackBody,
                ]);

                if ($fallbackResponse->successful()) {
                    $data = $fallbackResponse->json();
                    if (!is_array($data)) {
                        $data = [];
                    }

                    return [
                        'success' => true,
                        'status' => $fallbackResponse->status(),
                        'data' => $data,
                    ];
                }

                return [
                    'success' => false,
                    'status' => $fallbackResponse->status(),
                    'error_code' => $this->mapProviderErrorCode($fallbackResponse->status()),
                    'data' => $fallbackBody,
                ];
            }

            return [
                'success' => false,
                'status' => $response->status(),
                'error_code' => $this->mapProviderErrorCode($response->status()),
                'data' => $primaryBody,
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'status' => 500,
                'error_code' => 'PROVIDER_EXCEPTION',
                'data' => ['message' => $e->getMessage()],
            ];
        }
    }

    private function normalizeWebhookPayloadForProvider(array $payload): array
    {
        // Alguns providers aceitam snake_case, outros camelCase.
        // Enviamos ambas para evitar que flags sejam ignoradas silenciosamente.
        if (array_key_exists('webhook_by_events', $payload) && !array_key_exists('webhookByEvents', $payload)) {
            $payload['webhookByEvents'] = (bool) $payload['webhook_by_events'];
        }

        if (array_key_exists('webhook_by_events', $payload) && !array_key_exists('byEvents', $payload)) {
            $payload['byEvents'] = (bool) $payload['webhook_by_events'];
        }

        if (array_key_exists('webhookByEvents', $payload) && !array_key_exists('byEvents', $payload)) {
            $payload['byEvents'] = (bool) $payload['webhookByEvents'];
        }

        if (array_key_exists('base64', $payload) && !array_key_exists('webhookBase64', $payload)) {
            $payload['webhookBase64'] = (bool) $payload['base64'];
        }

        if (!array_key_exists('headers', $payload) || $payload['headers'] === null) {
            $payload['headers'] = new \stdClass();
            return $payload;
        }

        if (is_array($payload['headers']) && count($payload['headers']) === 0) {
            $payload['headers'] = new \stdClass();
            return $payload;
        }

        return $payload;
    }

    private function extractSupportedEventsFromProviderError(array $providerBody): array
    {
        $message = $providerBody['response']['message'][0][0] ?? null;
        if (!is_string($message)) {
            return [];
        }

        $pos = stripos($message, 'enum values:');
        if ($pos === false) {
            return [];
        }

        $raw = trim(substr($message, $pos + strlen('enum values:')));
        if ($raw === '') {
            return [];
        }

        $events = array_filter(array_map(static function (string $event): string {
            return strtoupper(trim($event));
        }, explode(',', $raw)), static function (string $event): bool {
            return $event !== '';
        });

        return array_values(array_unique($events));
    }

    private function resolveEventsForProvider(array $requestedEvents, array $supportedEvents): array
    {
        $supportedSet = array_fill_keys(array_map('strtoupper', $supportedEvents), true);
        $resolved = [];

        foreach ($requestedEvents as $event) {
            if (!is_string($event)) {
                continue;
            }

            $normalized = strtoupper(trim($event));
            if ($normalized === '') {
                continue;
            }

            if (isset($supportedSet[$normalized])) {
                $resolved[] = $normalized;
                continue;
            }

            if (($normalized === 'NEW_TOKEN' || $normalized === 'NEW_JWT') && isset($supportedSet['STATUS_INSTANCE'])) {
                $resolved[] = 'STATUS_INSTANCE';
            }
        }

        return array_values(array_unique($resolved));
    }

    private function mapProviderErrorCode(int $status): string
    {
        return match ($status) {
            400 => 'PROVIDER_BAD_REQUEST',
            401 => 'PROVIDER_UNAUTHORIZED',
            403 => 'PROVIDER_FORBIDDEN',
            404 => 'PROVIDER_NOT_FOUND',
            default => $status >= 500 ? 'PROVIDER_INTERNAL_ERROR' : 'PROVIDER_ERROR',
        };
    }
    
    /**
     * Busca histórico usando findMessages (Evolution v2)
     */
    public function fetchHistory(string $phone, int $limit = 20): array
    {
        $url = "{$this->baseUrl}/chat/findMessages/{$this->session->session}";
        
        $remoteJid = null;

        if (str_contains($phone, '@')) {
            $remoteJid = $phone;
        } else {
            $check = $this->checkNumber($phone);
            
            if (!empty($check['exists']) && $check['exists'] === true && !empty($check['id']['_serialized'])) {
                $remoteJid = $check['id']['_serialized'];
            } else {
                $remoteJid = $this->formatPhone($phone) . "@s.whatsapp.net";
            }
        }

        $payload = [
            'where' => [
                'key' => [
                    'remoteJidAlt' => $remoteJid,
                    'remoteJid' => $remoteJid
                ]
            ],
            'options' => [
                'offset' => $limit,
                'sort' => 'DESC', 
                'page' => 1
            ]
        ];

        try {
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            
            if ($response->failed()) return [];

            $data = $response->json();
            
            // ========================================================
            // CORREÇÃO: Lendo do novo padrão paginado da Evolution
            // ========================================================
            if (isset($data['messages']['records'])) {
                $messages = $data['messages']['records'];
            } elseif (isset($data['messages']) && is_array($data['messages'])) {
                $messages = $data['messages'];
            } else {
                $messages = is_array($data) ? $data : [];
            }

            $historicoLimpo = [];
            foreach ($messages as $msg) {
                // Prevenção para garantir que estamos iterando nos objetos corretos
                if (!is_array($msg) || !isset($msg['key'])) continue;

                $content = $this->extrairConteudoMessage($msg);
                
                $historicoLimpo[] = [
                    'wpp_id' => $msg['key']['id'] ?? null,
                    'fromMe' => $msg['key']['fromMe'] ?? false,
                    'timestamp' => $msg['messageTimestamp'] ?? time(),
                    'conteudo' => mb_substr($content['texto'] ?? '', 0, 1000),
                    'tipo' => $content['tipo'],
                    'arquivo_nome' => $content['fileName'] ?? null,
                    'mimetype' => $content['mimetype'] ?? null,
                    'url_arquivo' => null // Evolution não retorna URL pública no histórico facilmente
                ];
            }
            
            $resultado = array_reverse($historicoLimpo);
            if ($limit > 0 && count($resultado) > $limit) {
                $resultado = array_slice($resultado, -$limit);
            }
            return $resultado;

        } catch (Exception $e) {
            Log::error("Evolution findMessages error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * ===========================================================================================
     * 2. OPERAÇÕES DE ENVIO DE MENSAGENS (USANDO httpPost)
     * ===========================================================================================
     */


    public function sendMessage(string $phone, string $message, ?string $quotedId = null): array
    {
        
        
        $target = str_contains($phone, '@') ? $phone : $this->formatPhone($phone);
        Log::info("Evolution: Enviando mensagem para {$phone} / {$target} " . ($quotedId ? "(Respondendo: $quotedId)" : ""));
        // Endpoint padrão de texto
        $url = "{$this->baseUrl}/message/sendText/{$this->session->session}";
        
        $payload = [
            'number' =>  $target,
            'text' => $message
        ];
        // --- LÓGICA DE MENÇÃO (EVOLUTION) ---
        if ($quotedId) {
            $payload['quoted'] = [
                'key' => [
                    'id' => $quotedId
                ]
            ];
        }

        try {
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            return $response->json();
        } catch (Exception $e) {
            Log::error("Evolution sendMessage Error: " . $e->getMessage());
            return ['status' => 'ERROR'];
        }
    }

    public function sendText(string $phone, string $message): array
    {
        return $this->sendMessage($phone, $message);
    }

    public function forwardMessage(string $phone, string $messageId, ?string $fromPhone = null): array
    {
        $target = str_contains($phone, '@') ? $phone : $this->formatPhone($phone);
        $fromJid = null;

        if ($fromPhone) {
            $fromJid = str_contains($fromPhone, '@')
                ? $fromPhone
                : $this->formatPhone($fromPhone) . '@s.whatsapp.net';
        }

        $attempts = [
            [
                'endpoint' => 'message/forwardMessage',
                'payload' => array_filter([
                    'number' => $target,
                    'message' => [
                        'key' => array_filter([
                            'id' => $messageId,
                            'remoteJid' => $fromJid,
                            'fromMe' => false,
                        ], fn ($v) => $v !== null),
                    ],
                ], fn ($v) => $v !== null),
            ],
            [
                'endpoint' => 'message/forwardMessages',
                'payload' => array_filter([
                    'number' => $target,
                    'messages' => [[
                        'key' => array_filter([
                            'id' => $messageId,
                            'remoteJid' => $fromJid,
                            'fromMe' => false,
                        ], fn ($v) => $v !== null),
                    ]],
                ], fn ($v) => $v !== null),
            ],
        ];

        $lastError = null;

        foreach ($attempts as $attempt) {
            try {
                $response = $this->httpPost($attempt['endpoint'], $attempt['payload']);

                if (($response['status'] ?? null) !== 'ERROR') {
                    return $response;
                }

                $lastError = is_string($response['message'] ?? null)
                    ? $response['message']
                    : json_encode($response['error'] ?? $response);
            } catch (Exception $e) {
                $lastError = $e->getMessage();
            }
        }

        throw new Exception('Falha ao encaminhar mensagem na Evolution API. ' . ($lastError ?: 'Endpoint não suportado.'));
    }

    public function sendListMessage(string $phone, string $buttonText, string $description, array $sections): array
    {
        // Formato TEXTO SIMPLES para evitar bugs de List Message
        $text = "{$description}\n\n"; 
        foreach ($sections as $section) {
            if (!empty($section['title'])) {
                $text .= "*--- {$buttonText} ---*\n";
            }

            foreach ($section['rows'] as $row) {
                $id = $row['rowId'];
                $titulo = $row['title'] ?? '';
                $desc = $row['description'] ?? '';
                
                $text .= "{$id} - {$titulo}\n";
                
                if (!empty($desc)) {
                    $text .= "   _{$desc}_\n";
                }
            }
            $text .= "\n";
        }
        $text .= "\n👉 _Digite apenas o número da opção desejada._";
        return $this->sendMessage($phone, $text);
    }

    public function sendContactVcard(string $to, string $contactPhone, string $contactName): array
    {
        $payload = [
            'number' => $this->formatPhone($to),
            'contact' => [
                [ 
                    'fullName' => $contactName,
                    'wuid' => $this->formatPhone($contactPhone),
                    'phoneNumber' => $this->formatPhone($contactPhone)
                ]
            ]
        ];

        return $this->httpPost('message/sendContact', $payload);
    }

    public function sendPollMessage(string $phone, string $pollName, array $pollOptions): array
    {
        $payload = [
            'number' => $this->formatPhone($phone),
            'name' => $pollName,
            'selectableCount' => 1,
            'values' => $pollOptions // Array de strings
        ];

        return $this->httpPost('message/sendPoll', $payload);
    }

    /**
     * ===========================================================================================
     * 3. OPERAÇÕES DE MÍDIA (USANDO httpPost)
     * ===========================================================================================
     */

    private function sendMediaGeneric(string $phone, string $path, string $type, string $caption = '', ?string $fileName = null): array
    {
        // Verifica se é URL ou Local
        if (filter_var($path, FILTER_VALIDATE_URL)) {
            $mediaData = $path; // URL direta
        } else {
            // Local: converte para Base64
            $mediaData = $this->convertFileToBase64($path);
        }

        $payload = [
            'number' => $this->formatPhone($phone),
            'mediatype' => $type, 
            'mimetype' => $this->getMimeType($path),
            'caption' => $caption,
            'media' => $mediaData, 
        ];

        if ($fileName) {
            $payload['fileName'] = $fileName;
        }

        return $this->httpPost('message/sendMedia', $payload);
    }

    public function sendImage(string $to, string $path, string $caption = ''): array
    {
        return $this->sendMediaGeneric($to, $path, 'image', $caption);
    }

    public function sendFileBase64(string $phone, string $path, string $filename, string $caption = ''): array
    {
        return $this->sendMediaGeneric($phone, $path, 'document', $caption, $filename);
    }
    
    public function sendFileFromUrl(string $phone, string $url, string $filename, string $caption = ''): array
    {
        return $this->sendMediaGeneric($phone, $url, 'document', $caption, $filename);
    }

    public function sendVoiceBase64(string $phone, string $path): array
    {
        $mediaData = filter_var($path, FILTER_VALIDATE_URL) ? $path : $this->convertFileToBase64($path);

        $payload = [
            'number' => $this->formatPhone($phone),
            'audio' => $mediaData
        ];

        return $this->httpPost('message/sendWhatsAppAudio', $payload);
    }

    // Alias para sendVoiceBase64
    public function sendAudio(string $to, string $path): array
    {
        return $this->sendVoiceBase64($to, $path);
    }
    // Adicionar dentro da classe EvolutionApiService

/**
     * Endpoint: /chat/whatsappNumbers/{instance}
     * Documentação v2.3.7: Retorna array de objetos
     */
    public function checkNumber(string $phone): array
    {
        // Remove formatação, deixa apenas números
        $phone = $this->formatPhone($phone); 
        
        $url = "{$this->baseUrl}/chat/whatsappNumbers/{$this->session->session}";
        
        // Payload conforme seu print
        $payload = [
            'numbers' => [$phone]
        ];

        try {
            // Usando o httpPost ou chamada direta (vou usar direta para tratar o retorno específico)
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            
            if ($response->failed()) {
                return ['exists' => false];
            }

            $data = $response->json();

            // O retorno é um array: [ { "jid": "...", "exists": true, "number": "..." } ]
            if (is_array($data) && count($data) > 0) {
                $item = $data[0]; // Pegamos o primeiro item
                
                if (!empty($item['exists']) && $item['exists'] === true) {
                    // Retornamos no formato que o WppConnectService (antigo) espera receber
                    return [
                        'exists' => true,
                        'id' => [
                            '_serialized' => $item['jid'],
                            'user' => $item['number'] ?? $phone
                        ],
                        'isBusiness' => false,
                        'canReceiveMessage' => true,
                        'name' => $item['name'] ?? null
                    ];
                }
            }
            
            return ['exists' => false];

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] CheckNumber error: " . $e->getMessage());
            return ['exists' => false];
        }
    }

    /**
     * Endpoint: /message/sendLocation/{instance}
     * Documentação v2.3.7: Pede name e address
     */
    public function sendLocation(string $phone, string $lat, string $lng, string $title = '', string $address = ''): array
    {

        $payload = [
            'number' => $this->formatPhone($phone),
            'name' => $title ?: 'Localização', // O print mostra "name": "Bora Bora"
            'address' => $address,      // O print mostra "address": "French Polynesian"
            'latitude' => (float) $lat,      // Importante converter para float
            'longitude' => (float) $lng      // Importante converter para float
        ];

        return $this->httpPost('message/sendLocation', $payload);
    }

    /**
     * ===========================================================================================
     * 4. INTERATIVIDADE E UTILITÁRIOS
     * ===========================================================================================
     */
    /**
     * Marca uma mensagem específica como lida (Blue Ticks)
     */
    public function markAsRead(string $phone, ?string $messageId = null): array
    {
        // Se não tiver ID, não tem como marcar mensagem específica na v2
        if (!$messageId) {
            return ['status' => 'ERROR', 'message' => 'Message ID required for markAsRead'];
        }

        // Garante formatação JID
        if (!str_contains($phone, '@')) {
            $phone = preg_replace('/\D/', '', $phone) . '@s.whatsapp.net';
        }

        $url = "{$this->baseUrl}/chat/markMessageAsRead/{$this->session->session}";
        
        $payload = [
            'readMessages' => [
                [
                    'remoteJid' => $phone,
                    'fromMe' => false,
                    'id' => $messageId
                ]
            ]
        ];

        try {
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            return $response->json();
        } catch (Exception $e) {
            Log::error("Evolution markMessageAsRead error: " . $e->getMessage());
            return ['status' => 'ERROR'];
        }
    }
    public function markUnread(string $phone, ?string $messageId = null): array
    {
        if (!$messageId) {
            return ['status' => 'ERROR', 'message' => 'Message ID required for markAsRead'];
        }

        // Garante formatação JID
        if (!str_contains($phone, '@')) {
            $phone = preg_replace('/\D/', '', $phone) . '@s.whatsapp.net';
        }
         $url = "{$this->baseUrl}/chat/markChatUnread/{$this->session->session}";
        
        $payload = [
            'lastMessage' => [
                'key' => [
                    'remoteJid' => $phone,
                    'fromMe' => false,
                    'id' => $messageId
                ]
            ],
            "chat" => $phone
        ];
        try {
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            return $response->json();
        } catch (Exception $e) {
            Log::error("Evolution markChatUnread error: " . $e->getMessage());
            return ['status' => 'ERROR'];
        }
    }
    
    public function getMediaBase64(string $messageId): ?array
    {
        $url = "{$this->baseUrl}/chat/getBase64FromMediaMessage/{$this->session->session}";
        
        // PAYLOAD CORRIGIDO CONFORME SUA DOCUMENTAÇÃO
        $payload = [
            'message' => [
                'key' => [
                    'id' => $messageId
                ]
            ],
            'convertToMp4' => false
        ];

        try {
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            
            if ($response->failed()) {
                Log::error("Evolution getMediaBase64 Falhou [{$response->status()}]: " . $response->body());
                return null;
            }
            
            $data = $response->json();
            
            // Retorna array com dados ou null
            return [
                'base64' => $data['base64'] ?? null,
                'mimetype' => $data['mimetype'] ?? null,
                'fileName' => $data['fileName'] ?? null
            ];

        } catch (Exception $e) {
            Log::error("Evolution getMediaBase64 Exception: " . $e->getMessage());
            return null;
        }
    }

    public function reactMessage(string $messageId, string $emoji, ?string $phone = null): array
    {
        if (!$phone) {
            Log::warning("[EvolutionAPI] ReactMessage sem telefone.");
            return ['status' => 'ERROR', 'message' => 'Phone required'];
        }

        $remoteJid = str_contains($phone, '@') 
            ? $phone 
            : $this->formatPhone($phone) . "@s.whatsapp.net";

        $payload = [
            'reaction' => $emoji,
            'key' => [
                'remoteJid' => $remoteJid,
                'fromMe' => false,
                'id' => $messageId
            ]
        ];

        return $this->httpPost('message/reaction', $payload);
    }

    public function sendTyping(string $phone,  bool $status = true, $delay = null): void
    {
        $this->sendPresence($phone, $status ? 'composing' : 'paused', $delay);
    }

    public function sendRecording(string $phone, int $duration, bool $status): void
    {
        $this->sendPresence($phone, $status ? 'recording' : 'paused');
    }

    private function sendPresence(string $phone, string $presence, $delay = 2000): void
    {
        // Fire and forget, sem bloquear
        $url = "{$this->baseUrl}/chat/sendPresence/{$this->session->session}";
        $payload = [
            'number' => $this->formatPhone($phone),
            'presence' => $presence,
            'delay' => $delay
        ];
        try {
            Http::withHeaders($this->headers)->timeout(15)->post($url, $payload);
        } catch (Exception $e) {
            // Ignora erro de presença
        }
    }

    public function findLabels(): array
    {
        try {
            $url = "{$this->baseUrl}/label/findLabels/{$this->session->session}";
            $response = Http::withHeaders($this->headers)->timeout(4)->get($url);
            return $response->json() ?? [];
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Erro ao buscar labels: " . $e->getMessage());
            return [];
        }
    }

    public function handleLabel(string $phone, string $labelIdOrName, string $action = 'add'): array
    {
        try {
            $labelId = $labelIdOrName;
            // Se foi passado o nome da label, busca o ID correspondente
            if (!is_numeric($labelIdOrName)) {
                $labels = $this->findLabels();
                foreach ($labels as $lbl) {
                    if (strcasecmp(trim($lbl['name'] ?? ''), trim($labelIdOrName)) === 0) {
                        $labelId = (string) $lbl['id'];
                        break;
                    }
                }
            }

            $url = "{$this->baseUrl}/label/handleLabel/{$this->session->session}";
            $target = str_contains($phone, '@') ? $phone : $this->formatPhone($phone);
            $payload = [
                'number' => $target,
                'labelId' => (string) $labelId,
                'action' => $action,
            ];
            $response = Http::withHeaders($this->headers)->timeout(5)->post($url, $payload);
            return $response->json() ?? [];
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Erro ao aplicar label: " . $e->getMessage());
            return ['status' => 'ERROR', 'message' => $e->getMessage()];
        }
    }

    public function markChatUnread(string $phone): array
    {
        try {
            $target = str_contains($phone, '@') ? $phone : $this->formatPhone($phone) . '@s.whatsapp.net';
            
            // 1. Tenta buscar a última mensagem do chat para preencher lastMessage
            $urlFind = "{$this->baseUrl}/chat/findMessages/{$this->session->session}";
            $res = Http::withHeaders($this->headers)->post($urlFind, [
                'where' => ['key' => ['remoteJid' => $target]],
                'options' => ['offset' => 1, 'sort' => 'DESC', 'page' => 1]
            ]);
            $msg = $res->json()['messages']['records'][0] ?? $res->json()['messages'][0] ?? null;

            $url = "{$this->baseUrl}/chat/markChatUnread/{$this->session->session}";
            $payload = [
                'chat' => $target,
                'lastMessage' => $msg ?: ['key' => ['remoteJid' => $target, 'fromMe' => true]]
            ];
            $response = Http::withHeaders($this->headers)->post($url, $payload);
            return $response->json() ?? [];
        } catch (Exception $e) {
            Log::error("[EvolutionAPI] Erro ao marcar chat como não lido: " . $e->getMessage());
            return ['status' => 'ERROR', 'message' => $e->getMessage()];
        }
    }

    /**
     * Endpoint: /chat/findChats/{instance}
     * CORREÇÃO: Método deve ser POST
     */
    public function fetchContacts(): array
    {
        $url = "{$this->baseUrl}/chat/findChats/{$this->session->session}";

        try {
            // CORREÇÃO: MUDADO DE GET PARA POST
            // A Evolution v2 geralmente aceita um body vazio ou com filtros. 
            // Enviamos um array vazio [] para garantir.
            $response = Http::withHeaders($this->headers)->post($url, []);
            
            if ($response->failed()) {
                Log::error("[EvolutionAPI] fetchContacts Falhou: " . $response->body());
                return [];
            }

            $chats = $response->json() ?? [];

            // Log para debug (verifique no laravel.log do Servidor 1)
            Log::info("[EvolutionAPI] Contatos/Chats encontrados: " . count($chats));

            return array_map(function($chat) {
                $realJid = $chat['remoteJid'] ?? null;
                $altJid = $chat['lastMessage']['key']['remoteJidAlt'] ?? $chat['remoteJidAlt'] ?? null;
                
                // Se remoteJid for @lid ou não for @s.whatsapp.net, prefere remoteJidAlt
                if (!empty($altJid) && str_ends_with($altJid, '@s.whatsapp.net')) {
                    $realJid = $altJid;
                }

                $numero = $realJid ? explode('@', $realJid)[0] : null;
                $nome = $chat['pushName'] ?? $chat['lastMessage']['pushName'] ?? $chat['name'] ?? null;
                if ($nome === 'Você') {
                    $nome = null;
                }

                $ultimoTexto = $chat['lastMessage']['message']['conversation'] 
                    ?? $chat['lastMessage']['message']['extendedTextMessage']['text']
                    ?? null;

                return [
                    'id' => [
                        '_serialized' => $realJid,
                        'user' => $numero
                    ],
                    'name' => $nome,
                    'pushname' => $nome,
                    'number' => $numero,
                    'isMyContact' => $chat['isSaved'] ?? false, 
                    'profilePicUrl' => $chat['profilePicUrl'] ?? null,
                    'last_message' => $ultimoTexto,
                    'timestamp' => $chat['lastMessage']['messageTimestamp'] ?? null,
                    'from_me' => $chat['lastMessage']['key']['fromMe'] ?? false,
                ];
            }, $chats);

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] fetchContacts Exception: " . $e->getMessage());
            return [];
        }
    }
    /**
     * Endpoint: /group/fetchAllGroups/{instance}?getParticipants=false
     * O JSON retornado usa "subject" como nome e "id" como JID.
     */
    public function fetchGroups(): array
    {
        $url = "{$this->baseUrl}/group/fetchAllGroups/{$this->session->session}?getParticipants=false";

        try {
            $response = Http::withHeaders($this->headers)->get($url);
            
            if ($response->failed()) return [];

            $groups = $response->json() ?? [];

            return array_map(function($g) {
                // No JSON de grupos, o ID já é o correto (ex: 12036...@g.us)
                $jid = $g['id'] ?? null;
                
                return [
                    'id' => [
                        '_serialized' => $jid,
                        'user' => $jid ? explode('@', $jid)[0] : null
                    ],
                    // No Evolution Groups o nome vem em 'subject'
                    'name' => $g['subject'] ?? $g['name'] ?? 'Sem Nome',
                    'subject' => $g['subject'] ?? null,
                    'owner' => $g['owner'] ?? null,
                    'creation' => $g['creation'] ?? null,
                    'size' => $g['size'] ?? 0
                ];
            }, $groups);

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] fetchGroups error: " . $e->getMessage());
            return [];
        }
    }
    /**
     * Endpoint: /group/participants/{instance}?groupJid=...
     * Busca os participantes de um grupo específico
     */
    
    public function addGroupParticipant(string $groupJid, array $participants): array
    {
        if (!str_ends_with($groupJid, '@g.us')) {
            $groupJid .= '@g.us';
        }

        $formattedParticipants = array_values(array_unique(array_filter(array_map(function ($p) {
            return $this->standardizePhoneNumber($p);
        }, $participants))));

        $url = "{$this->baseUrl}/group/updateParticipant/{$this->session->session}";
        Log::info("[EvolutionAPI] addGroupParticipant", [
            'groupJid' => $groupJid,
            'participants' => $formattedParticipants
        ]);
        try {
            $response = \Illuminate\Support\Facades\Http::withHeaders($this->headers)->post($url, [
                'groupJid' => $groupJid,
                'action' => 'add',
                'participants' => $formattedParticipants
            ]);

            if ($response->successful()) {
                return ['status' => 'SUCCESS', 'data' => $response->json()];
            }

            return [
                'status' => 'ERROR',
                'message' => 'Erro ao adicionar ao grupo.',
                'response' => $response->json()
            ];
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("[EvolutionAPI] addGroupParticipant error: " . $e->getMessage());
            return ['status' => 'ERROR', 'message' => $e->getMessage()];
        }
    }
public function fetchGroupMembers(string $groupJid): array
    {
        // Garante formato (Evolution precisa do @g.us no parametro GET)
        if (!str_ends_with($groupJid, '@g.us')) {
            $groupJid .= '@g.us';
        }

        $url = "{$this->baseUrl}/group/participants/{$this->session->session}";

        try {
            // Passa o groupJid como Query Param
            $response = Http::withHeaders($this->headers)->get($url, [
                'groupJid' => $groupJid
            ]);
            
            if ($response->failed()) return [];

            $data = $response->json();
            // A Evolution retorna: { "participants": [ { "id": "...", "admin": null }, ... ] }
            $participants = $data['participants'] ?? $data ?? [];

            return array_map(function($p) {
                $jid = $p['id'] ?? null;
                return [
                    'id' => [
                        '_serialized' => $jid,
                        'user' => $jid ? explode('@', $jid)[0] : null
                    ],
                    'phoneNumber' => $p['phoneNumber'] ?? null, // <-- ADICIONA ISTO
                    'isAdmin' => ($p['admin'] === 'admin' || $p['admin'] === 'superadmin'),
                    'isSuperAdmin' => ($p['admin'] === 'superadmin'),
                ];
            }, $participants);;

        } catch (Exception $e) {
            Log::error("[EvolutionAPI] fetchGroupMembers error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * ===========================================================================================
     * 5. HELPERS PRIVADOS
     * ===========================================================================================
     */

    private function standardizePhoneNumber(?string $value): ?string
    {
        if (empty($value)) {
            return null;
        }

        if (str_contains($value, '@')) {
            $value = explode('@', $value)[0];
        }

        $number = preg_replace('/\D/', '', $value);
        if (empty($number)) {
            return null;
        }

        if (str_starts_with($number, '55')) {
            $number = substr($number, 2);
        }
        if (str_starts_with($number, '0')) {
            $number = substr($number, 1);
        }
        if (strlen($number) === 10) {
            $ddd = substr($number, 0, 2);
            $body = substr($number, 2);
            $number = $ddd . '9' . $body;
        }

        return '55' . $number;
    }

    private function formatPhone(string $phone): string
    {
        if (str_contains($phone, '@')) {
            return $phone;
        }
        return preg_replace('/\D/', '', $phone);
    }

    private function mapStatus($evolutionState, $hasQrCode)
    {
        $state = strtolower((string) $evolutionState);

        if (in_array($state, ['open', 'connected', 'online', 'inchat'], true)) return 'CONNECTED';
        if (in_array($state, ['connecting', 'starting', 'initializing'], true)) return 'STARTING';
        if ($hasQrCode || in_array($state, ['qrcode', 'qr', 'scan_qr'], true)) return 'QRCODE';
        return 'DISCONNECTED';
    }

    private function getMimeType($filename)
    {
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $mimes = [
            'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png',
            'pdf' => 'application/pdf', 'doc' => 'application/msword', 
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'mp4' => 'video/mp4', 'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg'
        ];
        return $mimes[$extension] ?? 'application/octet-stream';
    }

    private function convertFileToBase64(string $path): string
    {
        if (!is_file($path)) {
            throw new Exception("Arquivo não encontrado em: {$path}");
        }

        $mime = mime_content_type($path) ?: 'application/octet-stream';
        $data = file_get_contents($path);
        if ($data === false) {
            throw new Exception("Falha ao ler arquivo para base64: {$path}");
        }

        return 'data:' . $mime . ';base64,' . base64_encode($data);
    }
    // Helper simples para extrair texto/tipo do JSON complexo da Evolution
// Helper para extrair texto/tipo do JSON complexo da Evolution e identificar arquivos
    private function extrairConteudoMessage($msg) {
        $m = $msg['message'] ?? [];

        // 1. Texto simples
        if (isset($m['conversation'])) {
            return ['tipo' => 'text', 'texto' => $m['conversation']];
        }
        
        // 2. Texto longo ou com menção
        if (isset($m['extendedTextMessage'])) {
            return ['tipo' => 'text', 'texto' => $m['extendedTextMessage']['text']];
        }
        
        // 3. Imagem
        if (isset($m['imageMessage'])) {
            $caption = $m['imageMessage']['caption'] ?? '';
            return ['tipo' => 'image', 'texto' => $caption ?: '[📷 Imagem recebida]'];
        }
        
        // 4. Vídeo
        if (isset($m['videoMessage'])) {
            $caption = $m['videoMessage']['caption'] ?? '';
            return ['tipo' => 'video', 'texto' => $caption ?: '[🎥 Vídeo recebido]'];
        }
        
        // 5. Áudio (Voice note)
        if (isset($m['audioMessage'])) {
            return ['tipo' => 'audio', 'texto' => '[🎵 Mensagem de Áudio]'];
        }
        
        // 6. Documento / Arquivo PDF, Word, Excel, etc.
        if (isset($m['documentMessage'])) {
            $fileName = $m['documentMessage']['fileName'] ?? 'Arquivo anexo';
            $mimetype = $m['documentMessage']['mimetype'] ?? null;
            $caption = $m['documentMessage']['caption'] ?? '';
            
            // Se tiver texto junto com o arquivo, junta os dois. Se não, avisa só o nome do arquivo.
            $textoFinal = $caption ? "{$caption}\n\n[📎 Arquivo: {$fileName}]" : "[📎 Arquivo: {$fileName}]";
            
            return ['tipo' => 'document', 'texto' => $textoFinal, 'fileName' =>$fileName, 'mimetype' => $mimetype ];
        }
        
        // 7. Sticker (Figurinha)
        if (isset($m['stickerMessage'])) {
            return ['tipo' => 'image', 'texto' => '[✨ Figurinha]'];
        }
        
        // 8. Contato
        if (isset($m['contactMessage'])) {
            $name = $m['contactMessage']['displayName'] ?? 'Contato';
            return ['tipo' => 'text', 'texto' => "[👤 Contato compartilhado: {$name}]"];
        }

        // 9. Localização
        if (isset($m['locationMessage'])) {
            return ['tipo' => 'text', 'texto' => '[📍 Localização compartilhada]'];
        }

        // Default / Desconhecido
        return ['tipo' => 'text', 'texto' => '[Mensagem não suportada/Mídia]'];
    }
    
    /**
     * Busca a URL da foto de perfil do cliente na Evolution API
     */
    public function getProfilePicture(string $phone): ?string
    {
        // Remove @c.us, @g.us e qualquer caractere que não seja número
        $target = str_contains($phone, '@') ? $phone : $this->formatPhone($phone);
        $url = "{$this->baseUrl}/chat/fetchProfilePictureUrl/{$this->session->session}";
        try {
            
            $response = Http::withHeaders($this->headers)->post($url, [
                'number' => $target
            ]);

            if ($response->successful()) {
                $data = $response->json();
                
                // A resposta padrão da Evolution API vem na chave 'profilePictureUrl'
                // Se o cliente não tiver foto, ela costuma retornar null ou uma string vazia
                return $data['profilePictureUrl'] ?? $data['url'] ?? null;
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error("EvolutionApiService: Erro ao buscar foto de perfil para {$target}: " . $e->getMessage());
        }

        return null;
    }
    
    public function sendTemplateMessage(string $phone, string $templateName, array $components = [], $languge = 'pt_BR'): array {return[];}
    
    
    
    
    
}