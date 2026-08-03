import { IdenplaneClient } from 'idenplane-sdk';
import { config } from './config.js';

const client = new IdenplaneClient(config);

const success = await client.handleCallback();
window.location.href = success ? './index.html' : './index.html?error=login_failed';
