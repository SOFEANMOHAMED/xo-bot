import pino from 'pino';

/** Baileys is noisy; keep protocol logs out of production app logs. */
export const baileysLogger = pino({ level: 'silent' });
