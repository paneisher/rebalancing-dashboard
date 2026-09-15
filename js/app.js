/**
 * app.js
 *
 * Connects the web page to the maths in rebalance.js:
 *   read the inputs -> run the simulations -> draw the results.
 */
import {
  DEFAULT_ASSETS,
  annualizedVolatility,
  calculateTrades,
  generateMonthlyReturns,
  maxDrawdown,
  maxDrift,
  simulate,
} from './rebalance.js';

// ---------- Setup ----------

const css = getComputedStyle(document.documentElement);
const ASSET_COLORS = ['--color-stocks', '--color-bonds', '--color-cash'].map((name) =>
  css.getPropertyValue(name).trim()
);
const INK = css.getPropertyValue('--color-ink').trim();
const MUTED = css.getPropertyValue('--color-muted').trim();

// Each strategy gets its own line style so the charts don't rely on colour alone.
const STRATEGY_STYLES = {
  never: { color: '#c2413a', dash: [] },
  annual: { color: INK, dash: [6, 4] },
  threshold: { color: ASSET_COLORS[0], dash: [2, 3] },
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const percent = (value) => `${(value * 100).toFixed(1)}%`;

// Shortcut for finding elements by id.
const $ = (id) => document.getElementById(id);

let seed = 2026;

// ---------- Reading the inputs ----------

function readNumber(id, fallback) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function readSettings() {
  const targets = DEFAULT_ASSETS.map((_, i) => readNumber(`target-${i}`, 0));
  return {
    initialValue: Math.max(readNumber('initial-value', 10000), 1),
    years: Math.min(Math.max(Math.round(readNumber('years', 20)), 1), 50),
    targetPercents: targets,
    band: readNumber('band', 5) / 100,
  };
}

/** Returns an error message, or null if the target mix is valid. */
function validateTargets(targetPercents) {
  if (targetPercents.some((p) => p < 0)) return 'Percentages can’t be negative.';
  const total = targetPercents.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.001) {
    return `Your mix adds up to ${total}%. Change the numbers so they add up to 100%.`;
  }
  return null;
}

// ---------- Running the simulations ----------

function runStrategies(settings) {
  const targetWeights = settings.targetPercents.map((p) => p / 100);
  const monthlyReturns = generateMonthlyReturns({
    assets: DEFAULT_ASSETS,
    months: settings.years * 12,
    seed,
  });

  const strategies = [
    { id: 'never', label: 'Never rebalance', rule: { type: 'never' } },
    { id: 'annual', label: 'Once a year', rule: { type: 'calendar', everyMonths: 12 } },
    {
      id: 'threshold',
      label: `Past ±${Math.round(settings.band * 100)} points`,
      rule: { type: 'threshold', band: settings.band },
    },
  ];

  return strategies.map((strategy) => {
    const result = simulate({
      initialValue: settings.initialValue,
      targetWeights,
      monthlyReturns,
      strategy: strategy.rule,
    });
    return { ...strategy, ...result, targetWeights };
  });
}

// ---------- Drawing: hero bars ----------

function renderLegend() {
  $('legend').innerHTML = DEFAULT_ASSETS.map(
    (asset, i) => `<li style="--swatch: ${ASSET_COLORS[i]}">${asset.name}</li>`
  ).join('');
}

function renderBar(element, weights) {
  element.innerHTML = weights
    .map((weight, i) => {
      // Hide the text on slices too thin to fit it.
      const text = weight >= 0.07 ? `${Math.round(weight * 100)}%` : '';
      return `<div class="bar-segment" style="width:${weight * 100}%; background:${ASSET_COLORS[i]}"
        title="${DEFAULT_ASSETS[i].name}: ${percent(weight)}">${text}</div>`;
    })
    .join('');
  element.setAttribute(
    'aria-label',
    weights.map((w, i) => `${DEFAULT_ASSETS[i].name} ${percent(w)}`).join(', ')
  );
}

function renderHero(results, settings) {
  const never = results.find((r) => r.id === 'never');
  const finalWeights = never.history[never.history.length - 1].weights;
  const start = settings.targetPercents[0];
  const end = Math.round(finalWeights[0] * 100);

  renderBar($('target-bar'), never.targetWeights);
  renderBar($('drifted-bar'), finalWeights);
  $('drifted-label').textContent = `After ${settings.years} years, untouched`;
  $('hero-lede').innerHTML =
    `Left alone for ${settings.years} years, a portfolio that started with ` +
    `<strong>${start}%</strong> in stocks ended with <strong>${end}%</strong>.`;
}

// ---------- Drawing: charts ----------

