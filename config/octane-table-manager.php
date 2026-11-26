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
];
