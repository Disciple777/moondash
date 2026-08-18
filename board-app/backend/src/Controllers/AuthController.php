<?php

declare(strict_types=1);

namespace App\Controllers;

use App\Core\App;
use App\Core\Request;
use App\Core\Response;
use App\Services\AuthService;

final class AuthController
{
    public function __construct(private App $app)
    {
    }

    public function register(Request $request): void
    {
        $email = (string) $request->input('email', '');
        $password = (string) $request->input('password', '');

        if ($email === '' || $password === '') {
            Response::json(['message' => 'Email and password are required'], 422);
            return;
        }

        /** @var AuthService $service */
        $service = $this->app->get(AuthService::class);
        $result = $service->register($email, $password);

        Response::json($result, 201);
    }

    public function login(Request $request): void
    {
        /** @var AuthService $service */
        $service = $this->app->get(AuthService::class);
        $result = $service->login(
            (string) $request->input('email', ''),
            (string) $request->input('password', '')
        );

        if ($result === null) {
            Response::json(['message' => 'Invalid credentials'], 401);
            return;
        }

        Response::json($result);
    }

    public function logout(Request $request): void
    {
        $token = $request->bearerToken();

        if ($token !== null) {
            /** @var AuthService $service */
            $service = $this->app->get(AuthService::class);
            $service->logout($token);
        }

        Response::json(['ok' => true]);
    }
}
