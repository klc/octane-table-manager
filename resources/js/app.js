import './bootstrap';
import { createApp } from "vue";
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';

import App from "./App.vue";

const app = createApp(App);

app.use(PrimeVue, {
    theme: {
        preset: Aura,
        // Dark when <html> has .p-dark: set before the app loads (see index.blade.php) and by the theme button.
        options: { darkModeSelector: '.p-dark' }
    }
});
app.use(ConfirmationService);
app.use(ToastService);

app.mount("#app");
