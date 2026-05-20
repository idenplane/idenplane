/**
 * Example Event Logger Plugin
 *
 * An EventListenerPlugin that logs all subscribed auth events to the console.
 * This plugin demonstrates the plugin system's event-listener extension point.
 */

/** @type {import('../../src/plugins/plugin.interface').EventListenerPlugin} */
const plugin = {
  name: 'example-event-logger',
  version: '1.0.0',
  description: 'Logs all authentication events to stdout for debugging and auditing.',
  type: 'event-listener',

  /** Subscribe to all events by using the wildcard '*'. */
  subscribedEvents: ['*'],

  async onInstall(context) {
    context.logger.log('example-event-logger installed.');
  },

  async onEnable(context) {
    context.logger.log('example-event-logger enabled — listening for all auth events.');
  },

  async onDisable(context) {
    context.logger.log('example-event-logger disabled.');
  },

  async onUninstall(context) {
    context.logger.log('example-event-logger uninstalled.');
  },

  /**
   * Called for each event matching the subscribedEvents list.
   * @param {import('../../src/plugins/plugin.interface').PluginEvent} event
   */
  async onEvent(event) {
    const { type, timestamp, realmId, userId, clientId, ipAddress, error, details } = event;

    const parts = [
      `[Idenplane Event] type=${type}`,
      `ts=${timestamp}`,
      realmId ? `realm=${realmId}` : null,
      userId ? `user=${userId}` : null,
      clientId ? `client=${clientId}` : null,
      ipAddress ? `ip=${ipAddress}` : null,
      error ? `error=${error}` : null,
      details ? `details=${JSON.stringify(details)}` : null,
    ].filter(Boolean);

    // In a real plugin this could write to a file, external log aggregator, etc.
    console.log(parts.join(' '));
  },
};

module.exports = plugin;
module.exports.default = plugin;
module.exports.plugin = plugin;
