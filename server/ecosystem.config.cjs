// PM2 process manifest — used in production on the VPS.
// Run with:  pm2 start ecosystem.config.cjs
module.exports = {
    apps: [
        {
            name: 'silvia-server',
            script: './src/index.js',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            max_memory_restart: '300M',
            env: {
                NODE_ENV: 'production',
            },
            error_file: './.pm2/error.log',
            out_file: './.pm2/out.log',
            time: true,
        },
    ],
};
