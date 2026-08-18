<?php

declare(strict_types=1);

namespace App\Core;

use App\Config\Database;
use App\Services\AuthService;
use App\Services\DocService;
use App\Services\FolderService;
use App\Services\SyncService;
use App\Services\WorkspaceService;
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

        $workspaces = new WorkspaceService($pdo);

        return new self([
            'config' => $config,
            'pdo' => $pdo,
            AuthService::class => new AuthService($pdo, $config),
            WorkspaceService::class => $workspaces,
            DocService::class => new DocService($pdo, $workspaces),
            FolderService::class => new FolderService($pdo, $workspaces),
            SyncService::class => new SyncService($pdo, $workspaces),
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
