# Real file names and line numbers in bundled apps

Every card records the code it is about — a reported error's throw site, otherwise where you
called from. Unbundled, that is exact with no setup. Once a bundler runs, the stack only names a
chunk:

```
file_name: assets/index-a3f2b1.js      ← what you get without the plugin
file_name: src/checkout/Payment.ts     ← what you get with it
```

The fix is a build plugin that writes the real location into each call at compile time. **No source
maps are generated, deployed, or uploaded.** Pick the file matching your bundler:

| File | For |
| --- | --- |
| [`vite.config.ts`](./vite.config.ts) | Vite, Rollup — and so SvelteKit, Remix/React Router, Vue, Svelte |
| [`webpack.config.js`](./webpack.config.js) | webpack |
| [`esbuild.build.mjs`](./esbuild.build.mjs) | esbuild — and so Lambda, Wrangler, SST |
| [`next.config.js`](./next.config.js) | Next.js (Turbopack and webpack) |
| [`nuxt.config.ts`](./nuxt.config.ts) | Nuxt — needs registering **twice** |
| [`server-entry.ts`](./server-entry.ts) | Any bundled Node server: `bugboard/preload` |

## What is on by default, and what is not

Installing the SDK already gives you two things, with no configuration and nothing uploaded:

- **Call-site capture** — the stack read that produces `file_name`.
- **Node source maps** — Node's own support, switched on so a bundled server resolves to your
  files. Note it changes global `error.stack` rendering for the process, exactly as
  `--enable-source-maps` does.

Turn either off with `captureLocation: false` / `sourceMaps: false`.

**The build plugin is not automatic.** Installing `bugboard` does not touch your build — that is
what these files are for.

**Line numbers are not sent by default.** The file name holds up under bundling; the line does
not, because without the plugin the SDK has to guess which stack frame is yours. Once you have
added one of these config files, the line is written in at compile time and you can switch it on:

```ts
createClient({ apiKey: '…', lineNumbers: true });
// file_name: src/checkout/Payment.ts
// line_number: 42
```

Full reasoning in [SOURCE_LOCATIONS.md](../../SOURCE_LOCATIONS.md#line-numbers).

## Verify it worked

The location is a plain literal in your bundle, so grep for it:

```bash
grep -ro '__bugboardLocation[^}]*}' dist | sort -u
# {__bugboardLocation:!0,file:"src/checkout/Payment.ts",line:42}
```

Or ask the plugin what it did:

```ts
bugboard({ debug: true });
// [bugboard] rewrote 2 call(s) in src/checkout/Payment.ts
```

Full reference: [`../../SOURCE_LOCATIONS.md`](../../SOURCE_LOCATIONS.md).
