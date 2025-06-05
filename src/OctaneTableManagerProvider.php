<?php

namespace KLC\OctaneTableManager;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class OctaneTableManagerProvider extends ServiceProvider
{
    public function boot()
    {
        $routePrefix = Config::get('octane-table-manager.route_prefix', 'octane-table-manager');
        $middleware = Config::get('octane-table-manager.middleware', []);

        Route::group([
            'namespace' => 'KLC\OctaneTableManager\Http\Controllers',
            'prefix' => $routePrefix,
            'middleware' => $middleware,
        ], function () {
            $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
        });

        $this->loadViewsFrom(__DIR__.'/../resources/views', 'otm');

        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__.'/../public/vendor/octane-table-manager' => public_path('vendor/octane-table-manager'),
            ], 'otm-assets');

            $this->publishes([
                __DIR__.'/../config/octane-table-manager.php' => config_path('octane-table-manager.php'),
            ], 'otm-config');
        }
    }
}
