<?php
use Illuminate\Support\Facades\Route;

Route::controller(TableController::class)
    ->group(function () {
        Route::get('/', 'index');
        Route::get('/list', 'list');
        Route::get('/fetch', 'fetch');
        Route::delete('/delete', 'delete');
        Route::post('/update', 'update');
        Route::post('/add-new-item', 'addNewItem');
    });