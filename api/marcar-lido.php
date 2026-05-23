<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

if (!isset($data['venueID']) || !isset($data['updateRequestID'])) {
    jsonError('Dados incompletos');
}

$venueID = $data['venueID'];
$updateRequestID = $data['updateRequestID'];

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
        'venueUpdateRequestIds' => [
            [
                'id' => $updateRequestID,
                'venueId' => $venueID
            ]
        ]
    ];

    $result = makeCurlRequest(wazeMarkReadEndpoint($region), $tempFile, $csrfToken, $payload, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao marcar como lido (HTTP {$result['httpCode']})", 500);
    }

    jsonResponse([
        'success' => true,
        'message' => 'Place marcado como lido com sucesso'
    ]);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao marcar como lido: ' . $e->getMessage(), 500);
}
