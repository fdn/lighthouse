/**
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const Runner = require('../runner');
const driverMock = require('./gather/fake-driver');
const Config = require('../config/config');
const Audit = require('../audits/audit');
const assert = require('assert');
const path = require('path');
const computedArtifacts = require('../gather/gather-runner').instantiateComputedArtifacts();

/* eslint-env mocha */

describe('Runner', () => {
  it('expands gatherers', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        gatherers: ['https']
      }],
      audits: [
        'is-on-https'
      ]
    });

    return Runner.run(null, {url, config, driverMock}).then(_ => {
      assert.ok(typeof config.passes[0].gatherers[0] === 'object');
    });
  });

  it('rejects when given neither passes nor artifacts', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'is-on-https'
      ]
    });

    return Runner.run(null, {url, config, driverMock})
      .then(_ => {
        assert.ok(false);
      }, err => {
        assert.ok(/The config must provide passes/.test(err.message));
      });
  });

  it('accepts existing artifacts', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'is-on-https'
      ],

      artifacts: {
        HTTPS: {
          value: true
        }
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      // Mostly checking that this did not throw, but check representative values.
      assert.equal(results.initialUrl, url);
      assert.strictEqual(results.audits['is-on-https'].rawValue, true);
    });
  });

  it('accepts trace artifacts as paths and outputs appropriate data', () => {
    const url = 'https://example.com';

    const config = new Config({
      audits: [
        'user-timings'
      ],

      artifacts: {
        traces: {
          [Audit.DEFAULT_PASS]: path.join(__dirname, '/fixtures/traces/trace-user-timings.json')
        }
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      const audits = results.audits;
      assert.equal(audits['user-timings'].displayValue, 2);
      assert.equal(audits['user-timings'].rawValue, true);
    });
  });

  it('rejects when given an invalid trace artifact', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        recordTrace: true,
        gatherers: []
      }],
    });

    // Arrange for driver to return bad trace.
    const badTraceDriver = Object.assign({}, driverMock, {
      endTrace() {
        return Promise.resolve({
          traceEvents: 'not an array'
        });
      }
    });

    return Runner.run({}, {url, config, driverMock: badTraceDriver})
      .then(_ => {
        assert.ok(false);
      }, _ => {
        assert.ok(true);
      });
  });

  describe('Bad required artifact handling', () => {
    it('outputs an error audit result when trace required but not provided', () => {
      const url = 'https://example.com';
      const config = new Config({
        audits: [
          // requires traces[Audit.DEFAULT_PASS]
          'user-timings'
        ],
        artifacts: {
          traces: {}
        }
      });

      return Runner.run({}, {url, config}).then(results => {
        const auditResult = results.audits['user-timings'];
        assert.strictEqual(auditResult.rawValue, null);
        assert.strictEqual(auditResult.error, true);
        assert.ok(auditResult.debugString.includes('traces'));
      });
    });

    it('outputs an error audit result when missing a required artifact', () => {
      const url = 'https://example.com';
      const config = new Config({
        audits: [
          // requires the HTTPS artifact
          'is-on-https'
        ],

        artifacts: {}
      });

      return Runner.run({}, {url, config}).then(results => {
        const auditResult = results.audits['is-on-https'];
        assert.strictEqual(auditResult.rawValue, null);
        assert.strictEqual(auditResult.error, true);
        assert.ok(auditResult.debugString.includes('HTTPS'));
      });
    });

    it('outputs an error audit result when required artifact was a non-fatal Error', () => {
      const errorMessage = 'blurst of times';
      const artifactError = new Error(errorMessage);

      const url = 'https://example.com';
      const config = new Config({
        audits: [
          'is-on-https'
        ],

        artifacts: {
          // Error objects don't make it through the Config constructor due to
          // JSON.stringify/parse step, so populate with test error below.
          HTTPS: null
        }
      });
      config.artifacts.HTTPS = artifactError;

      return Runner.run({}, {url, config}).then(results => {
        const auditResult = results.audits['is-on-https'];
        assert.strictEqual(auditResult.rawValue, null);
        assert.strictEqual(auditResult.error, true);
        assert.ok(auditResult.debugString.includes(errorMessage));
      });
    });
  });

  describe('Bad audit behavior handling', () => {
    const testAuditMeta = {
      category: 'ThrowThrow',
      name: 'throwy-audit',
      description: 'Always throws',
      requiredArtifacts: []
    };

    it('produces an error audit result when an audit throws a non-fatal Error', () => {
      const errorMessage = 'Audit yourself';
      const url = 'https://example.com';
      const config = new Config({
        audits: [
          class ThrowyAudit extends Audit {
            static get meta() {
              return testAuditMeta;
            }
            static audit() {
              throw new Error(errorMessage);
            }
          }
        ],

        artifacts: {}
      });

      return Runner.run({}, {url, config}).then(results => {
        const auditResult = results.audits['throwy-audit'];
        assert.strictEqual(auditResult.rawValue, null);
        assert.strictEqual(auditResult.error, true);
        assert.ok(auditResult.debugString.includes(errorMessage));
      });
    });

    it('rejects if an audit throws a fatal error', () => {
      const errorMessage = 'Uh oh';
      const url = 'https://example.com';
      const config = new Config({
        audits: [
          class FatalThrowyAudit extends Audit {
            static get meta() {
              return testAuditMeta;
            }
            static audit() {
              const fatalError = new Error(errorMessage);
              fatalError.fatal = true;
              throw fatalError;
            }
          }
        ],

        artifacts: {}
      });

      return Runner.run({}, {url, config}).then(
        _ => assert.ok(false),
        err => assert.strictEqual(err.message, errorMessage));
    });
  });

  it('accepts performance logs as an artifact', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'critical-request-chains'
      ],

      artifacts: {
        performanceLog: path.join(__dirname, '/fixtures/perflog.json')
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      const audits = results.audits;
      assert.equal(audits['critical-request-chains'].displayValue, 9);
      assert.equal(audits['critical-request-chains'].rawValue, false);
    });
  });

  it('rejects when given neither audits nor auditResults', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        gatherers: ['https']
      }]
    });

    return Runner.run(null, {url, config, driverMock})
      .then(_ => {
        assert.ok(false);
      }, err => {
        assert.ok(/The config must provide passes/.test(err.message));
      });
  });

  it('accepts existing auditResults', () => {
    const url = 'https://example.com';
    const config = new Config({
      auditResults: [{
        name: 'is-on-https',
        rawValue: true,
        score: true,
        displayValue: ''
      }],

      aggregations: [{
        name: 'Aggregation',
        description: '',
        scored: true,
        categorizable: true,
        items: [{
          name: 'name',
          description: 'description',
          audits: {
            'is-on-https': {
              expectedValue: true,
              weight: 1
            }
          }
        }]
      }]
    });

    return Runner.run(null, {url, config, driverMock}).then(results => {
      // Mostly checking that this did not throw, but check representative values.
      assert.equal(results.initialUrl, url);
      assert.strictEqual(results.audits['is-on-https'].rawValue, true);
    });
  });

  it('returns an aggregation', () => {
    const url = 'https://example.com';
    const config = new Config({
      auditResults: [{
        name: 'is-on-https',
        rawValue: true,
        score: true,
        displayValue: ''
      }],

      aggregations: [{
        name: 'Aggregation',
        description: '',
        scored: true,
        categorizable: true,
        items: [{
          name: 'name',
          description: 'description',
          audits: {
            'is-on-https': {
              expectedValue: true,
              weight: 1
            }
          }
        }]
      }]
    });

    return Runner.run(null, {url, config, driverMock}).then(results => {
      assert.ok(results.lighthouseVersion);
      assert.ok(results.generatedTime);
      assert.equal(results.initialUrl, url);
      assert.equal(results.audits['is-on-https'].name, 'is-on-https');
      assert.equal(results.aggregations[0].score[0].overall, 1);
      assert.equal(results.aggregations[0].score[0].subItems[0], 'is-on-https');
    });
  });

  it('rejects when not given a URL', () => {
    return Runner.run({}, {}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL of zero length', () => {
    return Runner.run({}, {url: ''}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL without protocol', () => {
    return Runner.run({}, {url: 'localhost'}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL without hostname', () => {
    return Runner.run({}, {url: 'https://'}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('only supports core audits with names matching their filename', () => {
    const coreAudits = Runner.getAuditList();
    coreAudits.forEach(auditFilename => {
      const auditPath = '../audits/' + auditFilename;
      const auditExpectedName = path.basename(auditFilename, '.js');
      const AuditClass = require(auditPath);
      assert.strictEqual(AuditClass.meta.name, auditExpectedName);
    });
  });

  it('results include artifacts when given artifacts and audits', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'is-on-https'
      ],

      artifacts: {
        HTTPS: {
          value: true
        }
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      assert.strictEqual(results.artifacts.HTTPS.value, true);

      for (const method of Object.keys(computedArtifacts)) {
        assert.ok(results.artifacts.hasOwnProperty(method));
      }
    });
  });

  it('results include artifacts when given passes and audits', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        gatherers: ['https']
      }],

      audits: [
        'is-on-https'
      ]
    });

    return Runner.run(null, {url, config, driverMock}).then(results => {
      // Check whether non-computedArtifacts attributes are returned
      assert.ok(results.artifacts.HTTPS);

      for (const method of Object.keys(computedArtifacts)) {
        assert.ok(results.artifacts.hasOwnProperty(method));
      }
    });
  });

  it('results include artifacts when given auditResults', () => {
    const url = 'https://example.com';
    const config = new Config({
      auditResults: [{
        name: 'is-on-https',
        rawValue: true,
        score: true,
        displayValue: ''
      }],

      artifacts: {
        HTTPS: {
          value: true
        }
      }
    });

    return Runner.run(null, {url, config, driverMock}).then(results => {
      assert.strictEqual(results.artifacts.HTTPS.value, true);

      for (const method of Object.keys(computedArtifacts)) {
        assert.ok(results.artifacts.hasOwnProperty(method));
      }
    });
  });
});
