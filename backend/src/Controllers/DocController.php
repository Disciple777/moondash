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

    /** Workspace-wide search across titles and bodies. */
    public function search(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        $results = $service->search(
            $userId,
            (int) $request->input('workspace_id'),
            (string) $request->input('q', '')
        );

        Response::json(['results' => $results]);
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

    /**
     * The document's display alias. Sent as its own request rather than as
     * part of update() because setting an alias must not touch the body, the
     * file path or the revision the sync engine watches.
     */
    public function alias(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        $alias = $request->input('alias');

        Response::json($service->setAlias(
            $userId,
            (int) $request->input('doc_id'),
            $alias === null ? null : (string) $alias
        ));
    }

    public function delete(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);

        Response::json($service->softDelete($userId, (int) $request->input('doc_id')));
    }
}
