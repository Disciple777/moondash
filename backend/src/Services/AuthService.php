<?php

declare(strict_types=1);

namespace App\Services;

use DateInterval;
use DateTimeImmutable;
use DomainException;
use PDO;

final class AuthService
{
    public function __construct(private PDO $pdo, private array $config)
    {
    }

    public function register(string $email, string $password): array
    {
        $normalizedEmail = mb_strtolower(trim($email));

        if (!filter_var($normalizedEmail, FILTER_VALIDATE_EMAIL)) {
            throw new DomainException('Please enter a valid email address');
        }

        if (mb_strlen($password) < 8) {
            throw new DomainException('Password must be at least 8 characters');
        }

        $checkStmt = $this->pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $checkStmt->execute(['email' => $normalizedEmail]);

        if ($checkStmt->fetch()) {
            throw new DomainException('That email is already registered');
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);

        $stmt = $this->pdo->prepare('INSERT INTO users (email, password_hash) VALUES (:email, :password_hash)');
        $stmt->execute([
            'email' => $normalizedEmail,
            'password_hash' => $hash,
        ]);

        $userId = (int) $this->pdo->lastInsertId();
        $token = $this->issueToken($userId);

        return ['user_id' => $userId, 'token' => $token];
    }

    public function login(string $email, string $password): ?array
    {
        $normalizedEmail = mb_strtolower(trim($email));

        if (!filter_var($normalizedEmail, FILTER_VALIDATE_EMAIL)) {
            throw new DomainException('Please enter a valid email address');
        }

        $stmt = $this->pdo->prepare('SELECT id, password_hash FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $normalizedEmail]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return null;
        }

        return [
            'user_id' => (int) $user['id'],
            'token' => $this->issueToken((int) $user['id']),
        ];
    }

    public function logout(string $token): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM auth_tokens WHERE token = :token');
        $stmt->execute(['token' => hash('sha256', $token)]);
    }

    public function userIdFromToken(string $token): ?int
    {
        $stmt = $this->pdo->prepare(
            'SELECT user_id
             FROM auth_tokens
             WHERE token = :token
               AND expires_at > UTC_TIMESTAMP()
             LIMIT 1'
        );
        $stmt->execute(['token' => hash('sha256', $token)]);

        $row = $stmt->fetch();

        return $row ? (int) $row['user_id'] : null;
    }

    private function issueToken(int $userId): string
    {
        $plainToken = bin2hex(random_bytes(32));
        $ttlDays = (int) ($this->config['AUTH_TOKEN_TTL_DAYS'] ?? 30);
        $expiresAt = (new DateTimeImmutable('now'))->add(new DateInterval("P{$ttlDays}D"))->format('Y-m-d H:i:s');

        $stmt = $this->pdo->prepare(
            'INSERT INTO auth_tokens (user_id, token, expires_at)
             VALUES (:user_id, :token, :expires_at)'
        );
        $stmt->execute([
            'user_id' => $userId,
            'token' => hash('sha256', $plainToken),
            'expires_at' => $expiresAt,
        ]);

        return $plainToken;
    }
}
