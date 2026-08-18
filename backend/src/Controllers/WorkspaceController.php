<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\DocService;
use App\Services\FolderService;
use App\Services\WorkspaceService;
use App\Support\Auth;

final class WorkspaceController
{
    public function __construct(private App $app)
    {
    }

    public function index(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);

        Response::json(['workspaces' => $service->list($userId)]);
    }

    public function create(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);

        $workspaceId = $service->create(
            $userId,
            (string) $request->input('name', ''),
            (string) $request->input('description', ''),
            (string) $request->input('type', 'folder'),
            $request->input('color_hex') !== null ? (string) $request->input('color_hex') : null,
            $request->input('icon_key') !== null ? (string) $request->input('icon_key') : null
        );

        Response::json(['workspace_id' => $workspaceId], 201);
    }

    public function delete(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);
        $service->delete($userId, (int) $request->input('workspace_id'));

        Response::json(['ok' => true]);
    }

    public function update(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);

        $name = $request->input('name');
        $description = $request->input('description');
        $type = $request->input('type');
        $colorHex = $request->input('color_hex');
        $iconKey = $request->input('icon_key');

        $service->update(
            $userId,
            (int) $request->input('workspace_id'),
            $name !== null ? (string) $name : null,
            $description !== null ? (string) $description : null,
            $type !== null ? (string) $type : null,
            $colorHex !== null ? (string) $colorHex : null,
            $iconKey !== null ? (string) $iconKey : null
        );

        Response::json(['ok' => true]);
    }

    public function linkDoc(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);

        $service->linkDoc(
            $userId,
            (int) $request->input('workspace_id'),
            (int) $request->input('doc_id')
        );

        Response::json(['ok' => true]);
    }

    public function unlinkDoc(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var WorkspaceService $service */
        $service = $this->app->get(WorkspaceService::class);

        $service->unlinkDoc(
            $userId,
            (int) $request->input('workspace_id'),
            (int) $request->input('doc_id')
        );

        Response::json(['ok' => true]);
    }

    public function tree(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var DocService $service */
        $service = $this->app->get(DocService::class);
        /** @var FolderService $folders */
        $folders = $this->app->get(FolderService::class);

        $workspaceId = (int) $request->input('workspace_id');

        Response::json(array_merge(
            ['docs' => $service->tree($userId, $workspaceId)],
            $folders->treePayload($userId, $workspaceId)
        ));
    }
}
