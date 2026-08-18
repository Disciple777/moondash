<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\SyncService;
use App\Support\Auth;

final class SyncController
{
    public function __construct(private App $app)
    {
    }

    public function manifest(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SyncService $service */
        $service = $this->app->get(SyncService::class);

        Response::json($service->manifest($userId, (int) $request->input('workspace_id')));
    }

    public function push(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SyncService $service */
        $service = $this->app->get(SyncService::class);

        Response::json($service->push(
            $userId,
            (int) $request->input('workspace_id'),
            (array) $request->input('files', [])
        ));
    }

    public function remove(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SyncService $service */
        $service = $this->app->get(SyncService::class);

        Response::json($service->remove(
            $userId,
            (int) $request->input('workspace_id'),
            (string) $request->input('relative_path', '')
        ));
    }

    public function file(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SyncService $service */
        $service = $this->app->get(SyncService::class);

        $file = $service->file(
            $userId,
            (int) $request->input('workspace_id'),
            (string) $request->input('relative_path', '')
        );

        if ($file === null) {
            Response::json(['message' => 'File not found'], 404);
            return;
        }

        Response::json(['file' => $file]);
    }

    public function external(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SyncService $service */
        $service = $this->app->get(SyncService::class);

        Response::json($service->external($userId));
    }
}
