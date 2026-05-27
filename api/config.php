<?php
ini_set('display_errors', 0);
error_reporting(E_ALL);

define('WAZE_REGIONS', [
    'row' => 'https://www.waze.com/row-Descartes/app/v1',
    'na'  => 'https://www.waze.com/na-Descartes/app/v1',
    'il'  => 'https://www.waze.com/il-Descartes/app/v1',
    'world' => 'https://www.waze.com/Descartes/app/v1',
]);

define('WAZE_BASE_REGIONS', [
    'row' => 'https://www.waze.com/row-Descartes/app',
    'na'  => 'https://www.waze.com/na-Descartes/app',
    'il'  => 'https://www.waze.com/il-Descartes/app',
    'world' => 'https://www.waze.com/Descartes/app',
]);

define('WAZE_FEATURES_REGIONS', [
    'row' => 'https://www.waze.com/row-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
    'na'  => 'https://www.waze.com/na-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
    'il'  => 'https://www.waze.com/il-Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
    'world' => 'https://www.waze.com/Descartes/app/Features?ignoreWarnings=false&language=pt-BR',
]);

define('WAZE_IMAGE_BASE', 'https://venue-image.waze.com/thumbs/thumb700_');
define('USER_AGENT', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36');

define('SESSION_DIR', sys_get_temp_dir() . '/waze_places_sessions');
define('SESSION_TTL', 1814400); // 21 dias — touch a cada uso. Cookies do Waze duram ~28 dias; deixamos folga de 7 dias pra evitar 401 inesperado. Quando expirarem, backend devolve 401 e frontend cai pra authScreen.
define('SESSION_KEY_FILE', sys_get_temp_dir() . '/waze_places.key');

function wazeIssuesEndpoint($region) {
    $base = WAZE_REGIONS[$region] ?? WAZE_REGIONS['row'];
    return $base . '/Issues/Search/List';
}

function wazeMarkReadEndpoint($region) {
    $base = WAZE_REGIONS[$region] ?? WAZE_REGIONS['row'];
    return $base . '/Issues/Read';
}

function wazeFeaturesEndpoint($region) {
    return WAZE_FEATURES_REGIONS[$region] ?? WAZE_FEATURES_REGIONS['row'];
}

function wazeSessionEndpoint($region) {
    $base = WAZE_BASE_REGIONS[$region] ?? WAZE_BASE_REGIONS['row'];
    return $base . '/Session?language=pt-BR';
}

function wazeCountriesEndpoint($region) {
    $base = WAZE_BASE_REGIONS[$region] ?? WAZE_BASE_REGIONS['row'];
    return $base . '/LocationSearch/Countries';
}

function wazeStatesEndpoint($region, $countryId) {
    $base = WAZE_BASE_REGIONS[$region] ?? WAZE_BASE_REGIONS['row'];
    return $base . '/LocationSearch/States?countryId=' . (int)$countryId;
}

function wazeRefererEnv($region) {
    return $region === 'na' ? 'usa' : ($region === 'il' ? 'il' : 'row');
}

function getEncryptionKey() {
    if (!file_exists(SESSION_KEY_FILE)) {
        $key = base64_encode(random_bytes(32));
        file_put_contents(SESSION_KEY_FILE, $key);
        chmod(SESSION_KEY_FILE, 0600);
    }
    return base64_decode(file_get_contents(SESSION_KEY_FILE));
}

function ensureSessionDir() {
    if (!is_dir(SESSION_DIR)) {
        @mkdir(SESSION_DIR, 0700, true);
    }
}

function cleanExpiredSessions() {
    ensureSessionDir();
    $files = glob(SESSION_DIR . '/sess_*');
    if (!$files) return;
    $now = time();
    foreach ($files as $f) {
        if ($now - filemtime($f) > SESSION_TTL) {
            @unlink($f);
        }
    }
}

function createSession($cookiesContent) {
    ensureSessionDir();
    cleanExpiredSessions();

    $token = base64_encode(random_bytes(32));
    $hash = hash('sha256', $token);
    $iv = random_bytes(16);
    $encrypted = openssl_encrypt($cookiesContent, 'aes-256-cbc', getEncryptionKey(), OPENSSL_RAW_DATA, $iv);
    $payload = base64_encode($iv) . '::' . base64_encode($encrypted);

    $sessionFile = SESSION_DIR . '/sess_' . $hash;
    file_put_contents($sessionFile, $payload);
    chmod($sessionFile, 0600);

    return $token;
}

function loadSession($token) {
    if (!$token) return null;
    $hash = hash('sha256', $token);
    $sessionFile = SESSION_DIR . '/sess_' . $hash;
    if (!file_exists($sessionFile)) return null;
    if (time() - filemtime($sessionFile) > SESSION_TTL) {
        @unlink($sessionFile);
        return null;
    }
    touch($sessionFile);

    $payload = file_get_contents($sessionFile);
    $parts = explode('::', $payload, 2);
    if (count($parts) !== 2) return null;

    $iv = base64_decode($parts[0]);
    $encrypted = base64_decode($parts[1]);
    $cookies = openssl_decrypt($encrypted, 'aes-256-cbc', getEncryptionKey(), OPENSSL_RAW_DATA, $iv);
    return $cookies === false ? null : $cookies;
}

function destroySession($token) {
    if (!$token) return;
    $hash = hash('sha256', $token);
    $sessionFile = SESSION_DIR . '/sess_' . $hash;
    if (file_exists($sessionFile)) {
        @unlink($sessionFile);
    }
}

function getCookiesFromRequest($data) {
    if (isset($data['sessionToken']) && $data['sessionToken']) {
        $cookies = loadSession($data['sessionToken']);
        if (!$cookies) {
            jsonError('Sessão expirada ou inválida', 401);
        }
        return $cookies;
    }
    if (isset($data['cookies']) && $data['cookies']) {
        return trim($data['cookies']);
    }
    jsonError('Sessão ou cookies não fornecidos', 401);
}

function extractCSRFToken($cookiesContent) {
    if (preg_match('/_csrf_token=([^;\s]+)/', $cookiesContent, $matches)) {
        return trim($matches[1]);
    }
    $lines = explode("\n", $cookiesContent);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#') continue;
        $parts = preg_split('/\s+/', $line);
        if (count($parts) >= 7 && $parts[5] === '_csrf_token') {
            return trim($parts[6]);
        }
    }
    return null;
}

