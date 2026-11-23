import 'dotenv/config';
import { Sequelize } from 'sequelize';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const useSSL = process.env.DB_SSL === 'true' || (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false');

const dialectOptions = useSSL
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    }
  : {};

export const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      timezone: 'Asia/Kolkata',
      dialectOptions,
    })
  : new Sequelize(
      requireEnv('DB_NAME'),
      requireEnv('DB_USER'),
      requireEnv('DB_PASSWORD'),
      {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        dialect: 'postgres',
        logging: false,
        timezone: 'Asia/Kolkata',
        dialectOptions,
      }
    );

export async function connectDB(): Promise<void> {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL connected successfully!');
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Database connection failed:', message);
    throw error;
  }
}

