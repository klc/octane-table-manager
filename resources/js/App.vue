<script>
import axios from "axios";
import ConfirmDialog from 'primevue/confirmdialog';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Toast from 'primevue/toast';
import JsonEditor from './JsonEditor.vue';
import { formatJson, isJson } from './json.js';

export default {
    name: "App",
    components: {ConfirmDialog, Dialog, InputText, InputNumber, Toast, JsonEditor},
    data() {
        return {
            readOnly: readOnly, // set by the page from config('octane-table-manager.read_only')
            tables: [],
            tableData: null,
            tableLoader: false,
            moreLoader: false,
            fetchSeq: 0,
            saving: null,
            searchKey: null,
            filterColumn: null,
            filterValue: '',
            tableFilter: '',
            jsonView: {visible: false, title: '', text: ''},
            dark: document.documentElement.classList.contains('p-dark'),
            live: false,
            liveTimer: null,
            liveBusy: false,
            sortByUsage: false,
            newItem: {
                modalVisible: false,
                index: '',
                data: {}
            }
        }
    },
    computed: {
        // Read-only everywhere, or just this table (Octane's cache table).
        tableReadOnly() {
            return this.readOnly || !!this.tableData?.table?.read_only;
        },
        visibleTables() {
            const query = this.tableFilter.toLowerCase();
            const tables = this.tables.filter(table => table.name.toLowerCase().includes(query));

            return this.sortByUsage ? [...tables].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)) : tables;
        }
    },
    methods: {
        fetchTableData: async function (table, loadMore = 0) {
            // Load More keeps the table on screen; only a fresh load shows the full-page spinner.
            this[loadMore ? 'moreLoader' : 'tableLoader'] = true;

            // Only the latest request may touch the view: an older answer (another table, an older search) is dropped.
            const seq = ++this.fetchSeq;

            // A cell edit closed by this very click is saved first, so the offset counts it. PrimeVue closes the editor 1 ms after
            // mousedown, which can come after this click handler: a later 1 ms timer runs after its one.
            // ponytail: tied to PrimeVue's 1 ms; the e2e check "an edit closed by clicking Load More" fails if that changes.
            if (loadMore) {
                await new Promise(resolve => setTimeout(resolve, 1));
                await this.saving;
            }

            // Load More continues the query the view was loaded with, not what the search boxes hold now.
            const query = loadMore ? this.tableData.query
                : {index: this.searchKey, ...(this.filterColumn ? {column: this.filterColumn, value: this.filterValue} : {})};

            // The server counts the offset over rows matching now, and an edit here can take a shown row out of the filter.
            const offset = loadMore ? this.shownMatches() + this.tableData.skip : 0;

            axios.get(`${baseUrl}/fetch`, {params: {table: table.name, offset: offset, ...query}})
                .then((response) => {
                    if (seq !== this.fetchSeq) {
                        return;
                    }

                    if (!loadMore) {
                        // Replace tableData only on success, so a failed search keeps the last good view.
                        this.tableData = {table: table, query: query, rows: response.data.rows, out: new Set()};
                    }
                    else {
                        // Rows written between pages shift offsets, so drop keys already shown.
                        const known = new Set(this.tableData.rows.map(row => row._i));
                        this.tableData['rows'] = [...this.tableData['rows'], ...response.data.rows.filter(row => !known.has(row._i))];
                    }

                    // Rows the server counted that shownMatches() does not (an edit judged out in doubt): the next page still starts after this one.
                    this.tableData['skip'] = Math.max(0, offset + response.data.rows.length - this.shownMatches());
                    this.tableData['hasMore'] = response.data.has_more;
                    this.tableData['stats'] = response.data.stats;
                    this.tableData['server'] = response.data.server;

                    Object.assign(this.tables.find(t => t.name === table.name), {count: response.data.stats.num, usage: response.data.usage});
                })
                .catch((error) => {
                    if (seq === this.fetchSeq) {
                        this.showError(error);
                    }
                })
                .finally(() => {
                    if (seq === this.fetchSeq) {
                        this.tableLoader = false;
                        this.moreLoader = false;
                    }
                });
        },
        // Shown rows the server still counts for the loaded query: all it sent, less those edited here out of the column filter.
        shownMatches() {
            return this.tableData.rows.filter(row => !this.tableData.out.has(row._i)).length;
        },
        editTableCell: function (event) {
            let { data, value, newValue, field } = event;

            if (newValue === value) {
                return;
            }

            if (typeof value === 'number') {
                // On Enter or leaving the cell the number editor sets the value it shows: cut to its digits, ints held within 2^53. Untouched is no edit.
                // ponytail: typing exactly that shown value is not saved either, the editor cannot tell the two apart.
                const {min = -Infinity, max = Infinity, maxFractionDigits} = this.numberProps(this.tableData.table.columns.find(c => c.name === field));
                const shown = Number(new Intl.NumberFormat('en-US', {maximumFractionDigits: maxFractionDigits, useGrouping: false}).format(value));

                if (newValue === Math.min(Math.max(shown, min), max)) {
                    return;
                }
            }

            // INF, -INF and NAN arrive as text in a number column; the number editor cannot hold them and leaves null. Untouched is no edit.
            // ponytail: emptying such a cell is not saved either, typing 0 is.
            if (typeof value === 'string' && typeof newValue !== 'number' && this.tableData.table.columns.find(c => c.name === field).type !== 'string') {
                return;
            }

            if (isJson(value)) {
                // Save compact like the app stored it, and only if it is still JSON.
                if (!isJson(newValue)) {
                    this.$toast.add({ severity: 'error', summary: 'Not valid JSON, nothing was saved.', life: 3000 });
                    return;
                }

                newValue = formatJson(newValue, 0);

                if (newValue === value) {
                    return;
                }
            }

            // A textarea hands every line break back as LF; a value stored with CRLF gets CRLF back, so untouched lines stay as they were.
            // ponytail: a value mixing CRLF with bare LF (or a lone CR) cannot come back exact, the textarea has already made them all LF.
            if (typeof value === 'string' && value.includes('\r\n') && typeof newValue === 'string') {
                newValue = newValue.replace(/\r?\n/g, '\r\n');

                if (newValue === value) {
                    return;
                }
            }

            this.saving = axios.patch(`${baseUrl}/update`, {table: this.tableData.table.name, index: data._i, field: field, value: newValue})
                .then((response) => {
                    this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                    this.tableData.rows.find(row => row._i === data._i)[field] = newValue;

                    // Does the row still match the loaded filter? As TableController::matches(): text contains (any case), numbers equal.
                    // Only A-Z are folded, so a row is never counted that the server would not count.
                    const {column, value} = this.tableData.query;
                    const fold = text => text.replace(/[A-Z]/g, c => c.toLowerCase());

                    if (field === column) {
                        this.tableData.out[(typeof newValue === 'string' ? fold(newValue).includes(fold(value)) : newValue == value) ? 'delete' : 'add'](data._i);
                    }
                })
                .catch((error) => {
                    this.showError(error);
                })
        },
        deleteConfirm: function (data) {
            this.$confirm.require({
                message: 'Do you want to delete this record?',
                header: 'Danger Zone',
                icon: 'pi pi-info-circle',
                rejectProps: {
                    label: 'Cancel',
                    severity: 'secondary',
                    outlined: true
                },
                acceptProps: {
                    label: 'Delete',
                    severity: 'danger'
                },
                accept: () => {
                    axios.delete(`${baseUrl}/delete`, {params: {table: this.tableData.table.name, index: data._i}})
                        .then((response) => {
                            this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });

                            // Drop the row in place so the pages already loaded stay.
                            this.tableData.rows = this.tableData.rows.filter(row => row._i !== data._i);
                            this.tableData.stats.num--;
                            this.tables.find(t => t.name === this.tableData.table.name).count--;
                        })
                        .catch((error) => {
                            this.showError(error);
                        })
                },
                reject: () => {

                }
            });
        },
        exportUrl(format) {
            return `${baseUrl}/export?table=${encodeURIComponent(this.tableData.table.name)}&format=${format}`;
        },
        truncateConfirm() {
            const table = this.tableData.table;

            this.$confirm.require({
                message: `Delete every row of ${table.name}? This cannot be undone.`,
                header: 'Clear table',
                icon: 'pi pi-exclamation-triangle',
                rejectProps: {label: 'Cancel', severity: 'secondary', outlined: true},
                acceptProps: {label: 'Clear table', severity: 'danger'},
                accept: () => {
                    axios.delete(`${baseUrl}/truncate`, {params: {table: table.name}})
                        .then((response) => {
                            this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                            this.openTable(table);
                        })
                        .catch((error) => {
                            this.showError(error);
                        });
                },
            });
        },
        openNewItemModal: function () {
            // Start empty each time, so no values or columns carry over from an earlier table.
            this.newItem = {modalVisible: true, index: '', data: {}};
        },
        addNewItem: function () {
            axios.post(`${baseUrl}/store`, {table: this.tableData.table.name, index: this.newItem.index, data: this.newItem.data})
                .then((response) => {
                    this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                    this.newItem.modalVisible = false;
                    this.fetchTableData(this.tableData.table);
                })
                .catch((error) => {
                    this.showError(error);
                });
        },
        openTable(table) {
            if (this.live) {
                this.toggleLive();
            }
            this.searchKey = null;
            this.filterColumn = null;
            this.filterValue = '';
            this.fetchTableData(table);
        },
        toggleTheme() {
            this.dark = !this.dark;
            document.documentElement.classList.toggle('p-dark', this.dark);

            try {
                localStorage.setItem('otm-theme', this.dark ? 'dark' : 'light');
            } catch (e) {
                // Private mode or blocked storage: the choice lasts until reload.
            }
        },
        toggleLive() {
            this.live = !this.live;
            clearInterval(this.liveTimer);

            if (this.live) {
                this.liveTimer = setInterval(this.refreshShown, 2000);
            }
        },
        // Live view: re-read the rows on screen by key (at most 200) every 2 s. It never walks the table, so it
        // stays cheap on big tables; rows added elsewhere show up on the next search or Load More.
        refreshShown() {
            const busy = this.liveBusy || document.querySelector('.p-datatable tbody input, .p-datatable tbody textarea, .p-dialog');

            if (busy || !this.tableData?.rows?.length) {
                return;
            }

            const table = this.tableData.table;
            const shown = this.tableData.rows.slice(0, 200);
            this.liveBusy = true;

            axios.get(`${baseUrl}/fetch`, {params: {table: table.name, keys: shown.map(row => row._i)}})
                .then(({ data }) => {
                    if (this.tableData?.table !== table) {
                        return;
                    }

                    // Fresh values in place; rows deleted elsewhere drop out.
                    const fresh = Object.fromEntries(data.rows.map(row => [row._i, row]));
                    this.tableData.rows = [...shown.filter(row => fresh[row._i]).map(row => fresh[row._i]), ...this.tableData.rows.slice(200)];
                    this.tableData.stats = data.stats;
                    Object.assign(this.tables.find(t => t.name === table.name), {count: data.stats.num, usage: data.usage});
                })
                .catch((error) => {
                    this.showError(error);
                    this.toggleLive();
                })
                .finally(() => {
                    this.liveBusy = false;
                });
        },
        isJson,
        // Decided on the stored value, so the editor does not switch while the text is briefly invalid.
        storedIsJson(data, field) {
            return isJson(this.tableData.rows.find(row => row._i === data._i)?.[field]);
        },
        // An <input> drops CR and LF from its value, so a stored line break needs the textarea whatever the column size.
        storedHasLineBreak(data, field) {
            return /[\r\n]/.test(this.tableData.rows.find(row => row._i === data._i)?.[field]);
        },
        showJson(field, row) {
            this.jsonView = {visible: true, title: `${row._i} · ${field}`, text: formatJson(row[field], 2)};
        },
        usageSeverity(usage) {
            return usage >= 0.8 ? 'danger' : usage >= 0.5 ? 'warn' : undefined;
        },
        showError(error) {
            this.$toast.add({ severity: 'error', summary: error.response?.data?.message ?? error.message, life: 3000 });
        },
        columnName(column) {
            return column.name + " [" + column.definition + "]";
        },
        numberProps(column) {
            // Swoole stores every int column as int64 whatever size the config gives.
            // ponytail: JS numbers hold integers exactly only up to 2^53, so larger values are out of reach.
            return column.type === 'int'
                ? {min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, maxFractionDigits: 0, useGrouping: false}
                : {maxFractionDigits: 15, useGrouping: false};
        }
    },
    unmounted() {
        clearInterval(this.liveTimer);
    },
    mounted() {
        axios.get(`${baseUrl}/list`)
            .then((response) => {
                this.tables = response.data;
            })
            .catch((error) => {
                this.showError(error);
            })
    }
}
</script>

