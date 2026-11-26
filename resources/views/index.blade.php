<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KLC | Octane Table Manager</title>

    <script>
        // Theme before first paint: the saved choice, else the system setting.
        try {
            const theme = localStorage.getItem('otm-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.classList.toggle('p-dark', theme === 'dark');
        } catch (e) {}
    </script>

    <link rel="preconnect" href="https://fonts.bunny.net">
    <link href="https://fonts.bunny.net/css?family=figtree:400,500,600&display=swap" rel="stylesheet" />

    {!! $assets !!}

</head>
<body>
<div id="app"></div>

<script>
    const baseUrl = "{{ $baseUrl }}";
    const readOnly = @json((bool) config('octane-table-manager.read_only'));
</script>
</body>
</html>
