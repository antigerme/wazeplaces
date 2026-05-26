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

    $result = makeCurlRequest(wazeSessionEndpoint($region), $tempFile, $csrfToken, null, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] === 401 || $result['httpCode'] === 403) {
        jsonError('Cookies expirados ou inválidos. Faça login novamente no Waze Map Editor e exporte novos cookies.');
    }
    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao validar cookies (HTTP {$result['httpCode']})");
    }

    $profile = json_decode($result['response'], true);
    if (!is_array($profile) || empty($profile['userName'])) {
        jsonError('Resposta inválida da API do Waze');
    }

    $check = isUserAllowed($profile);
    if (!$check['allowed']) {
        jsonResponse([
            'success' => false,
            'error' => $check['reason'],
            'errorCategory' => 'access_denied',
            'profile' => [
                'userName' => $profile['userName'] ?? '',
                'rank' => $profile['rank'] ?? null,
                'isAreaManager' => !empty($profile['isAreaManager']),
                'isStaff' => !empty($profile['isStaff'])
            ]
        ], 403);
    }

    $sessionToken = createSession($cookiesContent);
    jsonResponse([
        'success' => true,
        'message' => 'Cookies válidos! Você está autenticado.',
        'sessionToken' => $sessionToken,
        'expiresIn' => SESSION_TTL
    ]);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao testar cookies: ' . $e->getMessage(), 500);
}
