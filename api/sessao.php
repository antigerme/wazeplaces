<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$action = $data['action'] ?? 'create';

if ($action === 'create') {
    if (!isset($data['cookies'])) {
        jsonError('Cookies não fornecidos');
    }
    $cookiesContent = trim($data['cookies']);
    if (!validateCookiesFormat($cookiesContent)) {
        jsonError('Formato de cookies inválido');
    }
    if (!extractCSRFToken($cookiesContent)) {
        jsonError('Token CSRF não encontrado');
    }
    $token = createSession($cookiesContent);
    jsonResponse([
        'success' => true,
        'sessionToken' => $token,
        'expiresIn' => SESSION_TTL
    ]);
}

if ($action === 'destroy') {
    $token = $data['sessionToken'] ?? null;
    destroySession($token);
    jsonResponse(['success' => true]);
}

jsonError('Ação inválida');
