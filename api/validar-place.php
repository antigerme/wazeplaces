<?php
require_once 'config.php';

// Apenas POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

// Recebe dados
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!isset($data['cookies']) || !isset($data['venueID']) || 
    !isset($data['updateRequestID']) || !isset($data['approve'])) {
    jsonError('Parâmetros incompletos');
}

$cookiesContent = trim($data['cookies']);
$venueID = $data['venueID'];
$updateRequestID = $data['updateRequestID'];
$approve = (bool)$data['approve'];

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
    
    // Monta payload para validar place
    // Estrutura correta baseada no curl do Chrome
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
                                'approve' => $approve,
                                'id' => $updateRequestID,
                                'venueID' => $venueID
                            ]
                        ]
                    ]
                ]
            ]
        ]
    ];
    
    $result = makeCurlRequest(
        WAZE_FEATURES_ENDPOINT,
        $tempFile,
        $csrfToken,
        $payload
    );
    
    // Limpa arquivo temporário
    deleteTempCookieFile($tempFile);
    
    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao validar place (HTTP {$result['httpCode']})", 500);
    }
    
    // Verifica resposta
    $responseData = json_decode($result['response'], true);
    
    if (json_last_error() !== JSON_ERROR_NONE) {
        // Algumas respostas podem ser vazias, o que é OK
        if (empty($result['response'])) {
            jsonResponse([
                'success' => true,
                'message' => $approve ? 'Place aprovado com sucesso' : 'Place rejeitado com sucesso',
                'action' => $approve ? 'approved' : 'rejected'
            ]);
        } else {
            jsonError('Resposta inválida da API do Waze', 500);
        }
    }
    
    jsonResponse([
        'success' => true,
        'message' => $approve ? 'Place aprovado com sucesso' : 'Place rejeitado com sucesso',
        'action' => $approve ? 'approved' : 'rejected',
        'data' => $responseData
    ]);
    
} catch (Exception $e) {
    if ($tempFile) {
        deleteTempCookieFile($tempFile);
    }
    jsonError('Erro ao validar place: ' . $e->getMessage(), 500);
}