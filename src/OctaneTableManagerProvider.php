<?php

namespace KLC\OctaneTableManager;

use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use KLC\OctaneTableManager\Http\Middleware\Authorize;

class OctaneTableManagerProvider extends ServiceProvider
{
    public function register()
    {
        $this->mergeConfigFrom(__DIR__.'/../config/octane-table-manager.php', 'octane-table-manager');
    }

    public function boot()
    {
        $routePrefix = Config::get('octane-table-manager.route_prefix', 'octane-table-manager');
        $middleware = [...Config::get('octane-table-manager.middleware', ['web']), Authorize::class];

        Route::group([
            'prefix' => $routePrefix,
            'middleware' => $middleware,
        ], function () {
            $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
        });

        $this->loadViewsFrom(__DIR__.'/../resources/views', 'otm');

        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__.'/../config/octane-table-manager.php' => config_path('octane-table-manager.php'),
            ], 'otm-config');
        }
    }
}
