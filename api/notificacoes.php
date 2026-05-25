<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado');
}

$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);
    $result = makeCurlRequest(wazeNotificationsEndpoint($region), $tempFile, $csrfToken, null, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao buscar notificações (HTTP {$result['httpCode']})", 500);
    }

    $responseData = json_decode($result['response'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    $notifications = [];
    foreach ($responseData['notifications']['objects'] ?? [] as $n) {
        $params = $n['parameters'] ?? [];
        $notifications[] = [
            'id' => $n['id'] ?? '',
            'type' => $n['type'] ?? '',
            'timestamp' => $n['timestamp'] ?? null,
            'sender' => $params['sender'] ?? '',
            'username' => $params['username'] ?? '',
            'title' => $params['title'] ?? '',
            'message' => $params['message'] ?? '',
            'shortMessage' => $params['shortMessage'] ?? ''
        ];
    }

    jsonResponse([
        'success' => true,
        'notifications' => $notifications,
        'count' => count($notifications)
    ]);
} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao buscar notificações: ' . $e->getMessage(), 500);
}
