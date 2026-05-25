<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

$countryId = isset($data['countryId']) ? (int)$data['countryId'] : 0;
if ($countryId <= 0) {
    jsonError('countryId obrigatório');
}

$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado');
}

$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);
    $result = makeCurlRequest(wazeStatesEndpoint($region, $countryId), $tempFile, $csrfToken, null, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao buscar estados (HTTP {$result['httpCode']})", 500);
    }

    $responseData = json_decode($result['response'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    $states = [];
    foreach ($responseData['states'] ?? [] as $s) {
        if (($s['countryId'] ?? null) !== $countryId) continue;
        $states[] = [
            'id' => $s['id'] ?? null,
            'name' => $s['name'] ?? '',
            'countryId' => $s['countryId'] ?? null
        ];
    }

    usort($states, function($a, $b) {
        return strcmp($a['name'], $b['name']);
    });

    jsonResponse([
        'success' => true,
        'states' => $states
    ]);
} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao buscar estados: ' . $e->getMessage(), 500);
}
