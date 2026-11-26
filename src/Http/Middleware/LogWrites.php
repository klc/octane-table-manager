<?php

namespace KLC\OctaneTableManager\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class LogWrites
{
    public function handle(Request $request, Closure $next)
    {
        $response = $next($request);

        if (! $request->isMethodSafe() && $response->isSuccessful()) {
            // Who changed what. Values stay out of the log: tables can hold tokens and personal data.
            Log::channel(config('octane-table-manager.log_channel'))->info('Octane table changed', [
                'action' => $request->route()?->getActionMethod(),
                'table' => $request->input('table'),
                'index' => $request->input('index'),
                'field' => $request->input('field'),
                'user' => $request->user()?->getAuthIdentifier(),
                'ip' => $request->ip(),
            ]);
        }

        return $response;
    }
}
