<?php
require_once 'config.php';

// Apenas POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

// Recebe dados
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!isset($data['cookies']) || !isset($data['venueID']) || !isset($data['updateRequestID'])) {
    jsonError('Dados incompletos');
}

$cookiesContent = trim($data['cookies']);
$venueID = $data['venueID'];
$updateRequestID = $data['updateRequestID'];

// Valida formato
if (!validateCookiesFormat($cookiesContent)) {
    jsonError('Formato de cookies inválido');
}

// Extrai CSRF token
$csrfToken = extractCSRFToken($cookiesContent);
if (!$csrfToken) {
    jsonError('Token CSRF não encontrado');
}

// Cria arquivo temporário
$tempFile = null;
try {
    $tempFile = createTempCookieFile($cookiesContent);
    
    // Monta payload para marcar como lido
    $payload = [
        'value' => true,
        'venueUpdateRequestIds' => [
            [
                'id' => $updateRequestID,
                'venueId' => $venueID
            ]
        ]
    ];
    
    $result = makeCurlRequest(
        WAZE_MARK_READ_ENDPOINT,
        $tempFile,
        $csrfToken,
        $payload
    );
    
    // Limpa arquivo temporário
    deleteTempCookieFile($tempFile);
    
    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao marcar como lido (HTTP {$result['httpCode']})", 500);
    }
    
    jsonResponse([
        'success' => true,
        'message' => 'Place marcado como lido com sucesso'
    ]);
    
} catch (Exception $e) {
    if ($tempFile) {
        deleteTempCookieFile($tempFile);
    }
    jsonError('Erro ao marcar como lido: ' . $e->getMessage(), 500);
}