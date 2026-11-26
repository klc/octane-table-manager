<?php

// Run from the test app's root: point config/octane.php at the test tables and load the test routes.

$config = file_get_contents('config/octane.php');
$config = preg_replace("/'tables' => \\[.*?\\n    \\],/s", "'tables' => require '/package/tests/e2e/fixtures/tables.php',", $config, 1, $count);

if ($count !== 1) {
    fwrite(STDERR, "Could not find the 'tables' block in config/octane.php\n");
    exit(1);
}

file_put_contents('config/octane.php', $config);
file_put_contents('routes/web.php', "\nrequire '/package/tests/e2e/fixtures/routes.php';\n", FILE_APPEND);
