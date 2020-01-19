/* jshint esversion: 6 */

/*
minnie-janus - Minimal and modern JavaScript interface for the Janus WebRTC gateway

Copyright 2018 Michael Karl Franzl

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/


/**
 * The base behavior of a plugin: Attach/detach and send/receive
 * messages to/from the server-side plugin.
 *
 * This behavior is supposed to be 'subclassed', and some of the methods
 * overridden, because every janus plugin is different.
 *
 * This is intentionally not implemented as a class or a function
 * (constructor-prototype combination) . Rather, properties, methods and an
 * initializer/constructor are exported explicitly as plain objects for maximum
 * flexibility regarding different JS ways of
 * inheriting/subclassing/extending/mixing.
 *
 * See `/demo/echotest-plugin.js` for usage.
 *
 * @typedef {Object} BasePlugin
 */

import EventEmitter from '@michaelfranzl/captain-hook';

const properties = {
  session: null, // an instance of Session (see `session.js`)
  id: null, // on the server, this is called the 'handle'
  name: 'unset', // the plugin name string in the C source code
  label: 'unset', // just used for shorter debugging
  attached: false,
};

const methods = {
  /**
   * Attach the server-side plugin (identified by `this.name`) to the session.
   *
   * The method `this.onAttached()` will be called.
   *
   * The event 'attached' will be emitted additionally for potential subscribers.
   *
   * @param {Session} - A Session instance (see `session.js`)
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async attach(session) {
    this.logger.debug('attach()');

    this.session = session;

    const msg = {
      janus: 'attach',
      plugin: this.name,
    };

    const response = await this.session.send(msg);

    this.id = response.data.id;
    this.attached = true;
    this.onAttached();
    this.emit('attached');

    return response;
  },

  /**
   * @abstract
   */
  onAttached() {
    this.logger.debug('onAttached() abstract method called');
  },

  /**
   * @abstract
   */
  onDetached() {
    this.logger.debug('onDetached() abstract method called');
  },

  /**
   * Detach this plugin from the session.
   *
   * The method `this.onDetached()` will be called.
   *
   * The event 'detached' will be emitted additionally.
   *
   * Janus will also push an event `janus: 'detached'`.
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async detach() {
    this.logger.debug('detach()');
    await this.send({ janus: 'detach' });

    this.attached = false;
    this.onDetached();
    this.emit('detached');
  },

  /**
   * Send a plugin-related message to the janus core.
   *
   * You should prefer the higher-level methods
   * `sendMessage(), sendTrickle(), attach(), detach(), hangup()`
   *
   * @param {Object} obj - Should be JSON-serializable. Excpected to have a key
   * called 'janus' with one of the following values:
   * 'attach|detach|message|trickle|hangup'
   * @see {@link https://janus.conf.meetecho.com/docs/rest.html}
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async send(obj) {
    this.logger.debug('send()');
    return this.session.send({ ...obj, handle_id: this.id });
  },

  /**
   * Send a message to the server-side plugin.
   *
   * Janus will call the plugin C function `.handle_message` with the provided
   * arguments.
   *
   * @param {Object} body - Should be JSON-serializable. Janus expects this. Will be
   * provided to the `.handle_message` C function as `json_t *message`.
   * @param {Object} [jsep] - Should be JSON-serializable. Will be provided to the
   * `.handle_message` C function as `json_t *jsep`.
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async sendMessage(body = {}, jsep) {
    const msg = {
      janus: 'message',
      body, // required. 3rd argument in the server-side .handle_message() function
    };
    if (jsep) msg.jsep = jsep; // 'jsep' is a recognized key by Janus. 4th arg in .handle_message().
    this.log.debug('sendMessage()');
    return this.send(msg);
  },

  /**
   * Alias for `sendMessage({}, jsep)`
   *
   * @param {Object} jsep - Should be JSON-serializable. Will be provided to the
   * `.handle_message` C function as `json_t *jsep`.
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async sendJsep(jsep) {
    this.log.debug('sendJsep()');
    return this.sendMessage({}, jsep);
  },

  /**
   * Send trickle ICE candidates to the janus core, related to this plugin.
   *
   * @param {[Object|Array|null]} candidate - Should be JSON-serializable.
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async sendTrickle(candidate) {
    this.log.debug('sendTrickle()');
    return this.send({ janus: 'trickle', candidate });
  },

  /**
   * Hangup the WebRTC peer connection, but keep the plugin attached.
   *
   * @returns {Promise} - Rejected if synchronous reply contains `janus: 'error'` or response
   * takes too long. Resolved otherwise.
   */
  async hangup() {
    this.log.debug('hangup()');
    return this.send({ janus: 'hangup' });
  },

  /**
   * Receive an asynchronous (pushed) message sent by the Janus core.
   *
   * Such messages have a 'sender' key and usually contain
   * `janus: 'event|media|webrtcup|slowlink|hangup'`
   *
   * The parent Session is responsible for dispatching such messages here.
   * (see session.js).
   *
   * This method always contains plugin-specific logic and should be overridden.
   *
   * @abstract
   * @param {Object} msg - Object parsed from server-side JSON
   */
  async receive(msg) {
    this.log.debug(`Abstract method 'receive' called with message ${msg}`);
  },
};


/**
 * Constructor/initializer for this plugin.
 *
 * We only keep track of uptime.
 */
function init({
  logger = {
    info() {},
    warn() {},
    debug() {},
    error() {},
  },
} = {}) {
  /**
   * @member {Object}
   * @property {Function} info - Called for log level 'info'
   * @property {Function} warn - Called for log level 'warn'
   * @property {Function} debug - Called for log level 'debug'
   * @property {Function} error - Called for log level 'error'
   */
  this.logger = logger;
}

Object.assign(methods, EventEmitter({ emit_prop: 'emit' }));

export default {
  properties, methods, init,
};
