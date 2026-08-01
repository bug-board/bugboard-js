// Nuxt — register the plugin TWICE.
//
// Nuxt builds your app with Vite, but Nitro builds `server/` with its own Rollup
// pipeline that never sees `vite.plugins`. Miss the second registration and
// every server route still reports a chunk.
import bugboard from 'bugboard/vite';

export default defineNuxtConfig({
    vite: {
        plugins: [bugboard()],
    },
    nitro: {
        // Lets Node's source-map support resolve server stacks too.
        sourceMap: true,
        rollupConfig: {
            plugins: [bugboard()],
        },
    },
});

// `.vue` components are covered: the plugin rewrites the <script> block of the
// raw file, before the Vue compiler runs. A call written directly in markup —
// @click="() => bugboard.minor('…')" — is left alone, because by then its line
// numbers belong to the compiler's output. Move it into <script> for an exact
// location.
