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

    $cat = categorizeWazeError($result['httpCode'], $result['response'], $result['error']);

    if ($result['httpCode'] === 200 && $cat['category'] !== 'already_processed') {
        jsonResponse([
            'success' => true,
            'message' => 'Place rejeitado com sucesso',
            'action' => 'rejected'
        ]);
    }

    jsonResponse([
        'success' => false,
        'error' => $cat['message'],
        'errorCategory' => $cat['category'],
        'httpCode' => $result['httpCode']
    ], $cat['category'] === 'already_processed' || $cat['category'] === 'not_found' ? 200 : 500);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonResponse([
        'success' => false,
        'error' => 'Erro ao rejeitar place: ' . $e->getMessage(),
        'errorCategory' => 'unknown'
    ], 500);
}
