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
    $result = makeCurlRequest(wazeCountriesEndpoint($region), $tempFile, $csrfToken, null, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao buscar países (HTTP {$result['httpCode']})", 500);
    }

    $responseData = json_decode($result['response'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    $countries = [];
    foreach ($responseData['countries'] ?? [] as $c) {
        $countries[] = [
            'id' => $c['id'] ?? null,
            'name' => $c['name'] ?? '',
            'abbr' => $c['abbr'] ?? '',
            'env' => strtolower($c['env'] ?? 'row')
        ];
    }

    usort($countries, function($a, $b) {
        return strcmp($a['name'], $b['name']);
    });

    jsonResponse([
        'success' => true,
        'countries' => $countries
    ]);
} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao buscar países: ' . $e->getMessage(), 500);
}
