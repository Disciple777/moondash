<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\BitService;
use App\Services\UploadService;
use App\Support\Auth;

final class BitController
{
    public function __construct(private App $app)
    {
    }

    public function createBit(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'bit_id' => $service->createBit($userId, $request->all()),
        ], 201);
    }

    public function detail(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json($service->detail((int) $request->input('bit_id')));
    }

    public function updateBit(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->updateBit((int) $request->input('bit_id'), $request->all());

        Response::json(['ok' => true]);
    }

    public function deleteBit(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->deleteBit($userId, (int) $request->input('bit_id'));

        Response::json(['ok' => true]);
    }

    public function addComment(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'comment_id' => $service->addComment(
                (int) $request->input('bit_id'),
                $userId,
                (string) $request->input('body', '')
            ),
        ], 201);
    }

    public function createChecklist(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'checklist_id' => $service->createChecklistItem(
                $userId,
                (int) $request->input('bit_id'),
                (string) $request->input('content', '')
            ),
        ], 201);
    }

    public function createChecklistItem(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'item_id' => $service->createChecklistEntry(
                $userId,
                (int) $request->input('checklist_bit_id'),
                (string) $request->input('content', '')
            ),
        ], 201);
    }

    public function updateChecklistItem(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->updateChecklistItem(
            (int) $request->input('item_id'),
            (bool) $request->input('is_done', false),
            $request->input('content')
        );

        Response::json(['ok' => true]);
    }

    public function updateChecklist(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->updateChecklist(
            (int) $request->input('checklist_bit_id'),
            (string) $request->input('title', '')
        );

        Response::json(['ok' => true]);
    }

    public function deleteChecklist(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->deleteChildBit($userId, (int) $request->input('checklist_bit_id'), 'checklist');

        Response::json(['ok' => true]);
    }

    public function reorderChecklists(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->reorderRelations(
            (int) $request->input('bit_id'),
            'checklist',
            (array) $request->input('checklist_ids', [])
        );

        Response::json(['ok' => true]);
    }

    public function deleteChecklistItem(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->deleteChildBit($userId, (int) $request->input('item_id'), 'checklist_item');

        Response::json(['ok' => true]);
    }

    public function reorderChecklistItems(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->reorderRelations(
            (int) $request->input('checklist_bit_id'),
            'checklist_item',
            (array) $request->input('item_ids', [])
        );

        Response::json(['ok' => true]);
    }

    public function addAttachment(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        $file = $request->file('file');

        if ($file === null) {
            Response::json(['message' => 'File is required'], 422);
            return;
        }

        /** @var UploadService $uploadService */
        $uploadService = $this->app->get(UploadService::class);
        $storedFile = $uploadService->store($file);

        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'attachment_id' => $service->addAttachment(
                $userId,
                (int) $request->input('bit_id'),
                $storedFile
            ),
        ], 201);
    }

    public function addLinkedFile(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'linked_file_id' => $service->addLinkedFile(
                $userId,
                (int) $request->input('bit_id'),
                $request->all()
            ),
        ], 201);
    }

    public function deleteLinkedFile(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->deleteLinkedFile($userId, (int) $request->input('linked_file_bit_id'));

        Response::json(['ok' => true]);
    }

    public function addScene(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);

        Response::json([
            'scene_id' => $service->addScene(
                $userId,
                (int) $request->input('bit_id'),
                $request->all()
            ),
        ], 201);
    }

    public function deleteScene(Request $request): void
    {
        $userId = Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->deleteChildBit($userId, (int) $request->input('scene_bit_id'), 'scene');

        Response::json(['ok' => true]);
    }

    public function updateScene(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        $service->updateScene(
            (int) $request->input('scene_bit_id'),
            $request->all()
        );

        Response::json(['ok' => true]);
    }

    public function reorderScenes(Request $request): void
    {
        Auth::userId($this->app, $request);
        /** @var BitService $service */
        $service = $this->app->get(BitService::class);
        /** @var int $bitId Parent bit ID */
        $bitId = (int) $request->input('bit_id');
        $service->reorderRelations(
            $bitId,
            'scene',
            (array) $request->input('scene_ids', [])
        );

        Response::json(['ok' => true]);
    }
}
