<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();

if (!isset($data['cookies'])) {
    jsonError('Cookies não fornecidos');
}

$cookiesContent = trim($data['cookies']);
$region = requireRegion($data);
$countryId = isset($data['countryId']) ? (int)$data['countryId'] : 30;

if (!validateCookiesFormat($cookiesContent)) {
    jsonError('Formato de cookies inválido. Certifique-se de usar o formato Netscape.');
}

$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado nos cookies. Certifique-se de estar logado no Waze Map Editor.');
}

$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);

    $testData = [
        'fromCreationTime' => null,
        'fromUpdateTime' => null,
        'toCreationTime' => null,
        'toUpdateTime' => null,
        'bbox' => null,
        'cityId' => null,
        'countryId' => $countryId,
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

    $result = makeCurlRequest(wazeIssuesEndpoint($region), $tempFile, $csrfToken, $testData, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] === 200) {
        $responseData = json_decode($result['response'], true);
        if (json_last_error() === JSON_ERROR_NONE) {
            $sessionToken = createSession($cookiesContent);
            jsonResponse([
                'success' => true,
                'message' => 'Cookies válidos! Você está autenticado.',
                'sessionToken' => $sessionToken,
                'expiresIn' => SESSION_TTL
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
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao testar cookies: ' . $e->getMessage(), 500);
}
