<?php

return [
    'route_prefix' => env('OTM_ROUTE_PREFIX', 'octane-table-manager'),
    // Set when the app binds its routes to a domain: Laravel checks domain routes first, so an app
    // catch-all route on that domain would otherwise answer the manager's URLs.
    'domain' => env('OTM_DOMAIN'),
    // 'web' gives the session and CSRF protection the gate needs; access itself is checked by the
    // viewOctaneTableManager gate (see README).
    'middleware' => ['web'],
    'except_tables' => [],
    // Look but do not touch: every request that would change a table answers 403.
    'read_only' => (bool) env('OTM_READ_ONLY', false),
    // Every change is logged (user, table, index, field; never the values). null = the app's default channel.
    'log_channel' => env('OTM_LOG_CHANNEL'),
];
