<?php
require_once 'config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonError('Método não permitido', 405);
}

$data = readJsonInput();
$cookiesContent = getCookiesFromRequest($data);
$region = requireRegion($data);

$page = isset($data['page']) ? max(1, (int)$data['page']) : 1;
$countryId = isset($data['countryId']) ? (int)$data['countryId'] : 30;
$stateId = isset($data['stateId']) && $data['stateId'] !== '' ? (int)$data['stateId'] : null;
$managedAreaId = isset($data['managedAreaId']) && $data['managedAreaId'] !== '' ? (int)$data['managedAreaId'] : null;
$bbox = isset($data['bbox']) && is_array($data['bbox']) && count($data['bbox']) === 4 ? $data['bbox'] : null;

$filterTypes = isset($data['types']) && is_array($data['types']) && count($data['types']) > 0
    ? $data['types'] : null;
$filterCategories = isset($data['categories']) && is_array($data['categories']) && count($data['categories']) > 0
    ? $data['categories'] : null;
$residential = isset($data['residential']) ? (bool)$data['residential'] : null;
$unreadOnly = isset($data['unreadOnly']) ? (bool)$data['unreadOnly'] : true;

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
        'fromCreationTime' => null,
        'fromUpdateTime' => null,
        'toCreationTime' => null,
        'toUpdateTime' => null,
        'bbox' => $bbox,
        'cityId' => null,
        'countryId' => $bbox ? null : $countryId,
        'managedAreaId' => $managedAreaId,
        'managedAreaIds' => null,
        'stateId' => $stateId,
        'userPropertiesFilter' => $unreadOnly ? ['isRead' => false] : new stdClass(),
        'venueUpdateRequestsFilter' => [
            'categories' => $filterCategories,
            'lockRanks' => [0, 1, 2, 3, 4, 5],
            'page' => $page,
            'residential' => $residential,
            'types' => $filterTypes,
            'orderBy' => 'SORTING_UPDATE_TIME_DESC'
        ]
    ];

    $result = makeCurlRequest(wazeIssuesEndpoint($region), $tempFile, $csrfToken, $payload, $region);
    deleteTempCookieFile($tempFile);

    if ($result['httpCode'] !== 200) {
        jsonError("Erro ao buscar places (HTTP {$result['httpCode']})", 500);
    }

    $responseData = json_decode($result['response'], true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        jsonError('Resposta inválida da API do Waze', 500);
    }

    $usersDict = [];
    if (isset($responseData['users']['objects'])) {
        foreach ($responseData['users']['objects'] as $u) {
            $usersDict[$u['id']] = $u['userName'];
        }
    }

    $streetsDict = [];
    if (isset($responseData['streets']['objects'])) {
        foreach ($responseData['streets']['objects'] as $s) {
            $streetsDict[$s['id']] = $s;
        }
    }

    $citiesDict = [];
    if (isset($responseData['cities']['objects'])) {
        foreach ($responseData['cities']['objects'] as $c) {
            $citiesDict[$c['id']] = $c;
        }
    }

    $statesDict = [];
    if (isset($responseData['states']['objects'])) {
        foreach ($responseData['states']['objects'] as $st) {
            $statesDict[$st['id']] = $st['name'];
        }
    }

    $categoryBrands = $responseData['venues']['categoryBrands'] ?? [];
    $brandLookup = [];
    foreach ($categoryBrands as $cat => $brands) {
        foreach ($brands as $b) {
            $brandKey = mb_strtolower(trim($b));
            if ($brandKey !== '') {
                $brandLookup[$brandKey] = true;
            }
        }
    }

    $fieldLabels = [
        'name' => 'Nome',
        'description' => 'Descrição',
        'houseNumber' => 'Número',
        'phone' => 'Telefone',
        'geometry' => 'Localização',
        'categories' => 'Categorias',
        'aliases' => 'Nomes Alternativos',
        'url' => 'Site',
        'openingHours' => 'Horário',
        'streetID' => 'Rua',
        'cityID' => 'Cidade',
        'residential' => 'Residencial',
        'brand' => 'Marca'
    ];

    $formatValue = function($value) {
        if ($value === null || $value === '') return '(vazio)';
        if (is_bool($value)) return $value ? 'Sim' : 'Não';
        if (is_array($value)) return implode(', ', array_map(function($v) {
            return is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (string)$v;
        }, $value));
        return (string)$value;
    };

    $places = [];

    if (isset($responseData['venues']['objects']) && is_array($responseData['venues']['objects'])) {
        foreach ($responseData['venues']['objects'] as $venue) {
            if (!isset($venue['venueUpdateRequests'][0])) continue;

            // Filtra venues sem permissão de edição: Waze devolve permissions como bitmask
            // signed 32-bit. permissions < 0 (ex: -1) = bits setados = pode editar.
            // permissions >= 0 (ex: 0) = sem permissão. Campo ausente → não filtra (defensivo).
            if (isset($venue['permissions']) && $venue['permissions'] >= 0) continue;

            $updateRequest = $venue['venueUpdateRequests'][0];

            $creatorId = $updateRequest['createdBy'] ?? null;
            $creatorName = $creatorId && isset($usersDict[$creatorId]) ? $usersDict[$creatorId] : $creatorId;

            $updateTypeStr = 'Desconhecido';
            $reqType = $updateRequest['type'] ?? '';
            $reqSubType = $updateRequest['subType'] ?? '';
            $changes = [];
            $isDelete = false;
            $flagComment = null;

            if ($reqType === 'VENUE') {
                $updateTypeStr = 'Novo Local';
            } elseif ($reqType === 'IMAGE') {
                $updateTypeStr = 'Nova Foto';
            } elseif ($reqType === 'REQUEST' && $reqSubType === 'FLAG') {
                $updateTypeStr = 'Reporte (Sinalização)';
                $flagComment = trim((string)($updateRequest['flagComment'] ?? '')) ?: null;
            } elseif ($reqType === 'REQUEST' && $reqSubType === 'DELETE') {
                $updateTypeStr = 'Pedido de remoção';
                $isDelete = true;
            } elseif ($reqType === 'REQUEST' && $reqSubType === 'UPDATE') {
                if (isset($updateRequest['changedVenue']) && is_array($updateRequest['changedVenue'])) {
                    foreach ($updateRequest['changedVenue'] as $k => $newValue) {
                        if ($k === 'permissions') continue;
                        $label = $fieldLabels[$k] ?? ucfirst($k);
                        $changes[] = [
                            'field' => $k,
                            'label' => $label,
                            'from' => $formatValue($venue[$k] ?? null),
                            'to' => $formatValue($newValue)
                        ];
                    }
                }
                if (count($changes) > 0) {
                    $updateTypeStr = 'Atualização: ' . implode(', ', array_map(function($c) {
                        return $c['label'];
                    }, $changes));
                } else {
                    $updateTypeStr = 'Atualização (Detalhes)';
                }
            }

            $brand = $venue['brand'] ?? null;
            if (isset($updateRequest['changedVenue']['brand'])) {
                $brand = $updateRequest['changedVenue']['brand'];
            }
            $brandKnown = null;
            if ($brand !== null && trim($brand) !== '') {
                $brandKnown = isset($brandLookup[mb_strtolower(trim($brand))]);
            }

            $place = [
                'venueID' => $venue['id'],
                'updateRequestID' => $updateRequest['id'],
                'name' => $venue['name'] ?? 'Sem nome',
                'categories' => $venue['categories'] ?? [],
                'address' => null,
                'updateType' => $updateTypeStr,
                'reqType' => $reqType,
                'reqSubType' => $reqSubType,
                'isDelete' => $isDelete,
                'flagComment' => $flagComment,
                'dateAdded' => $updateRequest['dateAdded'] ?? null,
                'isStarred' => !empty($updateRequest['isStarred']),
                'createdBy' => $creatorName,
                'imageUrl' => null,
                'imageUrls' => [],
                'changes' => $changes,
                'brand' => $brand,
                'brandKnown' => $brandKnown,
                'lat' => null,
                'lon' => null
            ];

            // GeoJSON: Point [lon,lat], Polygon [[[lon,lat],...]], MultiPolygon [[[[lon,lat],...]]].
            // Desce recursivamente até achar o primeiro par [lon, lat] numérico.
            $extractLonLat = function($coords) use (&$extractLonLat) {
                if (!is_array($coords) || count($coords) === 0) return null;
                if (is_numeric($coords[0]) && isset($coords[1]) && is_numeric($coords[1])) {
                    return [$coords[0], $coords[1]];
                }
                if (is_array($coords[0])) {
                    return $extractLonLat($coords[0]);
                }
                return null;
            };
            if (isset($venue['geometry']['coordinates'])) {
                $pair = $extractLonLat($venue['geometry']['coordinates']);
                if ($pair) {
                    $place['lon'] = $pair[0];
                    $place['lat'] = $pair[1];
                }
            }

            $addressParts = [];
            if (isset($venue['streetID']) && $venue['streetID'] && isset($streetsDict[$venue['streetID']])) {
                $street = $streetsDict[$venue['streetID']];
                $streetName = trim($street['name'] ?? '');
                if ($streetName !== '') $addressParts[] = $streetName;
                if (isset($venue['houseNumber']) && trim($venue['houseNumber']) !== '') {
                    $addressParts[] = trim($venue['houseNumber']);
                }
                if (isset($street['cityID']) && isset($citiesDict[$street['cityID']])) {
                    $city = $citiesDict[$street['cityID']];
                    $cityName = trim($city['name'] ?? '');
                    if ($cityName !== '') {
                        $cityPart = $cityName;
                        if (isset($city['stateID']) && isset($statesDict[$city['stateID']])) {
                            $stateName = $statesDict[$city['stateID']];
                            if (trim($stateName) !== '') {
                                $cityPart .= ' - ' . trim($stateName);
                            }
                        }
                        $addressParts[] = $cityPart;
                    }
                }
            } else {
                if (isset($venue['houseNumber']) && trim($venue['houseNumber']) !== '') {
                    $addressParts[] = trim($venue['houseNumber']);
                }
            }

            $place['address'] = !empty($addressParts) ? implode(', ', $addressParts) : null;

            if (isset($venue['images']) && is_array($venue['images'])) {
                foreach ($venue['images'] as $img) {
                    if (isset($img['id'])) {
                        $place['imageUrls'][] = WAZE_IMAGE_BASE . $img['id'];
                    }
                }
                if (count($place['imageUrls']) > 0) {
                    $place['imageUrl'] = $place['imageUrls'][0];
                }
            }

            $places[] = $place;
        }
    }

    $hasMore = isset($responseData['mapIssues']['venueUpdateRequests']['hasMore'])
        ? $responseData['mapIssues']['venueUpdateRequests']['hasMore']
        : false;

    jsonResponse([
        'success' => true,
        'places' => $places,
        'hasMore' => $hasMore,
        'page' => $page,
        'total' => count($places)
    ]);

} catch (Exception $e) {
    deleteTempCookieFile($tempFile);
    jsonError('Erro ao buscar places: ' . $e->getMessage(), 500);
}
