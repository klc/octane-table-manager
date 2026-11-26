<script>
import Textarea from 'primevue/textarea';
import { formatJson } from './json.js';

// Shows a JSON cell indented. The model only changes once the text is edited, so opening and closing a cell
// without typing sends nothing.
export default {
    name: 'JsonEditor',
    components: { Textarea },
    props: { modelValue: String },
    emits: ['update:modelValue'],
    data() {
        return { text: formatJson(this.modelValue, 2) };
    },
};
</script>

<template>
    <Textarea v-model="text" @update:model-value="$emit('update:modelValue', $event)" rows="12" cols="60" class="font-mono text-xs" spellcheck="false" />
</template>
