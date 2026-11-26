<?php

namespace KLC\OctaneTableManager\Http\Controllers;

use Illuminate\Foundation\Vite;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Config;
use KLC\OctaneTableManager\Http\Requests\DeleteRequest;
use KLC\OctaneTableManager\Http\Requests\FetchRequest;
use KLC\OctaneTableManager\Http\Requests\StoreRequest;
use KLC\OctaneTableManager\Http\Requests\UpdateRequest;
use Laravel\Octane\Exceptions\ValueTooLargeForColumnException;
use Laravel\Octane\Facades\Octane;

class TableController extends Controller
{
    // Built assets are served from the package itself, so a composer update is all an upgrade needs.
    private const DIST = __DIR__.'/../../../public/vendor/octane-table-manager';

    private const MIME_TYPES = [
        'js' => 'text/javascript',
        'css' => 'text/css',
        'woff2' => 'font/woff2',
        'woff' => 'font/woff',
        'ttf' => 'font/ttf',
        'eot' => 'application/vnd.ms-fontobject',
        'svg' => 'image/svg+xml',
    ];

    private $exceptTables = [];

    public function __construct()
    {
        $this->exceptTables = Config::get('octane-table-manager.except_tables', []);
    }

    public function index()
    {
        $routePrefix = Config::get('octane-table-manager.route_prefix', 'octane-table-manager');
        // Relative, so a TLS-terminating proxy cannot turn it into http:// (mixed content).
        $baseUrl = request()->getBaseUrl().'/'.trim($routePrefix, '/');

        if (is_file(self::DIST.'/octane-table-manager.hot')) {
            // `npm run dev` while working on the package. A fresh Vite instance leaves the app's own one untouched.
            $assets = (new Vite)->useHotFile(self::DIST.'/octane-table-manager.hot')
                ->withEntryPoints(['resources/css/app.css', 'resources/js/app.js'])
                ->toHtml();
        } else {
            $manifest = json_decode(file_get_contents(self::DIST.'/manifest.json'), true);
            $assets = sprintf(
                '<link rel="stylesheet" href="%s"><script type="module" src="%s"></script>',
                e($baseUrl.'/'.$manifest['resources/css/app.css']['file']),
                e($baseUrl.'/'.$manifest['resources/js/app.js']['file']),
            );
        }

        return view('otm::index', compact('baseUrl', 'assets'));
    }

    public function asset(string $file)
    {
        $path = self::DIST.'/assets/'.basename($file);

        abort_unless(is_file($path), 404);

        // BinaryFileResponse marks itself public; these responses carry the session cookies.
        return response()->file($path, [
            'Content-Type' => self::MIME_TYPES[pathinfo($path, PATHINFO_EXTENSION)] ?? 'application/octet-stream',
            'Cache-Control' => 'max-age=31536000, immutable',
        ])->setPrivate();
    }

    public function list(): JsonResponse
    {
        $tableConfig = Config::get('octane.tables') ?? [];

        $tables = [];
        foreach ($tableConfig as $tableKey => $columns) {
            // Same defaults as Octane's bin/createSwooleTables.php.
            [$tableName, $tableLimit] = explode(':', $tableKey) + [1 => 1000];

            if (in_array($tableName, $this->exceptTables)) {
                continue;
            }

            try {
                $stats = Octane::table($tableName)->stats();
            } catch (\Throwable $exception) {
                // e.g. not running on Swoole: "Tables may only be accessed when using the Swoole server."
                return response()->json(['message' => $exception->getMessage()], 500);
            }

            $table = [
                'name' => $tableName,
                'limit' => $tableLimit,
                'count' => $stats['num'],
                'usage' => self::usage($stats),
            ];

            foreach ($columns as $columnName => $columnConfig) {
                $column = explode(':', $columnConfig);
                $columnType = $column[0];
                $columnLength = $column[1] ?? 1000;

                $table['columns'][] = [
                    'name' => $columnName,
                    'type' => $columnType,
                    'length' => (int) $columnLength,
                    // As written in config/octane.php, for the column header.
                    'definition' => $columnConfig,
                ];
            }

            $tables[] = $table;
        }

        return response()->json($tables);
    }

