<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

if (!isset($data['venueID']) || !isset($data['updateRequestID'])) {
    jsonError('Parâmetros incompletos');
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
        'actions' => [
            'name' => 'DESCARTES_SERIALIZATION',
            '_subActions' => [
                [
                    'name' => 'UPDATE_PLACE_UPDATE',
                    '_subActions' => [
                        [
                            'name' => 'UPDATE_PLACE_UPDATE',
                            '_objectType' => 'venueUpdateRequest',
                            'action' => 'UPDATE',
                            'attributes' => [
                                'approve' => false,
                                'id' => $updateRequestID,
                                'venueID' => $venueID
                            ]
                        ]
                    ]
                ]
            ]
        ]
    ];

    $result = makeCurlRequest(wazeFeaturesEndpoint($region), $tempFile, $csrfToken, $payload, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao rejeitar place (HTTP {$result['httpCode']})", 500);
    }

    $responseData = json_decode($result['response'], true);

    if (json_last_error() !== JSON_ERROR_NONE && !empty($result['response'])) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    jsonResponse([
        'success' => true,
        'message' => 'Place rejeitado com sucesso',
        'action' => 'rejected'
    ]);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao rejeitar place: ' . $e->getMessage(), 500);
}
