<?php

namespace KLC\OctaneTableManager\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Config;
use KLC\OctaneTableManager\Http\Requests\DeleteRequest;
use KLC\OctaneTableManager\Http\Requests\FetchRequest;
use KLC\OctaneTableManager\Http\Requests\StoreRequest;
use KLC\OctaneTableManager\Http\Requests\UpdateRequest;
use Laravel\Octane\Facades\Octane;

class TableController extends Controller
{
    private $exceptTables = [];

    public function __construct()
    {
        $this->exceptTables = Config::get('octane-table-manager.except_tables', []);
    }

    public function index()
    {
        $routePrefix = Config::get('octane-table-manager.route_prefix', 'octane-table-manager');
        $baseUrl = url($routePrefix);

        return view('otm::index', compact('baseUrl'));
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

            $stats = Octane::table($tableName)->stats();

            $table = [
                'name' => $tableName,
                'limit' => $tableLimit,
                'count' => $stats['num'],
            ];

            foreach ($columns as $columnName => $columnConfig) {
                $column = explode(':', $columnConfig);
                $columnType = $column[0];
                $columnLength = $column[1] ?? 1000;

                $table['columns'][] = [
                    'name' => $columnName,
                    'type' => $columnType,
                    'length' => (int) $columnLength,
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

        if ($request->input('index')) {
            $data = $table->get($request->get('index'));

            if (! $data) {
                return response()->json(['message' => 'Item not found.'], 404);
            }

            $data['_i'] = $request->get('index');

            $tableData['rows'][] = $data;
        } else {
            // The iterator cursor is per worker process, so each request walks from the start.
            // ponytail: O(offset) skip per page, fine for Octane-sized tables.
            $skip = $request->integer('offset');

            foreach ($table as $key => $row) {
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

            $data[$request->get('field')] = $request->get('value');

            $status = $table->set($request->get('index'), $data);

            if (! $status) {
                return response()->json(['message' => 'Failed to update item.'], 400);
            }
        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => 'Update is successful.']);
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
            $status = $table->set($request->input('index'), $request->array('data'));

            if (! $status) {
                return response()->json(['message' => 'Failed to add new item.'], 400);
            }

        } catch (\Throwable $exception) {
            return response()->json(['message' => $exception->getMessage()], 500);
        }

        return response()->json(['message' => 'Add new item is successful.']);
    }
}
