import { IdenplaneClient } from 'idenplane-sdk';
import { config } from './config.js';

const client = new IdenplaneClient(config);

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authenticatedView = document.getElementById('authenticated-view');
const profile = document.getElementById('profile');

function render() {
  const authed = client.isAuthenticated();
  loginBtn.hidden = authed;
  logoutBtn.hidden = !authed;
  authenticatedView.hidden = !authed;
  if (authed) {
    profile.textContent = JSON.stringify(client.getUserInfo(), null, 2);
  }
}

loginBtn.addEventListener('click', () => client.login());
logoutBtn.addEventListener('click', () => client.logout());

// Restores an existing session (if any) from storage before the first render.
await client.init();
render();