    public function fetch(FetchRequest $request): JsonResponse
    {
        if (in_array($request->get('table'), $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($request->get('table'));
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        $tableData = [];
        $tableData['stats'] = $table->stats();
        $tableData['stats']['memory'] = number_format(($table->memorySize / 1024), 2, '.', '').' KB';
        $tableData['rows'] = [];
        $tableData['has_more'] = false;
        $tableData['usage'] = self::usage($tableData['stats']);
        // Each Octane server keeps its own tables; say which one answered.
        $tableData['server'] = gethostname();

        $index = (string) $request->input('index');
        $column = $request->input('column');

        // An index without wildcards is a direct lookup; a pattern (user_*) or a column filter walks the table.
        if ($index !== '' && strpbrk($index, '*?[') === false) {
            $data = $table->get($index);

            if (! $data) {
                return response()->json(['message' => 'Item not found.'], 404);
            }

            $data['_i'] = $request->get('index');

            $tableData['rows'][] = $data;
        } else {
            // The iterator cursor is per worker process, so each request walks from the start.
            // The offset counts matching rows, so Load More pages through the filtered result.
            // ponytail: O(table) walk per page, about 0.15 s for 100k rows; fine for Octane-sized tables.
            $skip = $request->integer('offset');

            foreach ($table as $key => $row) {
                if ($index !== '' && ! fnmatch($index, $key)) {
                    continue;
                }

                if ($column !== null) {
                    if (! array_key_exists($column, $row)) {
                        return response()->json(['message' => "Unknown column [$column]."], 422);
                    }

                    if (! self::matches($row[$column], $request->input('value'))) {
                        continue;
                    }
                }

                if ($skip-- > 0) {
                    continue;
                }

                $row['_i'] = $key;
                $tableData['rows'][] = $row;

                if (count($tableData['rows']) === 50) {
                    $tableData['has_more'] = true;
                    break;
                }
            }
        }

        return response()->json($tableData);
    }

    public function update(UpdateRequest $request): JsonResponse
    {
        if (in_array($request->get('table'), $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($request->get('table'));

            $data = $table->get($request->get('index'));

            if (! $data) {
                return response()->json(['message' => 'Item not found.'], 404);
            }

            if (! isset($data[$request->get('field')])) {
                return response()->json(['message' => 'Field not found.'], 404);
            }

            // Write only this column: writing the whole row back would undo another worker's change to the others.
            // ConvertEmptyStringsToNull turns an emptied cell into null; store it as ''.
            $status = $table->set($request->get('index'), [$request->get('field') => $request->input('value') ?? '']);

            if (! $status) {
                return response()->json(['message' => 'Failed to update item.'], 400);
            }
        } catch (ValueTooLargeForColumnException $exception) {
            // Octane checks string sizes in bytes; the browser counts characters, and ş, ğ, ü... take 2 bytes.
            return response()->json(['message' => $exception->getMessage().' Column sizes are in bytes, and characters like ş take 2.'], 422);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => 'Update is successful.']);
    }

    public function export(Request $request)
    {
        $name = $request->validate(['table' => 'required|string', 'format' => 'nullable|in:json,csv'])['table'];
        $csv = $request->input('format') === 'csv';

        if (in_array($name, $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($name);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        // Octane sends a streamed response as it is written, so even a large table is never held whole in memory.
        return response()->streamDownload(function () use ($table, $csv) {
            // Rows go to a memory buffer that is sent in 64 KB pieces, not one small write per row.
            $out = fopen('php://output', 'w');
            $buffer = fopen('php://memory', 'w+');
            $flush = function () use ($out, $buffer) {
                rewind($buffer);
                stream_copy_to_stream($buffer, $out);
                ftruncate($buffer, 0);
                rewind($buffer);
            };
            $first = true;

            foreach ($table as $key => $row) {
                if ($csv) {
                    if ($first) {
                        fputcsv($buffer, ['_index', ...array_keys($row)], escape: '');
                    }
                    fputcsv($buffer, [$key, ...array_values($row)], escape: '');
                } else {
                    fwrite($buffer, ($first ? '[' : ',').json_encode(['_index' => $key] + $row, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
                }
                $first = false;

                if (ftell($buffer) > 65536) {
                    $flush();
                }
            }

            if (! $csv) {
                fwrite($buffer, $first ? '[]' : ']');
            }

            $flush();
        }, $name.($csv ? '.csv' : '.json'), ['Content-Type' => $csv ? 'text/csv' : 'application/json']);
    }

    public function truncate(Request $request): JsonResponse
    {
        $name = $request->validate(['table' => 'required|string'])['table'];

        if (in_array($name, $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($name);

            // Collect first: deleting while the iterator walks the table can skip rows.
            $keys = [];
            foreach ($table as $key => $row) {
                $keys[] = $key;
            }

            foreach ($keys as $key) {
                $table->del($key);
            }
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => count($keys).' rows deleted.']);
    }

    public function delete(DeleteRequest $request): JsonResponse
    {
        if (in_array($request->get('table'), $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($request->get('table'));

            $status = $table->del($request->get('index'));

            if (! $status) {
                return response()->json(['message' => 'Failed to delete item.'], 400);
            }

        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => 'Delete is successful.']);
    }

    public function store(StoreRequest $request): JsonResponse
    {
        if (in_array($request->get('table'), $this->exceptTables)) {
            return response()->json(['message' => 'Table is unavailable.'], 403);
        }

        try {
            $table = Octane::table($request->get('table'));

            if ($table->exists($request->input('index'))) {
                return response()->json(['message' => 'An item with this index already exists.'], 409);
            }

            $status = $table->set($request->input('index'), (array) $request->input('data'));

            if (! $status) {
                return response()->json(['message' => 'Failed to add new item.'], 400);
            }

        } catch (ValueTooLargeForColumnException $exception) {
            // Octane checks string sizes in bytes; the browser counts characters, and ş, ğ, ü... take 2 bytes.
            return response()->json(['message' => $exception->getMessage().' Column sizes are in bytes, and characters like ş take 2.'], 422);
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => 'Add new item is successful.']);
    }

    /**
     * Share of the conflict slots in use. A Swoole table takes about 1.7x its size in rows (measured on
     * Swoole 6.3); set() fails once a new key collides and no slot is left, whatever the row count says.
     */
    private static function usage(array $stats): float
    {
        return $stats['total_slice_num'] > 0 ? round(1 - $stats['available_slice_num'] / $stats['total_slice_num'], 2) : 0;
    }

    // Strings: case-insensitive "contains". Numbers: equal.
    private static function matches(int|float|string $cell, ?string $value): bool
    {
        return is_string($cell) ? mb_stripos($cell, (string) $value) !== false : is_numeric($value) && $cell == $value;
    }
}
