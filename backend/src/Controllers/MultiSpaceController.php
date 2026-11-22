<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\DocService;
use App\Services\WorkspaceService;
use App\Support\Auth;

final class MultiSpaceController
{
    public function __construct(private App $app)
    {
    }

    /**
     * Import a file into a multi-space in a single atomic call.
     * POST /api/multi/import
     *
     * Body: { file_name, content, workspace_id, folder_id? }
     *
     * Creates the doc in the user's hidden external workspace, links it
     * to the target multi-space, and optionally files it into a folder.
     */
    public function import(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);

        $fileName = trim((string) $request->input('file_name', ''));
        $content = (string) $request->input('content', '');
        $multiWsId = (int) $request->input('workspace_id', 0);
        $folderId = $request->input('folder_id') !== null ? (int) $request->input('folder_id') : null;

        if ($fileName === '') {
            Response::json(['message' => 'file_name is required'], 422);
            return;
        }

        /** @var WorkspaceService $workspaces */
        $workspaces = $this->app->get(WorkspaceService::class);

        // Verify the target is a multi-space owned by the user.
        if (!$workspaces->belongsToUser($userId, $multiWsId) || $workspaces->workspaceType($multiWsId) !== 'multi') {
            Response::json(['message' => 'Multi-space not found'], 404);
            return;
        }

        // Create or reuse the hidden external workspace.
        $externalWsId = $workspaces->ensureExternalWorkspace($userId);

        /** @var DocService $docService */
        $docService = $this->app->get(DocService::class);

        // Deduplicate the filename inside the external workspace. Checked
        // against the workspace itself, not linkedFiles(): that only lists docs
        // with a local_path, so web imports (which have none) were invisible to
        // it and importing a second file with the same name failed with
        // "A doc already exists at this path". Soft-deleted names are fine —
        // create() resurrects those.
        // Same normalisation create() applies, so the check and the create agree.
        $fileName = $docService->normalizePath($fileName);
        if ($fileName === '') {
            Response::json(['message' => 'file_name is required'], 422);
            return;
        }
        $dot = strrpos($fileName, '.');
        $stem = $dot !== false && $dot > 0 ? substr($fileName, 0, $dot) : $fileName;
        $ext = $dot !== false && $dot > 0 ? substr($fileName, $dot) : '';
        $name = $fileName;
        $counter = 1;
        while (($existing = $workspaces->docFile($externalWsId, $name)) !== null && !$existing['is_deleted']) {
            $name = $stem . '-' . $counter . $ext;
            $counter++;
        }

        // Create the doc in the external workspace (no local_path for web imports).
        $bitId = $docService->create($userId, $externalWsId, $name, $content, null);

        // File it into the multi-space folder if specified.
        if ($folderId !== null) {
            $workspaces->linkDoc($userId, $multiWsId, $bitId);
            // Use the FolderService to add the doc to the folder.
            $folderService = $this->app->get(\App\Services\FolderService::class);
            $folderService->addDoc($userId, $folderId, $bitId);
        } else {
            $workspaces->linkDoc($userId, $multiWsId, $bitId);
        }

        Response::json(['bit_id' => $bitId], 201);
    }
}