<template>
    <toast/>
    <div class="card flex">

        <!-------------------------- Sidebar ------------------------>
        <div class="card w-72 shrink-0 py-4 px-2">
            <div class="flex gap-2 mb-2">
                <InputText v-model="tableFilter" size="small" placeholder="Filter tables" class="flex-1 min-w-0" />
                <Button :outlined="!sortByUsage" size="small" icon="pi pi-sort-amount-down" title="Sort by usage, fullest first"
                        @click="sortByUsage = !sortByUsage" />
                <Button text size="small" :icon="dark ? 'pi pi-sun' : 'pi pi-moon'" :title="dark ? 'Light theme' : 'Dark theme'" @click="toggleTheme" />
            </div>
            <PanelMenu :model="visibleTables" class="w-full">
                <template #item="{ item }">
                    <a @click="openTable(item)" v-ripple class="flex items-center gap-2 px-4 py-2 cursor-pointer group">
                        <!-- A long name gets an ellipsis (full name on hover) instead of running into the badge. -->
                        <span class="ml-2 truncate" :title="item.name">{{ item.name }}</span>
                        <Badge v-if="item.limit" class="ml-auto shrink-0" :value="item.count + '/' + item.limit" :severity="usageSeverity(item.usage)"
                               :title="'Conflict slots in use: ' + Math.round(item.usage * 100) + '%. New keys start failing at 100% (around 1.7x the table size).'" />
                    </a>
                </template>
            </PanelMenu>
        </div>
        <!-------------------------- Sidebar ------------------------>

        <!-- min-w-0: let this column shrink instead of growing to the table's width and pushing the page sideways. -->
        <div class="flex-1 min-w-0 py-4 px-2">
            <div v-if="tableData !== null || tableLoader">
                <div class="text-center h-dvh" v-if="tableLoader">
                    <i class="pi pi-spin pi-spinner absolute top-50" style="font-size: 8rem"></i>
                </div>

                <template v-else>

                    <!-------------------------- Table Info ------------------------>
                    <Panel class="mb-2">
                        <p class="mb-2 text-sm text-surface-500" title="Swoole tables live in each server's memory. Behind a load balancer, other servers hold different data.">
                            Server: <b>{{ tableData.server }}</b>
                        </p>
                        <div class="flex">
                            <div class="card flex-1/3">
                                <p><b>Item Count : </b> {{ tableData.stats.num }}</p>
                                <p><b>Conflict Count : </b> {{ tableData.stats.conflict_count }}</p>
                                <p><b>Conflict Max Level : </b> {{ tableData.stats.conflict_max_level }}</p>
                            </div>
                            <div class="card flex-1/3">
                                <p><b>Insert Count : </b> {{ tableData.stats.insert_count }}</p>
                                <p><b>Update Count : </b> {{ tableData.stats.update_count }}</p>
                                <p><b>Delete : </b> {{ tableData.stats.delete_count }}</p>
                            </div>
                            <div class="card flex-1/3">
                                <p><b>Available Slice Num : </b> {{ tableData.stats.available_slice_num }}</p>
                                <p><b>Total Slice Num : </b> {{ tableData.stats.total_slice_num }}</p>
                                <p><b>Memory Size : </b> {{ tableData.stats.memory }}</p>
                            </div>
                        </div>
                    </Panel>
                    <!-------------------------- Table Infos ------------------------>

                    <!----------------------------- Table --------------------------->
                    <Panel>
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <InputText v-model="searchKey" size="small" placeholder="Index Search" title="An exact index, or a pattern with * and ? such as user_*"
                                       @keyup.enter="fetchTableData(tableData.table)" />
                            <Select v-model="filterColumn" :options="tableData.table.columns" option-label="name" option-value="name"
                                    placeholder="Column" show-clear size="small" />
                            <InputText v-model="filterValue" size="small" :disabled="!filterColumn" placeholder="Value"
                                       title="Text columns: contains (any case). Numbers: equals." @keyup.enter="fetchTableData(tableData.table)" />
                            <Button outlined icon="pi pi-search" @click="fetchTableData(tableData.table)"/>
                            <div class="ms-auto me-4 flex items-center gap-2">
                                <Button :outlined="!live" size="small" :icon="live ? 'pi pi-sync pi-spin' : 'pi pi-sync'" label="Live"
                                        title="Re-read the rows on screen every 2 seconds" @click="toggleLive" />
                                <Button as="a" :href="exportUrl('json')" text size="small" icon="pi pi-download" label="JSON" title="Download every row as JSON" />
                                <Button as="a" :href="exportUrl('csv')" text size="small" icon="pi pi-download" label="CSV" title="Download every row as CSV" />
                                <Tag v-if="tableReadOnly" severity="secondary" value="Read-only" />
                                <template v-else>
                                    <Button text size="small" severity="danger" icon="pi pi-eraser" title="Clear table" @click="truncateConfirm" />
                                    <Button outlined icon="pi pi-plus" @click="openNewItemModal" />
                                </template>
                            </div>
                        </div>
                        <DataTable :value="tableData.rows"
                                   dataKey="_i"
                                   tableStyle="min-width: 50rem"
                                   scrollable
                                   scroll-height="calc(100dvh - 20rem)"
                                   :editMode="tableReadOnly ? undefined : 'cell'"
                                   @cell-edit-complete="editTableCell">
                            <Column field="_i" header="Index" />
                            <Column v-for="column in tableData.table.columns"
                                    :field="column.name"
                                    :header="columnName(column)"
                                    :column-key="column.name">
                                <template #body="{ data, field }">
                                    <!-- Long values (tokens, JSON, paragraphs) stay within 20rem and 3 lines; hover shows all. -->
                                    <div class="flex items-start gap-1">
                                        <div class="line-clamp-3 max-w-xs break-words" :class="{'font-mono text-xs': isJson(data[field])}" :title="data[field]">{{ data[field] }}</div>
                                        <Button v-if="isJson(data[field])" text size="small" icon="pi pi-code" title="View formatted JSON"
                                                @click.stop="showJson(field, data)" />
                                    </div>
                                </template>
                                <template #editor="{ data, field }">
                                    <template v-if="column.type === 'string' && storedIsJson(data, field)">
                                        <JsonEditor v-model="data[field]" />
                                    </template>
                                    <template v-else-if="column.type === 'string' && column.length < 75 && !storedHasLineBreak(data, field)">
                                        <InputText v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else-if="column.type === 'string'">
                                        <Textarea v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else>
                                        <InputNumber v-model="data[field]" v-bind="numberProps(column)" />
                                    </template>
                                </template>
                            </Column>
                            <Column v-if="!tableReadOnly">
                                <template #body="{ data }">
                                    <Button @click="deleteConfirm(data)" outlined icon="pi pi-trash"/>
                                </template>
                            </Column>
                        </DataTable>
                        <div class="mt-4" v-if="tableData.hasMore">
                            <Button @click="fetchTableData(tableData['table'], 1)" :loading="moreLoader" :fluid="true" label="Load More" variant="outlined" />
                        </div>
                    </Panel>
                    <!----------------------------- Table --------------------------->

                </template>
            </div>
        </div>

        <!-------------------------- New Item Dialog ------------------------->
        <Dialog v-model:visible="newItem.modalVisible" modal header="Add New Item" :style="{ width: '25rem' }">
            <div class="flex items-center gap-4 mb-4">
                <label for="_i" class="font-semibold w-24">index</label>
                <InputText v-model="newItem.index" id="_i" class="flex-auto w-full" autocomplete="off" required maxlength="63"/>
            </div>
            <div class="flex items-center gap-4 mb-4" v-for="column in tableData.table.columns">
                <label :for="column.name" class="font-semibold w-24">{{ column.name }}</label>

                <InputText v-if="column.type === 'string' &&  column.length < 75"
                           :id="column.name"
                           class="flex-auto w-full"
                           autocomplete="off"
                           v-model="newItem.data[column.name]"
                           :maxlength="column.length" />

                <Textarea v-else-if="column.type === 'string' && column.length >= 75"
                          :id="column.name"
                          class="flex-auto w-full"
                          autocomplete="off"
                          v-model="newItem.data[column.name]"
                          :maxlength="column.length"/>

                <InputNumber v-else
                             :id="column.name"
                             class="flex-auto w-full"
                             autocomplete="off"
                             v-model="newItem.data[column.name]"
                             v-bind="numberProps(column)" />
            </div>
            <div class="flex justify-end gap-2">
                <Button type="button" label="Cancel" severity="secondary" @click="newItem.modalVisible = false"></Button>
                <Button type="button" label="Save" @click="addNewItem"></Button>
            </div>
        </Dialog>
        <!-------------------------- New Item Dialog ------------------------->

        <Dialog v-model:visible="jsonView.visible" modal :header="jsonView.title" :style="{ width: '40rem' }">
            <pre class="text-xs overflow-auto max-h-[70vh]">{{ jsonView.text }}</pre>
        </Dialog>

        <ConfirmDialog></ConfirmDialog>
    </div>
</template>

<style scoped>

</style>
