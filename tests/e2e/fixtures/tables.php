<?php

return [
    'users:2048' => [
        'name' => 'string:64',
        'age' => 'int',
        'score' => 'float',
        'bio' => 'string',
    ],
    'nosize' => [
        'v' => 'int:1',
    ],
    // Small on purpose: filled to capacity by the tests.
    'tiny:64' => [
        'v' => 'int',
    ],
    'ints:16' => [
        'i1' => 'int:1',
        'i8' => 'int:8',
    ],
];
