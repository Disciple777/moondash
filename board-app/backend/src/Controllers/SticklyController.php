<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\SticklyService;
use App\Support\Auth;

final class SticklyController
{
    public function __construct(private App $app)
    {
    }

    public function bootstrap(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        Response::json($service->bootstrap($userId));
    }

    public function createSurface(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        Response::json([
            'surface_id' => $service->createSurface($userId, [
                'name' => (string) $request->input('name', 'Untitled surface'),
                'surface_kind' => (string) $request->input('surface_kind', 'custom'),
                'texture_key' => $request->input('texture_key'),
                'background_color' => $request->input('background_color'),
            ]),
        ], 201);
    }

    public function updateSurface(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        $service->updateSurface($userId, (int) $request->input('surface_id'), [
            'name' => $request->input('name'),
            'background_color' => $request->input('background_color'),
        ]);

        Response::json(['ok' => true]);
    }

    public function reorderSurfaces(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        $service->reorderSurfaces($userId, (array) $request->input('surface_ids', []));

        Response::json(['ok' => true]);
    }

    public function setHomeSurface(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        $service->setHomeSurface($userId, (int) $request->input('surface_id'));

        Response::json(['ok' => true]);
    }

    public function createNote(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        Response::json([
            'instance_id' => $service->createNote($userId, $request->all()),
        ], 201);
    }

    public function updateNote(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        $service->updateNote($userId, (int) $request->input('instance_id'), $request->all());

        Response::json(['ok' => true]);
    }

    public function deleteNote(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var SticklyService $service */
        $service = $this->app->get(SticklyService::class);

        $service->deleteNote($userId, (int) $request->input('instance_id'));

        Response::json(['ok' => true]);
    }
}
