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
            searchKey: null,
            filterColumn: null,
            filterValue: '',
            tableFilter: '',
            jsonView: {visible: false, title: '', text: ''},
            sortByUsage: false,
            newItem: {
                modalVisible: false,
                index: '',
                data: {}
            }
        }
    },
    computed: {
        visibleTables() {
            const query = this.tableFilter.toLowerCase();
            const tables = this.tables.filter(table => table.name.toLowerCase().includes(query));

            return this.sortByUsage ? [...tables].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)) : tables;
        }
    },
    methods: {
        fetchTableData: function (table, loadMore = 0) {
            // Load More keeps the table on screen; only a fresh load shows the full-page spinner.
            this[loadMore ? 'moreLoader' : 'tableLoader'] = true;

            const offset = loadMore ? this.tableData.rows.length : 0;

            const filter = this.filterColumn ? {column: this.filterColumn, value: this.filterValue} : {};

            axios.get(`${baseUrl}/fetch`, {params: {table: table.name, index: this.searchKey, offset: offset, ...filter}})
                .then((response) => {
                    if (!loadMore) {
                        // Replace tableData only on success, so a failed search keeps the last good view.
                        this.tableData = {table: table, rows: response.data.rows};
                    }
                    else {
                        // Rows written between pages shift offsets, so drop keys already shown.
                        const known = new Set(this.tableData.rows.map(row => row._i));
                        this.tableData['rows'] = [...this.tableData['rows'], ...response.data.rows.filter(row => !known.has(row._i))];
                    }

                    this.tableData['hasMore'] = response.data.has_more;
                    this.tableData['stats'] = response.data.stats;
                    this.tableData['server'] = response.data.server;

                    Object.assign(this.tables.find(t => t.name === table.name), {count: response.data.stats.num, usage: response.data.usage});
                })
                .catch((error) => {
                    this.showError(error);
                })
                .finally(() => {
                    this.tableLoader = false;
                    this.moreLoader = false;
                });
        },
        editTableCell: function (event) {
            let { data, value, newValue, field } = event;

            if (newValue === value) {
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

            axios.patch(`${baseUrl}/update`, {table: this.tableData.table.name, index: data._i, field: field, value: newValue})
                .then((response) => {
                    this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                    this.tableData.rows.find(row => row._i === data._i)[field] = newValue;
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
            this.searchKey = null;
            this.filterColumn = null;
            this.filterValue = '';
            this.fetchTableData(table);
        },
        isJson,
        // Decided on the stored value, so the editor does not switch while the text is briefly invalid.
        storedIsJson(data, field) {
            return isJson(this.tableData.rows.find(row => row._i === data._i)?.[field]);
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
                                <Button as="a" :href="exportUrl('json')" text size="small" icon="pi pi-download" label="JSON" title="Download every row as JSON" />
                                <Button as="a" :href="exportUrl('csv')" text size="small" icon="pi pi-download" label="CSV" title="Download every row as CSV" />
                                <Tag v-if="readOnly" severity="secondary" value="Read-only" />
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
                                   :editMode="readOnly ? undefined : 'cell'"
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
                                    <template v-else-if="column.type === 'string' && column.length < 75">
                                        <InputText v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else-if="column.type === 'string' && column.length >= 75">
                                        <Textarea v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else>
                                        <InputNumber v-model="data[field]" v-bind="numberProps(column)" />
                                    </template>
                                </template>
                            </Column>
                            <Column v-if="!readOnly">
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
