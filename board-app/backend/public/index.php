<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

use App\Controllers\AuthController;
use App\Controllers\BitController;
use App\Controllers\BoardController;
use App\Controllers\IdeaController;
use App\Controllers\SticklyController;
use App\Controllers\UploadController;
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
        ['GET', '/api/stickly/bootstrap', [SticklyController::class, 'bootstrap']],
        ['POST', '/api/stickly/surfaces', [SticklyController::class, 'createSurface']],
        ['PATCH', '/api/stickly/surfaces', [SticklyController::class, 'updateSurface']],
        ['PATCH', '/api/stickly/surfaces/order', [SticklyController::class, 'reorderSurfaces']],
        ['PATCH', '/api/stickly/preferences/home-surface', [SticklyController::class, 'setHomeSurface']],
        ['POST', '/api/stickly/notes', [SticklyController::class, 'createNote']],
        ['PATCH', '/api/stickly/notes', [SticklyController::class, 'updateNote']],
        ['DELETE', '/api/stickly/notes', [SticklyController::class, 'deleteNote']],
        ['GET', '/api/bootstrap', [BoardController::class, 'bootstrap']],
        ['POST', '/api/boards', [BoardController::class, 'createBoard']],
        ['PATCH', '/api/boards/home', [BoardController::class, 'setHomeBoard']],
        ['PATCH', '/api/boards/type', [BoardController::class, 'updateBoardType']],
        ['POST', '/api/lists', [BoardController::class, 'createList']],
        ['POST', '/api/lists/update', [BoardController::class, 'updateList']],
        ['PATCH', '/api/lists', [BoardController::class, 'updateList']],
        ['DELETE', '/api/lists', [BoardController::class, 'deleteList']],
        ['PATCH', '/api/lists/order', [BoardController::class, 'reorderLists']],
        ['PATCH', '/api/board-instances/move', [BoardController::class, 'moveBitInstance']],
        ['POST', '/api/bits', [BitController::class, 'createBit']],
        ['POST', '/api/bits/delete', [BitController::class, 'deleteBit']],
        ['PATCH', '/api/bits', [BitController::class, 'updateBit']],
        ['GET', '/api/bits/detail', [BitController::class, 'detail']],
        ['POST', '/api/bits/comments', [BitController::class, 'addComment']],
        ['POST', '/api/bits/checklists', [BitController::class, 'createChecklist']],
        ['PATCH', '/api/bits/checklists', [BitController::class, 'updateChecklist']],
        ['DELETE', '/api/bits/checklists', [BitController::class, 'deleteChecklist']],
        ['PATCH', '/api/bits/checklists/order', [BitController::class, 'reorderChecklists']],
        ['POST', '/api/bits/checklist-items', [BitController::class, 'createChecklistItem']],
        ['PATCH', '/api/bits/checklist-items', [BitController::class, 'updateChecklistItem']],
        ['DELETE', '/api/bits/checklist-items', [BitController::class, 'deleteChecklistItem']],
        ['PATCH', '/api/bits/checklist-items/order', [BitController::class, 'reorderChecklistItems']],
        ['POST', '/api/bits/attachments', [BitController::class, 'addAttachment']],
        ['POST', '/api/bits/linked-files', [BitController::class, 'addLinkedFile']],
        ['DELETE', '/api/bits/linked-files', [BitController::class, 'deleteLinkedFile']],
        ['POST', '/api/ideas', [IdeaController::class, 'createIdea']],
        ['GET', '/api/ideas', [IdeaController::class, 'index']],
        ['DELETE', '/api/ideas', [IdeaController::class, 'deleteIdea']],
        ['POST', '/api/ideas/convert', [IdeaController::class, 'convertIdea']],
        ['POST', '/api/bits/scenes', [BitController::class, 'addScene']],
        ['PATCH', '/api/bits/scenes', [BitController::class, 'updateScene']],
        ['DELETE', '/api/bits/scenes', [BitController::class, 'deleteScene']],
        ['PATCH', '/api/bits/scenes/order', [BitController::class, 'reorderScenes']],
        ['POST', '/api/uploads', [UploadController::class, 'store']],
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
