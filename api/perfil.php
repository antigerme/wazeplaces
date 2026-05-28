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
    $result = makeCurlRequest(wazeSessionEndpoint($region), $tempFile, $csrfToken, null, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        $cat = categorizeWazeError($result['httpCode'], $result['response'], $result['error']);
        jsonResponse([
            'success' => false,
            'error' => $cat['message'],
            'errorCategory' => $cat['category'],
            'httpCode' => $result['httpCode']
        ], $cat['category'] === 'unauthorized' ? 401 : 500);
    }

    $responseData = json_decode($result['response'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    $areas = [];
    if (isset($responseData['areas']) && is_array($responseData['areas'])) {
        foreach ($responseData['areas'] as $area) {
            $bbox = null;
            if (isset($area['geometry']['coordinates'][0]) && is_array($area['geometry']['coordinates'][0])) {
                $coords = $area['geometry']['coordinates'][0];
                $lons = array_map(function($c) { return $c[0]; }, $coords);
                $lats = array_map(function($c) { return $c[1]; }, $coords);
                if (count($lons) > 0 && count($lats) > 0) {
                    $bbox = [min($lons), min($lats), max($lons), max($lats)];
                }
            }
            $areas[] = [
                'type' => $area['type'] ?? null,
                'bbox' => $bbox
            ];
        }
    }

    $managedAreas = [];
    if (isset($responseData['managedAreas']) && is_array($responseData['managedAreas'])) {
        foreach ($responseData['managedAreas'] as $ma) {
            $managedAreas[] = [
                'id' => $ma['id'] ?? null,
                'name' => $ma['name'] ?? ''
            ];
        }
    }

    jsonResponse([
        'success' => true,
        'profile' => [
            'id' => $responseData['id'] ?? null,
            'userName' => $responseData['userName'] ?? '',
            'rank' => $responseData['rank'] ?? null,
            'isStaff' => $responseData['isStaff'] ?? false,
            'isAreaManager' => $responseData['isAreaManager'] ?? false,
            'isEditor' => $responseData['isEditor'] ?? false,
            'profileImageUrl' => $responseData['profileImageUrl'] ?? '',
            'editableCountryIDs' => $responseData['editableCountryIDs'] ?? [],
            'totalPoints' => $responseData['totalPoints'] ?? 0,
            'totalEdits' => $responseData['totalEdits'] ?? 0,
            'areas' => $areas,
            'managedAreas' => $managedAreas
        ]
    ]);
} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao buscar perfil: ' . $e->getMessage(), 500);
}
