<?php
require_once 'config.php';

// Apenas POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

// Recebe dados
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!isset($data['cookies'])) {
    jsonError('Cookies não fornecidos');
}

$cookiesContent = trim($data['cookies']);
$page = isset($data['page']) ? (int)$data['page'] : 1;

// Valida formato
if (!validateCookiesFormat($cookiesContent)) {
    jsonError('Formato de cookies inválido');
}

// Extrai CSRF token
$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado');
}

// Cria arquivo temporário
$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);
    
    // Monta payload para buscar places pendentes (apenas não lidos)
    $payload = [
        'fromCreationTime' => null,
        'fromUpdateTime' => null,
        'toCreationTime' => null,
        'toUpdateTime' => null,
        'bbox' => null,
        'cityId' => null,
        'countryId' => 30, // Brasil
        'managedAreaId' => null,
        'stateId' => null,
        'userPropertiesFilter' => [
            'isRead' => false
        ],
        'venueUpdateRequestsFilter' => [
            'categories' => null,
            'lockRanks' => [0, 1, 2, 3, 4, 5],
            'page' => $page,
            'residential' => null,
            'types' => null
        ]
    ];
    
    $result = makeCurlRequest(
        WAZE_ISSUES_ENDPOINT,
        $tempFile,
        $csrfToken,
        $payload
    );
    
    // Limpa arquivo temporário
    deleteTempCookieFile($tempFile);
    
    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao buscar places (HTTP {$result['httpCode']})", 500);
    }
    
    $responseData = json_decode($result['response'], true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }
    
    // Cria dicionários para mapeamento rápido
    $usersDict = [];
    if (isset($responseData['users']['objects'])) {
        foreach ($responseData['users']['objects'] as $u) {
            $usersDict[$u['id']] = $u['userName'];
        }
    }
    
    $streetsDict = [];
    if (isset($responseData['streets']['objects'])) {
        foreach ($responseData['streets']['objects'] as $s) {
            $streetsDict[$s['id']] = $s;
        }
    }
    
    $citiesDict = [];
    if (isset($responseData['cities']['objects'])) {
        foreach ($responseData['cities']['objects'] as $c) {
            $citiesDict[$c['id']] = $c;
        }
    }
    
    $statesDict = [];
    if (isset($responseData['states']['objects'])) {
        foreach ($responseData['states']['objects'] as $st) {
            $statesDict[$st['id']] = $st['name'];
        }
    }

    // Processa places
    $places = [];
    
    if (isset($responseData['venues']['objects']) && is_array($responseData['venues']['objects'])) {
        foreach ($responseData['venues']['objects'] as $venue) {
            if (!isset($venue['venueUpdateRequests'][0])) {
                continue;
            }
            
            $updateRequest = $venue['venueUpdateRequests'][0];
            
            $creatorId = $updateRequest['createdBy'] ?? null;
            $creatorName = $creatorId && isset($usersDict[$creatorId]) ? $usersDict[$creatorId] : $creatorId;
            // Detalha o tipo de requisição
            $updateTypeStr = 'Desconhecido';
            $reqType = $updateRequest['type'] ?? '';
            $reqSubType = $updateRequest['subType'] ?? '';
            
            if ($reqType === 'VENUE') {
                $updateTypeStr = 'Novo Local';
            } elseif ($reqType === 'IMAGE') {
                $updateTypeStr = 'Nova Foto';
            } elseif ($reqType === 'REQUEST' && $reqSubType === 'FLAG') {
                $updateTypeStr = 'Reporte (Sinalização)';
            } elseif ($reqType === 'REQUEST' && $reqSubType === 'UPDATE') {
                $changedFields = [];
                if (isset($updateRequest['changedVenue']) && is_array($updateRequest['changedVenue'])) {
                    foreach (array_keys($updateRequest['changedVenue']) as $k) {
                        if ($k === 'permissions') continue; // Campo interno
                        if ($k === 'name') $changedFields[] = 'Nome';
                        elseif ($k === 'description') $changedFields[] = 'Descrição';
                        elseif ($k === 'houseNumber') $changedFields[] = 'Número';
                        elseif ($k === 'phone') $changedFields[] = 'Telefone';
                        elseif ($k === 'geometry') $changedFields[] = 'Localização';
                        elseif ($k === 'categories') $changedFields[] = 'Categorias';
                        elseif ($k === 'aliases') $changedFields[] = 'Nomes Alternativos';
                        elseif ($k === 'url') $changedFields[] = 'Site';
                        elseif ($k === 'openingHours') $changedFields[] = 'Horário';
                        elseif ($k === 'streetID') $changedFields[] = 'Rua';
                        elseif ($k === 'cityID') $changedFields[] = 'Cidade';
                        elseif ($k === 'residential') $changedFields[] = 'Residencial';
                        elseif ($k === 'brand') $changedFields[] = 'Marca';
                        else $changedFields[] = ucfirst($k);
                    }
                }
                if (count($changedFields) > 0) {
                    $updateTypeStr = 'Atualização: ' . implode(', ', $changedFields);
                } else {
                    $updateTypeStr = 'Atualização (Detalhes)';
                }
            }

            // Monta objeto do place
            $place = [
                'venueID' => $venue['id'],
                'updateRequestID' => $updateRequest['id'],
                'name' => $venue['name'] ?? 'Sem nome',
                'categories' => $venue['categories'] ?? [],
                'address' => null,
                'updateType' => $updateTypeStr,
                'createdBy' => $creatorName,
                'imageUrl' => null
            ];
            
            // Monta endereço completo
            $addressParts = [];
            
            if (isset($venue['streetID']) && $venue['streetID'] && isset($streetsDict[$venue['streetID']])) {
                $street = $streetsDict[$venue['streetID']];
                
                // Nome da rua
                $streetName = trim($street['name'] ?? '');
                if ($streetName !== '') {
                    $addressParts[] = $streetName;
                }
                
                // Número
                if (isset($venue['houseNumber']) && trim($venue['houseNumber']) !== '') {
                    $addressParts[] = trim($venue['houseNumber']);
                }
                
                // Cidade e Estado
                if (isset($street['cityID']) && isset($citiesDict[$street['cityID']])) {
                    $city = $citiesDict[$street['cityID']];
                    $cityName = trim($city['name'] ?? '');
                    
                    if ($cityName !== '') {
                        $cityPart = $cityName;
                        if (isset($city['stateID']) && isset($statesDict[$city['stateID']])) {
                            $stateName = $statesDict[$city['stateID']];
                            if (trim($stateName) !== '') {
                                $cityPart .= ' - ' . trim($stateName);
                            }
                        }
                        $addressParts[] = $cityPart;
                    }
                }
            } else {
                // Se não achar a rua, tenta pelo menos colocar o número
                if (isset($venue['houseNumber']) && trim($venue['houseNumber']) !== '') {
                    $addressParts[] = trim($venue['houseNumber']);
                }
            }
            
            $place['address'] = !empty($addressParts) ? implode(', ', $addressParts) : null;
            
            // URL da imagem (se disponível)
            if (isset($venue['images'][0]['id'])) {
                $place['imageUrl'] = WAZE_IMAGE_BASE . $venue['images'][0]['id'];
            }
            
            $places[] = $place;
        }
    }
    
    // Verifica se há mais páginas
    $hasMore = isset($responseData['mapIssues']['venueUpdateRequests']['hasMore']) 
        ? $responseData['mapIssues']['venueUpdateRequests']['hasMore'] 
        : false;
    
    jsonResponse([
        'success' => true,
        'places' => $places,
        'hasMore' => $hasMore,
        'page' => $page,
        'total' => count($places)
    ]);
    
} catch (Exception $e) {
    if ($tempFile) {
        deleteTempCookieFile($tempFile);
    }
    jsonError('Erro ao buscar places: ' . $e->getMessage(), 500);
}