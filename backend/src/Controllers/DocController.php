<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\DocService;
use App\Services\WorkspaceService;
use App\Support\Auth;

final class DocController
{
    public function __construct(private App $app)
    {
    }

    public function create(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        $bitId = $service->create(
            $userId,
            (int) $request->input('workspace_id'),
            (string) $request->input('relative_path', ''),
            (string) $request->input('content', ''),
            $request->input('local_path') !== null ? (string) $request->input('local_path') : null
        );

        Response::json(['bit_id' => $bitId], 201);
    }

    public function detail(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);
        $detail = $service->detail((int) $request->input('doc_id'));

        if ($detail === null) {
            Response::json(['message' => 'Doc not found'], 404);
            return;
        }

        $workspaceId = (int) ($detail['workspace_id'] ?? 0);
        /** @var WorkspaceService $workspaces */
        $workspaces = $this->app->get(WorkspaceService::class);
        if ($workspaceId === 0 || !$workspaces->belongsToUser($userId, $workspaceId)) {
            Response::json(['message' => 'Doc not found'], 404);
            return;
        }

        Response::json(['doc' => $detail]);
    }

    public function update(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        $result = $service->update(
            $userId,
            (int) $request->input('doc_id'),
            $request->input('title') !== null ? (string) $request->input('title') : null,
            $request->input('content') !== null ? (string) $request->input('content') : null,
            $request->input('relative_path') !== null ? (string) $request->input('relative_path') : null
        );

        Response::json($result);
    }

    public function delete(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        Response::json($service->softDelete($userId, (int) $request->input('doc_id')));
    }
}