function createTempCookieFile($cookiesContent) {
    $tempFile = tempnam(sys_get_temp_dir(), 'waze_cookies_');
    chmod($tempFile, 0600);

    $isNetscapeFormat = false;
    $lines = explode("\n", $cookiesContent);
    foreach ($lines as $line) {
        $line = trim($line);
        if (strpos($line, "\t") !== false && !empty($line) && $line[0] !== '#') {
            $isNetscapeFormat = true;
            break;
        }
    }

    if ($isNetscapeFormat) {
        $hasHeader = strpos($cookiesContent, '# Netscape HTTP Cookie File') !== false;
        $content = $hasHeader ? $cookiesContent : "# Netscape HTTP Cookie File\n" . $cookiesContent;
        file_put_contents($tempFile, $content);
    } else {
        $cookieLines = [];
        $parts = explode(';', $cookiesContent);
        foreach ($parts as $part) {
            $part = trim($part);
            if (empty($part)) continue;
            $cookieParts = explode('=', $part, 2);
            if (count($cookieParts) === 2) {
                $name = trim($cookieParts[0]);
                $value = trim($cookieParts[1]);
                $cookieLines[] = ".waze.com\tTRUE\t/\tTRUE\t0\t{$name}\t{$value}";
            }
        }
        $content = "# Netscape HTTP Cookie File\n" . implode("\n", $cookieLines);
        file_put_contents($tempFile, $content);
    }

    return $tempFile;
}

function deleteTempCookieFile($filePath) {
    if ($filePath && file_exists($filePath)) {
        @unlink($filePath);
    }
}

