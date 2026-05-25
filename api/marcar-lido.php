<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

$ids = [];
if (isset($data['items']) && is_array($data['items'])) {
    foreach ($data['items'] as $item) {
        if (isset($item['venueID']) && isset($item['updateRequestID'])) {
            $ids[] = [
                'id' => $item['updateRequestID'],
                'venueId' => $item['venueID']
            ];
        }
    }
} elseif (isset($data['venueID']) && isset($data['updateRequestID'])) {
    $ids[] = [
        'id' => $data['updateRequestID'],
        'venueId' => $data['venueID']
    ];
}

if (count($ids) === 0) {
    jsonError('Dados incompletos');
}

if (!validateCookiesFormat($cookiesContent)) {
    jsonError('Formato de cookies inválido');
}

$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado');
}

$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);

    $payload = [
        'value' => true,
        'venueUpdateRequestIds' => $ids
    ];

    $result = makeCurlRequest(wazeMarkReadEndpoint($region), $tempFile, $csrfToken, $payload, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao marcar como lido (HTTP {$result['httpCode']})", 500);
    }

    jsonResponse([
        'success' => true,
        'count' => count($ids),
        'message' => count($ids) === 1 ? 'Place marcado como lido com sucesso' : count($ids) . ' places marcados como lidos'
    ]);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao marcar como lido: ' . $e->getMessage(), 500);
}
