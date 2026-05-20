/**
 * Example Token Enrichment Plugin
 *
 * A TokenEnrichmentPlugin that adds custom claims to access tokens.
 * This plugin demonstrates how to extend tokens with additional metadata.
 */

/** @type {import('../../src/plugins/plugin.interface').TokenEnrichmentPlugin} */
const plugin = {
  name: 'example-token-enrichment',
  version: '1.0.0',
  description: 'Adds custom claims (app_version, env) to access tokens.',
  type: 'token-enrichment',

  async onInstall(context) {
    context.logger.log('example-token-enrichment installed.');
  },

  async onEnable(context) {
    context.logger.log('example-token-enrichment enabled — will enrich tokens with custom claims.');
  },

  async onDisable(context) {
    context.logger.log('example-token-enrichment disabled.');
  },

  async onUninstall(context) {
    context.logger.log('example-token-enrichment uninstalled.');
  },

  /**
   * Called during access token generation after the core claims are built.
   *
   * @param {Record<string, unknown>} token  The current token payload.
   * @param {any} user  The user object from the database.
   * @param {string} realm  The realm name.
   * @returns {Promise<Record<string, unknown>>} The enriched token payload.
   */
  async enrichToken(token, user, realm) {
    return {
      ...token,
      // Custom claims added by this plugin
      app_version: '1.0.0',
      platform: 'idenplane',
      enriched_at: new Date().toISOString(),
      // Example: attach a flag from the user object if available
      ...(user && user.emailVerified === true ? { email_verified_by_plugin: true } : {}),
    };
  },
};

module.exports = plugin;
module.exports.default = plugin;
module.exports.plugin = plugin;
