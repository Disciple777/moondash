<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\UploadService;
use App\Support\Auth;

final class UploadController
{
    public function __construct(private App $app)
    {
    }

    public function store(Request $request): void
    {
        Auth::userId($this->app, $request);
        $file = $request->file('file');

        if ($file === null) {
            Response::json(['message' => 'File is required'], 422);
            return;
        }

        /** @var UploadService $service */
        $service = $this->app->get(UploadService::class);
        Response::json($service->store($file), 201);
    }
}
