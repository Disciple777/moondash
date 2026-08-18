<?php

declare(strict_types=1);

namespace App\Config;

use PDO;

final class Database
{
    public static function connect(array $config): PDO
    {
        $host = $config['DB_HOST'] ?? '127.0.0.1';
        $port = $config['DB_PORT'] ?? '3306';
        $database = $config['DB_NAME'] ?? '';
        $user = $config['DB_USER'] ?? '';
        $password = $config['DB_PASS'] ?? '';

        $dsn = "mysql:host={$host};port={$port};dbname={$database};charset=utf8mb4";

        return new PDO($dsn, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
}
