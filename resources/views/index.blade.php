@use('Illuminate\Support\Facades\Vite')

<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KLC | Octane Table Manager</title>

    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

    {{ Vite::useHotFile('vendor/octane-table-manager/octane-table-manager.hot')
            ->useBuildDirectory('vendor/octane-table-manager')
            ->withEntryPoints(['resources/css/app.css', 'resources/js/app.js']) }}

</head>
<body>
<div id="app"></div>

<script>
    const baseUrl = "{{ $baseUrl }}";
</script>
</body>
</html>
