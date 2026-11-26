<?php

namespace KLC\OctaneTableManager\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use KLC\OctaneTableManager\Http\Controllers\TableController;

class Authorize
{
    public function handle(Request $request, Closure $next)
    {
        // Open in the local environment; anywhere else only when the app's viewOctaneTableManager gate allows it.
        abort_unless(app()->environment('local') || Gate::allows('viewOctaneTableManager'), 403);

        // Every route that changes a table uses POST, PATCH or DELETE.
        abort_if(config('octane-table-manager.read_only') && ! $request->isMethodSafe(), 403, 'The table manager is in read-only mode.');
        abort_if($request->input('table') === TableController::CACHE_TABLE && ! $request->isMethodSafe(), 403, "Octane's cache table is read-only here.");

        return $next($request);
    }
}
