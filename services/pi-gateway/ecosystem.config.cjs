module.exports = {
  apps: [
    {
      name: "pi-gateway-buffett-tribe",
      script: "node_modules/.bin/tsx",
      args: "--env-file=.env src/server.ts",
      cwd: __dirname,
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