let valueChart;
let driftChart;

function yearLabels(history) {
  return history.map((point) => (point.month % 12 === 0 ? `Year ${point.month / 12}` : ''));
}

function lineDataset(result, values) {
  const style = STRATEGY_STYLES[result.id];
  return {
    label: result.label,
    data: values,
    borderColor: style.color,
    borderDash: style.dash,
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.15,
  };
}

function baseChartOptions(formatTick) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { color: INK, usePointStyle: true } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const month = items[0].dataIndex;
            return `Year ${Math.floor(month / 12)}, month ${month % 12}`;
          },
          label: (item) => `${item.dataset.label}: ${formatTick(item.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: MUTED, autoSkip: false, maxRotation: 0, callback: autoSkipYears },
        grid: { display: false },
      },
      y: { ticks: { color: MUTED, callback: formatTick } },
    },
  };
}

// Show roughly 8 year labels on the x-axis, whatever the time span.
function autoSkipYears(value) {
  const label = this.getLabelForValue(value);
  if (!label) return null;
  const totalYears = Math.floor((this.chart.data.labels.length - 1) / 12);
  const step = Math.max(1, Math.ceil(totalYears / 8));
  const year = Number(label.replace('Year ', ''));
  return year % step === 0 ? label : null;
}

function renderCharts(results) {
  const labels = yearLabels(results[0].history);
  const target = results[0].targetWeights[0];

  const valueData = {
    labels,
    datasets: results.map((r) => lineDataset(r, r.history.map((p) => p.value))),
  };

  const driftData = {
    labels,
    datasets: [
      ...results.map((r) => lineDataset(r, r.history.map((p) => p.weights[0]))),
      {
        label: 'Target',
        data: labels.map(() => target),
        borderColor: MUTED,
        borderDash: [8, 6],
        borderWidth: 1.5,
        pointRadius: 0,
      },
    ],
  };

  // Create the charts the first time, then just swap in new data.
  if (!valueChart) {
    valueChart = new Chart($('value-chart'), {
      type: 'line',
      data: valueData,
      options: baseChartOptions((v) => money.format(v)),
    });
    driftChart = new Chart($('drift-chart'), {
      type: 'line',
      data: driftData,
      options: baseChartOptions((v) => percent(v)),
    });
  } else {
    valueChart.data = valueData;
    driftChart.data = driftData;
    valueChart.update();
    driftChart.update();
  }
}

// ---------- Drawing: tables ----------

function renderComparison(results) {
  $('compare-body').innerHTML = results
    .map((r) => {
      const values = r.history.map((p) => p.value);
      return `<tr>
        <td>${r.label}</td>
        <td>${money.format(r.finalValue)}</td>
        <td>${r.rebalanceCount}</td>
        <td>${percent(maxDrift(r.history, r.targetWeights))}</td>
        <td>${percent(annualizedVolatility(r.history))}</td>
        <td>${percent(maxDrawdown(values))}</td>
      </tr>`;
    })
    .join('');
}

function renderCalculator(targetPercents) {
  const holdings = DEFAULT_ASSETS.map((_, i) => Math.max(readNumber(`hold-${i}`, 0), 0));
  const trades = calculateTrades(holdings, targetPercents.map((p) => p / 100));

  $('calc-body').innerHTML = trades
    .map((t, i) => {
      let action = 'No change';
      if (t.trade > 0.5) action = `<span class="buy">Buy ${money.format(t.trade)}</span>`;
      if (t.trade < -0.5) action = `<span class="sell">Sell ${money.format(-t.trade)}</span>`;
      return `<tr>
        <td>${DEFAULT_ASSETS[i].name}</td>
        <td>${money.format(t.current)}</td>
        <td>${money.format(t.target)} (${targetPercents[i]}%)</td>
        <td>${action}</td>
      </tr>`;
    })
    .join('');
}

// ---------- Putting it together ----------

function update() {
  const settings = readSettings();
  const error = validateTargets(settings.targetPercents);

  $('target-error').hidden = !error;
  $('target-error').textContent = error ?? '';
  $('seed-label').textContent = seed;
  if (error) return; // keep showing the last valid results

  const results = runStrategies(settings);
  renderHero(results, settings);
  renderCharts(results);
  renderComparison(results);
  renderCalculator(settings.targetPercents);
}

$('new-scenario').addEventListener('click', () => {
  seed = Math.floor(Math.random() * 100000);
  update();
});

// Re-run whenever any number box changes.
document.querySelectorAll('input').forEach((input) => {
  input.addEventListener('input', update);
});

renderLegend();
update();
