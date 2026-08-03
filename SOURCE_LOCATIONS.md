# Source locations

Every BugBoard card records **the code it is about**: the throw site when you report an error, and
otherwise the place you called from. That ships as `file_name`; the line number is available too,
but off by default — see [line numbers](#line-numbers) for why. This document explains how it all
works, what is on by default, and how to switch every part of it on or off.

- [The short version](#the-short-version)
- [What is on by default](#what-is-on-by-default)
- [Errors report their own throw site](#errors-report-their-own-throw-site)
- [Line numbers](#line-numbers)
- [Why bundling breaks locations](#why-bundling-breaks-locations)
- [The four mechanisms](#the-four-mechanisms)
  - [1. Call-site capture](#1-call-site-capture-on-by-default)
  - [2. Node source maps](#2-node-source-maps-on-by-default)
  - [3. The build plugin](#3-the-build-plugin-opt-in-recommended)
  - [4. Browser map fetching](#4-browser-map-fetching-opt-in)
- [Configuration reference](#configuration-reference)
- [Turning it off](#turning-it-off)
- [Setup by bundler](#setup-by-bundler)
- [Setup by framework](#setup-by-framework)
- [What gets rewritten](#what-gets-rewritten)
- [Privacy and security](#privacy-and-security)
- [Verifying it works](#verifying-it-works)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Tested environments](#tested-environments)

---

## The short version

```ts
bugboard.criticalHigh('Checkout failed', err); // → where `err` was thrown
bugboard.major('Cart total went negative'); // → where you called from
```

**Unbundled** (plain Node, `tsx`, `ts-node`) — correct out of the box, nothing to configure:

```text
file_name: src/checkout/Payment.ts
```

**Bundled** (any production build) — the call stack now only names a chunk:

```text
file_name: assets/index-a3f2b1.js
```

Install the build plugin and it is exact again, in production, with **no source maps generated,
deployed, or uploaded**:

```ts
// vite.config.ts
import bugboard from 'bugboard/vite';
export default { plugins: [bugboard()] };
```

```text
file_name: src/checkout/Payment.ts
```

Then, if you want the line as well — the plugin is what makes it trustworthy:

```ts
createClient({ apiKey: '…', lineNumbers: true });
```

```text
file_name: src/checkout/Payment.ts
line_number: 42
```

---

## What is on by default

| Feature                  | Default | What it does                                                                                                    | Needs setup?                                                |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Error throw sites**    | **On**  | Reads a reported error's own stack, so the card names the failure, not the reporting call.                      | No                                                          |
| **Call-site capture**    | **On**  | Reads the call stack at report time to find your file, sent as `file_name`.                                     | No                                                          |
| **Node source maps**     | **On**  | Switches on Node's own source-map support, so a bundled server resolves to original files.                      | No, but see [the load-order caveat](#the-load-order-caveat) |
| **Build plugin**         | Off     | Writes the real file and line into each call at build time. The only thing that fixes bundled **browser** code. | Yes — add it to your bundler config                         |
| **Line numbers**         | Off     | Adds `line_number` to every card.                                                                               | Yes — `lineNumbers: true`                                   |
| **Browser map fetching** | Off     | Fetches a chunk's `.js.map` at report time.                                                                     | Yes — `sourceMaps: true`                                    |

Three of these are on the moment you install the SDK. None sends anything anywhere, and none
reads your source files. The three that cost something — a bundler plugin, a field that is only
exact once you have one, or network requests — are opt-in.

> **The plugin is not automatic.** Installing `bugboard` does not change your build. If your app
> is bundled and you want real file names, you must add the plugin to your bundler config. This is
> the single most common reason cards still say `index-a3f2b1.js`.

---

## Errors report their own throw site

When the description is an error, the card points at **where that error was thrown**, not at where
you reported it:

```ts
// src/checkout/charge.ts:17
throw new Error('card declined');
```

```ts
// src/server.ts:88
bugboard.criticalHigh(err.message, err);
```

```text
file_name: src/checkout/charge.ts
```

An error already carries a stack, captured at construction, and it stays right however far the
error travelled before anyone looked at it — through awaits, up a promise chain, out to a handler.
The SDK reads that stack instead of taking its own.

### Why this matters most in a global handler

The natural place to report from is one place:

```ts
process.on('uncaughtException', (err) => bugboard.criticalHigh(err.message, err));
```

```ts
app.use((err, _req, res, _next) => {
  bugboard.criticalHigh(err.message, err);
  res.sendStatus(500);
});
```

Your handler is your code, so call-site capture answers it perfectly and uselessly: every error in
the entire application would report the one file the handler lives in. Because `file_name` is part
of how cards are deduplicated, that is not only unhelpful to read — it merges unrelated bugs onto a
single card. Reading the error's own stack is what makes centralised reporting work at all.

### The details

**The root cause wins.** An error that wraps another was constructed where the failure was
_caught_, so its own stack starts at the catcher. The `cause` chain is followed to the end and the
innermost error's throw site is used:

```ts
throw new Error('Checkout failed', { cause: err }); // reports where `err` was thrown
```

**Dependency frames are reported as-is.** If the top frame of the stack is inside `node_modules`,
that is what the card says. It is where the throw happened — the runtime recorded it — whereas
"the first frame that looks like application code" is a guess, and a wrong guess points at innocent
code with an authority it has not earned. (Frames belonging to the runtime itself, `node:internal/…`,
are skipped; they are not files you can open.)

**It outranks the build plugin.** The [plugin](#3-the-build-plugin-opt-in-recommended) knows your
call site exactly, at compile time — but that is still the call site. An error present in the call
wins over it.

**It is part of `captureLocation`.** `captureLocation: false` turns off all location reading,
errors included.

**It obeys the same bundling rules as everything else.** A thrown stack in a production bundle
names a chunk, exactly like a captured one. On Node, [source maps](#2-node-source-maps-on-by-default)
resolve it back to your files, which is the case they were always best at; in a browser it takes
[map fetching](#4-browser-map-fetching-opt-in).

---

## Line numbers

**`line_number` is not sent unless you ask for it.** `file_name` always is.

```ts
createClient({ apiKey: '…', lineNumbers: true });
```

### Why the file ships and the line does not

They are not equally reliable, and they fail in different ways.

This is about the **call site**. A line read off a reported error's stack is not guessed at all —
the runtime recorded it at the throw — so if most of your reporting goes through a global handler,
the argument below applies to less of your board than it looks like.

When the SDK reads the call stack, it gets a list of frames and has to decide which one is yours.
In a bundled app that has no build plugin, **every frame names the same chunk** — your code, the
SDK, and whatever called you were all concatenated into `assets/index-a3f2b1.js`. The file is
therefore right no matter which frame is picked. The line is not: the SDK falls back to picking a
frame by its depth in the stack, which is an educated guess about how many frames sit between the
report and the code that made it. Inlining, wrapping, and minification all move that number.

The same asymmetry shows up without a bundler. If you wrap a reporting method in a helper of your
own:

```ts
// lib/report.ts
export const reportFailure = (msg: string, err: unknown) => bugboard.criticalHigh(msg, err);
```

then the nearest frame is inside `lib/report.ts`, and the line is that helper's line — the same
line for every report in your entire app, however many places call it.

A wrong file name is obviously wrong: you open it and the call is not there. A wrong line number is
not — it is a real line, in the right file, usually within a few lines of the truth. It reads as
authoritative and sends people to the wrong place. That is worse than showing nothing, so the
default is to show nothing.

### When to switch it on

Turn `lineNumbers: true` on when the line is **derived rather than guessed**:

| Situation                                                          | Line is       | Recommended        |
| ------------------------------------------------------------------ | ------------- | ------------------ |
| [Build plugin](#3-the-build-plugin-opt-in-recommended) installed   | Exact         | **Yes, switch on** |
| Reporting errors, unbundled or with maps resolved                  | Exact         | Yes                |
| Unbundled Node (`tsx`, `ts-node`, plain `node`), calls not wrapped | Exact         | Yes                |
| Bundled Node server with maps loaded via `bugboard/preload`        | Exact         | Yes                |
| Bundled, no plugin                                                 | Guessed       | No                 |
| Reporting calls wrapped in your own helper                         | The wrapper's | No                 |

The plugin is the case worth planning for: it writes the location in at compile time, so both
fields are exact, in production, on every platform. If you install it, switch line numbers on in
the same commit.

Note that the plugin rewrites the calls it can see. If some of your reporting happens somewhere it
does not reach — a Vue template expression, a module excluded by `exclude` — those cards fall back
to stack capture and their lines are guesses again. [Verifying it works](#verifying-it-works)
shows how to check, and [what gets rewritten](#what-gets-rewritten) lists the boundaries.

### If you switch it on and then off again

The field simply stops being attached to new reports. Cards already in BugBoard keep the line they
were created with; nothing is rewritten or removed retroactively.

---

## Why bundling breaks locations

The SDK finds your call site by taking a stack trace at the moment you report, and picking the
first frame that is not its own. That frame is exact — until a bundler runs.

A production build concatenates hundreds of modules into a few chunks and strips the newlines. Your
`src/checkout/Payment.ts:42` becomes `assets/index-a3f2b1.js:1:52341`. The original path and line
are not "hidden" — they are **gone**. Nothing at runtime can recover them from that frame alone.

There are only two ways to get them back:

1. **Record them before they are lost** — at build time, while the bundler still knows which file
   it is looking at. This is what the build plugin does, and it needs no source map at all.
2. **Keep a map from the new coordinates back to the old ones** — a source map. Node can read the
   ones already on your disk; a browser would have to fetch them over the network.

The SDK does both, which is why there are several switches rather than one.

---

## The four mechanisms

### 1. Call-site capture (on by default)

Used whenever the report is not about an error — when it is,
[the error's own stack](#errors-report-their-own-throw-site) answers first.

At the moment you call a reporting method, the SDK constructs an `Error`, reads its stack, skips
its own frames, and takes the first frame belonging to you. This is synchronous with your call, so
it works from a `catch`, a `useEffect`, a `setTimeout`, a loop, or top-level code alike.

It is exact whenever your code is not bundled. When it is, it returns the chunk's coordinates
rather than nothing — a partial answer being more useful than none. The line found this way is
the reason [line numbers](#line-numbers) are opt-in; the file name survives either way.

Two kinds of frame are held back so they can never be mistaken for your call site:

- **Node internals** (`node:internal/…`), which sit below your frames — so a report made at module
  top level names your module rather than the ESM loader.
- **Dependencies** (anything under `node_modules`), because libraries call your code. A Vue
  template handler, an Express route, a test case: the library's frame sits between the SDK and
  anything you wrote, and it would otherwise win. Every application frame is exhausted before a
  dependency is considered at all.

**Cost**: one `Error` construction per report. Turn it off with `captureLocation: false`.

### 2. Node source maps (on by default)

When you build a server, your bundler writes `.js.map` files next to the chunks. They are already
on the machine. Node can read them itself and rewrite `error.stack` to name original files — it
just has to be told to.

`createClient()` does that for you. **Nothing is uploaded, nothing is served publicly, and no
source is read by the SDK** — this is a one-line call into the runtime:

```ts
// what the SDK does, in effect — Node 22.14+
process.getBuiltinModule('node:module').setSourceMapsSupport(true, { nodeModules: false });

// Node 20 and 21 don't have setSourceMapsSupport yet, so the SDK falls back to the
// older, broader API instead:
process.setSourceMapsEnabled(true);
```

On Node 22.14+, `nodeModules: false` keeps it narrow: your code is mapped, your dependencies are
not, which avoids reading a map for every package that ships one on every cold start. On Node 20
and 21 — the package's minimum supported version — there's no equivalent knob: the fallback API
maps `node_modules` and `eval`'d code too, not just your own files.

This affects **both** the reported location _and_ the stack text inside a caught error's
`description` — it is the only mechanism that improves the latter. Where it applies, the line is
genuinely resolved rather than guessed, so it is one of the situations in which turning
[line numbers](#line-numbers) on is worthwhile.

#### The load-order caveat

Node caches a module's source map when it **compiles** that module, and only if support was already
on at that moment. A module imported before `createClient()` ran keeps its bundled coordinates
forever.

In practice `createClient()` usually runs after most of your app has loaded. To cover the whole
process, import the preload entry first:

```ts
// the very first line of your server entry, above every other import
import 'bugboard/preload';
```

or, without touching your code:

```bash
node --import bugboard/preload ./dist/server.js
NODE_OPTIONS='--enable-source-maps' node ./dist/server.js
```

You can also call it yourself:

```ts
import { enableSourceMaps } from 'bugboard';

const status = enableSourceMaps(); // 'enabled' | 'already' | 'unsupported'
```

It never re-enables support that is already on, never throws, and returns `'unsupported'` outside
Node (browsers, Deno, Bun and Cloudflare Workers resolve stacks themselves or not at all).

This only helps if your build actually emits maps: `sourcemap: true` for esbuild/tsup/Vite SSR,
`"sourceMap": true` for `tsc`, `sourcemap: { server: true }` for Nitro.

### 3. The build plugin (opt-in, recommended)

Your bundler knows the original file and line of every call while it is transforming the module —
before chunking, before minification. The plugin writes that in as a plain object literal:

```ts
// you write
bugboard.criticalHigh('Checkout failed', err, ['payments']);

// the bundler emits
bugboard.criticalHigh('Checkout failed', err, ['payments'], {
  __bugboardLocation: true,
  file: 'src/checkout/Payment.ts',
  line: 42,
});
```

At runtime the SDK takes that last argument off and uses it, leaving your own arguments in place.
Because it is just a string, it survives minification exactly like any other string.

This is the **only** mechanism that fixes bundled browser code without publishing source maps, and
it is exact rather than best-effort. It also makes reporting marginally cheaper: with a location
supplied, the SDK skips the stack capture entirely.

Available as `bugboard/vite`, `bugboard/rollup`, `bugboard/webpack`, and `bugboard/esbuild`.

### 4. Browser map fetching (opt-in)

If you deploy your `.js.map` files, the SDK can fetch a chunk's map when a report is sent and
resolve the frame from it:

```ts
createClient({ apiKey: '…', sourceMaps: true });
```

It reads the `//# sourceMappingURL` comment from the last kilobyte of the chunk (via a `Range`
request rather than re-downloading the bundle), handles inline `data:` maps, decodes the mappings,
and caches the result per chunk. A build that ships no maps is probed exactly once, then never
again.

The report is **queued first and corrected afterwards**, so a report is never delayed or lost
waiting on the network. If the map arrives before the queue drains, the payload is updated in
place; if not, it ships with its bundled coordinates.

Off by default for two reasons: it only works if you deploy your maps, which **publishes your
source code** to anyone who asks for it; and it costs a network round trip. Prefer the build
plugin, which needs no maps at all.

---

## Configuration reference

### Client options

| Option            | Type      | Default | Effect                                                                        |
| ----------------- | --------- | ------- | ----------------------------------------------------------------------------- |
| `captureLocation` | `boolean` | `true`  | Read a reported error's stack, or the call stack, to locate the report.       |
| `lineNumbers`     | `boolean` | `false` | Send `line_number` as well as `file_name`. See [line numbers](#line-numbers). |
| `sourceMaps`      | `boolean` | _unset_ | See the table below.                                                          |

`lineNumbers` is independent of everything else: it decides whether the line the SDK already has
is put on the wire. It is not implied by `sourceMaps: true` or by installing the plugin, because
both of those resolve locations per module — inferring the option from them would make the field
appear on some cards and not others, which is exactly the inconsistency it exists to avoid.

`sourceMaps` controls two things at once, because they are the same intent in different runtimes:

| `sourceMaps`      | Node's own support | Browser map fetching |
| ----------------- | ------------------ | -------------------- |
| _unset_ (default) | **on**             | off                  |
| `false`           | off                | off                  |
| `true`            | on                 | **on**               |

Browser fetching is only ever enabled by setting `sourceMaps: true` explicitly. It is never turned
on by runtime detection — an edge runtime with Node compatibility enabled looks like Node while
having no maps on disk, and would otherwise make pointless requests on every report.

### Plugin options

Shared by all four plugins:

| Option          | Type       | Default                                  | Purpose                                                         |
| --------------- | ---------- | ---------------------------------------- | --------------------------------------------------------------- |
| `root`          | `string`   | the bundler's root, else `process.cwd()` | Paths are reported relative to this.                            |
| `clientModules` | `string[]` | `[]`                                     | Extra modules that export a configured client.                  |
| `loose`         | `boolean`  | `false`                                  | Rewrite any matching method call without checking the receiver. |
| `debug`         | `boolean`  | `false`                                  | Log every file considered and what happened to it.              |

Vite / Rollup / webpack also accept:

| Option    | Type     | Default                                  |
| --------- | -------- | ---------------------------------------- |
| `include` | `RegExp` | `/\.([cm]?[jt]sx?\|vue\|svelte)(\?\|$)/` |
| `exclude` | `RegExp` | `/[\\/]node_modules[\\/]/`               |

esbuild uses `filter` instead of `include` (esbuild requires the filter at registration time):

| Option    | Type     | Default                            |
| --------- | -------- | ---------------------------------- |
| `filter`  | `RegExp` | `/\.([cm]?[jt]sx?\|vue\|svelte)$/` |
| `exclude` | `RegExp` | `/[\\/]node_modules[\\/]/`         |

---

## Turning it off

**Everything off** — no stack reads, no runtime mutation, no network:

```ts
createClient({ apiKey: '…', captureLocation: false, sourceMaps: false });
```

Cards will then carry no `file_name` or `line_number` — **unless a build plugin is installed**.
`captureLocation` gates the two mechanisms that read a stack at runtime (error throw sites and
call-site capture); it does not gate a location the plugin wrote into the call at compile time,
because by then there is nothing left to switch off. To drop those too, remove the plugin from
your bundler config — see the row below.

**Individually:**

| To disable              | Do this                                          |
| ----------------------- | ------------------------------------------------ |
| Call-site capture       | `captureLocation: false`                         |
| Error throw sites       | `captureLocation: false` (same switch)           |
| Line numbers            | Leave `lineNumbers` unset (it is off by default) |
| Node source-map support | `sourceMaps: false`                              |
| Browser map fetching    | Leave `sourceMaps` unset (it is off by default)  |
| The build plugin        | Remove it from your bundler config               |

Turning line numbers off keeps the file name: `lineNumbers: false` drops one field, whereas
`captureLocation: false` stops the SDK reading the stack at all — which drops both, on any report
whose location would have come from a stack.

**To strip locations from reports that are already built**, without changing any of the above:

```ts
createClient({
  apiKey: '…',
  beforeSend: ({ file_name: _f, line_number: _l, ...rest }) => rest,
});
```

**A note on the default-on Node behaviour.** `sourceMaps` defaults to on, and switching Node's
source-map support on is a change to global process state: it affects how `error.stack` is
rendered everywhere in your process, not just inside the SDK. It makes stacks strictly more
accurate, it is the same thing `--enable-source-maps` does, and the SDK never re-enables support
you already configured. If you would rather own that setting yourself, set `sourceMaps: false` and
pass `--enable-source-maps` when you want it.

---

## Setup by bundler

### Vite / Rollup

```ts
// vite.config.ts
import bugboard from 'bugboard/vite'; // 'bugboard/rollup' is the same plugin

export default {
  plugins: [bugboard()],
};
```

Runs with `enforce: 'pre'` so it sees your source before any other transform.

### webpack

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        exclude: /node_modules/,
        enforce: 'pre', // must precede Babel/SWC, while line numbers are original
        use: 'bugboard/webpack',
      },
    ],
  },
};
```

### esbuild

```js
import * as esbuild from 'esbuild';
import bugboard from 'bugboard/esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  plugins: [bugboard()],
});
```

### Turbopack

Turbopack runs webpack loaders. Note there is **no `as` field** — Turbopack appends it to the
filename, so `as: '*.tsx'` sends the build looking for `page.tsx.tsx`:

```js
// next.config.js
module.exports = {
  turbopack: {
    rules: {
      '*.ts': { loaders: ['bugboard/webpack'] },
      '*.tsx': { loaders: ['bugboard/webpack'] },
    },
  },
};
```

---

## Setup by framework

| Framework                         | Build plugin                                                                | Also do this                                                       |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Vite SPA** (React, Vue, Svelte) | `bugboard/vite`                                                             | —                                                                  |
| **SvelteKit**                     | `bugboard/vite`                                                             | `import 'bugboard/preload'` in `hooks.server.ts` on `adapter-node` |
| **Nuxt**                          | `bugboard/vite` **twice** — see below                                       | `nitro: { sourceMap: true }`                                       |
| **Remix / React Router**          | `bugboard/vite`                                                             | `import 'bugboard/preload'` in `entry.server.tsx`                  |
| **Next.js**                       | `bugboard/webpack` via `turbopack.rules` (Next 16) or `webpack()` (Next 15) | — see [limitations](#known-limitations)                            |
| **NestJS**                        | none needed with `tsc`                                                      | `import 'bugboard/preload'` as line 1 of `main.ts`                 |
| **Express / Fastify / Koa**       | `bugboard/esbuild` if you bundle                                            | `import 'bugboard/preload'` if you bundle                          |
| **AWS Lambda**                    | `bugboard/esbuild`                                                          | —                                                                  |
| **Cloudflare Workers**            | pre-bundle with `bugboard/esbuild`, point `main` at the output              | Wrangler accepts no plugins                                        |
| **Vercel Edge / Deno / Bun**      | `bugboard/esbuild` via your bundler                                         | —                                                                  |

**Nuxt needs the plugin registered twice.** Nitro builds `server/` with its own Rollup pipeline
that never sees `vite.plugins`, so server routes are missed otherwise:

```ts
// nuxt.config.ts
import bugboard from 'bugboard/vite';

export default defineNuxtConfig({
  vite: { plugins: [bugboard()] },
  nitro: { sourceMap: true, rollupConfig: { plugins: [bugboard()] } },
});
```

---

## What gets rewritten

The plugin only rewrites calls it can prove are yours. Appending an argument to somebody else's
function would corrupt it, so the bar is deliberately high.

**A receiver qualifies if** it is:

- assigned from `createClient()` in the same module — `const bugboard = createClient({…})`;
- imported from `bugboard` itself;
- imported from a module whose path mentions `bugboard` — `@/lib/bugboard`, `./bugboard.client`;
- imported from a module you listed in `clientModules`.

**The method name must be** one of the 16 reporting methods (`critical`, `criticalHigh`,
`minorLow`, …).

**File types.** JavaScript and TypeScript including JSX and TSX, plus Vue and Svelte single-file
components. In an SFC the `<script>` block of the raw `.vue`/`.svelte` file is rewritten — before
the framework compiler runs, which is the only moment the file still carries the line numbers you
wrote. The compiler's own output (`App.vue?vue&type=script&…`) is explicitly skipped, because its
lines are the compiler's, not yours.

**Not rewritten:**

- Calls in `node_modules` (by default).
- Calls written directly in **markup** — a Vue `@click="() => bugboard.minor('…')"`. Move the
  handler into `<script>` for an exact location. Left in markup, it falls back to runtime capture
  and reports the **chunk** the component was bundled into — `dist/app.js:545` — never the
  framework that invoked the handler.
- Calls through a helper of your own. If you wrap the SDK (`report(err)` calling
  `bugboard.critical(err)`), the plugin sees only the helper, and every card points at the helper.
  Put the helper in a module named for `bugboard`, or list it in `clientModules`, so the wrapper's
  own line is recorded.
- Argumentless calls — `bugboard.critical()` has no title, and appending would silently make the
  location the title.

`loose: true` widens matching to any receiver with a matching method name. Use it only if the
rules above cannot reach your call sites, and be aware it can rewrite an unrelated call.

If the plugin cannot parse a file, it leaves it exactly as found. A build plugin that mangles
source is far worse than one that misses a location.

---

## Privacy and security

- **Nothing is uploaded.** No source maps, no source files, no build artifacts. The build plugin
  writes a path and a line number into your own bundle; Node's support reads maps already on your
  own disk.
- **The SDK never reads your source files at runtime.** It reads its own stack trace, which is a
  string the runtime already produced.
- **What leaves your app** is the file path, as `file_name` — plus the line as `line_number` if
  you switched [line numbers](#line-numbers) on.
- **The paths in your bundle** are project-relative (`src/checkout/Payment.ts`), not absolute, so
  no machine or user directory is disclosed.
- **Browser map fetching is the one exception.** It only works if you deploy your `.js.map` files,
  which makes your original source readable by anyone who requests them. That is why it is off by
  default and why the build plugin is the better answer.

---

## Verifying it works

**Check the build output** — the location is a plain literal, so you can grep for it:

```bash
grep -ro '__bugboardLocation[^}]*}' dist | sort -u
# {__bugboardLocation:!0,file:"src/checkout/Payment.ts",line:42}
```

**Ask the plugin what it did:**

```ts
bugboard({ debug: true });
```

```text
[bugboard] rewrote 2 call(s) in src/checkout/Payment.ts
[bugboard] no calls rewritten in src/lib/bugboard.ts
[bugboard] skipped src/styles.css
```

**Check Node's support at runtime:**

```ts
console.log(process.sourceMapsEnabled); // true once enabled
```

**Turn on SDK logging** to see the status it resolved:

```ts
createClient({ apiKey: '…', debug: true });
// [bugboard] Node source maps: enabled.
```

**Before switching line numbers on**, confirm the plugin reached everywhere you report from. The
grep above lists every call it rewrote; anything missing from that list will fall back to a guessed
line. `debug: true` on the plugin names the modules it looked at and skipped.

---

## Troubleshooting

**Cards say `assets/index-a3f2b1.js`.** The build plugin is not installed, or not running on that
file. Add it, then confirm with `debug: true`.

**Cards have no `file_name` at all.** Either `captureLocation: false` is set, `beforeSend` is
stripping it, or the stack was unreadable. Check `debug` output.

**Cards have no `line_number`.** That is the default. Set `lineNumbers: true` — and read
[line numbers](#line-numbers) first, because without the build plugin the value you get back is a
guess.

**The plugin isn't rewriting my calls.** Run with `debug: true`. If your module is listed as
"no calls rewritten", the receiver wasn't recognised — name your client module in `clientModules`,
or see [what gets rewritten](#what-gets-rewritten).

**Every card points at my own helper function.** Expected for reports that carry no error — the
plugin records where `bugboard.critical()` is written, which is inside your helper. See the wrapper
note above. Pass the error as the description and the card points at the throw site instead.

**A card points somewhere I did not report from.** If you passed an error, that is
[the throw site](#errors-report-their-own-throw-site) — including its `cause` chain's, and
including `node_modules` when that is genuinely where it was thrown.

**A Vue/Svelte component reports nothing.** The call is probably in markup rather than in
`<script>`. Move it into `<script>`.

**Next 16 build fails with "using Turbopack, with a `webpack` config".** Use the `turbopack.rules`
form, or run `next build --webpack`.

**A Turbopack build looks for `page.tsx.tsx`.** Remove the `as` field from your `turbopack.rules`.

**Server stacks are still minified after adding `bugboard/preload`.** Check that the import is
genuinely first, and that your build emits server source maps. On Next.js this is expected — see
below.

**TypeScript can't find `bugboard/preload`.** You are probably using `npm link` or a symlinked
install; TypeScript does not resolve package subpaths through those. Install normally, or from a
tarball.

---

## Known limitations

**Line numbers are opt-in.** `file_name` ships by default; `line_number` does not, because outside
a plugin build the SDK infers it from frame depth rather than deriving it. See
[line numbers](#line-numbers).

**Next.js server stack text.** The reported location is exact, but the stack inside a caught
error's `description` stays minified. Next installs its own `Error.prepareStackTrace`
(`next/dist/server/patch-error-inspect.js`) to power its error overlay, which replaces the
formatter that Node applies source maps in. Verified: neither `bugboard/preload`, nor
`NODE_OPTIONS=--enable-source-maps`, nor `experimental.serverSourceMaps` changes it.

**Vue/Svelte markup expressions.** The plugin rewrites `<script>` blocks, not markup, so a call
written inline in a template falls back to stack capture and names the chunk rather than your
component. Move it into `<script>` to get the real file.

**A caught error's stack in the browser.** The reported location comes from the error's own stack,
so it is the throw site — but in a bundled browser build those coordinates name a chunk, and the
build plugin cannot help: it rewrites reporting calls, and a throw is not one. Only browser map
fetching improves a thrown stack there, and only if you deploy your maps. On Node, source maps
cover it with no extra setup.

**Turbopack.** Loader support is what makes this work; if a future Next version drops it, the
client half falls back to chunk coordinates.

---

## Tested environments

Every one of these was built and run end to end, checking the delivered payload:

|                                  | Build-time location | Runtime delivery |
| -------------------------------- | ------------------- | ---------------- |
| Vite + React / Vue / Svelte      | ✅                  | ✅               |
| SvelteKit (client + server)      | ✅                  | ✅               |
| Nuxt (client + Nitro server)     | ✅                  | ✅               |
| Remix / React Router             | ✅                  | ✅               |
| Next.js 16 (Turbopack + webpack) | ✅                  | ✅               |
| Express / Fastify / Koa          | ✅                  | ✅               |
| NestJS                           | n/a (`tsc`)         | ✅ with preload  |
| AWS Lambda (esbuild)             | ✅                  | ✅               |
| Cloudflare Workers (workerd)     | ✅                  | ✅               |
| Vercel Edge runtime              | ✅                  | ✅               |
| Deno                             | n/a                 | ✅               |
| Bun                              | n/a                 | ✅               |
| CLI scripts                      | ✅                  | ✅               |

---

## See also

- [README](README.md) — quick start
- [docs/USAGE.md](docs/USAGE.md) — the full usage guide
- [CHANGELOG](CHANGELOG.md)
