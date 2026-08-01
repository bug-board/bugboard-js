// webpack — shipped as a loader, so webpack resolves it by package name.
//
// `enforce: 'pre'` matters: it puts this ahead of Babel and SWC, while the
// source still has the line numbers you wrote.
module.exports = {
    module: {
        rules: [
            {
                test: /\.[cm]?[jt]sx?$/,
                exclude: /node_modules/,
                enforce: 'pre',
                use: {
                    loader: 'bugboard/webpack',
                    // Options are optional and match the Vite plugin's.
                    options: { clientModules: ['@/lib/telemetry'] },
                },
            },
        ],
    },
};
