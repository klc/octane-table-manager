<script>
import axios from "axios";
import ConfirmDialog from 'primevue/confirmdialog';
import Dialog from 'primevue/dialog';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Toast from 'primevue/toast';

export default {
    name: "App",
    components: {ConfirmDialog, Dialog, InputText, InputNumber, Toast},
    data() {
        return {
            tables: [],
            tableData: null,
            tableLoader: false,
            searchKey: null,
            newItem: {
                modalVisible: false,
                index: '',
                data: {}
            }
        }
    },
    methods: {
        fetchTableData: function (table, loadMore = 0) {
            if (!loadMore && !this.search_key) {
                this.tableData = [];
            }

            this.tableLoader = true;

            axios.get(`${baseUrl}/fetch`, {params: {table: table.name, index: this.searchKey, load_more: loadMore}})
                .then((response) => {
                    if (!loadMore) {
                        this.tableData['rows'] = response.data.rows;
                    }
                    else {
                        this.tableData['rows'] = [...this.tableData['rows'], ...response.data.rows];
                    }

                    this.tableData['stats'] = response.data.stats;
                    this.tableData['table'] = table;

                    this.tables.find(t => t.name === table.name).count = response.data.stats.num;
                })
                .catch((error) => {
                    this.$toast.add({ severity: 'error', summary: error.response.data.message, life: 3000 });
                })
                .finally(() => {
                    this.tableLoader = false;
                });
        },
        editTableCell: function (event) {
            let { data, newValue, field } = event;

            axios.patch(`${baseUrl}/update`, {table: this.tableData.table.name, index: data._i, field: field, value: newValue})
                .then((response) => {
                    this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                    this.tableData.rows.find(row => row._i === data._i)[field] = newValue;
                })
                .catch((error) => {
                    this.$toast.add({ severity: 'error', summary: error.response.data.message, life: 3000 });
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

                            this.fetchTableData(this.tableData.table);
                        })
                        .catch((error) => {
                            this.$toast.add({ severity: 'error', summary: error.response.data.message, life: 3000 });
                        })
                },
                reject: () => {

                }
            });
        },
        openNewItemModal: function () {
            this.newItem.modalVisible = true;
        },
        addNewItem: function () {
            axios.post(`${baseUrl}/store`, {table: this.tableData.table.name, index: this.newItem.index, data: this.newItem.data})
                .then((response) => {
                    this.$toast.add({ severity: 'success', summary: response.data.message, life: 3000 });
                })
                .catch((error) => {
                    this.$toast.add({ severity: 'error', summary: error.response.data.message, life: 3000 });
                })
                .finally(() => {
                    this.newItem.modalVisible = false;
                    this.fetchTableData(this.tableData.table);
                });
        },
        columnName(column) {
            return column.name + " [" + column.type + ":" + column.length + "]";
        },
        intMaxVal(byte) {
            return Math.ceil((255 ** byte) / 2);
        },
        intMinVal(byte) {
            return 0 - Math.floor((255 ** byte) / 2);
        }
    },
    mounted() {
        console.log("route prefix : ", baseUrl);

        axios.get(`${baseUrl}/list`)
            .then((response) => {
                this.tables = response.data;
            })
    }
}
</script>

<template>
    <toast/>
    <div class="card flex">

        <!-------------------------- Sidebar ------------------------>
        <div class="card flex-1/6 py-4 px-2">
            <PanelMenu :model="tables" class="w-full">
                <template #item="{ item }">
                    <a @click="fetchTableData(item)" v-ripple class="flex items-center px-4 py-2 cursor-pointer group">
                        <span :class="['ml-2']">{{ item.name }}</span>
                        <Badge v-if="item.limit" class="ml-auto" :value="item.limit + '/' + item.count" />
                    </a>
                </template>
            </PanelMenu>
        </div>
        <!-------------------------- Sidebar ------------------------>

        <div class="flex-5/6 py-4 px-2">
            <div v-if="tableData !== null">
                <div class="text-center h-dvh" v-if="tableLoader">
                    <i class="pi pi-spin pi-spinner absolute top-50" style="font-size: 8rem"></i>
                </div>

                <template v-else>

                    <!-------------------------- Table Info ------------------------>
                    <Panel class="mb-2">
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
                        <div>
                            <InputText v-model="searchKey" type="text" size="small" placeholder="Index Search" />
                            <Button class="ms-2" outlined icon="pi pi-search" @click="fetchTableData(this.tableData.table)"/>
                            <Button class="float-end me-4" outlined icon="pi pi-plus" @click="openNewItemModal" />
                        </div>
                        <DataTable :value="tableData.rows"
                                   dataKey="_i"
                                   tableStyle="min-width: 50rem"
                                   scroll-height="80vh"
                                   :virtualScrollerOptions="{ itemSize: 40 }"
                                   editMode="cell"
                                   @cell-edit-complete="editTableCell">
                            <Column field="_i" header="Index" />
                            <Column v-for="column in tableData.table.columns"
                                    :field="column.name"
                                    :header="columnName(column)"
                                    :column-key="column.name">
                                <template #body="{ data, field }">
                                    {{ data[field] }}
                                </template>
                                <template #editor="{ data, field }">
                                    <template v-if="column.type === 'string' && column.length < 75">
                                        <InputText v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else-if="column.type === 'string' && column.length >= 75">
                                        <Textarea v-model="data[field]" :maxlength="column.length" />
                                    </template>
                                    <template v-else>
                                        <InputNumber v-model="data[field]" :max="intMaxVal(column.length)" :min="intMinVal(column.length)" />
                                    </template>
                                </template>
                            </Column>
                            <Column>
                                <template #body="{ data }">
                                    <Button @click="deleteConfirm(data)" outlined icon="pi pi-trash"/>
                                </template>
                            </Column>
                        </DataTable>
                        <div class="mt-4">
                            <Button @click="fetchTableData(tableData['table'], 1)" :fluid="true" label="Load More" variant="outlined" />
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
                             :max="intMaxVal(column.length)"
                             :min="intMinVal(column.length)" />
            </div>
            <div class="flex justify-end gap-2">
                <Button type="button" label="Cancel" severity="secondary" @click="newItem.modalVisible = false"></Button>
                <Button type="button" label="Save" @click="addNewItem"></Button>
            </div>
        </Dialog>
        <!-------------------------- New Item Dialog ------------------------->

        <ConfirmDialog></ConfirmDialog>
    </div>
</template>

<style scoped>

</style>
