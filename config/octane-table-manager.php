<?php

return [
    'route_prefix' => env('OTM_ROUTE_PREFIX', 'octane-table-manager'),
    // 'web' gives the session and CSRF protection the gate needs; access itself is checked by the
    // viewOctaneTableManager gate (see README).
    'middleware' => ['web'],
    'except_tables' => [],
];
