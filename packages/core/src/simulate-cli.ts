/**
 * Workload explorer: `npm run sim`
 *
 * Shows what a desired-retention setting actually costs in daily reviews.
 * This is the number that decides whether a study habit survives, so it is
 * worth being able to see it before committing a year to a setting.
 */

import { simulate } from './simulate.js';

const cardCount = Number(process.argv[2] ?? 500);
const days = Number(process.argv[3] ?? 365);

console.log(`\n${cardCount} words over ${days} days\n`);
console.log('retention   total reviews   observed   reviews/day (final month)   busiest day');
console.log('-'.repeat(80));

for (const r of [0.8, 0.85, 0.9, 0.95]) {
  const res = simulate({ cardCount, days, seed: 4, requestRetention: r });
  const last30 = res.reviewsPerDay.slice(-30).reduce((a, b) => a + b, 0) / 30;
  const peak = Math.max(...res.reviewsPerDay);
  console.log(
    `   ${r.toFixed(2)}   ${String(res.totalReviews).padStart(13)}   ${(res.observedRetention * 100).toFixed(1).padStart(7)}%   ${last30.toFixed(1).padStart(24)}   ${String(peak).padStart(11)}`,
  );
}
console.log();
