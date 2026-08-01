// Next.js.
//
// Next 16 uses Turbopack by default, and a `webpack` key with no `turbopack` key
// is a hard build error there. Use the Turbopack form unless you pass
// `next build --webpack`.
module.exports = {
    turbopack: {
        rules: {
            // No `as` field. Turbopack appends it to the filename, so
            // `as: '*.tsx'` makes the build look for `page.tsx.tsx` and fail.
            '*.ts': { loaders: ['bugboard/webpack'] },
            '*.tsx': { loaders: ['bugboard/webpack'] },
        },
    },
};

// Next 15, or `next build --webpack`:
//
// module.exports = {
//   webpack(config) {
//     config.module.rules.push({
//       test: /\.[cm]?[jt]sx?$/,
//       exclude: /node_modules/,
//       enforce: 'pre',
//       use: 'bugboard/webpack',
//     });
//     return config;
//   },
// };
//
// Note: on Next, the reported location becomes exact, but the stack inside a
// caught error's description stays minified. Next installs its own
// Error.prepareStackTrace for its error overlay, which replaces the formatter
// Node applies source maps in — so `bugboard/preload` cannot help there.
//
// With this plugin in place the line is exact too, so this is the point at
// which `lineNumbers: true` in your client config is worth adding.
