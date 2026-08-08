#!/usr/bin/env node
// One-off script to generate a PBKDF2 password hash for Cloudflare Worker secrets.
// Usage: node scripts/generate-password-hash.mjs (secure prompt)
// For disposable local/test passwords only: node scripts/generate-password-hash.mjs "password"
// Store the output with: wrangler secret put PASSWORD_HASH

import { pbkdf2Sync, randomBytes } from 'node:crypto';

async function promptHidden(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('A TTY is required for the secure password prompt.');
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    let finished = false;
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const signalHandlers = new Map();
    const finish = () => {
      if (finished) return;
      finished = true;
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('error', onError);
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
      process.stdout.write('\n');
    };
    const onError = (error) => {
      finish();
      reject(error);
    };
    for (const signal of signals) {
      signalHandlers.set(signal, () => {
        finish();
        process.kill(process.pid, signal);
      });
    }
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          finish();
          process.kill(process.pid, 'SIGINT');
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    process.stdin.on('data', onData);
    process.stdin.on('error', onError);
    for (const [signal, handler] of signalHandlers) {
      process.once(signal, handler);
    }
  });
}

const password = process.argv[2] ?? await promptHidden('Password: ');
if (!password) throw new Error('Password must not be empty.');

const iterations = 210_000;
const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, iterations, 32, 'sha256');

function b64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

console.log(`pbkdf2$sha256$${iterations}$${b64Url(salt)}$${b64Url(derived)}`);
