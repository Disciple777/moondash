<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

use App\Controllers\AuthController;
use App\Controllers\DocController;
use App\Controllers\FolderController;
use App\Controllers\SyncController;
use App\Controllers\WorkspaceController;
use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use DomainException;
use Throwable;

Response::cors();

$request = Request::capture();

if ($request->method() === 'OPTIONS') {
    Response::empty(204);
    exit;
}

try {
    $app = App::create();
    $method = $request->method();
    $path = $request->path();

    $routes = [
        ['POST', '/api/auth/register', [AuthController::class, 'register']],
        ['POST', '/api/auth/login', [AuthController::class, 'login']],
        ['POST', '/api/auth/logout', [AuthController::class, 'logout']],

        ['GET', '/api/workspaces', [WorkspaceController::class, 'index']],
        ['POST', '/api/workspaces', [WorkspaceController::class, 'create']],
        ['PATCH', '/api/workspaces', [WorkspaceController::class, 'update']],
        ['DELETE', '/api/workspaces', [WorkspaceController::class, 'delete']],
        ['GET', '/api/workspaces/tree', [WorkspaceController::class, 'tree']],
        ['POST', '/api/workspaces/links', [WorkspaceController::class, 'linkDoc']],
        ['DELETE', '/api/workspaces/links', [WorkspaceController::class, 'unlinkDoc']],

        ['POST', '/api/docs', [DocController::class, 'create']],
        ['GET', '/api/docs/detail', [DocController::class, 'detail']],
        ['PATCH', '/api/docs', [DocController::class, 'update']],
        ['DELETE', '/api/docs', [DocController::class, 'delete']],

        ['POST', '/api/folders', [FolderController::class, 'create']],
        ['PATCH', '/api/folders', [FolderController::class, 'update']],
        ['DELETE', '/api/folders', [FolderController::class, 'delete']],
        ['POST', '/api/folders/members', [FolderController::class, 'addMember']],
        ['DELETE', '/api/folders/members', [FolderController::class, 'removeMember']],
        ['PATCH', '/api/folders/reorder', [FolderController::class, 'reorderFolders']],
        ['PATCH', '/api/folders/members/order', [FolderController::class, 'reorder']],
        ['POST', '/api/folders/move', [FolderController::class, 'move']],

        ['GET', '/api/sync/manifest', [SyncController::class, 'manifest']],
        ['POST', '/api/sync/push', [SyncController::class, 'push']],
        ['POST', '/api/sync/remove', [SyncController::class, 'remove']],
        ['GET', '/api/sync/file', [SyncController::class, 'file']],
        ['GET', '/api/sync/external', [SyncController::class, 'external']],
    ];

    foreach ($routes as [$routeMethod, $routePath, $handler]) {
        if ($method === $routeMethod && $path === $routePath) {
            [$className, $action] = $handler;
            $controller = new $className($app);
            $controller->$action($request);
            exit;
        }
    }

    Response::json(['message' => 'Not found'], 404);
} catch (DomainException $exception) {
    Response::json(['message' => $exception->getMessage()], 422);
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    Response::json(['message' => 'Server error'], 500);
}
