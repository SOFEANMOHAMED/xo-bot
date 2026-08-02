import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'xobot_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

import { logger } from '../utils/logger.js';

// Test connection
pool.on('connect', () => {
  logger.info('Database connected successfully');
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  logger.error('Database connection error', err);
  console.error('❌ Database connection error:', err);
});

export default pool;

