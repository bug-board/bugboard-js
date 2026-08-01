// Any bundled Node server: Express, Fastify, Koa, NestJS, a Lambda handler.
//
// The `.js.map` files your build wrote sit next to the chunks on disk. Node can
// read them itself — nothing is uploaded and nothing is served publicly. This
// import switches that on.
//
// It MUST come first. Node caches a module's source map when it compiles that
// module, and only if support was already on at that moment, so anything
// imported above this line keeps its bundled coordinates. createClient() enables
// it too, but by then most of your app is already loaded.
import 'bugboard/preload';

// …now everything else.
import express from 'express';
import bugboard from './lib/bugboard';

const app = express();

app.get('/checkout', (_req, res) => {
    try {
        throw new Error('checkout exploded');
    } catch (err) {
        // Reports `src/routes/checkout.ts:N` rather than `dist/server.js:1`,
        // and the stack inside the description names your files too.
        bugboard.criticalHigh('Checkout failed', err, ['payments']);
        res.status(500).end();
    }
});

app.listen(3000);

// Equivalents that need no code change:
//
//   node --import bugboard/preload ./dist/server.js
//   NODE_OPTIONS='--enable-source-maps' node ./dist/server.js
//
// Or call it yourself, e.g. to log what happened:
//
//   import { enableSourceMaps } from 'bugboard';
//   enableSourceMaps(); // 'enabled' | 'already' | 'unsupported'
//
// This only helps if your build emits maps: `sourcemap: true` for
// esbuild/tsup/Vite SSR, `"sourceMap": true` for tsc.
