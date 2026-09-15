/**
 * Tests for js/rebalance.js
 * Run them with:  npm test
 *
 * Each test checks one small promise the code makes. If someone breaks
 * that promise later, the test fails and GitHub Actions shows a red X.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTrades,
  createRandom,
  generateMonthlyReturns,
  maxDrawdown,
  maxDrift,
  simulate,
  toWeights,
  DEFAULT_ASSETS,
} from '../js/rebalance.js';

const TARGET = [0.6, 0.4];

// Helper: builds fake market data where every month is identical.
function repeatMonths(returns, months) {
  return Array.from({ length: months }, () => [...returns]);
}

test('toWeights turns dollar amounts into weights that add up to 1', () => {
  assert.deepEqual(toWeights([750, 250]), [0.75, 0.25]);
});

test('toWeights handles an empty portfolio without crashing', () => {
  assert.deepEqual(toWeights([0, 0]), [0, 0]);
});

test('calculateTrades says what to sell and what to buy', () => {
  const trades = calculateTrades([7000, 3000], TARGET);
  assert.deepEqual(
    trades.map((t) => t.trade),
    [-1000, 1000] // sell $1,000 of stocks, buy $1,000 of bonds
  );
});

test('createRandom gives the same numbers for the same seed', () => {
  const a = createRandom(42);
  const b = createRandom(42);
  assert.equal(a(), b());
  assert.equal(a(), b());
});

test('generateMonthlyReturns makes one row per month and one value per asset', () => {
  const returns = generateMonthlyReturns({ assets: DEFAULT_ASSETS, months: 24, seed: 1 });
  assert.equal(returns.length, 24);
  assert.equal(returns[0].length, DEFAULT_ASSETS.length);
});

test('"never" strategy never rebalances', () => {
  const result = simulate({
    initialValue: 10000,
    targetWeights: TARGET,
    monthlyReturns: repeatMonths([0.02, 0], 36),
    strategy: { type: 'never' },
  });
  assert.equal(result.rebalanceCount, 0);
});

test('calendar strategy rebalances once every 12 months', () => {
  const result = simulate({
    initialValue: 10000,
    targetWeights: TARGET,
    monthlyReturns: repeatMonths([0.01, 0], 36),
    strategy: { type: 'calendar', everyMonths: 12 },
  });
  assert.equal(result.rebalanceCount, 3);
});

test('threshold strategy only rebalances when drift is bigger than the band', () => {
  // Month 1: stocks jump 50%, pushing them from 60% to about 69%.
  // Month 2: nothing moves, so no second rebalance is needed.
  const result = simulate({
    initialValue: 10000,
    targetWeights: TARGET,
    monthlyReturns: [[0.5, 0], [0, 0]],
    strategy: { type: 'threshold', band: 0.05 },
  });
  assert.equal(result.rebalanceCount, 1);
  assert.deepEqual(result.history[1].weights, TARGET);
});

test('rebalancing moves money around but does not create or destroy it', () => {
  const returns = [[0.5, 0]];
  const never = simulate({
    initialValue: 10000,
    targetWeights: TARGET,
    monthlyReturns: returns,
    strategy: { type: 'never' },
  });
  const threshold = simulate({
    initialValue: 10000,
    targetWeights: TARGET,
    monthlyReturns: returns,
    strategy: { type: 'threshold', band: 0.05 },
  });
  assert.equal(never.finalValue, 13000);
  assert.equal(threshold.finalValue, 13000);
});

test('maxDrift finds the furthest any asset strayed from target', () => {
  const history = [
    { weights: [0.6, 0.4] },
    { weights: [0.7, 0.3] },
    { weights: [0.65, 0.35] },
  ];
  assert.ok(Math.abs(maxDrift(history, TARGET) - 0.1) < 1e-9);
});

test('maxDrawdown measures the biggest fall from a high point', () => {
  assert.equal(maxDrawdown([100, 120, 90, 130]), 0.25);
});
