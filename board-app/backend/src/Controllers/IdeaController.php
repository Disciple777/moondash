<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\IdeaService;
use App\Support\Auth;

final class IdeaController
{
    public function __construct(private App $app)
    {
    }

    public function createIdea(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var IdeaService $service */
        $service = $this->app->get(IdeaService::class);

        Response::json([
            'idea_id' => $service->createIdea(
                $userId,
                (int) $request->input('board_id'),
                (string) $request->input('title', ''),
                (string) $request->input('content_preview', '')
            ),
        ], 201);
    }

    public function index(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var IdeaService $service */
        $service = $this->app->get(IdeaService::class);

        Response::json([
            'ideas' => $service->listIdeas(
                $userId,
                (int) $request->input('board_id')
            ),
        ]);
    }

    public function deleteIdea(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var IdeaService $service */
        $service = $this->app->get(IdeaService::class);
        $service->deleteIdea($userId, (int) $request->input('idea_id'));

        Response::json(['ok' => true]);
    }

    public function convertIdea(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var IdeaService $service */
        $service = $this->app->get(IdeaService::class);
        $service->convertIdea(
            $userId,
            (int) $request->input('board_id'),
            (int) $request->input('idea_id'),
            (int) $request->input('board_list_id')
        );

        Response::json(['ok' => true]);
    }
}
