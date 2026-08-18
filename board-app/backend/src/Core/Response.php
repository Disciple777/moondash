<?php

declare(strict_types=1);

namespace App\Core;

final class Response
{
    public static function cors(): void
    {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Headers: Content-Type, Authorization');
        header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
    }

    public static function json(array $payload, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        self::cors();

        echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    }

    public static function empty(int $status = 204): void
    {
        http_response_code($status);
        self::cors();
    }
}
