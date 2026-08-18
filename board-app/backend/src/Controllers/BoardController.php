<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\BoardService;
use App\Support\Auth;

final class BoardController
{
    public function __construct(private App $app)
    {
    }

    public function bootstrap(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);

        $boardId = $request->input('board_id');

        Response::json($service->bootstrap(
            $userId,
            $boardId !== null && $boardId !== '' ? (int) $boardId : null
        ));
    }

    public function createBoard(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $boardId = $service->createBoard(
            $userId,
            (string) $request->input('name', 'Untitled board'),
            (string) $request->input('description', ''),
            (string) $request->input('color_theme', 'melon'),
            (string) $request->input('board_type', 'general')
        );

        Response::json(['board_id' => $boardId], 201);
    }

    public function updateBoardType(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->updateBoardType(
            (int) $request->input('board_id'),
            $userId,
            (string) $request->input('board_type', 'general')
        );

        Response::json(['ok' => true]);
    }

    public function createList(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);

        Response::json([
            'list_id' => $service->createList(
                (int) $request->input('board_id'),
                (string) $request->input('name', 'New list'),
                (bool) $request->input('is_hidden', false)
            ),
        ], 201);
    }

    public function setHomeBoard(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->setHomeBoard($userId, (int) $request->input('board_id'));

        Response::json(['ok' => true]);
    }

    public function updateList(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->updateList(
            $userId,
            (int) $request->input('list_id'),
            $request->input('name') !== null ? (string) $request->input('name') : null,
            $request->input('is_hidden') !== null ? (bool) $request->input('is_hidden') : null
        );

        Response::json(['ok' => true]);
    }

    public function deleteList(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->deleteList($userId, (int) $request->input('list_id'));

        Response::json(['ok' => true]);
    }

    public function reorderLists(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->reorderLists($userId, (int) $request->input('board_id'), (array) $request->input('list_ids', []));

        Response::json(['ok' => true]);
    }

    public function moveBitInstance(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BoardService $service */
        $service = $this->app->get(BoardService::class);
        $service->moveBitInstance(
            $userId,
            (int) $request->input('instance_id'),
            (int) $request->input('board_list_id'),
            (int) $request->input('position', 1)
        );

        Response::json(['ok' => true]);
    }
}
