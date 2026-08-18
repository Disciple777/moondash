<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\FolderService;
use App\Support\Auth;

final class FolderController
{
    public function __construct(private App $app)
    {
    }

    public function create(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);

        $parentFolderId = $request->input('parent_folder_id');
        $folderId = $service->create(
            $userId,
            (int) $request->input('workspace_id'),
            (string) $request->input('name', ''),
            (string) $request->input('color_hex', '#5B5BD6'),
            $request->input('icon_key') !== null ? (string) $request->input('icon_key') : null,
            $parentFolderId !== null && $parentFolderId !== '' ? (int) $parentFolderId : null
        );

        Response::json(['folder_id' => $folderId], 201);
    }

    public function update(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);
        $service->update(
            $userId,
            (int) $request->input('folder_id'),
            $request->input('name') !== null ? (string) $request->input('name') : null,
            $request->input('color_hex') !== null ? (string) $request->input('color_hex') : null,
            $request->input('icon_key') !== null ? (string) $request->input('icon_key') : null
        );

        Response::json(['ok' => true]);
    }

    public function delete(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);
        $service->delete($userId, (int) $request->input('folder_id'));

        Response::json(['ok' => true]);
    }

    public function addMember(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);
        $service->addDoc(
            $userId,
            (int) $request->input('folder_id'),
            (int) $request->input('doc_id')
        );

        Response::json(['ok' => true]);
    }

    public function removeMember(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);
        $service->removeDoc(
            $userId,
            (int) $request->input('folder_id'),
            (int) $request->input('doc_id')
        );

        Response::json(['ok' => true]);
    }

    public function move(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);

        $parentFolderId = $request->input('parent_folder_id');
        $service->moveFolder(
            $userId,
            (int) $request->input('folder_id'),
            $parentFolderId !== null && $parentFolderId !== '' ? (int) $parentFolderId : null
        );

        Response::json(['ok' => true]);
    }

    public function reorder(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var FolderService $service */
        $service = $this->app->get(FolderService::class);
        $service->reorderMembers(
            $userId,
            (int) $request->input('folder_id'),
            (array) $request->input('item_ids', [])
        );

        Response::json(['ok' => true]);
    }
}
