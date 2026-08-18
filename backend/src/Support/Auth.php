<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\AuthService;

final class Auth
{
    public static function userId(App $app, Request $request): int
    {
        $token = $request->bearerToken();

        if ($token === null) {
            Response::json(['message' => 'Authentication required'], 401);
            exit;
        }

        /** @var AuthService $service */
        $service = $app->get(AuthService::class);
        $userId = $service->userIdFromToken($token);

        if ($userId === null) {
            Response::json(['message' => 'Invalid token'], 401);
            exit;
        }

        return $userId;
    }
}
