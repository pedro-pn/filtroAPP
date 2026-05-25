import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLIENT_PRIVACY_NOTICE_VERSION,
  clientPrivacyConsentRequired,
  isClientPrivacyConsentAllowedRoute
} from '../src/lib/privacy-consent.js';

function req(method, originalUrl) {
  return { method, originalUrl };
}

test('client privacy consent gate is not required after accepting the current version', () => {
  assert.equal(
    clientPrivacyConsentRequired({
      accountType: 'CLIENT',
      role: 'CLIENT',
      privacyPolicyVersion: CLIENT_PRIVACY_NOTICE_VERSION
    }),
    false
  );
});

test('client privacy consent gate remains required for stale or missing acceptance', () => {
  assert.equal(clientPrivacyConsentRequired({ accountType: 'CLIENT', role: 'CLIENT' }), true);
  assert.equal(
    clientPrivacyConsentRequired({
      accountType: 'CLIENT',
      role: 'CLIENT',
      privacyPolicyVersion: 'client_account_privacy_v0'
    }),
    true
  );
});

test('client privacy consent gate allows required session and account rights endpoints', () => {
  assert.equal(isClientPrivacyConsentAllowedRoute(req('GET', '/api/auth/me')), true);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('POST', '/api/auth/logout')), true);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('POST', '/api/auth/client-privacy-consent')), true);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('GET', '/api/privacy/me/data-export')), true);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('POST', '/api/privacy/me/delete-request')), true);
});

test('client privacy consent gate still blocks unrelated authenticated endpoints', () => {
  assert.equal(isClientPrivacyConsentAllowedRoute(req('GET', '/api/account')), false);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('POST', '/api/privacy/me/data-export')), false);
  assert.equal(isClientPrivacyConsentAllowedRoute(req('GET', '/api/privacy/me/delete-request')), false);
});
