<?php
// Debug (desativado para evitar corrupção de JSON com warnings)
ini_set('display_errors', 0);
error_reporting(E_ALL);

// Configurações da API do Waze
define('WAZE_BASE_URL', 'https://www.waze.com/row-Descartes/app/v1');
define('WAZE_ISSUES_ENDPOINT', WAZE_BASE_URL . '/Issues/Search/List');
define('WAZE_MARK_READ_ENDPOINT', WAZE_BASE_URL . '/Issues/Read');
define('WAZE_FEATURES_ENDPOINT', 'https://www.waze.com/row-Descartes/app/Features?ignoreWarnings=false&language=pt-BR');
define('WAZE_IMAGE_BASE', 'https://venue-image.waze.com/thumbs/thumb700_');

// Headers padrão
define('USER_AGENT', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');

/**
 * Extrai o token CSRF dos cookies (suporta ambos os formatos)
 */
function extractCSRFToken($cookiesContent) {
    // Formato string simples: _csrf_token=VALOR
    if (preg_match('/_csrf_token=([^;\s]+)/', $cookiesContent, $matches)) {
        return trim($matches[1]);
    }
    
    // Formato Netscape: procura linha com _csrf_token e pega o último campo
    $lines = explode("\n", $cookiesContent);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#') continue;
        
        // Formato Netscape: domain \t flag \t path \t secure \t expiration \t name \t value
        $parts = preg_split('/\s+/', $line);
        if (count($parts) >= 7 && $parts[5] === '_csrf_token') {
            return trim($parts[6]);
        }
    }
    
    return null;
}

/**
 * Cria arquivo temporário com cookies
 */
function createTempCookieFile($cookiesContent) {
    $tempFile = tempnam(sys_get_temp_dir(), 'waze_cookies_');
    
    // Detecta se já está no formato Netscape
    $isNetscapeFormat = false;
    $lines = explode("\n", $cookiesContent);
    
    foreach ($lines as $line) {
        $line = trim($line);
        // Verifica se contém tabs (formato Netscape)
        if (strpos($line, "\t") !== false && !empty($line) && $line[0] !== '#') {
            $isNetscapeFormat = true;
            break;
        }
    }
    
    if ($isNetscapeFormat) {
        // Já está no formato Netscape, salva diretamente
        // Garante que tem o cabeçalho
        $content = '';
        $hasHeader = false;
        
        foreach ($lines as $line) {
            $line = trim($line);
            if (strpos($line, '# Netscape HTTP Cookie File') !== false) {
                $hasHeader = true;
            }
        }
        
        if (!$hasHeader) {
            $content = "# Netscape HTTP Cookie File\n";
        }
        
        $content .= $cookiesContent;
        file_put_contents($tempFile, $content);
    } else {
        // Formato string, converte para Netscape
        $cookieLines = [];
        $parts = explode(';', $cookiesContent);
        
        foreach ($parts as $part) {
            $part = trim($part);
            if (empty($part)) continue;
            
            $cookieParts = explode('=', $part, 2);
            if (count($cookieParts) === 2) {
                $name = trim($cookieParts[0]);
                $value = trim($cookieParts[1]);
                
                // Formato Netscape: domain flag path secure expiration name value
                $cookieLines[] = ".waze.com\tTRUE\t/\tTRUE\t0\t{$name}\t{$value}";
            }
        }
        
        $content = "# Netscape HTTP Cookie File\n";
        $content .= implode("\n", $cookieLines);
        
        file_put_contents($tempFile, $content);
    }
    
    return $tempFile;
}

/**
 * Remove arquivo temporário
 */
function deleteTempCookieFile($filePath) {
    if (file_exists($filePath)) {
        unlink($filePath);
    }
}

/**
 * Faz requisição cURL
 */
function makeCurlRequest($url, $cookieFile, $csrfToken, $postData = null) {
    $ch = curl_init($url);
    
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE => $cookieFile,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_HTTPHEADER => [
            'Accept: */*',
            'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Content-Type: application/json; charset=utf-8',
            'Origin: https://www.waze.com',
            'Referer: https://www.waze.com/pt-BR/editor?env=row&tab=issue_tracker',
            'X-CSRF-Token: ' . $csrfToken,
            'sec-ch-ua: "Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
            'sec-ch-ua-mobile: ?0',
            'sec-ch-ua-platform: "Linux"',
            'sec-fetch-dest: empty',
            'sec-fetch-mode: cors',
            'sec-fetch-site: same-origin'
        ]
    ]);
    
    if ($postData !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($postData));
    }
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    // curl_close($ch); // Deprecated since PHP 8.0, removed in 8.5
    
    return [
        'response' => $response,
        'httpCode' => $httpCode,
        'error' => $error
    ];
}

/**
 * Valida formato dos cookies (aceita ambos os formatos)
 */
function validateCookiesFormat($cookiesContent) {
    // Verifica formato string simples
    if (strpos($cookiesContent, '_csrf_token=') !== false) {
        return true;
    }
    
    // Verifica formato Netscape
    $lines = explode("\n", $cookiesContent);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#') continue;
        
        // Procura por linha com _csrf_token no formato Netscape
        if (strpos($line, '_csrf_token') !== false && strpos($line, "\t") !== false) {
            return true;
        }
    }
    
    return false;
}

/**
 * Retorna resposta JSON de sucesso
 */
function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Retorna resposta JSON de erro
 */
function jsonError($message, $statusCode = 400) {
    jsonResponse([
        'success' => false,
        'error' => $message
    ], $statusCode);
}
