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

// Valida formato
if (!validateCookiesFormat($cookiesContent)) {
    jsonError('Formato de cookies inválido. Certifique-se de usar o formato Netscape.');
}

// Extrai CSRF token
$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado nos cookies. Certifique-se de estar logado no Waze Map Editor.');
}

// Cria arquivo temporário
$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);
    
    // Testa fazendo uma requisição simples à API do Waze
    $testData = [
        'fromCreationTime' => null,
        'fromUpdateTime' => null,
        'toCreationTime' => null,
        'toUpdateTime' => null,
        'bbox' => null,
        'cityId' => null,
        'countryId' => 30, // Brasil
        'managedAreaId' => null,
        'stateId' => null,
        'userPropertiesFilter' => new stdClass(),
        'venueUpdateRequestsFilter' => [
            'categories' => null,
            'lockRanks' => [0, 1, 2, 3, 4, 5],
            'page' => 1,
            'residential' => null,
            'types' => null
        ]
    ];
    
    $result = makeCurlRequest(
        WAZE_ISSUES_ENDPOINT,
        $tempFile,
        $csrfToken,
        $testData
    );
    
    // Limpa arquivo temporário
    deleteTempCookieFile($tempFile);
    
    // Verifica resposta
    if ($result['httpCode'] === 200) {
        $responseData = json_decode($result['response'], true);
        
        if (json_last_error() === JSON_ERROR_NONE) {
            jsonResponse([
                'success' => true,
                'message' => 'Cookies válidos! Você está autenticado.',
                'csrfToken' => $csrfToken
            ]);
        } else {
            jsonError('Resposta inválida da API do Waze');
        }
    } else if ($result['httpCode'] === 401 || $result['httpCode'] === 403) {
        jsonError('Cookies expirados ou inválidos. Faça login novamente no Waze Map Editor e exporte novos cookies.');
    } else {
        jsonError("Erro ao validar cookies (HTTP {$result['httpCode']})");
    }
    
} catch (Exception $e) {
    if ($tempFile) {
        deleteTempCookieFile($tempFile);
    }
    jsonError('Erro ao testar cookies: ' . $e->getMessage(), 500);
}