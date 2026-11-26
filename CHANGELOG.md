# Changelog

## Unreleased (0.2.0)

### Breaking

- Outside `APP_ENV=local` the manager answers 403 unless the `viewOctaneTableManager` gate allows the user.
- The routes use the `web` middleware group by default. A published config with `'middleware' => []` must change to `['web']`.
- There is no `otm-assets` publish tag any more: the package serves its own JS and CSS. The old
  `public/vendor/octane-table-manager` folder can be deleted.
- `fetch` takes `offset` instead of `load_more`.

### Added

- Sidebar badges turn yellow / red as a table runs out of conflict slots. A Swoole table holds about 1.7x its
  configured size; inserts fail (Laravel raises an ErrorException) when a new key collides and no slot is left.
- Index search takes patterns (`user_*`, `?`), and rows can be filtered by a column: text contains (any case),
  numbers equal. Load More pages through the matches.
- A filter box and a sort-by-usage toggle for the table list.
- The hostname of the server that answered is shown above the stats (each Octane server has its own tables).
- `OTM_DOMAIN` for apps whose routes are bound to a domain and end in a catch-all route.
- End-to-end tests on Laravel 10–13 with Octane and Swoole, and a CI workflow.

### Fixed

- Load More returned repeated, skipped or no rows with more than one Octane worker.
- After `composer update` the browser kept loading the old JS and CSS.
- Column sizes default to 1000 like Octane (a plain `string` column was capped at 8 characters); headers show
  the column as written in `config/octane.php`.
- Adding an item silently overwrote an existing index; now 409.
- Editing a cell rewrote the whole row and could undo another worker's change.
- A value too large for its column (counted in bytes) answers 422 instead of 500.
- Index searches for `0`, empty string values, keys over 63 bytes, float decimals and int limits in the editor.
- The UI no longer crashes on an empty table, past the last page, or on a search that finds nothing.
- Wide tables stay inside the page; long values stop at three lines.
- Laravel 10 support (`$request->array()` and Blade `@use` were Laravel 11 only).

## 0.1.3

- First releases.