function makeCurlRequest($url, $cookieFile, $csrfToken, $postData = null, $region = 'row') {
    $ch = curl_init($url);
    $env = wazeRefererEnv($region);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE => $cookieFile,
        CURLOPT_USERAGENT => USER_AGENT,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_HTTPHEADER => [
            'Accept: */*',
            'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Content-Type: application/json; charset=utf-8',
            'Origin: https://www.waze.com',
            'Referer: https://www.waze.com/pt-BR/editor?env=' . $env . '&tab=issue_tracker',
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

    return [
        'response' => $response,
        'httpCode' => $httpCode,
        'error' => $error
    ];
}

/**
 * Categoriza um erro do Waze para tratamento diferenciado no frontend.
 * Retorna ['category' => string, 'message' => string].
 *
 * Categorias:
 *   - already_processed: place já foi tratado por outro editor (sucesso lógico)
 *   - not_found: place não existe mais
 *   - unauthorized: cookies/sessão do Waze rejeitados
 *   - transient: erro temporário (5xx, timeout, rede) — vale retry
 *   - unknown: caso desconhecido — UI deve mostrar erro genérico
 *
 * Códigos do Waze observados em race conditions:
 *   - Features (rejeitar) → HTTP 404 + errorList.code=702 + "was not found"
 *   - Issues/Read (marcar lido) → HTTP 500 + errorList.code=300 + "Failed to handle request"
 */
function categorizeWazeError($httpCode, $responseBody, $curlError = '') {
    if (!empty($curlError)) {
        return ['category' => 'transient', 'message' => 'Erro de conexão: ' . $curlError];
    }

    if ($httpCode === 401 || $httpCode === 403) {
        return ['category' => 'unauthorized', 'message' => 'Cookies expirados ou inválidos'];
    }

    $errorCode = null;
    $errorDetails = '';
    $parsed = json_decode((string)$responseBody, true);
    if (is_array($parsed) && isset($parsed['errorList'][0])) {
        $errorCode = $parsed['errorList'][0]['code'] ?? null;
        $errorDetails = strtolower((string)($parsed['errorList'][0]['details'] ?? ''));
    }
    $bodyLower = strtolower((string)$responseBody);

    if ($errorCode === 702 || strpos($errorDetails, 'was not found') !== false) {
        return ['category' => 'already_processed', 'message' => 'Já tratado por outro editor'];
    }

    if ($errorCode === 300 && strpos($errorDetails, 'failed to handle') !== false) {
        return ['category' => 'already_processed', 'message' => 'Já tratado ou modificado por outro editor'];
    }

    if ($httpCode === 409) {
        return ['category' => 'already_processed', 'message' => 'Já tratado por outro editor'];
    }

    if ($httpCode === 404) {
        return ['category' => 'not_found', 'message' => 'Place não existe mais (possivelmente já tratado)'];
    }

    $hasAlreadyHint = strpos($bodyLower, 'already') !== false
        || strpos($bodyLower, 'duplicate') !== false
        || strpos($bodyLower, 'updated by another') !== false
        || strpos($bodyLower, 'no longer') !== false
        || strpos($bodyLower, 'has been resolved') !== false;

    if (($httpCode === 200 || $httpCode === 400 || $httpCode === 422) && $hasAlreadyHint) {
        return ['category' => 'already_processed', 'message' => 'Já tratado por outro editor'];
    }

    if ($httpCode >= 500 || $httpCode === 408 || $httpCode === 429 || $httpCode === 0) {
        return ['category' => 'transient', 'message' => "Servidor Waze indisponível (HTTP {$httpCode})"];
    }

    return ['category' => 'unknown', 'message' => "Erro do Waze (HTTP {$httpCode})"];
}

function validateCookiesFormat($cookiesContent) {
    if (strpos($cookiesContent, '_csrf_token=') !== false) return true;
    $lines = explode("\n", $cookiesContent);
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line) || $line[0] === '#') continue;
        if (strpos($line, '_csrf_token') !== false && strpos($line, "\t") !== false) {
            return true;
        }
    }
    return false;
}

function getServerWorkers() {
    $workers = getenv('PHP_CLI_SERVER_WORKERS');
    if ($workers !== false && (int)$workers > 0) {
        return (int)$workers;
    }
    return php_sapi_name() === 'cli-server' ? 1 : null;
}

function jsonResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    $workers = getServerWorkers();
    if ($workers !== null) {
        header('X-Server-Workers: ' . $workers);
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonError($message, $statusCode = 400) {
    jsonResponse([
        'success' => false,
        'error' => $message
    ], $statusCode);
}

function readJsonInput() {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        return [];
    }
    return $data ?: [];
}

function requireRegion($data) {
    $region = isset($data['region']) ? strtolower(trim($data['region'])) : 'row';
    if (!isset(WAZE_REGIONS[$region])) $region = 'row';
    return $region;
}

/**
 * Critério de acesso à aplicação:
 *   - Staff sempre passa
 *   - Caso contrário, precisa ser Area Manager com rank >= 2 (display L3+, Waze é 0-indexed)
 *
 * Retorna ['allowed' => bool, 'reason' => string|null]
 */
define('MIN_RANK_WAZE', 2);

function isUserAllowed($profile) {
    if (!is_array($profile)) {
        return ['allowed' => false, 'reason' => 'Perfil inválido'];
    }
    if (!empty($profile['isStaff'])) {
        return ['allowed' => true, 'reason' => null];
    }
    $rank = isset($profile['rank']) ? (int)$profile['rank'] : -1;
    $isAM = !empty($profile['isAreaManager']);
    if ($rank >= MIN_RANK_WAZE && $isAM) {
        return ['allowed' => true, 'reason' => null];
    }
    $displayRank = $rank >= 0 ? ($rank + 1) : '?';
    $tags = [];
    $tags[] = 'L' . $displayRank;
    $tags[] = $isAM ? 'AM' : 'não-AM';
    $minDisplay = MIN_RANK_WAZE + 1;
    return [
        'allowed' => false,
        'reason' => "Acesso restrito a editores Area Manager com nível {$minDisplay}+ ou Staff. Seu perfil: " . implode(' · ', $tags) . '.'
    ];
}

