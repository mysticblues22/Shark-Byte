module.exports = {
  apps: [
    {
      name: "shark-byte",
      script: "dist/index.js",
      cwd: "/home/mysticadmin/Shark-Byte",
      env: {
        NODE_ENV: "production",
      },
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      time: true,
    },
  ],
};
