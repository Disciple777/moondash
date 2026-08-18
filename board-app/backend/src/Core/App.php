<?php

declare(strict_types=1);

namespace App\Core;

use App\Config\Database;
use App\Services\AuthService;
use App\Services\BitService;
use App\Services\BoardService;
use App\Services\IdeaService;
use App\Services\SticklyService;
use App\Services\UploadService;
use PDO;

final class App
{
    private array $services;

    private function __construct(array $services)
    {
        $this->services = $services;
    }

    public static function create(): self
    {
        $config = Env::load(dirname(__DIR__, 2) . '/.env');
        $pdo = Database::connect($config);

        return new self([
            'config' => $config,
            'pdo' => $pdo,
            AuthService::class => new AuthService($pdo, $config),
            BoardService::class => new BoardService($pdo),
            BitService::class => new BitService($pdo),
            IdeaService::class => new IdeaService($pdo),
            SticklyService::class => new SticklyService($pdo),
            UploadService::class => new UploadService($config),
        ]);
    }

    public function get(string $id): mixed
    {
        return $this->services[$id] ?? null;
    }

    public function pdo(): PDO
    {
        return $this->get('pdo');
    }
}
