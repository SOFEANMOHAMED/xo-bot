module.exports = {
  apps: [{
    name: 'xobot-backend',
    script: 'dist/index.js',
    cwd: '/root/xobot/backend',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 50,
    min_uptime: '10s',
    restart_delay: 5000,
    max_memory_restart: '500M',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    merge_logs: true,
    time: true,
  }],
};
