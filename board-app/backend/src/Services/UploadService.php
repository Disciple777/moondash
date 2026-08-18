<?php

declare(strict_types=1);

namespace App\Services;

use RuntimeException;

final class UploadService
{
    public function __construct(private array $config)
    {
    }

    public function store(array $file): array
    {
        $configuredDir = $this->config['UPLOAD_DIR'] ?? '../public/uploads';
        $uploadDir = realpath(__DIR__ . '/../../' . $configuredDir) ?: (__DIR__ . '/../../' . $configuredDir);

        if (!is_dir($uploadDir)) {
            if (!mkdir($uploadDir, 0775, true) && !is_dir($uploadDir)) {
                throw new RuntimeException('Could not create upload directory');
            }
        }

        $extension = pathinfo($file['name'] ?? '', PATHINFO_EXTENSION);
        $basename = bin2hex(random_bytes(16));
        $filename = $extension ? "{$basename}.{$extension}" : $basename;
        $destination = $uploadDir . DIRECTORY_SEPARATOR . $filename;

        if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            throw new RuntimeException('Invalid upload payload');
        }

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new RuntimeException('Failed to store uploaded file');
        }

        return [
            'original_name' => $file['name'] ?? 'upload',
            'stored_name' => $filename,
            'relative_path' => 'uploads/' . $filename,
            'mime_type' => $file['type'] ?? 'application/octet-stream',
            'size_bytes' => (int) ($file['size'] ?? 0),
        ];
    }
}
