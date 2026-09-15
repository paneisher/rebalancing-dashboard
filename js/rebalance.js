/**
 * rebalance.js
 *
 * The "brain" of the dashboard: pure functions that simulate a portfolio.
 * Nothing in this file touches the web page. Keeping logic separate from
 * the UI makes it easy to test (see tests/rebalance.test.js).
 */

// The assets in our pretend portfolio. Returns and volatility are yearly
// assumptions used only to generate random, made-up market data.
export const DEFAULT_ASSETS = [
  { name: 'Stocks', annualReturn: 0.07, annualVolatility: 0.15 },
  { name: 'Bonds', annualReturn: 0.03, annualVolatility: 0.06 },
  { name: 'Cash', annualReturn: 0.02, annualVolatility: 0.005 },
];

/** Adds up a list of numbers. */
export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * A random number generator that gives the same numbers for the same seed.
 * Math.random() can't do that, and repeatable results make testing possible.
 */
export function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turns two uniform random numbers into a bell-curve (normal) random number. */
function randomNormal(random) {
  let u = 0;
  while (u === 0) u = random(); // log(0) is undefined, so avoid 0
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Makes up monthly returns for each asset.
 * Result looks like: [[stocksMonth1, bondsMonth1, cashMonth1], [...], ...]
 */
export function generateMonthlyReturns({ assets, months, seed }) {
  const random = createRandom(seed);
  const returns = [];

  for (let month = 0; month < months; month++) {
    returns.push(
      assets.map((asset) => {
        const mean = asset.annualReturn / 12;
        const spread = asset.annualVolatility / Math.sqrt(12);
        return mean + spread * randomNormal(random);
      })
    );
  }

  return returns;
}

/** Converts dollar amounts into weights that add up to 1 (i.e. 100%). */
export function toWeights(holdings) {
  const total = sum(holdings);
  if (total <= 0) return holdings.map(() => 0);
  return holdings.map((amount) => amount / total);
}

/**
 * Works out how much to buy (positive) or sell (negative) of each asset
 * to get back to the target weights.
 */
export function calculateTrades(holdings, targetWeights) {
  const total = sum(holdings);
  return holdings.map((current, i) => {
    const target = total * targetWeights[i];
    return { current, target, trade: target - current };
  });
}

/** True if any asset has drifted further from its target than the band allows. */
export function isOutsideBand(weights, targetWeights, band) {
  return weights.some((weight, i) => Math.abs(weight - targetWeights[i]) > band);
}

/**
 * Decides whether to rebalance this month.
 * strategy examples:
 *   { type: 'never' }
 *   { type: 'calendar', everyMonths: 12 }
 *   { type: 'threshold', band: 0.05 }
 */
export function shouldRebalance(strategy, month, weights, targetWeights) {
  switch (strategy.type) {
    case 'never':
      return false;
    case 'calendar':
      return month % strategy.everyMonths === 0;
    case 'threshold':
      return isOutsideBand(weights, targetWeights, strategy.band);
    default:
      throw new Error(`Unknown strategy type: ${strategy.type}`);
  }
}

/**
 * Runs the portfolio month by month and records what happened.
 * Returns { history, rebalanceCount, finalValue }.
 */
export function simulate({ initialValue, targetWeights, monthlyReturns, strategy }) {
  let holdings = targetWeights.map((weight) => initialValue * weight);
  let rebalanceCount = 0;
  const history = [{ month: 0, value: initialValue, weights: [...targetWeights] }];

  monthlyReturns.forEach((returns, index) => {
    const month = index + 1;

    // 1. The market moves each asset up or down.
    holdings = holdings.map((amount, i) => amount * (1 + returns[i]));

    // 2. If the strategy says so, reset every asset to its target weight.
    if (shouldRebalance(strategy, month, toWeights(holdings), targetWeights)) {
      const total = sum(holdings);
      holdings = targetWeights.map((weight) => total * weight);
      rebalanceCount++;
    }

    // 3. Record the result for the charts.
    history.push({ month, value: sum(holdings), weights: toWeights(holdings) });
  });

  return { history, rebalanceCount, finalValue: sum(holdings) };
}

/** The furthest any asset got from its target at any point (0.12 = 12 points). */
export function maxDrift(history, targetWeights) {
  let largest = 0;
  for (const point of history) {
    point.weights.forEach((weight, i) => {
      largest = Math.max(largest, Math.abs(weight - targetWeights[i]));
    });
  }
  return largest;
}

/** How bumpy the ride was: yearly standard deviation of monthly returns. */
export function annualizedVolatility(history) {
  const returns = [];
  for (let i = 1; i < history.length; i++) {
    returns.push(history[i].value / history[i - 1].value - 1);
  }
  if (returns.length < 2) return 0;

  const mean = sum(returns) / returns.length;
  const variance =
    sum(returns.map((r) => (r - mean) ** 2)) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(12);
}

/** The biggest fall from a previous high (0.25 = the portfolio lost 25%). */
export function maxDrawdown(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    worst = Math.max(worst, (peak - value) / peak);
  }
  return worst;
}
