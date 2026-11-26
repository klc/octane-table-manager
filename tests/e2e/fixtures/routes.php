<?php

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Route;
use Laravel\Octane\Facades\Octane;

Route::get('/otm-e2e/ping', fn () => 'pong');

// Same data on every run: 230 users, nothing else.
Route::get('/otm-e2e/seed', function () {
    foreach (['users', 'nosize', 'ints', 'tiny', 'docs'] as $name) {
        $table = Octane::table($name);
        $keys = [];
        foreach ($table as $key => $row) {
            $keys[] = $key;
        }
        array_map([$table, 'del'], $keys);
    }

    $users = Octane::table('users');
    for ($i = 1; $i <= 230; $i++) {
        $users->set("u$i", ['name' => "user $i", 'age' => $i, 'score' => $i + 0.125, 'bio' => str_repeat('b', 10)]);
    }

    // Octane's own cache table, shown read-only as octane:cache.
    Cache::store('octane')->put('e2e-key', 'hello', 600);

    // Digits JSON.parse would change (2^64, 1.50) and brackets inside a string.
    Octane::table('docs')->set('d1', ['data' => '{"id":12345678901234567890,"price":1.50,"name":"old","note":"a {b} [c]","tags":[]}']);

    return $users->count();
});

// Writes rows into a table until Swoole refuses one; reports the stats along the way.
Route::get('/otm-e2e/fill/{name}', function (string $name) {
    $table = Octane::table($name);
    $samples = [];
    for ($i = 0; ; $i++) {
        try {
            $table->set("fill$i", []);
        } catch (Throwable $e) {
            return ['size' => $table->getSize(), 'failed_at' => $table->count(), 'error' => $e->getMessage(), 'samples' => $samples];
        }
        if ($i % max(1, intdiv($table->getSize(), 8)) === 0) {
            $s = $table->stats();
            $samples[] = [$s['num'], $s['available_slice_num'], $s['total_slice_num']];
        }
    }
});
