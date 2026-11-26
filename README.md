# Octane Table Manager

## Install

`composer require klc/octane-table-manager --dev`

`php artisan vendor:publish --tag=otm-config` (optional)

The JS and CSS are served by the package itself, so there is nothing to publish and `composer update` is enough to upgrade.
Upgrading from 0.1.x: the old `public/vendor/octane-table-manager` folder is no longer used and can be deleted.

`yourdomain.com/octane-table-manager`

If your app binds its web routes to a domain and has a catch-all route on it (a URL shortener's `/{code}`, a CMS page
route), set `OTM_DOMAIN` to that domain. Laravel matches domain routes before the others, so without it the
catch-all answers `/octane-table-manager`.

## Several servers

A Swoole table lives in the memory of one Octane server. Behind a load balancer with several servers or
containers, each holds its own copy: the manager shows and edits the tables of whichever server answers the
request. The server's hostname is shown above the table stats. To look at one server, open the manager on that
server directly.

## Access

The manager is open only when `APP_ENV=local`. Anywhere else it answers 403 unless the app defines the
`viewOctaneTableManager` gate, for example in `AppServiceProvider::boot()`:

```php
use Illuminate\Support\Facades\Gate;

Gate::define('viewOctaneTableManager', function ($user) {
    return in_array($user->email, ['admin@example.com']);
});
```

A gate whose closure takes a non-nullable `$user` denies guests, so add `auth` to `middleware` in the config to send them to the login page instead.

Routes use the `web` middleware group by default (session, CSRF). If you published the config while it still had
`'middleware' => []`, change it to `['web']`, or the gate never sees the logged-in user.

Set `OTM_READ_ONLY=true` to browse without being able to change anything: the UI hides the edit controls and the
server answers 403 to every request that would write.

If there are any tables you don't want to be listed, you should add their names to the `except_tables` array in the config file.

![otmindex.png](screenshots/otm-index.png?t=1749120687517)

## Development

`npm run dev` serves the UI with hot reload while the package is linked into an app. Run `npm run build` before
committing: the built files in `public/` are what installs use, and CI fails when they do not match the sources.

End-to-end tests run against a real Octane + Swoole server in Docker, in a throwaway Laravel app per version:

```sh
npm ci
PW_CHANNEL=chrome npm run e2e -- 13   # 10, 11, 12 or 13; PW_CHANNEL=chrome uses your installed Chrome
```

Without `PW_CHANNEL`, install a browser first with `npx playwright-core install chromium`.
