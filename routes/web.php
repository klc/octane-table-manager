<?php

use Illuminate\Support\Facades\Route;
use KLC\OctaneTableManager\Http\Controllers\TableController;

Route::controller(TableController::class)
    ->group(function () {
        Route::get('/', 'index');
        Route::get('/assets/{file}', 'asset');
        Route::get('/list', 'list');
        Route::get('/fetch', 'fetch');
        Route::delete('/delete', 'delete');
        Route::patch('/update', 'update');
        Route::post('/store', 'store');
    });
