# Octane Table Manager

## Install

`composer require klc/octane-table-manager --dev`

`php artisan vendor:publish --tag=otm-assets`

`php artisan vendor:publish --tag=otm-config` (optional)

`yourdomain.com/octane-table-manager`

If it will be used in a production environment, it is recommended to add authentication for security. This can be done by adding an authentication middleware in the config file.

If there are any tables you don't want to be listed, you should add their names to the `except_tables` array in the config file.

![otmindex.png](screenshots/otm-index.png?t=1749120687517)
