<?php

namespace KLC\OctaneTableManager;

use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use KLC\OctaneTableManager\Http\Middleware\Authorize;
use KLC\OctaneTableManager\Http\Middleware\LogWrites;

class OctaneTableManagerProvider extends ServiceProvider
{
    public function register()
    {
        $this->mergeConfigFrom(__DIR__.'/../config/octane-table-manager.php', 'octane-table-manager');
    }

    public function boot()
    {
        $routePrefix = Config::get('octane-table-manager.route_prefix', 'octane-table-manager');
        $middleware = [...Config::get('octane-table-manager.middleware', ['web']), Authorize::class, LogWrites::class];

        Route::group([
            'domain' => Config::get('octane-table-manager.domain'),
            'prefix' => $routePrefix,
            'middleware' => $middleware,
        ], function () {
            $this->loadRoutesFrom(__DIR__.'/../routes/web.php');
        });

        // Keys and cells are exact bytes ("u1 " is not "u1"): keep the app's string-changing middleware off our requests.
        // Global middleware runs before routing, so match the path. An empty prefix shares the app's paths; leave those alone.
        $prefix = trim($routePrefix, '/');
        $domain = Config::get('octane-table-manager.domain');
        // A domain pattern ({tenant}.example.com) matches any value of its parameters.
        $ours = fn ($request) => $prefix !== '' && $request->is($prefix, $prefix.'/*')
            && (! $domain || Str::is(preg_replace('/\{[^}]*\}/', '*', $domain), $request->getHost()));
        TrimStrings::skipWhen($ours);
        ConvertEmptyStringsToNull::skipWhen($ours);

        $this->loadViewsFrom(__DIR__.'/../resources/views', 'otm');

        if ($this->app->runningInConsole()) {
            $this->publishes([
                __DIR__.'/../config/octane-table-manager.php' => config_path('octane-table-manager.php'),
            ], 'otm-config');
        }
    }
}
