<?php

namespace KLC\OctaneTableManager\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

class Authorize
{
    public function handle(Request $request, Closure $next)
    {
        // Open in the local environment; anywhere else only when the app's viewOctaneTableManager gate allows it.
        abort_unless(app()->environment('local') || Gate::allows('viewOctaneTableManager'), 403);

        return $next($request);
    }
}
