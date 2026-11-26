<?php

use Illuminate\Support\Facades\Route;
use Laravel\Octane\Facades\Octane;

Route::get('/otm-e2e/ping', fn () => 'pong');

// Same data on every run: 230 users, nothing else.
Route::get('/otm-e2e/seed', function () {
    foreach (['users', 'nosize', 'ints'] as $name) {
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

    return $users->count();
});
