// Gives cards real file names — app/api/checkout/route.ts:42 instead of
// .next/server/chunks/456.js:1 — by writing the location into each reporting
// call at build time. No source maps are generated, deployed, or uploaded.
//
// Next 16 uses Turbopack by default, and a `webpack` key with no `turbopack` key
// is a hard build error there.
module.exports = {
    turbopack: {
        rules: {
            // No `as` field: Turbopack appends it to the filename, so
            // `as: '*.tsx'` makes the build look for `page.tsx.tsx`.
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
